import {
  extractMarksheetData,
  extractMarksheetName,
  extractNameUsingGeometry,
  detectMarksheetTemplate,
  extractCommunityCertificateData,
  extractIncomeCertificateData,
  suggestOcrCorrections,
  validateCalendarDate,
  normalizeInstitutionName,
  compareInstitutions,
  maskSensitiveIdentifier,
  computeFieldConfidence,
} from "./fieldParsers";
import { evaluateDocumentValidity } from "./validityRules";


describe("fieldParsers", () => {
  describe("Marksheet Field Extraction - 10th (SSLC)", () => {
    test("extracts standard 10th marksheet data with synthetic candidate name", () => {
      const text = `
        GOVERNMENT OF TAMIL NADU
        DEPARTMENT OF GOVERNMENT EXAMINATIONS
        SECONDARY SCHOOL LEAVING CERTIFICATE (SSLC)
        NAME OF THE CANDIDATE: SAMPLE STUDENT
        SESSION: MARCH 2022
        DATE OF BIRTH: 15/08/2004
        PERMANENT REGISTER NUMBER: 1234567
        TOTAL MARKS : 349 / 500 THREE FOUR NINE (PASS)
        NAME OF THE SCHOOL: GOVT HIGHER SECONDARY SCHOOL SALEM
      `;

      const res = extractMarksheetData(text, "ms10");
      expect(res.name).toBe("Sample Student");
      expect(res.dob).toBe("15-08-2004");
      expect(res.registerNumber).toBe("1234567");
      expect(res.marksScored).toBe("349");
      expect(res.maxMarks).toBe("500");
      expect(res.percentage).toBe("69.80%");
      expect(res.grade).toBe("Pass");
      expect(res.year).toBe("2022");
      expect(res.school).toContain("GOVT HIGHER SECONDARY SCHOOL SALEM");
    });

    test("extracts bilingual 10th marksheet with Tamil text and OCR noise prefix", () => {
      const text = `
        தமிழ்நாடு மாநிலப் பள்ளித் தேர்வுகள் குழுமம்
        STATE BOARD OF SCHOOL EXAMINATIONS, TAMILNADU
        SECONDARY SCHOOL LEAVING CERTIFICATE
        பத்தாம் வகுப்பு / X STANDARD
        தேர்வரின் பெயர் / NAME OF THE CANDIDATE
        மாதிரி மாணவர்
        Pe DEMO CANDIDATE
        பருவம் / SESSION: மே 2022 / MAY 2022
        பிறந்த தேதி / DATE OF BIRTH: 24/06/2007 ROLL NO. 1349459
        நிரந்தரப் பதிவெண் / PERMANENT REGISTER NO. XM22R0491349459
        மொத்த மதிப்பெண்கள் / TOTAL MARKS : 358 THREE FIVE EIGHT (PASS)
        பள்ளியின் பெயர் / NAME OF THE SCHOOL
        eGausrmpgn uf CuwDmau und sgewmogyt Com X SWAMY VIVEKANANDAR MATRIC HR SEC SCHOOL KANCHAMALAYUR SALEM
      `;

      const res = extractMarksheetData(text, "ms10");
      expect(res.name).toBe("Demo Candidate");
      expect(res.dob).toBe("24-06-2007");
      expect(res.registerNumber).toBe("XM22R0491349459");
      expect(res.marksScored).toBe("358");
      // Since max marks is not explicitly printed in "TOTAL MARKS : 358", do NOT fabricate maxMarks
      expect(res.maxMarks).toBeNull();
      expect(res.percentage).toBeNull();
      expect(res.grade).toBe("Pass");
      expect(res.year).toBe("2022");
      expect(res.school).toBe("SWAMY VIVEKANANDAR MATRIC HR SEC SCHOOL KANCHAMALAYUR SALEM");
    });

    test("handles explicit fraction marks '465 / 500' accurately", () => {
      const text = `
        BOARD OF SECONDARY EDUCATION
        NAME OF CANDIDATE: TEST APPLICANT
        DATE OF BIRTH: 10/12/2005
        ROLL NO: 9876543
        TOTAL MARKS OBTAINED: 465 / 500
        RESULT: PASS
      `;

      const res = extractMarksheetData(text, "ms10");
      expect(res.name).toBe("Test Applicant");
      expect(res.dob).toBe("10-12-2005");
      expect(res.marksScored).toBe("465");
      expect(res.maxMarks).toBe("500");
      expect(res.percentage).toBe("93.00%");
      expect(res.grade).toBe("Pass");
    });
  });

  describe("Marksheet Field Extraction - 12th (HSC)", () => {
    test("extracts 12th marksheet data with leading zero in marks (0465) without fabricating maxMarks", () => {
      const text = `
        STATE BOARD OF SCHOOL EXAMINATIONS, TAMILNADU
        HIGHER SECONDARY COURSE - SECOND YEAR MARK CERTIFICATE
        தேர்வரின் பெயர் / NAME OF THE CANDIDATE
        SAMPLE STUDENT
        MAR 2024
        DATE OF BIRTH: 15/08/2004
        PERMANENT REGISTER NUMBER: 2313288953
        TOTAL MARKS : 0465 ZERO FOUR SIX FIVE
        NAME OF THE SCHOOL: SWAMY VIVEKANANDAR MATRIC HR SEC SCHOOL KANCHAMALAYUR SALEM
      `;

      const res = extractMarksheetData(text, "ms12");
      expect(res.name).toBe("Sample Student");
      expect(res.dob).toBe("15-08-2004");
      expect(res.registerNumber).toBe("2313288953");
      expect(res.marksScored).toBe("465");
      expect(res.maxMarks).toBeNull();
      expect(res.percentage).toBeNull();
      expect(res.year).toBe("2024");
      expect(res.school).toBe("SWAMY VIVEKANANDAR MATRIC HR SEC SCHOOL KANCHAMALAYUR SALEM");
    });

    test("extracts 12th marksheet correctly scoring candidate over Tamil OCR noise with explicit fraction 465 / 600", () => {
      const text = `
        STATE BOARD OF SCHOOL EXAMINATIONS, TAMILNADU
        HIGHER SECONDARY COURSE - SECOND YEAR MARK CERTIFICATE
        CERTIFICATE SL. NO : HSS 35272015
        தேர்வரின் பெயர் / NAME OF THE CANDIDATE
        Nm - Quipiiaei Il Caen
        DEMO CANDIDATE MAR 2024
        பிறந்த தேதி / DATE OF BIRTH: 24/06/2007 PERMANENT REGISTER NUMBER: 2313289153
        மொத்த மதிப்பெண்கள் / TOTAL MARKS : 0465 / 600 ZERO FOUR SIX FIVE
        NAME OF THE SCHOOL
        SWAMY VIVEKANANDAR MATRIC HR SEC SCHOOL KANCHAMALAYUR SALEM
      `;

      const res = extractMarksheetData(text, "ms12");
      expect(res.name).toBe("Demo Candidate");
      expect(res.dob).toBe("24-06-2007");
      expect(res.registerNumber).toBe("2313289153");
      expect(res.marksScored).toBe("465");
      expect(res.maxMarks).toBe("600");
      expect(res.percentage).toBe("77.50%");
      expect(res.year).toBe("2024");
      expect(res.school).toBe("SWAMY VIVEKANANDAR MATRIC HR SEC SCHOOL KANCHAMALAYUR SALEM");
    });

    test("handles GRAND TOTAL : 465 and rejects noise words", () => {
      const text = `
        COUNCIL FOR THE INDIAN SCHOOL CERTIFICATE EXAMINATIONS
        CANDIDATE NAME: TEST APPLICANT
        DATE OF BIRTH: 05-02-2006
        UNIQUE ID: 7891234
        GRAND TOTAL : 465
      `;

      const res = extractMarksheetData(text, "ms12");
      expect(res.name).toBe("Test Applicant");
      expect(res.dob).toBe("05-02-2006");
      expect(res.registerNumber).toBe("7891234");
      expect(res.marksScored).toBe("465");
      expect(res.maxMarks).toBeNull();
      expect(res.percentage).toBeNull();
      expect(res.board).toBe("CISCE (ICSE/ISC)");
    });

    test("extracts 12th marksheet synthetic regression fixture with exact layout and 0499 marks", () => {
      const text = `
        GOVERNMENT OF TAMIL NADU
        DEPARTMENT OF GOVERNMENT EXAMINATIONS
        HIGHER SECONDARY COURSE - SECOND YEAR (HSC)
        தேர்வரின் பெயர் / NAME OF THE CANDIDATE
        SAMPLE STUDENT

        DATE OF BIRTH
        01/01/2000

        PERMANENT REGISTER NUMBER
        TEST-REG-001

        MAR 2024

        TOTAL MARKS:
        0499

        NAME OF THE SCHOOL
        SAMPLE MATRIC HR SEC SCHOOL
      `;

      const res = extractMarksheetData(text, "ms12");
      expect(res.name).toBe("Sample Student");
      expect(res.dob).toBe("01-01-2000");
      expect(res.registerNumber).toBe("TEST-REG-001");
      expect(res.year).toBe("2024");
      expect(res.month).toBe("March");
      expect(res.marksScored).toBe("499");
      expect(res.maxMarks).toBeNull();
      expect(res.percentage).toBeNull();
      expect(res.school).toBe("SAMPLE MATRIC HR SEC SCHOOL");
      expect(res.board).toBe("Tamil Nadu Higher Secondary (HSC)");
    });

    test("extracts 12th marksheet when Tamil OCR noise ('Gubipsiull Lhe Bh') appears before English candidate name", () => {
      const text = `
        TAMIL NADU STATE BOARD OF SCHOOL EXAMINATIONS
        HIGHER SECONDARY COURSE CERTIFICATE
        தேர்வரின் பெயர் / NAME OF THE CANDIDATE
        Gubipsiull Lhe Bh
        SAMPLE STUDENT
        DATE OF BIRTH: 01/01/2000
        PERMANENT REGISTER NUMBER: TEST-REG-001
        MAR 2024
        TOTAL MARKS : 0499 / 600
        NAME OF THE SCHOOL: SAMPLE MATRIC HR SEC SCHOOL
      `;

      const res = extractMarksheetData(text, "ms12");
      expect(res.name).toBe("Sample Student");
      expect(res.marksScored).toBe("499");
      expect(res.maxMarks).toBe("600");
      expect(res.percentage).toBe("83.17%");
      expect(res.school).toBe("SAMPLE MATRIC HR SEC SCHOOL");
    });

    test("rejects candidate name and returns null when only OCR garbage ('Gubipsiull Lhe Bh') is present below label", () => {
      const text = `
        TAMIL NADU STATE BOARD OF SCHOOL EXAMINATIONS
        HIGHER SECONDARY COURSE CERTIFICATE
        NAME OF THE CANDIDATE
        Gubipsiull Lhe Bh
        DATE OF BIRTH: 01/01/2000
        PERMANENT REGISTER NUMBER: TEST-REG-001
        MAR 2024
        TOTAL MARKS: 0499
        NAME OF THE SCHOOL: SAMPLE MATRIC HR SEC SCHOOL
      `;

      const res = extractMarksheetData(text, "ms12");
      expect(res.name).toBeNull();
      expect(res.marksScored).toBe("499");
      expect(res.school).toBe("SAMPLE MATRIC HR SEC SCHOOL");
    });

    test("extracts candidate name and marks using document geometry and bounding boxes", () => {
      const ocrData = {
        text: "HIGHER SECONDARY\nNAME OF THE CANDIDATE\nSAMPLE STUDENT\nTOTAL MARKS 499",
        lines: [
          { text: "HIGHER SECONDARY", confidence: 95, bbox: { x0: 100, y0: 50, x1: 500, y1: 80 } },
          { text: "தேர்வரின் பெயர் / NAME OF THE CANDIDATE", confidence: 85, bbox: { x0: 100, y0: 120, x1: 450, y1: 150 } },
          { text: "Gubipsiull Lhe Bh", confidence: 32, bbox: { x0: 100, y0: 160, x1: 300, y1: 185 } },
          { text: "SAMPLE STUDENT", confidence: 96, bbox: { x0: 100, y0: 190, x1: 350, y1: 220 } },
          { text: "TOTAL MARKS : 499", confidence: 94, bbox: { x0: 100, y0: 300, x1: 400, y1: 330 } },
        ],
      };
      const res = extractMarksheetData(ocrData, "ms12");
      expect(res.name).toBe("Sample Student");
      expect(res.marksScored).toBe("499");
    });

    test("applies candidate name scoring and school extraction cleanly to 10th (SSLC) marksheet as well", () => {
      const text = `
        STATE BOARD OF SCHOOL EXAMINATIONS, TAMILNADU
        SECONDARY SCHOOL LEAVING CERTIFICATE (SSLC)
        தேர்வரின் பெயர் / NAME OF THE CANDIDATE
        Gubipsiull Lhe Bh
        SAMPLE STUDENT
        DATE OF BIRTH: 01/01/2000
        PERMANENT REGISTER NUMBER: TEST-REG-001
        SESSION: MARCH 2024
        TOTAL MARKS: 0499
        NAME OF THE SCHOOL: SAMPLE MATRIC HR SEC SCHOOL
      `;

      const res = extractMarksheetData(text, "ms10");
      expect(res.name).toBe("Sample Student");
      expect(res.marksScored).toBe("499");
      expect(res.board).toBe("Tamil Nadu State Board (SSLC)");
      expect(res.school).toBe("SAMPLE MATRIC HR SEC SCHOOL");
    });

    test("returns null safely when marksheet fields are missing", () => {
      const text = "A blank page without candidate data.";
      const res = extractMarksheetData(text, "ms10");
      expect(res.name).toBeNull();
      expect(res.marksScored).toBeNull();
      expect(res.year).toBeNull();
    });
  });

  describe("Community Certificate Field Extraction (Multi-State)", () => {
    test("extracts candidate name, father name, category, and district from Tamil Nadu community certificate", () => {
      const text = `
        GOVERNMENT OF TAMIL NADU
        REVENUE DEPARTMENT
        COMMUNITY CERTIFICATE
        This is to certify that Selvan SAMPLE STUDENT son of Thiru SAMPLE FATHER residing at Salem District
        belongs to Most Backward Class (MBC) community.
        Certificate No: TN-5202110011763
        Date of Issue: 11-10-2021
        Taluk : Salem South
        District : Salem
        Designation : Headquarters Deputy Tahsildar
      `;

      const res = extractCommunityCertificateData(text);
      expect(res.name).toBe("Sample Student");
      expect(res.fatherName).toBe("Sample Father");
      expect(res.communityCategory).toBe("MBC");
      expect(res.certNumber).toBe("TN-5202110011763");
      expect(res.issueDate).toBe("11-10-2021");
      expect(res.taluk).toBe("Salem South");
      expect(res.district).toBe("Salem");
      expect(res.issuingAuthority).toBe("Headquarters Deputy Tahsildar");
      expect(res.state).toBe("Tamil Nadu");
    });

    test("extracts candidate name, father name, caste, category (SC), and district from bilingual certificate", () => {
      const text = `
        வகுப்புச் சான்றிதழ்
        Community Certificate
        சான்றிதழ் எண் / Certificate No: TN-5202309155116 நாள் / Date: 20-09-2023
        This is to certify that Selvan DEMO CANDIDATE son of Thiru DEMO FATHER residing at Door No. 100, Test Street of Sample Village / Town of Thottiam Taluk of Thiruchirappalli District of the State of Tamil Nadu belongs TestCaste which is recognized as a Scheduled Caste as per the Scheduled Caste and Scheduled Tribes Orders (Amendment) Act. 1976 vide Serial No. 12.
        மாவட்டம் /District : Thiruchirappalli
        வட்டம் /Taluk : Thottiam
        பதவி /Designation : வட்டாட்சியர் /Tahsildar
      `;

      const res = extractCommunityCertificateData(text);
      expect(res.name).toBe("Demo Candidate");
      expect(res.fatherName).toBe("Demo Father");
      expect(res.communityCategory).toBe("SC");
      expect(res.certNumber).toBe("TN-5202309155116");
      expect(res.issueDate).toBe("20-09-2023");
      expect(res.taluk).toBe("Thottiam");
      expect(res.district).toBe("Thiruchirappalli");
      expect(res.issuingAuthority).toContain("Tahsildar");
      expect(res.state).toBe("Tamil Nadu");
    });

    test("extracts community certificate from Karnataka with Tahsildar authority", () => {
      const text = `
        GOVERNMENT OF KARNATAKA
        REVENUE DEPARTMENT
        CASTE CERTIFICATE
        Certificate No: RD00381928374
        Date: 15/07/2023
        This is to certify that Kum. TEST APPLICANT daughter of Shri DEMO PARENT
        residing at Bengaluru Urban District belongs to Category IIA (OBC).
        Tahsildar Bengaluru North Taluk
      `;

      const res = extractCommunityCertificateData(text);
      expect(res.name).toBe("Test Applicant");
      expect(res.fatherName).toBe("Demo Parent");
      expect(res.communityCategory).toBe("OBC");
      expect(res.certNumber).toBe("RD00381928374");
      expect(res.issueDate).toBe("15-07-2023");
      expect(res.issuingAuthority).toContain("Tahsildar");
      expect(res.state).toBe("Karnataka");
    });
  });

  describe("Income Certificate Field Extraction (Multi-State & Freshness)", () => {
    test("extracts candidate name, income, validity period and flags expired certificate (>12 months)", () => {
      const text = `
        GOVERNMENT OF TAMIL NADU
        REVENUE DEPARTMENT
        வருமானச் சான்றிதழ் / INCOME CERTIFICATE
        சான்றிதழ் எண் / Certificate No: TN-5202405111155 நாள் / Date: 11-05-2024
        This is to certify that Thiru SAMPLE APPLICANT son of Thiru SAMPLE FATHER residing at Salem District
        annual income from all sources is Rs. 1,50,000/- (Rupees One Lakh Fifty Thousand only).
        Certificate validity period : 11-05-2024 to 10-05-2025
        வட்டம் / Taluk : Salem South
        மாவட்டம் / District : Salem
        பதவி / Designation : Zonal Deputy Tahsildar
      `;

      const res = extractIncomeCertificateData(text);
      expect(res.name).toBe("Sample Applicant");
      expect(res.fatherName).toBe("Sample Father");
      expect(res.incomeNumber).toBe(150000);
      expect(res.income).toBe("₹1,50,000");
      expect(res.certNumber).toBe("TN-5202405111155");
      expect(res.issueDate).toBe("11-05-2024");
      expect(res.validUpto).toBe("10-05-2025");
      expect(res.taluk).toBe("Salem South");
      expect(res.district).toBe("Salem");
      expect(res.issuingAuthority).toBe("Zonal Deputy Tahsildar");
      expect(res.state).toBe("Tamil Nadu");
      // Ordinary OCR parsing must never set isExpiryConfirmed to true automatically:
      expect(res.freshness.status).toBe("needs_confirmation");
      expect(res.freshness.stateKey).toBe("unconfirmed_expiry");
      // Explicit provenance / student confirmation confirms the expired date:
      const confirmedRes = extractIncomeCertificateData(text, { isExpiryConfirmed: true });
      expect(confirmedRes.freshness.status).toBe("expired");
    });

    test("extracts Gujarat 3-year income certificate with Talati Cum Mantri authority and 3-year validity", () => {
      const text = `
        Government of Gujarat
        Income Certificate
        Certificate No. :: 10/2025
        Gram Panchayat Devaliya
        Devbhumi dwarka
        Date :: 16/04/2025
        This is certify that Mr. DEMO CANDIDATE
        Son of DEMO FATHER
        residing at DEVLIYA JAM KHAMBHALIYA DEV BHUMI DWARKA
        Vilage/City Devaliya Taluka Khambhalia District Devbhumi dwarka
        and his /her family's annual income from all the resources for last financial year is Rs.92000/-
        Rs. In words ( Ninety two Thousand Only )
        Total annual Income Rs. 92000
        This Certificate is valid for three years including the current financial year.
        Talati cum Mantri Gram Panchayat Devaliya
      `;

      const res = extractIncomeCertificateData(text);
      expect(res.name).toBe("Demo Candidate");
      expect(res.fatherName).toBe("Demo Father");
      expect(res.incomeNumber).toBe(92000);
      expect(res.income).toBe("₹92,000");
      expect(res.certNumber).toBe("10/2025");
      expect(res.issueDate).toBe("16-04-2025");
      expect(res.validUpto).toBe("16-04-2028");
      expect(res.taluk).toBe("Khambhalia");
      expect(res.district).toBe("Devbhumi Dwarka");
      expect(res.issuingAuthority).toBe("Talati Cum Mantri");
      expect(res.state).toBe("Gujarat");
      // Ordinary OCR parsing without confirmation flag must remain needs_confirmation
      expect(res.freshness.status).toBe("needs_confirmation");
      expect(res.freshness.stateKey).toBe("unconfirmed_expiry");
      // Explicit provenance / student confirmation evaluates to valid
      const confirmedRes = extractIncomeCertificateData(text, { isExpiryConfirmed: true });
      expect(confirmedRes.freshness.status).toBe("valid");
    });

    test("correctly computes generic N-year stated validity from issue date and stated duration", () => {
      const text = `
        Government of Kerala
        Income Certificate
        Date of Issue: 01/01/2026
        This is to certify that Mr. SAMPLE STUDENT
        Total annual income Rs. 1,20,000
        This certificate is valid for 3 years from date of issue.
        Village Officer Kochi
      `;

      const res = extractIncomeCertificateData(text);
      expect(res.name).toBe("Sample Student");
      expect(res.incomeNumber).toBe(120000);
      expect(res.issueDate).toBe("01-01-2026");
      expect(res.validUpto).toBe("01-01-2029");
      expect(res.issuingAuthority).toBe("Village Officer");
      expect(res.state).toBe("Kerala");
      // Ordinary OCR parsing must remain needs_confirmation
      expect(res.freshness.status).toBe("needs_confirmation");
      expect(res.freshness.stateKey).toBe("unconfirmed_expiry");
      // Explicit provenance / student confirmation evaluates to valid
      const confirmedRes = extractIncomeCertificateData(text, { isExpiryConfirmed: true });
      expect(confirmedRes.freshness.status).toBe("valid");
    });

    test("actual OCR-parser-to-validity path: extracted date without confirmation flag outputs needs_confirmation; confirmed date evaluates to expired or valid", () => {
      const text = `
        Income Certificate
        Date of Issue: 01/06/2026
        This certificate is valid until 01/08/2026
        Total annual income Rs. 1,50,000
      `;

      // 1. Run ordinary OCR parsing (no options)
      const ocrResult = extractIncomeCertificateData(text);
      expect(ocrResult.issueDate).toBe("01-06-2026");
      expect(ocrResult.validUpto).toBe("01-08-2026");
      // Ordinary OCR parsing must never set isExpiryConfirmed to true automatically
      expect(ocrResult.freshness.status).toBe("needs_confirmation");
      expect(ocrResult.freshness.stateKey).toBe("unconfirmed_expiry");

      // 2. Feed directly into evaluateDocumentValidity without confirmation metadata
      const unconfirmedDoc = {
        docType: "Income Certificate",
        issueDate: ocrResult.issueDate,
        validUpto: ocrResult.validUpto,
      };
      const unconfirmedValidity = evaluateDocumentValidity(unconfirmedDoc);
      expect(unconfirmedValidity.status).toBe("needs_confirmation");
      expect(unconfirmedValidity.conceptA_expiry.status).toBe("NEEDS_CONFIRMATION");
      expect(unconfirmedValidity.conceptA_expiry.message).toContain("OCR extracted expiry date");

      // 3. Feed with student confirmation (e.g. isExpiryConfirmed: true)
      const confirmedDoc = {
        ...unconfirmedDoc,
        isExpiryConfirmed: true,
      };
      const confirmedValidity = evaluateDocumentValidity(confirmedDoc);
      expect(confirmedValidity.status).toBe("expired");
      expect(confirmedValidity.conceptA_expiry.status).toBe("EXPIRED");
      expect(confirmedValidity.conceptA_expiry.message).toContain("Document explicitly expired");

      // 4. Future date test
      const futureText = `
        Income Certificate
        Date of Issue: 01/01/2026
        This certificate is valid until 01/01/2029
        Total annual income Rs. 1,50,000
      `;
      const futureOcr = extractIncomeCertificateData(futureText);
      expect(futureOcr.freshness.status).toBe("needs_confirmation");

      const futureValidity = evaluateDocumentValidity({
        docType: "Income Certificate",
        issueDate: futureOcr.issueDate,
        validUpto: futureOcr.validUpto,
        isExpiryConfirmed: true,
      });
      expect(futureValidity.conceptA_expiry.status).toBe("NOT_EXPIRED");
    });

    test("prioritizes explicit date range over stated duration when both are present", () => {
      const text = `
        Income Certificate
        Date of Issue: 01/01/2025
        This is to certify that Ms. TEST APPLICANT
        Total annual income Rs. 2,00,000
        This certificate is valid for 3 years.
        Certificate validity period : 01-01-2025 to 31-12-2027
      `;

      const res = extractIncomeCertificateData(text);
      expect(res.issueDate).toBe("01-01-2025");
      expect(res.validUpto).toBe("31-12-2027");
    });

    test("returns unknown status when no validity or issue date information exists", () => {
      const text = `
        Income Certificate
        This is to certify that Mr. SAMPLE CANDIDATE
        Total annual income Rs. 80,000
      `;

      const res = extractIncomeCertificateData(text);
      expect(res.name).toBe("Sample Candidate");
      expect(res.incomeNumber).toBe(80000);
      expect(res.issueDate).toBeNull();
      expect(res.validUpto).toBeNull();
      expect(res.freshness.status).toBe("unknown");
    });
  });

  describe("Multi-Strategy Candidate Name Extraction & Geometry Fallback", () => {
    // 1. Candidate label recognized cleanly
    test("Scenario 1: extracts name when candidate label is cleanly recognized", () => {
      const ocrData = {
        text: "HIGHER SECONDARY\nதேர்வரின் பெயர் / NAME OF THE CANDIDATE\nSYNTHETIC STUDENT\nTOTAL MARKS 499",
        lines: [
          { text: "HIGHER SECONDARY", confidence: 95, bbox: { x0: 100, y0: 50, x1: 500, y1: 80 } },
          { text: "தேர்வரின் பெயர் / NAME OF THE CANDIDATE", confidence: 88, bbox: { x0: 100, y0: 120, x1: 450, y1: 150 } },
          { text: "SYNTHETIC STUDENT", confidence: 94, bbox: { x0: 100, y0: 160, x1: 350, y1: 190 } },
          { text: "TOTAL MARKS 499", confidence: 92, bbox: { x0: 100, y0: 300, x1: 400, y1: 330 } },
        ],
      };
      const res = extractMarksheetData(ocrData, "ms12");
      expect(res.name).toBe("Synthetic Student");
    });

    // 2. Candidate label partially corrupted
    test("Scenario 2: extracts name when candidate label is partially corrupted by OCR", () => {
      const ocrData = {
        text: "HIGHER SECONDARY\nGsiwflar / ME OF THE CANDI TE\nSYNTHETIC CANDIDATE R\nPERMANENT REGISTER NO: 1234567",
        lines: [
          { text: "HIGHER SECONDARY COURSE CERTIFICATE", confidence: 92, bbox: { x0: 100, y0: 50, x1: 700, y1: 85 } },
          { text: "Gsiwflar / ME OF THE CANDI TE", confidence: 55, bbox: { x0: 100, y0: 120, x1: 450, y1: 150 } },
          { text: "SYNTHETIC CANDIDATE R", confidence: 95, bbox: { x0: 100, y0: 165, x1: 400, y1: 195 } },
          { text: "PERMANENT REGISTER NO: 1234567", confidence: 90, bbox: { x0: 100, y0: 250, x1: 500, y1: 280 } },
        ],
      };
      const res = extractMarksheetData(ocrData, "ms12");
      expect(res.name).toBe("Synthetic Candidate R");
    });

    // 3. Candidate label completely missing (GEOMETRY FALLBACK REQUIREMENT)
    test("Scenario 3: extracts candidate name via geometry fallback when candidate label is completely missing", () => {
      // Notice: NO mention of "NAME", "CANDIDATE", "STUDENT", "தேர்வர்", or "பெயர்" anywhere!
      const ocrData = {
        text: "GOVERNMENT OF TAMIL NADU\nDEPARTMENT OF GOVERNMENT EXAMINATIONS\nHIGHER SECONDARY COURSE CERTIFICATE\nSYNTHETIC STUDENT R\nPERMANENT REGISTER NUMBER: 9876543\nDATE OF BIRTH: 12/04/2005\nMARCH 2024\nTOTAL MARKS: 0495\nNAME OF THE SCHOOL: SYNTHETIC MODEL HR SEC SCHOOL",
        lines: [
          { text: "GOVERNMENT OF TAMIL NADU", confidence: 95, bbox: { x0: 100, y0: 40, x1: 900, y1: 70 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "DEPARTMENT OF GOVERNMENT EXAMINATIONS", confidence: 95, bbox: { x0: 100, y0: 75, x1: 900, y1: 105 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "HIGHER SECONDARY COURSE CERTIFICATE", confidence: 96, bbox: { x0: 100, y0: 110, x1: 900, y1: 140 }, pageWidth: 1000, pageHeight: 1000 },
          // Candidate line in structural candidate band (normY: 0.21 - 0.245)
          { text: "SYNTHETIC STUDENT R", confidence: 93, bbox: { x0: 250, y0: 210, x1: 750, y1: 245 }, pageWidth: 1000, pageHeight: 1000 },
          // Lower landmark: DOB and Register Number (normY: 0.32 - 0.355)
          { text: "PERMANENT REGISTER NUMBER: 9876543   DATE OF BIRTH: 12/04/2005", confidence: 92, bbox: { x0: 100, y0: 320, x1: 900, y1: 355 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "TOTAL MARKS: 0495", confidence: 94, bbox: { x0: 100, y0: 650, x1: 500, y1: 685 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "NAME OF THE SCHOOL: SYNTHETIC MODEL HR SEC SCHOOL", confidence: 90, bbox: { x0: 100, y0: 780, x1: 900, y1: 815 }, pageWidth: 1000, pageHeight: 1000 },
        ],
      };

      const res = extractMarksheetData(ocrData, "ms12");
      expect(res.name).toBe("Synthetic Student R");
      expect(res.dob).toBe("12-04-2005");
      expect(res.registerNumber).toBe("9876543");
      expect(res.marksScored).toBe("495");
      expect(res.board).toBe("Tamil Nadu Higher Secondary (HSC)");
    });

    // 4. Tamil OCR noise around the field
    test("Scenario 4: ignores Tamil OCR noise tokens around the field and extracts clean candidate name", () => {
      const ocrData = {
        text: "HIGHER SECONDARY COURSE CERTIFICATE\nGsiwflar Quust\nGubipsiull eGausrmpgn\nSYNTHETIC KUMAR\nPERMANENT REGISTER NO: 5432109\nTOTAL MARKS 480",
        lines: [
          { text: "HIGHER SECONDARY COURSE CERTIFICATE", confidence: 95, bbox: { x0: 100, y0: 50, x1: 900, y1: 90 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "Gsiwflar Quust", confidence: 30, bbox: { x0: 100, y0: 150, x1: 400, y1: 175 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "Gubipsiull eGausrmpgn", confidence: 25, bbox: { x0: 100, y0: 180, x1: 400, y1: 205 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "SYNTHETIC KUMAR", confidence: 94, bbox: { x0: 200, y0: 220, x1: 600, y1: 255 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "PERMANENT REGISTER NO: 5432109", confidence: 91, bbox: { x0: 100, y0: 320, x1: 600, y1: 350 }, pageWidth: 1000, pageHeight: 1000 },
        ],
      };
      const res = extractMarksheetData(ocrData, "ms12");
      expect(res.name).toBe("Synthetic Kumar");
    });

    // 5. Wrong/random English text in the field (Negative Test)
    test("Scenario 5: returns name = null when structural region contains random English noise or labels", () => {
      const ocrData = {
        text: "HIGHER SECONDARY EXAMINATION\nXKJ 987#@! PQ\nPERMANENT REGISTER NO: 1234567",
        lines: [
          { text: "HIGHER SECONDARY EXAMINATION", confidence: 90, bbox: { x0: 100, y0: 50, x1: 900, y1: 90 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "XKJ 987#@! PQ", confidence: 40, bbox: { x0: 200, y0: 210, x1: 500, y1: 245 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "PERMANENT REGISTER NO: 1234567", confidence: 91, bbox: { x0: 100, y0: 320, x1: 600, y1: 350 }, pageWidth: 1000, pageHeight: 1000 },
        ],
      };
      const res = extractMarksheetData(ocrData, "ms12");
      expect(res.name).toBeNull();
    });

    // 6. Ambiguous candidates in region
    test("Scenario 6: returns name = null and asks for manual verification when multiple candidates are ambiguous", () => {
      const ocrData = {
        text: "HIGHER SECONDARY COURSE CERTIFICATE\nALPHA STUDENT\nBETA STUDENT\nPERMANENT REGISTER NO: 1234567",
        lines: [
          { text: "HIGHER SECONDARY COURSE CERTIFICATE", confidence: 90, bbox: { x0: 100, y0: 50, x1: 900, y1: 90 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "ALPHA STUDENT", confidence: 75, bbox: { x0: 200, y0: 190, x1: 600, y1: 220 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "BETA STUDENT", confidence: 75, bbox: { x0: 200, y0: 230, x1: 600, y1: 260 }, pageWidth: 1000, pageHeight: 1000 },
          { text: "PERMANENT REGISTER NO: 1234567", confidence: 91, bbox: { x0: 100, y0: 320, x1: 600, y1: 350 }, pageWidth: 1000, pageHeight: 1000 },
        ],
      };
      const res = extractMarksheetData(ocrData, "ms12");
      expect(res.name).toBeNull();
    });

    // 7. Clear document with various Indian name structures
    test("Scenario 7: handles various valid Indian name structures including initials", () => {
      const patterns = [
        { raw: "SYNTHETIC STUDENT R", expected: "Synthetic Student R" },
        { raw: "SYNTHETIC KUMAR", expected: "Synthetic Kumar" },
        { raw: "SYNTHETIC R", expected: "Synthetic R" },
        { raw: "R SYNTHETIC", expected: "R Synthetic" },
      ];

      for (const { raw, expected } of patterns) {
        const ocrData = {
          text: `HIGHER SECONDARY COURSE CERTIFICATE\n${raw}\nPERMANENT REGISTER NO: 1234567`,
          lines: [
            { text: "HIGHER SECONDARY COURSE CERTIFICATE", confidence: 95, bbox: { x0: 100, y0: 50, x1: 900, y1: 90 }, pageWidth: 1000, pageHeight: 1000 },
            { text: raw, confidence: 95, bbox: { x0: 200, y0: 220, x1: 600, y1: 250 }, pageWidth: 1000, pageHeight: 1000 },
            { text: "PERMANENT REGISTER NO: 1234567", confidence: 90, bbox: { x0: 100, y0: 320, x1: 600, y1: 350 }, pageWidth: 1000, pageHeight: 1000 },
          ],
        };
        const res = extractMarksheetData(ocrData, "ms12");
        expect(res.name).toBe(expected);
      }
    });

    // 8. Non-fabrication guarantee
    test("Scenario 8: does not fabricate missing marks, percentage, or school", () => {
      const text = `
        HIGHER SECONDARY COURSE CERTIFICATE
        SYNTHETIC STUDENT
      `;
      const res = extractMarksheetData(text, "ms12");
      expect(res.marksScored).toBeNull();
      expect(res.maxMarks).toBeNull();
      expect(res.percentage).toBeNull();
      expect(res.school).toBeNull();
      expect(res.dob).toBeNull();
      expect(res.registerNumber).toBeNull();
    });
  });

  describe("Critical Fields in 10th and 12th Marksheet Extraction", () => {
    test("extracts all critical fields: Name, DOB, School, Board, Register/Roll No, Year, Marks, Percentage, Grade, Parents", () => {
      const text = `
        GOVERNMENT OF TAMIL NADU
        DEPARTMENT OF GOVERNMENT EXAMINATIONS
        SECONDARY SCHOOL LEAVING CERTIFICATE (SSLC)
        NAME OF THE CANDIDATE: KAVITHA M
        FATHER'S NAME: MURUGAN S
        MOTHER'S NAME: LAKSHMI M
        DATE OF BIRTH: 24/05/2005
        PERMANENT REGISTER NUMBER: 7654321
        NAME OF THE SCHOOL: GOVT HIGHER SECONDARY SCHOOL SALEM
        SESSION: MARCH 2021
        TOTAL MARKS : 455 / 500
        TAMIL 092
        ENGLISH 088
        MATHEMATICS 095
        SCIENCE 090
        SOCIAL SCIENCE 090
        PASS
      `;
      const res = extractMarksheetData(text, "ms10");

      expect(res.name).toBe("Kavitha M");
      expect(res.fatherName).toBe("Murugan S");
      expect(res.motherName).toBe("Lakshmi M");
      expect(res.dob).toBe("24-05-2005");
      expect(res.school).toContain("GOVT HIGHER SECONDARY SCHOOL SALEM");
      expect(res.board).toContain("Tamil Nadu");
      expect(res.registerNumber).toBe("7654321");
      expect(res.year).toBe("2021");
      expect(res.month).toBe("March");
      expect(res.marksScored).toBe("455");
      expect(res.maxMarks).toBe("500");
      expect(res.percentage).toBe("91.00%");
      expect(res.grade).toBe("Pass");
      expect(res.subjectMarks).toBeDefined();
      expect(res.subjectMarks.length).toBeGreaterThanOrEqual(4);

      // Verify structuredFields
      expect(res.structuredFields).toBeDefined();
      expect(res.structuredFields.name.confidence).toBeGreaterThanOrEqual(90);
      expect(res.structuredFields.name.status).toBe("high");
      expect(res.structuredFields.dob.status).toBe("high");
      expect(res.structuredFields.registerNumber.status).toBe("medium");
    });

    test("12th marksheet extracts critical elective marks and percentage", () => {
      const text = `
        GOVERNMENT OF TAMIL NADU
        HIGHER SECONDARY COURSE CERTIFICATE (HSC)
        NAME OF THE CANDIDATE: ANANDHA KUMAR S
        DATE OF BIRTH: 12/10/2003
        PERMANENT REGISTER NUMBER: 8812345
        NAME OF THE SCHOOL: ST JOSEPH HIGHER SECONDARY SCHOOL TRICHY
        SESSION: MARCH 2021
        TOTAL MARKS : 540 / 600
        PASS
      `;
      const res = extractMarksheetData(text, "ms12");

      expect(res.name).toBe("Anandha Kumar S");
      expect(res.dob).toBe("12-10-2003");
      expect(res.school).toContain("ST JOSEPH HIGHER SECONDARY SCHOOL TRICHY");
      expect(res.board).toContain("Tamil Nadu Higher Secondary (HSC)");
      expect(res.registerNumber).toBe("8812345");
      expect(res.marksScored).toBe("540");
      expect(res.maxMarks).toBe("600");
      expect(res.percentage).toBe("90.00%");
      expect(res.grade).toBe("Pass");
    });
  });

  describe("Conservative OCR Error Correction (suggestOcrCorrections)", () => {
    test("detects digits in names and provides non-destructive suggestions", () => {
      const res1 = suggestOcrCorrections("N1TH1SH", "name");
      expect(res1.rawValue).toBe("N1TH1SH");
      expect(res1.uncertain).toBe(true);
      expect(res1.possibleCorrections).toContain("NITHISH");

      const res2 = suggestOcrCorrections("KUM4R", "name");
      expect(res2.possibleCorrections).toContain("KUMAR");

      const res3 = suggestOcrCorrections("S0UNDAR", "name");
      expect(res3.possibleCorrections).toContain("SOUNDAR");
    });

    test("suggests corrections for character confusion rn vs m and cl vs d", () => {
      const res1 = suggestOcrCorrections("KArnan", "name");
      expect(res1.possibleCorrections).toContain("KArnan".replace(/rn/g, "m"));

      const res2 = suggestOcrCorrections("clhan", "name");
      expect(res2.possibleCorrections).toContain("dhan");
    });

    test("handles ambiguous certificate and registration numbers without silent changes", () => {
      const res1 = suggestOcrCorrections("ABO1238", "id");
      expect(res1.rawValue).toBe("ABO1238");
      expect(res1.uncertain).toBe(true);
      expect(res1.possibleCorrections).toContain("AB01238");

      const res2 = suggestOcrCorrections("TN-l234", "id");
      expect(res2.possibleCorrections).toContain("TN-1234");
    });

    test("handles date digit character confusions (O->0, B->8)", () => {
      const res = suggestOcrCorrections("12/0B/2006", "date");
      expect(res.uncertain).toBe(true);
      expect(res.possibleCorrections).toContain("12/08/2006");
    });
  });

  describe("Calendar Date Validation (validateCalendarDate)", () => {
    test("accepts valid calendar dates and identifies components", () => {
      const d1 = validateCalendarDate("15/08/2004");
      expect(d1.isValid).toBe(true);
      expect(d1.day).toBe(15);
      expect(d1.month).toBe(8);
      expect(d1.year).toBe(2004);

      // Leap year check: Feb 29 on leap year 2004 is valid
      const d2 = validateCalendarDate("29-02-2004");
      expect(d2.isValid).toBe(true);
    });

    test("rejects invalid days and leap year anomalies", () => {
      // Feb 29 on non-leap year 2005 is invalid
      const nonLeap = validateCalendarDate("29-02-2005");
      expect(nonLeap.isValid).toBe(false);
      expect(nonLeap.reason).toContain("Invalid day");

      // Feb 30/31 is invalid
      const feb30 = validateCalendarDate("30/02/2020");
      expect(feb30.isValid).toBe(false);

      // Month > 12 is invalid
      const badMonth = validateCalendarDate("12/15/2020");
      expect(badMonth.isValid).toBe(false);

      // Year out of range
      const badYear = validateCalendarDate("12/05/1920");
      expect(badYear.isValid).toBe(false);
    });
  });

  describe("Institution Normalization & Fuzzy Matching (compareInstitutions)", () => {
    test("normalizes abbreviations: HSS, GOVT, MATRIC, ENG, COLL", () => {
      const norm1 = normalizeInstitutionName("Govt. H.S.S. Salem");
      expect(norm1).toBe("GOVT HSS SALEM");

      const norm2 = normalizeInstitutionName("Sri Ram Engg. College");
      expect(norm2).toBe("SRI RAM ENG COLL");
    });

    test("fuzzy compares institution names with abbreviation equivalence", () => {
      const res1 = compareInstitutions("Sri Ram Eng College", "Sri Ram Engineering College");
      expect(res1.isMatch).toBe(true);
      expect(res1.status).toBe("MATCH");

      const res2 = compareInstitutions("Govt Higher Secondary School", "Govt HSS");
      expect(res2.isMatch).toBe(true);

      const res3 = compareInstitutions("Delhi Public School", "St Xavier High School");
      expect(res3.isMatch).toBe(false);
      expect(res3.status).toBe("DIFFERENT");
    });
  });

  describe("Sensitive Identifier Masking (maskSensitiveIdentifier)", () => {
    test("masks Aadhaar to show only last 4 digits", () => {
      expect(maskSensitiveIdentifier("1234 5678 9012", "aadhaar")).toBe("XXXX-XXXX-9012");
      expect(maskSensitiveIdentifier("123456789012", "aadhaar")).toBe("XXXX-XXXX-9012");
    });

    test("masks Bank Account Number to show only last 4 digits", () => {
      expect(maskSensitiveIdentifier("987654321012", "bank")).toBe("XXXXXXXX1012");
    });
  });

  describe("Deterministic Field Confidence Scoring (computeFieldConfidence)", () => {
    test("calculates deterministic confidence and assigns proper status band", () => {
      const high = computeFieldConfidence({
        engineConfidence: 95,
        patternStrength: 95,
        labelProximity: 90,
        valueValidity: 100,
      });
      expect(high.score).toBeGreaterThanOrEqual(90);
      expect(high.status).toBe("high");
      expect(high.uncertain).toBe(false);

      const medium = computeFieldConfidence({
        engineConfidence: 75,
        patternStrength: 80,
        labelProximity: 70,
        valueValidity: 80,
      });
      expect(medium.score).toBeGreaterThanOrEqual(70);
      expect(medium.score).toBeLessThan(90);
      expect(medium.status).toBe("medium");

      const low = computeFieldConfidence({
        engineConfidence: 50,
        patternStrength: 60,
        labelProximity: 40,
        valueValidity: 60,
      });
      expect(low.score).toBeLessThan(70);
      expect(low.status).toBe("low");
      expect(low.uncertain).toBe(true);
    });
  });
});

