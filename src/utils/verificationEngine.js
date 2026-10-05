/**
 * verificationEngine.js — SGP Cross-Document Consistency & Readiness Engine
 * 
 * Performs multi-layer client-side verification:
 * 1. Multi-level Name Matching (Exact, Whitespace, Token-order, Initials, Levenshtein)
 * 2. Date of Birth Consistency Cross-Check
 * 3. Income Consistency Check (Certificate vs Student Input + Certificate Freshness)
 * 4. Community / Category Cross-Check (Certificate vs Student Input)
 * 5. Full All-Pairs Cross-Document Matrix (including Income Name)
 * 6. Explainable Pre-Submission Readiness & Consistency Score Calculation
 * 
 * 100% API-key-free, local consistency verification only.
 */

import {
  normalizeName,
  normalizeDateToISO,
  normalizeIncome,
  normalizeCommunity,
  parseIndianDate,
  formatTitleName,
} from "./fieldNormalizer";

/**
 * Five Standard Consistency Statuses (per Requirement 4)
 * - Consistent
 * - Possible mismatch
 * - Needs confirmation
 * - Missing information
 * - Not applicable
 * 
 * Note: Missing information never counts as a successful match.
 */
export const STANDARD_CONSISTENCY_STATUSES = {
  CONSISTENT: "Consistent",
  POSSIBLE_MISMATCH: "Possible mismatch",
  NEEDS_CONFIRMATION: "Needs confirmation",
  MISSING_INFORMATION: "Missing information",
  MISSING_INFO: "Missing information",
  NOT_APPLICABLE: "Not applicable",
};

export const NEUTRAL_NAME_MISMATCH_GUIDANCE =
  "The names differ. Compare the highlighted text with your original documents. Confirm whether this is an OCR reading error or a document-detail issue.";

export function toStandardConsistencyStatus(status) {
  if (status === "EXACT_MATCH" || status === "MATCH") return "Consistent";
  if (status === "LIKELY_MATCH" || status === "MINOR_DIFFERENCE" || status === "NEEDS_REVIEW" || status === "WARNING" || status === "UNREADABLE") {
    return "Needs confirmation";
  }
  if (status === "MISMATCH" || status === "FAIL" || status === "EXPIRED") return "Possible mismatch";
  if (status === "MISSING" || status === "PENDING" || status === "INCOMPLETE") return "Missing information";
  if (status === "NOT_APPLICABLE" || status === "NA") return "Not applicable";
  return "Needs confirmation";
}

/**
 * Computes Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a, b) {
  const m = [];
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 1; j <= b.length; j++) m[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(
        m[i - 1][j] + 1,        // deletion
        m[i][j - 1] + 1,        // insertion
        m[i - 1][j - 1] + cost  // substitution
      );
    }
  }
  return m[a.length][b.length];
}

/**
 * Normalizes and tokenizes a name for comparison:
 * - strips honorifics (Thiru, Mr, Dr, etc.)
 * - removes surrounding punctuation from each token (e.g. "K." -> "k")
 * - lowercase
 * - returns array of non-empty tokens
 */
export function getNormalizedNameTokens(raw) {
  if (!raw) return [];
  const normalized = normalizeName(raw).toLowerCase();
  return normalized
    .split(/\s+/)
    .map(t => t.replace(/^[.,\-_/\\#;:'"]+/, "").replace(/[.,\-_/\\#;:'"]+$/, ""))
    .filter(t => t.length > 0);
}

/**
 * Checks if two lists of tokens represent a valid initial expansion
 * (e.g. ["balasubramaniam", "s"] vs ["balasubramaniam", "sivasankaranarayanan"])
 * where each token in one list corresponds 1:1 to a token in the other list.
 */
function checkInitialExpansion(list1, list2) {
  if (list1.length !== list2.length) return false;

  const used = new Array(list2.length).fill(false);
  let expansions = 0;

  for (let i = 0; i < list1.length; i++) {
    const t1 = list1[i];
    let matchedIdx = list2.findIndex((t2, idx) => !used[idx] && t2 === t1);
    if (matchedIdx !== -1) {
      used[matchedIdx] = true;
      continue;
    }
    matchedIdx = list2.findIndex((t2, idx) => {
      if (used[idx]) return false;
      if (t1.length === 1 && t2.length > 1 && t2.startsWith(t1)) return true;
      if (t2.length === 1 && t1.length > 1 && t1.startsWith(t2)) return true;
      return false;
    });
    if (matchedIdx !== -1) {
      used[matchedIdx] = true;
      expansions++;
      continue;
    }
    return false;
  }

  return expansions > 0 && used.every(Boolean);
}

/**
 * Multi-Level Name Comparison Engine.
 * 
 * @param {string} rawA First name
 * @param {string} rawB Second name
 * @param {boolean} isStrict If true, enforces strict matching (Aadhaar, Community, Income, Bank)
 * @returns {Object} { status: "EXACT_MATCH"|"LIKELY_MATCH"|"MINOR_DIFFERENCE"|"NEEDS_REVIEW"|"MISMATCH"|"MISSING", score, explanation }
 */
export function compareNames(rawA, rawB, isStrict = false) {
  if (!rawA || !rawB) {
    return {
      status: "MISSING",
      standardStatus: "Missing information",
      score: 0,
      explanation: "One or both names are missing.",
      neutralGuidance: "Name information is missing. Missing information does not count as a match.",
    };
  }

  const toksA = getNormalizedNameTokens(rawA);
  const toksB = getNormalizedNameTokens(rawB);

  if (toksA.length === 0 || toksB.length === 0) {
    return {
      status: "MISSING",
      standardStatus: "Missing information",
      score: 0,
      explanation: "One or both names could not be parsed.",
      neutralGuidance: "Name information could not be parsed.",
    };
  }

  const strA = toksA.join(" ");
  const strB = toksB.join(" ");

  // LEVEL 1: Exact Normalized Match
  if (strA === strB) {
    return {
      status: "EXACT_MATCH",
      standardStatus: "Consistent",
      score: 1.0,
      explanation: "Exact character match.",
      neutralGuidance: "The applicant names match across compared documents.",
    };
  }

  // LEVEL 2: Token-Order Variation (Permutation, e.g. "Raj Arun Kumar" vs "Arun Kumar Raj")
  const sortedA = [...toksA].sort().join(" ");
  const sortedB = [...toksB].sort().join(" ");
  if (sortedA === sortedB) {
    return {
      status: "EXACT_MATCH",
      standardStatus: "Consistent",
      score: 0.98,
      explanation: "Same name tokens in different word order (e.g. Surname first).",
      neutralGuidance: "Same name tokens in different word order (e.g. Surname first). Consistent.",
    };
  }

  // LEVEL 3: Pure Single Initial Addition / Omission
  const wordsA = toksA.filter(t => t.length > 1);
  const wordsB = toksB.filter(t => t.length > 1);
  const initsA = toksA.filter(t => t.length === 1);
  const initsB = toksB.filter(t => t.length === 1);

  const sortedWordsA = [...wordsA].sort().join(" ");
  const sortedWordsB = [...wordsB].sort().join(" ");

  if (wordsA.length > 0 && wordsB.length > 0 && sortedWordsA === sortedWordsB) {
    // One document has single-letter initial(s) while the other has none
    if ((initsA.length > 0 && initsB.length === 0) || (initsB.length > 0 && initsA.length === 0)) {
      if (isStrict) {
        return {
          status: "LIKELY_MATCH",
          standardStatus: "Needs confirmation",
          score: 0.92,
          explanation: "Main names match exactly; one document contains an initial or prefix.",
          neutralGuidance: "Main names match; one document contains an initial. Student confirmation recommended.",
        };
      }
      return {
        status: "EXACT_MATCH",
        standardStatus: "Consistent",
        score: 0.95,
        explanation: "Main names match; initial difference is acceptable for marksheets.",
        neutralGuidance: "Main names match; initial variation is acceptable.",
      };
    }
  }

  // LEVEL 4: Patronymic / Initial Expansion (e.g. "Balasubramaniam S" vs "Balasubramaniam Sivasankaranarayanan")
  if (checkInitialExpansion(toksA, toksB)) {
    return {
      status: "LIKELY_MATCH",
      standardStatus: "Needs confirmation",
      score: 0.90,
      explanation: "Name initial matches expanded full name (patronymic expansion).",
      neutralGuidance: "Initial corresponds to an expanded name token. Confirm against original certificate.",
    };
  }

  // LEVEL 5: Token Alignment & Unexpected Extra Token Detection
  const [shortToks, longToks] = toksA.length <= toksB.length ? [toksA, toksB] : [toksB, toksA];
  const usedLong = new Array(longToks.length).fill(false);
  let shortMatchCount = 0;

  for (const st of shortToks) {
    let matchIdx = longToks.findIndex((lt, idx) => !usedLong[idx] && lt === st);
    if (matchIdx === -1 && st.length === 1) {
      matchIdx = longToks.findIndex((lt, idx) => !usedLong[idx] && lt.length > 1 && lt.startsWith(st));
    }
    if (matchIdx === -1 && st.length >= 4) {
      matchIdx = longToks.findIndex((lt, idx) => !usedLong[idx] && lt.length >= 4 && levenshteinDistance(lt, st) <= 1);
    }

    if (matchIdx !== -1) {
      usedLong[matchIdx] = true;
      shortMatchCount++;
    }
  }

  const allShortMatched = shortMatchCount === shortToks.length;
  const unmatchedLong = longToks.filter((_, idx) => !usedLong[idx]);

  if (allShortMatched && unmatchedLong.length > 0) {
    const extraTokensStr = unmatchedLong.map(t => formatTitleName(t) || t.toUpperCase()).join(", ");
    return {
      status: "NEEDS_REVIEW",
      standardStatus: "Needs confirmation",
      score: 0.65,
      explanation: `Unexpected additional token(s) ('${extraTokensStr}') detected in document name. Manual review required.`,
      neutralGuidance: `Unexpected additional token(s) ('${extraTokensStr}') detected. Compare the highlighted text with your original documents.`,
    };
  }

  // LEVEL 6: Fuzzy Levenshtein Distance (Minor Typos, e.g. "DEMO CANDIDATE" vs "DEMO CANDDATE")
  const maxLen = Math.max(strA.length, strB.length, 1);
  const dist = levenshteinDistance(strA, strB);
  const similarity = 1 - (dist / maxLen);

  if (similarity >= 0.85) {
    if (isStrict) {
      return {
        status: "MINOR_DIFFERENCE",
        standardStatus: "Needs confirmation",
        score: Math.min(similarity, 0.90),
        explanation: `Minor spelling variation (similarity ${(similarity * 100).toFixed(0)}%). Review recommended.`,
        neutralGuidance: `Minor spelling variation. Compare with original documents to verify if this is an OCR error.`,
      };
    }
    return {
      status: "LIKELY_MATCH",
      standardStatus: "Needs confirmation",
      score: similarity,
      explanation: `Spelling differs slightly (similarity ${(similarity * 100).toFixed(0)}%), acceptable for marksheets.`,
      neutralGuidance: `Minor spelling difference. Student review recommended.`,
    };
  }

  // LEVEL 7: Significant Difference / Mismatch
  return {
    status: "MISMATCH",
    standardStatus: "Possible mismatch",
    score: Math.max(0, similarity),
    explanation: `The names differ ("${rawA}" vs "${rawB}"). Compare the highlighted text with your original documents. Confirm whether this is an OCR reading error or a document-detail issue.`,
    neutralGuidance: NEUTRAL_NAME_MISMATCH_GUIDANCE,
  };
}

/**
 * Verifies names with safe offline logic for Parent-Income Flow.
 * 
 * If incomeApplicant === "parent", the automatic student-vs-parent hard mismatch
 * is skipped and marked for review (NEEDS_REVIEW) with parentNameUsed: true.
 * 
 * @param {Object} profile Profile containing incomeApplicant, parentName, studentName, etc.
 * @param {Object} result Verification result object to enrich
 * @returns {Object} Enriched verification result
 */
export function verifyNames(profile = {}, result = {}) {
  const isParentIncome = profile.incomeApplicant === "parent";

  if (isParentIncome) {
    result.studentNameMatch = "SKIPPED";
    result.parentNameUsed = true;
    result.requiresReview = true;
    result.reason = "Parent declared as income applicant; student-parent name match skipped. Verification required.";
    
    // If parent name and income certificate holder name are available, verify consistency
    const parentName = profile.parentName || profile.fatherName || profile.motherName;
    const incomeCertName = profile.incomeCertificateName || profile.incomeName || profile.incomeCertHolder;
    if (parentName && incomeCertName) {
      const comp = compareNames(parentName, incomeCertName, false);
      result.parentIncomeMatch = comp.status;
      result.parentIncomeScore = comp.score;
      if (comp.status === "MATCH" || comp.status === "EXACT_MATCH") {
        result.parentIncomeConsistent = true;
      }
    }

    // Safety constraint: Never auto-resolve to FAIL when parent is declared, set to NEEDS_REVIEW
    if (result.status === "FAIL" || !result.status) {
      result.status = "NEEDS_REVIEW";
    }
    return result;
  }

  // Default student applicant flow
  result.studentNameMatch = "CHECKED";
  result.parentNameUsed = false;
  return result;
}


/**
 * Compares two Date of Birth strings.
 * 
 * @param {string} dobA 
 * @param {string} dobB 
 * @returns {Object} { status: "MATCH"|"MISMATCH"|"MISSING"|"UNREADABLE"|"AMBIGUOUS", explanation }
 */
export function compareDOB(dobA, dobB) {
  if (!dobA || !dobB) {
    return {
      status: "MISSING",
      standardStatus: "Missing information",
      explanation: "One or both date of birth fields are missing.",
      neutralGuidance: "Date of birth is missing. Missing information does not count as a match.",
    };
  }

  const isoA = normalizeDateToISO(dobA);
  const isoB = normalizeDateToISO(dobB);

  if (!isoA || !isoB) {
    return {
      status: "UNREADABLE",
      standardStatus: "Needs confirmation",
      explanation: "Date format could not be parsed.",
      neutralGuidance: "Date format requires manual confirmation against original documents.",
    };
  }

  if (isoA === isoB) {
    return {
      status: "MATCH",
      standardStatus: "Consistent",
      explanation: `DOB matches: ${isoA}.`,
      neutralGuidance: `Date of birth matches (${isoA}). Consistent.`,
    };
  }

  return {
    status: "MISMATCH",
    standardStatus: "Possible mismatch",
    explanation: `DOB mismatch: ${isoA} vs ${isoB}. Must be identical to Aadhaar.`,
    neutralGuidance: `The dates of birth differ: ${isoA} vs ${isoB}. Compare with your original documents. Confirm whether this is an OCR reading error or a document-detail issue.`,
  };
}

/**
 * Computes Income Certificate Freshness & Expiry.
 *
 * Implements 4 consistent states:
 * 1. Confirmed explicit expiry date has passed: "Expired"
 * 2. Confirmed explicit expiry date is within the next 30 days: "Expiring soon"
 * 3. OCR found an expiry date but the student has not confirmed it: "Please confirm the expiry date"
 * 4. No explicit expiry and no verified applicable validity rule: "Validity needs confirmation"
 *
 * Enforces issue-date window ONLY when the selected scheme's verified rule requires it.
 * Never uses universal "issued >12 months ago = expired" fallback.
 */
export function evaluateIncomeFreshness(issueDate, validUpto, options = {}) {
  // Provenance rule: only treat an expiry date as confirmed if the caller
  // has EXPLICITLY set isExpiryConfirmed or isConfirmed to true.
  // A missing flag always means "Needs confirmation" — never implicitly confirmed.
  const isConfirmed = typeof options === "boolean"
    ? options
    : options?.isExpiryConfirmed !== undefined
      ? Boolean(options.isExpiryConfirmed)
      : options?.isConfirmed !== undefined
        ? Boolean(options.isConfirmed)
        : false; // DEFAULT: unconfirmed — must be explicit
  const schemeRule = options?.schemeRule || (options?.selectedScheme?.validityRule || null);
  const now = options?.referenceDate ? new Date(options.referenceDate) : new Date();

  // 0. No dates present at all
  if (!validUpto && !issueDate) {
    return {
      status: "unknown",
      stateKey: "validity_needs_confirmation",
      label: "Validity needs confirmation",
      color: "grey",
      detail: "No explicit expiry or issue date printed. Validity depends on issuing State Revenue Authority rules and scheme-specific guidelines.",
      isExpired: false,
      isExpiringSoon: false,
      isUnconfirmedExpiry: false,
    };
  }

  // 1. Explicit Expiry Date
  if (validUpto) {
    const validD = parseIndianDate(validUpto);
    if (validD && !isNaN(validD.getTime())) {
      // If OCR extracted it but student has NOT confirmed it:
      if (!isConfirmed) {
        return {
          status: "needs_confirmation",
          stateKey: "unconfirmed_expiry",
          label: "Please confirm the expiry date",
          color: "yellow",
          detail: `OCR extracted expiry date ${validUpto}. Please review and confirm this date against your original certificate.`,
          isExpired: false,
          isExpiringSoon: false,
          isUnconfirmedExpiry: true,
        };
      }

      // If student has confirmed the explicit expiry date:
      if (validD.getTime() < now.getTime()) {
        return {
          status: "expired",
          stateKey: "expired",
          label: "Expired",
          color: "red",
          detail: `Certificate expired on ${validUpto}. A renewed certificate is required.`,
          isExpired: true,
          isExpiringSoon: false,
          isUnconfirmedExpiry: false,
        };
      }

      const daysLeft = Math.round((validD.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 30) {
        return {
          status: "warning",
          stateKey: "expiring_soon",
          label: "Expiring soon",
          color: "yellow",
          detail: `Certificate valid upto ${validUpto} (${daysLeft} day(s) remaining).`,
          isExpired: false,
          isExpiringSoon: true,
          isUnconfirmedExpiry: false,
        };
      }

      return {
        status: "valid",
        stateKey: "valid",
        label: "Valid",
        color: "green",
        detail: `Valid upto ${validUpto}.`,
        isExpired: false,
        isExpiringSoon: false,
        isUnconfirmedExpiry: false,
      };
    }
  }

  // 2. Scheme-Specific Issue Date Window (Enforced ONLY when a verified rule is provided and applicable)
  if (schemeRule && schemeRule.windowMonths && issueDate) {
    const issueD = parseIndianDate(issueDate);
    if (issueD && !isNaN(issueD.getTime())) {
      const diffMonths = (now.getTime() - issueD.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      if (diffMonths > schemeRule.windowMonths) {
        return {
          status: "outside_window",
          stateKey: "outside_scheme_window",
          label: "Outside Scheme Window",
          color: "yellow",
          detail: `Issued on ${issueDate}. Selected scheme '${schemeRule.schemeName || "scheme"}' requires a certificate issued within the past ${schemeRule.windowMonths} months.`,
          isExpired: false,
          isExpiringSoon: false,
          isUnconfirmedExpiry: false,
        };
      }
    }
  }

  // 3. No explicit expiry and no verified applicable validity rule (State Revenue Authority rules apply)
  return {
    status: "needs_confirmation",
    stateKey: "validity_needs_confirmation",
    label: "Validity needs confirmation",
    color: "grey",
    detail: "No explicit expiry date printed. Validity depends on issuing State Revenue Authority rules and scheme-specific guidelines.",
    isExpired: false,
    isExpiringSoon: false,
    isUnconfirmedExpiry: false,
  };
}

/**
 * Compares Income Certificate amount vs Student entered income.
 */
export function compareIncome(certIncome, studentIncome, issueDate = null, validUpto = null, options = {}) {
  const numCert = normalizeIncome(certIncome);
  const numStudent = normalizeIncome(studentIncome);
  const freshness = evaluateIncomeFreshness(issueDate, validUpto, options);

  if (numCert === null && numStudent === null) {
    return {
      status: "MISSING",
      standardStatus: "Missing information",
      explanation: "Income details not provided.",
      neutralGuidance: "Income details are missing. Missing information does not count as a match.",
      freshness,
    };
  }

  if (numCert === null) {
    return {
      status: "WARNING",
      standardStatus: "Needs confirmation",
      explanation: "Income could not be read from certificate.",
      neutralGuidance: "Income could not be extracted from certificate. Manual confirmation required.",
      freshness,
    };
  }

  if (numStudent === null) {
    return {
      status: "WARNING",
      standardStatus: "Needs confirmation",
      explanation: "Student entered income is missing.",
      neutralGuidance: "Entered income is missing. Please enter your annual income to compare.",
      numCert,
      freshness,
    };
  }

  if (numCert === numStudent) {
    return {
      status: freshness.status === "expired" ? "EXPIRED" : "MATCH",
      standardStatus: freshness.status === "expired" ? "Possible mismatch" : "Consistent",
      explanation: `Income matches entered details (₹${numCert.toLocaleString("en-IN")}).`,
      neutralGuidance: `Income figures match: ₹${numCert.toLocaleString("en-IN")}. Consistent.`,
      numCert,
      numStudent,
      freshness,
    };
  }

  return {
    status: "MISMATCH",
    standardStatus: "Possible mismatch",
    explanation: `Income differs: Certificate shows ₹${numCert.toLocaleString("en-IN")}, but entered income is ₹${numStudent.toLocaleString("en-IN")}.`,
    neutralGuidance: `The income amounts differ (Certificate: ₹${numCert.toLocaleString("en-IN")} vs Entered: ₹${numStudent.toLocaleString("en-IN")}). Compare with your original documents. Confirm whether this is an OCR reading error or a document-detail issue.`,
    numCert,
    numStudent,
    freshness,
  };
}

/**
 * Compares Community Certificate category vs Student entered category.
 */
export function compareCommunity(certCommunity, studentCategory) {
  const normCert = normalizeCommunity(certCommunity);
  const normStudent = normalizeCommunity(studentCategory);

  if (!normCert && !normStudent) {
    return {
      status: "MISSING",
      standardStatus: "Missing information",
      explanation: "Community details not provided.",
      neutralGuidance: "Community details are missing. Missing information does not count as a match.",
    };
  }

  if (!normCert) {
    return {
      status: "WARNING",
      standardStatus: "Needs confirmation",
      explanation: "Community could not be read from certificate.",
      neutralGuidance: "Community category could not be extracted from certificate. Manual confirmation required.",
    };
  }

  if (!normStudent) {
    return {
      status: "WARNING",
      standardStatus: "Needs confirmation",
      explanation: "Student entered community is missing.",
      neutralGuidance: "Entered category is missing. Please select your category to compare.",
    };
  }

  if (normCert === normStudent) {
    return {
      status: "MATCH",
      standardStatus: "Consistent",
      explanation: `Category matches: ${normCert}.`,
      neutralGuidance: `Category matches (${normCert}). Consistent.`,
      normCert,
      normStudent,
    };
  }

  return {
    status: "MISMATCH",
    standardStatus: "Possible mismatch",
    explanation: `Category mismatch: Certificate shows "${normCert}", but entered category is "${normStudent}".`,
    neutralGuidance: `The categories differ (Certificate: "${normCert}" vs Entered: "${normStudent}"). Compare with your original certificate. Confirm whether this is an OCR reading error or a document-detail issue.`,
    normCert,
    normStudent,
  };
}

/**
 * Builds the complete Cross-Document Matrix across all available sources.
 * 
 * IMPORTANT: Includes Income Certificate Holder Name (fixing the audit issue).
 */
export function buildCrossDocumentMatrix({
  aadharName = "",
  aadharDob = "",
  bankHolder = "",
  bankAccType = "",
  tenthData = null,
  twelfthData = null,
  communityData = null,
  incomeData = null,
  studentIncome = "",
  studentCategory = "",
  incomeApplicant = "student",
  holderRelationship = null,
  selectedScheme = null,
  hasAadhaarDoc = undefined,
  hasBankDoc = undefined,
  hasTenthDoc = undefined,
  hasTwelfthDoc = undefined,
  hasCommunityDoc = undefined,
  hasIncomeDoc = undefined,
  uploadedDocCount: explicitUploadedDocCount = undefined,
}) {
  const effectiveRelationship =
    holderRelationship !== undefined && holderRelationship !== null
      ? holderRelationship
      : (incomeData?.holderRelationship || (incomeApplicant === "parent" ? "Parent" : "Self"));

  const isTenthUploaded = hasTenthDoc !== undefined ? Boolean(hasTenthDoc) : Boolean(tenthData?.name || tenthData?.percentage || tenthData?.marksScored);
  const isTwelfthUploaded = hasTwelfthDoc !== undefined ? Boolean(hasTwelfthDoc) : Boolean(twelfthData?.name || twelfthData?.percentage || twelfthData?.marksScored);
  const isCommunityUploaded = hasCommunityDoc !== undefined ? Boolean(hasCommunityDoc) : Boolean(communityData?.name || communityData?.caste || communityData?.communityCategory);
  const isIncomeUploaded = hasIncomeDoc !== undefined ? Boolean(hasIncomeDoc) : Boolean(incomeData?.name || incomeData?.incomeNumber || incomeData?.income);
  const isAadhaarUploaded = hasAadhaarDoc !== undefined ? Boolean(hasAadhaarDoc) : Boolean(aadharName || aadharDob);
  const isBankUploaded = hasBankDoc !== undefined ? Boolean(hasBankDoc) : Boolean(bankHolder || bankAccType);

  const calculatedDocCount = [
    isTenthUploaded,
    isTwelfthUploaded,
    isCommunityUploaded,
    isIncomeUploaded,
    isAadhaarUploaded,
    isBankUploaded,
  ].filter(Boolean).length;

  const uploadedDocCount = explicitUploadedDocCount !== undefined ? explicitUploadedDocCount : calculatedDocCount;

  // 1. Student Name Sources (Income Certificate is included ONLY if holder is Self)
  const isSelfIncome = effectiveRelationship === "Self";
  const nameSources = [
    (aadharName && aadharName.trim() ? {
      doc: isAadhaarUploaded ? "Aadhaar Card" : "Self-Reported Applicant Name",
      ico: isAadhaarUploaded ? "🪪" : "👤",
      val: aadharName.trim(),
      strict: true,
      isStudent: true,
      isDocument: isAadhaarUploaded,
      isSelfReported: !isAadhaarUploaded,
    } : null),
    (isCommunityUploaded && communityData?.name ? {
      doc: "Community Certificate",
      ico: "📜",
      val: communityData.name,
      strict: true,
      isStudent: true,
      isDocument: true,
      isSelfReported: false,
    } : null),
    (isIncomeUploaded && isSelfIncome && incomeData?.name ? {
      doc: "Income Certificate",
      ico: "💰",
      val: incomeData.name,
      strict: true,
      isStudent: true,
      isDocument: true,
      isSelfReported: false,
    } : null),
    (isTenthUploaded && tenthData?.name ? {
      doc: "10th Marksheet",
      ico: "📋",
      val: tenthData.name,
      strict: false,
      isStudent: true,
      isMarksheet: true,
      isDocument: true,
      isSelfReported: false,
    } : null),
    (isTwelfthUploaded && twelfthData?.name ? {
      doc: "12th Marksheet",
      ico: "📋",
      val: twelfthData.name,
      strict: false,
      isStudent: true,
      isMarksheet: true,
      isDocument: true,
      isSelfReported: false,
    } : null),
    (bankHolder && bankHolder.trim() ? {
      doc: isBankUploaded ? "Bank Passbook" : "Self-Reported Account Holder",
      ico: isBankUploaded ? "🏦" : "👤",
      val: bankHolder.trim(),
      strict: true,
      isStudent: true,
      isDocument: isBankUploaded,
      isSelfReported: !isBankUploaded,
    } : null),
  ].filter(Boolean);

  const studentDocSources = nameSources.filter(s => s.isDocument);
  const isMultiDocCheckCompleted = studentDocSources.length >= 2;

  // Pair-by-pair comparison across student names
  const namePairs = [];
  for (let i = 0; i < nameSources.length; i++) {
    for (let j = i + 1; j < nameSources.length; j++) {
      const a = nameSources[i];
      const b = nameSources[j];
      const isStrict = a.strict || b.strict;
      let res = compareNames(a.val, b.val, isStrict);

      // If comparing marksheets (or marksheet vs another student document) and there is a mismatch:
      if (res.status === "MISMATCH" && (a.isMarksheet || b.isMarksheet)) {
        res = {
          ...res,
          explanation: "This document shows a different student name. Check the original document and confirm whether this is a reading error or the wrong upload.",
          neutralGuidance: "This document shows a different student name. Check the original document and confirm whether this is a reading error or the wrong upload.",
        };
      }

      const isSelfReportedComparison = a.isSelfReported || b.isSelfReported;
      namePairs.push({ a, b, isStrict, isSelfReportedComparison, ...res });
    }
  }

  // Parent/Guardian Relationship Check for Income Certificate
  let parentRelationshipCheck = null;
  if (isIncomeUploaded && incomeData?.name && !isSelfIncome) {
    const holderName = String(incomeData.name).trim();
    if (effectiveRelationship === "Parent") {
      // Find confirmed parent/guardian name across other documents (Community cert, Marksheets)
      const confirmedParentName = 
        communityData?.fatherName?.trim() || 
        tenthData?.fatherName?.trim() || 
        twelfthData?.fatherName?.trim() || 
        "";

      if (confirmedParentName) {
        const comp = compareNames(holderName, confirmedParentName, true);
        const isConsistent = comp.standardStatus === "Consistent" || comp.status === "EXACT_MATCH" || comp.status === "LIKELY_MATCH";
        parentRelationshipCheck = {
          relationship: "Parent",
          holderName,
          confirmedParentName,
          status: isConsistent ? "Consistent" : "Needs confirmation",
          standardStatus: isConsistent ? "Consistent" : "Needs confirmation",
          explanation: isConsistent
            ? `Income certificate holder matches confirmed parent/guardian name (${confirmedParentName}).`
            : `Income certificate holder (${holderName}) differs from confirmed parent/guardian name (${confirmedParentName}). Please review.`,
          note: "A confirmed relationship does not automatically prove the certificate meets a scheme's rules.",
        };
      } else {
        // Missing relationship evidence = "Needs confirmation", NEVER mismatch!
        parentRelationshipCheck = {
          relationship: "Parent",
          holderName,
          confirmedParentName: null,
          status: "Needs confirmation",
          standardStatus: "Needs confirmation",
          explanation: "Needs confirmation: No confirmed parent/guardian name available across other uploaded documents to verify relationship.",
          note: "Upload community certificate or marksheet showing parent/guardian name to confirm relationship.",
        };
      }
    } else if (effectiveRelationship === "Guardian" || effectiveRelationship === "Other") {
      parentRelationshipCheck = {
        relationship: effectiveRelationship,
        holderName,
        confirmedParentName: null,
        status: "Needs confirmation",
        standardStatus: "Needs confirmation",
        explanation: `Income certificate held by ${effectiveRelationship} (${holderName}). Manual relationship verification required.`,
        note: "A confirmed relationship does not automatically prove the certificate meets a scheme's rules.",
      };
    } else {
      // Unknown
      parentRelationshipCheck = {
        relationship: "Unknown",
        holderName,
        confirmedParentName: null,
        status: "Needs confirmation",
        standardStatus: "Needs confirmation",
        explanation: "Please confirm certificate holder relationship to student (Self / Parent / Guardian / Other). Do not infer solely from similar name.",
        note: "Relationship confirmation is required for income certificate evaluation.",
      };
    }
  }

  const hasNameMismatch = namePairs.some(p => p.status === "MISMATCH");
  const hasParentNeedsConf = Boolean(parentRelationshipCheck && parentRelationshipCheck.standardStatus === "Needs confirmation");
  const hasNameMinor = !hasNameMismatch && (
    namePairs.some(p => p.status === "MINOR_DIFFERENCE" || p.status === "LIKELY_MATCH" || p.status === "NEEDS_REVIEW") ||
    hasParentNeedsConf
  );

  let nameConsistencyStatus = "not_checked_missing";
  let nameConsistencyLabel = "Not checked — document missing";
  if (!isMultiDocCheckCompleted) {
    nameConsistencyStatus = "not_checked_missing";
    nameConsistencyLabel = "Not checked — document missing";
  } else if (hasNameMismatch) {
    nameConsistencyStatus = "red";
    nameConsistencyLabel = "Possible mismatch";
  } else if (hasNameMinor) {
    nameConsistencyStatus = "yellow";
    nameConsistencyLabel = "Needs confirmation";
  } else {
    nameConsistencyStatus = "green";
    nameConsistencyLabel = "Consistent";
  }

  // 2. DOB Sources (Parent DOB is never compared with student DOB)
  const dobSources = [
    (aadharDob.trim() ? { doc: isAadhaarUploaded ? "Aadhaar Card" : "Self-Reported DOB", ico: isAadhaarUploaded ? "🪪" : "👤", val: aadharDob.trim(), isDocument: isAadhaarUploaded } : null),
    (isCommunityUploaded && communityData?.dob ? { doc: "Community Certificate", ico: "📜", val: communityData.dob, isDocument: true } : null),
    (isIncomeUploaded && isSelfIncome && incomeData?.dob ? { doc: "Income Certificate", ico: "💰", val: incomeData.dob, isDocument: true } : null),
    (isTenthUploaded && tenthData?.dob ? { doc: "10th Marksheet", ico: "📋", val: tenthData.dob, isDocument: true } : null),
    (isTwelfthUploaded && twelfthData?.dob ? { doc: "12th Marksheet", ico: "📋", val: twelfthData.dob, isDocument: true } : null),
  ].filter(Boolean);

  const hasDobDoc = (isAadhaarUploaded && Boolean(aadharDob)) || (isTenthUploaded && Boolean(tenthData?.dob)) || (isTwelfthUploaded && Boolean(twelfthData?.dob)) || (isCommunityUploaded && Boolean(communityData?.dob));

  const dobPairs = [];
  if (aadharDob.trim()) {
    for (const src of dobSources) {
      if (src.doc !== "Aadhaar Card" && src.doc !== "Self-Reported DOB") {
        const res = compareDOB(src.val, aadharDob.trim());
        dobPairs.push({ doc: src.doc, ico: src.ico, val: src.val, ...res });
      }
    }
  }

  const hasDobMismatch = dobPairs.some(p => p.status === "MISMATCH");
  let dobConsistencyStatus = "not_checked_missing";
  let dobConsistencyLabel = "Not checked — document missing";
  if (!hasDobDoc) {
    dobConsistencyStatus = "not_checked_missing";
    dobConsistencyLabel = "Not checked — document missing";
  } else if (!aadharDob.trim()) {
    dobConsistencyStatus = "grey";
    dobConsistencyLabel = "Pending reference DOB";
  } else if (hasDobMismatch) {
    dobConsistencyStatus = "red";
    dobConsistencyLabel = "Possible mismatch";
  } else if (dobPairs.some(p => p.status === "MATCH")) {
    dobConsistencyStatus = "green";
    dobConsistencyLabel = "Consistent";
  } else {
    dobConsistencyStatus = "grey";
    dobConsistencyLabel = "Needs confirmation";
  }

  // 3. Income Check
  const isIncomeExpiryConfirmed = Boolean(
    incomeData?.isExpiryConfirmed ||
    incomeData?.confirmedFields?.validUpto
  );
  const incomeResult = compareIncome(
    incomeData?.incomeNumber || incomeData?.income,
    studentIncome,
    incomeData?.issueDate,
    incomeData?.validUpto,
    {
      isExpiryConfirmed: isIncomeExpiryConfirmed,
      selectedScheme,
    }
  );

  // 4. Community Check
  const communityResult = compareCommunity(
    communityData?.communityCategory || communityData?.community,
    studentCategory
  );

  let bankConsistencyStatus = isBankUploaded ? (bankAccType === "Single" ? "green" : bankAccType === "Joint" ? "red" : "grey") : "not_checked_missing";
  let bankConsistencyLabel = isBankUploaded ? (bankAccType === "Single" ? "Consistent" : bankAccType === "Joint" ? "Possible mismatch" : "Needs confirmation") : "Not checked — document missing";

  let communityConsistencyStatus = isCommunityUploaded ? (communityResult.status === "MATCH" ? "green" : communityResult.status === "MISMATCH" ? "red" : "grey") : "not_checked_missing";
  let communityConsistencyLabel = isCommunityUploaded ? (communityResult.standardStatus || "Consistent") : "Not checked — document missing";

  // 5. Pre-Submission Readiness / Consistency Score Breakdown
  let scorePoints = 0;
  let maxPoints = 0;
  const breakdown = [];

  // Name Score (30 pts)
  maxPoints += 30;
  if (!isMultiDocCheckCompleted) {
    breakdown.push({
      item: "Document Name Consistency Across Documents",
      status: "NOT_CHECKED",
      points: 0,
      max: 30,
      label: "Not checked — document missing",
      note: "Not checked — document missing (at least two uploaded student documents required for multi-document consistency check).",
    });
  } else if (nameConsistencyStatus === "green") {
    scorePoints += 30;
    breakdown.push({ item: "Document Name Consistency Across Documents", status: "PASS", points: 30, max: 30, label: "Consistent", note: "All document names match or have acceptable token variations." });
  } else if (nameConsistencyStatus === "yellow") {
    scorePoints += 20;
    const note = incomeApplicant === "parent"
      ? "Parent declared as income applicant. Review required for parental relationship."
      : "Minor name formatting/initial difference detected.";
    breakdown.push({ item: "Document Name Consistency Across Documents", status: "WARN", points: 20, max: 30, label: "Needs confirmation", note });
  } else if (nameConsistencyStatus === "red") {
    breakdown.push({ item: "Document Name Consistency Across Documents", status: "FAIL", points: 0, max: 30, label: "Possible mismatch", note: "Name mismatch detected between key identity documents." });
  } else {
    breakdown.push({ item: "Document Name Consistency Across Documents", status: "PENDING", points: 0, max: 30, label: "Pending", note: "Upload documents to verify name consistency." });
  }

  // DOB Score (20 pts)
  maxPoints += 20;
  if (!hasDobDoc) {
    breakdown.push({
      item: "Date of Birth Consistency",
      status: "NOT_CHECKED",
      points: 0,
      max: 20,
      label: "Not checked — document missing",
      note: "Not checked — document missing (upload Aadhaar card or marksheet showing DOB).",
    });
  } else if (dobConsistencyStatus === "green") {
    scorePoints += 20;
    breakdown.push({ item: "Date of Birth Consistency", status: "PASS", points: 20, max: 20, label: "Consistent", note: "DOB is consistent with Aadhaar reference." });
  } else if (dobConsistencyStatus === "red") {
    scorePoints += 0;
    breakdown.push({ item: "Date of Birth Consistency", status: "FAIL", points: 0, max: 20, label: "Possible mismatch", note: "DOB on certificate does not match Aadhaar." });
  } else {
    breakdown.push({ item: "Date of Birth Consistency", status: "PENDING", points: 0, max: 20, label: "Needs confirmation", note: "DOB check pending." });
  }

  // Income Freshness & Consistency (20 pts)
  maxPoints += 20;
  if (!isIncomeUploaded) {
    breakdown.push({
      item: "Income Verification & Freshness",
      status: "NOT_CHECKED",
      points: 0,
      max: 20,
      label: "Not checked — document missing",
      note: "Not checked — document missing (Income certificate not uploaded).",
    });
  } else if (incomeResult.status === "MATCH" && (incomeResult.freshness?.status === "valid" || incomeResult.freshness?.status === "needs_confirmation" || incomeResult.freshness?.status === "unknown")) {
    scorePoints += 20;
    breakdown.push({ item: "Income Verification & Freshness", status: "PASS", points: 20, max: 20, label: "Consistent", note: "Income matches student input." });
  } else if (incomeResult.status === "MATCH" && (incomeResult.freshness?.status === "warning" || incomeResult.freshness?.status === "outside_window")) {
    scorePoints += 15;
    breakdown.push({ item: "Income Verification & Freshness", status: "WARN", points: 15, max: 20, label: "Needs confirmation", note: incomeResult.freshness?.detail || "Income matches, but certificate requires confirmation." });
  } else if (incomeResult.status === "EXPIRED" || incomeResult.freshness?.isExpired) {
    breakdown.push({ item: "Income Verification & Freshness", status: "FAIL", points: 0, max: 20, label: "Expired", note: "Income certificate has expired." });
  } else if (incomeResult.status === "MISMATCH") {
    breakdown.push({ item: "Income Verification & Freshness", status: "FAIL", points: 0, max: 20, label: "Possible mismatch", note: "Income amount differs between certificate and student input." });
  } else {
    breakdown.push({ item: "Income Verification & Freshness", status: "PENDING", points: 0, max: 20, label: "Pending", note: "Upload income certificate to verify." });
  }

  // Community Category Match (15 pts)
  maxPoints += 15;
  if (!isCommunityUploaded) {
    breakdown.push({
      item: "Community Category Consistency",
      status: "NOT_CHECKED",
      points: 0,
      max: 15,
      label: "Not checked — document missing",
      note: "Not checked — document missing (Community Certificate not uploaded; using self-reported category).",
    });
  } else if (communityResult.status === "MATCH") {
    scorePoints += 15;
    breakdown.push({ item: "Community Category Consistency", status: "PASS", points: 15, max: 15, label: "Consistent", note: "Community category matches certificate." });
  } else if (communityResult.status === "MISMATCH") {
    breakdown.push({ item: "Community Category Consistency", status: "FAIL", points: 0, max: 15, label: "Possible mismatch", note: "Entered category differs from certificate." });
  } else {
    breakdown.push({ item: "Community Category Consistency", status: "PENDING", points: 0, max: 15, label: "Pending", note: "Upload community certificate to verify." });
  }

  // Bank Account Type (15 pts)
  maxPoints += 15;
  if (!isBankUploaded) {
    breakdown.push({
      item: "Bank Account Verification",
      status: "NOT_CHECKED",
      points: 0,
      max: 15,
      label: "Not checked — document missing",
      note: "Not checked — document missing (Bank passbook not uploaded; self-reported Single account pending document verification).",
    });
  } else if (bankAccType === "Single") {
    scorePoints += 15;
    breakdown.push({ item: "Bank Account Verification", status: "PASS", points: 15, max: 15, label: "Consistent", note: "Single Savings Account confirmed on passbook." });
  } else if (bankAccType === "Joint") {
    breakdown.push({ item: "Bank Account Verification", status: "FAIL", points: 0, max: 15, label: "Rejected", note: "Joint accounts are rejected for NSP direct benefit transfer." });
  } else {
    breakdown.push({ item: "Bank Account Verification", status: "PENDING", points: 0, max: 15, label: "Pending", note: "Bank details pending." });
  }

  const consistencyPercentage = maxPoints > 0 ? Math.round((scorePoints / maxPoints) * 100) : 0;
  let overallReadiness = "Needs Review";
  if (uploadedDocCount < 2) {
    overallReadiness = "Partial Documentation — Multi-Document Check Incomplete";
  } else if (hasNameMismatch || hasDobMismatch || bankAccType === "Joint" || incomeResult.status === "EXPIRED" || communityResult.status === "MISMATCH") {
    overallReadiness = "Issues Found — Correction Required";
  } else if (consistencyPercentage >= 85) {
    overallReadiness = "High Consistency — Ready for Official Application";
  } else if (consistencyPercentage >= 60) {
    overallReadiness = "Moderate Consistency — Review Warnings";
  }

  const unresolvedIssues = [];
  if (tenthData && !tenthData.name) {
    unresolvedIssues.push({ doc: "10th Marksheet", field: "Student Name", message: "Could not read required student name on 10th Marksheet." });
  }
  if (twelfthData && !twelfthData.name) {
    unresolvedIssues.push({ doc: "12th Marksheet", field: "Student Name", message: "Could not read required student name on 12th Marksheet." });
  }
  if (communityData && !communityData.name) {
    unresolvedIssues.push({ doc: "Community Certificate", field: "Student Name", message: "Could not read required student name on Community Certificate." });
  }
  if (incomeData && !incomeData.name) {
    unresolvedIssues.push({ doc: "Income Certificate", field: "Holder Name", message: "Could not read certificate holder name on Income Certificate." });
  }
  namePairs.forEach(p => {
    if (p.status === "MISMATCH") {
      unresolvedIssues.push({
        doc: `${p.a.doc} vs ${p.b.doc}`,
        field: "Student Name",
        message: (p.a.isMarksheet || p.b.isMarksheet)
          ? "This document shows a different student name. Check the original document and confirm whether this is a reading error or the wrong upload."
          : `Name difference between ${p.a.doc} (${p.a.val}) and ${p.b.doc} (${p.b.val}).`,
      });
    }
  });
  if (parentRelationshipCheck && parentRelationshipCheck.standardStatus === "Needs confirmation") {
    unresolvedIssues.push({
      doc: "Income Certificate",
      field: "Holder Relationship",
      message: parentRelationshipCheck.explanation,
    });
  }
  if (incomeResult?.freshness?.isExpired) {
    unresolvedIssues.push({
      doc: "Income Certificate",
      field: "Expiry Date",
      message: incomeResult.freshness.detail || `Income certificate expired on ${incomeData?.validUpto}. A renewed certificate is required.`,
    });
  } else if (incomeResult?.freshness?.isUnconfirmedExpiry) {
    unresolvedIssues.push({
      doc: "Income Certificate",
      field: "Expiry Date",
      message: `OCR extracted expiry date (${incomeData?.validUpto}). Please review and confirm this date against the document.`,
    });
  } else if (incomeResult?.freshness?.status === "outside_window") {
    unresolvedIssues.push({
      doc: "Income Certificate",
      field: "Issue Date",
      message: incomeResult.freshness.detail,
    });
  }

  return {
    incomeApplicant,
    holderRelationship: effectiveRelationship,
    parentRelationshipCheck,
    unresolvedIssues,
    nameSources,
    namePairs,
    nameConsistencyStatus,
    hasNameMismatch,
    hasNameMinor,
    dobSources,
    dobPairs,
    dobConsistencyStatus,
    hasDobMismatch,
    uploadedDocCount,
    isMultiDocCheckCompleted,
    nameConsistencyLabel,
    dobConsistencyLabel,
    bankConsistencyStatus,
    bankConsistencyLabel,
    communityConsistencyStatus,
    communityConsistencyLabel,
    incomeResult,
    communityResult,
    scorePoints,
    maxPoints,
    consistencyPercentage,
    overallReadiness,
    breakdown,
  };
}

/**
 * Reconciles candidate student names across multiple uploaded documents.
 * Employs cross-document consensus to resolve character ambiguity (e.g. N1THISHKUMAR vs NITHISHKUMAR).
 * 
 * Safety Principle:
 * Strictly uses audit note: "Name appears consistent across uploaded documents."
 * NEVER claims: "Name verified by government."
 */
export function reconcileCrossDocumentName(documents = []) {
  const docs = Array.isArray(documents)
    ? documents
    : Object.entries(documents).map(([k, v]) => ({ docType: k, ...(v || {}) }));

  const validEntries = docs.filter(d => d && (d.name || d.candidateName || d.studentName || d.rawValue));
  if (!validEntries.length) {
    return {
      consensusName: null,
      status: "NOT_DETECTED",
      confidence: 0,
      note: "No candidate name detected across uploaded documents.",
      agreements: 0,
      hasConflict: false,
    };
  }

  // Extract and normalize candidates
  const candidates = validEntries.map(d => {
    const raw = String(d.name || d.candidateName || d.studentName || d.rawValue || "").trim();
    // Common OCR digit substitution for cross-document reconciliation
    const cleaned = raw.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
    const norm = cleaned.toUpperCase().replace(/[^A-Z]/g, "");
    return {
      docType: d.docType || "document",
      raw,
      cleaned,
      norm,
      hasConfusion: /\d/.test(raw),
      confidence: typeof d.confidence === "number" ? d.confidence : 80,
    };
  }).filter(c => c.norm.length >= 3);

  if (!candidates.length) {
    return {
      consensusName: null,
      status: "NOT_DETECTED",
      confidence: 0,
      note: "No valid candidate name format detected.",
      agreements: 0,
      hasConflict: false,
    };
  }

  // Count frequency of normalized name
  const freq = {};
  for (const c of candidates) {
    freq[c.norm] = (freq[c.norm] || 0) + 1;
  }

  const sortedNorms = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
  const bestNorm = sortedNorms[0];
  const bestCount = freq[bestNorm];

  // Check for genuine conflicts (multiple distinct names with significant presence)
  const conflictingNorms = sortedNorms.filter(n => n !== bestNorm);
  const hasConflict = conflictingNorms.length > 0 && conflictingNorms.some(n => freq[n] >= 1 && levenshteinDistance(n, bestNorm) > 2);

  // Pick representative best display name (preferring clean string without numbers)
  const matchingCandidates = candidates.filter(c => c.norm === bestNorm);
  const cleanMatch = matchingCandidates.find(c => !c.hasConfusion);
  const consensusName = cleanMatch ? cleanMatch.raw : matchingCandidates[0].cleaned;

  if (hasConflict) {
    return {
      consensusName,
      status: "NEEDS_REVIEW",
      confidence: 60,
      note: "Conflicting names detected across uploaded documents. Manual review required.",
      agreements: bestCount,
      totalDocuments: candidates.length,
      hasConflict: true,
    };
  }

  if (bestCount >= 2) {
    const hasResolvedConfusion = matchingCandidates.some(c => c.hasConfusion);
    return {
      consensusName,
      status: hasResolvedConfusion ? "NEEDS_REVIEW" : "HIGH_CONFIDENCE",
      confidence: Math.min(98, 85 + bestCount * 4),
      note: "Name appears consistent across uploaded documents.",
      agreements: bestCount,
      totalDocuments: candidates.length,
      hasConflict: false,
      hasResolvedConfusion,
    };
  }

  // Single document agreement
  const single = matchingCandidates[0];
  return {
    consensusName,
    status: single.hasConfusion ? "NEEDS_REVIEW" : "HIGH_CONFIDENCE",
    confidence: single.hasConfusion ? 68 : Math.round(single.confidence),
    note: single.hasConfusion
      ? "OCR character ambiguity detected; verification recommended."
      : "Candidate name detected from uploaded document.",
    agreements: 1,
    totalDocuments: 1,
    hasConflict: false,
  };
}

/**
 * Evaluates holistic cross-document consistency across a multi-document cohort.
 * 
 * Compares:
 * - 10th name, 12th name, Community name, Income applicant name
 * - Date of Birth (DOB) where available
 * 
 * Returns one of 4 standardized statuses:
 * - "CONSISTENT": All valid documents show consistent names and matching DOB.
 * - "MINOR DIFFERENCE": Minor character/initial differences or single-char edit distance without contradiction.
 * - "SIGNIFICANT CONFLICT": Conflicting names or conflicting birth dates between uploaded documents.
 * - "INSUFFICIENT DATA": Fewer than two documents available with readable identity information.
 * 
 * Strictly uses neutral, non-authoritative wording.
 * NEVER claims: "certificate is genuine", "government verified", "UIDAI verified", or "officially authenticated".
 */
export function evaluateCrossDocumentCase(documents = {}) {
  const docs = Array.isArray(documents)
    ? documents
    : Object.entries(documents).map(([k, v]) => ({ docType: k, ...(v || {}) }));

  const validDocs = docs.filter(d => d && (d.name || d.candidateName || d.studentName || d.applicantName || d.dob || d.dateOfBirth));

  if (validDocs.length < 2) {
    return {
      status: "INSUFFICIENT DATA",
      hasConflict: false,
      hasMinor: false,
      nameStatus: "INSUFFICIENT DATA",
      dobStatus: "INSUFFICIENT DATA",
      explanation: "Insufficient uploaded documents to perform cross-document consistency check (minimum 2 required).",
      documentCount: validDocs.length,
    };
  }

  // Name comparisons across all pairs
  const nameEntries = validDocs
    .map(d => ({ docType: d.docType || "document", name: String(d.name || d.candidateName || d.studentName || d.applicantName || "").trim() }))
    .filter(e => e.name && e.name.toLowerCase() !== "null" && e.name.toLowerCase() !== "not_detected");

  if (nameEntries.length < 2) {
    return {
      status: "INSUFFICIENT DATA",
      hasConflict: false,
      hasMinor: false,
      nameStatus: "INSUFFICIENT DATA",
      dobStatus: "INSUFFICIENT DATA",
      explanation: "Fewer than two documents contained a detected candidate name.",
      documentCount: validDocs.length,
    };
  }

  let hasConflict = false;
  let hasMinor = false;
  const nameDetails = [];

  for (let i = 0; i < nameEntries.length; i++) {
    for (let j = i + 1; j < nameEntries.length; j++) {
      const a = nameEntries[i];
      const b = nameEntries[j];
      const comp = compareNames(a.name, b.name, false);
      nameDetails.push({ a: a.docType, b: b.docType, status: comp.status, explanation: comp.explanation });
      if (comp.status === "MISMATCH") {
        hasConflict = true;
      } else if (comp.status === "MINOR_DIFFERENCE" || comp.status === "LIKELY_MATCH" || comp.status === "NEEDS_REVIEW") {
        hasMinor = true;
      }
    }
  }

  // DOB comparisons
  const dobEntries = validDocs
    .map(d => ({ docType: d.docType || "document", dob: String(d.dob || d.dateOfBirth || "").trim() }))
    .filter(e => e.dob && e.dob.toLowerCase() !== "null");

  let dobConflict = false;
  if (dobEntries.length >= 2) {
    for (let i = 0; i < dobEntries.length; i++) {
      for (let j = i + 1; j < dobEntries.length; j++) {
        const dComp = compareDOB(dobEntries[i].dob, dobEntries[j].dob);
        if (dComp.status === "MISMATCH") {
          dobConflict = true;
          hasConflict = true;
        }
      }
    }
  }

  // Parent name comparisons (do not compare income holder's father name with student's father name: these represent different generations)
  const parentEntries = validDocs
    .filter(d => (d.docType || d.type) !== "income")
    .map(d => ({ docType: d.docType || "document", parentName: String(d.parentName || d.fatherName || d.motherName || "").trim() }))
    .filter(e => e.parentName && e.parentName.toLowerCase() !== "null" && e.parentName.toLowerCase() !== "not_detected");

  let parentConflict = false;
  let parentMinor = false;
  const parentDetails = [];
  if (parentEntries.length >= 2) {
    for (let i = 0; i < parentEntries.length; i++) {
      for (let j = i + 1; j < parentEntries.length; j++) {
        const pComp = compareNames(parentEntries[i].parentName, parentEntries[j].parentName, false);
        parentDetails.push({ a: parentEntries[i].docType, b: parentEntries[j].docType, status: pComp.status, explanation: pComp.explanation });
        if (pComp.status === "MISMATCH") {
          parentConflict = true;
          hasConflict = true;
        } else if (pComp.status === "MINOR_DIFFERENCE" || pComp.status === "LIKELY_MATCH" || pComp.status === "NEEDS_REVIEW") {
          parentMinor = true;
          hasMinor = true;
        }
      }
    }
  }

  let overallStatus = "CONSISTENT";
  let explanation = "Information appears consistent across uploaded documents.";

  if (hasConflict) {
    overallStatus = "SIGNIFICANT CONFLICT";
    explanation = dobConflict
      ? "Conflicting date of birth or name values detected between uploaded documents. Manual review required."
      : parentConflict
      ? "Conflicting parent name values detected between uploaded documents. Manual review required."
      : "Conflicting candidate names detected across uploaded documents. Manual review required.";
  } else if (hasMinor) {
    overallStatus = "MINOR DIFFERENCE";
    explanation = "Minor name variation or initial difference detected between uploaded documents; review recommended.";
  }

  return {
    status: overallStatus,
    hasConflict,
    hasMinor,
    nameStatus: hasConflict ? "SIGNIFICANT CONFLICT" : hasMinor ? "MINOR DIFFERENCE" : "CONSISTENT",
    dobStatus: dobConflict ? "SIGNIFICANT CONFLICT" : dobEntries.length >= 2 ? "CONSISTENT" : "INSUFFICIENT DATA",
    parentStatus: parentConflict ? "SIGNIFICANT CONFLICT" : parentMinor ? "MINOR DIFFERENCE" : parentEntries.length >= 2 ? "CONSISTENT" : "INSUFFICIENT DATA",
    explanation,
    documentCount: validDocs.length,
    nameComparisons: nameDetails,
    parentComparisons: parentDetails,
  };
}

