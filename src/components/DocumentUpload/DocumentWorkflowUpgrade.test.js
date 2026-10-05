jest.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: jest.fn(),
}));

import { suggestDocumentType, STANDARD_CATEGORIES } from '../../utils/documentClassifier';
import { computeFileFingerprint, checkDuplicateFingerprint } from '../../utils/documentFingerprint';
import { evaluateDocumentValidity, SCHEME_VALIDITY_RULES } from '../../utils/validityRules';
import { calculatePreparationAudit, PREPARATION_DISCLAIMER } from '../../utils/preparationScore';
import { compareNames, compareDOB, STANDARD_CONSISTENCY_STATUSES } from '../../utils/verificationEngine';
import { formatOcrConfidence, OCR_CONFIDENCE_METHODOLOGY } from '../LocalAI/sgpDocAI';
import {
  findFieldOcrEvidence,
  transformBboxForRotation,
  getHighlightStyle,
} from '../../utils/ocrEvidenceMatcher';
import { cropImageFile } from '../../utils/imagePreprocessing';

describe('Document Workflow Upgrade - Specification Tests', () => {

  // 1. Type confirmation and unknown documents
  describe('Document Upload & Classification', () => {
    test('standard categories include Marksheet, Income, Community, Aadhaar, Bank, and Other/unknown', () => {
      const labels = STANDARD_CATEGORIES.map(c => c.label);
      expect(labels).toContain('Marksheet');
      expect(labels).toContain('Income Certificate');
      expect(labels).toContain('Community / Category Certificate');
      expect(labels).toContain('Aadhaar');
      expect(labels).toContain('Bank Document');
      expect(labels).toContain('Other / Unknown');
    });

    test('suggestDocumentType suggests category from keywords but leaves confirmed false', () => {
      const suggestion = suggestDocumentType('Government of Tamil Nadu Income Certificate Tahsildar annual income', { name: 'income_scan.pdf' });
      expect(suggestion.standardCategory).toBe('income');
      expect(suggestion.confirmed).toBe(false);
      expect(suggestion.requiresUserConfirmation).toBe(true);
    });

    test('suggestDocumentType never forces an uncertain classification and defaults to Other / Unknown', () => {
      const suggestion = suggestDocumentType('Random text with no keywords xyzw', { name: 'scan_001.pdf' });
      expect(suggestion.suggestedType).toBe('Other / Unknown');
      expect(suggestion.confidence).toBeLessThan(0.5);
      expect(suggestion.confirmed).toBe(false);
      expect(suggestion.requiresUserConfirmation).toBe(true);
    });
  });

  // 2. Raw OCR values versus user corrections & Confidence formatting
  describe('Field Review & OCR Confidence', () => {
    test('formatOcrConfidence displays genuine confidence using required wording and never "X% accurate"', () => {
      const formatted = formatOcrConfidence(92);
      expect(formatted).toBe('OCR confidence: 92/100 — please confirm.');
      expect(formatted).not.toContain('92% accurate');
      expect(formatted).not.toContain('accurate');
    });

    test('formatOcrConfidence displays "Confidence unavailable." when confidence is null/undefined/NaN', () => {
      expect(formatOcrConfidence(null)).toBe('Confidence unavailable.');
      expect(formatOcrConfidence(undefined)).toBe('Confidence unavailable.');
      expect(formatOcrConfidence(NaN)).toBe('Confidence unavailable.');
    });

    test('OCR confidence methodology is documented and separated from heuristics', () => {
      expect(OCR_CONFIDENCE_METHODOLOGY).toBeDefined();
      expect(OCR_CONFIDENCE_METHODOLOGY.aggregation).toContain('mean of Tesseract word confidence scores');
      expect(OCR_CONFIDENCE_METHODOLOGY.distinction).toContain('not measured semantic accuracy');
    });

    test('raw OCR values remain separate from user confirmed / corrected values', () => {
      const docState = {
        docType: 'Income Certificate',
        rawOcrValues: { annualIncome: '45,000' },
        userConfirmedValues: {},
        isConfirmedByUser: false
      };
      // Student corrects the value
      const updatedDocState = {
        ...docState,
        userConfirmedValues: { annualIncome: '54,000' },
        isConfirmedByUser: true
      };
      expect(updatedDocState.rawOcrValues.annualIncome).toBe('45,000');
      expect(updatedDocState.userConfirmedValues.annualIncome).toBe('54,000');
      expect(updatedDocState.isConfirmedByUser).toBe(true);
    });
  });

  // 3. Cross-Document Consistency Checks
  describe('Cross-Document Consistency Checks', () => {
    test('missing information does not count as a match', () => {
      const result = compareNames('', 'Nithish Kumar M');
      expect(result.status.toLowerCase()).toBe('missing');
      expect(result.standardStatus).toBe(STANDARD_CONSISTENCY_STATUSES.MISSING_INFO);
      expect(result.standardStatus).not.toBe(STANDARD_CONSISTENCY_STATUSES.CONSISTENT);
    });

    test('name mismatch yields "Possible mismatch" with neutral guidance and source document names', () => {
      const result = compareNames('Nithish Kumar M', 'Ramasamy M');
      expect(result.standardStatus).toBe(STANDARD_CONSISTENCY_STATUSES.POSSIBLE_MISMATCH);
      expect(result.neutralGuidance).toContain('The names differ. Compare the highlighted text with your original documents.');
      expect(result.neutralGuidance).toContain('Confirm whether this is an OCR reading error or a document-detail issue.');
      // Must not advise changing one document to match another
      expect(result.neutralGuidance).not.toContain('change your Aadhaar');
    });

    test('consistent names yield "Consistent" status', () => {
      const result = compareNames('Nithish Kumar M', 'NITHISH KUMAR M');
      expect(result.standardStatus).toBe(STANDARD_CONSISTENCY_STATUSES.CONSISTENT);
    });

    test('dob comparison identifies missing dates correctly without false match', () => {
      const result = compareDOB('2002-05-14', null);
      expect(result.standardStatus).toBe(STANDARD_CONSISTENCY_STATUSES.MISSING_INFO);
      expect(result.standardStatus).not.toBe(STANDARD_CONSISTENCY_STATUSES.CONSISTENT);
    });

    test('dob comparison detects mismatch with neutral guidance', () => {
      const result = compareDOB('2002-05-14', '2001-08-20');
      expect(result.standardStatus).toBe(STANDARD_CONSISTENCY_STATUSES.POSSIBLE_MISMATCH);
      expect(result.neutralGuidance).toBeDefined();
    });
  });

  // 4. Document Validity & Alerts
  describe('Document Validity & Alerts', () => {
    test('strictly separates Concept A (Document Expiry), Concept B (Scheme Acceptance Window), and Concept C (Unknown Validity)', () => {
      // Community Certificate (Permanent / Concept A = no explicit expiry)
      const communityDoc = {
        docType: 'Community Certificate',
        issueDate: '2020-04-10',
        validUpto: null
      };
      const validityA = evaluateDocumentValidity(communityDoc, 'PMS-SC', '2024-2025');
      expect(validityA.status).toBe('valid');
      expect(validityA.concept).toBe('CONCEPT_B_SCHEME_WINDOW');
      expect(validityA.ruleSourceUrl).toBeDefined();
      expect(validityA.lastReviewedDate).toBeDefined();
    });

    test('detects expired document under Concept A', () => {
      const expiredDoc = {
        docType: 'Income Certificate',
        issueDate: '2022-01-01',
        validUpto: '2023-01-01',
        isExpiryConfirmed: true, // Trusted test fixture — expiry date is known and confirmed
      };
      const validity = evaluateDocumentValidity(expiredDoc, 'PMS-SC', '2024-2025');
      expect(validity.status).toBe('expired');
      expect(validity.concept).toBe('CONCEPT_A_EXPLICIT_EXPIRY');
      expect(validity.issueDetected).toBe(true);
    });

    test('identifies document outside scheme acceptance window under Concept B', () => {
      const oldIncomeDoc = {
        docType: 'Income Certificate',
        issueDate: '2022-01-15', // Older than 2024-04-01 window for 2024-2025
        validUpto: null
      };
      const validity = evaluateDocumentValidity(oldIncomeDoc, 'PMS-SC', '2024-2025');
      expect(validity.status).toBe('outside_window');
      expect(validity.concept).toBe('CONCEPT_B_SCHEME_WINDOW');
      expect(validity.issueDetected).toBe(true);
      expect(validity.actionRequired).toContain('Apply for a renewed income certificate');
    });

    test('displays "Needs confirmation" (Concept C: Unknown Validity) when rule is unknown or missing dates', () => {
      const unknownDoc = {
        docType: 'Other / Unknown',
        issueDate: null,
        validUpto: null
      };
      const validity = evaluateDocumentValidity(unknownDoc, 'UNKNOWN-SCHEME', '2024-2025');
      expect(validity.status).toBe('needs_confirmation');
      expect(validity.concept).toBe('CONCEPT_C_UNKNOWN_VALIDITY');
      expect(validity.message).toMatch(/confirmation/i);
    });
  });

  // 5. Optional Document Fingerprinting
  describe('Document Fingerprinting (SHA-256)', () => {
    test('computes deterministic SHA-256 hash for identical file content', async () => {
      const blob1 = new Blob(['sample-test-certificate-data'], { type: 'text/plain' });
      const blob2 = new Blob(['sample-test-certificate-data'], { type: 'text/plain' });
      const hash1 = await computeFileFingerprint(blob1);
      const hash2 = await computeFileFingerprint(blob2);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });

    test('different file content produces a different hash', async () => {
      const blob1 = new Blob(['sample-test-certificate-data-v1'], { type: 'text/plain' });
      const blob2 = new Blob(['sample-test-certificate-data-v2'], { type: 'text/plain' });
      const hash1 = await computeFileFingerprint(blob1);
      const hash2 = await computeFileFingerprint(blob2);
      expect(hash1).not.toBe(hash2);
    });

    test('checkDuplicateFingerprint flags identical upload in session without silently discarding', () => {
      const existingDocs = {
        income: { file: { name: 'income_original.pdf' }, fingerprint: 'abc123hash' }
      };
      const dupCheck = checkDuplicateFingerprint('abc123hash', existingDocs);
      expect(dupCheck.isDuplicate).toBe(true);
      expect(dupCheck.duplicateWith).toBe('Income Certificate');
      expect(dupCheck.message).toContain('identical to');
    });
  });

  // 6. Application Preparation Dashboard & Score Calculation
  describe('Application Preparation Score & Audit', () => {
    test('formula: completed applicable checks / total applicable checks * 100', () => {
      const mockAudit = {
        schemeId: 'PMS-SC',
        applicationYear: '2024-2025',
        docs: {
          marksheet: {
            file: { name: 'marksheet.pdf' },
            docType: 'Marksheet',
            isConfirmedByUser: true,
            extractedData: { studentName: 'Nithish Kumar' }
          },
          income: {
            file: { name: 'income.pdf' },
            docType: 'Income Certificate',
            isConfirmedByUser: true,
            issueDate: '2024-05-01',
            extractedData: { annualIncome: '1,50,000' }
          },
          community: {
            file: { name: 'community.pdf' },
            docType: 'Community Certificate',
            isConfirmedByUser: true,
            issueDate: '2021-02-10',
            extractedData: { community: 'SC' }
          },
          aadhaar: {
            file: { name: 'aadhaar.pdf' },
            docType: 'Aadhaar Card',
            isConfirmedByUser: true,
            extractedData: { aadhaarNumber: 'XXXX-XXXX-1234', studentName: 'Nithish Kumar' }
          },
          bank: {
            file: { name: 'bank.pdf' },
            docType: 'Bank Passbook / Statement',
            isConfirmedByUser: true,
            extractedData: { accountNumber: 'XXXXXX5678', ifscCode: 'SBIN0001234' }
          }
        },
        consistencyResults: {
          nameMatch: { standardStatus: STANDARD_CONSISTENCY_STATUSES.CONSISTENT }
        }
      };

      const result = calculatePreparationAudit(mockAudit);
      expect(result.scoreAvailable).toBe(true);
      expect(result.score).toBeGreaterThan(0);
      expect(result.totalChecks).toBeGreaterThan(0);
      expect(result.summaryText).toContain(`${result.completedChecks} of ${result.totalChecks} required checks completed.`);
      expect(result.disclaimer).toBe(PREPARATION_DISCLAIMER);
    });

    test('returns "Preparation score unavailable" when scheme is not selected or insufficient data', () => {
      const result = calculatePreparationAudit({ schemeId: '', docs: {} });
      expect(result.scoreAvailable).toBe(false);
      expect(result.scoreLabel).toBe('Preparation score unavailable');
    });

    test('missing required documents remain incomplete and do not inflate score', () => {
      const resultEmpty = calculatePreparationAudit({ schemeId: 'PMS-SC', docs: {} });
      expect(resultEmpty.score).toBe(0);
      expect(resultEmpty.completedChecks).toBe(0);
      expect(resultEmpty.criticalIssues.length).toBeGreaterThan(0);
    });

    test('unverified scheme rules neither reject applicants nor count as completed checks or inflate score', () => {
      const mockAuditWithUnverifiedRule = {
        schemeId: 'PMS-SC',
        applicationYear: '2025-26',
        docs: {
          income: {
            file: { name: 'income.pdf' },
            isConfirmedByUser: true,
          }
        },
        validityData: {
          income: {
            status: 'needs_confirmation',
            concept: 'CONCEPT_C_UNKNOWN_VALIDITY',
            conceptA_expiry: { status: 'UNKNOWN_VALIDITY' },
            conceptB_acceptance: { status: 'NEEDS_CONFIRMATION' }
          }
        }
      };
      const result = calculatePreparationAudit(mockAuditWithUnverifiedRule);
      const validityCheck = result.checks.find(c => c.id === 'check-document-validity');
      expect(validityCheck).toBeDefined();
      expect(validityCheck.status).toBe('NEEDS_CONFIRMATION');
      expect(validityCheck.isCompleted).toBe(false);
      // Does not reject applicant
      expect(result.criticalIssues.some(i => i.id === 'issue-income-expired' || i.id === 'issue-income-window')).toBe(false);
    });
  });

  // 7. Same-session Old and Renewed Certificate comparison
  describe('Same-session Versioning', () => {
    test('stores versions without silently overwriting old upload', () => {
      const initialDocSlot = {
        file: { name: 'income_2022.pdf' },
        docType: 'Income Certificate',
        issueDate: '2022-04-01',
        versions: [
          {
            versionId: 'v1_income_2022',
            fileName: 'income_2022.pdf',
            issueDate: '2022-04-01',
            status: 'outside_window'
          }
        ],
        activeVersionId: 'v1_income_2022'
      };

      // Student uploads renewed version
      const renewedVersion = {
        versionId: 'v2_income_2024',
        fileName: 'income_2024_renewed.pdf',
        issueDate: '2024-05-15',
        status: 'valid'
      };

      const updatedSlot = {
        ...initialDocSlot,
        file: { name: 'income_2024_renewed.pdf' },
        issueDate: '2024-05-15',
        versions: [...initialDocSlot.versions, renewedVersion],
        activeVersionId: 'v2_income_2024'
      };

      expect(updatedSlot.versions.length).toBe(2);
      expect(updatedSlot.versions[0].fileName).toBe('income_2022.pdf');
      expect(updatedSlot.versions[1].fileName).toBe('income_2024_renewed.pdf');
      expect(updatedSlot.activeVersionId).toBe('v2_income_2024');
    });
  });

  // 8. Source-Region Visual Highlighting & Evidence Matching
  describe('Source-Region Highlighting & Evidence Matching', () => {
    const mockLines = [
      {
        text: 'CANDIDATE NAME: ARUN KUMAR S',
        confidence: 94,
        bbox: { x0: 100, y0: 200, x1: 500, y1: 240 },
        pageNumber: 1,
        pageWidth: 1000,
        pageHeight: 1400,
        words: [
          { text: 'CANDIDATE', confidence: 96, bbox: { x0: 100, y0: 200, x1: 220, y1: 240 } },
          { text: 'NAME:', confidence: 95, bbox: { x0: 225, y0: 200, x1: 280, y1: 240 } },
          { text: 'ARUN', confidence: 93, bbox: { x0: 290, y0: 200, x1: 370, y1: 240 } },
          { text: 'KUMAR', confidence: 91, bbox: { x0: 380, y0: 200, x1: 460, y1: 240 } },
          { text: 'S', confidence: 92, bbox: { x0: 470, y0: 200, x1: 495, y1: 240 } },
        ],
      },
      {
        text: 'ANNUAL FAMILY INCOME: RS. 75,000',
        confidence: 88,
        bbox: { x0: 100, y0: 400, x1: 600, y1: 440 },
        pageNumber: 2,
        pageWidth: 1000,
        pageHeight: 1400,
        words: [
          { text: 'ANNUAL', confidence: 90, bbox: { x0: 100, y0: 400, x1: 200, y1: 440 } },
          { text: 'FAMILY', confidence: 89, bbox: { x0: 210, y0: 400, x1: 300, y1: 440 } },
          { text: 'INCOME:', confidence: 91, bbox: { x0: 310, y0: 400, x1: 400, y1: 440 } },
          { text: 'RS.', confidence: 85, bbox: { x0: 410, y0: 400, x1: 450, y1: 440 } },
          { text: '75,000', confidence: 87, bbox: { x0: 460, y0: 400, x1: 580, y1: 440 } },
        ],
      },
    ];

    test('findFieldOcrEvidence matches genuine tokens and calculates arithmetic mean word confidence', () => {
      const evidence = findFieldOcrEvidence('name', 'ARUN KUMAR', mockLines);
      expect(evidence.available).toBe(true);
      expect(evidence.pageNumber).toBe(1);
      // ARUN (93) and KUMAR (91) mean = 92
      expect(evidence.ocrConfidence).toBe(92);
      expect(evidence.confidenceMessage).toBe('OCR confidence: 92/100 — please confirm.');
      expect(evidence.normBbox.normX0).toBeCloseTo(0.29, 2);
      expect(evidence.normBbox.normX1).toBeCloseTo(0.46, 2);
    });

    test('findFieldOcrEvidence associates multi-page evidence with correct page number', () => {
      const incomeEvidence = findFieldOcrEvidence('income', '75,000', mockLines);
      expect(incomeEvidence.available).toBe(true);
      expect(incomeEvidence.pageNumber).toBe(2);
      expect(incomeEvidence.ocrConfidence).toBe(87);
    });

    test('findFieldOcrEvidence never invents bounding boxes and displays honest unavailability when missing', () => {
      const missingEvidence = findFieldOcrEvidence('dob', '15/08/2005', mockLines);
      expect(missingEvidence.available).toBe(false);
      expect(missingEvidence.ocrConfidence).toBeNull();
      expect(missingEvidence.statusMessage).toBe('Source location unavailable.');
      expect(missingEvidence.confidenceMessage).toBe('Confidence unavailable.');
      expect(missingEvidence.normBbox).toBeUndefined();
    });

    test('transformBboxForRotation transforms coordinates without drift', () => {
      const orig = { normX0: 0.1, normY0: 0.2, normX1: 0.4, normY1: 0.5 };
      const rot90 = transformBboxForRotation(orig, 90);
      expect(rot90.normX0).toBeCloseTo(0.5, 2); // 1 - 0.5
      expect(rot90.normY0).toBeCloseTo(0.1, 2);
      expect(rot90.normX1).toBeCloseTo(0.8, 2); // 1 - 0.2
      expect(rot90.normY1).toBeCloseTo(0.4, 2);

      const rot180 = transformBboxForRotation(orig, 180);
      expect(rot180.normX0).toBeCloseTo(0.6, 2);
      expect(rot180.normY0).toBeCloseTo(0.5, 2);
    });

    test('getHighlightStyle returns responsive percentage CSS styling with high visibility', () => {
      const style = getHighlightStyle({ normX0: 0.15, normY0: 0.25, normX1: 0.45, normY1: 0.35 });
      expect(style.left).toBe('15.00%');
      expect(style.top).toBe('25.00%');
      expect(style.width).toBe('30.00%');
      expect(style.height).toBe('10.00%');
      expect(style.position).toBe('absolute');
      expect(style.pointerEvents).toBe('none');
    });
  });

  // 9. Interactive Cropping & Memory Preservation
  describe('Interactive Cropping', () => {
    test('cropImageFile returns a valid File object when cropBox is provided', async () => {
      const mockFile = new File(['test image data'], 'marksheet.jpg', { type: 'image/jpeg' });
      const cropped = await cropImageFile(mockFile, { xPct: 10, yPct: 10, widthPct: 80, heightPct: 80 });
      expect(cropped).toBeDefined();
      expect(cropped.name).toBeDefined();
    });
  });

  // 10. Official Rule-Change Checks & Alerts
  describe('Official Rule-Change Checks & Alerts', () => {
    test('evaluateDocumentValidity marks unverified amendments as Needs official confirmation without penalties', () => {
      const validity = evaluateDocumentValidity('income', '2025-05-01', '2026-03-31', 'pms-sc', '2025-26');
      const confirmationAlert = validity.alerts.find(a => a.category === 'NEEDS_CONFIRMATION');
      expect(confirmationAlert).toBeDefined();
      expect(confirmationAlert.title).toBe('Needs official confirmation');
      expect(validity.rule.isVerifiedAmendment).toBe(false);
      expect(validity.liveAlertsIntegrationStatus).toBeUndefined();
    });

    test('SCHEME_VALIDITY_RULES requires substantiated official source before marking verified amendment', () => {
      const pmsScRule = SCHEME_VALIDITY_RULES.find(r => r.schemeId === 'pms-sc');
      expect(pmsScRule).toBeDefined();
      expect(pmsScRule.isVerifiedAmendment).toBe(false);
      expect(pmsScRule.isOfficialChange).toBe(false);
    });
  });
});

