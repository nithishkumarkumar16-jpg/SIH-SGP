/**
 * documentFingerprint.js — Client-side Document Fingerprinting & Duplicate Detection
 * 
 * Computes SHA-256 hash in browser memory using Web Crypto API.
 * Identifies identical files within the current session to assist students.
 * 
 * Important Limitations:
 * - This fingerprint helps identify identical files. It does not prove that a document is genuine.
 * - A modified file produces a different hash.
 * - A rescan of the same certificate can produce a different hash.
 * - A forged document can also have a hash.
 * - A hash cannot recreate an earlier document.
 * 
 * Note: Never claims authentication or blockchain integration.
 * Issuer verification (e.g. DigiLocker) is handled as a separate pending integration.
 */

export const FINGERPRINT_DISCLAIMER =
  "This fingerprint helps identify identical files. It does not prove that a document is genuine.";

export const FINGERPRINT_LIMITATIONS = [
  "A modified file produces a different hash.",
  "A rescan of the same certificate can produce a different hash.",
  "A forged document can also have a hash.",
  "A hash cannot recreate an earlier document.",
];

/**
 * Computes SHA-256 hexadecimal hash from a File or Blob using window.crypto.subtle.
 * Includes fallback for Node/Jest test environments.
 * 
 * @param {File|Blob} file 
 * @returns {Promise<string>} 64-character lowercase hex string
 */
export async function computeFileFingerprint(file) {
  if (!file) return null;

  try {
    let arrayBuffer = null;
    if (typeof file.arrayBuffer === "function") {
      try {
        arrayBuffer = await file.arrayBuffer();
      } catch (e) {
        // Fall back below
      }
    }

    if (!arrayBuffer && typeof file.text === "function") {
      try {
        const text = await file.text();
        const buf = Buffer.from(text, "utf-8");
        arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } catch (e) {
        // Fall back below
      }
    }

    if (!arrayBuffer && typeof FileReader !== "undefined") {
      try {
        arrayBuffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsArrayBuffer(file);
        });
      } catch (e) {
        // Fall back below
      }
    }

    if (!arrayBuffer) {
      return null;
    }

    // 1. Browser Web Crypto API (SubtleCrypto)
    const cryptoSubtle =
      typeof window !== "undefined" && window.crypto ? window.crypto.subtle : null;

    if (cryptoSubtle && typeof cryptoSubtle.digest === "function") {
      const digestBuffer = await cryptoSubtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(digestBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    // 2. Node.js / Jest test environment cryptographic fallback
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
      try {
        // eslint-disable-next-line no-eval
        const nodeCrypto = eval("require")("crypto");
        if (nodeCrypto && typeof nodeCrypto.createHash === "function") {
          const hash = nodeCrypto.createHash("sha256");
          hash.update(Buffer.from(arrayBuffer));
          return hash.digest("hex");
        }
      } catch (nodeErr) {
        // Fall through
      }
    }

    // 3. If genuine cryptographic SHA-256 is unavailable, disable fingerprinting with an explanation.
    // Never label a non-cryptographic checksum as SHA-256.
    console.warn(
      "Document fingerprinting disabled: Genuine cryptographic SHA-256 (Web Crypto API) is unavailable in this browser environment."
    );
    return null;
  } catch (err) {
    console.warn("Document fingerprint computation error:", err);
    return null;
  }
}

/**
 * Checks if a newly computed hash matches any existing document in the current session.
 * 
 * @param {string} newHash 
 * @param {Object} existingDocs Map of docType -> { hash, file, label, version }
 * @param {string} currentSlot Current slot being uploaded to
 * @returns {Object|null} Info about duplicate file if found, else null
 */
export function checkDuplicateFingerprint(newHash, existingDocs, currentSlot) {
  if (!newHash || !existingDocs) return null;

  for (const [slotKey, doc] of Object.entries(existingDocs)) {
    const docHash = doc?.hash || doc?.fingerprint;
    if (docHash && docHash === newHash) {
      const label = doc.label || (slotKey === "income" ? "Income Certificate" : slotKey);
      return {
        isDuplicate: true,
        matchedSlot: slotKey,
        matchedFileName: doc.file?.name || "Uploaded document",
        matchedLabel: label,
        duplicateWith: label,
        message: `This file is identical to ${doc.file?.name || label}. This fingerprint helps identify identical files. It does not prove that a document is genuine.`,
        isSameSlot: slotKey === currentSlot,
      };
    }
  }

  return null;
}
