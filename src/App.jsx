import React, { useState, useEffect, useRef, useMemo } from "react";

/* ===========================================================
   Persistent Keys
   =========================================================== */
const STORAGE_KEY_MANTRA = "chantMantra";
const STORAGE_KEY_LANG = "chantLang";
const STORAGE_KEY_SILENCE = "chantSilenceMs";

/* ===========================================================
   Defaults
   =========================================================== */
const DEFAULT_SILENCE_MS = 3000; // 3s default gap
const MIN_SILENCE_SEC = 1;
const MAX_SILENCE_SEC = 10;

// Soft beep tone config
const BEEP_FREQ = 440;
const BEEP_GAIN = 0.2;
const BEEP_DURATION_MS = 1500;

// Wrong‑chant immediate beep cooldown (ms)
const MISMATCH_COOLDOWN_MS = 1500;

/* ===========================================================
   UI Text (EN / HI)
   =========================================================== */
const texts = {
  en: {
    title: "Chant Reminder",
    step1: "Record your mantra and save it.",
    step2: "Start listening to track your chant.",
    step3: "Soft beep if you stop (gap) or chant something else.",
    gotIt: "Continue",
    savedMantra: "Saved Mantra",
    record: "Record Mantra",
    rerecord: "Re-record Mantra",
    stopSave: "Stop & Save",
    startListening: "Start Listening",
    stopListening: "Stop Listening",
    chantSince: "Chant Time Since Reminder",
    gapLabel: "Silence Beep Gap (seconds)",
    troubleshooting: "Troubleshooting",
    recording: "Recording...",
    note1: "Beep if you stop chanting longer than",
    note2: "seconds or your speech doesn't include your mantra.",
    pleaseRecordFirst: "Please record a mantra first.",
    noAudio: "No audio captured. Please record again.",
    mantraSaved: (m) => `Mantra saved: "${m}"`,
    liveChant: "Live Chant",
  },
  hi: {
    title: "जप याद दिलाने वाला",
    step1: "अपना मंत्र रिकॉर्ड करें और सेव करें।",
    step2: "जप ट्रैक करने के लिए सुनना शुरू करें।",
    step3: "यदि आप रुक जाते हैं या कुछ और बोलते हैं तो हल्का बीप।",
    gotIt: "ठीक है",
    savedMantra: "सहेजा गया मंत्र",
    record: "मंत्र रिकॉर्ड करें",
    rerecord: "मंत्र दोबारा रिकॉर्ड करें",
    stopSave: "रोकें और सेव करें",
    startListening: "सुनना शुरू करें",
    stopListening: "सुनना बंद करें",
    chantSince: "पिछली याद से जप समय",
    gapLabel: "बीप अंतराल (सेकंड)",
    troubleshooting: "समस्या निवारण",
    recording: "रिकॉर्ड हो रहा है...",
    note1: "यदि आप",
    note2: "सेकंड से अधिक रुकते हैं या कुछ और बोलते हैं तो बीप।",
    pleaseRecordFirst: "कृपया पहले मंत्र रिकॉर्ड करें।",
    noAudio: "कोई ऑडियो कैप्चर नहीं हुआ। फिर से रिकॉर्ड करें।",
    mantraSaved: (m) => `मंत्र सेव हुआ: "${m}"`,
    liveChant: "लाइव जप",
  },
};

/* ===========================================================
   Component
   =========================================================== */
export default function App() {
  /* ---------- State ---------- */
  const [language, setLanguage] = useState("en");
  const [introSeen, setIntroSeen] = useState(false);
  const [mantra, setMantra] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordPreview, setRecordPreview] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [chantTime, setChantTime] = useState(0); // seconds since last reminder/beep
  const [silenceMs, setSilenceMs] = useState(DEFAULT_SILENCE_MS);
  const [showIssues, setShowIssues] = useState(false);

  // Live recognized speech (final) & current interim snippet
  const [liveFinal, setLiveFinal] = useState("");
  const [liveInterim, setLiveInterim] = useState("");

  /* ---------- Refs ---------- */
  const recordRecRef = useRef(null);
  const recordFinalRef = useRef([]);
  const recordInterimRef = useRef("");

  const listenRecRef = useRef(null);
  const lastHeardRef = useRef(Date.now());       // last mantra token heard
  const mismatchBeepAtRef = useRef(0);           // last wrong-chant beep ts
  const chantTickerRef = useRef(null);           // chantTime ticker
  const gapPollRef = useRef(null);               // silence poll
  const audioCtxRef = useRef(null);

  /* ---------- Load persisted values ---------- */
  useEffect(() => {
    const savedM = localStorage.getItem(STORAGE_KEY_MANTRA);
    if (savedM) setMantra(savedM);

    const savedL = localStorage.getItem(STORAGE_KEY_LANG);
    if (savedL === "hi" || savedL === "en") setLanguage(savedL);

    const savedS = parseInt(localStorage.getItem(STORAGE_KEY_SILENCE) || "", 10);
    if (!isNaN(savedS) && savedS >= MIN_SILENCE_SEC * 1000 && savedS <= MAX_SILENCE_SEC * 1000) {
      setSilenceMs(savedS);
    }
  }, []);

  /* ---------- Persist user prefs ---------- */
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_LANG, language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SILENCE, String(silenceMs));
  }, [silenceMs]);

  useEffect(() => {
    if (mantra) localStorage.setItem(STORAGE_KEY_MANTRA, mantra);
    else localStorage.removeItem(STORAGE_KEY_MANTRA);
  }, [mantra]);

  /* ---------- Localized strings ---------- */
  const t = texts[language];

  /* ---------- Detection data ---------- */
  const mantraData = useMemo(() => buildMantraData(mantra), [mantra]);

  /* ===========================================================
     Beep (soft sine tone)
     =========================================================== */
  const ensureAudioCtx = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const beep = () => {
    const ctx = ensureAudioCtx();
    const start = ctx.currentTime;
    const end = start + BEEP_DURATION_MS / 1000;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = BEEP_FREQ;

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(BEEP_GAIN, start + 0.1);
    gain.gain.linearRampToValueAtTime(0, end);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.01);
  };

  /* ===========================================================
     RECORD MANTRA
     =========================================================== */
  const handleRecord = () => {
    stopRecording(false); // clear any existing

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Speech Recognition not supported in this browser.");
      return;
    }

    setIsRecording(true);
    setRecordPreview("");
    recordFinalRef.current = [];
    recordInterimRef.current = "";

    const rec = new SR();
    rec.lang = language === "hi" ? "hi-IN" : "en-IN"; // pick SR language
    rec.interimResults = true;
    rec.continuous = true;

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0].transcript.trim();
        if (r.isFinal) {
          recordFinalRef.current.push(txt);
          recordInterimRef.current = "";
        } else {
          recordInterimRef.current = txt;
        }
      }
      setRecordPreview(buildRecordedText());
    };

    rec.onerror = (e) => console.log("Record error:", e);
    rec.onend = () => {
      if (isRecording) {
        try { rec.start(); } catch {}
      }
    };

    try { rec.start(); } catch {}
    recordRecRef.current = rec;
  };

  const buildRecordedText = () =>
    [...recordFinalRef.current, recordInterimRef.current]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  // De-glue common combos; preserve spaces if user paused
  const prettifySavedMantra = (raw) => {
    if (!raw) return raw;
    let txt = raw.trim();
    txt = txt.replace(/\bsitaram\b/gi, "sita ram");
    txt = txt.replace(/\bsitaramji\b/gi, "sita ram ji");
    // add more combos if needed
    return txt.replace(/\s+/g, " ").trim();
  };

  const stopRecording = (commit = true) => {
    if (recordRecRef.current) {
      recordRecRef.current.onend = null;
      try { recordRecRef.current.stop(); } catch {}
      recordRecRef.current = null;
    }

    if (commit && isRecording) {
      const combined = buildRecordedText();
      const pretty = prettifySavedMantra(combined);
      if (pretty) {
        setMantra(pretty);
        alert(t.mantraSaved(pretty));
      } else {
        alert(t.noAudio);
      }
    }

    setIsRecording(false);
    setRecordPreview("");
    recordFinalRef.current = [];
    recordInterimRef.current = "";
  };

  /* ===========================================================
     LISTEN SESSION
     =========================================================== */
  const startListening = () => {
    if (!mantraData.tokens.length) {
      alert(t.pleaseRecordFirst);
      return;
    }

    stopListening(); // clear prior

    setIsListening(true);
    resetChantTimer();                // start at 0
    lastHeardRef.current = Date.now();
    mismatchBeepAtRef.current = 0;
    setLiveFinal("");
    setLiveInterim("");

    // chant time ticker (seconds since last reminder/beep)
    chantTickerRef.current = setInterval(() => {
      setChantTime((s) => s + 1);
    }, 1000);

    // silence poll -> REPEATING reminders
    gapPollRef.current = setInterval(() => {
      const gap = Date.now() - lastHeardRef.current;
      if (gap >= silenceMs) {
        beep();
        resetChantTimer();
        // restart gap window so it repeats
        lastHeardRef.current = Date.now();
      }
    }, 250);

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = language === "hi" ? "hi-IN" : "en-IN";
    rec.interimResults = true;
    rec.continuous = true;

    rec.onresult = (e) => {
      let interimAgg = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alt = r[0];
        const rawTxt = alt.transcript.trim();
        const txt = rawTxt.toLowerCase();
        const conf = typeof alt.confidence === "number" ? alt.confidence : 1;

        if (r.isFinal) {
          // append to final transcript feed
          setLiveFinal((prev) => trimTranscript(prev + " " + rawTxt));
        } else {
          interimAgg += rawTxt + " ";
        }

        // Ignore extremely low-confidence interim garbage
        if (!r.isFinal && conf < 0.1) continue;

        const matched = matchLoose(txt, mantraData);
        if (matched) {
          // Heard valid mantra *token* (partial OK)
          lastHeardRef.current = Date.now();
          // DO NOT reset timer on every chant — user wants it to grow until beep
          mismatchBeepAtRef.current = 0;
        } else if (r.isFinal) {
          // Wrong chant? Only beep if clearly speech, not noise
          if (shouldMismatchBeep(txt, conf, mantraData)) {
            const now = Date.now();
            if (now - mismatchBeepAtRef.current > MISMATCH_COOLDOWN_MS) {
              beep();
              resetChantTimer();
              mismatchBeepAtRef.current = now;
              // treat as reminder: restart silence countdown
              lastHeardRef.current = now;
            }
          }
        }
      }

      // update interim panel display
      if (interimAgg) setLiveInterim(interimAgg.trim());
      else setLiveInterim("");
    };

    rec.onerror = (e) => console.log("Listen error:", e);
    rec.onend = () => {
      if (isListening) {
        try { rec.start(); } catch {}
      }
    };

    try { rec.start(); } catch {}
    listenRecRef.current = rec;
  };

  const stopListening = () => {
    if (listenRecRef.current) {
      listenRecRef.current.onend = null;
      try { listenRecRef.current.stop(); } catch {}
      listenRecRef.current = null;
    }
    if (chantTickerRef.current) {
      clearInterval(chantTickerRef.current);
      chantTickerRef.current = null;
    }
    if (gapPollRef.current) {
      clearInterval(gapPollRef.current);
      gapPollRef.current = null;
    }
    setIsListening(false);
    setChantTime(0);
    setLiveInterim("");
  };

  /* ---------- reset chant timer ---------- */
  const resetChantTimer = () => setChantTime(0);

  /* ---------- Cleanup ---------- */
  useEffect(() => {
    return () => {
      stopRecording(false);
      stopListening();
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Silence Slider Change ---------- */
  const handleSilenceSlider = (e) => {
    const sec = Number(e.target.value);
    setSilenceMs(sec * 1000);
  };

  /* ---------- Language Toggle ---------- */
  const toggleLanguage = () => {
    setLanguage((l) => (l === "en" ? "hi" : "en"));
  };

  /* ---------- Time Format ---------- */
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
  };

  /* ===========================================================
     UI
     =========================================================== */
  const livePanelText = [liveFinal, liveInterim ? `(${liveInterim})` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div style={styles.page}>
      {/* LEFT: Language toggle + Live Chant Panel */}
      <div style={styles.leftStack}>
        <button
          style={styles.langButton}
          onClick={toggleLanguage}
          title={language === "en" ? "हिंदी में बदलें" : "Switch to English"}
        >
          {language === "en" ? "EN" : "हि"}
        </button>

        <div style={styles.leftPanel}>
          <h3 style={styles.leftPanelTitle}>{t.liveChant}</h3>
          <div style={styles.leftPanelBox}>
            {livePanelText ? livePanelText : <i>Listening...</i>}
          </div>
        </div>
      </div>

      {/* RIGHT: Troubleshoot / Bhajan / Email */}
      <div style={styles.sideIcons}>
        <button
          style={styles.iconButton}
          title={t.troubleshooting}
          onClick={() => setShowIssues((s) => !s)}
        >
          ⚠️
        </button>
        <a
          href="https://www.youtube.com/@BhajanMarg"
          title="Please check if you want to change your life"
          style={styles.iconButton}
          target="_blank"
          rel="noopener noreferrer"
        >
          🎵
        </a>
        <a
          href="mailto:mesahilsevda@gmail.com"
          style={styles.iconButton}
          title="Email me"
        >
          ✉️
        </a>
      </div>

      {/* Main Card */}
      <div style={styles.cardOuter}>
        {/* Chopai */}
        <h2 style={styles.chopai}>
          सो सब तव प्रताप रघुराई। नाथ न कछू मोरि प्रभुताई॥
        </h2>

        {/* Intro or Main */}
        {!introSeen ? (
          <div style={styles.cardInner}>
            <h1 style={styles.cardTitle}>{t.title}</h1>
            <p style={styles.cardText}>1. {t.step1}</p>
            <p style={styles.cardText}>2. {t.step2}</p>
            <p style={styles.cardText}>3. {t.step3}</p>
            <button
              style={styles.primaryBtn}
              onClick={() => setIntroSeen(true)}
            >
              {t.gotIt}
            </button>
          </div>
        ) : (
          <div style={styles.cardInner}>
            <h1 style={styles.cardTitle}>{t.title}</h1>
            <p style={styles.cardText}>
              {t.savedMantra}: <b>{mantra || "None"}</b>
            </p>

            {/* Silence gap slider */}
            <div style={styles.sliderWrap}>
              <label style={styles.sliderLabel}>
                {t.gapLabel}: {Math.round(silenceMs / 1000)}s
              </label>
              <input
                type="range"
                min={MIN_SILENCE_SEC}
                max={MAX_SILENCE_SEC}
                value={Math.round(silenceMs / 1000)}
                onChange={handleSilenceSlider}
                style={styles.slider}
              />
            </div>

            {/* Record / Stop + Save */}
            {!isRecording ? (
              <button
                style={styles.primaryBtn}
                disabled={isListening}
                onClick={handleRecord}
              >
                {mantra ? t.rerecord : t.record}
              </button>
            ) : (
              <>
                <p style={styles.recordingLabel}>
                  🎤 {t.recording}
                </p>
                {recordPreview && (
                  <p style={styles.previewText}>{recordPreview}</p>
                )}
                <button
                  style={styles.stopBtn}
                  onClick={() => stopRecording(true)}
                >
                  {t.stopSave}
                </button>
              </>
            )}

            {/* Listen */}
            <button
              style={{ ...styles.primaryBtn, marginTop: 20 }}
              onClick={isListening ? stopListening : startListening}
            >
              {isListening ? t.stopListening : t.startListening}
            </button>

            {isListening && (
              <p style={styles.timerText}>
                {t.chantSince}: {formatTime(chantTime)}
              </p>
            )}

            {/* Reminder note */}
            <div style={styles.noteBox}>
              {language === "en" ? (
                <small>
                  {t.note1} {Math.round(silenceMs / 1000)} {t.note2}
                </small>
              ) : (
                <small>
                  {t.note1} {Math.round(silenceMs / 1000)} {t.note2}
                </small>
              )}
            </div>
          </div>
        )}

        {/* Troubleshooting */}
        {showIssues && (
          <div style={styles.troubleBox}>
            <h3 style={styles.troubleTitle}>{t.troubleshooting}</h3>
            <ul style={styles.troubleList}>
              <li>Disable ad blockers / Brave shields.</li>
              <li>Allow microphone permission.</li>
              <li>Use Chrome for best speech recognition.</li>
              <li>Use earbuds/headset with a mic.</li>
              <li>Keep screen awake; background tabs may pause listening.</li>
              <li>Speak clearly; steady pace helps recognition.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===========================================================
   Detection Helpers
   =========================================================== */
function buildMantraData(raw) {
  const lower = (raw || "").trim().toLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);
  const noSpace = tokens.join("");
  const canonTokens = tokens.map((t) => canonicalize(t));
  const canonicalPhrase = canonicalize(noSpace);
  // candidate set for loose matching
  const tokenSet = new Set([...tokens, noSpace, lower, canonicalPhrase, ...canonTokens]);
  return { lower, tokens, noSpace, canonTokens, canonicalPhrase, tokenSet };
}

function canonicalize(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\u0900-\u097F]/g, "") // keep Devanagari too
    .replace(/a+/g, "a")
    .replace(/aa+/g, "a")
    .replace(/i+/g, "i")
    .replace(/ee+/g, "i")
    .replace(/u+/g, "u")
    .replace(/oo+/g, "u");
}

/**
 * Loose match:
 *  - If ANY token candidate occurs in transcript (raw or canonicalized), return true.
 *  - Accepts partial chanting like "ram ram" when mantra is "sita ram".
 *  - Rejects unrelated speech (e.g., "radha") unless recorded mantra includes it.
 */
function matchLoose(txt, md) {
  if (!md || !md.tokenSet || md.tokenSet.size === 0) return false;

  // Normalize both the incoming text and mantra tokens
  const input = canonicalize(txt.toLowerCase().replace(/\s+/g, ""));
  const inputWithSpace = canonicalize(txt.toLowerCase());

  for (const tok of md.tokenSet) {
    const canonicalTok = canonicalize(tok.replace(/\s+/g, ""));
    // Check both merged and spaced versions
    if (input.includes(canonicalTok) || inputWithSpace.includes(tok)) {
      return true;
    }
  }

  return false;
}


/**
 * Should we beep immediately for a "wrong chant"?
 * We only do this when:
 *  - The phrase does NOT matchLoose()
 *  - Confidence is reasonable OR the phrase length looks like real speech
 *  - Ignore tiny noises ("uh", background clicks)
 */
function shouldMismatchBeep(txt, conf, md) {
  if (matchLoose(txt, md)) return false;

  const letters = txt.replace(/[^a-z\u0900-\u097F]/g, "");
  if (letters.length < 3 && conf < 0.5) return false; // too small/noisy

  // allow beep when either confidence decent OR we’ve got a meaningful chunk
  if (conf >= 0.25 || letters.length >= 4) return true;

  return false;
}

/**
 * Keep transcript from growing forever: trim to last ~2000 chars.
 */
function trimTranscript(str, max = 2000) {
  if (str.length <= max) return str.trim();
  return str.slice(-max).trimStart();
}

/* ===========================================================
   Styles (Premium Dark)
   =========================================================== */
const styles = {
  page: {
    minHeight: "100vh",
    width: "100%",
    background: "radial-gradient(circle at top left, #2b2b2b, #0d0d0d 70%)",
    color: "#fff",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "clamp(16px,4vw,48px)",
    boxSizing: "border-box",
    fontFamily: "Inter, Arial, sans-serif",
  },

  /* Left stack: language button + live panel */
  leftStack: {
    position: "fixed",
    top: 20,
    left: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    zIndex: 1000,
    maxWidth: "220px",
  },
  langButton: {
    width: 56,
    height: 44,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
    backdropFilter: "blur(6px)",
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
    transition: "background 0.2s, transform 0.1s",
  },
  leftPanel: {
    width: "100%",
    maxWidth: "220px",
    height: "70vh",
    background: "rgba(255,255,255,0.05)",
    borderRadius: "12px",
    padding: "10px",
    color: "#fff",
    overflowY: "auto",
    fontSize: "0.9rem",
    boxShadow: "0 0 10px rgba(0,0,0,0.3)",
    backdropFilter: "blur(6px)",
  },
  leftPanelTitle: {
    margin: "0 0 8px 0",
    fontWeight: "bold",
    fontSize: "1rem",
    borderBottom: "1px solid rgba(255,255,255,0.2)",
    paddingBottom: "4px",
  },
  leftPanelBox: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: "calc(70vh - 40px)",
    overflowY: "auto",
    lineHeight: 1.3,
  },

  /* Right icons */
  sideIcons: {
    position: "fixed",
    top: 20,
    right: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    zIndex: 1000,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.08)",
    backdropFilter: "blur(6px)",
    color: "#fff",
    fontSize: 20,
    lineHeight: "42px",
    textAlign: "center",
    cursor: "pointer",
    textDecoration: "none",
    transition: "background 0.2s, transform 0.1s",
  },

  cardOuter: {
    width: "100%",
    maxWidth: 480,
    textAlign: "center",
  },
  chopai: {
    fontFamily: "Noto Sans Devanagari, sans-serif",
    fontSize: "clamp(1.1rem,4vw,1.5rem)",
    color: "#f9d342",
    margin: "0 0 16px 0",
    lineHeight: 1.4,
  },
  cardInner: {
    width: "100%",
    padding: "24px",
    background: "rgba(255,255,255,0.05)",
    borderRadius: 16,
    boxShadow: "0 0 24px rgba(0,0,0,0.6)",
    backdropFilter: "blur(4px)",
  },
  cardTitle: {
    margin: "0 0 8px 0",
    fontSize: "clamp(1.5rem,5vw,2rem)",
    fontWeight: 700,
  },
  cardText: {
    margin: "0 0 8px 0",
    fontSize: "clamp(1rem,3.5vw,1.125rem)",
    lineHeight: 1.4,
    opacity: 0.9,
  },
  sliderWrap: {
    marginTop: 16,
    marginBottom: 16,
    textAlign: "left",
  },
  sliderLabel: {
    display: "block",
    marginBottom: 4,
    fontSize: "0.9rem",
    opacity: 0.85,
  },
  slider: {
    width: "100%",
  },
  primaryBtn: {
    marginTop: 10,
    padding: "14px 28px",
    width: "100%",
    maxWidth: 280,
    border: "none",
    borderRadius: 12,
    background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
    color: "#fff",
    fontWeight: 700,
    fontSize: "clamp(1rem,4vw,1.125rem)",
    cursor: "pointer",
    transition: "transform 0.08s, box-shadow 0.1s",
    boxShadow: "0 0 12px rgba(236,72,153,0.4)",
  },
  stopBtn: {
    marginTop: 10,
    padding: "14px 28px",
    width: "100%",
    maxWidth: 280,
    border: "none",
    borderRadius: 12,
    background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
    color: "#fff",
    fontWeight: 700,
    fontSize: "clamp(1rem,4vw,1.125rem)",
    cursor: "pointer",
    transition: "transform 0.08s, box-shadow 0.1s",
    boxShadow: "0 0 12px rgba(239,68,68,0.4)",
  },
  recordingLabel: {
    marginTop: 12,
    marginBottom: 4,
    fontSize: "clamp(1rem,3.5vw,1.125rem)",
    color: "#fbbf24",
  },
  previewText: {
    margin: "0 0 8px 0",
    fontSize: "clamp(0.9rem,3vw,1rem)",
    opacity: 0.85,
    wordBreak: "break-word",
  },
  timerText: {
    marginTop: 16,
    fontSize: "clamp(1.1rem,4vw,1.5rem)",
    fontWeight: 600,
  },
  noteBox: {
    marginTop: 20,
    padding: "12px 16px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.08)",
    fontSize: "0.85rem",
    lineHeight: 1.3,
    opacity: 0.85,
  },
  troubleBox: {
    marginTop: 24,
    padding: 20,
    background: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    textAlign: "left",
    boxShadow: "0 0 12px rgba(0,0,0,0.4)",
  },
  troubleTitle: {
    margin: "0 0 8px 0",
    fontSize: "clamp(1.125rem,4vw,1.25rem)",
  },
  troubleList: {
    margin: 0,
    paddingLeft: "1.2em",
    fontSize: "clamp(0.95rem,3vw,1rem)",
    lineHeight: 1.35,
  },
};
