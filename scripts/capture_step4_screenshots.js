const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 5188;
const CDP_PORT = 9238;
const ROOT_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT_DIR, "build");
const ARTIFACT_DIR = "C:\\Users\\Nithishkumar M\\.gemini\\antigravity-ide\\brain\\404245f0-139c-4b3a-8a3e-f81628694426";
const TEST_FIXTURES_DIR = path.join(ROOT_DIR, "test_fixtures");

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

const server = http.createServer((req, res) => {
  const relPath = req.url.split("?")[0].replace(/^\/+/, "");
  let filePath = path.join(BUILD_DIR, relPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(BUILD_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

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
    `--user-data-dir=${path.join(ROOT_DIR, "scratch", "chrome_step4_final")}`,
    `http://localhost:${PORT}/documents?demo=1&step=4`,
  ]);

  let pageTarget = null;
  for (let i = 0; i < 30; i++) {
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

  console.log("Navigating to Step 4...");
  await send("Page.navigate", { url: `http://localhost:${PORT}/documents?demo=1&step=4` });

  // Wait for React and Step 4 elements to mount
  for (let i = 0; i < 30; i++) {
    const isReady = await evaluate(`Boolean(document.querySelector('.compact-profile-form') || document.querySelector('.eligibility-page'))`);
    if (isReady) {
      console.log(`Step 4 ready in ${(i + 1) * 200}ms`);
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Scroll to show Stepper, Header, and Complete Your Profile card
  await evaluate(`
    (() => {
      window.scrollTo({ top: 80, behavior: 'instant' });
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  // Screenshot 1: Step 4 Missing Information "Complete your profile" form
  console.log("Capturing Step 4 missing information form screenshot...");
  const shot1 = await send("Page.captureScreenshot", { format: "png" });
  const shot1BrainPath = path.join(ARTIFACT_DIR, "step4_complete_profile_form.png");
  const shot1FixturesPath = path.join(TEST_FIXTURES_DIR, "step4_complete_profile_form.png");
  fs.writeFileSync(shot1BrainPath, Buffer.from(shot1.data, "base64"));
  fs.writeFileSync(shot1FixturesPath, Buffer.from(shot1.data, "base64"));
  console.log(`Saved screenshot 1: ${shot1BrainPath}`);

  // Now complete the missing fields
  console.log("Filling missing fields in Complete your profile form...");
  await evaluate(`
    (() => {
      // Click UG course pill button
      const buttons = Array.from(document.querySelectorAll('button'));
      const ugBtn = buttons.find(b => b.innerText.trim() === 'UG');
      if (ugBtn) ugBtn.click();

      // Click 1st Year pill button
      const year1Btn = buttons.find(b => b.innerText.trim() === '1 Year');
      if (year1Btn) year1Btn.click();

      // Set Domicile State to Tamil Nadu
      const stateSelect = document.querySelector('select');
      if (stateSelect) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        nativeSetter.call(stateSelect, 'Tamil Nadu');
        stateSelect.dispatchEvent(new Event('input', { bubbles: true }));
        stateSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Click Govt Quota pill button
      const govtQuotaBtn = buttons.find(b => b.innerText.trim() === 'Govt Quota');
      if (govtQuotaBtn) govtQuotaBtn.click();

      // Click First Graduate Yes pill button
      const fgBtn = buttons.find(b => b.innerText.trim() === 'Yes');
      if (fgBtn) fgBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  // Expand the first matched scheme to show checklist & requirements
  console.log("Expanding first matched scholarship card...");
  await evaluate(`
    (() => {
      const expandBtn = document.querySelector('.btn-view-reqs');
      if (expandBtn) expandBtn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  // Scroll to the scholarship results section
  await evaluate(`
    (() => {
      const listEl = document.querySelector('.scholarships-section');
      if (listEl) {
        listEl.scrollIntoView({ behavior: 'instant', block: 'start' });
        window.scrollBy({ top: -60, behavior: 'instant' });
      }
    })()
  `);
  await new Promise((r) => setTimeout(r, 600));

  // Screenshot 2: Matched Schemes with 3-tab layout, status badges, and expandable checklist
  console.log("Capturing Step 4 matched schemes screenshot...");
  const shot2 = await send("Page.captureScreenshot", { format: "png" });
  const shot2BrainPath = path.join(ARTIFACT_DIR, "step4_matched_scholarships.png");
  const shot2FixturesPath = path.join(TEST_FIXTURES_DIR, "step4_matched_scholarships.png");
  fs.writeFileSync(shot2BrainPath, Buffer.from(shot2.data, "base64"));
  fs.writeFileSync(shot2FixturesPath, Buffer.from(shot2.data, "base64"));
  console.log(`Saved screenshot 2: ${shot2BrainPath}`);

  ws.close();
  chromeProc.kill();
  server.close();
  console.log("Screenshots captured successfully!");
}

main().catch((err) => {
  console.error("Screenshot error:", err);
  server.close();
  process.exit(1);
});
