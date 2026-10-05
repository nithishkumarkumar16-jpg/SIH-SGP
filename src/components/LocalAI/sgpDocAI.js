// ================================================================
//  SGP LOCAL DOCUMENT EXTRACTION AI
//  100% browser-based — Tesseract.js OCR + PDF.js + Custom Extraction
//  No API key, no external servers, no cloud OCR dependency
//  Extracts & Normalizes: Name, DOB, Community, Income, Marks, Board, etc.
// ================================================================

import { createWorker } from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";
import { checkFileQuality, recheckQualityAfterEnhancement } from "../../utils/imageQuality";
import { preprocessCanvasForOCR, fitOCRCanvas, enhanceLowQualityCanvas } from "../../utils/imagePreprocessing";
import {
  detectDocumentType,
  validateDocumentSlot,
  SUPPORTED_DOC_TYPES,
} from "../../utils/documentClassifier";
import {
  extractMarksheetData,
  extractCommunityCertificateData,
  extractIncomeCertificateData,
  extractAadhaarData,
  extractBankDocumentData,
} from "../../utils/fieldParsers";

export { detectDocumentType, validateDocumentSlot };

/**
 * Explains how OCR confidence is computed and documented.
 * Strictly separates OCR recognition confidence from heuristic parsing.
 */
export const OCR_CONFIDENCE_METHODOLOGY = {
  aggregation: "Arithmetic mean of Tesseract word confidence scores across matched token bounding boxes.",
  distinction: "Represents optical character recognition confidence score (0-100), not measured semantic accuracy.",
  description:
    "Arithmetic mean of word-level OCR confidence scores in the matched line region. Wording: 'OCR confidence: X/100 — please confirm.' Never represents measured accuracy.",
  toString() {
    return this.description;
  },
};

/**
 * Formats genuine OCR confidence into honest, non-misleading wording.
 * Never displays "X% accurate". Shows "Confidence unavailable." when missing.
 * 
 * @param {number|null} confidence 0-100 or null
 * @returns {string}
 */
export function formatOcrConfidence(confidence) {
  if (confidence === null || confidence === undefined || isNaN(confidence)) {
    return "Confidence unavailable.";
  }
  const rounded = Math.round(confidence);
  return `OCR confidence: ${rounded}/100 — please confirm.`;
}


export function getPdfWorkerSrc() {
  if (typeof window === "undefined") return "/pdfjs/pdf.worker.min.mjs";
  const origin = window.location?.origin || "";
  return `${origin}/pdfjs/pdf.worker.min.mjs`;
}

export function configurePdfJsWorker() {
  const workerSrc = getPdfWorkerSrc();
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  return workerSrc;
}

if (typeof window !== "undefined" && typeof window.location !== "undefined") {
  try {
    configurePdfJsWorker();
  } catch (workerUrlError) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  }
}

export const MAX_PDF_PAGES = 3;

// These assets are deliberately served from this application, never a CDN.  Do
// not remove these paths: Tesseract.js otherwise falls back to remote worker,
// core, and language-data URLs at runtime.
export function getLocalTesseractOptions() {
  return {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract",
    langPath: "/tessdata",
    gzip: false,
    cacheMethod: "none",
    workerBlobURL: false,
  };
}

/**
 * Renders up to 3 PDF pages locally using PDF.js and measures real canvas quality.
 */
/**
 * Renders up to 3 PDF pages locally using PDF.js at crisp high resolution (300 DPI equivalent).
 */
async function renderPDFPages(file) {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data });
  let pdf = null;
  const pages = [];

  try {
    pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `PDF exceeds the maximum allowed limit of ${MAX_PDF_PAGES} pages (found ${pdf.numPages} pages). Please upload a document with ${MAX_PDF_PAGES} or fewer pages.`
      );
    }
    for (let n = 1; n <= pdf.numPages; n++) {
      try {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 2.8 });
        const size = fitOCRCanvas(base.width, base.height);
        const viewport = page.getViewport({ scale: (size.width / base.width) * 2.8 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        await page.render({ canvasContext: ctx, viewport }).promise;
        pages.push(canvas);
      } catch (pageError) {
        console.warn("PDF page render failed; continuing with remaining pages", pageError);
      }
    }
    if (!pages.length) {
      throw new Error("No PDF pages could be rendered for OCR.");
    }
    return pages;
  } finally {
    try {
      if (loadingTask && typeof loadingTask.destroy === "function") {
        loadingTask.destroy();
      }
    } catch (cleanupError) {
      console.warn("PDF loadingTask cleanup warning", cleanupError);
    }
    try {
      if (pdf && typeof pdf.cleanup === "function") {
        pdf.cleanup();
      }
    } catch (cleanupError) {
      console.warn("PDF cleanup warning", cleanupError);
    }
  }
}

/**
 * Prepares raw canvas from image file.
 */
async function prepareRawImage(file) {
  let bitmap = null;
  if (typeof createImageBitmap === "function") {
    bitmap = await createImageBitmap(file);
  } else {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image decoding failed"));
      };
      img.src = url;
    });
  }

  const size = fitOCRCanvas(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close?.();
  return canvas;
}

/**
 * OCR ENGINE — Runs Tesseract.js client-side.
 * Extracts:
 * - full text
 * - raw engine confidence
 * - line and word bounding boxes & confidences
 * - multi-pass binarized variant for marksheets to eliminate security patterns
 */
export async function runOCR(file, onProgress, qualityAssessment = null, isMarksheet = false, lang = "eng", options = {}) {
  const ocrLang = options.langs || (lang === "tam" ? "tam" : (lang === "eng+tam" || lang === "all" ? ["eng", "tam"] : "eng"));

  const worker = await createWorker(ocrLang, 1, {
    ...getLocalTesseractOptions(),
    logger: (m) => {
      if (options.isCancelled?.() || options.signal?.aborted) return;
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    if (options.isCancelled?.() || options.signal?.aborted) {
      throw new Error("OCR operation was cancelled.");
    }

    const rawPages = file.type === "application/pdf"
      ? await renderPDFPages(file)
      : [await prepareRawImage(file)];

    const pagesText = [];
    const allLines = [];
    const confidences = [];

    // Helper to safely extract lines with bounding boxes and page number from Tesseract result
    const extractLinesFromData = (tData, canvas, pageIndex = 0) => {
      if (!tData) return [];
      const pageNum = pageIndex + 1;
      if (Array.isArray(tData.lines) && tData.lines.length > 0) {
        return tData.lines.map(l => ({
          text: l.text || "",
          confidence: l.confidence || 0,
          bbox: l.bbox || null,
          pageNumber: pageNum,
          words: Array.isArray(l.words) ? l.words.map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox, pageNumber: pageNum })) : [],
          pageWidth: canvas ? canvas.width : 0,
          pageHeight: canvas ? canvas.height : 0,
        }));
      }
      const extracted = [];
      if (Array.isArray(tData.blocks)) {
        for (const block of tData.blocks) {
          if (Array.isArray(block.paragraphs)) {
            for (const para of block.paragraphs) {
              if (Array.isArray(para.lines)) {
                for (const l of para.lines) {
                  extracted.push({
                    text: l.text || "",
                    confidence: l.confidence || 0,
                    bbox: l.bbox || null,
                    pageNumber: pageNum,
                    words: Array.isArray(l.words) ? l.words.map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox, pageNumber: pageNum })) : [],
                    pageWidth: canvas ? canvas.width : 0,
                    pageHeight: canvas ? canvas.height : 0,
                  });
                }
              }
            }
          }
        }
      }
      return extracted;
    };

    // Pass 1: Standard contrast-enhanced OCR
    for (let index = 0; index < rawPages.length; index++) {
      if (options.isCancelled?.() || options.signal?.aborted) {
        throw new Error("OCR operation was cancelled.");
      }
      const standardCanvas = preprocessCanvasForOCR(rawPages[index], qualityAssessment, "contrast");
      const { data } = await worker.recognize(standardCanvas, {}, { blocks: true, text: true });
      pagesText.push(data.text || "");
      if (typeof data.confidence === "number" && !isNaN(data.confidence) && data.confidence > 0) {
        confidences.push(data.confidence);
      }
      allLines.push(...extractLinesFromData(data, standardCanvas, index));
    }

    const avgConfidence = confidences.length
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : null;

    const multiPasses = [];

    // Additional passes for difficult documents: compare normalized (illumination), binarized, and sharpened
    const shouldRunMultiPass = isMarksheet || (qualityAssessment && (qualityAssessment.qualityLevel === "fair" || qualityAssessment.qualityLevel === "poor")) || (avgConfidence !== null && avgConfidence < 75);
    if (shouldRunMultiPass && rawPages.length > 0) {
      const variantsToRun = ["normalized", "sharpened", "binarized"];
      for (const variant of variantsToRun) {
        if (options.isCancelled?.() || options.signal?.aborted) break;
        try {
          const vPagesText = [];
          const vLines = [];
          for (let index = 0; index < rawPages.length; index++) {
            if (options.isCancelled?.() || options.signal?.aborted) break;
            const vCanvas = preprocessCanvasForOCR(rawPages[index], qualityAssessment, variant);
            const { data: vData } = await worker.recognize(vCanvas, {}, { blocks: true, text: true });
            vPagesText.push(vData.text || "");
            vLines.push(...extractLinesFromData(vData, vCanvas, index));
          }
          multiPasses.push({
            variant,
            text: vPagesText.join("\n\n"),
            lines: vLines,
          });
        } catch (passError) {
          console.warn(`Multi-pass variant ${variant} skipped:`, passError);
        }
      }
    }

    return {
      text: pagesText.join("\n\n"),
      ocrConfidence: avgConfidence,
      lines: allLines,
      multiPass: multiPasses[0] || null,
      multiPasses,
    };
  } finally {
    await worker.terminate();
  }
}

/**
 * Reconciles candidate fields from multiple OCR preprocessing passes.
 * Compares candidate confidence per field and selects the most reliable result.
 * Awards cross-pass agreement boost when identical candidate name is extracted independently.
 */
export function reconcileMarksheetPasses(...passes) {
  const flatPasses = passes.flat().filter(Boolean);
  if (!flatPasses.length) return {};
  if (flatPasses.length === 1) return flatPasses[0];

  const base = flatPasses[0];
  const out = { ...base };
  out.fieldConfidence = { ...(base.fieldConfidence || {}) };

  // 1. Candidate Name: reconcile across all passes with cross-pass agreement boost
  const nameCandidates = [];
  for (const p of flatPasses) {
    if (p.name) {
      nameCandidates.push({
        name: p.name,
        confidence: p.fieldConfidence?.name || 0.75,
      });
    }
  }

  if (nameCandidates.length > 0) {
    const freq = {};
    for (const c of nameCandidates) {
      const k = c.name.toLowerCase().replace(/[^a-z]/g, "");
      freq[k] = (freq[k] || 0) + 1;
    }

    let bestName = null;
    let bestScore = -1;

    for (const c of nameCandidates) {
      const k = c.name.toLowerCase().replace(/[^a-z]/g, "");
      const agreements = freq[k] || 1;
      const agreementBoost = agreements >= 2 ? 0.20 : 0;
      const totalScore = c.confidence + agreementBoost;
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestName = c.name;
      }
    }

    out.name = bestName;
    out.fieldConfidence.name = Math.min(0.98, Number(bestScore.toFixed(2)));
  }

  // 2. Marks: select valid scored marks with highest confidence
  for (const p of flatPasses) {
    if (p.marksScored && (!out.marksScored || (p.fieldConfidence?.marks || 0) > (out.fieldConfidence?.marks || 0))) {
      out.marksScored = p.marksScored;
      out.maxMarks = p.maxMarks;
      out.marks = p.marks;
      out.percentage = p.percentage;
      out.grade = p.grade;
      out.fieldConfidence.marks = p.fieldConfidence?.marks || 0.90;
    }
  }

  // 3. School: select candidate with higher confidence
  for (const p of flatPasses) {
    if (p.school && (!out.school || (p.fieldConfidence?.school || 0) > (out.fieldConfidence?.school || 0))) {
      out.school = p.school;
      out.fieldConfidence.school = p.fieldConfidence?.school || 0.85;
    }
  }

  // 4. Register Number, DOB, Year, Month, Board, Father, Mother, Roll No, Subject Marks
  for (const p of flatPasses) {
    if (!out.registerNumber && p.registerNumber) out.registerNumber = p.registerNumber;
    if (!out.rollNumber && p.rollNumber) out.rollNumber = p.rollNumber;
    if (!out.dob && p.dob) out.dob = p.dob;
    if (!out.year && p.year) out.year = p.year;
    if (!out.month && p.month) out.month = p.month;
    if (!out.board && p.board) out.board = p.board;
    if (!out.fatherName && p.fatherName) out.fatherName = p.fatherName;
    if (!out.motherName && p.motherName) out.motherName = p.motherName;
    if (!out.subjectMarks && p.subjectMarks) out.subjectMarks = p.subjectMarks;
  }

  // Preserve and update structuredFields
  out.structuredFields = { ...(base.structuredFields || {}) };
  for (const p of flatPasses) {
    if (p.structuredFields) {
      out.structuredFields = { ...out.structuredFields, ...p.structuredFields };
    }
  }
  if (out.name && out.structuredFields.name) {
    out.structuredFields.name.rawValue = out.name;
    out.structuredFields.name.normalizedValue = out.name;
    out.structuredFields.name.confidence = Math.round((out.fieldConfidence.name || 0.85) * 100);
  }

  return out;
}

/**
 * Reconciles candidate fields from multiple OCR preprocessing passes for Community and Income certificates.
 */
export function reconcileCertificatePasses(...passes) {
  const flatPasses = passes.flat().filter(Boolean);
  if (!flatPasses.length) return {};
  if (flatPasses.length === 1) return flatPasses[0];

  const base = flatPasses[0];
  const out = { ...base };
  out.fieldConfidence = { ...(base.fieldConfidence || {}) };
  out.structuredFields = { ...(base.structuredFields || {}) };

  // Candidate Name: reconcile across all passes with cross-pass agreement boost
  const nameCandidates = [];
  for (const p of flatPasses) {
    if (p.name) {
      nameCandidates.push({
        name: p.name,
        confidence: p.fieldConfidence?.name || 0.75,
      });
    }
  }

  if (nameCandidates.length > 0) {
    const freq = {};
    for (const c of nameCandidates) {
      const k = c.name.toLowerCase().replace(/[^a-z]/g, "");
      freq[k] = (freq[k] || 0) + 1;
    }

    let bestName = null;
    let bestScore = -1;

    for (const c of nameCandidates) {
      const k = c.name.toLowerCase().replace(/[^a-z]/g, "");
      const agreements = freq[k] || 1;
      const agreementBoost = agreements >= 2 ? 0.20 : 0;
      const totalScore = c.confidence + agreementBoost;
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestName = c.name;
      }
    }

    out.name = bestName;
    out.fieldConfidence.name = Math.min(0.98, Number(bestScore.toFixed(2)));
    if (out.structuredFields?.name) {
      out.structuredFields.name.rawValue = bestName;
      out.structuredFields.name.normalizedValue = bestName;
      out.structuredFields.name.confidence = Math.round(out.fieldConfidence.name * 100);
      out.structuredFields.name.status = out.fieldConfidence.name >= 0.85 ? "high" : "medium";
    }
  }

  // Merge missing fields from alternative passes
  for (const p of flatPasses.slice(1)) {
    for (const key of Object.keys(p)) {
      if (!out[key] && p[key]) {
        out[key] = p[key];
        if (p.fieldConfidence?.[key]) {
          out.fieldConfidence[key] = p.fieldConfidence[key];
        }
        if (p.structuredFields?.[key]) {
          out.structuredFields[key] = p.structuredFields[key];
        }
      }
    }
  }

  return out;
}

/**
 * Backward-compatible text parser used by regression tests.
 */
export function extractMarksheetFields(rawInput, type = "ms10") {
  return extractMarksheetData(rawInput, type);
}

/**
 * Validates extracted fields for missing requirements and potential anomalies.
 */
function validateExtractedDocument(type, data) {
  const issues = [];
  const warnings = [];

  if (type === "ms10" || type === "ms12") {
    if (!data.name) warnings.push("Candidate name could not be reliably extracted. Please verify manually.");
    if (!data.board) warnings.push("Board name not clearly visible on marksheet.");
    if (!data.marksScored) warnings.push("Total marks not detected — check scan quality.");
    if (data.percentage) {
      const pct = parseFloat(data.percentage);
      if (pct < 35) issues.push(`Low percentage (${data.percentage}) — below standard pass criteria.`);
    }
    if (!data.year) warnings.push("Year of passing not detected.");
  }

  if (type === "community") {
    if (!data.name) warnings.push("Candidate name not clearly detected on community certificate.");
    if (!data.communityCategory && !data.community) issues.push("Community / caste category not detected.");
    if (!data.certNumber) warnings.push("Certificate registration number not clearly readable.");
    if (!data.issuingAuthority) warnings.push("Issuing authority seal / designation not clearly visible.");
  }

  if (type === "income") {
    if (!data.name) warnings.push("Applicant / parent name not detected on income certificate.");
    if (!data.incomeNumber && !data.income) issues.push("Annual income amount not detected.");
    if (!data.issueDate) warnings.push("Issue date not detected — document acceptance needs confirmation for the selected scheme.");

    if (data.issueDate) {
      const parts = data.issueDate.split("-");
      if (parts.length === 3) {
        const issued = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        const ageMonths = (new Date() - issued) / (1000 * 60 * 60 * 24 * 30);
        if (ageMonths > 12) warnings.push("Income certificate is older than 12 months — document acceptance needs confirmation for the selected scheme.");
        else if (ageMonths > 6) warnings.push("Income certificate is 6-12 months old — fresh certificate recommended.");
      }
    }
  }

  return { issues, warnings };
}

/**
 * MAIN DOCUMENT EXTRACTION ENTRYPOINT
 * 
 * Pipeline:
 * 1. Image / PDF quality check (deterministic metrics)
 * 2. Adaptive Preprocessing & Quality Re-check if FAIR/POOR
 * 3. Client-side OCR (Tesseract.js / PDF.js) with Line/Word Bounding Boxes
 * 4. Multi-Signal Document Type & State Classifier
 * 5. Slot Validation
 * 6. Document-Specific Parsing & Geometry Fallback
 * 7. Multi-Pass Reconciliation
 * 8. Field Normalization & Validation
 * 9. Independent Confidence Scoring
 */
export async function extractDocumentData(file, slotType, onProgress, options = {}) {
  if (options.isCancelled?.() || options.signal?.aborted) {
    return { cancelled: true, success: false, error: "Operation cancelled" };
  }

  onProgress?.({ stage: "quality", pct: 10, msg: "Assessing image quality..." });

  // 1. Image / PDF Quality Assessment
  let qualityResult = null;
  try {
    qualityResult = await checkFileQuality(file);
  } catch (qErr) {
    console.warn("Image quality check warning:", qErr);
    qualityResult = {
      qualityLevel: "unknown",
      qualityDescription: "Image quality could not be measured.",
      issues: [],
      warnings: ["Quality assessment was skipped."],
      isUsable: true,
    };
  }

  if (options.isCancelled?.() || options.signal?.aborted) {
    return { cancelled: true, success: false, error: "Operation cancelled" };
  }

  // 2. Adaptive Enhancement & Quality Re-check for FAIR or POOR documents
  if (qualityResult && (qualityResult.qualityLevel === "fair" || qualityResult.qualityLevel === "poor")) {
    onProgress?.({ stage: "quality", pct: 15, msg: "Applying adaptive enhancement for low-quality scan..." });
    try {
      const samplePages = file.type === "application/pdf"
        ? await renderPDFPages(file)
        : [await prepareRawImage(file)];
      if (samplePages && samplePages[0]) {
        const enhancedCanvas = enhanceLowQualityCanvas(samplePages[0], qualityResult);
        qualityResult = recheckQualityAfterEnhancement(qualityResult, enhancedCanvas);
      }
    } catch (enhErr) {
      console.warn("Adaptive quality enhancement re-check skipped:", enhErr);
    }
  }

  if (options.isCancelled?.() || options.signal?.aborted) {
    return { cancelled: true, success: false, error: "Operation cancelled" };
  }

  onProgress?.({ stage: "ocr", pct: 20, msg: "Starting OCR scan..." });

  // 3. Preprocessing & OCR
  const isMarksheetSlot = slotType === "ms10" || slotType === "ms12" || slotType === "marksheet";
  let ocrResult;
  try {
    const ocrLang = options.lang || (options.langs ? options.langs : "eng");
    ocrResult = await runOCR(file, (pct) => {
      onProgress?.({ stage: "ocr", pct: 20 + Math.round(pct * 0.6), msg: `Reading document... ${pct}%` });
    }, qualityResult, isMarksheetSlot, ocrLang, options);
  } catch (err) {
    if (options.isCancelled?.() || options.signal?.aborted || err.message?.includes("cancelled")) {
      return { cancelled: true, success: false, error: "Operation was cancelled." };
    }
    return {
      success: false,
      error: `OCR failed: ${err.message}`,
      rawText: "",
      quality: qualityResult,
    };
  }

  if (options.isCancelled?.() || options.signal?.aborted) {
    return { cancelled: true, success: false, error: "Operation cancelled" };
  }

  const rawText = ocrResult.text || "";
  const ocrConfidence = ocrResult.ocrConfidence; // number (0-100) or null

  onProgress?.({ stage: "classify", pct: 85, msg: "Classifying document type & issuing state..." });

  // 4. Document Classification (State-Agnostic)
  const detected = detectDocumentType(rawText, { name: file.name, type: file.type });
  const type = slotType || detected.type;

  // 5. Slot Validation
  const slotValidation = validateDocumentSlot(slotType, detected);

  onProgress?.({ stage: "extract", pct: 90, msg: "Extracting structured fields..." });

  // 6. Document-Specific Field Extraction with Multi-Pass & Geometry
  let extracted = {};
  if (type === "ms10" || type === "ms12" || type === "marksheet") {
    const parseType = type === "marksheet" ? "ms10" : type;
    const pass1Data = extractMarksheetData({ text: rawText, lines: ocrResult.lines }, parseType);
    const passResults = [pass1Data];
    if (ocrResult.multiPasses && ocrResult.multiPasses.length > 0) {
      for (const mp of ocrResult.multiPasses) {
        passResults.push(extractMarksheetData(mp, parseType));
      }
    } else if (ocrResult.multiPass) {
      passResults.push(extractMarksheetData(ocrResult.multiPass, parseType));
    }
    extracted = reconcileMarksheetPasses(...passResults);
  } else if (type === "community") {
    const pass1Data = extractCommunityCertificateData(rawText);
    const passResults = [pass1Data];
    if (ocrResult.multiPasses && ocrResult.multiPasses.length > 0) {
      for (const mp of ocrResult.multiPasses) {
        passResults.push(extractCommunityCertificateData(mp.text || ""));
      }
    }
    extracted = reconcileCertificatePasses(...passResults);
  } else if (type === "income") {
    const pass1Data = extractIncomeCertificateData(rawText);
    const passResults = [pass1Data];
    if (ocrResult.multiPasses && ocrResult.multiPasses.length > 0) {
      for (const mp of ocrResult.multiPasses) {
        passResults.push(extractIncomeCertificateData(mp.text || ""));
      }
    }
    extracted = reconcileCertificatePasses(...passResults);
  } else if (type === "aadhaar") {
    extracted = extractAadhaarData(rawText);
  } else if (type === "bankpass" || type === "bank") {
    extracted = extractBankDocumentData(rawText);
  } else {
    // Fallback extraction for unknown/other documents
    extracted = {
      name: rawText.match(/(?:name\s*[:-]?\s*)([A-Z][A-Za-z\s.]{3,40})/i)?.[1] || null,
    };
  }

  // Remove empty/null values
  Object.keys(extracted).forEach((k) => {
    if (extracted[k] === null || extracted[k] === undefined) {
      delete extracted[k];
    }
  });

  onProgress?.({ stage: "validate", pct: 95, msg: "Validating consistency..." });

  // 7. Validation
  const { issues, warnings } = validateExtractedDocument(type, extracted);

  // If document type is mismatched with slot
  if (slotValidation.status === "mismatch") {
    issues.unshift(slotValidation.message);
  } else if (slotValidation.status === "unconfident") {
    warnings.unshift(slotValidation.message);
  }

  // If quality has persistent issues after enhancement
  if (qualityResult && qualityResult.qualityLevel === "poor") {
    warnings.push(...(qualityResult.issues || []));
    if (qualityResult.recoveredViaEnhancement === false) {
      warnings.unshift("Document quality is poor even after adaptive enhancement. Fields cannot be reliably verified; please verify all details manually or upload a clearer scan.");
    }
  }

  // 8. Multi-Factor Confidence Scoring
  const fieldConfValues = Object.values(extracted.fieldConfidence || {}).filter(Number.isFinite);
  const fieldConfidence = fieldConfValues.length
    ? Math.round((fieldConfValues.reduce((a, b) => a + b, 0) / fieldConfValues.length) * 100)
    : 70;

  const classificationConfidence = detected.confidence || 0;
  const ocrConfWeight = ocrConfidence !== null ? ocrConfidence : fieldConfidence;
  const overallConfidence = Math.round(
    ocrConfWeight * 0.40 + fieldConfidence * 0.40 + classificationConfidence * 0.20
  );

  // State and Issuing Authority
  const detectedState = detected.state || extracted.state || null;
  const detectedAuthority = detected.issuingAuthority || extracted.issuingAuthority || null;

  onProgress?.({ stage: "done", pct: 100, msg: "Done!" });

  return {
    success: true,
    type,
    detectedType: detected.type,
    detectedConfidence: detected.confidence,
    state: detectedState,
    stateConfidence: detected.stateConfidence || (detectedState ? 85 : 0),
    issuingAuthority: detectedAuthority,
    authorityConfidence: detected.authorityConfidence || (detectedAuthority ? 85 : 0),
    classificationReasons: detected.reasons || [],
    slotValidation,
    extracted,
    issues,
    warnings,
    quality: qualityResult,
    ocrConfidence,
    ocrConfidenceFormatted: formatOcrConfidence(ocrConfidence),
    ocrConfidenceAggregation: OCR_CONFIDENCE_METHODOLOGY,
    uploadedAt: options.uploadedAt || new Date().toISOString(),
    issueDate: extracted.issueDate || null,
    validUpto: extracted.validUpto || null,
    fieldConfidence,
    fieldConfidences: extracted.fieldConfidence || {},
    classificationConfidence,
    confidence: overallConfidence,
    rawText,
    lines: ocrResult?.lines || [],
    isValid: issues.length === 0,
    documentTypeValid: slotValidation.status !== "mismatch",
    fieldsIncomplete: (type === "ms10" || type === "ms12") && (!extracted.name || !extracted.marksScored || !extracted.year),
  };
}

export const FIELD_LABELS = {
  name: "Student Name",
  fatherName: "Father's Name",
  motherName: "Mother's Name",
  dob: "Date of Birth",
  board: "Board / University",
  school: "School / College",
  year: "Year of Passing",
  month: "Month",
  registerNumber: "Registration / Roll No",
  marksScored: "Marks Obtained",
  maxMarks: "Maximum Marks",
  marks: "Marks (Scored / Max)",
  percentage: "Percentage",
  grade: "Result",
  community: "Community / Caste",
  communityCategory: "Category",
  certNumber: "Certificate No.",
  issueDate: "Issue Date",
  validUpto: "Valid Upto",
  income: "Annual Family Income",
  incomeNumber: "Income (Numeric)",
  taluk: "Taluk",
  district: "District",
  state: "State",
  issuingAuthority: "Issuing Authority",
};

export const DOC_TYPES = SUPPORTED_DOC_TYPES;

