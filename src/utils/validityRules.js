/**
 * validityRules.js — SGP Document Validity & Scheme Acceptance Engine
 * 
 * Strictly keeps three concepts separate:
 * A. Document Expiry: An explicit expiry date or a verified issuing-authority rule.
 * B. Scheme Acceptance: A scheme may require a document issued during a particular period.
 * C. Unknown Validity: Insufficient verified information.
 * 
 * Safety Principles:
 * - Never assume income or community certificates expire annually unless an explicit rule applies.
 * - If a rule is missing or stale, show "Needs confirmation".
 * - Never fabricate a validity decision.
 * - Every validity rule documents scheme, application year, document type, description,
 *   official source URL, effective dates, last reviewed date, and rule version.
 */

import { parseIndianDate } from "./fieldNormalizer";

/**
 * Verified Scheme-Specific Validity & Acceptance Rules Catalogue.
 * Stored with full citations, official sources, and review metadata.
 */
export const SCHEME_VALIDITY_RULES = [
  {
    ruleId: "RULE-PMS-SC-INC-2025",
    schemeId: "pms-sc",
    schemeName: "Post-Matric Scholarship for SC Students (PMS-SC)",
    applicationYear: "2025-26",
    documentType: "income",
    ruleDescription:
      "Income certificate issued by the competent Revenue Authority designated by the State / UT. Income ceiling ₹2.50 lakh per annum.",
    officialSourceUrl: "https://socialjustice.gov.in/schemes/30",
    effectiveFrom: "2025-04-01",
    effectiveTo: "2026-03-31",
    windowMonths: 12,
    windowRequiresCurrentFY: false,
    lastReviewed: "2025-10-15",
    isVerifiedAmendment: false,
    isOfficialChange: false,
    whatChanged: null,
    changeLog: [],
  },
  {
    ruleId: "RULE-PMS-ST-INC-2025",
    schemeId: "pms-st",
    schemeName: "Post-Matric Scholarship for ST Students (PMS-ST)",
    applicationYear: "2025-26",
    documentType: "income",
    ruleDescription:
      "Income certificate issued by competent State / UT Revenue Authority. Income ceiling ₹2.50 lakh per annum.",
    officialSourceUrl: "https://tribal.nic.in/Scholarships.aspx",
    effectiveFrom: "2025-04-01",
    effectiveTo: "2026-03-31",
    windowMonths: 12,
    windowRequiresCurrentFY: false,
    lastReviewed: "2025-10-15",
    isVerifiedAmendment: false,
    isOfficialChange: false,
    whatChanged: null,
    changeLog: [],
  },
  {
    ruleId: "RULE-PMS-OBC-INC-2025",
    schemeId: "pms-obc",
    schemeName: "Post-Matric Scholarship for OBC Students (PMS-OBC)",
    applicationYear: "2025-26",
    documentType: "income",
    ruleDescription:
      "Annual income certificate issued by a Revenue Officer not below the rank of Tahsildar for the relevant assessment year. Income ceiling ₹2.50 lakh per annum.",
    officialSourceUrl: "https://socialjustice.gov.in",
    effectiveFrom: "2025-04-01",
    effectiveTo: "2026-03-31",
    windowMonths: 12,
    windowRequiresCurrentFY: false,
    lastReviewed: "2025-10-15",
    isVerifiedAmendment: false,
    isOfficialChange: false,
    whatChanged: null,
    changeLog: [],
  },
  {
    ruleId: "RULE-CSSS-INC-2025",
    schemeId: "csss",
    schemeName: "PM-USP Central Sector Scheme of Scholarships (CSSS)",
    applicationYear: "2025-26",
    documentType: "income",
    ruleDescription:
      "Income certificate for current financial year showing total family income not exceeding ₹4,50,000 per annum.",
    officialSourceUrl: "https://www.education.gov.in/scholarships-education-loan-0",
    effectiveFrom: "2025-04-01",
    effectiveTo: "2026-03-31",
    windowMonths: 12,
    windowRequiresCurrentFY: false,
    lastReviewed: "2025-10-15",
    isVerifiedAmendment: false,
    isOfficialChange: false,
    whatChanged: null,
    changeLog: [],
  },
  {
    ruleId: "RULE-TN-BC-INC-2025",
    schemeId: "tn-bc-mbc",
    schemeName: "Tamil Nadu State Post-Matric Scholarship (BC / MBC / DNC)",
    applicationYear: "2025-26",
    documentType: "income",
    ruleDescription:
      "Income certificate issued by Tamil Nadu Revenue Department via e-Sevai portal within the current financial year.",
    officialSourceUrl: "https://www.bcmbcmw.tn.gov.in",
    effectiveFrom: "2025-04-01",
    effectiveTo: "2026-03-31",
    windowMonths: 12,
    windowRequiresCurrentFY: false,
    lastReviewed: "2025-10-15",
    isVerifiedAmendment: false,
    isOfficialChange: false,
    whatChanged: null,
    changeLog: [],
  },
  {
    ruleId: "RULE-COMMUNITY-PERMANENT",
    schemeId: "all",
    schemeName: "All Central & State Scholarship Schemes",
    applicationYear: "2025-26",
    documentType: "community",
    ruleDescription:
      "Community / Caste certificates issued by competent Revenue Authorities are generally permanent for SC/ST under state revenue rules; OBC certificates may require updated financial / creamy-layer verification.",
    officialSourceUrl: "https://socialjustice.gov.in",
    effectiveFrom: "2020-01-01",
    effectiveTo: "2030-12-31",
    windowMonths: null,
    isPermanentDoc: true,
    lastReviewed: "2025-10-15",
    isVerifiedAmendment: false,
    isOfficialChange: false,
    whatChanged: null,
    changeLog: [],
  },
  {
    ruleId: "RULE-MARKSHEET-PERMANENT",
    schemeId: "all",
    schemeName: "All Central & State Scholarship Schemes",
    applicationYear: "2025-26",
    documentType: "marksheet",
    ruleDescription:
      "Board marksheets (10th / 12th) issued by recognized examining boards are permanent qualification records.",
    officialSourceUrl: "https://scholarships.gov.in",
    effectiveFrom: "2000-01-01",
    effectiveTo: "2030-12-31",
    windowMonths: null,
    isPermanentDoc: true,
    lastReviewed: "2025-10-15",
    isVerifiedAmendment: false,
    isOfficialChange: false,
    whatChanged: null,
    changeLog: [],
  },
];

/**
 * Finds applicable rule for a scheme, document type, and application year.
 */
export function findValidityRule(schemeId, docType, appYear = "2025-26") {
  if (!docType) return null;

  // 1. Direct match for scheme + docType
  let rule = SCHEME_VALIDITY_RULES.find(
    (r) =>
      r.schemeId === schemeId &&
      (r.documentType === docType || (docType.startsWith("ms") && r.documentType === "marksheet")) &&
      r.applicationYear === appYear
  );

  // 2. Fallback to generic "all" scheme rule for this docType
  if (!rule) {
    rule = SCHEME_VALIDITY_RULES.find(
      (r) =>
        r.schemeId === "all" &&
        (r.documentType === docType || (docType.startsWith("ms") && r.documentType === "marksheet"))
    );
  }

  return rule || null;
}

/**
 * Evaluates document validity and scheme acceptance.
 * 
 * @param {Object} params
 * @param {string} params.docType
 * @param {string} [params.issueDate] e.g. "12-06-2023" or "2023-06-12"
 * @param {string} [params.expiryDate] e.g. "11-06-2024" (explicit expiry on document)
 * @param {string} [params.schemeId] e.g. "pms-sc"
 * @param {string} [params.applicationYear] e.g. "2025-26"
 * @param {Date} [params.referenceDate] Defaults to current date
 * @returns {Object} Structured validity evaluation
 */
export function evaluateDocumentValidity(docOrParams, schemeIdArg, appYearArg, param4, param5) {
  let docType;
  let issueDate = null;
  let expiryDate = null;
  let schemeId = "pms-sc";
  let applicationYear = "2025-26";
  let referenceDate = new Date();

  if (typeof docOrParams === "string") {
    docType = docOrParams;
    if (typeof schemeIdArg === "string" && (schemeIdArg.includes("-") || schemeIdArg.includes("/"))) {
      issueDate = schemeIdArg;
      expiryDate = appYearArg || null;
      schemeId = param4 || "pms-sc";
      applicationYear = param5 || "2025-26";
    } else {
      schemeId = schemeIdArg || "pms-sc";
      applicationYear = appYearArg || "2025-26";
    }
  }

  let isExpiryConfirmed = false;

  if (typeof docOrParams === "object" && docOrParams !== null) {
    docType = docOrParams.docType || docOrParams.type || "income";
    issueDate = docOrParams.issueDate || null;
    expiryDate = docOrParams.expiryDate || docOrParams.validUpto || null;
    schemeId = docOrParams.schemeId || schemeIdArg || "pms-sc";
    applicationYear = docOrParams.applicationYear || appYearArg || "2025-26";
    if (docOrParams.referenceDate) referenceDate = docOrParams.referenceDate;
    // Provenance rule: Only confirmed if isExpiryConfirmed is EXPLICITLY true.
    // confirmedValues.validUpto = OCR extracted it; confirmedFields.validUpto = student reviewed it.
    isExpiryConfirmed = docOrParams.isExpiryConfirmed !== undefined
      ? Boolean(docOrParams.isExpiryConfirmed)
      : docOrParams.isConfirmed !== undefined
        ? Boolean(docOrParams.isConfirmed)
        : Boolean(docOrParams.confirmedFields?.validUpto); // Only confirmedFields counts
  } else {
    // Positional/legacy call: explicit boolean arg only; default = false (unconfirmed)
    isExpiryConfirmed = param4 !== undefined ? Boolean(param4) : false;
  }

  const normDocType = (docType || "").toLowerCase();
  const normSchemeId = (schemeId || "").toLowerCase();

  const isIncome = normDocType.includes("income");
  const isCommunity = normDocType.includes("communit");
  const isMarksheet = normDocType.includes("mark") || normDocType.startsWith("ms");

  const canonicalDocType = isIncome ? "income" : isCommunity ? "community" : isMarksheet ? "marksheet" : normDocType;
  const rule = findValidityRule(normSchemeId, canonicalDocType, applicationYear) || findValidityRule(normSchemeId, canonicalDocType, "2025-26");

  // A. DOCUMENT EXPIRY (Concept A)
  // Determined ONLY by explicit expiry date printed on document or verified permanent status
  let expiryStatus = "UNKNOWN_VALIDITY";
  let expiryMessage = "No explicit expiry date printed on document.";
  let parsedExpiry = null;

  if (expiryDate) {
    parsedExpiry = parseIndianDate(expiryDate);
    if (parsedExpiry && !isNaN(parsedExpiry.getTime())) {
      if (!isExpiryConfirmed) {
        expiryStatus = "NEEDS_CONFIRMATION";
        expiryMessage = `OCR extracted expiry date ${expiryDate}. Please confirm the expiry date against your original certificate.`;
      } else if (parsedExpiry.getTime() < referenceDate.getTime()) {
        expiryStatus = "EXPIRED";
        expiryMessage = `Document explicitly expired on ${expiryDate}. A renewed certificate is required.`;
      } else {
        const daysLeft = Math.round((parsedExpiry.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 30) {
          expiryStatus = "EXPIRING_SOON";
          expiryMessage = `Document valid until ${expiryDate} (${daysLeft} day(s) remaining).`;
        } else {
          expiryStatus = "NOT_EXPIRED";
          expiryMessage = `Document valid until ${expiryDate}.`;
        }
      }
    } else {
      expiryStatus = "NEEDS_CONFIRMATION";
      expiryMessage = `Expiry date format '${expiryDate}' needs confirmation.`;
    }
  } else if (rule?.isPermanentDoc || isCommunity || isMarksheet) {
    expiryStatus = "PERMANENT_RECORD";
    expiryMessage = "Permanent certificate / marksheet — no recurring expiry date applies.";
  } else {
    expiryStatus = "UNKNOWN_VALIDITY";
    expiryMessage = "No explicit expiry date printed on document.";
  }

  // B. SCHEME ACCEPTANCE WINDOW (Concept B)
  // Determined by scheme policy requirements for certificate age / issue window
  let acceptanceStatus = "NEEDS_CONFIRMATION";
  let acceptanceMessage = "Document acceptance needs confirmation for the selected scheme.";
  let parsedIssue = null;

  if (!rule) {
    acceptanceStatus = "NEEDS_CONFIRMATION";
    acceptanceMessage = "Document acceptance needs confirmation for the selected scheme.";
  } else if (rule.isPermanentDoc || isCommunity || isMarksheet) {
    acceptanceStatus = "WITHIN_WINDOW";
    acceptanceMessage = "Document meets permanent qualification requirement.";
  } else if (isIncome) {
    if (!issueDate) {
      acceptanceStatus = "NEEDS_CONFIRMATION";
      acceptanceMessage = "Issue date not available. Please confirm issue date to verify scheme acceptance window.";
    } else {
      parsedIssue = parseIndianDate(issueDate);
      if (!parsedIssue || !parsedIssue.getTime || isNaN(parsedIssue.getTime())) {
        acceptanceStatus = "NEEDS_CONFIRMATION";
        acceptanceMessage = `Issue date '${issueDate}' could not be parsed. Needs student confirmation.`;
      } else {
        const diffMs = referenceDate.getTime() - parsedIssue.getTime();
        const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);

        if (diffMonths < 0) {
          acceptanceStatus = "NEEDS_CONFIRMATION";
          acceptanceMessage = "Issue date is in the future. Please check and correct the extracted date.";
        } else if (rule.windowMonths && diffMonths > rule.windowMonths) {
          acceptanceStatus = "OUTSIDE_WINDOW";
          acceptanceMessage = `Issued ${Math.round(diffMonths)} months ago (${issueDate}). Scheme guideline requires issuance within ${rule.windowMonths} months. Needs official confirmation.`;
        } else if (rule.windowMonths && diffMonths > (rule.windowMonths / 2)) {
          acceptanceStatus = "WITHIN_WINDOW_CAUTION";
          acceptanceMessage = `Issued ${Math.round(diffMonths)} months ago. Within ${rule.windowMonths}-month window, but verifying current financial year validity is recommended.`;
        } else {
          acceptanceStatus = "WITHIN_WINDOW";
          acceptanceMessage = `Issued on ${issueDate} (recent). Fully within scheme acceptance window.`;
        }
      }
    }
  } else {
    acceptanceStatus = "WITHIN_WINDOW";
    acceptanceMessage = "Document accepted under standard guidelines.";
  }

  // C. UNKNOWN VALIDITY (Concept C)
  // When verified rule or document data is insufficient
  const isUnknown = (!rule) || (expiryStatus === "UNKNOWN_VALIDITY" && acceptanceStatus === "NEEDS_CONFIRMATION");

  // Overall status derivation
  let status = "valid";
  let concept = "CONCEPT_B_SCHEME_WINDOW";

  if (expiryStatus === "EXPIRED") {
    status = "expired";
    concept = "CONCEPT_A_EXPLICIT_EXPIRY";
  } else if (acceptanceStatus === "OUTSIDE_WINDOW") {
    status = "outside_window";
    concept = "CONCEPT_B_SCHEME_WINDOW";
  } else if (isUnknown || acceptanceStatus === "NEEDS_CONFIRMATION" || expiryStatus === "NEEDS_CONFIRMATION") {
    status = "needs_confirmation";
    concept = "CONCEPT_C_UNKNOWN_VALIDITY";
  } else {
    status = "valid";
    concept = "CONCEPT_B_SCHEME_WINDOW";
  }

  // Actionable Alerts
  const alerts = [];
  if (expiryStatus === "EXPIRED") {
    alerts.push({
      type: "DANGER",
      category: "EXPIRY",
      title: "Document Explicitly Expired",
      message: expiryMessage,
      action: "Upload renewed certificate version.",
    });
  }
  if (acceptanceStatus === "OUTSIDE_WINDOW") {
    alerts.push({
      type: "WARNING",
      category: "ACCEPTANCE",
      title: "Outside Scheme Acceptance Window",
      message: acceptanceMessage,
      action: "Apply for a renewed income certificate and check portal requirements.",
    });
  }
  if (acceptanceStatus === "NEEDS_CONFIRMATION" || expiryStatus === "NEEDS_CONFIRMATION") {
    alerts.push({
      type: "INFO",
      category: "NEEDS_CONFIRMATION",
      title: "Needs official confirmation",
      message: "Dates or rules require student confirmation before final submission.",
      action: "Review extracted dates against original physical document.",
    });
  }

  // Official Rule Change Alert (distinguishing verified statutory amendments from general guidelines)
  if (rule?.isVerifiedAmendment && rule?.whatChanged) {
    alerts.push({
      type: "INFO",
      category: "RULE_CHANGE",
      title: `Verified Rule Amendment`,
      message: `Official Regulatory Update: ${rule.whatChanged}`,
      source: rule.officialSourceUrl,
      isOfficialChange: true,
      action: "Verify document issuance date conforms to the revised financial year window.",
    });
  } else if (rule && !rule.isVerifiedAmendment) {
    alerts.push({
      type: "INFO",
      category: "NEEDS_CONFIRMATION",
      title: "Needs official confirmation",
      message: `${rule.ruleDescription} Guideline requires confirmation with issuing authority and scheme portal.`,
      source: rule.officialSourceUrl,
      isOfficialChange: false,
      action: "Check portal or issuing authority requirements.",
    });
  }

  return {
    docType,
    schemeId,
    applicationYear,
    status,
    concept,
    issueDetected: status === "expired" || status === "outside_window",
    message: alerts[0]?.message || acceptanceMessage || expiryMessage,
    actionRequired: alerts[0]?.action || "Review document details.",
    ruleSourceUrl: rule?.officialSourceUrl || null,
    lastReviewedDate: rule?.lastReviewed || null,
    whatChanged: rule?.whatChanged || null,
    changeLog: rule?.changeLog || [],
    conceptA_expiry: {
      status: expiryStatus,
      message: expiryMessage,
      explicitExpiryDate: expiryDate || null,
    },
    conceptB_acceptance: {
      status: acceptanceStatus,
      message: acceptanceMessage,
      issueDate: issueDate || null,
    },
    conceptC_unknown: isUnknown,
    rule: rule
      ? {
          ruleId: rule.ruleId,
          ruleDescription: rule.ruleDescription,
          officialSourceUrl: rule.officialSourceUrl,
          effectiveDates: `${rule.effectiveFrom} to ${rule.effectiveTo}`,
          lastReviewed: rule.lastReviewed || null,
          isVerifiedAmendment: Boolean(rule.isVerifiedAmendment),
          isOfficialChange: Boolean(rule.isOfficialChange),
          whatChanged: rule.whatChanged || null,
          changeLog: rule.changeLog || [],
        }
      : null,
    alerts,
  };
}
