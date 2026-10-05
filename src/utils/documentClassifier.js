/**
 * documentClassifier.js — SGP Multi-Signal Document Type Classifier
 * 
 * Classifies extracted text into:
 * - ms10: 10th Marksheet / SSLC
 * - ms12: 12th Marksheet / HSC / Plus Two
 * - community: Community / Caste Certificate
 * - income: Income Certificate
 * - aadhaar: Aadhaar Card
 * - bankpass: Bank Passbook
 * - unknown: Unknown / Insufficient Signals
 * 
 * State-Agnostic: Decouples document type from issuing state and issuing authority.
 * Never defaults to any specific state unless genuine evidence is present in the text.
 */

export const SUPPORTED_DOC_TYPES = {
  marksheet: { id: "marksheet", label: "Marksheet",                icon: "📋", color: "#3b82f6" },
  ms10:      { id: "ms10",      label: "10th Marksheet",           icon: "📘", color: "#3b82f6" },
  ms12:      { id: "ms12",      label: "12th Marksheet",           icon: "📗", color: "#8b5cf6" },
  community: { id: "community", label: "Community / Category Certificate", icon: "📜", color: "#f59e0b" },
  income:    { id: "income",    label: "Income Certificate",       icon: "💰", color: "#10b981" },
  aadhaar:   { id: "aadhaar",   label: "Aadhaar Card",             icon: "🪪", color: "#6366f1" },
  bankpass:  { id: "bankpass",  label: "Bank Document",            icon: "🏦", color: "#ec4899" },
  other:     { id: "other",     label: "Other / Unknown",          icon: "📄", color: "#94a3b8" },
  unknown:   { id: "unknown",   label: "Other / Unknown",          icon: "📄", color: "#94a3b8" },
};

export const STANDARD_CATEGORIES = [
  { id: "marksheet", label: "Marksheet", icon: "📋", color: "#3b82f6", desc: "Board marksheet (10th, 12th, or college marksheet)" },
  { id: "income", label: "Income Certificate", icon: "💰", color: "#10b981", desc: "Revenue issued annual family income certificate" },
  { id: "community", label: "Community / Category Certificate", icon: "📜", color: "#f59e0b", desc: "Govt-issued community, caste, or category certificate" },
  { id: "aadhaar", label: "Aadhaar", icon: "🪪", color: "#6366f1", desc: "UIDAI-issued Aadhaar identification card" },
  { id: "bankpass", label: "Bank Document", icon: "🏦", color: "#ec4899", desc: "Bank passbook, statement or cancelled cheque" },
  { id: "unknown", label: "Other / Unknown", icon: "📄", color: "#94a3b8", desc: "Other scholarship supporting document or unknown format" },
];

export function getStandardCategory(type) {
  if (type === "ms10" || type === "ms12" || type === "marksheet") return "marksheet";
  if (type === "income") return "income";
  if (type === "community") return "community";
  if (type === "aadhaar") return "aadhaar";
  if (type === "bankpass" || type === "bank") return "bankpass";
  return "unknown";
}

const CLASSIFICATION_RULES = {
  ms10: [
    { pattern: /\bsslc\b/i, weight: 6, label: "SSLC abbreviation" },
    { pattern: /secondary\s+school\s+leaving\s+certificate|secondary\s+school/i, weight: 8, label: "Secondary School Leaving Certificate title" },
    { pattern: /\b(10th|tenth|class\s*x|std\s*x|standard\s*x|பத்தாம்\s*வகுப்பு)\b/i, weight: 6, label: "10th/Class X standard indicator" },
    { pattern: /board\s+of\s+school\s+examinations|department\s+of\s+government\s+examinations|board\s+of\s+secondary/i, weight: 4, label: "Board of Examinations" },
    { pattern: /\b(science|social\s+science|mathematics|optional\s+language)\b/i, weight: 3, label: "10th core subject names" },
    { pattern: /permanent\s+register\s+no|certificate\s+sl\.?\s*no\.?\s*:\s*sec/i, weight: 5, label: "SSLC registration fields" },
    { pattern: /total\s+marks|மொத்த\s+மதிப்பெண்கள்/i, weight: 3, label: "Total marks summary" },
  ],

  ms12: [
    { pattern: /\b(hsc|hss|hr\.?\s*sec)\b/i, weight: 6, label: "HSC / HSS / Hr Sec marker" },
    { pattern: /higher\s+secondary(?:\s+course|\s+school|\s+examination|\s+certificate)?/i, weight: 8, label: "Higher Secondary Certificate title" },
    { pattern: /\b(12th|twelfth|class\s*xii|std\s*xii|standard\s*xii|plus\s*two|\+2|second\s*year|இரண்டாமாண்டு)\b/i, weight: 6, label: "12th / Plus Two / Second Year standard" },
    { pattern: /board\s+of\s+school\s+examinations|department\s+of\s+government\s+examinations/i, weight: 4, label: "Board of School Examinations" },
    { pattern: /\b(physics|chemistry|biology|computer\s+science|commerce|accountancy|economics|mathematics)\b/i, weight: 4, label: "12th elective subject names" },
    { pattern: /permanent\s+register\s+number|certificate\s+sl\.?\s*no\.?\s*:\s*hss|mark\s+certificate|statement\s+of\s+marks/i, weight: 5, label: "Marksheet registration fields" },
    { pattern: /total\s+marks|மொத்த\s+மதிப்பெண்கள்/i, weight: 3, label: "Total marks summary" },
  ],

  community: [
    { pattern: /community\s+certificate|caste\s+certificate|சாதிச்\s+சான்றிதழ்/i, weight: 9, label: "Community/Caste Certificate explicit title" },
    { pattern: /scheduled\s+caste|scheduled\s+tribe|backward\s+class|most\s+backward\s+class|denotified\s+community/i, weight: 7, label: "Recognized caste category mention" },
    { pattern: /\b(sc|st|mbc|dnc|obc|bc)\b/i, weight: 4, label: "Community abbreviation" },
    { pattern: /belongs\s+to.*community|certified\s+that.*belongs/is, weight: 6, label: "Community certification clause" },
    { pattern: /tahsildar|revenue\s+divisional\s+officer|\brdo\b|zonal\s+deputy\s+tahsildar|talati/i, weight: 3, label: "Revenue issuing authority" },
    { pattern: /\btaluk\b|\bdistrict\b|வட்டம்|மாவட்டம்|\btaluka\b/i, weight: 2, label: "Taluk/District administration fields" },
    { pattern: /certificate\s*(?:no|number)|cert\s*no|சான்றிதழ்\s*எண்/i, weight: 3, label: "Certificate registration number" },
  ],

  income: [
    { pattern: /income\s+certificate|வருமானச்\s+சான்றிதழ்/i, weight: 9, label: "Income Certificate explicit title" },
    { pattern: /annual\s+income|family\s+income|total\s+annual\s+income|yearly\s+income|குடும்ப\s+ஆண்டு\s+வருமானம்/i, weight: 7, label: "Annual/Family income statement" },
    { pattern: /(?:rupees|rs\.?|₹|ரூ\.?)\s*[\d,]+(?:\s*(?:per\s+annum|\/annum|\/year|only))?/i, weight: 5, label: "Income amount notation" },
    { pattern: /source\s+of\s+income|wages|salary|business|agriculture|rental/i, weight: 5, label: "Income source breakdown table" },
    { pattern: /this\s+is\s+(?:to\s+)?certify\s+that.*(?:income|family)/is, weight: 5, label: "Income certification clause" },
    { pattern: /certificate\s+validity\s+period|validity\s+period|செல்லுபடியாகும்\s+காலம்|valid\s+for\s+(?:three|\d+)\s+years/i, weight: 5, label: "Income validity period clause" },
    { pattern: /tahsildar|revenue\s+divisional\s+officer|\brdo\b|zonal\s+deputy\s+tahsildar|talati\s+cum\s+mantri/i, weight: 3, label: "Revenue issuing authority" },
  ],

  aadhaar: [
    { pattern: /unique\s+identification\s+authority\s+of\s+india|\buidai\b/i, weight: 10, label: "UIDAI header" },
    { pattern: /government\s+of\s+india.*aadhaar|aadhaar/i, weight: 8, label: "Aadhaar government header" },
    { pattern: /\b\d{4}\s\d{4}\s\d{4}\b/, weight: 8, label: "12-digit 4-4-4 formatted UID" },
    { pattern: /mera\s+aadhaar,\s+meri\s+pehchan/i, weight: 6, label: "Aadhaar slogan" },
  ],

  bankpass: [
    { pattern: /passbook|account\s+statement/i, weight: 8, label: "Passbook title" },
    { pattern: /account\s+(?:number|no)|savings\s+bank|current\s+account/i, weight: 6, label: "Account number details" },
    { pattern: /\bifsc\b|\bmicr\b/i, weight: 7, label: "IFSC / Banking code" },
    { pattern: /state\s+bank\s+of\s+india|canara\s+bank|indian\s+bank|hdfc|icici|axis\s+bank|bank\s+of\s+baroda|punjab\s+national\s+bank/i, weight: 6, label: "Major Indian bank name" },
  ],
};

const STATE_PATTERNS = [
  { name: "Gujarat", patterns: [/gujarat/i, /devbhumi\s+dwarka/i, /talati\s+cum\s+mantri/i, /gram\s+panchayat/i, /jam\s+khambhali[y|a]/i] },
  { name: "Tamil Nadu", patterns: [/tamil\s*nadu/i, /தமிழ்நாடு/i, /chennai/i, /coimbatore/i, /madurai/i, /salem/i, /thiruchirappalli|trichy/i, /thottiam/i, /வட்டம்|மாவட்டம்/i, /வட்டாட்சியர்/i] },
  { name: "Kerala", patterns: [/kerala/i, /thiruvananthapuram/i, /kochi/i, /kozhikode/i, /village\s+officer/i] },
  { name: "Karnataka", patterns: [/karnataka/i, /bengaluru|bangalore/i, /mysuru|mysore/i, /nadakacheri/i, /seva\s+sindhu/i] },
  { name: "Maharashtra", patterns: [/maharashtra/i, /mumbai/i, /pune/i, /nagpur/i, /mahaonline/i, /aaple\s+sarkar/i] },
  { name: "Andhra Pradesh", patterns: [/andhra\s+pradesh/i, /visakhapatnam/i, /vijayawada/i, /guntur/i] },
  { name: "Telangana", patterns: [/telangana/i, /hyderabad/i, /warangal/i, /meeseva/i] },
  { name: "Uttar Pradesh", patterns: [/uttar\s+pradesh/i, /lucknow/i, /kanpur/i, /varanasi/i, /edistrict\.up/i] },
  { name: "Rajasthan", patterns: [/rajasthan/i, /jaipur/i, /jodhpur/i, /udaipur/i] },
  { name: "West Bengal", patterns: [/west\s+bengal/i, /kolkata/i, /banglarbhumi/i] },
  { name: "Odisha", patterns: [/odisha|orissa/i, /bhubaneswar/i, /cuttack/i] },
  { name: "Punjab", patterns: [/punjab/i, /chandigarh/i, /amritsar/i, /ludhiana/i] },
  { name: "Bihar", patterns: [/bihar/i, /patna/i, /gaya/i] },
  { name: "Madhya Pradesh", patterns: [/madhya\s+pradesh/i, /bhopal/i, /indore/i] },
  { name: "Haryana", patterns: [/haryana/i, /gurugram|gurgaon/i, /faridabad/i] },
  { name: "Delhi", patterns: [/delhi|nct\s+of\s+delhi/i] },
  { name: "Assam", patterns: [/assam/i, /guwahati/i] },
];

const AUTHORITY_PATTERNS = [
  { name: "Talati Cum Mantri", pattern: /talati\s+cum\s+mantri|talati-cum-mantri|talati/i },
  { name: "Zonal Deputy Tahsildar", pattern: /zonal\s+deputy\s+tahsildar/i },
  { name: "Headquarters Deputy Tahsildar", pattern: /headquarters\s+deputy\s+tahsildar/i },
  { name: "Tahsildar", pattern: /tahsildar|tehsildar|வட்டாட்சியர்/i },
  { name: "Revenue Divisional Officer", pattern: /revenue\s+divisional\s+officer|\brdo\b/i },
  { name: "Village Officer", pattern: /village\s+officer|village\s+administrative\s+officer|\bvao\b/i },
  { name: "District Collector / Magistrate", pattern: /district\s+collector|district\s+magistrate|\bdc\b|\bdm\b/i },
  { name: "Gram Panchayat", pattern: /gram\s+panchayat|grama\s+panchayat/i },
  { name: "Revenue Department", pattern: /revenue\s+department|revenue\s+administration/i },
];

/**
 * Detects issuing state from document text without bias or hardcoded defaults.
 * 
 * @param {string} text 
 * @returns {Object} { state: string|null, stateConfidence: number }
 */
export function detectState(text) {
  const clean = String(text || "");
  for (const st of STATE_PATTERNS) {
    const matchCount = st.patterns.filter(p => p.test(clean)).length;
    if (matchCount > 0) {
      const stateConfidence = Math.min(98, 70 + (matchCount * 14));
      return { state: st.name, stateConfidence };
    }
  }
  return { state: null, stateConfidence: 0 };
}

/**
 * Detects issuing authority from document text without bias.
 * 
 * @param {string} text 
 * @returns {Object} { issuingAuthority: string|null, authorityConfidence: number }
 */
export function detectIssuingAuthority(text) {
  const clean = String(text || "");
  for (const auth of AUTHORITY_PATTERNS) {
    if (auth.pattern.test(clean)) {
      return { issuingAuthority: auth.name, authorityConfidence: 90 };
    }
  }
  return { issuingAuthority: null, authorityConfidence: 0 };
}

/**
 * Detects document type, state, and authority from extracted text using weighted multi-signal scoring.
 * 
 * @param {string} text Raw OCR text
 * @param {Object} metadata Optional file metadata (name, mime)
 * @returns {Object} { type, confidence, state, stateConfidence, issuingAuthority, authorityConfidence, reasons, warnings, allScores, isConfident }
 */
export function detectDocumentType(text, metadata = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const stateInfo = detectState(clean);
  const authorityInfo = detectIssuingAuthority(clean);

  if (!clean || clean.length < 15) {
    return {
      type: "unknown",
      confidence: 0,
      state: stateInfo.state,
      stateConfidence: stateInfo.stateConfidence,
      issuingAuthority: authorityInfo.issuingAuthority,
      authorityConfidence: authorityInfo.authorityConfidence,
      reasons: ["Insufficient text content to identify document."],
      warnings: ["Image text is too short or unreadable."],
      allScores: {},
      isConfident: false,
    };
  }

  const scores = {
    ms10:      0,
    ms12:      0,
    community: 0,
    income:    0,
    aadhaar:   0,
    bankpass:  0,
  };

  const matchedSignals = {
    ms10:      [],
    ms12:      [],
    community: [],
    income:    [],
    aadhaar:   [],
    bankpass:  [],
  };

  // Evaluate rules for all document categories
  for (const [docKey, rules] of Object.entries(CLASSIFICATION_RULES)) {
    for (const rule of rules) {
      if (rule.pattern.test(clean)) {
        scores[docKey] += rule.weight;
        matchedSignals[docKey].push(rule.label);
      }
    }
  }

  // Sort scores descending
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topType, topScore] = sorted[0];
  const [runnerUpType, runnerUpScore] = sorted[1];

  // Minimum threshold to prevent false positive classifications on random text
  const MIN_SCORE_THRESHOLD = 6;

  if (topScore < MIN_SCORE_THRESHOLD) {
    return {
      type: "unknown",
      confidence: Math.round(topScore * 10),
      state: stateInfo.state,
      issuingState: stateInfo.state,
      detectedState: stateInfo.state,
      stateConfidence: stateInfo.stateConfidence,
      issuingAuthority: authorityInfo.issuingAuthority,
      detectedAuthority: authorityInfo.issuingAuthority,
      authorityConfidence: authorityInfo.authorityConfidence,
      reasons: ["No strong matching document patterns found."],
      warnings: ["Text lacks specific markers for marksheets, community, or income certificates."],
      allScores: scores,
      isConfident: false,
    };
  }

  // Calculate confidence considering score difference with runner-up
  const margin = topScore - runnerUpScore;
  let confidence = Math.min(98, Math.max(30, topScore * 8));

  // If top and runner-up are very close (ambiguous), adjust confidence
  const warnings = [];
  if (margin < 3 && runnerUpScore >= MIN_SCORE_THRESHOLD) {
    confidence = Math.max(30, confidence - 25);
    warnings.push(
      `Document exhibits mixed signals between ${SUPPORTED_DOC_TYPES[topType]?.label || topType} and ${SUPPORTED_DOC_TYPES[runnerUpType]?.label || runnerUpType}. Please verify.`
    );
  }

  const reasons = matchedSignals[topType].slice(0, 4);

  return {
    type: topType,
    confidence,
    state: stateInfo.state,
    issuingState: stateInfo.state,
    detectedState: stateInfo.state,
    stateConfidence: stateInfo.stateConfidence,
    issuingAuthority: authorityInfo.issuingAuthority,
    detectedAuthority: authorityInfo.issuingAuthority,
    authorityConfidence: authorityInfo.authorityConfidence,
    reasons,
    warnings,
    allScores: scores,
    isConfident: confidence >= 60 && margin >= 3,
  };
}

/**
 * Validates whether the detected document type matches the expected slot.
 * 
 * @param {string} slot Expected slot (ms10, ms12, community, income)
 * @param {Object} detection Output from detectDocumentType
 * @returns {Object} { status: "valid"|"mismatch"|"unconfident", message, badgeColor }
 */
export function validateDocumentSlot(slot, detection) {
  if (!slot || !detection) {
    return { status: "unconfident", message: "Verification pending.", badgeColor: "grey" };
  }

  const detectedType = detection.type;
  const confidence = detection.confidence || 0;

  if (detectedType === "unknown" || confidence < 50) {
    return {
      status: "unconfident",
      message: "Document type could not be confidently identified. Please verify the uploaded document.",
      badgeColor: "yellow",
      detectedLabel: "Uncertain",
    };
  }

  if (detectedType === slot) {
    return {
      status: "valid",
      message: `Document type detected correctly: ${SUPPORTED_DOC_TYPES[slot]?.label}.`,
      badgeColor: "green",
      detectedLabel: SUPPORTED_DOC_TYPES[slot]?.label,
    };
  }

  // Mismatch detected
  const expectedLabel = SUPPORTED_DOC_TYPES[slot]?.label || slot;
  const detectedLabel = SUPPORTED_DOC_TYPES[detectedType]?.label || detectedType;

  return {
    status: "mismatch",
    message: `Wrong document type detected. Uploaded document appears to be a ${detectedLabel}, but ${expectedLabel} was selected.`,
    badgeColor: "red",
    detectedLabel,
  };
}

/**
 * Normalizes title text to resolve common OCR character confusions in document headers.
 */
function normalizeOcrTitleText(text) {
  return String(text || "")
    .slice(0, 1500) // Focus on header / upper area of document
    .replace(/[|_]+/g, " ")
    .replace(/\b0([a-z]+)\b/gi, "O$1")
    .replace(/\b([a-z]+)0\b/gi, "$1O")
    .replace(/SEC0NDARY/gi, "SECONDARY")
    .replace(/SCH00L/gi, "SCHOOL")
    .replace(/LEAV1NG/gi, "LEAVING")
    .replace(/CERT1F1CATE/gi, "CERTIFICATE")
    .replace(/H1GHER/gi, "HIGHER")
    .replace(/1NC0ME/gi, "INCOME")
    .replace(/C0MMUN1TY/gi, "COMMUNITY")
    .replace(/\s+/g, " ")
    .trim();
}

export const DOCUMENT_TITLE_PATTERNS = [
  {
    type: "ms10",
    title: "Secondary School Leaving Certificate (10th)",
    patterns: [
      /secondary\s*school\s*leaving\s*certificate/i,
      /s\.?s\.?l\.?c\.?(?:\s+marksheet|\s+mark\s+certificate|\s+examination)?/i,
      /secondary\s*school\s*examination/i,
      /high\s*school\s*certificate\s*examination/i,
      /all\s*india\s*secondary\s*school\s*examination/i,
      /matriculation\s*examination/i,
      /10th\s*(?:standard|std|class)?\s*(?:mark\s*sheet|marksheet|certificate)/i,
      /பத்தாம்\s*வகுப்பு\s*மதிப்பெண்\s*சான்றிதழ்/i,
    ],
    weight: 95,
  },
  {
    type: "ms12",
    title: "Higher Secondary Mark Sheet (12th)",
    patterns: [
      /higher\s*secondary(?:\s*course|\s*school|\s*academic)?\s*(?:certificate|examination|mark\s*sheet|statement\s*of\s*marks)/i,
      /h\.?s\.?c\.?(?:\s+marksheet|\s+mark\s+certificate|\s+examination)?/i,
      /senior\s*school\s*certificate\s*examination/i,
      /all\s*india\s*senior\s*school\s*certificate/i,
      /plus\s*two(?:\s*mark\s*sheet|\s*examination)?/i,
      /intermediate\s*examination\s*certificate/i,
      /12th\s*(?:standard|std|class)?\s*(?:mark\s*sheet|marksheet|certificate)/i,
      /மேல்நிலைப்\s*பள்ளி\s*மதிப்பெண்\s*சான்றிதழ்/i,
    ],
    weight: 95,
  },
  {
    type: "community",
    title: "Community Certificate",
    patterns: [
      /community\s*certificate/i,
      /caste\s*certificate/i,
      /scheduled\s*caste\s*certificate/i,
      /scheduled\s*tribe\s*certificate/i,
      /backward\s*class\s*certificate/i,
      /சாதிச்\s*சான்றிதழ்|சமூகச்\s*சான்றிதழ்/i,
    ],
    weight: 95,
  },
  {
    type: "income",
    title: "Income Certificate",
    patterns: [
      /income\s*certificate/i,
      /family\s*income\s*certificate/i,
      /annual\s*income\s*certificate/i,
      /வருமானச்\s*சான்றிதழ்/i,
    ],
    weight: 95,
  },
  {
    type: "unknown",
    title: "Transfer Certificate",
    patterns: [
      /transfer\s*certificate/i,
      /\bt\.?c\.?\s*certificate/i,
      /மாற்றுச்\s*சான்றிதழ்/i,
    ],
    weight: 88,
  },
  {
    type: "unknown",
    title: "Bonafide Certificate",
    patterns: [
      /bonafide\s*certificate/i,
      /bonafide\s*student\s*certificate/i,
      /உண்மைச்\s*சான்றிதழ்/i,
    ],
    weight: 88,
  },
  {
    type: "aadhaar",
    title: "Aadhaar Card",
    patterns: [
      /unique\s*identification\s*authority\s*of\s*india/i,
      /government\s*of\s*india.*aadhaar/i,
      /मेरा\s*आधार,\s*मेरी\s*पहचान/i,
    ],
    weight: 95,
  },
  {
    type: "bankpass",
    title: "Bank Passbook",
    patterns: [
      /bank\s*passbook/i,
      /passbook\b/i,
      /account\s*statement/i,
    ],
    weight: 90,
  },
];

/**
 * Detects document title and type independently from field extraction.
 * 
 * @param {string} rawText OCR text
 * @returns {Object} { documentType, documentTitle, confidence, isIdentified, evidence }
 */
export function detectDocumentTitle(rawText) {
  const text = String(rawText || "").trim();
  if (!text || text.length < 10) {
    return {
      documentType: "unknown",
      documentTitle: "Unknown Document",
      confidence: 0,
      isIdentified: false,
      evidence: [],
    };
  }

  // 1. Check exact pattern matches in first 1500 characters
  const headerSlice = text.slice(0, 1500);
  for (const entry of DOCUMENT_TITLE_PATTERNS) {
    for (const pat of entry.patterns) {
      const match = headerSlice.match(pat);
      if (match) {
        return {
          documentType: entry.type,
          documentTitle: entry.title,
          confidence: entry.weight,
          isIdentified: true,
          evidence: [match[0]],
        };
      }
    }
  }

  // 2. Check OCR-normalized text for noisy headers (e.g. "SEC0NDARY SCH00L LEAV1NG CERT1F1CATE")
  const normalizedHeader = normalizeOcrTitleText(headerSlice);
  for (const entry of DOCUMENT_TITLE_PATTERNS) {
    for (const pat of entry.patterns) {
      const match = normalizedHeader.match(pat);
      if (match) {
        return {
          documentType: entry.type,
          documentTitle: entry.title,
          confidence: Math.max(60, entry.weight - 10),
          isIdentified: true,
          evidence: [`OCR-normalized: ${match[0]}`],
        };
      }
    }
  }

  // 3. Check for partial / uncertain anchors
  if (/(?:income|வருமானம்)\b/i.test(headerSlice)) {
    return {
      documentType: "unknown",
      documentTitle: "Possible Income Certificate",
      confidence: 61,
      isIdentified: false,
      evidence: ["Partial income keyword anchor"],
    };
  }
  if (/(?:community|caste|சாதி)\b/i.test(headerSlice)) {
    return {
      documentType: "unknown",
      documentTitle: "Possible Community Certificate",
      confidence: 61,
      isIdentified: false,
      evidence: ["Partial community keyword anchor"],
    };
  }
  if (/(?:sslc|secondary|10th)\b/i.test(headerSlice)) {
    return {
      documentType: "unknown",
      documentTitle: "Possible 10th Marksheet",
      confidence: 61,
      isIdentified: false,
      evidence: ["Partial secondary keyword anchor"],
    };
  }
  if (/(?:hsc|higher\s*secondary|12th)\b/i.test(headerSlice)) {
    return {
      documentType: "unknown",
      documentTitle: "Possible 12th Marksheet",
      confidence: 61,
      isIdentified: false,
      evidence: ["Partial higher secondary keyword anchor"],
    };
  }

  return {
    documentType: "unknown",
    documentTitle: "Unknown Document",
    confidence: 15,
    isIdentified: false,
    evidence: [],
  };
}

/**
 * Suggests a document type using locally extracted text and classification logic.
 * Never forces an uncertain classification.
 * 
 * @param {string} text Extracted OCR text
 * @param {Object} fileInfo { name, type }
 * @returns {Object} Suggested document type with confidence and confirmation status
 */
export function suggestDocumentType(text, fileInfo = {}) {
  const detected = detectDocumentType(text, fileInfo);
  const confidence = typeof detected.confidence === "number" ? detected.confidence : 0;
  const isUncertain = confidence < 60 || detected.type === "unknown";

  const standardCat = getStandardCategory(detected.type);
  const suggested = isUncertain ? "Other / Unknown" : (standardCat || detected.type);

  return {
    suggestedType: suggested,
    rawType: detected.type,
    standardCategory: standardCat,
    confidence,
    isUncertain,
    needsConfirmation: true,
    requiresUserConfirmation: true,
    confirmed: false,
    label: isUncertain
      ? "Unknown / Insufficient Signals — Please Confirm"
      : (SUPPORTED_DOC_TYPES[detected.type]?.label || detected.type),
    reasons: detected.reasons || [],
    state: detected.state || null,
    issuingAuthority: detected.issuingAuthority || null,
  };
}

