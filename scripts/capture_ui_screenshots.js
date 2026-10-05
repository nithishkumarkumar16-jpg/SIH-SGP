const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 5174;
const CDP_PORT = 9226;
const ROOT_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT_DIR, "build");
const OUT_DIR = path.join(ROOT_DIR, "test_fixtures");
const SYNTHETIC_DIR = path.join(ROOT_DIR, "test_fixtures", "synthetic");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".traineddata": "application/octet-stream",
  ".ico": "image/x-icon",
};

function parseHeadersFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const headers = {};
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("/*") || trimmed.startsWith("#")) return;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.substring(0, colonIdx).trim();
      const val = trimmed.substring(colonIdx + 1).trim();
      headers[key] = val;
    }
  });
  return headers;
}

const buildHeaders = parseHeadersFile(path.join(BUILD_DIR, "_headers"));

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsed.pathname;
  if (pathname === "/") pathname = "/index.html";

  const relPath = pathname.replace(/^\/+/, "");
  let filePath = path.join(BUILD_DIR, relPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(BUILD_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  Object.entries(buildHeaders).forEach(([k, v]) => {
    res.setHeader(k, v);
  });
  res.setHeader("Content-Type", contentType);
  fs.createReadStream(filePath).pipe(res);
});

async function main() {
  await new Promise((r) => server.listen(PORT, r));
  console.log(`Server listening on port ${PORT}`);

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${path.join(ROOT_DIR, "scratch", "chrome_screenshot_profile")}`,
    `http://localhost:${PORT}/documents`,
  ]);

  let cdpUrl = null;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const page = list.find((t) => t.type === "page");
        if (page) {
          cdpUrl = page.webSocketDebuggerUrl;
          break;
        }
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!cdpUrl) throw new Error("Could not connect to Chrome CDP");

  const ws = new WebSocket(cdpUrl);
  await new Promise((res) => ws.once("open", res));

  let msgId = 1;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = msgId++;
      const handler = (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.id === id) {
          ws.off("message", handler);
          if (parsed.error) reject(parsed.error);
          else resolve(parsed.result);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });

  // Enable CDP domains
  await send("Page.enable");
  await send("DOM.enable");
  await send("Runtime.enable");

  ws.on("message", async (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.method === "Page.javascriptDialogOpening") {
        await send("Page.handleJavaScriptDialog", { accept: true });
      }
    } catch (e) {}
  });

  const evaluate = (expression) =>
    send("Runtime.evaluate", { expression, returnByValue: true }).then((r) => r.result?.value);

  // Set standard desktop viewport
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1366,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });

  console.log("Navigating to documents page...");
  await send("Page.navigate", { url: `http://localhost:${PORT}/documents` });
  await new Promise((r) => setTimeout(r, 2000));

  for (let i = 0; i < 30; i++) {
    const ready = await evaluate("Boolean(document.querySelector('input[type=\"file\"]'))");
    if (ready) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  // Upload synthetic 10th marksheet
  const syntheticMarksheetPath = path.join(SYNTHETIC_DIR, "synthetic_marksheet_en.png");
  if (fs.existsSync(syntheticMarksheetPath)) {
    console.log("Uploading synthetic 10th marksheet...");
    const docRoot = await send("DOM.getDocument", { depth: -1 });
    const fileInputs = await send("DOM.querySelectorAll", {
      nodeId: docRoot.root.nodeId,
      selector: "input[type='file']",
    });

    console.log(`Found ${fileInputs.nodeIds.length} file input elements.`);
    if (fileInputs.nodeIds.length > 0) {
      await send("DOM.setFileInputFiles", {
        files: [syntheticMarksheetPath],
        nodeId: fileInputs.nodeIds[0],
      });

      await evaluate(`
        (() => {
          const input = document.querySelector('input[type="file"]');
          if (input) {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      await new Promise((r) => setTimeout(r, 1200));

      // Click VERIFY
      console.log("Triggering OCR analysis...");
      await evaluate(`
        (() => {
          const btn = document.querySelector('.nsp-ai-btn');
          if (btn) btn.click();
        })()
      `);

      // Wait for OCR
      for (let i = 0; i < 30; i++) {
        const hasExtracted = await evaluate("document.querySelectorAll('.extracted-field-row').length > 0");
        const isLoading = await evaluate("Boolean(document.querySelector('.nsp-ai-btn.loading') || document.querySelector('.ocr-progress'))");
        if (hasExtracted && !isLoading) {
          console.log(`OCR completed after ${i + 1}s`);
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Open Tools dropdown on first card to demonstrate the compact menu
  await evaluate(`
    (() => {
      const toolsBtn = document.querySelector('.doc-tools-trigger');
      if (toolsBtn) toolsBtn.click();
      window.scrollTo({ top: 300, behavior: 'instant' });
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  // Screenshot 1: Step 1 Upload Cards with simplified layout
  const shot1 = await send("Page.captureScreenshot", { format: "png" });
  const shot1Path = path.join(OUT_DIR, "simplified_document_cards.png");
  fs.writeFileSync(shot1Path, Buffer.from(shot1.data, "base64"));
  console.log(`Saved Step 1 screenshot: ${shot1Path}`);

  // Confirm document name if confirm button exists
  await evaluate(`
    (() => {
      const confirmBtn = document.querySelector('.field-btn-confirm');
      if (confirmBtn) confirmBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 500));

  // Navigate to Step 2 (Identity)
  console.log("Navigating to Step 2...");
  await evaluate(`
    (() => {
      window.scrollTo({ top: 9999, behavior: 'instant' });
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next: Enter Identity') || b.innerText.includes('Next'));
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 1200));

  // Fill in Step 2 fields using React-compatible input setters
  console.log("Filling Step 2 Identity fields...");
  await evaluate(`
    (() => {
      const setVal = (el, val) => {
        if (!el) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(
          el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype,
          'value'
        ).set;
        nativeSetter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      // Aadhaar Name
      setVal(document.querySelector('input[placeholder="e.g. SAMPLE STUDENT"]'), 'VIKRAM RAMAN');
      // Date of Birth
      setVal(document.querySelector('input[type="date"]'), '2006-07-14');
      // Bank Account Holder Name (second text input)
      const textInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
      if (textInputs[1]) {
        setVal(textInputs[1], 'VIKRAM RAMAN');
      }
      // Bank Account Type
      const selects = Array.from(document.querySelectorAll('select'));
      const bankSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'Single'));
      if (bankSelect) {
        setVal(bankSelect, 'Single');
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  // Navigate to Step 3 Consistency Results
  console.log("Navigating to Step 3 Consistency Results...");
  await evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Run Multi-Document Data Consistency Check') || b.innerText.includes('Consistency'));
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 2000));

  // Scroll to Results report header
  await evaluate(`
    (() => {
      window.scrollTo({ top: 150, behavior: 'instant' });
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  // Screenshot 2: Step 3 Verification Results page
  const shot2 = await send("Page.captureScreenshot", { format: "png" });
  const shot2Path = path.join(OUT_DIR, "simplified_results_page.png");
  fs.writeFileSync(shot2Path, Buffer.from(shot2.data, "base64"));
  console.log(`Saved Step 3 screenshot: ${shot2Path}`);

  // Navigate to Step 4 Find Matching Scholarships
  console.log("Navigating to Step 4 Find Matching Scholarships...");
  await evaluate(`
    (() => {
      window.scrollTo({ top: 9999, behavior: 'instant' });
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Find Matching Scholarships'));
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 2000));

  // Scroll to show Step 4 Stepper, Header, and Complete Your Profile Form
  console.log("Scrolling to Step 4 Complete Your Profile form...");
  await evaluate(`
    (() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  const ARTIFACT_DIR = "C:\\Users\\Nithishkumar M\\.gemini\\antigravity-ide\\brain\\404245f0-139c-4b3a-8a3e-f81628694426";

  // Screenshot 3: Step 4 Missing Information "Complete your profile" form
  const shot3 = await send("Page.captureScreenshot", { format: "png" });
  const shot3Path = path.join(OUT_DIR, "step4_complete_profile_form.png");
  const shot3Artifact = path.join(ARTIFACT_DIR, "step4_complete_profile_form.png");
  fs.writeFileSync(shot3Path, Buffer.from(shot3.data, "base64"));
  fs.writeFileSync(shot3Artifact, Buffer.from(shot3.data, "base64"));
  console.log(`Saved Step 4 missing profile screenshot: ${shot3Artifact}`);

  // Complete missing fields in the compact profile form
  console.log("Filling profile fields in Step 4...");
  await evaluate(`
    (() => {
      const setVal = (el, val) => {
        if (!el) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(
          el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype,
          'value'
        ).set;
        nativeSetter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const buttons = Array.from(document.querySelectorAll('button'));
      const ugBtn = buttons.find(b => b.innerText.trim() === 'UG');
      if (ugBtn) ugBtn.click();
      const yr1Btn = buttons.find(b => b.innerText.trim() === '1st Year');
      if (yr1Btn) yr1Btn.click();

      const selects = Array.from(document.querySelectorAll('select'));
      const stateSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'Tamil Nadu'));
      if (stateSelect) setVal(stateSelect, 'Tamil Nadu');

      const commSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'OBC'));
      if (commSelect) setVal(commSelect, 'OBC');

      const govtQuota = buttons.find(b => b.innerText.trim() === 'Govt Quota');
      if (govtQuota) govtQuota.click();
      const fgBtn = buttons.find(b => b.innerText.trim() === 'Yes');
      if (fgBtn) fgBtn.click();

      const incInput = document.querySelector('input[type="number"]');
      if (incInput) setVal(incInput, '150000');
    })()
  `);
  await new Promise((r) => setTimeout(r, 1500));

  // Switch to the More Information Needed tab where 13 schemes are matched
  console.log("Switching to More Information Needed tab...");
  await evaluate(`
    (() => {
      const tabBtn = Array.from(document.querySelectorAll('.elig-tab-btn')).find(b => b.innerText.includes('More Information Needed'));
      if (tabBtn) tabBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  // Expand the first matched scholarship card to show requirements & checklist
  console.log("Expanding first matched scholarship card...");
  await evaluate(`
    (() => {
      const expandBtn = document.querySelector('.checklist-btn');
      if (expandBtn) expandBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 1000));

  // Scroll to show matched schemes and expanded checklist
  await evaluate(`
    (() => {
      const firstCard = document.querySelector('.scheme-result-card');
      if (firstCard) {
        firstCard.scrollIntoView({ behavior: 'instant', block: 'start' });
        window.scrollBy({ top: -20, behavior: 'instant' });
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  // Screenshot 4: Step 4 Matched Schemes with 3-tab layout, status badges, and expandable checklist
  const shot4 = await send("Page.captureScreenshot", { format: "png" });
  const shot4Path = path.join(OUT_DIR, "step4_matched_scholarships.png");
  const shot4Artifact = path.join(ARTIFACT_DIR, "step4_matched_scholarships.png");
  fs.writeFileSync(shot4Path, Buffer.from(shot4.data, "base64"));
  fs.writeFileSync(shot4Artifact, Buffer.from(shot4.data, "base64"));
  console.log(`Saved Step 4 matched scholarships screenshot: ${shot4Artifact}`);

  ws.close();
  chromeProc.kill();
  server.close();
  console.log("Done capturing UI screenshots!");
}

main().catch((err) => {
  console.error("Screenshot capture error:", err);
  server.close();
  process.exit(1);
});
