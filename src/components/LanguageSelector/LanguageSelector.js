import React, { useState, useEffect, useRef } from "react";
import "./LanguageSelector.css";

const LANGUAGES = [
  { code: "en", label: "English", native: "English", flag: "🇬🇧" },
  { code: "hi", label: "Hindi", native: "हिन्दी", flag: "🇮🇳" },
  { code: "ta", label: "Tamil", native: "தமிழ்", flag: "🇮🇳" },
  { code: "ml", label: "Malayalam", native: "മലയാളം", flag: "🇮🇳" },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ", flag: "🇮🇳" },
  { code: "te", label: "Telugu", native: "తెలుగు", flag: "🇮🇳" },
];

function setGoogleTranslateLanguage(langCode) {
  if (langCode === "en") {
    // Restore to English
    const frame = document.querySelector(".goog-te-banner-frame");
    if (frame) {
      const restore = frame.contentDocument?.querySelector(".goog-te-banner-content .goog-te-restore");
      if (restore) restore.click();
    }
    // Alternative: use cookie reset
    const cookie = "/auto/" + langCode;
    document.cookie = "googtrans=" + cookie + "; path=/";
    document.cookie = "googtrans=" + cookie + "; domain=" + document.domain + "; path=/";
    window.location.reload();
    return;
  }
  const combo = document.querySelector(".goog-te-combo");
  if (combo) {
    combo.value = langCode;
    combo.dispatchEvent(new Event("change", { bubbles: true }));
    document.cookie = "googtrans=/en/" + langCode + "; path=/";
  } else {
    // Fallback: set cookie and reload
    const cookie = "/en/" + langCode;
    document.cookie = "googtrans=" + cookie + "; path=/";
    document.cookie = "googtrans=" + cookie + "; domain=" + document.domain + "; path=/";
    window.location.reload();
  }
}

export default function LanguageSelector() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(LANGUAGES[0]);
  const dropdownRef = useRef(null);

  // Detect current language from cookie on mount
  useEffect(() => {
    const match = document.cookie.match(/googtrans=\/en\/([a-z]+)/);
    if (match) {
      const lang = LANGUAGES.find((l) => l.code === match[1]);
      if (lang) setSelected(lang);
    }
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(lang) {
    setSelected(lang);
    setOpen(false);
    setGoogleTranslateLanguage(lang.code);
  }

  return (
    <div className="lang-selector" ref={dropdownRef}>
      <button
        className="lang-trigger"
        onClick={() => setOpen((p) => !p)}
        title="Select Language"
      >
        <span className="lang-globe">🌐</span>
        <span className="lang-current">{selected.native}</span>
        <span className={`lang-chevron ${open ? "open" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="lang-dropdown">
          <div className="lang-dropdown-header">Select Language</div>
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              className={`lang-option ${selected.code === lang.code ? "active" : ""}`}
              onClick={() => handleSelect(lang)}
            >
              <span className="lang-flag">{lang.flag}</span>
              <span className="lang-names">
                <span className="lang-native">{lang.native}</span>
                <span className="lang-english">{lang.label}</span>
              </span>
              {selected.code === lang.code && <span className="lang-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
