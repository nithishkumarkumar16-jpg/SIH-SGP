import {
  compareNames,
  compareDOB,
  compareIncome,
  compareCommunity,
  evaluateIncomeFreshness,
  buildCrossDocumentMatrix,
  levenshteinDistance,
} from "./verificationEngine";

describe("verificationEngine", () => {
  describe("Name Comparison", () => {
    test("identifies exact name matches", () => {
      const res = compareNames("SAMPLE STUDENT", "SAMPLE STUDENT", true);
      expect(res.status).toBe("EXACT_MATCH");
      expect(res.score).toBe(1.0);
    });

    test("identifies token-order variations (Surname first vs last)", () => {
      const res = compareNames("STUDENT SAMPLE", "SAMPLE STUDENT", true);
      expect(res.status).toBe("EXACT_MATCH");
    });

    test("strips honorifics and matches clean name", () => {
      const res = compareNames("Thiru SAMPLE STUDENT", "SAMPLE STUDENT", true);
      expect(res.status).toBe("EXACT_MATCH");
    });

    test("handles initial variations appropriately (lenient vs strict)", () => {
      const lenient = compareNames("DEMO CANDIDATE", "DEMO CANDIDATE K", false);
      expect(lenient.status).toBe("EXACT_MATCH");

      const strict = compareNames("DEMO CANDIDATE", "DEMO CANDIDATE K", true);
      expect(strict.status).toBe("LIKELY_MATCH");
    });

    test("detects minor typos / spelling variations", () => {
      const res = compareNames("DEMO CANDIDATE", "DEMO CANDDATE", false);
      expect(res.status === "LIKELY_MATCH" || res.status === "MINOR_DIFFERENCE").toBe(true);
    });

    test("flags clear name mismatches as MISMATCH", () => {
      const res = compareNames("SAMPLE STUDENT", "TEST APPLICANT", true);
      expect(res.status).toBe("MISMATCH");
    });

    test("handles missing names gracefully", () => {
      const res = compareNames("", "SAMPLE STUDENT", true);
      expect(res.status).toBe("MISSING");
    });
  });

  describe("Date of Birth Comparison", () => {
    test("matches dates across different formatting styles", () => {
      const res = compareDOB("15/08/2004", "15-08-2004");
      expect(res.status).toBe("MATCH");
    });

    test("flags different dates as MISMATCH", () => {
      const res = compareDOB("15/08/2004", "16/08/2004");
      expect(res.status).toBe("MISMATCH");
    });

    test("handles missing date gracefully", () => {
      const res = compareDOB("", "15/08/2004");
      expect(res.status).toBe("MISSING");
    });
  });

  describe("Income Cross-Check & Freshness", () => {
    test("matches identical income values without date", () => {
      const res = compareIncome("₹2,50,000", "250000");
      expect(res.status).toBe("MATCH");
      expect(res.numCert).toBe(250000);
      expect(res.numStudent).toBe(250000);
    });

    test("flags income amount mismatches", () => {
      const res = compareIncome("₹2,50,000", "300000");
      expect(res.status).toBe("MISMATCH");
    });

    test("older than 12 months with no expiry/rule returns unknown validity (needs confirmation), not expired", () => {
      const res = compareIncome("₹2,00,000", "200000", "01-01-2020");
      expect(res.freshness.status).toBe("needs_confirmation");
      expect(res.freshness.label).toBe("Validity needs confirmation");
      expect(res.freshness.isExpired).toBe(false);
    });

    test("confirmed printed past expiry date returns expired", () => {
      const res = compareIncome("₹2,00,000", "200000", "01-01-2024", "01-01-2025", {
        isExpiryConfirmed: true,
      });
      expect(res.freshness.status).toBe("expired");
      expect(res.freshness.label).toBe("Expired");
      expect(res.freshness.isExpired).toBe(true);
    });

    test("unconfirmed OCR expiry date returns needs confirmation (needs review)", () => {
      const res = compareIncome("₹2,00,000", "200000", "01-01-2024", "01-01-2025", {
        isExpiryConfirmed: false,
      });
      expect(res.freshness.status).toBe("needs_confirmation");
      expect(res.freshness.label).toBe("Please confirm the expiry date");
      expect(res.freshness.isUnconfirmedExpiry).toBe(true);
      expect(res.freshness.isExpired).toBe(false);
    });

    test("REGRESSION: OCR-extracted expiry with NO confirmation flag must be needs_confirmation (not expired)", () => {
      // This test guards against the regression where missing confirmation metadata
      // was treated as implicitly confirmed, causing "expired" for past OCR dates.
      // A missing flag must always mean "Needs confirmation", never "Expired".
      const res = compareIncome("₹2,00,000", "200000", "01-01-2024", "01-01-2020");
      // No confirmation flag passed at all — options object is absent
      expect(res.freshness.status).toBe("needs_confirmation");
      expect(res.freshness.label).toBe("Please confirm the expiry date");
      expect(res.freshness.isUnconfirmedExpiry).toBe(true);
      expect(res.freshness.isExpired).toBe(false);
    });

    test("REGRESSION: OCR-extracted expiry with empty options object must be needs_confirmation", () => {
      // Passing an empty options object (no isExpiryConfirmed key) must not default to confirmed.
      const res = compareIncome("₹2,00,000", "200000", "01-01-2024", "01-01-2020", {});
      expect(res.freshness.status).toBe("needs_confirmation");
      expect(res.freshness.label).toBe("Please confirm the expiry date");
      expect(res.freshness.isUnconfirmedExpiry).toBe(true);
      expect(res.freshness.isExpired).toBe(false);
    });

    test("confirmed future expiry within 30 days returns expiring soon", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 15);
      const dd = String(futureDate.getDate()).padStart(2, "0");
      const mm = String(futureDate.getMonth() + 1).padStart(2, "0");
      const yyyy = futureDate.getFullYear();
      const validUptoStr = `${dd}-${mm}-${yyyy}`;

      const res = compareIncome("₹2,00,000", "200000", "01-01-2024", validUptoStr, {
        isExpiryConfirmed: true,
      });
      expect(res.freshness.status).toBe("warning");
      expect(res.freshness.label).toBe("Expiring soon");
      expect(res.freshness.isExpiringSoon).toBe(true);
    });
  });

  describe("Community Cross-Check", () => {
    test("matches equivalent community categories", () => {
      const res = compareCommunity("Scheduled Caste (SC)", "SC");
      expect(res.status).toBe("MATCH");
    });

    test("flags community category mismatches", () => {
      const res = compareCommunity("SC", "BC");
      expect(res.status).toBe("MISMATCH");
    });
  });

  describe("Full Cross-Document Matrix & Consistency Score", () => {
    test("builds full matrix including Income Certificate name and computes consistency score", () => {
      const matrix = buildCrossDocumentMatrix({
        aadharName: "SAMPLE STUDENT",
        aadharDob: "15-08-2004",
        bankHolder: "SAMPLE STUDENT",
        bankAccType: "Single",
        tenthData: { name: "Sample Student", dob: "15-08-2004" },
        twelfthData: { name: "Sample Student", dob: null },
        communityData: { name: "Sample Student", dob: "15-08-2004", communityCategory: "SC" },
        incomeData: { name: "Sample Student", dob: null, incomeNumber: 200000 },
        studentIncome: "200000",
        studentCategory: "SC",
      });

      // Confirm income name was included in the comparison sources
      const hasIncomeName = matrix.nameSources.some(src => src.doc === "Income Certificate");
      expect(hasIncomeName).toBe(true);

      expect(matrix.hasNameMismatch).toBe(false);
      expect(matrix.hasDobMismatch).toBe(false);
      expect(matrix.nameConsistencyStatus).toBe("green");
      expect(matrix.consistencyPercentage).toBeGreaterThanOrEqual(90);
      expect(matrix.overallReadiness).toContain("High Consistency");
    });

    test("detects when a name mismatch exists in the matrix", () => {
      const matrix = buildCrossDocumentMatrix({
        aadharName: "SAMPLE STUDENT",
        aadharDob: "15-08-2004",
        bankHolder: "TEST APPLICANT",
        bankAccType: "Single",
        tenthData: { name: "Sample Student" },
        studentIncome: "200000",
      });

      expect(matrix.hasNameMismatch).toBe(true);
      expect(matrix.nameConsistencyStatus).toBe("red");
      expect(matrix.overallReadiness).toContain("Issues Found");
    });

    test("single-income-certificate workflow: does not report completed multi-doc checks, labels manually entered values as self-reported, and marks missing doc checks as Not checked — document missing", () => {
      const matrix = buildCrossDocumentMatrix({
        aadharName: "SAMPLE STUDENT",
        aadharDob: "15-08-2004",
        bankHolder: "SAMPLE STUDENT",
        bankAccType: "Single",
        incomeData: { name: "SAMPLE STUDENT", incomeNumber: 150000, issueDate: "01-01-2025" },
        studentIncome: "150000",
        studentCategory: "BC",
        hasIncomeDoc: true,
        hasAadhaarDoc: false,
        hasBankDoc: false,
        hasTenthDoc: false,
        hasTwelfthDoc: false,
        hasCommunityDoc: false,
      });

      // 1. Only 1 document uploaded
      expect(matrix.uploadedDocCount).toBe(1);
      expect(matrix.isMultiDocCheckCompleted).toBe(false);

      // 2. Identity / DOB / Bank / Community multi-doc checks are NOT reported as completed
      expect(matrix.nameConsistencyStatus).toBe("not_checked_missing");
      expect(matrix.nameConsistencyLabel).toBe("Not checked — document missing");
      expect(matrix.dobConsistencyLabel).toBe("Not checked — document missing");
      expect(matrix.bankConsistencyLabel).toBe("Not checked — document missing");
      expect(matrix.communityConsistencyLabel).toBe("Not checked — document missing");

      // 3. Overall readiness does not claim High Consistency
      expect(matrix.overallReadiness).toBe("Partial Documentation — Multi-Document Check Incomplete");
      expect(matrix.overallReadiness).not.toContain("High Consistency");

      // 4. Manually entered inputs are flagged as self-reported in name sources
      const aadhaarSource = matrix.nameSources.find(s => s.doc.includes("Aadhaar") || s.doc.includes("Applicant"));
      expect(aadhaarSource).toBeDefined();
      expect(aadhaarSource.isSelfReported).toBe(true);
      expect(aadhaarSource.isDocument).toBe(false);

      const bankSource = matrix.nameSources.find(s => s.doc.includes("Bank") || s.doc.includes("Account Holder"));
      expect(bankSource).toBeDefined();
      expect(bankSource.isSelfReported).toBe(true);
      expect(bankSource.isDocument).toBe(false);

      // Income certificate was the only actual document uploaded
      const incomeSource = matrix.nameSources.find(s => s.doc === "Income Certificate");
      expect(incomeSource).toBeDefined();
      expect(incomeSource.isDocument).toBe(true);
      expect(incomeSource.isSelfReported).toBe(false);

      // 5. Breakdown items requiring absent documents explicitly state Not checked — document missing
      const nameCheck = matrix.breakdown.find(b => b.item.includes("Name Consistency"));
      expect(nameCheck.status).toBe("NOT_CHECKED");
      expect(nameCheck.label).toBe("Not checked — document missing");

      const dobCheck = matrix.breakdown.find(b => b.item.includes("Date of Birth"));
      expect(dobCheck.status).toBe("NOT_CHECKED");
      expect(dobCheck.label).toBe("Not checked — document missing");

      const bankCheck = matrix.breakdown.find(b => b.item.includes("Bank Account"));
      expect(bankCheck.status).toBe("NOT_CHECKED");
      expect(bankCheck.label).toBe("Not checked — document missing");

      const commCheck = matrix.breakdown.find(b => b.item.includes("Community Category"));
      expect(commCheck.status).toBe("NOT_CHECKED");
      expect(commCheck.label).toBe("Not checked — document missing");

      // The uploaded income certificate check evaluates normally
      const incCheck = matrix.breakdown.find(b => b.item.includes("Income Verification"));
      expect(incCheck.status).not.toBe("NOT_CHECKED");
    });
  });
});
