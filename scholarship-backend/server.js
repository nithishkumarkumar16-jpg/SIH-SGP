const path = require("path");
const fileEnv = require("dotenv").config({ path: path.join(__dirname, ".env") }).parsed || {};
const crypto = require("crypto");
const cors = require("cors");
const express = require("express");
const rateLimit = require("express-rate-limit");

const envValue = (name) => {
  const runtime = process.env[name];
  return (typeof runtime === "string" && runtime.trim()) ? runtime.trim() : (fileEnv[name] || "").trim();
};
const isPlaceholder = (value) => !value || /^(?:replace[-_ ]?with|your[-_ ]?|example|changeme|placeholder|<.*>)\b/i.test(value.trim());
const IS_PRODUCTION = envValue("NODE_ENV") === "production";
const TEST_MODE = process.env.UNLIMITED_AI_TEST_MODE === "true";
if (IS_PRODUCTION && TEST_MODE) throw new Error("UNLIMITED_AI_TEST_MODE cannot be enabled in production");
const PORT = Number(envValue("PORT") || 5000);
const GROQ_API_KEY = envValue("GROQ_API_KEY");
const RECAPTCHA_ENTERPRISE_PROJECT_ID = envValue("RECAPTCHA_ENTERPRISE_PROJECT_ID");
const RECAPTCHA_ENTERPRISE_API_KEY = envValue("RECAPTCHA_ENTERPRISE_API_KEY");
const RECAPTCHA_ENTERPRISE_SITE_KEY = envValue("RECAPTCHA_ENTERPRISE_SITE_KEY");
const RECAPTCHA_ENTERPRISE_ACTION = "create_session";
const RECAPTCHA_ENTERPRISE_MIN_SCORE = Number(envValue("RECAPTCHA_ENTERPRISE_MIN_SCORE") || "0.5");
const GROQ_MODEL = envValue("GROQ_MODEL") || "qwen/qwen3.6-27b";
const ORIGINS = (envValue("ALLOWED_ORIGINS") || "http://localhost:3000,http://localhost:5173").split(",").map(x => x.trim()).filter(Boolean);
if (IS_PRODUCTION && (isPlaceholder(GROQ_API_KEY) || isPlaceholder(RECAPTCHA_ENTERPRISE_PROJECT_ID) || isPlaceholder(RECAPTCHA_ENTERPRISE_API_KEY) || isPlaceholder(RECAPTCHA_ENTERPRISE_SITE_KEY) || !ORIGINS.some(x => x === "https://sgp-scholarship.pages.dev"))) throw new Error("Production requires Groq, reCAPTCHA Enterprise credentials, and the production HTTPS origin");
const CAPTCHA_HOSTNAMES = ORIGINS.map(origin => { try { return new URL(origin).hostname; } catch { return null; } }).filter(Boolean);

const { connectDB } = require("./db");
const authRoutes = require("./routes/authRoutes");
const studentRoutes = require("./routes/studentRoutes");
const collegeRoutes = require("./routes/collegeRoutes");
const ministryRoutes = require("./routes/ministryRoutes");
const externalPortalRoutes = require("./routes/externalPortalRoutes");
const commonRoutes = require("./routes/commonRoutes");

const TTL = 15 * 60 * 1000, MAX_USES = 10, MAX_IPS = 10000, WINDOW = 15 * 60 * 1000;
const sessions = new Map(), ipHits = new Map();
function ip(req) { return process.env.TRUST_CLOUDFLARE === "true" ? (req.get("CF-Connecting-IP") || req.socket.remoteAddress || "unknown") : (req.socket.remoteAddress || "unknown"); }
function clean() { const now = Date.now(); for (const [k,v] of sessions) if (v.expiresAt <= now) sessions.delete(k); for (const [k,v] of ipHits) if (v.expiresAt <= now) ipHits.delete(k); }
setInterval(clean, 60000).unref();
function blocked(address) { if (TEST_MODE) return false; clean(); const now=Date.now(), old=ipHits.get(address); if (!old && ipHits.size >= MAX_IPS) return true; const item=!old || old.expiresAt<=now ? {count:1,expiresAt:now+WINDOW} : {...old,count:old.count+1}; ipHits.set(address,item); return item.count>40; }
const EMAIL_USER = envValue("EMAIL_USER");
const EMAIL_PASS = envValue("EMAIL_PASS");
const REPORT_RECIPIENT_EMAIL = envValue("REPORT_RECIPIENT_EMAIL") || EMAIL_USER;

function createApp(options = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_, res, next) => { res.set({ "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()" }); next(); });
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || ORIGINS.includes(origin)), methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "x-session-token", "Authorization"] }));
  app.use(express.json({ limit: "256kb", strict: true }));

  const rateConfig = options.rateLimit || {};
  const rateLimitEnabled = rateConfig.enabled !== false;

  const apiLimiter = rateLimit({
    windowMs: rateConfig.apiWindowMs || WINDOW,
    max: rateConfig.apiMax || 1500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
  });

  const loginLimiter = rateLimit({
    windowMs: rateConfig.loginWindowMs || 15 * 60 * 1000,
    max: rateConfig.loginMax || 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const retryAfter = req.rateLimit?.resetTime
        ? Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000))
        : 60;
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({
        error: `Too many login attempts. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      });
    },
  });

  if (rateLimitEnabled) {
    app.use("/api", apiLimiter);
    app.use("/api/auth/login", loginLimiter);
    app.use("/api/auth/register", loginLimiter);
  }

  const limiter = (max = 30, message = "Too many requests.") =>
    rateLimitEnabled
      ? rateLimit({
          windowMs: rateConfig.endpointWindowMs || 15 * 60 * 1000,
          max: rateConfig.endpointMax || max,
          standardHeaders: true,
          legacyHeaders: false,
          message: { error: message },
        })
      : (_, __, next) => next();

function esc(value) { return String(value || "").replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[x]); }
function report(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const allowed = ["name", "email", "issueType", "message", "rating", "comment", "captchaToken"];
  if (Object.keys(body).some(k => !allowed.includes(k))) return null;
  const { name = "", email = "", issueType = "", message = "", rating = 0, comment = "", captchaToken = "" } = body;
  if (typeof name !== "string" || name.length > 100) return null;
  if (typeof email !== "string" || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  if (typeof issueType !== "string" || issueType.length > 100) return null;
  if (typeof message !== "string" || message.length > 4000) return null;
  if (typeof comment !== "string" || comment.length > 4000) return null;
  const ratingNum = Number(rating);
  if (!Number.isFinite(ratingNum) || ratingNum < 0 || ratingNum > 5) return null;
  if (typeof captchaToken !== "string" || captchaToken.length < 20 || captchaToken.length > 4096) return null;
  if (!name.trim() && !email.trim() && !issueType.trim() && !message.trim() && !comment.trim() && ratingNum === 0) return null;
  return {
    name: name.trim(),
    email: email.trim(),
    issueType: issueType.trim(),
    message: message.trim(),
    comment: comment.trim(),
    rating: ratingNum,
    captchaToken: captchaToken.trim()
  };
}
function requireSession(req,res,next) { clean(); const token=req.get("x-session-token"), session=token&&sessions.get(token); if (!session || session.expiresAt<=Date.now() || session.ip!==ip(req)) { if(token) sessions.delete(token); return res.status(401).json({error:"Invalid or expired session."}); } if (!TEST_MODE && session.uses>=MAX_USES) return res.status(429).json({error:"Session request limit reached."}); session.uses++; next(); }
function enterpriseConfigured() { return ![RECAPTCHA_ENTERPRISE_PROJECT_ID, RECAPTCHA_ENTERPRISE_API_KEY, RECAPTCHA_ENTERPRISE_SITE_KEY].some(isPlaceholder); }
async function verifyEnterpriseCaptcha(token, req, expectedAction = null) {
  if (!enterpriseConfigured()) return { ok: false, status: 503, error: "CAPTCHA is not configured." };
  try {
    const project = encodeURIComponent(RECAPTCHA_ENTERPRISE_PROJECT_ID);
    const apiKey = encodeURIComponent(RECAPTCHA_ENTERPRISE_API_KEY);
    const r = await fetch(`https://recaptchaenterprise.googleapis.com/v1/projects/${project}/assessments?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: { token, siteKey: RECAPTCHA_ENTERPRISE_SITE_KEY, userAgent: req.get("User-Agent") || "", userIpAddress: ip(req) } }),
      signal: AbortSignal.timeout(10000),
    });
    const assessment = await r.json().catch(() => null);
    const properties = assessment?.tokenProperties;
    const score = assessment?.riskAnalysis?.score !== undefined ? Number(assessment.riskAnalysis.score) : 1.0;
    console.log(JSON.stringify({ captcha: "enterprise-assessment", tokenReceived: true, assessmentRequest: true, assessmentHttpStatus: r.status, tokenPropertiesValid: properties?.valid === true, tokenPropertiesHostname: properties?.hostname || null, tokenPropertiesAction: properties?.action || null, invalidReason: properties?.invalidReason || null }));
    if (!r.ok || !properties?.valid || (expectedAction && properties.action && properties.action !== expectedAction) || !CAPTCHA_HOSTNAMES.includes(properties.hostname) || !Number.isFinite(score) || score < RECAPTCHA_ENTERPRISE_MIN_SCORE) return { ok: false, status: 403, error: "CAPTCHA verification failed." };
    return { ok: true };
  } catch (error) { console.log(JSON.stringify({ captcha: "enterprise-assessment", tokenReceived: true, assessmentRequest: false, assessmentHttpStatus: null, error: error?.name || "unknown" })); return { ok: false, status: 503, error: "Verification is unavailable." }; }
}

app.get("/", (_,res)=>res.json({status:"SGP backend running"}));
app.post("/api/session/create", limiter(10,"Too many verification attempts."), async (req,res) => { const address=ip(req), token=req.body?.captchaToken; if(blocked(address)) return res.status(429).json({error:"Too many requests."}); if(typeof token!=="string" || token.length<20 || token.length>4096) { console.log(JSON.stringify({captcha:"enterprise-assessment",tokenReceived:false,assessmentRequest:false})); return res.status(400).json({error:"CAPTCHA token required."}); } if(IS_PRODUCTION && !enterpriseConfigured()) return res.status(503).json({error:"CAPTCHA is not configured."}); if(!enterpriseConfigured()) return res.status(503).json({error:"CAPTCHA is not configured."}); const verification = await verifyEnterpriseCaptcha(token, req, RECAPTCHA_ENTERPRISE_ACTION); if (!verification.ok) return res.status(verification.status).json({error:verification.error}); const sessionToken=crypto.randomBytes(32).toString("hex"); sessions.set(sessionToken,{ip:address,issuedAt:Date.now(),expiresAt:Date.now()+TTL,uses:0}); res.json({sessionToken,expiresIn:TTL/1000}); });

app.post("/api/send-report", limiter(10,"Too many reports."), async (req,res) => {
  const address = ip(req);
  if (blocked(address)) return res.status(429).json({ error: "Too many requests." });

  const data = report(req.body);
  if (!data) return res.status(400).json({ error: "Invalid report data." });

  if (IS_PRODUCTION && !enterpriseConfigured()) return res.status(503).json({ error: "CAPTCHA is not configured." });
  if (enterpriseConfigured()) {
    const verification = await verifyEnterpriseCaptcha(data.captchaToken, req);
    if (!verification.ok) return res.status(verification.status).json({ error: verification.error });
  } else if (!IS_PRODUCTION) {
    if (data.captchaToken !== "local-dev-mock-captcha-token") {
      return res.status(403).json({ error: "CAPTCHA verification failed." });
    }
  } else {
    return res.status(503).json({ error: "CAPTCHA is not configured." });
  }

  if (!EMAIL_USER || isPlaceholder(EMAIL_USER) || !EMAIL_PASS || isPlaceholder(EMAIL_PASS)) {
    return res.status(503).json({ error: "Email service is not configured on the server. Set EMAIL_USER and EMAIL_PASS in the backend environment." });
  }

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    });

    const ratingStr = data.rating > 0 ? `${data.rating}/5 Stars (${"★".repeat(data.rating)}${"☆".repeat(5 - data.rating)})` : "";

    const mailOptions = {
      from: `"SGP Feedback & Reports" <${EMAIL_USER}>`,
      to: REPORT_RECIPIENT_EMAIL,
      subject: `[SGP Report] ${data.issueType || "Feedback"}${data.rating > 0 ? ` (${data.rating}/5 ★)` : ""}`,
      replyTo: data.email || undefined,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #311161; margin: 0 0 16px;">SGP Student Report &amp; Feedback</h2>
          <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #311161;">
            <p style="margin: 4px 0;"><strong>Name:</strong> ${esc(data.name || "Anonymous")}</p>
            <p style="margin: 4px 0;"><strong>Email:</strong> ${data.email ? `<a href="mailto:${esc(data.email)}">${esc(data.email)}</a>` : "Not provided"}</p>
            <p style="margin: 4px 0;"><strong>Issue Type:</strong> ${esc(data.issueType || "Not specified")}</p>
            ${ratingStr ? `<p style="margin: 4px 0;"><strong>Rating:</strong> ${esc(ratingStr)}</p>` : ""}
          </div>
          ${data.message ? `<div style="margin-bottom: 16px;"><h4 style="margin: 0 0 8px; color: #1e293b;">Issue Description:</h4><div style="background: #f1f5f9; padding: 12px; border-radius: 6px; white-space: pre-wrap; font-size: 14px; line-height: 1.5;">${esc(data.message)}</div></div>` : ""}
          ${data.comment ? `<div style="margin-bottom: 16px;"><h4 style="margin: 0 0 8px; color: #1e293b;">Review / Experience Comments:</h4><div style="background: #f1f5f9; padding: 12px; border-radius: 6px; white-space: pre-wrap; font-size: 14px; line-height: 1.5;">${esc(data.comment)}</div></div>` : ""}
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #64748b; margin: 0;">Submitted via Scholarship Guidance Platform (SGP) Pre-Submission Portal</p>
        </div>
      `,
      text: `
SGP Student Report & Feedback
========================================
Name: ${data.name || "Anonymous"}
Email: ${data.email || "Not provided"}
Issue Type: ${data.issueType || "Not specified"}
${ratingStr ? `Rating: ${ratingStr}\n` : ""}${data.message ? `\nIssue Description:\n${data.message}\n` : ""}${data.comment ? `\nReview Comments:\n${data.comment}\n` : ""}
========================================
Submitted via Scholarship Guidance Platform (SGP)
      `.trim(),
    };

    await transporter.sendMail(mailOptions);
    return res.json({ message: "Report sent successfully. Thank you for your feedback." });
  } catch (err) {
    console.error("Nodemailer sendMail error:", err?.name || "SMTPError");
    return res.status(503).json({ error: "Failed to send email. Please verify server SMTP configuration." });
  }
});

// Only a small, non-sensitive text summary is accepted. Images, OCR text, blobs, base64 and IDs are never forwarded to Groq.
const FORBIDDEN_AI_SUMMARY = /(?:data:|base64|\bblob:|%pdf-|application\/(?:pdf|octet-stream)|image\/(?:png|jpe?g|webp|gif)|https?:\/\/\S+\.(?:png|jpe?g|webp|gif|pdf)(?:\?\S*)?|aadhaar|certificate\s*(?:no|number)|\b\d{12}\b)/i;
app.post("/api/groq", limiter(10,"Too many AI requests."), requireSession, async (req,res) => { const {task,summary}=req.body||{}; if(Object.keys(req.body||{}).length!==2 || task!=="explain" || typeof summary!=="string" || summary.length<1 || summary.length>800 || FORBIDDEN_AI_SUMMARY.test(summary)) return res.status(400).json({error:"Invalid AI request."}); if(!GROQ_API_KEY)return res.status(503).json({error:"AI service is unavailable."}); try { const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({model:GROQ_MODEL,max_tokens:300,temperature:.2,messages:[{role:"system",content:"Explain only the supplied non-sensitive scholarship status in plain language."},{role:"user",content:summary}]})}); const data=await r.json().catch(()=>null), explanation=data?.choices?.[0]?.message?.content; if(!r.ok||typeof explanation!=="string"||explanation.length>3000)return res.status(502).json({error:"AI service is unavailable."}); res.json({explanation}); } catch { res.status(502).json({error:"AI service is unavailable."}); } });
// Mount Role-Based & SGP API Routes
app.use("/api/auth", authRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/college", collegeRoutes);
app.use("/api/ministry", ministryRoutes);
app.use("/api/applications", externalPortalRoutes);
app.use("/api/external-portal", externalPortalRoutes);
app.use("/api/common", commonRoutes);

  app.use((err,_,res,__)=>res.status(err?.type==="entity.parse.failed"?400:500).json({error:"Invalid request."}));

  return app;
}

const app = createApp();

if (require.main === module) {
  connectDB().then(() => {
    app.listen(PORT, () => console.log(`SGP role-based backend listening on ${PORT}`));
  }).catch((err) => {
    console.error("MongoDB startup failed:", err.message);
    app.listen(PORT, () => console.log(`SGP backend listening on ${PORT} (Database offline)`));
  });
}

module.exports = { app, createApp };
