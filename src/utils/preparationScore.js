/**
 * preparationScore.js — SGP Application Preparation Score Calculator
 * 
 * Computes preparation progress according to strict guidelines:
 * - Title: "Application Preparation"
 * - Does not use "Scholarship Confidence Index" or display probability of receiving a scholarship.
 * - Preparation score = (completed applicable required checks / total applicable required checks) * 100
 * - Explicitly defines checks to avoid double-counting.
 * - Excludes only genuinely not-applicable checks.
 * - Missing information and unresolved mandatory checks remain incomplete.
 * - If there is not enough scheme information, returns score: null ("Preparation score unavailable").
 * - Critical unresolved issues remain visible even when the score is high.
 * - Disclaimer: "This shows preparation progress, not scholarship eligibility confirmation or selection probability."
 */

import { scholarships as scholarshipSchemes } from "../knowledge/scholarships";

export const PREPARATION_DISCLAIMER =
  "This shows preparation progress, not scholarship eligibility confirmation or selection probability.";

/**
 * Calculates preparation checks and score for a selected scheme and current session data.
 * 
 * @param {Object} params
 * @param {Object} params.scheme Scheme object from scholarshipSchemes
 * @param {string} [params.applicationYear] e.g. "2025-26"
 * @param {Object} params.ds Documents state map
 * @param {Object} [params.identityDetails] { aadharName, aadharDob, bankHolder, bankAccType, studentIncome, studentCategory }
 * @param {Object} [params.matrixData] Cross-document matrix
 * @param {Object} [params.confirmedFields] Map of confirmed field states
 * @param {Object} [params.validityData] Document validity evaluation
 * @returns {Object} Comprehensive preparation audit
 */
export function calculatePreparationAudit({
  scheme: schemeArg,
  schemeId: schemeIdArg,
  applicationYear = "2025-26",
  ds: dsArg = {},
  docs: docsArg = {},
  identityDetails = {},
  matrixData = null,
  confirmedFields = {},
  validityData = {},
}) {
  let scheme = schemeArg;
  if (!scheme && schemeIdArg) {
    const sId = String(schemeIdArg).toLowerCase();
    scheme = scholarshipSchemes.find(
      (s) => s.id?.toLowerCase() === sId || s.shortName?.toLowerCase() === sId
    ) || { id: schemeIdArg, name: schemeIdArg, communities: ["SC", "ST", "OBC"], maxIncome: 250000 };
  }

  if (!scheme || !scheme.id || scheme.id === "none" || scheme.id === "") {
    return {
      title: "Application Preparation",
      schemeName: "Scheme not selected",
      applicationYear,
      score: null,
      scoreText: "Preparation score unavailable (pending scheme selection)",
      scoreAvailable: false,
      scoreLabel: "Preparation score unavailable",
      summary: "Select a scholarship scheme to determine required preparation checks.",
      summaryText: "Select a scholarship scheme to determine required preparation checks.",
      disclaimer: PREPARATION_DISCLAIMER,
      completedChecks: 0,
      totalApplicableChecks: 0,
      totalChecks: 0,
      checks: [],
      criticalIssues: [],
      nextActions: ["Select a target scholarship scheme from the catalogue."],
      ruleSource: null,
      lastReviewed: null,
    };
  }

  // Merge docsArg and dsArg
  const ds = { ...docsArg, ...dsArg };

  const {
    aadharName = "",
    aadharDob = "",
    bankHolder = "",
    bankAccType = "",
    studentIncome: _studentIncome = "", // eslint-disable-line no-unused-vars
    studentCategory = "",
  } = identityDetails;

  const checks = [];
  const criticalIssues = [];
  const nextActions = [];

  // Determine applicability based on genuine scheme requirements
  const isCommunityRequired = scheme.communities && !scheme.communities.includes("GEN") && !scheme.communities.includes("All");
  const isIncomeRequired = typeof scheme.maxIncome === "number" && scheme.maxIncome < 999999999;
  const isMarksheetRequired = true; // All post-matric scholarships require marksheet proof
  const isAadhaarRequired = true;
  const isBankRequired = true;

  // 1. Marksheet Upload Check
  // 1. Marksheet Upload Check
  const hasMarksheet = Boolean(ds.ms10?.file || ds.ms12?.file || ds.marksheet?.file);
  const marksheetExtracted = Boolean(
    ds.ms10?.data?.extracted || ds.ms12?.data?.extracted || ds.marksheet?.data?.extracted ||
    ds.ms10?.extractedData || ds.ms12?.extractedData || ds.marksheet?.extractedData ||
    ds.ms10?.isConfirmedByUser || ds.ms12?.isConfirmedByUser || ds.marksheet?.isConfirmedByUser
  );
  checks.push({
    id: "check-marksheet-doc",
    label: "Marksheet Upload & Extraction",
    description: "10th or 12th board marksheet uploaded and read",
    isApplicable: isMarksheetRequired,
    isCompleted: hasMarksheet && marksheetExtracted,
    status: (hasMarksheet && marksheetExtracted) ? "COMPLETED" : hasMarksheet ? "PENDING_OCR" : "MISSING",
    category: "DOCUMENT",
  });
  if (!hasMarksheet) {
    criticalIssues.push({
      id: "issue-missing-marksheet",
      title: "Missing Required Marksheet",
      description: "Qualifying marksheet (10th/12th) has not yet been uploaded.",
      action: "Upload your qualifying marksheet.",
    });
    nextActions.push("Upload your qualifying marksheet (10th / 12th).");
  }

  // 2. Income Certificate Upload Check
  const hasIncomeDoc = Boolean(ds.income?.file);
  const incomeExtracted = Boolean(ds.income?.data?.extracted || ds.income?.extractedData || ds.income?.isConfirmedByUser);
  if (isIncomeRequired) {
    checks.push({
      id: "check-income-doc",
      label: "Income Certificate Upload & Extraction",
      description: `Income certificate uploaded for ceiling limit (≤ ₹${scheme.maxIncome?.toLocaleString("en-IN")})`,
      isApplicable: true,
      isCompleted: hasIncomeDoc && incomeExtracted,
      status: (hasIncomeDoc && incomeExtracted) ? "COMPLETED" : hasIncomeDoc ? "PENDING_OCR" : "MISSING",
      category: "DOCUMENT",
    });
    if (!hasIncomeDoc) {
      criticalIssues.push({
        id: "issue-missing-income",
        title: "Missing Income Certificate",
        description: "Income certificate has not yet been uploaded.",
        action: "Upload your annual family income certificate.",
      });
      nextActions.push("Upload your annual family income certificate.");
    }
  } else {
    checks.push({
      id: "check-income-doc",
      label: "Income Certificate",
      description: "Scheme has no income ceiling requirement",
      isApplicable: false,
      isCompleted: false,
      status: "NOT_APPLICABLE",
      category: "DOCUMENT",
    });
  }

  // 3. Community Certificate Upload Check
  const hasCommunityDoc = Boolean(ds.community?.file);
  const communityExtracted = Boolean(ds.community?.data?.extracted || ds.community?.extractedData || ds.community?.isConfirmedByUser);
  if (isCommunityRequired) {
    checks.push({
      id: "check-community-doc",
      label: "Community Certificate Upload & Extraction",
      description: `Community certificate uploaded for scheme category (${scheme.category || scheme.communities?.join(", ")})`,
      isApplicable: true,
      isCompleted: hasCommunityDoc && communityExtracted,
      status: (hasCommunityDoc && communityExtracted) ? "COMPLETED" : hasCommunityDoc ? "PENDING_OCR" : "MISSING",
      category: "DOCUMENT",
    });
    if (!hasCommunityDoc) {
      nextActions.push("Upload your community / caste certificate.");
    }
  } else {
    checks.push({
      id: "check-community-doc",
      label: "Community Certificate",
      description: "Scheme open to all categories — certificate not required",
      isApplicable: false,
      isCompleted: false,
      status: "NOT_APPLICABLE",
      category: "DOCUMENT",
    });
  }

  // 4. Aadhaar Reference Check
  const hasAadhaar = Boolean(
    (aadharName.trim() && aadharDob.trim()) ||
    ds.aadhaar?.file || ds.aadhar?.file ||
    ds.aadhaar?.extractedData || ds.aadhar?.extractedData
  );
  checks.push({
    id: "check-aadhaar-ref",
    label: "Aadhaar Identity Details",
    description: "Applicant full name and DOB verified against Aadhaar card",
    isApplicable: isAadhaarRequired,
    isCompleted: hasAadhaar,
    status: hasAadhaar ? "COMPLETED" : "MISSING",
    category: "IDENTITY",
  });
  if (!hasAadhaar) {
    nextActions.push("Enter your Aadhaar reference details (Full Name & DOB).");
  }

  // 5. Bank Account Type Check
  const hasSingleBank = bankAccType === "Single" && Boolean(bankHolder.trim());
  const isJointBank = bankAccType === "Joint";
  checks.push({
    id: "check-bank-account",
    label: "Single Savings Bank Account",
    description: "Active individual Single Savings Account confirmed (NSP / DBT mandate)",
    isApplicable: isBankRequired,
    isCompleted: hasSingleBank,
    status: hasSingleBank ? "COMPLETED" : isJointBank ? "MISMATCH" : "MISSING",
    category: "BANKING",
  });
  if (isJointBank) {
    criticalIssues.push({
      id: "issue-joint-account",
      title: "Joint Bank Account Ineligible",
      description: "NSP and DBT scholarship guidelines mandate an individual Single Account in the student's name. Joint accounts lead to payment rejection.",
      action: "Provide an individual single savings bank account.",
    });
    nextActions.push("Open or provide an individual Single Savings Bank account.");
  } else if (!bankHolder.trim() || !bankAccType) {
    nextActions.push("Enter your Bank Account details and confirm Single Account type.");
  }

  // 6. Name Confirmation & Consistency Check
  const hasNameMismatch = Boolean(matrixData?.hasNameMismatch);
  const hasNameConfirmed = Boolean(confirmedFields.name || (matrixData?.nameConsistencyStatus === "green" && hasAadhaar));
  checks.push({
    id: "check-name-consistency",
    label: "Applicant Name Consistency",
    description: "Applicant name consistent across documents without unresolved mismatch",
    isApplicable: true,
    isCompleted: hasNameConfirmed && !hasNameMismatch,
    status: hasNameMismatch ? "MISMATCH" : hasNameConfirmed ? "COMPLETED" : "NEEDS_CONFIRMATION",
    category: "CONSISTENCY",
  });
  if (hasNameMismatch) {
    criticalIssues.push({
      id: "issue-name-mismatch",
      title: "Name Mismatch Detected",
      description: "Applicant names differ across uploaded documents or Aadhaar reference. Compare the highlighted text with your original documents.",
      action: "Confirm whether this is an OCR reading error or a document-detail issue.",
    });
    nextActions.push("Resolve name inconsistency across documents.");
  }

  // 7. Date of Birth Consistency Check
  const hasDobMismatch = Boolean(matrixData?.hasDobMismatch);
  const hasDobConfirmed = Boolean(confirmedFields.dob || (matrixData?.dobConsistencyStatus === "green" && hasAadhaar));
  checks.push({
    id: "check-dob-consistency",
    label: "Date of Birth Consistency",
    description: "Date of birth matches across Aadhaar and marksheet/certificates",
    isApplicable: true,
    isCompleted: hasDobConfirmed && !hasDobMismatch,
    status: hasDobMismatch ? "MISMATCH" : hasDobConfirmed ? "COMPLETED" : "NEEDS_CONFIRMATION",
    category: "CONSISTENCY",
  });
  if (hasDobMismatch) {
    criticalIssues.push({
      id: "issue-dob-mismatch",
      title: "Date of Birth Mismatch Detected",
      description: "DOB differs between Aadhaar reference and uploaded certificates.",
      action: "Review original certificates and correct any OCR reading error.",
    });
    nextActions.push("Review date of birth discrepancy.");
  }

  // 8. Document Validity / Expiry Check
  const isIncomeExpired = validityData.income?.conceptA_expiry?.status === "EXPIRED" || matrixData?.incomeResult?.status === "EXPIRED";
  const isIncomeOutsideWindow = validityData.income?.conceptB_acceptance?.status === "OUTSIDE_WINDOW";
  const isIncomeNeedsConfirmation =
    validityData.income?.status === "needs_confirmation" ||
    validityData.income?.concept === "CONCEPT_C_UNKNOWN_VALIDITY" ||
    validityData.income?.conceptB_acceptance?.status === "NEEDS_CONFIRMATION" ||
    validityData.income?.conceptA_expiry?.status === "NEEDS_CONFIRMATION";

  const hasValidityPassed = !isIncomeExpired && !isIncomeOutsideWindow && !isIncomeNeedsConfirmation && Boolean(validityData.income);
  const validityStatus = isIncomeExpired
    ? "EXPIRED"
    : isIncomeOutsideWindow
    ? "OUTSIDE_WINDOW"
    : isIncomeNeedsConfirmation
    ? "NEEDS_CONFIRMATION"
    : (hasValidityPassed && hasIncomeDoc)
    ? "COMPLETED"
    : "PENDING";

  checks.push({
    id: "check-document-validity",
    label: "Document Validity & Acceptance Window",
    description: "Certificates are within validity period and scheme acceptance window",
    isApplicable: isIncomeRequired,
    isCompleted: hasValidityPassed && hasIncomeDoc,
    status: validityStatus,
    category: "VALIDITY",
  });
  if (isIncomeExpired) {
    criticalIssues.push({
      id: "issue-income-expired",
      title: "Income Certificate Confirmed Expired",
      description: "Income certificate has expired or is outside the valid renewal window.",
      action: "Upload renewed income certificate.",
    });
    nextActions.push("Obtain and upload a renewed Income Certificate.");
  } else if (isIncomeOutsideWindow) {
    criticalIssues.push({
      id: "issue-income-window",
      title: "Income Certificate Acceptance Window",
      description: "Document acceptance needs confirmation for the selected scheme.",
      action: "Check portal requirements or apply for a fresh certificate.",
    });
  } else if (isIncomeNeedsConfirmation && hasIncomeDoc) {
    nextActions.push("Confirm certificate validity and acceptance window against official portal requirements.");
  }

  // 9. Community / Category Match Check (if applicable)
  if (isCommunityRequired) {
    const isCategoryMismatch = matrixData?.communityResult?.status === "MISMATCH";
    const isCategoryMatched = matrixData?.communityResult?.status === "MATCH" || confirmedFields.community;
    checks.push({
      id: "check-community-consistency",
      label: "Community Category Consistency",
      description: `Certificate category matches student selection (${studentCategory || "—"})`,
      isApplicable: true,
      isCompleted: Boolean(isCategoryMatched && !isCategoryMismatch),
      status: isCategoryMismatch ? "MISMATCH" : isCategoryMatched ? "COMPLETED" : "NEEDS_CONFIRMATION",
      category: "CONSISTENCY",
    });
    if (isCategoryMismatch) {
      criticalIssues.push({
        id: "issue-community-mismatch",
        title: "Category Mismatch",
        description: `Certificate category does not match selected category (${studentCategory}).`,
        action: "Confirm correct community category as per official certificate.",
      });
      nextActions.push("Confirm category as per community certificate.");
    }
  }

  // 10. Student Field Confirmation Status Check (Minimal required fields)
  const requiredFieldKeys = ["name"];
  if (isIncomeRequired) requiredFieldKeys.push("income");
  if (isCommunityRequired) requiredFieldKeys.push("community");
  const allKeyFieldsConfirmed = requiredFieldKeys.every(k => Boolean(confirmedFields[k]));
  checks.push({
    id: "check-field-confirmation",
    label: "Student Field Review & Confirmation",
    description: "Extracted fields reviewed and confirmed or corrected by student",
    isApplicable: true,
    isCompleted: allKeyFieldsConfirmed,
    status: allKeyFieldsConfirmed ? "COMPLETED" : "NEEDS_CONFIRMATION",
    category: "REVIEW",
  });
  if (!allKeyFieldsConfirmed) {
    nextActions.push("Review and confirm all extracted field values.");
  }

  // Score Calculation
  const applicableChecks = checks.filter(c => c.isApplicable);
  const completedChecks = applicableChecks.filter(c => c.isCompleted);
  const totalCount = applicableChecks.length;
  const completedCount = completedChecks.length;

  const score = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : null;
  const scoreText = score !== null ? `${score}%` : "Preparation score unavailable";
  const summary = `${completedCount} of ${totalCount} required checks completed.`;

  return {
    title: "Application Preparation",
    schemeId: scheme.id,
    schemeName: scheme.name,
    shortName: scheme.shortName || scheme.name,
    applicationYear,
    portal: scheme.portal || "NSP",
    score,
    scoreText,
    scoreAvailable: score !== null,
    scoreLabel: score !== null ? `${score}%` : "Preparation score unavailable",
    summary,
    summaryText: summary,
    completedChecks: completedCount,
    totalApplicableChecks: totalCount,
    totalChecks: totalCount,
    disclaimer: PREPARATION_DISCLAIMER,
    checks,
    criticalIssues,
    nextActions: Array.from(new Set(nextActions)),
    ruleSource: scheme.sourceUrl || scheme.officialUrl || "https://scholarships.gov.in",
    lastReviewed: scheme.lastReviewed || "2025-10-15",
    effectiveFrom: scheme.effectiveFrom || "2025-26",
    ruleChanges: validityData?.alerts?.filter(a => a.category === "RULE_CHANGE") || [],
    whatChanged: validityData?.whatChanged || null,
    liveAlertsIntegrationStatus: validityData?.liveAlertsIntegrationStatus || "Pending authorized integration with National Scholarship Portal (NSP) webhooks",
  };
}
