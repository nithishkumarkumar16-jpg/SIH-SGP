jest.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: jest.fn(),
}));

if (!window.URL.revokeObjectURL) {
  window.URL.revokeObjectURL = jest.fn();
}
if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = jest.fn();
}

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import DocumentUpload, {
  REQUIREMENT_CONFIG,
  getRequiredFieldDefs,
} from "./DocumentUpload";
import {
  buildCrossDocumentMatrix,
  evaluateCrossDocumentCase,
  evaluateIncomeFreshness,
} from "../../utils/verificationEngine";
import { calculatePreparationAudit } from "../../utils/preparationScore";
import { evaluateDocumentValidity } from "../../utils/validityRules";

describe("Simplified Document Verification Workflow Specification", () => {
  // Scenario 1: Matching student names
  test("Scenario 1: Matching student names yields Consistent status and clean identity comparison", () => {
    const matrix = buildCrossDocumentMatrix({
      aadharName: "ANANYA KRISHNAN",
      bankHolder: "ANANYA KRISHNAN",
      tenthData: { name: "ANANYA KRISHNAN", fatherName: "KRISHNAN S" },
      twelfthData: { name: "ANANYA KRISHNAN", fatherName: "KRISHNAN S" },
      communityData: { name: "ANANYA KRISHNAN", fatherName: "KRISHNAN S" },
    });

    expect(matrix.hasNameMismatch).toBe(false);
    expect(matrix.nameConsistencyStatus).toBe("green");
    expect(matrix.unresolvedIssues.length).toBe(0);
    // Student names compared across student documents
    expect(matrix.namePairs.every(p => p.status === "EXACT_MATCH")).toBe(true);
  });

  // Scenario 2: Different student names across marksheets
  test("Scenario 2: Different student names across marksheets displays required student guidance", () => {
    const matrix = buildCrossDocumentMatrix({
      aadharName: "PRIYA RAVICHANDRAN",
      tenthData: { name: "PRIYA RAVICHANDRAN", fatherName: "RAVICHANDRAN K" },
      twelfthData: { name: "KAVITHA SUNDARAM", fatherName: "SUNDARAM M" },
    });

    expect(matrix.hasNameMismatch).toBe(true);
    expect(matrix.nameConsistencyStatus).toBe("red");

    const marksheetPair = matrix.namePairs.find(
      p => (p.a.isMarksheet || p.b.isMarksheet) && p.status === "MISMATCH"
    );
    expect(marksheetPair).toBeDefined();
    expect(marksheetPair.explanation).toBe(
      "This document shows a different student name. Check the original document and confirm whether this is a reading error or the wrong upload."
    );
    expect(marksheetPair.neutralGuidance).toBe(
      "This document shows a different student name. Check the original document and confirm whether this is a reading error or the wrong upload."
    );

    // Unresolved issue list contains exact message
    const unresolved = matrix.unresolvedIssues.find(u => u.field === "Student Name");
    expect(unresolved.message).toContain(
      "This document shows a different student name. Check the original document and confirm whether this is a reading error or the wrong upload."
    );
  });

  // Scenario 3: Parent-held income certificate with confirmed relationship
  test("Scenario 3: Parent-held income certificate with confirmed relationship", () => {
    const matrix = buildCrossDocumentMatrix({
      aadharName: "KARTHIK MOHAN",
      tenthData: { name: "KARTHIK MOHAN", fatherName: "MOHAN RAJ" },
      communityData: { name: "KARTHIK MOHAN", fatherName: "MOHAN RAJ" },
      incomeData: { name: "MOHAN RAJ", income: 180000 },
      holderRelationship: "Parent",
    });

    // Parent name should NOT cause a student-name mismatch
    expect(matrix.hasNameMismatch).toBe(false);
    expect(matrix.parentRelationshipCheck).toBeDefined();
    expect(matrix.parentRelationshipCheck.relationship).toBe("Parent");
    expect(matrix.parentRelationshipCheck.holderName).toBe("MOHAN RAJ");
    expect(matrix.parentRelationshipCheck.confirmedParentName).toBe("MOHAN RAJ");
    expect(matrix.parentRelationshipCheck.standardStatus).toBe("Consistent");
    expect(matrix.parentRelationshipCheck.note).toBe(
      "A confirmed relationship does not automatically prove the certificate meets a scheme's rules."
    );
  });

  // Scenario 4: Unknown holder relationship
  test("Scenario 4: Unknown holder relationship requires confirmation without false mismatch", () => {
    const matrix = buildCrossDocumentMatrix({
      aadharName: "MEERA VENKAT",
      tenthData: { name: "MEERA VENKAT" },
      incomeData: { name: "VENKATARAMAN S", income: 120000 },
      holderRelationship: "Unknown",
    });

    // Does NOT compare parent name directly with student name
    expect(matrix.hasNameMismatch).toBe(false);
    expect(matrix.parentRelationshipCheck).toBeDefined();
    expect(matrix.parentRelationshipCheck.relationship).toBe("Unknown");
    expect(matrix.parentRelationshipCheck.standardStatus).toBe("Needs confirmation");
    expect(matrix.parentRelationshipCheck.explanation).toContain(
      "Please confirm certificate holder relationship to student (Self / Parent / Guardian / Other). Do not infer solely from similar name."
    );
  });

  // Scenario 5: Generational isolation (student father vs income holder father)
  test("Scenario 5: Generational isolation prevents comparing income holder's father with student father", () => {
    const documents = {
      tenth: { docType: "ms10", name: "DEEPAK SURESH", fatherName: "SURESH G" },
      income: { docType: "income", name: "SURESH G", fatherName: "GOPALAN K" },
    };

    const evaluated = evaluateCrossDocumentCase(documents);
    // There should be no parentNameDifferences flagged between Suresh G and Gopalan K
    expect(evaluated.parentNameDifferences || []).toHaveLength(0);
  });

  // Scenario 6: Missing or unreadable name remains unresolved
  test("Scenario 6: Missing or unreadable required name remains unresolved", () => {
    const matrix = buildCrossDocumentMatrix({
      aadharName: "SNEHA VIJAY",
      tenthData: { name: null }, // Unreadable name on 10th marksheet
    });

    const unreadableIssue = matrix.unresolvedIssues.find(
      u => u.doc === "10th Marksheet" && u.field === "Student Name"
    );
    expect(unreadableIssue).toBeDefined();
    expect(unreadableIssue.message).toContain("Could not read required student name on 10th Marksheet.");
  });

  // Scenario 7: No scheme selected
  test("Scenario 7: No scheme selected labels requirements pending and hides preparation score", () => {
    const audit = calculatePreparationAudit({
      schemeId: "",
      ds: {
        ms10: { data: { extracted: { name: "RAMESH S" } } },
      },
    });

    expect(audit.scoreAvailable).toBe(false);
    expect(audit.score).toBeNull();
    expect(audit.scoreLabel).toBe("Preparation score unavailable");
    expect(audit.scoreText).toBe("Preparation score unavailable (pending scheme selection)");
    expect(audit.summary).toContain("Select a scholarship scheme to determine required preparation checks.");
  });

  // Scenario 8: Scheme requiring marks and income dynamically expands required fields
  test("Scenario 8: Scheme requiring marks and income dynamically expands field list", () => {
    const schemeRequiringMarks = {
      id: "central_sector",
      name: "Central Sector Scheme",
      requiresMarks: true,
      maxIncome: 450000,
      minPercentage: 80,
    };

    const defaultTenthFields = getRequiredFieldDefs("ms10", null);
    expect(defaultTenthFields.map(f => f.id)).toEqual(["name"]);

    const schemeTenthFields = getRequiredFieldDefs("ms10", schemeRequiringMarks);
    expect(schemeTenthFields.some(f => f.id === "marksScored")).toBe(true);
    expect(schemeTenthFields.some(f => f.id === "percentage")).toBe(true);

    const schemeIncomeFields = getRequiredFieldDefs("income", schemeRequiringMarks);
    expect(schemeIncomeFields.some(f => f.id === "income")).toBe(true);
  });

  // Scenario 9: Expiry explicitly printed versus validity inferred from unknown rule
  test("Scenario 9: Expiry explicitly printed requires confirmation, no universal financial year rule", () => {
    // Evaluation without universal financial year mandate
    const freshness = evaluateIncomeFreshness("2023-01-10", "2026-01-09");
    expect(freshness.detail).not.toContain("Must be within current financial year");

    // Validity with unverified scheme rule
    const validity = evaluateDocumentValidity({
      docType: "income",
      issueDate: "2024-05-10",
      schemeId: "general_scheme",
      applicationYear: "2025-26",
    });

    expect(validity.conceptB_acceptance.message).toContain(
      "Document acceptance needs confirmation for the selected scheme."
    );
  });

  // Scenario 10: Simplified UI renders minimal default fields and removes clutter
  test("Scenario 10: Document cards render minimal default fields, clean status badges, and compact tools", () => {
    const mockDs = {
      ms10: {
        file: { name: "10th_sample.jpg" },
        loading: false,
        open: true,
        data: {
          extracted: {
            name: "LAKSHMI NARAYANAN",
            school: "MODEL SCHOOL",
            registerNumber: "998877",
            marksScored: "470",
          },
        },
      },
      income: {
        file: { name: "income_sample.jpg" },
        loading: false,
        open: true,
        holderRelationship: "Unknown",
        data: {
          extracted: {
            name: "NARAYANAN K",
            income: "₹1,20,000",
            taluk: "Coimbatore North",
            certNumber: "IN-2024-1122",
          },
        },
      },
    };

    const { container } = render(
      <BrowserRouter>
        <DocumentUpload initialDs={mockDs} initialStep={1} />
      </BrowserRouter>
    );

    // 1. Minimal default fields rendered
    expect(screen.getByText("LAKSHMI NARAYANAN")).toBeTruthy();
    expect(screen.getByText("NARAYANAN K")).toBeTruthy();

    // 2. Unnecessary fields removed from default display
    expect(screen.queryByText("MODEL SCHOOL")).toBeNull();
    expect(screen.queryByText("998877")).toBeNull();
    expect(screen.queryByText("Coimbatore North")).toBeNull();
    expect(screen.queryByText("IN-2024-1122")).toBeNull();

    // 3. Clean status badges
    expect(screen.getAllByText("Please review").length).toBeGreaterThanOrEqual(1);

    // 4. Compact Tools menu present
    const toolsTriggers = container.querySelectorAll(".doc-tools-trigger");
    expect(toolsTriggers.length).toBe(2);

    // 5. Developer-facing "Field Match" percentages removed
    expect(container.textContent.includes("% match")).toBe(false);
  });

  // Scenario 9: Confirmed printed past expiry displays prominent warning and card alert
  test("Scenario 9: Expired Income Certificate displays prominent warning banner, expired pill, and field badge", () => {
    const mockExpiredIncomeDs = {
      income: {
        file: { name: "TN-4202405069993_in-certificate.pdf" },
        loading: false,
        open: true,
        holderRelationship: "Parent",
        confirmedFields: { validUpto: true },
        data: {
          extracted: {
            name: "Murugesan",
            income: "84000",
            issueDate: "11-05-2024",
            validUpto: "10-05-2025", // In the past relative to 2026
          },
        },
      },
    };

    const { container } = render(
      <BrowserRouter>
        <DocumentUpload initialDs={mockExpiredIncomeDs} initialStep={1} />
      </BrowserRouter>
    );

    // 1. Prominent warning banner displayed
    expect(screen.getByText("Income Certificate Has Expired")).toBeTruthy();
    expect(screen.getByText(/Action needed: Please upload a renewed certificate/i)).toBeTruthy();
    expect(screen.getByText("+ Upload Renewed Certificate")).toBeTruthy();

    // 2. Both Card status pill and Field badge show ⚠️ Expired
    expect(screen.getAllByText("⚠️ Expired").length).toBe(2);

    // 3. Card element has card-expired CSS class
    const expiredCard = container.querySelector(".document-card.card-expired");
    expect(expiredCard).toBeTruthy();

    // 4. Date field shows (Expired) marker and Expired badge
    expect(screen.getByText(/\(Expired\)/i)).toBeTruthy();

    // 5. Relationship dropdown options are clear and untruncated
    const select = screen.getByLabelText(/Confirm holder relationship to student/i);
    expect(select).toBeTruthy();
    expect(select.querySelector('option[value="Parent"]').textContent).toBe("Parent (Father / Mother)");
  });

  // Scenario 10: Unconfirmed OCR expiry date displays Please confirm the expiry date
  test("Scenario 10: Unconfirmed OCR expiry date requires student review and does not falsely mark expired", () => {
    const mockUnconfirmedDs = {
      income: {
        file: { name: "income_ocr.pdf" },
        loading: false,
        open: true,
        holderRelationship: "Parent",
        data: {
          extracted: {
            name: "Murugesan",
            income: "84000",
            issueDate: "11-05-2024",
            validUpto: "10-05-2025", // Extracted by OCR but unconfirmed
          },
        },
      },
    };

    const { container } = render(
      <BrowserRouter>
        <DocumentUpload initialDs={mockUnconfirmedDs} initialStep={1} />
      </BrowserRouter>
    );

    expect(screen.getByText("Please confirm the expiry date")).toBeTruthy();
    expect(screen.queryByText("Income Certificate Has Expired")).toBeNull();
    const expiredCard = container.querySelector(".document-card.card-expired");
    expect(expiredCard).toBeNull();
  });

  // Scenario 11: Older than 12 months with no expiry date has unknown validity, not expired
  test("Scenario 11: Document older than 12 months without printed expiry has unknown validity, not expired", () => {
    const mockOlderDs = {
      income: {
        file: { name: "income_old.pdf" },
        loading: false,
        open: true,
        holderRelationship: "Parent",
        data: {
          extracted: {
            name: "Murugesan",
            income: "84000",
            issueDate: "01-01-2020",
          },
        },
      },
    };

    const { container } = render(
      <BrowserRouter>
        <DocumentUpload initialDs={mockOlderDs} initialStep={1} />
      </BrowserRouter>
    );

    expect(screen.queryByText("Income Certificate Has Expired")).toBeNull();
    const expiredCard = container.querySelector(".document-card.card-expired");
    expect(expiredCard).toBeNull();
  });

  // Scenario 12: Confirmed future expiry within 30 days displays Expiring soon
  test("Scenario 12: Confirmed future expiry within 30 days displays Certificate Expiring Soon", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const dd = String(futureDate.getDate()).padStart(2, "0");
    const mm = String(futureDate.getMonth() + 1).padStart(2, "0");
    const yyyy = futureDate.getFullYear();
    const validUptoStr = `${dd}-${mm}-${yyyy}`;

    const mockExpiringSoonDs = {
      income: {
        file: { name: "income_soon.pdf" },
        loading: false,
        open: true,
        holderRelationship: "Parent",
        confirmedFields: { validUpto: true },
        data: {
          extracted: {
            name: "Murugesan",
            income: "84000",
            issueDate: "11-05-2024",
            validUpto: validUptoStr,
          },
        },
      },
    };

    render(
      <BrowserRouter>
        <DocumentUpload initialDs={mockExpiringSoonDs} initialStep={1} />
      </BrowserRouter>
    );

    expect(screen.getByText("Certificate Expiring Soon")).toBeTruthy();
    expect(screen.getByText("⏳ Expiring soon")).toBeTruthy();
  });

  // Scenario 13: VerificationEngine reports expired income certificate in unresolved issues
  test("Scenario 13: VerificationEngine reports expired income certificate in unresolved issues when confirmed", () => {
    const matrix = buildCrossDocumentMatrix({
      aadharName: "KAVITHA MURUGESAN",
      incomeApplicant: "parent",
      holderRelationship: "Parent",
      incomeData: {
        name: "MURUGESAN",
        income: "84000",
        issueDate: "11-05-2024",
        validUpto: "10-05-2025",
        isExpiryConfirmed: true,
      },
    });

    const expiredIssue = matrix.unresolvedIssues.find(i => i.field === "Expiry Date");
    expect(expiredIssue).toBeDefined();
    expect(expiredIssue.doc).toBe("Income Certificate");
    expect(expiredIssue.message).toMatch(/expired|renewed/i);
  });
});

