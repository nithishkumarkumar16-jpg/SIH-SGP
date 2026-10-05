import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import LanguageSelector from "../LanguageSelector/LanguageSelector";
import "./EligibilityEngine.css";
import { scholarships } from "../../knowledge/scholarships";
import { evaluateAllScholarships } from "../../engine/eligibilityEngine";
import { buildUnifiedProfile } from "../../adapters/profileAdapter";

function getDisplayAmount(scheme, course) {
  if (!scheme) return "Financial support";
  if (scheme.amountNote) return scheme.amountNote;
  if (scheme.awardAmount) return typeof scheme.awardAmount === "number" ? `₹${scheme.awardAmount.toLocaleString("en-IN")}/yr` : String(scheme.awardAmount);
  if (scheme.amount) return typeof scheme.amount === "number" ? `₹${scheme.amount.toLocaleString("en-IN")}/yr` : String(scheme.amount);
  if (scheme.amountType === "tiered") {
    const ug = scheme.amountUG != null ? `₹${Number(scheme.amountUG).toLocaleString("en-IN")}/yr` : "UG support";
    const pg = scheme.amountPG != null ? `₹${Number(scheme.amountPG).toLocaleString("en-IN")}/yr` : "PG support";
    return course === "pg" ? pg : ug;
  }
  if (scheme.amountType === "fixed") return "₹2,000–₹2,250/mo";
  if (scheme.amountType === "full") return "Full tuition / maintenance support";
  if (scheme.amountMin != null && scheme.amountMax != null) {
    return `₹${Number(scheme.amountMin).toLocaleString("en-IN")}–₹${Number(scheme.amountMax).toLocaleString("en-IN")}/yr`;
  }
  if (scheme.amountMin != null) return `From ₹${Number(scheme.amountMin).toLocaleString("en-IN")}/yr`;
  if (scheme.amountMax != null) return `Up to ₹${Number(scheme.amountMax).toLocaleString("en-IN")}/yr`;
  return "Eligible award benefit";
}
const COURSE_OPTIONS = [
  { label: "UG", value: "ug" }, { label: "PG", value: "pg" },
  { label: "Diploma", value: "diploma" }, { label: "ITI", value: "iti" },
  { label: "Ph.D", value: "phd" },
];
const YEAR_OPTIONS = ["1st", "2nd", "3rd", "4th"];

function EligibilityEngine({
  initialProfile = null,
  fieldMetadata = null,
  conflictWarnings = [],
  ds = {},
  matrixData = null,
  applicationYear = "2025-26",
  onBackToStep3 = null,
  onReadScholarshipDetails = null,
  isEmbedded = false,
}) {
  const navigate = useNavigate();
  const [isExiting, setIsExiting] = useState(false);
  const [activeTab, setActiveTab] = useState("potential"); // "potential" | "needs_info" | "not_matched"
  const [expandedSchemeId, setExpandedSchemeId] = useState(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);

  const [form, setForm] = useState(() => ({
    name: initialProfile?.name || "",
    community: initialProfile?.community || "",
    income: initialProfile?.income !== undefined && initialProfile?.income !== null ? String(initialProfile.income) : "",
    course: initialProfile?.course || "",
    currentYear: initialProfile?.currentYear || "",
    domicileState: initialProfile?.state || "",
    armedForces: initialProfile?.armedForces || "no",
    incomeApplicant: initialProfile?.incomeApplicant || "student",
    quotaType: initialProfile?.quotaType || "government",
    firstGraduate: initialProfile?.firstGraduate !== undefined ? initialProfile.firstGraduate : null,
    marks10: initialProfile?.marks10 || "",
    marks12: initialProfile?.marks12 || "",
    dob: initialProfile?.dob || "",
  }));

  const [evaluationResults, setEvaluationResults]   = useState([]);

  // Live calculation function: executes evaluateAllScholarships
  const executeEvaluation = (currentForm) => {
    const rawInc = currentForm.income && !isNaN(currentForm.income) ? parseInt(currentForm.income, 10) : undefined;
    const unifiedProf = buildUnifiedProfile({
      name: currentForm.name,
      studentName: currentForm.name,
      parentName: initialProfile?.parentName,
      community: currentForm.community,
      category: currentForm.community,
      income: rawInc,
      course: currentForm.course === "ug" ? "Engineering" : currentForm.course === "diploma" ? "Diploma" : currentForm.course,
      level: currentForm.course,
      currentYear: currentForm.currentYear,
      armedForces: currentForm.armedForces,
      district: undefined, // Never infer domicile from document issuer
      state: currentForm.domicileState === "Tamil Nadu" ? "Tamil Nadu" : currentForm.domicileState === "Other" ? "Other State" : undefined,
      marks10: currentForm.marks10 ? parseFloat(currentForm.marks10) : initialProfile?.marks10,
      marks12: currentForm.marks12 ? parseFloat(currentForm.marks12) : initialProfile?.marks12,
      incomeApplicant: currentForm.incomeApplicant,
      quotaType: currentForm.quotaType,
      firstGraduate: currentForm.firstGraduate,
    });

    const evals = evaluateAllScholarships(scholarships, unifiedProf);
    setEvaluationResults(evals);
  };

  // Sync with initialProfile when props change
  useEffect(() => {
    if (initialProfile) {
      setForm(prev => {
        const next = {
          name: initialProfile.name || prev.name || "",
          community: initialProfile.community || prev.community || "",
          income: (initialProfile.income !== undefined && initialProfile.income !== null && initialProfile.income !== "")
            ? String(initialProfile.income)
            : prev.income || "",
          course: prev.course || initialProfile.course || "",
          currentYear: prev.currentYear || initialProfile.currentYear || "",
          domicileState: prev.domicileState || initialProfile.state || "",
          armedForces: prev.armedForces || initialProfile.armedForces || "no",
          incomeApplicant: initialProfile.incomeApplicant || prev.incomeApplicant || "student",
          quotaType: initialProfile.quotaType || prev.quotaType || "government",
          firstGraduate: initialProfile.firstGraduate !== undefined ? initialProfile.firstGraduate : prev.firstGraduate,
          marks10: initialProfile.marks10 || prev.marks10 || "",
          marks12: initialProfile.marks12 || prev.marks12 || "",
          dob: initialProfile.dob || prev.dob || "",
        };
        executeEvaluation(next);
        return next;
      });
    } else {
      executeEvaluation(form);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProfile]);

  // Live update evaluation whenever form changes in embedded mode
  const updateFormField = (field, value) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      executeEvaluation(next);
      return next;
    });
  };

  const handleNavigation = (path) => { setIsExiting(true); setTimeout(() => navigate(path), 500); };

  // Group evaluation results into 3 distinct categories:
  const potentialMatches = evaluationResults.filter(
    r => r.status === "CONFIRMED MATCH" || r.status === "POTENTIAL MATCH" || r.isEligible
  );
  const needsMoreInfo = evaluationResults.filter(
    r => r.status === "NEEDS MORE INFORMATION" || r.status === "NEEDS_INFO"
  );
  const notMatched = evaluationResults.filter(
    r => r.status === "NOT MATCHED" || r.status === "FAILED"
  );

  const displayedList = activeTab === "potential"
    ? potentialMatches
    : activeTab === "needs_info"
      ? needsMoreInfo
      : notMatched;

  // Helper to cross-check document presence for a scheme checklist
  const getDocumentCheckStatus = (docRequirementName = "") => {
    const req = docRequirementName.toLowerCase();
    if (req.includes("income")) {
      if (ds.income?.file && ds.income?.data) {
        return ds.income.confirmedFields?.validUpto || ds.income.confirmedFields?.income
          ? { label: "✓ Uploaded & Confirmed", cls: "status-tag-confirmed" }
          : { label: "⏳ Needs Confirmation", cls: "status-tag-review" };
      }
      return { label: "⚠️ Missing / Required", cls: "status-tag-missing" };
    }
    if (req.includes("community") || req.includes("caste")) {
      if (ds.community?.file && ds.community?.data) {
        return ds.community.confirmedFields?.name || ds.community.confirmedFields?.communityCategory
          ? { label: "✓ Uploaded & Confirmed", cls: "status-tag-confirmed" }
          : { label: "⏳ Needs Confirmation", cls: "status-tag-review" };
      }
      return { label: "⚠️ Missing / Required", cls: "status-tag-missing" };
    }
    if (req.includes("10th") || req.includes("secondary")) {
      if (ds.ms10?.file && ds.ms10?.data) {
        return ds.ms10.confirmedFields?.name
          ? { label: "✓ Uploaded & Confirmed", cls: "status-tag-confirmed" }
          : { label: "⏳ Needs Confirmation", cls: "status-tag-review" };
      }
      return { label: "Not checked — document missing", cls: "status-tag-missing" };
    }
    if (req.includes("12th") || req.includes("higher secondary") || req.includes("hsc")) {
      if (ds.ms12?.file && ds.ms12?.data) {
        return ds.ms12.confirmedFields?.name
          ? { label: "✓ Uploaded & Confirmed", cls: "status-tag-confirmed" }
          : { label: "⏳ Needs Confirmation", cls: "status-tag-review" };
      }
      return { label: "Not checked — document missing", cls: "status-tag-missing" };
    }
    if (req.includes("aadhaar") || req.includes("identity")) {
      if (ds.aadhaar?.file && ds.aadhaar?.data) {
        return { label: "✓ Uploaded & Confirmed", cls: "status-tag-confirmed" };
      }
      return { label: "Not checked — document missing", cls: "status-tag-missing" };
    }
    if (req.includes("bank") || req.includes("passbook")) {
      if (ds.bankpass?.file && ds.bankpass?.data) {
        return matrixData?.bankAccType === "Single"
          ? { label: "✓ Single Account Confirmed", cls: "status-tag-confirmed" }
          : { label: "⏳ Account Review Required", cls: "status-tag-review" };
      }
      return { label: "Not checked — document missing", cls: "status-tag-missing" };
    }
    return { label: "ℹ️ Standard Requirement", cls: "status-tag-review" };
  };

  return (
    <div className={`eligibility-page ${isEmbedded ? "is-embedded-step" : (isExiting ? "is-exiting-down" : "is-entering-up")}`}>

      {/* BG Animations — only when standalone */}
      {!isEmbedded && (
        <div className="dashboard-bg-animations">
          <div className="out-shape out-blob blob-1"></div>
          <div className="out-shape out-blob blob-2"></div>
          <div className="out-shape out-ring ring-out-1"></div>
          <div className="out-shape out-ring ring-out-2"></div>
          <div className="out-shape out-cross cross-out-1">+</div>
          <div className="out-shape out-dot dot-out-1"></div>
        </div>
      )}

      {/* HEADER — only when standalone */}
      {!isEmbedded && (
        <header className="pro-header">
          <div className="header-container">
            <div className="header-brand">
              <div className="brand-icon">🎯</div>
              <div className="brand-text">
                <h1>Find Matching Scholarships</h1>
                <p>Multi-Criteria Scholarship Eligibility &amp; Matching Engine</p>
              </div>
            </div>
            <div className="header-actions">
              <button className="btn-pro-back" onClick={() => handleNavigation("/dashboard")}>
                Back To Dashboard
              </button>
              <LanguageSelector />
            </div>
          </div>
        </header>
      )}

      <main className={`eligibility-container ${isEmbedded ? "is-embedded-container" : ""}`} style={isEmbedded ? { maxWidth: "100%", padding: "4px 0" } : {}}>

        {/* ── TOP DISCLAIMER BANNER ── */}
        <div className="top-disc-banner" style={{ marginBottom: "16px" }}>
          <div className="tdb-left">
            <span className="tdb-warn-icon">ℹ️</span>
            <div>
              <p className="tdb-heading" style={{ fontSize: "13px", fontWeight: 800 }}>
                Automatic Statutory Scheme Matching
              </p>
              <p className="tdb-sub" style={{ fontSize: "11.5px", marginTop: "2px", lineHeight: 1.45 }}>
                These results are based on the details you confirmed and the available scheme rules. Final eligibility and selection are decided by the scholarship provider.
              </p>
            </div>
          </div>
          <div className="tdb-chips">
            <span className="tdb-chip chip-orange">📋 {scholarships.length} Maintained Schemes</span>
            <span className="tdb-chip chip-blue">🌐 NSP Central Schemes</span>
            <span className="tdb-chip chip-purple">🏛️ UMIS State Schemes</span>
          </div>
        </div>

        {/* Self-reported matches notice banner */}
        {isEmbedded && matrixData?.uploadedDocCount < 2 && (
          <div style={{
            background: "#f8fafc",
            border: "1.5px solid #cbd5e1",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "16px",
            fontSize: "12px",
            color: "#334155",
            display: "flex",
            alignItems: "flex-start",
            gap: "10px"
          }}>
            <span style={{ fontSize: "16px" }}>ℹ️</span>
            <div>
              <strong>Self-Reported Detail Matching Notice:</strong> Potential scholarship matches below are calculated from your confirmed self-reported details and uploaded documents. These matches do not imply document verification for absent documents (e.g. Aadhaar, Bank Passbook, Marksheets). Document consistency checks for absent documents remain "Not checked — document missing".
            </div>
          </div>
        )}

        {/* Document Conflict Warnings (if any) */}
        {conflictWarnings && conflictWarnings.length > 0 && (
          <div className="conflict-warnings-box" style={{ marginBottom: "16px" }}>
            {conflictWarnings.map((w, idx) => (
              <div key={idx} style={{
                background: w.type === "danger" ? "#fef2f2" : "#fffbeb",
                border: `1.5px solid ${w.type === "danger" ? "#fca5a5" : "#fde68a"}`,
                borderRadius: "10px",
                padding: "10px 14px",
                marginBottom: "6px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontSize: "12px",
                color: w.type === "danger" ? "#991b1b" : "#92400e"
              }}>
                <span style={{ fontSize: "16px" }}>{w.type === "danger" ? "⚠️" : "ℹ️"}</span>
                <div>
                  <strong>{w.type === "danger" ? "Document Conflict Notice:" : "Verification Note:"}</strong> {w.message}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══════════ SECTION 1: CONFIRMED DETAILS SUMMARY WITH DATA SOURCES ══════════ */}
        <div className="confirmed-summary-box" style={{
          background: "#ffffff",
          border: "1.5px solid #e2e8f0",
          borderRadius: "12px",
          padding: "16px 18px",
          marginBottom: "16px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.02)"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <h3 style={{ fontSize: "13.5px", fontWeight: 800, color: "#0f172a", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                <span>📋</span> Confirmed Document Details &amp; Sources
              </h3>
              <p style={{ fontSize: "11px", color: "#64748b", margin: "2px 0 0 0" }}>
                Details extracted from uploaded documents and confirmed by you.
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {onReadScholarshipDetails && (
                <button
                  type="button"
                  onClick={onReadScholarshipDetails}
                  style={{
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    border: "1px solid #bfdbfe",
                    borderRadius: "6px",
                    padding: "4px 10px",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                  title="Re-read scholarship criteria from uploaded documents without reprocessing"
                >
                  🔍 Read from Documents
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowProfileEditor(p => !p)}
                style={{
                  background: showProfileEditor ? "#f1f5f9" : "#6d28d9",
                  color: showProfileEditor ? "#334155" : "#ffffff",
                  border: showProfileEditor ? "1px solid #cbd5e1" : "none",
                  borderRadius: "6px",
                  padding: "4px 12px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                {showProfileEditor ? "▲ Hide Profile Editor" : "✏️ Complete / Edit Profile"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
            {/* Student Name */}
            <div style={{ background: "#f8fafc", padding: "8px 12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Student Name</div>
              <div style={{ fontSize: "12.5px", fontWeight: 800, color: "#0f172a", marginTop: "2px" }}>{form.name || "—"}</div>
              <div style={{ fontSize: "9.5px", color: form.name ? "#059669" : "#dc2626", marginTop: "3px", fontWeight: 700 }}>
                {form.name ? `✓ ${fieldMetadata?.name?.source || "Confirmed identity"}` : "Missing name"}
              </div>
            </div>

            {/* Community Category */}
            <div style={{ background: "#f8fafc", padding: "8px 12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Community / Category</div>
              <div style={{ fontSize: "12.5px", fontWeight: 800, color: "#0f172a", marginTop: "2px" }}>{form.community || "—"}</div>
              <div style={{ fontSize: "9.5px", color: form.community ? "#059669" : "#b45309", marginTop: "3px", fontWeight: 700 }}>
                {form.community ? `✓ ${fieldMetadata?.community?.source || "Confirmed Category"}` : "Needs entry"}
              </div>
            </div>

            {/* Family Income */}
            <div style={{ background: "#f8fafc", padding: "8px 12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Annual Family Income</div>
              <div style={{ fontSize: "12.5px", fontWeight: 800, color: "#0f172a", marginTop: "2px" }}>
                {form.income ? `₹${parseInt(form.income, 10).toLocaleString("en-IN")}` : "—"}
              </div>
              <div style={{ fontSize: "9.5px", color: form.income ? "#059669" : "#b45309", marginTop: "3px", fontWeight: 700 }}>
                {form.income ? `✓ ${fieldMetadata?.income?.source || "Confirmed Income"}` : "Needs manual entry"}
              </div>
            </div>

            {/* Marks */}
            <div style={{ background: "#f8fafc", padding: "8px 12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Academic Marks</div>
              <div style={{ fontSize: "12.5px", fontWeight: 800, color: "#0f172a", marginTop: "2px" }}>
                {form.marks10 || form.marks12 ? `10th: ${form.marks10 || "—"}% | 12th: ${form.marks12 || "—"}%` : "Not provided"}
              </div>
              <div style={{ fontSize: "9.5px", color: form.marks10 || form.marks12 ? "#059669" : "#64748b", marginTop: "3px", fontWeight: 700 }}>
                {form.marks10 || form.marks12 ? "✓ Extracted from marksheet" : "Optional for general schemes"}
              </div>
            </div>

            {/* Course & Study Year */}
            <div style={{ background: form.course ? "#f8fafc" : "#fffbeb", padding: "8px 12px", borderRadius: "8px", border: `1px solid ${form.course ? "#e2e8f0" : "#fde68a"}` }}>
              <div style={{ fontSize: "10px", color: form.course ? "#64748b" : "#92400e", fontWeight: 700, textTransform: "uppercase" }}>Course &amp; Year</div>
              <div style={{ fontSize: "12.5px", fontWeight: 800, color: form.course ? "#0f172a" : "#b45309", marginTop: "2px" }}>
                {form.course ? `${form.course.toUpperCase()} (${form.currentYear || "Year not set"})` : "Select below"}
              </div>
              <div style={{ fontSize: "9.5px", color: form.course ? "#059669" : "#b45309", marginTop: "3px", fontWeight: 700 }}>
                {form.course ? "✓ Entered by student" : "→ Complete profile below"}
              </div>
            </div>
          </div>
        </div>

        {/* ══════════ SECTION 2: COMPACT COMPLETE YOUR PROFILE FORM ══════════ */}
        {(showProfileEditor || !isEmbedded || !form.course || !form.currentYear) && (
          <div className="compact-profile-form" style={{
            background: "#ffffff",
            border: "1.5px solid #cbd5e1",
            borderRadius: "12px",
            padding: "16px 20px",
            marginBottom: "20px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.03)"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px" }}>
              <div>
                <h3 style={{ fontSize: "13.5px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
                  ✏️ Complete Your Profile for Matching
                </h3>
                <p style={{ fontSize: "11px", color: "#64748b", margin: "2px 0 0 0" }}>
                  Only required criteria are requested. We never infer domicile solely from issuing authority.
                </p>
              </div>
              {isEmbedded && (
                <button
                  type="button"
                  onClick={() => setShowProfileEditor(false)}
                  style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "12px", cursor: "pointer", fontWeight: 700 }}
                >
                  ✕ Close
                </button>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
              {/* Course Level */}
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: "#475569", display: "block", marginBottom: "4px" }}>
                  Course Level <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <div className="pill-group" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {COURSE_OPTIONS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`pill-btn ${form.course === c.value ? "pill-active" : ""}`}
                      onClick={() => updateFormField("course", c.value)}
                      style={{ padding: "5px 10px", fontSize: "11px" }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Current Year */}
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: "#475569", display: "block", marginBottom: "4px" }}>
                  Current Year of Study <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <div className="pill-group" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {YEAR_OPTIONS.map(y => (
                    <button
                      key={y}
                      type="button"
                      className={`pill-btn ${form.currentYear === y ? "pill-active" : ""}`}
                      onClick={() => updateFormField("currentYear", y)}
                      style={{ padding: "5px 10px", fontSize: "11px" }}
                    >
                      {y} Year
                    </button>
                  ))}
                </div>
              </div>

              {/* Domicile State (Never inferred from document issuer!) */}
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: "#475569", display: "block", marginBottom: "4px" }}>
                  Domicile State (Student Home State)
                </label>
                <select
                  value={form.domicileState}
                  onChange={e => updateFormField("domicileState", e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1.5px solid #cbd5e1", fontSize: "12px", fontWeight: 600, background: "#fff" }}
                >
                  <option value="">Select Domicile State...</option>
                  <option value="Tamil Nadu">Tamil Nadu (Resident)</option>
                  <option value="Other">Other State / UT</option>
                  <option value="Not sure">Not sure</option>
                </select>
              </div>

              {/* Admission Quota */}
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: "#475569", display: "block", marginBottom: "4px" }}>
                  Admission Quota (For BC/MBC/State Schemes)
                </label>
                <div className="pill-group" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={`pill-btn ${form.quotaType === "government" ? "pill-active" : ""}`}
                    onClick={() => updateFormField("quotaType", "government")}
                    style={{ padding: "5px 10px", fontSize: "11px" }}
                  >
                    Govt Quota
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${form.quotaType === "management" ? "pill-active" : ""}`}
                    onClick={() => updateFormField("quotaType", "management")}
                    style={{ padding: "5px 10px", fontSize: "11px" }}
                  >
                    Management
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${form.quotaType === "unknown" ? "pill-active" : ""}`}
                    onClick={() => updateFormField("quotaType", "unknown")}
                    style={{ padding: "5px 10px", fontSize: "11px" }}
                  >
                    Not sure
                  </button>
                </div>
              </div>

              {/* First Graduate in Family */}
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: "#475569", display: "block", marginBottom: "4px" }}>
                  First Graduate in Family?
                </label>
                <div className="pill-group" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={`pill-btn ${form.firstGraduate === true ? "pill-active" : ""}`}
                    onClick={() => updateFormField("firstGraduate", true)}
                    style={{ padding: "5px 10px", fontSize: "11px" }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${form.firstGraduate === false ? "pill-active" : ""}`}
                    onClick={() => updateFormField("firstGraduate", false)}
                    style={{ padding: "5px 10px", fontSize: "11px" }}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${form.firstGraduate === null ? "pill-active" : ""}`}
                    onClick={() => updateFormField("firstGraduate", null)}
                    style={{ padding: "5px 10px", fontSize: "11px" }}
                  >
                    Not sure
                  </button>
                </div>
              </div>

              {/* Community Category */}
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: "#475569", display: "block", marginBottom: "4px" }}>
                  Community / Social Category
                </label>
                <select
                  value={form.community}
                  onChange={e => updateFormField("community", e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1.5px solid #cbd5e1", fontSize: "12px", fontWeight: 600, background: "#fff" }}
                >
                  <option value="">Select Category...</option>
                  <option value="SC">Scheduled Caste (SC)</option>
                  <option value="ST">Scheduled Tribe (ST)</option>
                  <option value="MBC">Most Backward Class (MBC)</option>
                  <option value="BC">Backward Class (BC)</option>
                  <option value="OBC">Other Backward Class (OBC)</option>
                  <option value="General">General (OC)</option>
                  <option value="Minority">Minority</option>
                </select>
              </div>

              {/* Annual Family Income */}
              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: "#475569", display: "block", marginBottom: "4px" }}>
                  Annual Family Income (₹)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 150000"
                  value={form.income}
                  onChange={e => updateFormField("income", e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1.5px solid #cbd5e1", fontSize: "12px", fontWeight: 600 }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ══════════ SECTION 3: AUTOMATIC MATCHING TABS & RESULTS ══════════ */}
        <div className="elig-tabs-container">
          <button
            type="button"
            className={`elig-tab-btn tab-potential ${activeTab === "potential" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("potential")}
          >
            <span>🎯 Potential Matches</span>
            <span className="tab-badge">{potentialMatches.length}</span>
          </button>
          <button
            type="button"
            className={`elig-tab-btn tab-needs-info ${activeTab === "needs_info" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("needs_info")}
          >
            <span>ℹ️ More Information Needed</span>
            <span className="tab-badge">{needsMoreInfo.length}</span>
          </button>
          <button
            type="button"
            className={`elig-tab-btn tab-unmatched ${activeTab === "not_matched" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("not_matched")}
          >
            <span>❌ Criteria Not Met</span>
            <span className="tab-badge">{notMatched.length}</span>
          </button>
        </div>

        {/* List of Schemes in Current Tab */}
        {displayedList.length > 0 ? (
          <div className="scholarships-section" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {displayedList.map(evalItem => {
              const scheme = evalItem.scholarship;
              const isMatch = evalItem.matchType === "CONFIRMED MATCH" || evalItem.isEligible;
              const isPotential = evalItem.matchType === "POTENTIAL MATCH";
              const isNeedsInfo = evalItem.matchType === "NEEDS MORE INFORMATION" || evalItem.matchType === "NEEDS_INFO";
              const isExpanded = expandedSchemeId === scheme.id;
              const schemeColor = scheme.color || (isMatch ? "#16a34a" : isPotential ? "#d97706" : isNeedsInfo ? "#2563eb" : "#94a3b8");

              return (
                <div
                  key={scheme.id}
                  className="scheme-result-card"
                  style={{
                    borderLeftColor: schemeColor,
                    background: "#ffffff",
                    border: "1.5px solid #e2e8f0",
                    borderLeftWidth: "6px",
                    borderRadius: "12px",
                    overflow: "hidden",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.03)"
                  }}
                >
                  <div className="src-header" style={{ background: schemeColor + "0c", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div className="src-icon" style={{ background: schemeColor + "20", color: schemeColor, width: "36px", height: "36px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>
                        {scheme.icon || "🎓"}
                      </div>
                      <div>
                        <h3 style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a", margin: 0 }}>{scheme.name}</h3>
                        <p style={{ fontSize: "11px", color: "#64748b", margin: "2px 0 0 0" }}>{scheme.provider}</p>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      <span className="badge-portal" style={{ background: "#f1f5f9", color: "#334155", padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700 }}>
                        {scheme.portal || "NSP"}
                      </span>
                      <span style={{
                        padding: "3px 10px",
                        borderRadius: "20px",
                        fontSize: "11px",
                        fontWeight: 800,
                        background: isMatch ? "#dcfce7" : isPotential ? "#fef3c7" : isNeedsInfo ? "#eff6ff" : "#fee2e2",
                        color: isMatch ? "#166534" : isPotential ? "#92400e" : isNeedsInfo ? "#1e40af" : "#991b1b",
                        border: `1px solid ${isMatch ? "#86efac" : isPotential ? "#fde68a" : isNeedsInfo ? "#bfdbfe" : "#fca5a5"}`
                      }}>
                        {isMatch ? "✅ Confirmed Match" : isPotential ? "⚡ Potential Match" : isNeedsInfo ? "ℹ️ More Information Needed" : "❌ Criteria Not Met"}
                      </span>
                    </div>
                  </div>

                  {/* Summary & Benefit Note */}
                  <div style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", fontSize: "12px" }}>
                    <div>
                      <span style={{ color: "#64748b", fontWeight: 600 }}>Scheme Data Reviewed: </span>
                      <strong style={{ color: "#0f172a" }}>{applicationYear || "2025-26"}</strong>
                      <span style={{ margin: "0 4px", color: "#cbd5e1" }}>•</span>
                      <span style={{ fontSize: "10.5px", color: "#92400e", fontWeight: 600 }}
                        title="Scheme rules were reviewed for this year. Verify the portal is currently accepting applications before applying.">
                        ⚠️ Verify portal is open for current year
                      </span>
                      <span style={{ margin: "0 8px", color: "#cbd5e1" }}>•</span>
                      <span style={{ color: "#64748b", fontWeight: 600 }}>Benefit: </span>
                      <strong style={{ color: "#166534" }}>{scheme.amountNote || getDisplayAmount(scheme, form.course)}</strong>
                    </div>

                    {scheme.officialUrl && (
                      <a
                        href={scheme.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "11px", color: "#2563eb", fontWeight: 700, textDecoration: "none" }}
                      >
                        Official Portal Guidelines ↗
                      </a>
                    )}
                  </div>

                  {/* Why it matches */}
                  {evalItem.passedCriteria && evalItem.passedCriteria.length > 0 && (
                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", margin: "10px 18px 0 18px", padding: "8px 12px", fontSize: "11.5px" }}>
                      <strong style={{ color: "#166534", display: "block", marginBottom: "4px" }}>Why it potentially matches:</strong>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", color: "#15803d" }}>
                        {evalItem.passedCriteria.map((item, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>✓</span> <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Missing criteria or unmet criteria */}
                  {evalItem.missingRequirements && evalItem.missingRequirements.length > 0 && (
                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", margin: "8px 18px 0 18px", padding: "8px 12px", fontSize: "11.5px" }}>
                      <strong style={{ color: "#92400e", display: "block", marginBottom: "4px" }}>Missing criteria for full match:</strong>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", color: "#b45309" }}>
                        {evalItem.missingRequirements.map((item, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>•</span> <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {evalItem.failedCriteria && evalItem.failedCriteria.length > 0 && (
                    <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "8px", margin: "8px 18px 0 18px", padding: "8px 12px", fontSize: "11.5px" }}>
                      <strong style={{ color: "#991b1b", display: "block", marginBottom: "4px" }}>Unmet criteria:</strong>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", color: "#b91c1c" }}>
                        {evalItem.failedCriteria.map((item, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>✕</span> <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Card Actions Footer */}
                  <div style={{ padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginTop: "10px", borderTop: "1px solid #f1f5f9" }}>
                    <button
                      type="button"
                      className="checklist-btn"
                      onClick={() => setExpandedSchemeId(isExpanded ? null : scheme.id)}
                    >
                      {isExpanded ? "▲ Hide Requirements & Checklist" : "▼ View Requirements & Checklist"}
                    </button>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="apply-btn"
                        style={{ background: "#1e293b", padding: "6px 12px", fontSize: "11.5px" }}
                        onClick={() => navigate(`/student/application?scheme=${encodeURIComponent(scheme.name || scheme.id)}`)}
                      >
                        📋 Track in SGP
                      </button>
                      {scheme.officialUrl && (
                        <button
                          type="button"
                          className="apply-btn"
                          style={{ background: schemeColor, padding: "6px 12px", fontSize: "11.5px" }}
                          onClick={() => window.open(scheme.officialUrl, "_blank", "noopener,noreferrer")}
                        >
                          Official Portal →
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ══════════ SECTION 4: SCHEME CHECKLIST ACCORDION WHEN EXPANDED ══════════ */}
                  {isExpanded && (
                    <div className="scheme-checklist-panel">
                      <div className="checklist-section-title">
                        <span>📑</span> Document Checklist for {scheme.name}
                      </div>
                      <p style={{ fontSize: "11.5px", color: "#64748b", margin: "0 0 10px 0" }}>
                        Documents required for official verification on {scheme.portal || "NSP"}.
                      </p>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {(scheme.requiredDocuments || scheme.documents || [
                          "Income Certificate",
                          "Community / Category Certificate",
                          "10th Marksheet",
                          "12th Marksheet",
                          "Aadhaar Card",
                          "Bank Passbook (Single Account)",
                        ]).map((docItem, idx) => {
                          const docStatus = getDocumentCheckStatus(docItem);
                          return (
                            <div key={idx} className="checklist-item-row">
                              <span style={{ fontWeight: 600, color: "#1e293b" }}>{docItem}</span>
                              <span className={`checklist-status-tag ${docStatus.cls}`}>
                                {docStatus.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Three Separate Verification Indicators */}
                      <div className="checklist-three-indicators">
                        <div className="indicator-pill">
                          <strong>1. Identity &amp; Name Consistency</strong>
                          <span style={{ color: matrixData?.hasNameMismatch ? "#dc2626" : "#059669", fontWeight: 700 }}>
                            {matrixData?.hasNameMismatch ? "⚠️ Name Mismatch Detected" : "✓ Student Name Consistent"}
                          </span>
                        </div>
                        <div className="indicator-pill">
                          <strong>2. Eligibility Rule Matching</strong>
                          <span style={{ color: isMatch ? "#059669" : "#d97706", fontWeight: 700 }}>
                            {isMatch ? "✓ Mandatory Criteria Met" : "⚡ " + evalItem.status}
                          </span>
                        </div>
                        <div className="indicator-pill">
                          <strong>3. Application Preparation</strong>
                          <span style={{ color: "#2563eb", fontWeight: 700 }}>
                            Document Checklist Ready
                          </span>
                        </div>
                      </div>

                      <div style={{ marginTop: "10px", fontSize: "10.5px", color: "#64748b", fontStyle: "italic", borderTop: "1px solid #f1f5f9", paddingTop: "8px" }}>
                        * Note: Document name consistency does not guarantee scholarship award. Final selection and fund disbursement are determined exclusively by the scholarship authority.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pro-warning-banner glass-panel no-eligibility" style={{ background: "#ffffff", border: "1.5px solid #cbd5e1", borderRadius: "12px", padding: "24px", textAlign: "center" }}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>🔍</div>
            <strong style={{ fontSize: "14px", color: "#0f172a", display: "block" }}>
              {activeTab === "potential"
                ? "No Confirmed Potential Matches Yet"
                : activeTab === "needs_info"
                  ? "No Schemes Currently Needing More Information"
                  : "No Ineligible Schemes"}
            </strong>
            <p style={{ fontSize: "12px", color: "#64748b", maxWidth: "600px", margin: "8px auto 0 auto", lineHeight: 1.5 }}>
              {activeTab === "potential"
                ? "We could not find potential matches based on currently filled fields. Please ensure your Course Level, Current Year of Study, and Domicile State are selected in the Profile Editor above, or check the 'More Information Needed' tab."
                : "Check your entered criteria or explore the other result tabs."}
            </p>
          </div>
        )}

        {/* ══════════ BOTTOM NAVIGATION ACTIONS ══════════ */}
        <div className="action-buttons" style={{ marginTop: "24px" }}>
          {isEmbedded && onBackToStep3 ? (
            <button type="button" className="btn-glass-secondary" onClick={onBackToStep3}>
              ← Back to Consistency Results
            </button>
          ) : (
            <button type="button" className="btn-glass-secondary" onClick={() => handleNavigation("/dashboard")}>
              ← Back to Dashboard
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

export default EligibilityEngine;
