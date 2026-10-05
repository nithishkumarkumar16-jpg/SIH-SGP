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
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import DocumentUpload from "./DocumentUpload";
import { shouldUseMockCaptcha } from "./captchaConfig";

describe("shouldUseMockCaptcha", () => {
  test("falls back to a local mock when no Enterprise key is configured in development", () => {
    expect(shouldUseMockCaptcha("", "development")).toBe(true);
  });

  test("keeps the real Google Enterprise flow enabled in production", () => {
    expect(shouldUseMockCaptcha("real-key", "production")).toBe(false);
  });
});

describe("Standardized Extracted Details & Multi-State Audit UI", () => {
  const mockInitialDs = {
    ms10: {
      file: { name: "10th_marksheet.jpg" },
      url: "blob:mock-10th",
      loading: false,
      err: null,
      open: true,
      data: {
        detectedType: "ms10",
        state: "Tamil Nadu",
        issuingAuthority: "Tamil Nadu State Board",
        quality: { qualityLevel: "FAIR", qualityDescription: "Good contrast, moderate resolution." },
        ocrConfidence: 91,
        fieldConfidence: 92,
        fieldConfidences: {
          name: 0.98,
          board: 0.90,
          school: 0.92,
          year: 0.90,
          marks: 0.90,
        },
        warnings: [],
        issues: [],
        extracted: {
          name: "Nithishkumar M",
          fatherName: "Murugan P",
          dob: "2006-05-12",
          board: "Tamil Nadu State Board",
          school: ". Yr oa scull aSauaTEnan LEW CRM Lm aegmghm Coan",
          registerNumber: "1029384",
          year: "2021",
          month: "March",
          marksScored: "465",
          maxMarks: "500",
          percentage: "93%",
          grade: "Distinction",
        },
      },
    },
    ms12: {
      file: { name: "12th_marksheet.jpg" },
      url: "blob:mock-12th",
      loading: false,
      err: null,
      open: true,
      data: {
        detectedType: "ms12",
        state: "Tamil Nadu",
        issuingAuthority: "State Board of Higher Secondary Examination",
        quality: { qualityLevel: "GOOD", qualityDescription: "High resolution scan." },
        ocrConfidence: 95,
        fieldConfidence: 94,
        fieldConfidences: {
          name: 0.98,
          school: 0.94,
          stream: 0.92,
        },
        warnings: [],
        issues: [],
        extracted: {
          name: "Nithishkumar M",
          fatherName: "Murugan P",
          board: "Tamil Nadu State Board",
          school: "MATRIC HR SEC SCHOOL KANCHAMALAMUR SALEM",
          stream: "Bio-Maths",
          registerNumber: "7788991",
          year: "2023",
          marksScored: "540",
          maxMarks: "600",
          percentage: "90%",
          grade: "A+",
        },
      },
    },
    income: {
      file: { name: "income_cert.jpg" },
      url: "blob:mock-income",
      loading: false,
      err: null,
      open: true,
      data: {
        detectedType: "income",
        state: "Tamil Nadu",
        issuingAuthority: "Tahsildar Salem",
        quality: { qualityLevel: "GOOD", qualityDescription: "Clear certificate." },
        ocrConfidence: 96,
        fieldConfidence: 95,
        fieldConfidences: {
          name: 0.95,
          income: 0.96,
          certNumber: 0.92,
        },
        warnings: [],
        issues: [],
        extracted: {
          name: "Nithishkumar M",
          fatherName: "Murugan P",
          income: "₹1,50,000",
          incomeWords: "One Lakh Fifty Thousand Only",
          incomeYear: "2023-2024",
          certNumber: "TN-2023-INC-89012",
          issueDate: "12-06-2023",
          validUpto: "11-06-2024",
          taluk: "Salem South",
          district: "Salem",
          state: "Tamil Nadu",
          issuingAuthority: "Tahsildar Salem",
          freshness: {
            status: "valid",
            label: "Valid (Fresh)",
            detail: "Certificate was issued on 12-06-2023 and is currently valid.",
          },
        },
      },
    },
    community: {
      file: { name: "community_cert.jpg" },
      url: "blob:mock-community",
      loading: false,
      err: null,
      open: true,
      data: {
        detectedType: "community",
        state: "Tamil Nadu",
        issuingAuthority: "Zonal Deputy Tahsildar",
        quality: { qualityLevel: "GOOD", qualityDescription: "Official digital certificate." },
        ocrConfidence: 97,
        fieldConfidence: 96,
        fieldConfidences: {
          name: 0.98,
          community: 0.95,
          certNumber: 0.94,
        },
        warnings: [],
        issues: [],
        extracted: {
          name: "Nithishkumar M",
          fatherName: "Murugan P",
          community: "Vanniyar",
          communityCategory: "MBC",
          certNumber: "TN-2022-COMM-34567",
          issueDate: "15-08-2022",
          taluk: "Salem South",
          district: "Salem",
          state: "Tamil Nadu",
          issuingAuthority: "Zonal Deputy Tahsildar",
        },
      },
    },
  };

  test("renders simplified document cards with minimal default fields and clean status badges", () => {
    const { container } = render(
      <BrowserRouter>
        <DocumentUpload initialDs={mockInitialDs} initialStep={1} />
      </BrowserRouter>
    );

    // 1. Verify card titles and extracted sections exist for all 4 document types
    expect(screen.getAllByText("10th Marksheet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("12th Marksheet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Income Certificate").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Community Certificate").length).toBeGreaterThanOrEqual(1);

    // 2. Verify minimal default required names are displayed
    const studentNameOccurrences = screen.getAllByText("Nithishkumar M");
    expect(studentNameOccurrences.length).toBeGreaterThanOrEqual(3);

    // 3. Verify income holder relationship dropdown is present
    expect(screen.getByLabelText("Confirm holder relationship to student")).toBeTruthy();

    // 4. Verify compact Tools menu buttons are present for uploaded documents
    const toolsButtons = screen.getAllByText(/Tools ▾/i);
    expect(toolsButtons.length).toBe(4);

    // 5. Verify clean status indicators ("Please review" or "Confirmed by you")
    const reviewBadges = screen.getAllByText(/Please review/i);
    expect(reviewBadges.length).toBeGreaterThan(0);

    // 6. Verify unnecessary fields are NOT displayed by default on cards
    // School name, roll numbers, exam month, taluk, district, certificate number, detailed caste
    expect(screen.queryByText(". Yr oa scull aSauaTEnan LEW CRM Lm aegmghm Coan")).toBeNull();
    expect(screen.queryByText("MATRIC HR SEC SCHOOL KANCHAMALAMUR SALEM")).toBeNull();
    expect(screen.queryByText("1029384")).toBeNull();
    expect(screen.queryByText("7788991")).toBeNull();
    expect(screen.queryByText("TN-2023-INC-89012")).toBeNull();
    expect(screen.queryByText("TN-2022-COMM-34567")).toBeNull();
    expect(screen.queryByText("Salem South")).toBeNull();
    expect(screen.queryByText("Vanniyar")).toBeNull();

    // 7. Verify developer-facing "Field Match" percentages are NOT displayed
    const allText = container.textContent;
    expect(allText.includes("% match")).toBe(false);
    expect(allText.includes("Field Match")).toBe(false);
  });
});
