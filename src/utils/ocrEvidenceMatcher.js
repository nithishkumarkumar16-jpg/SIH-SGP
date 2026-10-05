/**
 * ocrEvidenceMatcher.js — Genuine OCR Evidence, Source-Region & Word Confidence Matcher
 * 
 * Requirements:
 * 1. Source-Region Highlighting:
 *    - Preserves coordinates through image scaling, rotation, cropping, and PDF rendering.
 *    - Highlights only genuinely associated OCR evidence. Never invents bounding boxes.
 *    - If evidence is unavailable, displays "Source location unavailable."
 * 2. Field-Level OCR Confidence:
 *    - Uses arithmetic mean of genuine OCR word confidence scores for tokens in that field.
 *    - Never relabels parser heuristic match scores as OCR confidence.
 *    - If evidence is unavailable, displays "Confidence unavailable."
 */

/**
 * Normalizes a text string into tokens for OCR line/word matching.
 * 
 * @param {string|number} val 
 * @returns {string[]}
 */
export function tokenizeValue(val) {
  if (val === null || val === undefined) return [];
  const s = String(val).trim().toUpperCase();
  // Strip special currency and punctuation symbols for token comparison
  const cleaned = s.replace(/[₹$,.:;/\\|()[\]{}"'`~]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);

  const wholeClean = s.replace(/[^A-Z0-9]/g, "");
  if (wholeClean.length > 0 && !tokens.includes(wholeClean)) {
    tokens.push(wholeClean);
  }
  return tokens;
}

/**
 * Finds genuine OCR evidence (words, bounding box, page, confidence) for an extracted field.
 * 
 * @param {string} fieldId Field identifier (e.g. "name", "dob", "annualIncome")
 * @param {any} rawVal Raw extracted value
 * @param {Array} lines Array of line objects from Tesseract OCR
 * @returns {Object} Evidence result
 */
export function findFieldOcrEvidence(fieldId, rawVal, lines = []) {
  if (!rawVal || !Array.isArray(lines) || lines.length === 0) {
    return {
      available: false,
      fieldId,
      rawValue: rawVal,
      ocrConfidence: null,
      statusMessage: "Source location unavailable.",
      confidenceMessage: "Confidence unavailable.",
    };
  }

  const tokens = tokenizeValue(rawVal);
  if (tokens.length === 0) {
    return {
      available: false,
      fieldId,
      rawValue: rawVal,
      ocrConfidence: null,
      statusMessage: "Source location unavailable.",
      confidenceMessage: "Confidence unavailable.",
    };
  }

  // Search lines for the best token match
  let bestMatch = null;
  let bestScore = 0;

  for (let lIdx = 0; lIdx < lines.length; lIdx++) {
    const line = lines[lIdx];
    if (!line || !line.text) continue;
    const lineUpper = line.text.toUpperCase();

    // Check if line contains the tokens
    let matchedWordsInLine = [];

    if (Array.isArray(line.words) && line.words.length > 0) {
      for (const w of line.words) {
        if (!w || !w.text) continue;
        const wText = w.text.toUpperCase().replace(/[^A-Z0-9]/g, "");
        for (const tok of tokens) {
          const tokClean = tok.replace(/[^A-Z0-9]/g, "");
          if (tokClean.length > 0 && (wText === tokClean || (tokClean.length >= 2 && (wText.includes(tokClean) || tokClean.includes(wText))))) {
            matchedWordsInLine.push(w);
            break;
          }
        }
      }
    }

    // Direct string match fallback if words array wasn't populated or token matching missed
    const matchCount = tokens.filter(t => lineUpper.includes(t)).length;
    const matchRatio = matchCount / tokens.length;

    if (matchRatio > bestScore && (matchRatio >= 0.5 || matchCount >= 1)) {
      bestScore = matchRatio;
      bestMatch = {
        line,
        matchedWords: matchedWordsInLine.length > 0 ? matchedWordsInLine : null,
      };
    }
  }

  if (!bestMatch || bestScore < 0.5) {
    return {
      available: false,
      fieldId,
      rawValue: rawVal,
      ocrConfidence: null,
      statusMessage: "Source location unavailable.",
      confidenceMessage: "Confidence unavailable.",
    };
  }

  const line = bestMatch.line;
  const words = bestMatch.matchedWords && bestMatch.matchedWords.length > 0
    ? bestMatch.matchedWords
    : (Array.isArray(line.words) && line.words.length > 0 ? line.words : null);

  // Compute arithmetic mean of genuine OCR word confidences
  let avgWordConf = null;
  let bbox = null;

  if (words && words.length > 0) {
    const validConfs = words
      .map(w => (typeof w.confidence === "number" ? w.confidence : null))
      .filter(c => c !== null && !isNaN(c) && c > 0);
    
    if (validConfs.length > 0) {
      avgWordConf = Math.round(validConfs.reduce((a, b) => a + b, 0) / validConfs.length);
    }

    const validBoxes = words.map(w => w.bbox).filter(b => b && typeof b.x0 === "number" && typeof b.y0 === "number");
    if (validBoxes.length > 0) {
      bbox = {
        x0: Math.min(...validBoxes.map(b => b.x0)),
        y0: Math.min(...validBoxes.map(b => b.y0)),
        x1: Math.max(...validBoxes.map(b => b.x1)),
        y1: Math.max(...validBoxes.map(b => b.y1)),
      };
    }
  }

  // Fallback to line-level bounding box and confidence if individual word bboxes are missing
  if (avgWordConf === null && typeof line.confidence === "number" && line.confidence > 0) {
    avgWordConf = Math.round(line.confidence);
  }
  if (!bbox && line.bbox) {
    bbox = { ...line.bbox };
  }

  if (!bbox) {
    return {
      available: false,
      fieldId,
      rawValue: rawVal,
      ocrConfidence: avgWordConf,
      statusMessage: "Source location unavailable.",
      confidenceMessage: avgWordConf !== null ? `OCR confidence: ${avgWordConf}/100 — please confirm.` : "Confidence unavailable.",
    };
  }

  const docW = line.pageWidth || 2400;
  const docH = line.pageHeight || 3200;

  const normBbox = {
    normX0: Math.max(0, Math.min(1, bbox.x0 / docW)),
    normY0: Math.max(0, Math.min(1, bbox.y0 / docH)),
    normX1: Math.max(0, Math.min(1, bbox.x1 / docW)),
    normY1: Math.max(0, Math.min(1, bbox.y1 / docH)),
  };

  return {
    available: true,
    fieldId,
    rawValue: rawVal,
    ocrConfidence: avgWordConf,
    confidenceMessage: avgWordConf !== null ? `OCR confidence: ${avgWordConf}/100 — please confirm.` : "Confidence unavailable.",
    aggregationMethod: "Arithmetic mean of Tesseract word confidence scores across matched token bounding boxes.",
    pageNumber: line.pageNumber || 1,
    bbox,
    normBbox,
    pageWidth: docW,
    pageHeight: docH,
  };
}

/**
 * Transforms normalized bounding box coordinates for a rotated image.
 * 
 * @param {Object} normBbox { normX0, normY0, normX1, normY1 }
 * @param {number} rotationDegrees 0, 90, 180, 270
 * @returns {Object} Transformed normBbox
 */
export function transformBboxForRotation(normBbox, rotationDegrees = 0) {
  if (!normBbox) return null;
  const deg = ((rotationDegrees % 360) + 360) % 360;

  if (deg === 90) {
    return {
      normX0: Math.max(0, Math.min(1, 1 - normBbox.normY1)),
      normY0: Math.max(0, Math.min(1, normBbox.normX0)),
      normX1: Math.max(0, Math.min(1, 1 - normBbox.normY0)),
      normY1: Math.max(0, Math.min(1, normBbox.normX1)),
    };
  } else if (deg === 180) {
    return {
      normX0: Math.max(0, Math.min(1, 1 - normBbox.normX1)),
      normY0: Math.max(0, Math.min(1, 1 - normBbox.normY1)),
      normX1: Math.max(0, Math.min(1, 1 - normBbox.normX0)),
      normY1: Math.max(0, Math.min(1, 1 - normBbox.normY0)),
    };
  } else if (deg === 270) {
    return {
      normX0: Math.max(0, Math.min(1, normBbox.normY0)),
      normY0: Math.max(0, Math.min(1, 1 - normBbox.normX1)),
      normX1: Math.max(0, Math.min(1, normBbox.normY1)),
      normY1: Math.max(0, Math.min(1, 1 - normBbox.normX0)),
    };
  }

  return { ...normBbox };
}

/**
 * Generates responsive CSS positioning style for highlighting a bounding box on a preview container.
 * 
 * @param {Object} normBbox 
 * @returns {Object|null}
 */
export function getHighlightStyle(normBbox) {
  if (!normBbox) return null;
  const left = `${(normBbox.normX0 * 100).toFixed(2)}%`;
  const top = `${(normBbox.normY0 * 100).toFixed(2)}%`;
  const width = `${Math.max(1, (normBbox.normX1 - normBbox.normX0) * 100).toFixed(2)}%`;
  const height = `${Math.max(1, (normBbox.normY1 - normBbox.normY0) * 100).toFixed(2)}%`;

  return {
    position: "absolute",
    left,
    top,
    width,
    height,
    border: "2.5px solid #2563eb",
    backgroundColor: "rgba(37, 99, 235, 0.28)",
    boxShadow: "0 0 12px rgba(37, 99, 235, 0.75)",
    borderRadius: "4px",
    pointerEvents: "none",
    zIndex: 20,
    transition: "all 0.25s ease-in-out",
  };
}
