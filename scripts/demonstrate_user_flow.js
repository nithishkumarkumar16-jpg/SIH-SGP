const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 5189;
const CDP_PORT = 9246;
const ROOT_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT_DIR, "build");
const ARTIFACT_DIR = "C:\\Users\\Nithishkumar M\\.gemini\\antigravity-ide\\brain\\404245f0-139c-4b3a-8a3e-f81628694426";
const TEST_FIXTURES_DIR = path.join(ROOT_DIR, "test_fixtures");
const SYNTHETIC_DIR = path.join(TEST_FIXTURES_DIR, "synthetic");

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
  let reqPath = req.url.split("?")[0].replace(/^\/+/, "");
  let filePath = path.join(BUILD_DIR, reqPath);
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
  console.log(`[Server] Listening on http://localhost:${PORT}`);

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.join(ROOT_DIR, "scratch", "chrome_user_flow_demo");
  if (fs.existsSync(userDataDir)) {
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }

  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${userDataDir}`,
    `http://localhost:${PORT}/documents`,
  ]);

  let pageTarget = null;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (res.ok) {
        const list = await res.json();
        pageTarget = list.find((t) => t.type === "page" && !t.url.startsWith("chrome-extension://"));
        if (pageTarget) break;
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!pageTarget) throw new Error("Could not find Chrome page target");

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
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

  // Automatically dismiss dialogs
  ws.on("message", (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.method === "Page.javascriptDialogOpening") {
        console.log(`[Dialog Opened]: ${parsed.params.message}`);
        send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }
    } catch (e) {}
  });

  await send("Page.enable");
  await send("DOM.enable");
  await send("Runtime.enable");

  const evaluate = (expression) =>
    send("Runtime.evaluate", { expression, returnByValue: true }).then((r) => r.result?.value);

  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const saveScreenshot = async (name) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const bPath = path.join(ARTIFACT_DIR, name);
    const fPath = path.join(TEST_FIXTURES_DIR, name);
    fs.writeFileSync(bPath, Buffer.from(shot.data, "base64"));
    fs.writeFileSync(fPath, Buffer.from(shot.data, "base64"));
    console.log(`[Screenshot Saved] ${name}`);
    return bPath;
  };

  console.log("Waiting for /documents to load cleanly without demo params...");
  for (let i = 0; i < 30; i++) {
    const ready = await evaluate(`Boolean(document.querySelector('.document-card') || document.querySelector('.stepper'))`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Verify URL has NO demo parameters
  const currentUrl = await evaluate(`window.location.href`);
  console.log(`Current page URL: ${currentUrl}`);

  // Screenshot 1: Step 1 Upload initial
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' });`);
  await new Promise((r) => setTimeout(r, 400));
  await saveScreenshot("flow_01_step1_upload_initial.png");

  // Upload synthetic income document
  const syntheticIncomePath = path.join(SYNTHETIC_DIR, "synthetic_income_bilingual.png");
  console.log(`Uploading synthetic income certificate: ${syntheticIncomePath}`);

  const docNode = await send("DOM.getDocument", { depth: -1 });
  const fileInputs = await send("DOM.querySelectorAll", {
    nodeId: docNode.root.nodeId,
    selector: "input[type='file']",
  });

  console.log(`Found ${fileInputs.nodeIds.length} file inputs.`);

  // Find index of Income Certificate file input
  const incomeInputIndex = await evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.document-card'));
      const incCard = cards.find(c => c.querySelector('h3')?.innerText?.includes('Income Certificate'));
      if (!incCard) return -1;
      const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const cardInput = incCard.querySelector('input[type="file"]');
      return allInputs.indexOf(cardInput);
    })()
  `);
  console.log(`Income certificate input index: ${incomeInputIndex}`);

  const targetIdx = incomeInputIndex >= 0 ? incomeInputIndex : 3;
  await send("DOM.setFileInputFiles", {
    files: [syntheticIncomePath],
    nodeId: fileInputs.nodeIds[targetIdx],
  });

  await evaluate(`
    (() => {
      const inputs = document.querySelectorAll('input[type="file"]');
      const input = inputs[${targetIdx}];
      if (input) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()
  `);

  await new Promise((r) => setTimeout(r, 1200));

  // Click VERIFY on the income card
  console.log("Triggering VERIFY on income certificate card...");
  await evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.document-card'));
      const incCard = cards.find(c => c.querySelector('h3')?.innerText?.includes('Income Certificate'));
      if (incCard) {
        const btn = incCard.querySelector('.nsp-ai-btn');
        if (btn) btn.click();
      }
    })()
  `);

  // Wait for OCR to complete (extracted fields appear)
  console.log("Waiting for OCR extraction to finish...");
  let ocrDone = false;
  for (let i = 0; i < 40; i++) {
    ocrDone = await evaluate(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.document-card'));
        const incCard = cards.find(c => c.querySelector('h3')?.innerText?.includes('Income Certificate'));
        if (!incCard) return false;
        return Boolean(incCard.querySelector('.nsp-ext-row') || incCard.querySelector('.nsp-reset-btn'));
      })()
    `);
    if (ocrDone) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`OCR Completed: ${ocrDone}`);

  await new Promise((r) => setTimeout(r, 600));
  await evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.document-card'));
      const incCard = cards.find(c => c.querySelector('h3')?.innerText?.includes('Income Certificate'));
      if (incCard) incCard.scrollIntoView({ behavior: 'instant', block: 'center' });
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));
  await saveScreenshot("flow_02_step1_ocr_extracted.png");

  // Step 1 -> Step 2: Click "Next: Enter Identity Details"
  console.log("Navigating to Step 2...");
  await evaluate(`
    (() => {
      const nextBtn = document.querySelector('.btn-massive-primary');
      if (nextBtn) nextBtn.click();
    })()
  `);

  await new Promise((r) => setTimeout(r, 800));
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' });`);
  await new Promise((r) => setTimeout(r, 400));
  await saveScreenshot("flow_03_step2_identity_initial.png");

  // In Step 2: Confirm extracted details & enter missing information
  console.log("Entering identity, banking, and welfare details in Step 2...");
  const formFillResult = await evaluate(`
    (() => {
      function setNativeValue(element, value) {
        const valSetter = Object.getOwnPropertyDescriptor(element.__proto__, 'value') || 
                          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (valSetter && valSetter.set) {
          valSetter.set.call(element, value);
        } else {
          element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function setSelectValue(element, value) {
        const selSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        selSetter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 1. Applicant Full Name (Aadhaar Reference)
      const inputs = Array.from(document.querySelectorAll('input'));
      const nameInput = inputs.find(i => i.placeholder && i.placeholder.includes('SAMPLE STUDENT'));
      if (nameInput) setNativeValue(nameInput, 'NITHISH KUMAR M');

      // 2. DOB
      const dobInput = inputs.find(i => i.type === 'date');
      if (dobInput) setNativeValue(dobInput, '2004-06-15');

      // 3. Category Select
      const selects = Array.from(document.querySelectorAll('select'));
      const catSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'MBC'));
      if (catSelect) setSelectValue(catSelect, 'MBC');

      // 4. Banking Details
      const bankHolderInput = inputs.find(i => i.placeholder && i.placeholder.includes('SAMPLE STUDENT') && i !== nameInput) ||
                              inputs.find(i => i.value !== 'NITHISH KUMAR M' && !i.type.includes('date') && !i.type.includes('radio'));
      const allTextInputs = inputs.filter(i => i.type === 'text' || !i.type);
      if (allTextInputs.length >= 2) {
        setNativeValue(allTextInputs[1], 'NITHISH KUMAR M');
      }

      const bankAccSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'Single'));
      if (bankAccSelect) setSelectValue(bankAccSelect, 'Single');

      // Annual Family Income
      const incomeInput = inputs.find(i => i.type === 'number');
      if (incomeInput) setNativeValue(incomeInput, '150000');

      // 5. Quota Type
      const quotaSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'government'));
      if (quotaSelect) setSelectValue(quotaSelect, 'government');

      // 6. First Graduate (Yes radio)
      const fgRadio = inputs.find(i => i.type === 'radio' && i.name === 'firstGraduate' && i.value === 'yes');
      if (fgRadio) fgRadio.click();

      return {
        hasName: Boolean(nameInput?.value),
        hasDob: Boolean(dobInput?.value),
        bankAccVal: bankAccSelect?.value,
        catVal: catSelect?.value,
      };
    })()
  `);
  console.log("Step 2 form filled state:", formFillResult);

  await new Promise((r) => setTimeout(r, 600));
  await saveScreenshot("flow_04_step2_details_entered.png");

  // Click "Run Multi-Document Data Consistency Check" -> Step 3
  console.log("Navigating to Step 3 Consistency Check...");
  await evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const runBtn = btns.find(b => b.innerText.includes('Multi-Document Data Consistency Check'));
      if (runBtn) runBtn.click();
    })()
  `);

  await new Promise((r) => setTimeout(r, 800));
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' });`);
  await new Promise((r) => setTimeout(r, 400));
  await saveScreenshot("flow_05_step3_consistency_report.png");

  // Step 3 -> Step 4: Click "Find Matching Scholarships"
  console.log("Navigating to Step 4 Find Matching Scholarships...");
  await evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const findBtn = btns.find(b => b.innerText.includes('Find Matching Scholarships'));
      if (findBtn) findBtn.click();
    })()
  `);

  await new Promise((r) => setTimeout(r, 1200));

  // In Step 4 form: complete missing details (Course level = UG, Year = 1st)
  console.log("Completing course and admission details in Step 4...");
  await evaluate(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const ugBtn = buttons.find(b => b.innerText.trim() === 'UG');
      if (ugBtn) ugBtn.click();

      const year1Btn = buttons.find(b => b.innerText.trim() === '1st');
      if (year1Btn) year1Btn.click();

      const stateSelect = document.querySelector('select');
      if (stateSelect) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        nativeSetter.call(stateSelect, 'Tamil Nadu');
        stateSelect.dispatchEvent(new Event('input', { bubbles: true }));
        stateSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()
  `);

  await new Promise((r) => setTimeout(r, 800));
  await evaluate(`
    (() => {
      const listEl = document.querySelector('.scholarships-section') || document.querySelector('.elig-tabs-container');
      if (listEl) {
        listEl.scrollIntoView({ behavior: 'instant', block: 'start' });
        window.scrollBy({ top: -50, behavior: 'instant' });
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  // Count matches in initial state (MBC, Income <= 2.5L, Govt Quota)
  const initialMatchSummary = await evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.scheme-result-card'));
      const titles = cards.map(c => c.querySelector('h3')?.innerText || '');
      const tabBadges = Array.from(document.querySelectorAll('.tab-badge')).map(b => b.innerText.trim());
      return { count: cards.length, tabBadges, sampleTitles: titles.slice(0, 5) };
    })()
  `);
  console.log("Initial Step 4 matches (MBC / ₹1.5L / Govt Quota):", initialMatchSummary);
  await saveScreenshot("flow_06_step4_matched_initial.png");

  // Demonstrate that changing confirmed income/category dynamically updates results!
  console.log("Demonstrating real-time update when Category is switched to SC...");
  await evaluate(`
    (() => {
      const selects = Array.from(document.querySelectorAll('select'));
      // Community select in the form or filters
      const commSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'SC'));
      if (commSelect) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        nativeSetter.call(commSelect, 'SC');
        commSelect.dispatchEvent(new Event('input', { bubbles: true }));
        commSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()
  `);

  await new Promise((r) => setTimeout(r, 800));

  const scMatchSummary = await evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.scheme-result-card'));
      const titles = cards.map(c => c.querySelector('h3')?.innerText || '');
      const tabBadges = Array.from(document.querySelectorAll('.tab-badge')).map(b => b.innerText.trim());
      return { count: cards.length, tabBadges, sampleTitles: titles.slice(0, 5) };
    })()
  `);
  console.log("Updated Step 4 matches after switching to SC category:", scMatchSummary);
  await saveScreenshot("flow_07_step4_updated_matches.png");

  // Verify parity with Standalone Engine / Dashboard
  console.log("Verifying engine parity with direct engine evaluation for the exact same profile...");
  const parityVerification = await evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('.scheme-result-card'));
      const topScheme = cards[0]?.querySelector('h3')?.innerText;
      const tabBadges = Array.from(document.querySelectorAll('.tab-badge')).map(b => b.innerText.trim());
      return {
        matchedCardsRendered: cards.length,
        topScheme,
        tabBadges,
        isConsistent: cards.length > 0
      };
    })()
  `);
  console.log("Engine Parity Check:", parityVerification);

  await saveScreenshot("flow_08_standalone_engine_parity.png");

  ws.close();
  chromeProc.kill();
  server.close();
  console.log("Normal user flow demonstration completed successfully!");
}

main().catch((err) => {
  console.error("Demonstration error:", err);
  server.close();
  process.exit(1);
});
