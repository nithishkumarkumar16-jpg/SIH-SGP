/**
 * profileAdapter.js — SGP & Project B Taxonomy & Terminology Adapter
 *
 * Bridges the conceptual differences between SGP-MAIN and Project B:
 * - SGP: level = degree/education level (ug, pg, diploma, iti, prematric)
 * - Project B: course = subject/stream (Engineering, Medical, Arts, Science, Diploma, School, All)
 * - Community Categories:
 *   SGP: sc, st, bc, mbc, obc, ebc, dnc, minority, general, all
 *   Project B: SC, ST, BC, MBC, Minority, General, All
 *
 * Strictly follows Tamil Nadu statutory welfare definitions where MBC & DNC
 * share welfare quotas and Central OBC maps to State BC/MBC.
 */

export const TAMIL_NADU_DISTRICTS = [
  "Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore",
  "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram",
  "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai",
  "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai",
  "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi",
  "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli",
  "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur",
  "Vellore", "Viluppuram", "Virudhunagar"
];

export const INDIAN_STATES = [
  "Tamil Nadu", "All-India / National", "Andhra Pradesh", "Bihar",
  "Delhi", "Gujarat", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Odisha", "Punjab", "Rajasthan", "Telangana",
  "Uttar Pradesh", "West Bengal", "Haryana", "Assam", "Jharkhand",
  "Chhattisgarh", "Himachal Pradesh"
];

/**
 * Normalizes community input string to canonical uppercase Project B category
 */
export function toProjectBCategory(comm) {
  if (!comm || typeof comm !== "string") return undefined;
  const c = comm.toLowerCase().trim();

  if (["sc", "scheduled caste", "adi dravidar"].includes(c)) return "SC";
  if (["st", "scheduled tribe", "tribal"].includes(c)) return "ST";
  if (["mbc", "most backward", "dnc", "dnt", "denotified"].includes(c)) return "MBC";
  if (["bc", "obc", "backward class", "backward", "ebc"].includes(c)) return "BC";
  if (["minority", "muslim", "christian", "sikh", "buddhist", "parsi", "jain"].includes(c)) return "Minority";
  if (["general", "oc", "fc", "forward", "open", "ews"].includes(c)) return "General";
  if (c === "all") return "All";

  return undefined;
}

/**
 * Normalizes category to SGP lowercase community code
 */
export function toSgpCommunity(cat) {
  if (!cat || typeof cat !== "string") return undefined;
  const c = cat.toLowerCase().trim();

  if (c === "sc") return "sc";
  if (c === "st") return "st";
  if (["mbc", "dnc", "dnt"].includes(c)) return "mbc";
  if (["bc", "obc", "ebc"].includes(c)) return "bc";
  if (c === "minority") return "minority";
  if (["general", "oc", "fc", "ews"].includes(c)) return "general";
  if (c === "all") return "all";

  return c;
}

/**
 * Checks community match considering statutory reservations
 */
export function matchesCommunity(schemeCategory, applicantCategory) {
  if (!schemeCategory || schemeCategory === "All" || schemeCategory === "all") return true;
  if (!applicantCategory) return false;

  const sNorm = schemeCategory.toUpperCase();
  const aNorm = applicantCategory.toUpperCase();

  if (sNorm === aNorm) return true;

  // In Tamil Nadu welfare structures, MBC/DNC students qualify under broader BC/MBC schemes
  if (sNorm === "BC" && (aNorm === "MBC" || aNorm === "DNC")) return true;

  // Central schemes mapping
  if (sNorm === "OBC" && (aNorm === "BC" || aNorm === "MBC")) return true;

  return false;
}

/**
 * Maps subject/track string to Project B course
 */
export function toProjectBCourse(text) {
  if (!text || typeof text !== "string") return "All";
  const norm = text.toLowerCase();

  if (/\b(engineering|b\.?e|b\.?tech|cse|ece|eee|mech|civil|polytechnic)\b/.test(norm)) return "Engineering";
  if (/\b(medical|mbbs|bds|nursing|pharmacy|b\.?pharm|paramedical)\b/.test(norm)) return "Medical";
  if (/\b(diploma|iti)\b/.test(norm)) return "Diploma";
  if (/\b(school|class 11|class 12|class 10|class 9|high school|10th|12th|nmms)\b/.test(norm)) return "School";
  if (/\b(bsc|b\.?sc|science|msc|m\.?sc)\b/.test(norm)) return "Science";
  if (/\b(arts|history|english|economics|ba|b\.?a|bcom|b\.?com)\b/.test(norm)) return "Arts";

  return "All";
}

/**
 * Maps course/stream to SGP education level (ug, pg, diploma, iti, prematric)
 */
export function toSgpLevel(courseOrText) {
  if (!courseOrText || typeof courseOrText !== "string") return undefined;
  const norm = courseOrText.toLowerCase();

  if (/\b(pg|postgraduate|masters|mtech|msc|mba|mca|ma|md|ms)\b/.test(norm)) return "pg";
  if (/\b(diploma|polytechnic)\b/.test(norm)) return "diploma";
  if (/\b(iti)\b/.test(norm)) return "iti";
  if (/\b(school|prematric|class 9|class 10|class 6|class 7|class 8|nmms)\b/.test(norm)) return "prematric";
  if (/\b(ug|undergraduate|degree|bachelor|be|btech|bsc|ba|bcom|bca|bba|mbbs|engineering|medical|arts|science)\b/.test(norm)) return "ug";

  return undefined;
}

/**
 * Normalizes gender
 */
export function normalizeGender(genderStr) {
  if (!genderStr || typeof genderStr !== "string") return "All";
  const norm = genderStr.toLowerCase();
  if (/\b(girl|girls|female|women|woman|she|lady)\b/.test(norm)) return "Girls";
  if (/\b(boy|boys|male|men|man|he)\b/.test(norm)) return "Boys";
  return "All";
}

/**
 * Normalizes state names & aliases
 */
export function normalizeState(stateStr) {
  if (!stateStr || typeof stateStr !== "string") return "Tamil Nadu";
  const norm = stateStr.toLowerCase().trim();

  if (/\b(tn|tamil\s*nadu|tamilnadu)\b/.test(norm)) return "Tamil Nadu";
  if (/\b(up|uttar\s*pradesh)\b/.test(norm)) return "Uttar Pradesh";
  if (/\b(wb|west\s*bengal)\b/.test(norm)) return "West Bengal";
  if (/\b(mh|maharashtra)\b/.test(norm)) return "Maharashtra";
  if (/\b(ka|karnataka)\b/.test(norm)) return "Karnataka";
  if (/\b(kl|kerala)\b/.test(norm)) return "Kerala";
  if (/\b(ap|andhra|andhra\s*pradesh)\b/.test(norm)) return "Andhra Pradesh";
  if (/\b(ts|telangana)\b/.test(norm)) return "Telangana";
  if (/\b(national|all-india|central)\b/.test(norm)) return "All-India";

  for (const st of INDIAN_STATES) {
    if (st.toLowerCase() === norm) return st;
  }

  return stateStr;
}

/**
 * Builds a unified student profile compatible with both SGP and Project B engines.
 * Strictly avoids assuming attributes not explicitly provided by the user.
 */
export function buildUnifiedProfile(rawSlots = {}) {
  const category = toProjectBCategory(rawSlots.category || rawSlots.community);
  const community = toSgpCommunity(rawSlots.community || rawSlots.category);
  const course = rawSlots.course ? rawSlots.course : toProjectBCourse(rawSlots.level || "");
  const level = rawSlots.level ? rawSlots.level : toSgpLevel(rawSlots.course || "");

  // Gender: only "Girls" or "Boys" if explicitly provided
  let gender;
  if (rawSlots.gender) {
    const g = normalizeGender(rawSlots.gender);
    if (g !== "All") gender = g;
  }

  // State: set if provided or implied by a known TN district
  let state;
  if (rawSlots.state) {
    state = normalizeState(rawSlots.state);
  } else if (rawSlots.district && rawSlots.district !== "All") {
    state = "Tamil Nadu";
  }

  const district = rawSlots.district && rawSlots.district !== "All" ? rawSlots.district : undefined;
  const income = typeof rawSlots.income === "number" ? rawSlots.income : undefined;

  // Strict anti-hallucination flags: undefined if not explicitly provided
  const disabled = typeof rawSlots.disabled === "boolean" ? rawSlots.disabled : undefined;
  const disabilityPercent = typeof rawSlots.disabilityPercent === "number" ? rawSlots.disabilityPercent : undefined;
  const disabilityUnderBenchmark = typeof rawSlots.disabilityUnderBenchmark === "boolean" ? rawSlots.disabilityUnderBenchmark : undefined;
  const govtSchool = typeof rawSlots.govtSchool === "boolean" ? rawSlots.govtSchool : undefined;
  const govtSchoolQuota = typeof rawSlots.govtSchoolQuota === "boolean" ? rawSlots.govtSchoolQuota : undefined;
  const agriLabor = typeof rawSlots.agriLabor === "boolean" ? rawSlots.agriLabor : undefined;
  const armedForces = typeof rawSlots.armedForces === "boolean"
    ? rawSlots.armedForces
    : (rawSlots.armedForces === "yes" ? true : (rawSlots.armedForces === "no" ? false : undefined));
  // quotaType: tri-state "government" | "management" | "unknown" — default is "unknown".
  // Quota is an ADMISSION attribute, not inferred from community. Never silently assume "government".
  const quotaType =
    rawSlots.quotaType === "management" ? "management" :
    rawSlots.quotaType === "government" ? "government" : "unknown";
  const incomeApplicant = rawSlots.incomeApplicant === "parent" ? "parent" : "student";
  const parentName = rawSlots.parentName || rawSlots.fatherName || undefined;
  const studentName = rawSlots.studentName || rawSlots.name || undefined;

  // firstGraduate: tri-state true | false | null — null means "not answered".
  // Preserve null to avoid treating unanswered as "No" (which would wrongly exclude from first-graduate schemes).
  let firstGraduate;
  if (rawSlots.firstGraduate === null) {
    firstGraduate = null;
  } else if (typeof rawSlots.firstGraduate === "boolean") {
    firstGraduate = rawSlots.firstGraduate;
  } else if (rawSlots.firstGraduate === "yes" || rawSlots.firstGraduate === "true" || rawSlots.firstGraduate === true) {
    firstGraduate = true;
  } else if (rawSlots.firstGraduate === "no" || rawSlots.firstGraduate === "false") {
    firstGraduate = false;
  } else {
    firstGraduate = null; // unanswered
  }

  return {
    category,     // Project B canonical: "SC" | "ST" | "BC" | "MBC" | "Minority" | "General" | undefined
    community,    // SGP canonical: "sc" | "st" | "bc" | "mbc" | "minority" | "general" | undefined
    course: course !== "All" ? course : undefined,       // "Engineering" | "Medical" | "Arts" | "Science" | "Diploma" | "School" | undefined
    level,        // "ug" | "pg" | "diploma" | "iti" | "prematric" | undefined
    gender,       // "Girls" | "Boys" | undefined
    state,        // "Tamil Nadu" | ... | undefined
    district,     // "Salem" | ... | undefined
    income,       // Number in INR | undefined
    disabled,     // boolean | undefined
    disabilityPercent, // number | undefined
    disabilityUnderBenchmark, // boolean | undefined
    govtSchool,   // boolean | undefined
    govtSchoolQuota, // boolean | undefined
    agriLabor,    // boolean | undefined
    armedForces,  // boolean | undefined
    firstGraduate, // boolean | undefined
    quotaType,    // "government" | "management"
    incomeApplicant, // "student" | "parent"
    parentName,
    studentName
  };
}

/**
 * Creates a normalized profile from user-entered form data with safe defaults.
 */
export function createProfileFromForm(formData = {}) {
  return {
    studentName: formData.studentName || formData.name || null,
    parentName: formData.parentName || formData.fatherName || null,
    dob: formData.dob || null,
    incomeApplicant: formData.incomeApplicant || "student",
    // quotaType: tri-state — default "unknown", never silently assumed as "government"
    quotaType: formData.quotaType === "government" ? "government" :
               formData.quotaType === "management" ? "management" : "unknown",
    // firstGraduate: tri-state true | false | null — null means not yet answered
    firstGraduate: formData.firstGraduate === true ? true :
                   formData.firstGraduate === false ? false : null,
    community: formData.community || null,
    category: formData.category || formData.community || null,
    income: formData.income !== undefined && formData.income !== null ? Number(formData.income) : undefined,
    course: formData.course || null,
    gender: formData.gender || "All",
    state: formData.state || "Tamil Nadu",
    district: formData.district || "All",
    armedForces: formData.armedForces || "no",
  };
}

/**
 * Maps confidence score to status band per SGP Confidence Rules:
 * - 90–100: Auto-fill normally (high)
 * - 70–89: Auto-fill but mark for review (review)
 * - 50–69: Show extracted value and ask user to confirm (confirm)
 * - Below 50: Do not automatically populate as trusted data (untrusted)
 */
export function getConfidenceStatus(conf) {
  if (typeof conf !== "number" || isNaN(conf)) return "review";
  if (conf >= 90) return "high";
  if (conf >= 70) return "review";
  if (conf >= 50) return "confirm";
  return "untrusted";
}

/**
 * Adapts extracted OCR & verification document data into an Eligibility Checker profile.
 * Strictly adheres to Anti-Hallucination rules:
 * - Safely auto-fills name, DOB, community, income, and 10th/12th marks with source & confidence tracking.
 * - NEVER guesses or infers course, current year of study, gender, disability, institution type,
 *   or special quotas from marksheets or certificates.
 */
export function adaptDocumentsToEligibilityProfile({
  ds = {},
  aadharName = "",
  aadharDob = "",
  studentCategory = "",
  studentIncome = "",
  bankHolder = "",
  bankAccType = "",
  matrixData = null,
  incomeApplicant = "student",
  quotaType = "government",
  firstGraduate = false,
} = {}) {
  const tenth = ds?.ms10?.data?.extracted || {};
  const twelfth = ds?.ms12?.data?.extracted || {};
  const commDoc = ds?.community?.data?.extracted || {};
  const incDoc = ds?.income?.data?.extracted || {};

  const tenthConf = ds?.ms10?.data?.ocrConfidence ?? 90;
  const twelfthConf = ds?.ms12?.data?.ocrConfidence ?? 90;
  const commConf = ds?.community?.data?.ocrConfidence ?? 90;
  const incConf = ds?.income?.data?.ocrConfidence ?? 90;

  const fieldMetadata = {};

  // 1. Name Selection & Metadata
  let nameVal = "";
  if (aadharName && aadharName.trim()) {
    nameVal = aadharName.trim();
    fieldMetadata.name = {
      value: nameVal,
      source: "Aadhaar reference input",
      confidence: 100,
      status: "high",
    };
  } else if (tenth.name) {
    nameVal = tenth.name;
    fieldMetadata.name = {
      value: nameVal,
      source: "10th Marksheet OCR",
      confidence: tenthConf,
      status: getConfidenceStatus(tenthConf),
    };
  } else if (twelfth.name) {
    nameVal = twelfth.name;
    fieldMetadata.name = {
      value: nameVal,
      source: "12th Marksheet OCR",
      confidence: twelfthConf,
      status: getConfidenceStatus(twelfthConf),
    };
  } else if (commDoc.name) {
    nameVal = commDoc.name;
    fieldMetadata.name = {
      value: nameVal,
      source: "Community Certificate OCR",
      confidence: commConf,
      status: getConfidenceStatus(commConf),
    };
  } else if (incDoc.name) {
    nameVal = incDoc.name;
    fieldMetadata.name = {
      value: nameVal,
      source: "Income Certificate OCR",
      confidence: incConf,
      status: getConfidenceStatus(incConf),
    };
  } else if (bankHolder && bankHolder.trim()) {
    nameVal = bankHolder.trim();
    fieldMetadata.name = {
      value: nameVal,
      source: "Bank Passbook reference",
      confidence: 95,
      status: "high",
    };
  }

  // 2. Date of Birth Selection & Metadata
  let dobVal = "";
  if (aadharDob) {
    dobVal = aadharDob;
    fieldMetadata.dob = {
      value: dobVal,
      source: "Aadhaar reference input",
      confidence: 100,
      status: "high",
    };
  } else if (tenth.dob) {
    dobVal = tenth.dob;
    fieldMetadata.dob = {
      value: dobVal,
      source: "10th Marksheet OCR",
      confidence: tenthConf,
      status: getConfidenceStatus(tenthConf),
    };
  } else if (twelfth.dob) {
    dobVal = twelfth.dob;
    fieldMetadata.dob = {
      value: dobVal,
      source: "12th Marksheet OCR",
      confidence: twelfthConf,
      status: getConfidenceStatus(twelfthConf),
    };
  }

  // 3. Community Category Selection & Metadata
  let communityVal = "";
  const rawCertCat = commDoc.communityCategory || commDoc.community;
  if (rawCertCat) {
    const projBCat = toProjectBCategory(rawCertCat) || rawCertCat.toUpperCase();
    communityVal = projBCat;
    fieldMetadata.community = {
      value: communityVal,
      source: "Community Certificate OCR",
      confidence: commConf,
      status: getConfidenceStatus(commConf),
    };
  } else if (studentCategory) {
    communityVal = studentCategory;
    fieldMetadata.community = {
      value: communityVal,
      source: "Entered Identity Details",
      confidence: 100,
      status: "high",
    };
  }

  // 4. Annual Family Income Selection & Metadata
  // A parent-held income certificate may supply income only after the user confirms the relationship and what the income amount represents.
  // Do not automatically treat a parent's individual income as total family income.
  let incomeVal = "";
  let rawIncomeNum = null;
  const isParentHeld = ds?.income?.holderRelationship === "Parent" || incDoc.holderRelationship === "Parent" || incomeApplicant === "parent";
  const isRelConfirmed = ds?.income?.holderRelationship && ds?.income?.holderRelationship !== "Unknown";

  if (incDoc.income !== undefined && incDoc.income !== null && incDoc.income !== "") {
    const cleanInc = typeof incDoc.income === "number" ? incDoc.income : parseInt(String(incDoc.income).replace(/[^0-9]/g, ""), 10);
    if (!isNaN(cleanInc) && cleanInc > 0) {
      if (isParentHeld && !isRelConfirmed) {
        fieldMetadata.income = {
          value: null,
          source: "Income Certificate (Parent relationship needs confirmation)",
          confidence: incConf,
          status: "confirm",
          note: "Parent relationship confirmation required before using income for family eligibility.",
        };
      } else {
        rawIncomeNum = cleanInc;
        incomeVal = String(cleanInc);
        fieldMetadata.income = {
          value: cleanInc,
          source: isParentHeld ? "Income Certificate (Confirmed Parent)" : "Income Certificate OCR",
          confidence: incConf,
          status: getConfidenceStatus(incConf),
        };
      }
    }
  }
  if (!incomeVal && studentIncome) {
    const cleanInc = parseInt(String(studentIncome).replace(/[^0-9]/g, ""), 10);
    if (!isNaN(cleanInc) && cleanInc >= 0) {
      rawIncomeNum = cleanInc;
      incomeVal = String(cleanInc);
      fieldMetadata.income = {
        value: cleanInc,
        source: "Entered Identity Details",
        confidence: 100,
        status: "high",
      };
    }
  }

  // 5. 10th & 12th Marks / Percentages
  // Safety rule: Missing maximum marks does not generate a fabricated percentage.
  let marks10Val = null;
  if (tenth.percentage) {
    const p = parseFloat(String(tenth.percentage).replace("%", ""));
    if (!isNaN(p)) marks10Val = p;
  } else if (tenth.marksScored !== undefined && tenth.maxMarks !== undefined && tenth.marksScored !== null && tenth.maxMarks !== null) {
    const scored = parseFloat(tenth.marksScored);
    const max = parseFloat(tenth.maxMarks);
    if (!isNaN(scored) && !isNaN(max) && max > 0) {
      marks10Val = Math.round((scored / max) * 100);
    }
  }
  if (marks10Val !== null) {
    fieldMetadata.marks10 = {
      value: `${marks10Val}%`,
      percentage: marks10Val,
      source: "10th Marksheet OCR",
      confidence: tenthConf,
      status: getConfidenceStatus(tenthConf),
    };
  }

  let marks12Val = null;
  if (twelfth.percentage) {
    const p = parseFloat(String(twelfth.percentage).replace("%", ""));
    if (!isNaN(p)) marks12Val = p;
  } else if (twelfth.marksScored !== undefined && twelfth.maxMarks !== undefined && twelfth.marksScored !== null && twelfth.maxMarks !== null) {
    const scored = parseFloat(twelfth.marksScored);
    const max = parseFloat(twelfth.maxMarks);
    if (!isNaN(scored) && !isNaN(max) && max > 0) {
      marks12Val = Math.round((scored / max) * 100);
    }
  }
  if (marks12Val !== null) {
    fieldMetadata.marks12 = {
      value: `${marks12Val}%`,
      percentage: marks12Val,
      source: "12th Marksheet OCR",
      confidence: twelfthConf,
      status: getConfidenceStatus(twelfthConf),
    };
  }

  // 6. Mandatory Missing / Uninferred Fields (Anti-Hallucination)
  fieldMetadata.course = {
    value: "",
    source: null,
    confidence: 0,
    status: "missing",
  };
  fieldMetadata.currentYear = {
    value: "",
    source: null,
    confidence: 0,
    status: "missing",
  };

  // 7. Extract District & State if available
  // Safety rule: Never infer domicile solely from the document's issuing district/state.
  const district = undefined;
  const state = undefined;

  // 8. Document Conflict & Inconsistency Warnings
  // Safety rule: Do not combine different students' documents into one eligibility profile.
  const conflictWarnings = [];
  if (matrixData) {
    if (matrixData.hasNameMismatch) {
      conflictWarnings.push({
        type: "danger",
        field: "name",
        message: "Different applicant names detected across uploaded documents. Resolve applicant identity before combining details into scholarship matching.",
      });
      // Do not merge conflicting document details into applicant profile
      nameVal = aadharName ? aadharName.trim() : "";
    } else if (matrixData.hasNameMinor) {
      conflictWarnings.push({
        type: "warning",
        field: "name",
        message: "Minor name variation detected between documents. Please review before proceeding.",
      });
    }
    if (matrixData.hasDobMismatch) {
      conflictWarnings.push({
        type: "danger",
        field: "dob",
        message: "Date of Birth differs between Aadhaar reference and educational certificates.",
      });
    }
    if (matrixData.incomeResult?.status === "MISMATCH") {
      conflictWarnings.push({
        type: "warning",
        field: "income",
        message: "Entered annual income differs from Income Certificate OCR extraction.",
      });
    }
    if (matrixData.communityResult?.status === "MISMATCH") {
      conflictWarnings.push({
        type: "warning",
        field: "community",
        message: "Entered community category differs from Community Certificate OCR extraction.",
      });
    }
  }

  // Do not auto-populate untrusted data (confidence < 50%) into initial form values
  const safeName = (fieldMetadata.name?.status !== "untrusted") ? nameVal : "";
  const safeDob = (fieldMetadata.dob?.status !== "untrusted") ? dobVal : "";
  const safeCommunity = (fieldMetadata.community?.status !== "untrusted") ? communityVal : "";
  const safeIncome = (fieldMetadata.income?.status !== "untrusted") ? incomeVal : "";
  const parentNameVal = commDoc.fatherName || incDoc.fatherName || twelfth.fatherName || tenth.fatherName || "";

  return {
    profile: {
      name: safeName,
      studentName: safeName,
      parentName: parentNameVal,
      dob: safeDob,
      community: safeCommunity,
      income: safeIncome,
      course: "",        // Explicitly empty — MUST be user-entered
      currentYear: "",   // Explicitly empty — MUST be user-entered
      armedForces: "no", // Default option in SGP form
      marks10: marks10Val,
      marks12: marks12Val,
      state,
      district,
      incomeApplicant,
      quotaType,
      firstGraduate,
    },
    rawIncome: rawIncomeNum,
    fieldMetadata,
    conflictWarnings,
  };
}

