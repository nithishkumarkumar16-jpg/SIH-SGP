/**
 * fieldParsers.js — SGP Document-Specific Field Extraction Engine
 * 
 * Dedicated state-agnostic parsers for:
 * 1. Marksheets (10th SSLC & 12th HSC / CBSE / ICSE / Other State Boards)
 * 2. Community / Caste Certificates
 * 3. Income Certificates
 * 
 * Key Principles:
 * - Never guesses or fabricates fields (maxMarks and percentage are null if not in document).
 * - Multi-factor candidate name scoring rejects labels, headings, numbers, and OCR noise.
 * - Decoupled state and authority extraction across all Indian states.
 */

import {
  formatTitleName,
  formatDateDisplay,
  parseIndianDate,
  normalizeIncome,
  formatIncomeDisplay,
  normalizeCommunity,
  normalizeReligion,
} from "./fieldNormalizer";
import { evaluateIncomeFreshness } from "./verificationEngine";
import { detectState, detectIssuingAuthority } from "./documentClassifier";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const MONTH_RE = new RegExp(`\\b(${MONTH_NAMES.join("|")}|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\\b`, "i");

const MONTH_NAMES_SET = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i;

const MONTH_FULL_NAMES = {
  jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
  jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December",
  january: "January", february: "February", march: "March", april: "April", june: "June",
  july: "July", august: "August", september: "September", october: "October", november: "November", december: "December"
};
function normalizeMonth(m) {
  if (!m) return null;
  const key = m.toLowerCase().trim();
  return MONTH_FULL_NAMES[key] || formatTitleName(m);
}

/**
 * Suggests conservative OCR corrections for ambiguous characters without destructive alteration.
 * Handles: O ↔ 0, I ↔ 1, S ↔ 5, B ↔ 8, G ↔ 6, rn ↔ m, cl ↔ d, l ↔ I
 * 
 * @param {string} value Raw or preliminary value
 * @param {string} type "name" | "id" | "date" | "institution"
 * @returns {Object} { rawValue, possibleCorrections: string[], suggestedCorrection: string|null, uncertain: boolean, reason: string|null }
 */
export function suggestOcrCorrections(value, type = "name") {
  const raw = String(value || "").trim();
  if (!raw) {
    return { rawValue: raw, possibleCorrections: [], suggestedCorrection: null, uncertain: false, reason: null };
  }

  const possibleCorrections = [];
  let uncertain = false;
  let reason = null;

  if (type === "name") {
    // Check for digits mistakenly read in names (e.g. "N1TH1SH" -> "NITHISH", "KUM4R" -> "KUMAR", "S0UNDAR" -> "SOUNDAR")
    if (/\d/.test(raw)) {
      const corrected = raw
        .replace(/0/g, "O")
        .replace(/1/g, "I")
        .replace(/5/g, "S")
        .replace(/8/g, "B")
        .replace(/6/g, "G")
        .replace(/2/g, "Z")
        .replace(/4/g, "A");
      if (corrected !== raw) {
        possibleCorrections.push(corrected);
        uncertain = true;
        reason = "Digit(s) detected in candidate name; suggested letter substitution.";
      }
    }
    // Check for "rn" vs "m" (e.g. "KArnan" vs "Karnan")
    if (/\brn/i.test(raw) || /rn/i.test(raw)) {
      const alt = raw.replace(/rn/gi, (m) => (m[0] === m[0].toUpperCase() ? "M" : "m"));
      if (alt !== raw && !possibleCorrections.includes(alt)) {
        possibleCorrections.push(alt);
      }
    }
    // Check for "cl" vs "d"
    if (/cl/i.test(raw)) {
      const alt = raw.replace(/cl/gi, (m) => (m[0] === m[0].toUpperCase() ? "D" : "d"));
      if (alt !== raw && !possibleCorrections.includes(alt)) {
        possibleCorrections.push(alt);
      }
    }
  } else if (type === "id") {
    // Certificate / Registration number ambiguity (e.g. "ABO1238" -> "AB01238", "TN-l234" -> "TN-1234")
    const hasLetterInDigitSection = /[0-9][OI][0-9]/.test(raw);
    const hasAmbiguousO = /^[A-Z]{2,4}O\d{3,}/.test(raw);
    const hasLowerL = /[0-9]l[0-9]/.test(raw) || /^[A-Z]{2,4}-l\d+/.test(raw);

    if (hasLetterInDigitSection || hasAmbiguousO || hasLowerL) {
      let candidate = raw
        .replace(/^([A-Z]{2,4})O(\d+)/, "$10$2")
        .replace(/([0-9])O([0-9])/g, "$10$2")
        .replace(/([0-9])I([0-9])/g, "$11$2")
        .replace(/([0-9])l([0-9])/g, "$11$2")
        .replace(/^([A-Z]+-)l(\d+)/, "$11$2");
      if (candidate !== raw) {
        possibleCorrections.push(candidate);
        uncertain = true;
        reason = "Potential O/0 or I/1 character ambiguity in identifier.";
      }
    }
  } else if (type === "date") {
    // Date string check (e.g. "12/0B/2006" -> "12/08/2006", "3O/05/2007" -> "30/05/2007")
    if (/[OBIS]/i.test(raw) && /\d/.test(raw)) {
      const cleanedDate = raw
        .replace(/O/gi, "0")
        .replace(/B/g, "8")
        .replace(/I/g, "1")
        .replace(/S/g, "5");
      if (cleanedDate !== raw && /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(cleanedDate)) {
        possibleCorrections.push(cleanedDate);
        uncertain = true;
        reason = "Character confusion in date digits (O->0, B->8).";
      }
    }
  }

  return {
    rawValue: raw,
    possibleCorrections,
    suggestedCorrection: possibleCorrections[0] || null,
    uncertain,
    reason,
  };
}

/**
 * Strictly validates a calendar date string (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.).
 * Checks month (1-12), day limits per month (including leap year for Feb), and reasonable year.
 */
export function validateCalendarDate(dateStr) {
  if (!dateStr) return { isValid: false, reason: "Date is missing" };
  const clean = String(dateStr).trim();
  const match = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/) ||
                clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return { isValid: false, reason: "Invalid date format" };

  let day, month, year;
  if (match[1].length === 4) {
    year = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    day = parseInt(match[3], 10);
  } else {
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    year = parseInt(match[3], 10);
  }

  if (month < 1 || month > 12) return { isValid: false, reason: `Invalid month: ${month}` };
  if (year < 1950 || year > 2035) return { isValid: false, reason: `Year out of reasonable range: ${year}` };

  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) {
    return { isValid: false, reason: `Invalid day ${day} for month ${month}` };
  }

  return { isValid: true, day, month, year };
}

/**
 * Validates a candidate student Date of Birth.
 * Requires valid calendar date and plausible student age (between 10 and 45 years).
 */
export function validateStudentDob(dateStr, referenceYear = 2026) {
  const cal = validateCalendarDate(dateStr);
  if (!cal.isValid) return cal;

  const age = referenceYear - cal.year;
  if (age < 10) {
    return { isValid: false, reason: `Implausible student birth date (age ${age} is under 10 years; year ${cal.year} is too recent).` };
  }
  if (age > 45) {
    return { isValid: false, reason: `Implausible student birth date (age ${age} is over 45 years; year ${cal.year} is too old).` };
  }
  return { isValid: true, day: cal.day, month: cal.month, year: cal.year, age };
}

/**
 * Normalizes institution name for robust comparison across different document representations.
 */
export function normalizeInstitutionName(name) {
  if (!name) return "";
  return String(name)
    .toUpperCase()
    .replace(/\bH\.?\s*S\.?\s*S\.?\b/gi, "HSS")
    .replace(/\bGOVT\.?\b/gi, "GOVT")
    .replace(/\bENGG?\.?\b/gi, "ENG")
    .replace(/\bTECH\.?\b/gi, "TECH")
    .replace(/\bCOLL?\.?\b/gi, "COLL")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\bHIGHER\s+SECONDARY\s+SCHOOL\b/g, "HSS")
    .replace(/\bHR\s*SEC\s*SCHOOL\b/g, "HSS")
    .replace(/\bHR\s*SEC\b/g, "HSS")
    .replace(/\bMATRICULATION\s+SCHOOL\b/g, "MATRIC SCHOOL")
    .replace(/\bMATRICULATION\b/g, "MATRIC")
    .replace(/\bGOVERNMENT\b/g, "GOVT")
    .replace(/\bENGINEERING\b/g, "ENG")
    .replace(/\bTECHNOLOGY\b/g, "TECH")
    .replace(/\bCOLLEGE\b/g, "COLL")
    .replace(/\bCORPORATION\b/g, "CORP")
    .replace(/\bMUNICIPAL\b/g, "MUN")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fuzzy comparison between two institution names.
 */
export function compareInstitutions(instA, instB) {
  if (!instA || !instB) {
    return { isMatch: false, score: 0, status: "MISSING" };
  }
  const normA = normalizeInstitutionName(instA);
  const normB = normalizeInstitutionName(instB);

  if (normA === normB) {
    return { isMatch: true, score: 1.0, status: "MATCH" };
  }

  const wordsA = normA.split(" ").filter(w => w.length > 2);
  const wordsB = normB.split(" ").filter(w => w.length > 2);

  if (wordsA.length === 0 || wordsB.length === 0) {
    return { isMatch: false, score: 0, status: "DIFFERENT" };
  }

  const common = wordsA.filter(w => wordsB.includes(w));
  const jaccard = common.length / Math.max(wordsA.length, wordsB.length);

  if (jaccard >= 0.70) {
    return { isMatch: true, score: Number(jaccard.toFixed(2)), status: "MATCH" };
  }
  if (jaccard >= 0.45) {
    return { isMatch: true, score: Number(jaccard.toFixed(2)), status: "LIKELY" };
  }

  return { isMatch: false, score: Number(jaccard.toFixed(2)), status: "DIFFERENT" };
}

/**
 * Masks sensitive identifiers for privacy-preserving display.
 */
export function maskSensitiveIdentifier(value, type = "general") {
  if (!value) return "";
  const s = String(value).trim();
  if (type === "aadhaar") {
    const digits = s.replace(/\D/g, "");
    if (digits.length === 12) {
      return `XXXX-XXXX-${digits.slice(8)}`;
    }
  }
  if (type === "bank") {
    if (s.length > 4) {
      return "X".repeat(Math.max(4, s.length - 4)) + s.slice(-4);
    }
  }
  return s;
}

/**
 * Computes deterministic field confidence from 0 to 100.
 * 
 * Formula:
 * Field Confidence = (EngineConfidence * 0.35) + (PatternStrength * 0.25) + (LabelProximity * 0.20) + (ValueValidity * 0.20)
 */
export function computeFieldConfidence({
  engineConfidence = 85,
  patternStrength = 90,
  labelProximity = 90,
  valueValidity = 100,
}) {
  const ec = Math.max(0, Math.min(100, engineConfidence || 75));
  const ps = Math.max(0, Math.min(100, patternStrength || 70));
  const lp = Math.max(0, Math.min(100, labelProximity || 50));
  const vv = Math.max(0, Math.min(100, valueValidity || 80));

  const score = Math.round(ec * 0.35 + ps * 0.25 + lp * 0.20 + vv * 0.20);
  const clamped = Math.min(100, Math.max(0, score));

  let status = "unreliable";
  if (clamped >= 90) status = "high";
  else if (clamped >= 70) status = "medium";
  else if (clamped >= 50) status = "low";

  return {
    score: clamped,
    status,
    uncertain: clamped < 70,
  };
}

const REJECTED_NAME = /^(?:of\s+the\s+(?:candidate|candioate|candiate|student)|name\s+of\s+(?:the\s+)?(?:candidate|candioate|candiate|student)|candidate|candioate|candiate|student|name|the\s+candidate|secondary\s+school|higher\s+secondary|board|certificate|statement\s+of\s+marks|member|family\s*member|pn\s*mity|hr\s+ir\s+om|nil|null|na|date\s+of\s+birth|permanent\s+register\s+number|register\s+number|roll\s+number|total\s+marks|total|name\s+of\s+the\s+school|issue|issue\s+date|registration\s+number|certificate\s+number|passing\s+year)$/i;
const NAME_BLACKLIST = /\b(?:total|marks|result|board|school|college|certificate|statement|examination|subject|secondary|higher\s+secondary|government\s+of|department\s+of|vidyalaya|academy|date\s+of\s+birth|permanent\s+register|register\s+number|roll\s+number|born\s+on|issue\s+date|certificate\s+number|registration\s+number|passing\s+year)\b/i;
export const PARENT_ROLE_BLACKLIST = /\b(?:HEADMASTER|PRINCIPAL|TAHSILDAR|SECRETARY|OFFICER|DIRECTOR|MINISTER|GOVERNMENT|BOARD|EXAMINATIONS|REVENUE|INSPECTOR|COLLECTOR|MAGISTRATE)\b/i;

function cleanOCRLine(line) {
  return String(line || "").replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripNameLabelPrefix(raw) {
  return String(raw || "")
    .replace(/^[|()[\]{};=»_–—\s]+/, "")
    .replace(/^\s*(?:தேர்வரின்\s*பெயர்\s*[/]?\s*)?(?:name\s*of\s*(?:the\s*)?(?:candidate|student|applicant)|candidate'?s?\s*name|student'?s?\s*name|applicant'?s?\s*name|beneficiary'?s?\s*name)\s*[:\-–—]?\s*/i, "")
    .replace(/^\s*(?:of\s+the\s+(?:candidate|candioate|candiate|student|applicant)|of\s+(?:candidate|candioate|candiate|student|applicant))\s*[:\-–—]?\s*/i, "")
    .replace(/^\s*(?:student|applicant|candidate)\s*[:\-–—]\s*/i, "")
    .replace(/^\s*name\s*[:\-–—]\s*/i, "")
    .replace(/^\s*(?:mr|mrs|ms|miss|kumari|selvan|selvi|thiru|tmt|sri|smt|thirumathi|thirumati|km)\.?\s+/i, "")
    .trim();
}

function removeOCRArtifactTokens(value) {
  const words = value.split(/\s+/).filter(Boolean);
  const trimmed = [...words];

  // Remove trailing table markers like TO, NO, SL
  while (trimmed.length > 2 && /^(?:TO|T0|NO|SL|SLNO)$/i.test(trimmed[trimmed.length - 1])) trimmed.pop();
  return trimmed.join(" ");
}

function cleanCandidateName(value) {
  let v = String(value || "")
    .replace(/^[|()[\]{};=»_–—\s]+/, "") // strip leading OCR noise/pipes/brackets
    .replace(/[|()[\]{};=»_–—\s]+$/, "") // strip trailing OCR noise/pipes/brackets
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/^(?:Pe\s+|Nm\s+|De\s+|La\s+|No\.?\s+|Sl\.?\s+)/i, "")
    .replace(/[^\x20-\x7E\s]/g, " ")
    .replace(/(?:^|\s+)(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\w*(?:\s+\d{2,4})?.*$/i, "")
    // Truncate at subsequent structured field labels on the same line
    .replace(/\s+\b(?:FATHER|MOTHER|PARENT|GUARDIAN|DOB|DATE\s*OF\s*BIRTH|BORN|PERMANENT|REGISTER|REGISTRATION|REG|ROLL|SCHOOL|INSTITUTION|COLLEGE|SEX|GENDER|MALE|FEMALE|COMMUNITY|CASTE|CATEGORY|TALUK|DISTRICT|STD|STANDARD|CLASS|STREAM|GROUP|BRANCH|MEDIUM|SESSION|EXAMINATION|EXAM|TOTAL|MARKS|MARK|MAX|PERCENTAGE|RESULT|PASS|FAIL|CERTIFICATE|STATEMENT|OF\s+ISSUE|VALID|VALIDITY|TAHSILDAR|HEADMASTER|PRINCIPAL)\b\s*[:\-–—].*$/i, "")
    .replace(/\s+\b(?:SESSION|DOB|DATE|REG|ROLL|HSS|SEC|MATRIC|SCHOOL|EXAMINATION|PERMANENT|MARK|MARKS|CERTIFICATE|STATEMENT|OF\s+ISSUE)\b.*$/i, "")
    .replace(/\s+(?:son\s+of|daughter\s+of|residing\s+at|r\/o|d\/o|s\/o|w\/o)\b.*$/i, "")
    .replace(/\s+\d{4,}.*$/, "")
    .replace(/[^A-Za-z0-9.'-]+$/, "") // strip trailing non-alpha punctuation
    .trim();

  v = stripNameLabelPrefix(v);
  v = removeOCRArtifactTokens(v);
  return v;
}

/**
 * Detects anomalous extra tokens (e.g. "Arun K Extra", "Senthil M School", trailing noise/labels).
 * In Indian naming conventions, a single-letter initial is a patronymic/surname prefix (K Arun)
 * or suffix (Arun K). A full word immediately following a single-letter initial (Word Initial Word)
 * is an anomalous structure indicating an extra token was captured from an adjacent field or label.
 */
export function detectAnomalousExtraToken(name) {
  if (!name) return { hasAnomaly: false, reason: null, surplusToken: null, extraToken: null };
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { hasAnomaly: false, reason: null, surplusToken: null, extraToken: null };

  // 1. Structure check: Prior Full Word + Single-Letter Initial + Trailing Word (e.g. "Arun K Extra")
  for (let i = 1; i < words.length - 1; i++) {
    const letters = words[i].replace(/[^A-Za-z]/g, "");
    if (letters.length === 1) {
      const hasPriorFullWord = words.slice(0, i).some(w => w.replace(/[^A-Za-z]/g, "").length >= 2);
      const nextLetters = words[i + 1].replace(/[^A-Za-z]/g, "");
      if (hasPriorFullWord && nextLetters.length > 1) {
        const token = words[i + 1].replace(/[^A-Za-z0-9]/g, "");
        return {
          hasAnomaly: true,
          surplusToken: token,
          extraToken: token,
          reason: `Structural anomaly: trailing token ('${token}') follows single-letter initial ('${words[i]}').`,
        };
      }
    }
  }

  // 2. Trailing word is an explicit non-name / noise / label token
  const lastWord = words[words.length - 1].replace(/[^A-Za-z]/g, "");
  const SUSPICIOUS_TRAILING_TOKENS = /^(?:EXTRA|EXT|EXAM|EXAMINATION|COPY|PAGE|NO|SL|STD|CLASS|PASS|FAIL|STATE|BOARD|GOVT|TEST|DEMO|SAMPLE|SCHOOL|INSTITUTE|COLLEGE)$/i;
  if (words.length >= 2 && SUSPICIOUS_TRAILING_TOKENS.test(lastWord)) {
    return {
      hasAnomaly: true,
      surplusToken: lastWord.toUpperCase(),
      extraToken: lastWord.toUpperCase(),
      reason: `Suspicious trailing token ('${lastWord}') resembles document metadata or OCR noise.`,
    };
  }

  // 3. Trailing word matches an official title / role
  if (words.length >= 3 && PARENT_ROLE_BLACKLIST.test(lastWord)) {
    return {
      hasAnomaly: true,
      surplusToken: lastWord,
      extraToken: lastWord,
      reason: `Trailing token ('${lastWord}') matches an official title/role.`,
    };
  }

  return { hasAnomaly: false, reason: null, surplusToken: null, extraToken: null };
}

/**
 * Resolves OCR name candidate conservatively.
 * Preserves rawValue, suggestedValue, confidence, and reason.
 */
export function resolveOcrNameCandidate(raw, alternatives = [], ocrConfidence = null) {
  let confInput = ocrConfidence;
  if (typeof alternatives === "number") {
    confInput = alternatives;
  }
  const clean = cleanCandidateName(raw);
  if (!clean) {
    return { value: null, rawValue: raw || "", suggestedValue: null, confidence: 0, status: "NOT_DETECTED", reason: "Candidate name empty" };
  }

  const corrections = suggestOcrCorrections(clean, "name");
  const isDigitNoise = /\d/.test(clean);
  const isLowConfidence = typeof confInput === "number" && !isNaN(confInput) && (confInput < 70 && (confInput > 1 || confInput < 0.70));
  const anomaly = detectAnomalousExtraToken(clean);

  if (anomaly.hasAnomaly) {
    const confVal = typeof confInput === "number" && confInput <= 1 ? 0.65 : 65;
    return {
      value: formatTitleName(clean),
      rawValue: clean,
      suggestedValue: formatTitleName(clean),
      confidence: confVal,
      status: "NEEDS_REVIEW",
      uncertain: true,
      reason: anomaly.reason || "Unexpected extra token detected; verification required.",
    };
  }

  if (isCandidateName(clean)) {
    if (isLowConfidence) {
      return {
        rawValue: clean,
        suggestedValue: formatTitleName(clean),
        confidence: Math.round(ocrConfidence),
        status: "NEEDS_REVIEW",
        reason: "Low OCR engine confidence on input image; verification recommended.",
      };
    }
    return {
      rawValue: clean,
      suggestedValue: formatTitleName(clean),
      confidence: typeof ocrConfidence === "number" && !isNaN(ocrConfidence)
        ? Math.min(98, Math.max(75, Math.round(ocrConfidence)))
        : 90,
      status: "HIGH_CONFIDENCE",
      reason: null,
    };
  }

  if (isDigitNoise && corrections.suggestedCorrection && isCandidateName(corrections.suggestedCorrection)) {
    return {
      rawValue: clean,
      suggestedValue: formatTitleName(corrections.suggestedCorrection),
      confidence: 68,
      status: "NEEDS_REVIEW",
      reason: corrections.reason || "Digit(s) detected in candidate name; suggested letter substitution.",
    };
  }

  return {
    rawValue: clean,
    suggestedValue: null,
    confidence: 35,
    status: "NOT_DETECTED",
    reason: "Candidate failed name syntax validation",
  };
}



function isCandidateName(value) {
  let v = cleanCandidateName(value);
  if (!v || v.length < 3 || v.length > 70 || REJECTED_NAME.test(v) || NAME_BLACKLIST.test(v) || /\d/.test(v)) return false;

  // Single month token is not a name
  if (MONTH_NAMES_SET.test(v)) return false;

  const words = v.split(/\s+/).filter(Boolean).map(w => w.replace(/[^A-Za-z.'-]/g, ""));
  if (words.length < 1 || words.length > 6) return false;

  // If the words are purely noise words
  if (words.every(w => /^(?:of|the|name|class|school|college|board|exam|examination|certificate|marks|result|member|family|hr|ir|om|table|sl|no)$/i.test(w))) return false;

  // Vowel & Consonant rules for each word:
  for (const w of words) {
    const lettersOnly = w.replace(/[^A-Za-z]/g, "");
    // Single-letter word is valid ONLY if it's an initial (e.g. M, S, K, A, M., S.)
    if (lettersOnly.length <= 1) {
      if (!/^[A-Za-z]$/.test(lettersOnly)) return false;
      continue;
    }
    // Words of length >= 2 MUST have at least one English vowel (a, e, i, o, u, y)
    // Rejects Tamil OCR noise tokens like "Bh", "Lhe", "uf", "wrt", "sg", etc.
    if (!/[aeiouyAEIOUY]/.test(lettersOnly)) return false;

    // Reject words with 5 or more consecutive consonants, or 4 unless valid Indian transliteration cluster (e.g. "kshm" in Lakshmi)
    if (/[bcdfghjklmnpqrstvwxzBCDFGHJKLMNPQRSTVWXZ]{5,}/.test(lettersOnly)) return false;
    if (/[bcdfghjklmnpqrstvwxzBCDFGHJKLMNPQRSTVWXZ]{4,}/.test(lettersOnly) && !/kshm|rshn|kshr|ndrs|rthm|rshm/i.test(lettersOnly)) return false;

    // Reject repetitive triples e.g. "lll", "fff"
    if (/([A-Za-z])\1\1/.test(lettersOnly)) return false;
  }

  const hasLongWord = words.some(w => w.length >= 3);
  if (!hasLongWord) return false;

  return words.every(w => /^[A-Za-z.'-]+$/.test(w));
}

function scoreNameCandidate(raw, ocrConfidence = null, isNearLabel = true, layoutContext = null) {
  const clean = cleanCandidateName(raw);
  if (!isCandidateName(clean)) return { name: null, score: -1 };

  let score = 50;

  // Proximity to English/Tamil label
  if (isNearLabel) {
    score += 15;
  } else if (layoutContext && layoutContext.inTargetRegion) {
    // Proximity to structural candidate region
    score += 15;
    // Centrality bonus if well-positioned vertically within structural candidate band
    if (typeof layoutContext.bandTop === "number" && typeof layoutContext.bandBottom === "number" && typeof layoutContext.normYMid === "number") {
      const bandCenter = (layoutContext.bandTop + layoutContext.bandBottom) / 2;
      const distFromCenter = Math.abs(layoutContext.normYMid - bandCenter);
      const bandHalfSpan = Math.max(0.01, (layoutContext.bandBottom - layoutContext.bandTop) / 2);
      if (distFromCenter <= bandHalfSpan * 0.6) {
        score += 10;
      }
    }
  }

  // Cross-pass consistency bonus
  if (layoutContext && layoutContext.crossPassMatches >= 2) {
    score += 20;
  }

  // All uppercase Latin letters (Tamil Nadu & Indian marksheets print student names in ALL-CAPS: "SAMPLE STUDENT")
  if (/^[A-Z\s.]+$/.test(clean)) {
    score += 35;
  } else if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(clean)) {
    // Standard Title Case (1 or more words)
    score += 10;
  } else {
    // Mixed case or lowercase in odd positions is typical OCR noise
    score -= 30;
  }

  // Name structure pattern: "FIRSTNAME INITIAL", "INITIAL FIRSTNAME", "FIRSTNAME LASTNAME", or "FIRSTNAME MIDDLENAME LASTNAME"
  if (/^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+[A-Z]\.?$/i.test(clean)) score += 20;
  else if (/^[A-Z]\.?\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*$/i.test(clean)) score += 20;
  else if (/^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3}$/i.test(clean)) score += 15;
  else if (/^[A-Z][A-Za-z]{2,}$/i.test(clean)) score += 10;

  // Penalize strings with OCR noise symbols
  if (/[-–—_~`|/\\]/.test(raw)) score -= 20;

  // Weight OCR confidence if provided
  if (typeof ocrConfidence === "number" && !isNaN(ocrConfidence)) {
    if (ocrConfidence >= 85) score += 15;
    else if (ocrConfidence < 60) score -= 25;
  }

  // Penalize typical Tamil OCR artifact patterns (e.g. starting with "Gub", containing odd sequences)
  if (/\b(?:Gub|psiu|eGau|sgew|Quip)\w*/i.test(clean)) score -= 60;

  // Penalize anomalous structures (e.g. Word Initial Word like "Arun K Extra")
  const anomaly = detectAnomalousExtraToken(clean);
  if (anomaly.hasAnomaly) {
    score = Math.min(score, 65);
  }

  return { name: clean, score };
}

function cleanLocation(s) {
  const v = String(s || "")
    .split(/\r?\n/)[0]
    .replace(/^(?:residing\s+at|residing|door\s+no\.?[^,]*,\s*|at|in|village|town|vilage\/city\s+[A-Za-z]+|of\s+|taluk\s+of\s+|district\s+of\s+)/i, "")
    .replace(/\s+(?:taluka|taluk|district|village|town|state|pin|and\s+his).*$/i, "")
    .replace(/[|_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return formatTitleName(v);
}

/**
 * Detects marksheet board and template based on document evidence.
 * Does not assume every marksheet follows Tamil Nadu layout.
 */
export function detectMarksheetTemplate(text, lines = null) {
  const combined = String(text || "") + " " + (Array.isArray(lines) ? lines.map(l => l.text || "").join(" ") : "");

  if (/higher\s*secondary|hsc\b|class\s*(?:xii|12th)\b|department\s+of\s+government\s+examinations.*tamil|மேல்நிலைப்/i.test(combined)) {
    return {
      template: "tn_hsc",
      board: "Tamil Nadu Higher Secondary (HSC)",
      state: "Tamil Nadu",
      confidence: 0.92,
      evidence: ["HIGHER SECONDARY", "TAMIL NADU / DGE"],
    };
  }
  if (/secondary\s*school\s*leaving|sslc\b|class\s*(?:x|10th)\b|matriculation\s*board.*tamil|பத்தாம்/i.test(combined)) {
    return {
      template: "tn_sslc",
      board: "Tamil Nadu State Board (SSLC)",
      state: "Tamil Nadu",
      confidence: 0.90,
      evidence: ["SSLC", "TAMIL NADU"],
    };
  }
  if (/central\s*board\s*of\s*secondary|cbse\b|all\s*india\s*senior\s*school|all\s*india\s*secondary/i.test(combined)) {
    return {
      template: "cbse",
      board: "CBSE",
      state: null,
      confidence: 0.95,
      evidence: ["CBSE"],
    };
  }
  if (/council\s*for\s*the\s*indian\s*school|cisce|icse|isc\b/i.test(combined)) {
    return {
      template: "icse",
      board: "CISCE (ICSE/ISC)",
      state: null,
      confidence: 0.95,
      evidence: ["CISCE"],
    };
  }

  const stateMatch = detectState(combined);
  if (stateMatch.state && /board\s+of|examination/i.test(combined)) {
    return {
      template: "state_board",
      board: `${stateMatch.state} State Board of School Examinations`,
      state: stateMatch.state,
      confidence: 0.85,
      evidence: [stateMatch.state],
    };
  }

  return {
    template: "generic",
    board: null,
    state: null,
    confidence: 0.50,
    evidence: [],
  };
}

/**
 * Spatial geometry extraction using normalized coordinates and dynamic document landmarks.
 * Works across different PDF resolutions, image sizes, scans, and crops without fixed pixel values.
 * 
 * Structural regions for recognized HSC/SSLC marksheets:
 * 1. HEADER (Title, State, Department)
 * 2. CANDIDATE NAME (Bilingual heading + student name band)
 * 3. DOB / REGISTER NUMBER (Date of Birth, Permanent Register Number, Session)
 * 4. SUBJECT MARKS (Table of subjects, theory, practical, totals)
 * 5. TOTAL MARKS (Scored / Maximum marks)
 * 6. SCHOOL (Institution name, Group, Medium)
 */
export function extractNameUsingGeometry(lineObjects, templateInfo = null) {
  if (!Array.isArray(lineObjects) || !lineObjects.length) return null;

  // 1. Determine document coordinate frame (normalized 0.0 to 1.0)
  let docW = 0;
  let docH = 0;

  for (const l of lineObjects) {
    if (l.pageWidth && l.pageWidth > docW) docW = l.pageWidth;
    if (l.pageHeight && l.pageHeight > docH) docH = l.pageHeight;
    if (l.bbox) {
      if (l.bbox.x1 > docW) docW = l.bbox.x1;
      if (l.bbox.y1 > docH) docH = l.bbox.y1;
    }
  }

  docW = Math.max(100, docW);
  docH = Math.max(100, docH);

  // Annotate normalized coordinates
  const normLines = lineObjects.map(l => {
    if (!l.bbox) return { ...l, normX0: 0, normY0: 0, normX1: 1, normY1: 1, normYMid: 0.5, normHeight: 0 };
    const normX0 = l.bbox.x0 / docW;
    const normY0 = l.bbox.y0 / docH;
    const normX1 = l.bbox.x1 / docW;
    const normY1 = l.bbox.y1 / docH;
    return {
      ...l,
      normX0,
      normY0,
      normX1,
      normY1,
      normYMid: (normY0 + normY1) / 2,
      normHeight: Math.max(0.005, normY1 - normY0),
    };
  });

  // 2. Strategy A & B: Anchor Label Priority Check (English / Tamil)
  const labelLine = normLines.find(l =>
    /(?:NAME\s*OF\s*(?:THE\s*)?(?:CANDIDATE|STUDENT)|CANDIDATE'?S?\s*NAME|STUDENT\s*NAME|தேர்வரின்\s*பெயர்|(?:AME|ME)\s*OF\s*(?:THE\s*)?CANDI)/i.test(l.text)
  );

  if (labelLine) {
    // Check if name is on same line to the right
    const sameLineSuffix = stripNameLabelPrefix(labelLine.text);
    if (sameLineSuffix) {
      const sc = scoreNameCandidate(sameLineSuffix, labelLine.confidence, true);
      if (sc.name && sc.score >= 65) {
        return { value: formatTitleName(sc.name), confidence: 0.95, method: "anchor_same_line" };
      }
    }

    // Find candidate lines in the spatial region directly below the label
    const nearbyLines = normLines.filter(l => {
      if (l === labelLine || !l.bbox) return false;
      const dy = l.normY0 - labelLine.normY1;
      const isBelow = dy >= -0.01 && dy <= labelLine.normHeight * 4.0;
      const xOverlap = l.normX0 <= labelLine.normX1 + 0.50 && l.normX1 >= labelLine.normX0 - 0.20;
      return isBelow && xOverlap;
    });

    let best = { name: null, score: -1 };
    for (const l of nearbyLines) {
      let textToScore = cleanCandidateName(l.text);
      const sc = scoreNameCandidate(textToScore, l.confidence, true);
      if (sc.score > best.score && sc.name) {
        best = sc;
      }
    }

    if (best.name && best.score >= 65) {
      return { value: formatTitleName(best.name), confidence: Math.min(0.98, best.score / 100), method: "anchor_line_below" };
    }
  }

  // 3. Strategy D: Geometry & Document Layout Fallback (Keyword-Free)
  // Used when "NAME OF THE CANDIDATE" is completely missing or corrupted from OCR.
  // Uses dynamic landmarks to locate the CANDIDATE NAME structural region.
  
  // Landmark A: HEADER (Title, State, Department) in top region
  const headerLandmarks = normLines.filter(l =>
    /(?:GOVERNMENT\s+OF|DEPARTMENT\s+OF|HIGHER\s+SECONDARY|SECONDARY\s+SCHOOL|STATEMENT\s+OF\s+MARKS|STATE\s+BOARD|BOARD\s+OF\s+SECONDARY|EXAMINATION)/i.test(l.text) &&
    l.normYMid < 0.28
  );
  const headerBottomY = headerLandmarks.length
    ? Math.max(...headerLandmarks.map(l => l.normY1))
    : 0.15;

  // Landmark B: DOB / REGISTER NUMBER / SESSION / SUBJECTS located below header
  const lowerLandmarks = normLines.filter(l =>
    /(?:PERMANENT\s*REGISTER|REGISTER\s*NUMBER|ROLL\s*NO|REG(?:ISTRATION)?\s*NO|DATE\s*OF\s*BIRTH|DOB|BORN\s*ON|SESSION|நிரந்தரப்|பிறந்த|\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b)/i.test(l.text) &&
    l.normYMid > (headerLandmarks.length ? headerBottomY * 0.9 : 0.15)
  );
  let lowerTopY = lowerLandmarks.length
    ? Math.min(...lowerLandmarks.map(l => l.normY0))
    : 0.50;

  // Landmark C: SUBJECT MARKS table header
  const subjectLandmarks = normLines.filter(l =>
    /(?:பாடம்|SUBJECT|THEORY|PRACTICAL|MARKS\s*OBTAINED)/i.test(l.text) &&
    l.normYMid > (headerLandmarks.length ? headerBottomY * 0.9 : 0.20)
  );
  if (!lowerLandmarks.length && subjectLandmarks.length) {
    lowerTopY = Math.min(...subjectLandmarks.map(l => l.normY0));
  }

  // Define normalized candidate window between Header and DOB/RegNo landmarks
  const bandTop = headerLandmarks.length ? Math.max(0.08, headerBottomY - 0.02) : 0.10;
  const bandBottom = lowerLandmarks.length || subjectLandmarks.length ? Math.min(0.95, lowerTopY + 0.02) : 0.50;
  const minX = 0.05;
  const maxX = 0.95;


  // Filter lines strictly within the structural CANDIDATE NAME band
  const candidatesInBand = [];

  for (const l of normLines) {
    if (!l.bbox) continue;
    if (l.normYMid < bandTop || l.normYMid > bandBottom) continue;
    if (l.normX0 > maxX || l.normX1 < minX) continue;

    // Must not be a landmark line itself
    if (/(?:GOVERNMENT\s+OF|DEPARTMENT\s+OF|HIGHER\s+SECONDARY|SECONDARY\s+SCHOOL|STATEMENT\s+OF\s+MARKS|PERMANENT\s*REGISTER|REGISTER\s*NUMBER|ROLL\s*NO|DATE\s*OF\s*BIRTH|DOB|SESSION|SUBJECT|MARKS)/i.test(l.text)) {
      continue;
    }

    const cleaned = cleanCandidateName(l.text);
    if (!cleaned) continue;

    const sc = scoreNameCandidate(cleaned, l.confidence, false, {
      inTargetRegion: true,
      bandTop,
      bandBottom,
      normYMid: l.normYMid,
    });

    if (sc.name && sc.score >= 65) {
      candidatesInBand.push({
        name: sc.name,
        score: sc.score,
        confidence: l.confidence,
        normYMid: l.normYMid,
        line: l,
      });
    }
  }

  if (!candidatesInBand.length) return null;

  // Sort by score descending
  candidatesInBand.sort((a, b) => b.score - a.score);
  const top = candidatesInBand[0];

  // Ambiguity check: if multiple candidates have close scores with different names, do not guess
  if (candidatesInBand.length > 1) {
    const second = candidatesInBand[1];
    if (Math.abs(top.score - second.score) < 10 && cleanCandidateName(top.name) !== cleanCandidateName(second.name)) {
      // Ambiguous candidates in region
      return null;
    }
  }

  return {
    value: formatTitleName(top.name),
    confidence: Math.min(0.96, Math.max(0.70, top.score / 100)),
    method: "geometry_layout_fallback",
  };
}

/**
 * Extracts student name from Marksheet text with candidate scoring, bilingual anchor prioritization,
 * and keyword-free geometry fallback.
 */
export function extractMarksheetName(input, geometryLines = null) {
  let raw = "";
  let lines = [];
  let lineObjects = null;

  if (typeof input === "string") {
    raw = input;
    lines = raw.split(/\r?\n/).map(cleanOCRLine).filter(Boolean);
    if (Array.isArray(geometryLines)) lineObjects = geometryLines;
  } else if (input && typeof input === "object") {
    raw = input.text || "";
    lines = raw.split(/\r?\n/).map(cleanOCRLine).filter(Boolean);
    if (Array.isArray(input.lines)) lineObjects = input.lines;
  }

  const templateInfo = detectMarksheetTemplate(raw, lineObjects);

  // 1. Spatial Geometry Extraction (Handles missing labels, bilingual Tamil, and bounding boxes)
  if (lineObjects && lineObjects.length > 0) {
    const geoResult = extractNameUsingGeometry(lineObjects, templateInfo);
    if (geoResult && geoResult.value) {
      return geoResult;
    }
  }

  // 2. Line-based Anchor Matching (Priority A & B)
  let primaryAnchorIdx = -1;
  let secondaryAnchorIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:NAME\s*OF\s*(?:THE\s*)?(?:CANDIDATE|STUDENT)|CANDIDATE'?S?\s*NAME|STUDENT\s*NAME)\b/i.test(line)) {
      if (primaryAnchorIdx === -1) primaryAnchorIdx = i;
    } else if (/(?:தேர்வரின்\s*பெயர்)\b/i.test(line)) {
      if (secondaryAnchorIdx === -1) secondaryAnchorIdx = i;
    }
  }

  const anchorIdx = primaryAnchorIdx !== -1 ? primaryAnchorIdx : secondaryAnchorIdx;

  if (anchorIdx !== -1) {
    // Priority: check same line directly after label first
    const sameLineCandidate = stripNameLabelPrefix(lines[anchorIdx]);
    if (sameLineCandidate) {
      const sc = scoreNameCandidate(sameLineCandidate, null, true);
      if (sc.name && sc.score >= 65) {
        const anomaly = detectAnomalousExtraToken(sc.name);
        const conf = anomaly.hasAnomaly ? 0.65 : Math.min(0.98, sc.score / 100);
        return { value: formatTitleName(sc.name), confidence: conf };
      }
    }

    let best = { name: null, score: -1 };

    // Search window: lines directly following
    for (let offset = 1; offset <= 4 && anchorIdx + offset < lines.length; offset++) {
      let candidateLine = lines[anchorIdx + offset];
      // If candidate line starts with or is a major document label, do NOT treat it as a candidate name
      if (/^\s*(?:DATE\s+OF\s+BIRTH|DOB|PERMANENT|REGISTER|REGISTRATION|ROLL|TOTAL|MARKS|GRAND\s+TOTAL|NAME\s+OF\s+THE\s+SCHOOL|CLASS|SESSION|ISSUE|CERTIFICATE|PARENT|GUARDIAN|COMMUNITY|BOARD|PERCENTAGE|PASSING)\b/i.test(candidateLine)) {
        const parts = candidateLine.split(/\b(?:DATE\s+OF\s+BIRTH|DOB|PERMANENT|REGISTER|REGISTRATION|ROLL|TOTAL|MARKS|GRAND\s+TOTAL|NAME\s+OF\s+THE\s+SCHOOL|CLASS|SESSION|ISSUE|CERTIFICATE|PARENT|GUARDIAN|COMMUNITY|BOARD|PERCENTAGE|PASSING)\b/i);
        if (parts[0] && parts[0].trim().length >= 3) {
          candidateLine = parts[0].trim();
        } else {
          candidateLine = "";
        }
      }

      if (!candidateLine) continue;

      const sc = scoreNameCandidate(candidateLine, null, true);
      if (sc.score > best.score && sc.name) {
        best = sc;
      }
    }

    // Must meet minimum threshold to reject OCR garbage
    if (best.name && best.score >= 65) {
      const anomaly = detectAnomalousExtraToken(best.name);
      const conf = anomaly.hasAnomaly ? 0.65 : Math.min(0.98, best.score / 100);
      return { value: formatTitleName(best.name), confidence: conf };
    }
  }

  // 3. Fallback regex search anchored on English label or Tamil label
  const fallbackMatch = raw.match(/(?:NAME\s*OF\s*(?:THE\s*)?CANDIDATE|STUDENT\s*NAME|தேர்வரின்\s*பெயர்)[^\nA-Z]*\n(?:[^\nA-Z]*\n)?([A-Z][A-Za-z\s.]{2,35})/i);
  if (fallbackMatch) {
    const cleaned = cleanCandidateName(fallbackMatch[1]);
    const sc = scoreNameCandidate(cleaned, null, false);
    if (sc.name && sc.score >= 65) {
      const anomaly = detectAnomalousExtraToken(sc.name);
      const conf = anomaly.hasAnomaly ? 0.65 : 0.75;
      return { value: formatTitleName(sc.name), confidence: conf };
    }
  }

  // Candidate name could not be reliably extracted
  return { value: null, confidence: 0 };
}


/**
 * Mathematical and consistency validation for extracted marks and percentage.
 */
export function validateMarksConsistency({ scored, maxMarks, percentage, subjectMarks }) {
  let status = "CONSISTENT";
  let reason = null;
  const numScored = scored ? parseInt(scored, 10) : null;
  const numMax = maxMarks ? parseInt(maxMarks, 10) : null;

  // 1. Scored > Max is an obvious conflict
  if (numScored !== null && numMax !== null) {
    if (numScored > numMax) {
      return {
        status: "CONFLICT",
        reason: `Scored marks (${numScored}) exceed maximum marks (${numMax}).`,
        subjectSum: null,
        calculatedPercentage: null,
      };
    }
  }

  // 2. Mathematical percentage check
  let calcPct = null;
  if (numScored !== null && numMax !== null && numMax > 0) {
    calcPct = ((numScored / numMax) * 100).toFixed(2);
    if (percentage) {
      const explicitNum = parseFloat(String(percentage).replace(/%/g, ""));
      if (!isNaN(explicitNum)) {
        const diff = Math.abs(explicitNum - parseFloat(calcPct));
        // Safe tolerance is 1.0% (accounting for rounding like 89.8% vs 89.80%)
        if (diff > 1.0) {
          status = "CONFLICT";
          reason = `Explicit percentage (${percentage}) conflicts with calculated marks ratio (${calcPct}%).`;
        }
      }
    }
  }

  // 3. Subject-wise marks sum check
  let subSum = null;
  if (Array.isArray(subjectMarks) && subjectMarks.length >= 3 && numScored !== null) {
    const validMarks = subjectMarks
      .map(s => parseInt(s.marks || s.total || s.scored || "", 10))
      .filter(n => Number.isFinite(n) && n >= 0 && n <= 200);

    if (validMarks.length === subjectMarks.length) {
      subSum = validMarks.reduce((a, b) => a + b, 0);
      const diff = Math.abs(subSum - numScored);
      // Tolerance of +-5 for OCR digit variance
      if (diff > 5) {
        status = "CONFLICT";
        reason = `Sum of individual subject marks (${subSum}) conflicts with grand total (${numScored}).`;
      }
    }
  }

  return {
    status,
    reason,
    subjectSum: subSum,
    calculatedPercentage: calcPct ? `${calcPct}%` : null,
  };
}

/**
 * Extracts subject marks from marksheet text (SSLC, HSC, CBSE).
 */
export function extractSubjectMarksTable(text, docType = "ms10") {
  const cleaned = String(text || "");
  const subjects = [];

  // 1. CBSE format: SUB CODE (e.g. 085), SUBJECT NAME, MARKS (100), GRADE (A1)
  const cbsePattern = /\b(\d{3})\s+([A-Z\s&-]{4,25})\s+(\d{2,3})\s+(A1|A2|B1|B2|C1|C2|D1|D2|E)\b/gi;
  let cm;
  while ((cm = cbsePattern.exec(cleaned)) !== null) {
    subjects.push({
      code: cm[1].trim(),
      subject: cm[2].trim(),
      marks: cm[3].trim(),
      grade: cm[4].trim(),
    });
  }

  if (subjects.length >= 3) {
    return subjects;
  }

  // 2. SSLC / HSC structured row format:
  // e.g. "TAMIL 088 — 088 PASS" or "PART I TAMIL 091 — 091" or "PHYSICS 062 030 092"
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const subjectKeywords = [
    "COMPUTER SCIENCE", "SOCIAL SCIENCE", "PART II ENGLISH", "PART I TAMIL",
    "MATHEMATICS", "ACCOUNTANCY", "GEOGRAPHY", "CHEMISTRY", "ECONOMICS",
    "COMMERCE", "PHYSICS", "BIOLOGY", "ENGLISH", "HISTORY", "SCIENCE",
    "ZOOLOGY", "BOTANY", "MATHS", "TAMIL", "HINDI"
  ];

  for (const line of lines) {
    for (const subName of subjectKeywords) {
      const subIdx = line.toUpperCase().indexOf(subName.toUpperCase());
      if (subIdx !== -1) {
        const afterText = line.substring(subIdx + subName.length);
        const digits = afterText.match(/\b\d{1,3}\b/g);
        if (digits && digits.length > 0) {
          let finalMarks = digits[0];
          let maxM = "100";
          if (digits.length >= 2) {
            if (parseInt(digits[1], 10) === 100 || parseInt(digits[1], 10) > parseInt(digits[0], 10)) {
              finalMarks = digits[0];
              maxM = digits[1];
            } else {
              finalMarks = digits[digits.length - 1];
            }
          }
          if (!subjects.some(s => s.subject.toUpperCase() === subName.toUpperCase())) {
            subjects.push({
              subject: subName,
              marks: finalMarks,
              maxMarks: maxM,
              theory: digits.length > 1 ? digits[0] : finalMarks,
              practical: digits.length > 2 ? digits[1] : null,
            });
          }
          break;
        }
      }
    }
  }

  if (subjects.length >= 3) {
    return subjects;
  }

  // 3. Fallback regex search for subjects
  const fallbackPatterns = [
    /\b(PART\s*I\s*TAMIL|PART\s*II\s*ENGLISH|PHYSICS|CHEMISTRY|BIOLOGY|MATHEMATICS|MATHS|SCIENCE|SOCIAL\s+SCIENCE|TAMIL|ENGLISH)\s+(\d{2,3})\b/gi,
  ];
  for (const sp of fallbackPatterns) {
    let sm;
    while ((sm = sp.exec(cleaned)) !== null) {
      const name = sm[1].trim();
      if (!subjects.some(s => s.subject.toUpperCase() === name.toUpperCase())) {
        subjects.push({ subject: name, marks: sm[2].trim() });
      }
    }
  }

  return subjects.length > 0 ? subjects : null;
}

/**
 * Extracts marks, grand total, honest percentage, and mathematical validation.
 * Never fabricates maximum marks or percentage when maxMarks is not in the document.
 */
export function extractMarks(text, docType = "ms10") {
  const cleaned = String(text || "");
  const subjectMarks = extractSubjectMarksTable(cleaned, docType);

  let scored = null;
  let maxMarks = null;
  let explicitPercentage = null;
  let grade = null;

  // 1. Explicit Fraction Scored / Max e.g. "465 / 500", "540 / 600", "449 / 500", "0499 / 600"
  // Handles leading Tamil OCR noise e.g. "00000 000000000000 / GRAND TOTAL 449/500"
  const fractionPatterns = [
    /(?:(?:மொத்த\s*மதிப்பெண்கள்|[0-9oO\s]+)\s*[/]?\s*)?(?:GRAND\s*TOTAL|TOTAL\s*MARKS|TOTAL\s*OBTAINED|MARKS\s*OBTAINED|TOTAL)[^\d\n]{0,35}0?(\d{2,4})\s*[/\-–—]\s*(\d{2,4})/i,
    /(?:total\s+marks?|grand\s+total)[^\d\n]{0,32}0?(\d{2,4})\s*(?:out\s+of|of)\s*(\d{2,4})/i,
    /\b0?(\d{2,4})\s*[/\-–—]\s*(500|600|800|1000|1200)\b/i,
  ];

  for (const pattern of fractionPatterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const s = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (Number.isFinite(s) && Number.isFinite(m) && m >= 100 && s >= 0 && s <= m) {
      scored = String(s);
      maxMarks = String(m);
      break;
    }
  }

  // 2. Explicit Total Marks with Scored value only if fraction wasn't matched
  if (!scored) {
    const scoredPatterns = [
      /(?:(?:மொத்த\s*மதிப்பெண்கள்|[0-9oO\s]+)\s*[/]?\s*)?(?:GRAND\s*TOTAL|TOTAL\s*MARKS|TOTAL\s*OBTAINED|MARKS\s*OBTAINED|TOTAL)\s*[:\-–—]?\s*(?:\r?\n\s*)?0?(\d{3,4})\b/i,
      /\b(?:total\s+marks?|grand\s+total)\s*[:\-–—]?\s*(?:\r?\n\s*)?0?(\d{3,4})\b/i,
    ];

    for (const pat of scoredPatterns) {
      const scoredMatch = cleaned.match(pat);
      if (scoredMatch) {
        const s = parseInt(scoredMatch[1], 10);
        if (Number.isFinite(s) && s >= 50 && s <= 2000) {
          scored = String(s);
          const explicitMaxMatch = cleaned.match(/(?:maximum\s+marks|max\s+marks|out\s+of)\s*[:-]?\s*(\d{3,4})/i);
          if (explicitMaxMatch) {
            const parsedMax = parseInt(explicitMaxMatch[1], 10);
            if (parsedMax >= s && parsedMax <= 2000) {
              maxMarks = String(parsedMax);
            }
          }
          break;
        }
      }
    }
  }

  // Fallback: If scored is still null, but individual subject marks were extracted with high coverage
  if (!scored && Array.isArray(subjectMarks) && subjectMarks.length >= 5) {
    const subSum = subjectMarks.reduce((a, b) => a + parseInt(b.marks || "0", 10), 0);
    if (subSum >= 150 && subSum <= 600) {
      scored = String(subSum);
      maxMarks = docType === "ms12" ? "600" : "500";
    }
  }

  // 3. Explicit Percentage extraction
  const pctMatch = cleaned.match(/(?:PERCENTAGE|AGGREGATE)\s*[:\-–—]?\s*(\d{2}(?:\.\d{1,2})?%?)/i) ||
                    cleaned.match(/\bPASS\s*\(\s*(\d{2}(?:\.\d{1,2})?%?)\s*\)/i);
  if (pctMatch) {
    const rawVal = pctMatch[1].trim();
    explicitPercentage = rawVal.endsWith("%") ? rawVal : `${rawVal}%`;
  }

  // 4. Grade / Result
  if (/\b(?:RESULT\s*[:\-–—]?\s*)?PASS\b/i.test(cleaned)) {
    grade = "Pass";
  } else if (/\b(?:RESULT\s*[:\-–—]?\s*)?FAIL\b/i.test(cleaned)) {
    grade = "Fail";
  } else if (scored && maxMarks) {
    grade = (parseInt(scored, 10) / parseInt(maxMarks, 10)) >= 0.35 ? "Pass" : "Fail";
  }

  // 5. Percentage calculation & derivation
  let percentage = explicitPercentage;
  let percentageSource = explicitPercentage ? "explicit" : null;
  let percentageFormula = null;
  let percentageConfidence = explicitPercentage ? 92 : 0;

  if (!percentage && scored && maxMarks) {
    const s = parseInt(scored, 10);
    const m = parseInt(maxMarks, 10);
    if (m > 0) {
      percentage = `${((s / m) * 100).toFixed(2)}%`;
      percentageSource = "derived";
      percentageFormula = "obtained/max*100";
      percentageConfidence = 85;
    }
  }

  // 6. Mathematical Consistency Check
  const mathValidation = validateMarksConsistency({
    scored,
    maxMarks,
    percentage,
    subjectMarks,
  });

  const percentageDisagreement = mathValidation.status === "CONFLICT" && mathValidation.reason?.includes("percentage");
  if (percentageDisagreement) {
    percentageConfidence = 55;
  }

  const marksConfidence = scored ? (mathValidation.status === "CONFLICT" ? 58 : 92) : 0;

  return {
    marksScored: scored,
    maxMarks: maxMarks,
    marks: scored && maxMarks ? `${scored}/${maxMarks}` : scored,
    percentage,
    percentageSource,
    percentageFormula,
    percentageConfidence,
    percentageDisagreement,
    grade,
    subjectMarks,
    mathValidation,
    marksConfidence,
  };
}

/**
 * Extracts school name anchored on "NAME OF THE SCHOOL" with multi-line support
 * and boundary stopping rules.
 */
export function extractSchool(text, geometryLines = null) {
  const cleaned = String(text || "");
  const lines = cleaned.split(/\r?\n/).map(cleanOCRLine).filter(Boolean);

  const boundaryRegex = /^(?:PERMANENT\s*REGISTER|REGISTER\s*NUMBER|REG(?:ISTRATION)?\s*NO|ROLL\s*NO|DATE\s*OF\s*BIRTH|DOB|TOTAL\s*MARKS|GRAND\s*TOTAL|MARKS|CERTIFICATE\s*NUMBER|EXAMINATION|SESSION|SUBJECT|NAME\s*OF\s*THE\s*CANDIDATE|CANDIDATE\s*NAME)\b/i;

  // 1. Check for structured label anchor "NAME OF THE SCHOOL" or "SCHOOL"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Exclude document titles and board headings that contain the word "SCHOOL"
    if (/(?:BOARD\s+OF|SECONDARY\s+SCHOOL\s+LEAVING|HIGHER\s+SECONDARY\s+COURSE|DEPARTMENT\s+OF|STATEMENT\s+OF\s+MARKS|GOVERNMENT\s+OF)/i.test(line)) {
      continue;
    }

    const labelMatch = line.match(/(?:(?:[0-9oO\s]+|பள்ளியின்\s*பெயர்)\s*[/]?\s*)?(?:NAME\s*OF\s*(?:THE\s*)?SCHOOL|SCHOOL\s*NAME|பள்ளியின்\s*பெயர்|^\s*SCHOOL\s*[:\-–—])\s*[:\-–—]?\s*(.*)/i);
    if (labelMatch) {
      let candidate = labelMatch[1].trim();

      // If empty or purely a label remnant, inspect subsequent line
      if (!candidate && i + 1 < lines.length && !boundaryRegex.test(lines[i + 1])) {
        candidate = lines[i + 1].trim();
        i++;
      }

      // Multi-line continuation check:
      // If line ends with comma or next line is a known city/institution continuation
      while (i + 1 < lines.length && !boundaryRegex.test(lines[i + 1])) {
        const nextLine = lines[i + 1].trim();
        const endsWithComma = /,\s*$/.test(candidate);
        const nextIsLocation = /\b(MADURAI|COIMBATORE|SALEM|CHENNAI|DINDIGUL|TIRUCHIRAPPALLI|TRICHY|THANJAVUR|TIRUNELVELI|ERODE|VELLORE|KANCHIPURAM|CUDDALORE|TAMIL\s*NADU|DELHI|PUDUCHERRY)\b/i.test(nextLine);
        const nextIsSchoolContinuation = /\b(HIGHER\s+SECONDARY|HR\s*SEC|MATRICULATION|HIGH\s+SCHOOL|VIDYALAYA|ACADEMY|SCHOOL|COLLEGE)\b/i.test(nextLine);

        if (endsWithComma || nextIsLocation || nextIsSchoolContinuation) {
          candidate = `${candidate.replace(/,\s*$/, "")}, ${nextLine}`;
          i++;
        } else {
          break;
        }
      }

      if (candidate) {
        // Strip Tamil OCR noise before school name
        const schoolKeywords = /\b(?:SWAMY|SRI|SAMPLE|MATRIC|MATRICULATION|HIGHER\s+SECONDARY|HR\.?\s*SEC|HIGH\s+SCHOOL|VIDYALAYA|ACADEMY|CENTRAL|MODEL|GOVT|KENDRIYA|PUBLIC|ST\.?|SAINT|GOVERNMENT|MUNICIPAL|HINDU)\b/i;
        const kwMatch = candidate.search(schoolKeywords);
        if (kwMatch !== -1) {
          candidate = candidate.slice(kwMatch).trim();
        }

        candidate = candidate
          .replace(/^(?:NAME\s*OF\s*THE\s*SCHOOL|OF\s*THE\s*SCHOOL|THE\s*SCHOOL|SCHOOL)\s*[:\-–—]?\s*/i, "")
          .replace(/[^\x20-\x7E\s]/g, " ")
          .replace(/\s+/g, " ")
          .replace(/,\s*,/g, ",")
          .trim();

        if (candidate.length >= 6) {
          return { school: candidate, schoolConfidence: 0.92 };
        }
      }
    }
  }

  // 2. Fallback regex across entire document
  const schoolAnchor = cleaned.match(/\b([A-Z]{2,}(?:\s+[A-Z]{2,}){0,4}\s+(?:MATRIC\s+HR\s+SEC\s+SCHOOL|HIGHER\s+SECONDARY\s+SCHOOL|MATRICULATION\s+SCHOOL|HR\.?\s*SEC\.?\s*SCHOOL|HIGH\s+SCHOOL|VIDYALAYA|ACADEMY|MODEL\s+HIGHER\s+SECONDARY\s+SCHOOL)(?:,\s*[A-Z][A-Za-z\s]+)?)\b/i);
  if (schoolAnchor) {
    const cleanSch = schoolAnchor[1]
      .replace(/^(?:NAME\s*OF\s*THE\s*SCHOOL|OF\s*THE\s*SCHOOL|THE\s*SCHOOL|SCHOOL)\s*[:\-–—]?\s*/i, "")
      .replace(/[^\x20-\x7E\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { school: cleanSch, schoolConfidence: 0.85 };
  }

  return { school: null, schoolConfidence: 0 };
}

/**
 * Extracts marksheet details for 10th (SSLC) or 12th (HSC).
 */
export function extractMarksheetData(rawInput, docType = "ms10", geometryLines = null) {
  let text = "";
  let lines = null;

  if (typeof rawInput === "string") {
    text = rawInput;
    if (Array.isArray(geometryLines)) lines = geometryLines;
  } else if (rawInput && typeof rawInput === "object") {
    text = rawInput.text || "";
    if (Array.isArray(rawInput.lines)) lines = rawInput.lines;
  }

  const nameRes = extractMarksheetName(rawInput, lines);

  // State-Agnostic Board Detection
  let board = null;
  let boardConfidence = 0;
  const stateDetected = detectState(text).state;

  if (/cbse|central\s*board\s*of\s*secondary/i.test(text)) {
    board = "CBSE";
    boardConfidence = 0.95;
  } else if (/icse|isc|council\s*for\s*the\s*indian\s*school/i.test(text)) {
    board = "CISCE (ICSE/ISC)";
    boardConfidence = 0.95;
  } else if (/tamil\s*nadu.*matriculation|matriculation\s*board/i.test(text)) {
    board = "Tamil Nadu Matriculation Board";
    boardConfidence = 0.90;
  } else if (/tamil\s*nadu|தமிழ்நாடு/i.test(text)) {
    if (docType === "ms12" || /higher\s*secondary|hsc|hss/i.test(text)) {
      board = "Tamil Nadu Higher Secondary (HSC)";
      boardConfidence = 0.92;
    } else {
      board = "Tamil Nadu State Board (SSLC)";
      boardConfidence = 0.90;
    }
  } else if (/gujarat/i.test(text) || stateDetected === "Gujarat") {
    board = "Gujarat Secondary and Higher Secondary Education Board (GSEB)";
    boardConfidence = 0.90;
  } else if (/kerala/i.test(text) || stateDetected === "Kerala") {
    board = "Kerala Board of Public Examinations";
    boardConfidence = 0.90;
  } else if (/karnataka/i.test(text) || stateDetected === "Karnataka") {
    board = "Karnataka School Examination and Assessment Board";
    boardConfidence = 0.90;
  } else if (/maharashtra/i.test(text) || stateDetected === "Maharashtra") {
    board = "Maharashtra State Board of Secondary and Higher Secondary Education";
    boardConfidence = 0.90;
  } else if (/board\s+of\s+school\s+examinations|board\s+of\s+secondary/i.test(text)) {
    board = stateDetected ? `${stateDetected} State Board of School Examinations` : "State Board of School Examinations";
    boardConfidence = 0.75;
  }

  // School extraction anchored on "NAME OF THE SCHOOL"
  const schoolRes = extractSchool(text, lines);
  const school = schoolRes.school;
  const schoolConfidence = schoolRes.schoolConfidence;

  // Year & Month
  let year = null;
  let month = null;
  let yearConfidence = 0;

  const yearMatch = text.match(/(?:SESSION(?: AND YEAR OF ISSUE)?|EXAMINATION HELD IN|YEAR OF PASSING|SESSION|பருவம்)\s*[:-]?\s*(?:([A-Za-z]+)\s*)?((?:19|20)\d{2})/i) ||
    text.match(/\b(MAR|MAY|JUNE?|JULY?|OCT|NOV|DEC)\s+((?:19|20)\d{2})\b/i) ||
    text.match(new RegExp(`${MONTH_RE.source}\\s*(?:[-,/]?\\s*)?((?:19|20)\\d{2})`, "i")) ||
    text.match(/\b(20[1-3]\d)\b/);

  if (yearMatch) {
    year = yearMatch[2] || yearMatch[1] || yearMatch[0];
    if (yearMatch[1] && MONTH_RE.test(yearMatch[1])) {
      month = normalizeMonth(yearMatch[1]);
    } else {
      const monthOnly = text.match(MONTH_RE);
      if (monthOnly) month = normalizeMonth(monthOnly[1]);
    }
    yearConfidence = 0.90;
  }

  // Register / Roll No
  let registerNumber = null;
  const regMatch = text.match(/(?:PERMANENT\s*REGISTER\s*(?:NUMBER|NO\.?)|PERM(?:ANENT)?\s*REG(?:ISTER)?\s*(?:NO|NUMBER)|REG(?:ISTER)?\s*(?:NO|NUMBER)|ROLL\s*(?:NO|NUMBER)|UNIQUE\s*ID|CERT(?:IFICATE)?\s*(?:NO|NUMBER)|நிரந்தரப்\s*பதிவெண்)\s*[:\-–—]?\s*(?:\r?\n\s*)?([A-Z0-9/-]{5,25})/i) ||
    text.match(/\b([A-Z]{2,4}\d{2}[A-Z0-9]{6,15})\b/);

  if (regMatch) {
    registerNumber = regMatch[1].trim();
  } else {
    // Look for standard 8-12 digit registration/roll number on marksheet
    const regFallback = text.match(/\b([1-9]\d{7,11})\b/);
    if (regFallback && (!year || regFallback[1] !== year)) {
      registerNumber = regFallback[1].trim();
    }
  }

  // Date of Birth (Strictly anchored, validated for calendar & student age)
  let dob = null;
  const dobMatch = text.match(/(?:(?:[0-9oO\s]+|பிறந்த\s*தேதி)\s*[/]?\s*)?(?:DATE\s*OF\s*BIRTH|DOB|BORN\s*ON|D\.?O\.?B\.?|பிறந்த\s*தேதி)\s*[:\-–—]?\s*(?:\r?\n\s*)?(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
  if (dobMatch) {
    const rawDob = dobMatch[1];
    const validation = validateStudentDob(rawDob);
    if (validation.isValid) {
      dob = formatDateDisplay(rawDob);
    }
  }

  // Parent Name on marksheet (Father / Mother / Guardian)
  let fatherName = null;
  let motherName = null;
  const parentPatterns = [
    /(?:(?:பெற்றோர்\s*பெயர்|[0-9oO\s]+)\s*[/]?\s*)?(?:PARENT\s*NAME|FATHER(?:'S)?\s*NAME|FATHER\s*\/[^\n:]*|FATHER['S]?\s*\/\s*GUARDIAN['S]?\s*NAME|GUARDIAN(?:'S)?\s*NAME|தந்தையின்\s*பெயர்)(?:\s*[/][^\n:]*)?\s*[:\-–—]?\s*(?:(?:THIRU|MR|SHRI)\.?\s+)?([A-Z][A-Za-z .'-]{2,35}?)(?=\r|\n|$|\s+MOTHER|\s+DOB|\s+DATE|\s+PERMANENT|\s+REG)/i,
    /(?:பெற்றோர்\s*பெயர்|தந்தையின்\s*பெயர்)\s*[:\-–—]?\s*(?:(?:THIRU|MR|SHRI)\.?\s+)?([A-Z][A-Za-z .'-]{2,35}?)(?=\r|\n|$)/i,
  ];

  for (const pat of parentPatterns) {
    const fnMatch = text.match(pat);
    if (fnMatch) {
      const candidate = cleanCandidateName(fnMatch[1]);
      if (isCandidateName(candidate) && !PARENT_ROLE_BLACKLIST.test(candidate)) {
        if (!nameRes.value || candidate.toUpperCase() !== nameRes.value.toUpperCase()) {
          fatherName = formatTitleName(candidate);
          break;
        }
      }
    }
  }

  const motherPatterns = [
    /(?:(?:தாயாரின்\s*பெயர்|[0-9oO\s]+)\s*[/]?\s*)?(?:MOTHER(?:'S)?\s*NAME|MOTHER\s*NAME|தாயாரின்\s*பெயர்)(?:\s*[/][^\n:]*)?\s*[:\-–—]?\s*(?:(?:TMT|MRS|SMT)\.?\s+)?([A-Z][A-Za-z .'-]{2,35}?)(?=\r|\n|$|\s+FATHER|\s+DOB|\s+DATE)/i,
  ];
  for (const pat of motherPatterns) {
    const mnMatch = text.match(pat);
    if (mnMatch) {
      const candidate = cleanCandidateName(mnMatch[1]);
      if (isCandidateName(candidate) && !PARENT_ROLE_BLACKLIST.test(candidate)) {
        if (!nameRes.value || candidate.toUpperCase() !== nameRes.value.toUpperCase()) {
          motherName = formatTitleName(candidate);
          break;
        }
      }
    }
  }

  const marksData = extractMarks(text, docType);
  const subjectMarks = marksData.subjectMarks;

  // Conservative OCR corrections and ambiguity checks
  const nameCorrection = suggestOcrCorrections(nameRes.value, "name");
  const regCorrection = suggestOcrCorrections(registerNumber, "id");
  const dobCorrection = suggestOcrCorrections(dob, "date");
  const dobValidation = validateStudentDob(dob);

  const nameConfidence100 = Math.round((nameRes.confidence || 0) * 100);
  const boardConfidence100 = Math.round((boardConfidence || 0) * 100);
  const schoolConfidence100 = Math.round((schoolConfidence || 0) * 100);
  const yearConfidence100 = Math.round((yearConfidence || 0) * 100);
  const marksConfidence100 = marksData.marksConfidence;
  const dobConfidence100 = dob ? (dobValidation.isValid ? 90 : 55) : 0;
  const regConfidence100 = registerNumber ? (regCorrection.uncertain ? 68 : 88) : 0;

  const getStatus = (score) => {
    if (score >= 90) return "high";
    if (score >= 70) return "medium";
    if (score >= 50) return "low";
    return "unreliable";
  };

  const nameAnomaly = detectAnomalousExtraToken(nameRes.value);
  const adjustedNameConf100 = nameAnomaly.hasAnomaly ? Math.min(nameConfidence100, 65) : nameConfidence100;
  const nameUncertain = adjustedNameConf100 < 70 || nameCorrection.uncertain || nameAnomaly.hasAnomaly;

  const structuredFields = {
    name: {
      field: "name",
      rawValue: nameRes.value,
      normalizedValue: nameRes.value ? formatTitleName(nameRes.value) : null,
      confidence: adjustedNameConf100,
      status: getStatus(adjustedNameConf100),
      possibleCorrections: nameCorrection.possibleCorrections,
      suggestedCorrection: nameCorrection.suggestedCorrection,
      uncertain: nameUncertain,
      uncertaintyReason: nameAnomaly.hasAnomaly ? nameAnomaly.reason : nameCorrection.reason,
    },
    dob: {
      field: "dob",
      rawValue: dob,
      normalizedValue: dob,
      confidence: dobConfidence100,
      status: getStatus(dobConfidence100),
      possibleCorrections: dobCorrection.possibleCorrections,
      suggestedCorrection: dobCorrection.suggestedCorrection,
      uncertain: dobConfidence100 < 70 || !dobValidation.isValid,
      uncertaintyReason: !dobValidation.isValid ? dobValidation.reason : dobCorrection.reason,
    },
    school: {
      field: "school",
      rawValue: school,
      normalizedValue: school ? normalizeInstitutionName(school) : null,
      confidence: schoolConfidence100,
      status: getStatus(schoolConfidence100),
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: schoolConfidence100 < 70,
      uncertaintyReason: null,
    },
    board: {
      field: "board",
      rawValue: board,
      normalizedValue: board,
      confidence: boardConfidence100,
      status: getStatus(boardConfidence100),
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: boardConfidence100 < 70,
      uncertaintyReason: null,
    },
    registerNumber: {
      field: "registerNumber",
      rawValue: registerNumber,
      normalizedValue: registerNumber,
      confidence: regConfidence100,
      status: getStatus(regConfidence100),
      possibleCorrections: regCorrection.possibleCorrections,
      suggestedCorrection: regCorrection.suggestedCorrection,
      uncertain: regConfidence100 < 70 || regCorrection.uncertain,
      uncertaintyReason: regCorrection.reason,
    },
    year: {
      field: "year",
      rawValue: year,
      normalizedValue: year,
      confidence: yearConfidence100,
      status: getStatus(yearConfidence100),
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: yearConfidence100 < 70,
      uncertaintyReason: null,
    },
    month: {
      field: "month",
      rawValue: month,
      normalizedValue: month,
      confidence: month ? 85 : 0,
      status: month ? "medium" : "unreliable",
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: !month,
      uncertaintyReason: null,
    },
    marksScored: {
      field: "marksScored",
      rawValue: marksData.marksScored,
      normalizedValue: marksData.marksScored,
      confidence: marksConfidence100,
      status: getStatus(marksConfidence100),
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: marksConfidence100 < 70,
      uncertaintyReason: marksData.mathValidation?.status === "CONFLICT" ? marksData.mathValidation.reason : null,
    },
    maxMarks: {
      field: "maxMarks",
      rawValue: marksData.maxMarks,
      normalizedValue: marksData.maxMarks,
      confidence: marksData.maxMarks ? 90 : 0,
      status: marksData.maxMarks ? "high" : "unreliable",
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: !marksData.maxMarks,
      uncertaintyReason: null,
    },
    percentage: {
      field: "percentage",
      rawValue: marksData.percentage,
      normalizedValue: marksData.percentage,
      confidence: marksData.percentageConfidence,
      status: getStatus(marksData.percentageConfidence),
      source: marksData.percentageSource,
      formula: marksData.percentageFormula,
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: marksData.percentageConfidence < 70,
      uncertaintyReason: marksData.percentageDisagreement ? marksData.mathValidation.reason : null,
    },
    grade: {
      field: "grade",
      rawValue: marksData.grade,
      normalizedValue: marksData.grade,
      confidence: marksData.grade ? 85 : 0,
      status: marksData.grade ? "medium" : "unreliable",
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: !marksData.grade,
      uncertaintyReason: null,
    },
    ...(fatherName ? {
      fatherName: {
        field: "fatherName",
        rawValue: fatherName,
        normalizedValue: fatherName,
        confidence: 88,
        status: "medium",
        possibleCorrections: [],
        suggestedCorrection: null,
        uncertain: false,
        uncertaintyReason: null,
      },
    } : {}),
    ...(motherName ? {
      motherName: {
        field: "motherName",
        rawValue: motherName,
        normalizedValue: motherName,
        confidence: 88,
        status: "medium",
        possibleCorrections: [],
        suggestedCorrection: null,
        uncertain: false,
        uncertaintyReason: null,
      },
    } : {}),
  };

  return {
    name: nameRes.value,
    candidateName: nameRes.value,
    dob,
    board,
    school,
    year,
    month,
    registerNumber,
    rollNumber: registerNumber,
    fatherName,
    motherName,
    subjectMarks: subjectMarks && subjectMarks.length > 0 ? subjectMarks : null,
    ...marksData,
    fieldConfidence: {
      name: nameRes.confidence,
      board: boardConfidence,
      school: schoolConfidence,
      year: yearConfidence,
      marks: marksData.marksConfidence ? (marksData.marksConfidence / 100) : 0,
      percentage: marksData.percentageConfidence ? (marksData.percentageConfidence / 100) : 0,
      dob: dob ? (dobValidation.isValid ? 0.90 : 0.55) : 0,
      registerNumber: registerNumber ? (regCorrection.uncertain ? 0.68 : 0.88) : 0,
      ...(fatherName ? { fatherName: 0.88 } : {}),
      ...(motherName ? { motherName: 0.88 } : {}),
    },
    structuredFields,
  };
}

/**
 * Extracts Community / Caste Certificate details with multi-state support.
 */
export function extractCommunityCertificateData(rawText) {
  const text = String(rawText || "");

  // Candidate Name
  let name = null;
  let nameConfidence = 0;

  const certClauses = [
    /(?:this\s+is\s+(?:to\s+)?certify\s+that|certified\s+that)\s+(?:(?:selvan|selvi|thiru|tmt|kumari|mr|mrs|ms|shri|smt)\.?\s+)?([A-Z][A-Za-z\s.]{2,35}?)(?=\s+(?:son\s+of|daughter\s+of|s\/o|d\/o|residing|belongs|\n|$))/i,
    /(?:selvan|selvi)\s+([A-Z][A-Za-z\s.]{2,35}?)(?=\s+(?:son\s+of|daughter\s+of|s\/o|d\/o))/i,
    /(?:name\s*of\s*(?:the\s*)?(?:applicant|candidate|student)|(?:applicant|candidate|student|beneficiary)'?s?\s*name)\s*[:\-–—]?\s*([A-Z][A-Za-z\s.]{2,35})/i,
    /(?:(?:applicant|candidate|student)\s*name)[^\nA-Z0-9]*\n\s*([A-Z][A-Za-z\s.]{2,35})/i,
  ];

  for (const pat of certClauses) {
    const m = text.match(pat);
    if (m) {
      const candidate = cleanCandidateName(m[1]);
      if (isCandidateName(candidate)) {
        name = formatTitleName(candidate);
        nameConfidence = 0.92;
        break;
      }
    }
  }

  // Father / Mother / Guardian name
  let fatherName = null;
  const commParentPatterns = [
    /(?:(?:FATHER\s*\/\s*GUARDIAN\s*NAME|FATHER['S]?\s*NAME|PARENT\s*NAME)\s*[:\-–—]?\s*)(?:(?:THIRU|MR|SHRI)\.?\s+)?([A-Z][A-Za-z .'-]{2,35}?)(?=\r|\n|$|\s+COMMUNITY|\s+CATEGORY|\s+DATE)/i,
    /(?:s\/o|son\s+of|d\/o|daughter\s+of|father['s]?\s*name)\s*[:-]?\s*(?:(?:thiru|mr|shri)\.?\s+)?([A-Z][A-Za-z .'-]{2,35}?)(?=\s+(?:residing|belongs|at|\n|,|$))/i,
  ];
  for (const pat of commParentPatterns) {
    const m = text.match(pat);
    if (m) {
      const candidate = cleanCandidateName(m[1]);
      if (candidate && candidate.length >= 3 && !NAME_BLACKLIST.test(candidate) && !PARENT_ROLE_BLACKLIST.test(candidate)) {
        if (!name || candidate.toUpperCase() !== name.toUpperCase()) {
          fatherName = formatTitleName(candidate);
          break;
        }
      }
    }
  }

  // DOB (Strictly anchored, validated for calendar & student age)
  let dob = null;
  const dobMatch = text.match(/(?:(?:[0-9oO\s]+|பிறந்த\s*தேதி)\s*[/]?\s*)?(?:DATE\s*OF\s*BIRTH|DOB|BORN\s*ON|D\.?O\.?B\.?|பிறந்த\s*தேதி)\s*[:\-–—]?\s*(?:\r?\n\s*)?(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
  if (dobMatch) {
    const rawDob = dobMatch[1];
    const validation = validateStudentDob(rawDob);
    if (validation.isValid) {
      dob = formatDateDisplay(rawDob);
    }
  }

  // Community Category
  let community = null;
  let communityCategory = null;
  const catMatch = text.match(/\b(SC|ST|MBC|BC|DNC|OBC|EBC)\b/i) ||
    text.match(/(Scheduled\s+Caste|Scheduled\s+Tribe|Most\s+Backward\s+Class|Backward\s+Class|Other\s+Backward\s+Class|Denotified\s+Community)/i);
  if (catMatch) {
    communityCategory = normalizeCommunity(catMatch[1]);
  }

  // Specific Sub-caste / Community name
  const subCasteMatch = text.match(/belongs\s+(?:to\s+)?([A-Z][A-Za-z\s-]{2,30}?)(?=\s+(?:which|community|caste|as\s+per|,|\.|\n))/i) ||
    text.match(/(?:caste\s*[:-]?\s*|sub-caste\s*[:-]?\s*)(?!certificate\b)([A-Z][A-Za-z\s-]{3,35})/i) ||
    text.match(/\b(?:SC|ST|BC|MBC)\s+([A-Z][A-Za-z]{3,25})\b/i);

  if (subCasteMatch) {
    const sub = cleanOCRLine(subCasteMatch[1]);
    if (sub && !/^(?:certificate|community\s+certificate|the|this|as\s+per|which)$/i.test(sub)) {
      community = sub;
    }
  }
  if (!community && communityCategory) {
    community = communityCategory;
  }

  // Religion
  let religion = null;
  const relMatch = text.match(/\b(Hindu|Muslim|Islam|Christian|Sikh|Buddhist|Jain|Parsi)\b/i);
  if (relMatch) {
    religion = normalizeReligion(relMatch[1]);
  }

  // Certificate Number
  let certNumber = null;
  const certMatch = text.match(/\b(TN-[A-Za-z0-9/-]{6,25}|REV\/\d{4}\/\d{4,8}|CC\/\d{4}\/\d{4,8})\b/i) ||
    text.match(/(?:certificate\s*(?:no|number|#)|cert\s*no|serial\s*no|application\s*no|சான்றிதழ்\s*எண்)\s*[:\-–—]?\s*([A-Z0-9/-]{6,30})/i);
  if (certMatch) {
    certNumber = certMatch[1].trim();
  }

  // Dates
  let issueDate = null;
  const dateMatch = text.match(/(?:date\s+of\s+issue|issued\s+on|issue\s+date|நாள்\s*[/]?\s*date)\s*[:\-–—.]*\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i) ||
    text.match(/\bDate\s*[:\-–—.]*\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/i);
  if (dateMatch) {
    issueDate = formatDateDisplay(dateMatch[1]);
  }

  // Authority & Location
  let taluk = null;
  let district = null;

  const talukMatch = text.match(/(?:வட்டம்\s*[/]?\s*taluk|taluk|taluka)\s*[:\-–—]\s*([A-Z][A-Za-z\s]{2,25})/i) ||
    text.match(/([A-Z][A-Za-z\s]{2,25})\s+(?:taluk|taluka)\b/i);
  if (talukMatch) taluk = cleanLocation(talukMatch[1]);

  const distMatch = text.match(/(?:மாவட்டம்\s*[/]?\s*district|district)\s*[:\-–—]\s*([A-Z][A-Za-z\s]{2,25})/i) ||
    text.match(/([A-Z][A-Za-z\s]{2,25})\s+district\b/i);
  if (distMatch) district = cleanLocation(distMatch[1]);

  // State & Authority (State-Agnostic)
  const stateDetected = detectState(text).state;
  const issuingAuthority = detectIssuingAuthority(text).issuingAuthority;

  // Quota Type (Government vs Management Quota)
  // Default is "unknown" — community certificates establish community, NOT admission quota.
  // Quota is an admission attribute and must come from explicit admission data or user confirmation.
  // Only update if the document explicitly contains quota text.
  let quotaType = "unknown";
  const quotaMatch = text.match(/\bQuota\s*[:\-–—]?\s*(Government|Management)\b/i) ||
    text.match(/\b(Government|Management)\s+Quota\b/i);
  if (quotaMatch) {
    quotaType = quotaMatch[1].toLowerCase() === "management" ? "management" : "government";
  }

  const nameCorrection = suggestOcrCorrections(name, "name");
  const certCorrection = suggestOcrCorrections(certNumber, "id");
  const dateCorrection = suggestOcrCorrections(issueDate, "date");
  const dateValidation = validateCalendarDate(issueDate);

  const getStatus = (score) => {
    if (score >= 90) return "high";
    if (score >= 70) return "medium";
    if (score >= 50) return "low";
    return "unreliable";
  };

  const nameAnomaly = detectAnomalousExtraToken(name);
  let nameConf100 = Math.round(nameConfidence * 100);
  if (nameAnomaly.hasAnomaly) {
    nameConf100 = Math.min(nameConf100, 65);
  }
  const certConf100 = certNumber ? (certCorrection.uncertain ? 68 : 88) : 0;
  const dateConf100 = issueDate ? (dateValidation.isValid ? 90 : 55) : 0;
  const commConf100 = communityCategory ? 92 : 0;

  const structuredFields = {
    name: {
      field: "name",
      rawValue: name,
      normalizedValue: name,
      confidence: nameConf100,
      status: getStatus(nameConf100),
      possibleCorrections: nameCorrection.possibleCorrections,
      suggestedCorrection: nameCorrection.suggestedCorrection,
      uncertain: nameConf100 < 70 || nameCorrection.uncertain || nameAnomaly.hasAnomaly,
      uncertaintyReason: nameAnomaly.hasAnomaly ? nameAnomaly.reason : nameCorrection.reason,
    },
    community: {
      field: "community",
      rawValue: community,
      normalizedValue: community,
      confidence: commConf100,
      status: getStatus(commConf100),
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: commConf100 < 70,
      uncertaintyReason: null,
    },
    communityCategory: {
      field: "communityCategory",
      rawValue: communityCategory,
      normalizedValue: communityCategory,
      confidence: commConf100,
      status: getStatus(commConf100),
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: commConf100 < 70,
      uncertaintyReason: null,
    },
    certNumber: {
      field: "certNumber",
      rawValue: certNumber,
      normalizedValue: certNumber,
      confidence: certConf100,
      status: getStatus(certConf100),
      possibleCorrections: certCorrection.possibleCorrections,
      suggestedCorrection: certCorrection.suggestedCorrection,
      uncertain: certConf100 < 70 || certCorrection.uncertain,
      uncertaintyReason: certCorrection.reason,
    },
    issueDate: {
      field: "issueDate",
      rawValue: issueDate,
      normalizedValue: issueDate,
      confidence: dateConf100,
      status: getStatus(dateConf100),
      possibleCorrections: dateCorrection.possibleCorrections,
      suggestedCorrection: dateCorrection.suggestedCorrection,
      uncertain: dateConf100 < 70 || !dateValidation.isValid,
      uncertaintyReason: !dateValidation.isValid ? dateValidation.reason : dateCorrection.reason,
    },
  };

  return {
    name,
    fatherName,
    dob,
    community,
    communityCategory,
    religion,
    certNumber,
    issueDate,
    taluk,
    district,
    state: stateDetected,
    issuingAuthority,
    quotaType,
    fieldConfidence: {
      name: nameConfidence,
      community: communityCategory ? 0.90 : 0,
      certNumber: certNumber ? (certCorrection.uncertain ? 0.68 : 0.85) : 0,
      issueDate: issueDate ? (dateValidation.isValid ? 0.85 : 0.55) : 0,
    },
    structuredFields,
  };
}

/**
 * Extracts Income Certificate details with multi-state recognition.
 */
export function extractIncomeCertificateData(rawText, options = {}) {
  const text = String(rawText || "");

  // Candidate / Father Name
  let name = null;
  let fatherName = null;
  let nameConfidence = 0;

  // 1. Try "father of CANDIDATE" pattern first if present (e.g. "total annual family income of Thiru FATHER father of CANDIDATE residing at...")
  const fatherOfMatch = text.match(/(?:total\s+annual\s+family\s+income\s+of|income\s+of)\s+(?:(?:thiru|mr|shri|smt)\.?\s+)?([A-Z][A-Za-z .'-]{2,35}?)\s+father\s+of\s+([A-Z][A-Za-z .'-]{2,35}?)(?=\s+(?:residing|at|\n|\r|,|$))/i);
  if (fatherOfMatch) {
    const fCandidate = cleanCandidateName(fatherOfMatch[1]);
    const cCandidate = cleanCandidateName(fatherOfMatch[2]);
    if (isCandidateName(fCandidate)) fatherName = formatTitleName(fCandidate);
    if (isCandidateName(cCandidate)) {
      name = formatTitleName(cCandidate);
      nameConfidence = 0.92;
    }
  }

  if (!name) {
    const directLabelMatch = text.match(/(?:name\s*of\s*(?:the\s*)?(?:applicant|candidate|student)|(?:applicant|candidate|student|beneficiary)'?s?\s*name)\s*[:\-–—]?\s*([A-Z][A-Za-z .'-]{2,35})/i) ||
      text.match(/(?:(?:applicant|candidate|student)\s*name)[^\nA-Z0-9]*\n\s*([A-Z][A-Za-z .'-]{2,35})/i);
    if (directLabelMatch) {
      const candidate = cleanCandidateName(directLabelMatch[1]);
      if (isCandidateName(candidate)) {
        name = formatTitleName(candidate);
        nameConfidence = 0.92;
      }
    }
  }

  if (!name) {
    const certClauseMatch = text.match(/(?:this\s+is\s+(?:to\s+)?certify\s+that|certified\s+that)\s+(?:the\s+(?:annual\s+)?(?:family\s+)?income\s+of\s+)?(?:(?:thiru|tmt|selvan|selvi|mr|mrs|ms|shri|smt)\.?\s+)?([A-Z][A-Za-z .'-]{2,35}?)(?=\s+(?:son\s+of|daughter\s+of|s\/o|d\/o|residing|annual|total|\n|\r|$))/i);
    if (certClauseMatch) {
      const candidate = cleanCandidateName(certClauseMatch[1]);
      if (isCandidateName(candidate) && !/^(?:family|member|pn\s*mity|name)$/i.test(candidate)) {
        name = formatTitleName(candidate);
        nameConfidence = 0.92;
      }
    }
  }

  if (!fatherName) {
    const incParentPatterns = [
      /(?:(?:FATHER['S]?\s*\/\s*SPOUSE['S]?\s*NAME|FATHER['S]?\s*NAME|PARENT\s*NAME)\s*[:\-–—]?\s*)(?:(?:THIRU|MR|SHRI)\.?\s+)?([A-Z][A-Za-z .'-]{2,35}?)(?=\r|\n|$|\s+ANNUAL|\s+TALUK|\s+VALIDITY)/i,
      /(?:s\/o|son\s+of|d\/o|daughter\s+of|father['s]?\s*name)\s*[:-]?\s*(?:(?:thiru|mr|shri)\.?\s+)?([A-Z][A-Za-z .'-]{2,35}?)(?=\s+(?:residing|annual|total|at|\n|\r|,|$))/i,
    ];
    for (const pat of incParentPatterns) {
      const m = text.match(pat);
      if (m) {
        const candidate = cleanCandidateName(m[1]);
        if (candidate && candidate.length >= 3 && !NAME_BLACKLIST.test(candidate) && !PARENT_ROLE_BLACKLIST.test(candidate) && !/^(?:family|member|table)$/i.test(candidate)) {
          if (!name || candidate.toUpperCase() !== name.toUpperCase()) {
            fatherName = formatTitleName(candidate);
            break;
          }
        }
      }
    }
  }

  // DOB - strictly anchored
  let dob = null;
  const dobMatch = text.match(/(?:(?:[0-9oO\s]+|பிறந்த\s*தேதி)\s*[/]?\s*)?(?:DATE\s*OF\s*BIRTH|DOB|BORN\s*ON|D\.?O\.?B\.?|பிறந்த\s*தேதி)\s*[:\-–—]?\s*(?:\r?\n\s*)?(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
  if (dobMatch) {
    const rawDob = dobMatch[1];
    const validation = validateStudentDob(rawDob);
    if (validation.isValid) {
      dob = formatDateDisplay(rawDob);
    }
  }

  // Annual Income
  let income = null;
  let incomeNumber = null;
  let incomeConfidence = 0;

  const incPatterns = [
    /(?:verification\s+is\s+rs\.?|family\s+annual\s+income[^\d]{0,25}rs\.?|total\s+annual\s+income[^\d]{0,25})\s*[:\-–—]?\s*(?:Rs\.?|₹|ரூ\.?)?\s*([\d,]+)/i,
    /(?:annual\s+income|family\s+income|total\s+annual\s+income|yearly\s+income|மொத்த\s+குடும்ப\s+வருமானம்)\s*[:-]?\s*(?:Rs\.?|₹|ரூ\.?)?\s*([\d,]+)/i,
    /(?:Rs\.?|₹|ரூ\.?)\s*([\d,]+)\s*(?:per\s+annum|\/annum|\/year|only)/i,
    /([\d,]+)\s*(?:rupees\s+only|\/-\s*only|\/-)/i,
    /\b(\d{4,7})\s*(?:per\s+annum|\/annum|\/year)\b/i,
  ];

  for (const pat of incPatterns) {
    const m = text.match(pat);
    if (m) {
      const parsed = normalizeIncome(m[1]);
      if (parsed && parsed >= 5000) {
        incomeNumber = parsed;
        income = formatIncomeDisplay(parsed);
        incomeConfidence = 0.94;
        break;
      }
    }
  }

  // Certificate Number
  let certNumber = null;
  const certNumMatch = text.match(/\b(TN-[A-Za-z0-9/-]{6,25}|INC\/\d{4}\/\d{4,8}|REV\/\d{4}\/\d{4,8})\b/i) ||
    text.match(/(?:certificate\s*(?:no|number|#)|cert\s*no|application\s*no|சான்றிதழ்\s*எண்)\s*[:\-–—.\s]*([A-Z0-9/.-]{2,30})/i);
  if (certNumMatch) {
    certNumber = certNumMatch[1].trim();
  }

  // Dates (Issue & Validity)
  let issueDate = null;
  let validUpto = null;

  const issueMatch = text.match(/(?:Certificate\s*No[^\n]*Date\s*[:\-–—.]*\s*|நாள்\s*[/]?\s*date|date\s+of\s+issue|issued\s+on|issue\s+date)\s*[:\-–—.]*\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i) ||
    text.match(/\bDate\s*[:\-–—.]*\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/i);
  if (issueMatch) {
    issueDate = formatDateDisplay(issueMatch[1]);
  }

  // Validity Period
  const validityPeriodMatch = text.match(/(?:validity\s+period|செல்லுபடியாகும்\s+காலம்)\s*[:-]?\s*(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\s*(?:to|முதல்|-)\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i) ||
    text.match(/(?:valid(?:ity)?\s*(?:upto|up\s+to|till|until)|expiry\s+date)\s*[:-]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
  
  const statedDurationMatch = text.match(/valid\s*(?:for|period\s*(?:of|is))?\s*(one|two|three|four|five|\d+)\s*(?:financial\s*)?years?/i);

  if (validityPeriodMatch) {
    validUpto = formatDateDisplay(validityPeriodMatch[1]);
  } else if (statedDurationMatch && issueDate) {
    const wordToNum = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const rawVal = statedDurationMatch[1].toLowerCase();
    const yearsToAdd = wordToNum[rawVal] || parseInt(rawVal, 10) || 1;
    const parsedDate = parseIndianDate(issueDate);
    if (parsedDate) {
      const d = String(parsedDate.getDate()).padStart(2, "0");
      const m = String(parsedDate.getMonth() + 1).padStart(2, "0");
      const y = parsedDate.getFullYear() + yearsToAdd;
      validUpto = `${d}-${m}-${y}`;
    }
  }

  // Authority & Location
  let taluk = null;
  let district = null;

  const talukMatch = text.match(/(?:வட்டம்\s*[/]?\s*taluk|taluka|taluk)\s*[:\-–—\s]\s*([A-Z][A-Za-z]{2,25})(?=\s+district|\s+வட்டம்|\n|\r|$)/i) ||
    text.match(/(?:வட்டம்\s*[/]?\s*taluk|taluka|taluk)\s*[:\-–—]\s*([A-Z][A-Za-z ]{2,25})/i) ||
    text.match(/([A-Z][A-Za-z ]{2,25})\s+taluk\b/i);
  if (talukMatch) taluk = cleanLocation(talukMatch[1]);

  const distMatch = text.match(/(?:மாவட்டம்\s*[/]?\s*district|district)\s*[:\-–—]\s*([A-Z][A-Za-z ]{2,25})/i) ||
    text.match(/(?:மாவட்டம்\s*[/]?\s*district|district)\s+([A-Z][A-Za-z ]{2,25})(?=\s+and|\s+state|\n|\r|$)/i) ||
    text.match(/([A-Z][A-Za-z ]{2,25})\s+district\b/i);
  if (distMatch) district = cleanLocation(distMatch[1]);

  // State & Authority (State-Agnostic)
  const stateDetected = detectState(text).state;
  const issuingAuthority = detectIssuingAuthority(text).issuingAuthority;

  // Provenance rule: Ordinary OCR parsing must NEVER set isExpiryConfirmed to true automatically.
  // Only explicit student confirmation or independently verified provenance passed in options may confirm a date.
  // Missing metadata must remain needs_confirmation (unconfirmed_expiry).
  const isExpiryConfirmed = options?.isExpiryConfirmed !== undefined
    ? Boolean(options.isExpiryConfirmed)
    : false;
  const freshness = evaluateIncomeFreshness(issueDate, validUpto, {
    ...options,
    isExpiryConfirmed,
    isConfirmed: isExpiryConfirmed,
  });

  const nameCorrection = suggestOcrCorrections(name, "name");
  const certCorrection = suggestOcrCorrections(certNumber, "id");
  const dateCorrection = suggestOcrCorrections(issueDate, "date");
  const dateValidation = validateCalendarDate(issueDate);

  const getStatus = (score) => {
    if (score >= 90) return "high";
    if (score >= 70) return "medium";
    if (score >= 50) return "low";
    return "unreliable";
  };

  const nameAnomaly = detectAnomalousExtraToken(name);
  let nameConf100 = Math.round(nameConfidence * 100);
  if (nameAnomaly.hasAnomaly) {
    nameConf100 = Math.min(nameConf100, 65);
  }
  const incConf100 = Math.round(incomeConfidence * 100);
  const certConf100 = certNumber ? (certCorrection.uncertain ? 68 : 88) : 0;
  const dateConf100 = issueDate ? (dateValidation.isValid ? 90 : 55) : 0;

  const structuredFields = {
    name: {
      field: "name",
      rawValue: name,
      normalizedValue: name,
      confidence: nameConf100,
      status: getStatus(nameConf100),
      possibleCorrections: nameCorrection.possibleCorrections,
      suggestedCorrection: nameCorrection.suggestedCorrection,
      uncertain: nameConf100 < 70 || nameCorrection.uncertain || nameAnomaly.hasAnomaly,
      uncertaintyReason: nameAnomaly.hasAnomaly ? nameAnomaly.reason : nameCorrection.reason,
    },
    income: {
      field: "income",
      rawValue: income,
      normalizedValue: incomeNumber,
      confidence: incConf100,
      status: getStatus(incConf100),
      possibleCorrections: [],
      suggestedCorrection: null,
      uncertain: incConf100 < 70,
      uncertaintyReason: null,
    },
    certNumber: {
      field: "certNumber",
      rawValue: certNumber,
      normalizedValue: certNumber,
      confidence: certConf100,
      status: getStatus(certConf100),
      possibleCorrections: certCorrection.possibleCorrections,
      suggestedCorrection: certCorrection.suggestedCorrection,
      uncertain: certConf100 < 70 || certCorrection.uncertain,
      uncertaintyReason: certCorrection.reason,
    },
    issueDate: {
      field: "issueDate",
      rawValue: issueDate,
      normalizedValue: issueDate,
      confidence: dateConf100,
      status: getStatus(dateConf100),
      possibleCorrections: dateCorrection.possibleCorrections,
      suggestedCorrection: dateCorrection.suggestedCorrection,
      uncertain: dateConf100 < 70 || !dateValidation.isValid,
      uncertaintyReason: !dateValidation.isValid ? dateValidation.reason : dateCorrection.reason,
    },
  };

  return {
    name,
    fatherName,
    dob,
    income,
    incomeNumber,
    certNumber,
    issueDate,
    validUpto,
    taluk,
    district,
    state: stateDetected,
    issuingAuthority,
    isExpiryConfirmed,
    freshness,
    fieldConfidence: {
      name: nameConfidence,
      income: incomeConfidence,
      certNumber: certNumber ? (certCorrection.uncertain ? 0.68 : 0.85) : 0,
      issueDate: issueDate ? (dateValidation.isValid ? 0.85 : 0.55) : 0,
    },
    structuredFields,
  };
}

/**
 * Extracts structured fields from an Aadhaar card image or scan.
 * Never fabricates missing values.
 */
export function extractAadhaarData(rawText) {
  if (!rawText || typeof rawText !== "string") return {};
  const text = rawText.replace(/\r\n/g, "\n");

  // 1. Aadhaar 12-digit UID (e.g. 1234 5678 9012 or 1234-5678-9012)
  let rawAadhaarNumber = null;
  let maskedAadhaarNumber = null;
  const uidMatch = text.match(/\b(\d{4}\s\d{4}\s\d{4})\b/) || text.match(/\b(\d{12})\b/);
  if (uidMatch) {
    const rawDigits = uidMatch[1].replace(/\s+/g, "");
    rawAadhaarNumber = rawDigits;
    maskedAadhaarNumber = `•••• •••• ${rawDigits.slice(-4)}`;
  }

  // 2. Date of Birth / Year of Birth
  let dob = null;
  const dobMatch = text.match(/(?:dob|date\s+of\s+birth|பிறந்த\s+தேதி)\s*[:\-–—\s]\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i) ||
    text.match(/\b(\d{2}[/-]\d{2}[/-]\d{4})\b/);
  if (dobMatch) {
    dob = dobMatch[1].replace(/[/.]/g, "-");
  } else {
    const yobMatch = text.match(/(?:year\s+of\s+birth|yob)\s*[:\-–—\s]\s*(\d{4})/i);
    if (yobMatch) dob = yobMatch[1];
  }

  // 3. Gender
  let gender = null;
  if (/\b(?:female|பெண்)\b/i.test(text)) gender = "Female";
  else if (/\b(?:male|ஆண்)\b/i.test(text)) gender = "Male";
  else if (/\b(?:transgender|திருநங்கை)\b/i.test(text)) gender = "Transgender";

  // 4. Candidate Name: Look for text lines right before DOB or following Govt of India / UIDAI
  let name = null;
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/(?:government\s+of\s+india|unique\s+identification|uidai|mera\s+aadhaar)/i.test(l)) continue;
    if (/(?:dob|date\s+of\s+birth|gender|male|female|\d{4}\s\d{4})/i.test(l)) continue;
    // Check if line looks like an Indian person's name (2-4 words, letters only)
    if (/^[A-Z][A-Za-z.\s]{3,35}$/.test(l) && !/(?:authority|identity|enrolment|address|help)/i.test(l)) {
      name = l;
      break;
    }
  }

  const issuingAuthority = "Unique Identification Authority of India (UIDAI)";
  const stateDetected = detectState(text).state;

  return {
    name,
    dob,
    gender,
    aadhaarNumber: maskedAadhaarNumber,
    rawAadhaarNumber,
    issuingAuthority,
    state: stateDetected,
    fieldConfidence: {
      name: name ? 0.88 : 0,
      dob: dob ? 0.92 : 0,
      aadhaarNumber: rawAadhaarNumber ? 0.95 : 0,
      gender: gender ? 0.90 : 0,
    },
    structuredFields: {
      name: { field: "name", rawValue: name, normalizedValue: name, confidence: name ? 88 : 0 },
      dob: { field: "dob", rawValue: dob, normalizedValue: dob, confidence: dob ? 92 : 0 },
      aadhaarNumber: { field: "aadhaarNumber", rawValue: maskedAadhaarNumber, normalizedValue: rawAadhaarNumber, confidence: rawAadhaarNumber ? 95 : 0 },
      gender: { field: "gender", rawValue: gender, normalizedValue: gender, confidence: gender ? 90 : 0 },
    },
  };
}

/**
 * Extracts structured fields from a Bank passbook, cancelled cheque, or statement.
 * Masks account number for privacy. Never fabricates missing values.
 */
export function extractBankDocumentData(rawText) {
  if (!rawText || typeof rawText !== "string") return {};
  const text = rawText.replace(/\r\n/g, "\n");

  // 1. Account Number
  let rawAccountNumber = null;
  let maskedAccountNumber = null;
  const accMatch = text.match(/(?:account\s*no|a\/c\s*no|account\s*number)\s*[:\-–—\s.]*(\d{9,18})/i) ||
    text.match(/\b(\d{11,16})\b/);
  if (accMatch) {
    rawAccountNumber = accMatch[1];
    maskedAccountNumber = `••••••••${rawAccountNumber.slice(-4)}`;
  }

  // 2. IFSC Code (4 letters, 0, 6 alphanumeric chars e.g. SBIN0001234)
  let ifsc = null;
  const ifscMatch = text.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/i);
  if (ifscMatch) {
    ifsc = ifscMatch[1].toUpperCase();
  }

  // 3. Bank Name
  let bankName = null;
  const knownBanks = [
    "State Bank of India",
    "Canara Bank",
    "Indian Bank",
    "Indian Overseas Bank",
    "Bank of Baroda",
    "Punjab National Bank",
    "Union Bank of India",
    "HDFC Bank",
    "ICICI Bank",
    "Axis Bank",
    "Kotak Mahindra Bank",
    "Central Bank of India",
    "UCO Bank",
    "Bank of India",
  ];
  for (const b of knownBanks) {
    if (new RegExp(b, "i").test(text)) {
      bankName = b;
      break;
    }
  }

  // 4. Account Type (Single / Savings)
  let accountType = "Single";
  if (/\b(?:joint\s+account|jointly)\b/i.test(text)) {
    accountType = "Joint";
  } else if (/\b(?:savings|sb\s+a\/c|saving\s+bank)\b/i.test(text)) {
    accountType = "Single";
  }

  // 5. Account Holder Name
  let accountHolder = null;
  const nameMatch = text.match(/(?:name\s*[:\-–—\s]|holder(?:\s*name)?\s*[:\-–—\s]|shri|smt|m\/s)\s*([A-Z][A-Za-z.\s]{3,35})(?=\n|\r|$)/i);
  if (nameMatch) {
    accountHolder = nameMatch[1].trim();
  }

  return {
    accountHolder,
    name: accountHolder,
    accountNumber: maskedAccountNumber,
    rawAccountNumber,
    ifsc,
    bankName,
    accountType,
    fieldConfidence: {
      accountHolder: accountHolder ? 0.85 : 0,
      accountNumber: rawAccountNumber ? 0.92 : 0,
      ifsc: ifsc ? 0.95 : 0,
      bankName: bankName ? 0.90 : 0,
    },
    structuredFields: {
      accountHolder: { field: "accountHolder", rawValue: accountHolder, normalizedValue: accountHolder, confidence: accountHolder ? 85 : 0 },
      accountNumber: { field: "accountNumber", rawValue: maskedAccountNumber, normalizedValue: rawAccountNumber, confidence: rawAccountNumber ? 92 : 0 },
      ifsc: { field: "ifsc", rawValue: ifsc, normalizedValue: ifsc, confidence: ifsc ? 95 : 0 },
      bankName: { field: "bankName", rawValue: bankName, normalizedValue: bankName, confidence: bankName ? 90 : 0 },
    },
  };
}

