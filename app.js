/* ============================================================================
   YOUR SIMPLE HEALTH ASSISTANT
   ---------------------------------------------------------------------------
   Frontend logic

   Features:
     - Login / signup
     - Forgot password
     - Account page
     - Health topics
     - AI questions
     - Question history
     - Markdown rendering
     - Automatic language detection
     - English default
     - Luganda
     - Filipino
     - French
     - Spanish
     - German
     - Floating voice orb
     - Automatic speech recognition
     - Automatic text-to-speech
     - No start/stop voice buttons
============================================================================ */


// ============================================================================
// API
// ============================================================================

const API = {

  topics: () =>
    fetch(`${API_BASE}/api/topics`, {
      credentials: "include"
    }).then(r => r.json()),

  topic: (id) =>
    fetch(`${API_BASE}/api/topics/${id}`, {
      credentials: "include"
    }).then(r => r.json()),

  ask: (q) =>
    fetch(`${API_BASE}/api/ask?q=${encodeURIComponent(q)}`, {
      credentials: "include"
    }).then(r => r.json()),

  me: () =>
    fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include"
    }).then(r => r.json()),

  signup: (username, email, password) =>
    fetch(`${API_BASE}/api/auth/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        username,
        email,
        password
      })
    }).then(async r => ({
      ok: r.ok,
      data: await r.json()
    })),

  login: (username, password) =>
    fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        username,
        password
      })
    }).then(async r => ({
      ok: r.ok,
      data: await r.json()
    })),

  logout: () =>
    fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include"
    }).then(r => r.json()),

  changePassword: (current_password, new_password) =>
    fetch(`${API_BASE}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        current_password,
        new_password
      })
    }).then(async r => ({
      ok: r.ok,
      data: await r.json()
    })),

  forgotPassword: (email) =>
    fetch(`${API_BASE}/api/auth/forgot-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        email
      })
    }).then(async r => ({
      ok: r.ok,
      data: await r.json()
    })),

  history: () =>
    fetch(`${API_BASE}/api/history`, {
      credentials: "include"
    }).then(r => r.json())
};


// ============================================================================
// GLOBAL STATE
// ============================================================================

const root = document.getElementById("root");

let TOPICS = [];
let USER = null;
let current = "home";

let speechRecognition = null;
let isListening = false;
let isSpeaking = false;
let voiceSupported = false;

let currentVoiceLanguage = "en-US";


// ============================================================================
// LANGUAGE SYSTEM
// ============================================================================

const LANGUAGES = {
  english: {
    name: "English",
    code: "en-US",
    aliases: [
      "english",
      "in english",
      "answer in english",
      "speak english"
    ]
  },

  luganda: {
    name: "Luganda",
    code: "lg-UG",
    aliases: [
      "luganda",
      "mu luganda",
      "answer in luganda",
      "speak luganda"
    ]
  },

  filipino: {
    name: "Filipino",
    code: "fil-PH",
    aliases: [
      "filipino",
      "tagalog",
      "in filipino",
      "in tagalog",
      "answer in filipino",
      "speak filipino"
    ]
  },

  french: {
    name: "French",
    code: "fr-FR",
    aliases: [
      "french",
      "français",
      "francais",
      "en français",
      "answer in french",
      "speak french"
    ]
  },

  spanish: {
    name: "Spanish",
    code: "es-ES",
    aliases: [
      "spanish",
      "español",
      "espanol",
      "en español",
      "answer in spanish",
      "speak spanish"
    ]
  },

  german: {
    name: "German",
    code: "de-DE",
    aliases: [
      "german",
      "deutsch",
      "auf deutsch",
      "answer in german",
      "speak german"
    ]
  }
};


// Detect an explicitly requested language.

function detectRequestedLanguage(text) {

  const lower = String(text || "").toLowerCase();

  for (const language of Object.values(LANGUAGES)) {

    for (const alias of language.aliases) {

      if (lower.includes(alias.toLowerCase())) {
        return language;
      }

    }

  }

  return null;
}


// Detect language from the actual question.
//
// This is intentionally conservative.
// English is the default if we are not reasonably confident.

function detectLanguage(text) {

  const requested = detectRequestedLanguage(text);

  if (requested) {
    return requested;
  }

  const lower = String(text || "").toLowerCase();

  // Luganda clues
  const lugandaWords = [
    "ki",
    "ndi",
    "nnyamba",
    "omubiri",
    "obulamu",
    "obulwadde",
    "amazzi",
    "omutwe",
    "omusujja",
    "okulya",
    "okunywa",
    "omwana",
    "omuntu"
  ];

  // Filipino clues
  const filipinoWords = [
    "ako",
    "ang",
    "mga",
    "kung",
    "paano",
    "bakit",
    "ano",
    "ito",
    "iyan",
    "sakit",
    "katawan",
    "tubig",
    "lagnat"
  ];

  // French clues
  const frenchWords = [
    "bonjour",
    "comment",
    "pourquoi",
    "avec",
    "sans",
    "santé",
    "sante",
    "maladie",
    "douleur",
    "fièvre",
    "fievre",
    "eau",
    "maux"
  ];

  // Spanish clues
  const spanishWords = [
    "hola",
    "cómo",
    "como",
    "por qué",
    "porque",
    "salud",
    "enfermedad",
    "dolor",
    "fiebre",
    "agua",
    "cuerpo",
    "síntomas",
    "sintomas"
  ];

  // German clues
  const germanWords = [
    "hallo",
    "wie",
    "warum",
    "gesundheit",
    "krankheit",
    "schmerzen",
    "fieber",
    "wasser",
    "körper",
    "koerper",
    "symptome"
  ];


  function score(words) {

    let score = 0;

    for (const word of words) {

      const pattern = new RegExp(
        `\\b${escapeRegExp(word)}\\b`,
        "i"
      );

      if (pattern.test(lower)) {
        score++;
      }

    }

    return score;
  }


  const scores = {
    luganda: score(lugandaWords),
    filipino: score(filipinoWords),
    french: score(frenchWords),
    spanish: score(spanishWords),
    german: score(germanWords)
  };


  let bestLanguage = null;
  let bestScore = 0;

  for (const [key, value] of Object.entries(scores)) {

    if (value > bestScore) {
      bestLanguage = LANGUAGES[key];
      bestScore = value;
    }

  }


  if (bestScore >= 2) {
    return bestLanguage;
  }

  return LANGUAGES.english;
}


function escapeRegExp(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


// Remove language instruction before sending question to AI.

function removeLanguageInstruction(text) {

  let result = String(text || "").trim();

  const patterns = [
    /answer in english/i,
    /answer in luganda/i,
    /answer in filipino/i,
    /answer in tagalog/i,
    /answer in french/i,
    /answer in spanish/i,
    /answer in german/i,

    /speak english/i,
    /speak luganda/i,
    /speak filipino/i,
    /speak tagalog/i,
    /speak french/i,
    /speak spanish/i,
    /speak german/i,

    /in english/i,
    /in luganda/i,
    /in filipino/i,
    /in tagalog/i,
    /in french/i,
    /in spanish/i,
    /in german/i
  ];

  for (const pattern of patterns) {
    result = result.replace(pattern, "");
  }

  return result
    .replace(/\s{2,}/g, " ")
    .trim();
}


// ============================================================================
// HTML / MARKDOWN
// ============================================================================

function escapeHtml(text) {

  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function formatInlineMarkdown(value) {

  let result = escapeHtml(value);

  result = result.replace(
    /\*\*(.+?)\*\*/g,
    "<strong>$1</strong>"
  );

  result = result.replace(
    /(^|[^*])\*([^*]+)\*(?!\*)/g,
    "$1<em>$2</em>"
  );

  result = result.replace(
    /`([^`]+)`/g,
    "<code>$1</code>"
  );

  return result;
}


function renderMarkdown(text) {

  if (!text) return "";

  const lines =
    String(text)
      .replace(/\r\n/g, "\n")
      .split("\n");

  let html = "";
  let paragraph = [];
  let listType = null;


  function closeList() {

    if (listType === "ul") {
      html += "</ul>";
    }

    else if (listType === "ol") {
      html += "</ol>";
    }

    listType = null;
  }


  function closeParagraph() {

    if (paragraph.length === 0) {
      return;
    }

    const content =
      paragraph
        .join(" ")
        .trim();

    if (content) {
      html += `<p>${formatInlineMarkdown(content)}</p>`;
    }

    paragraph = [];
  }


  for (const rawLine of lines) {

    const line = rawLine.trim();

    if (!line) {
      closeParagraph();
      closeList();
      continue;
    }


    if (line.startsWith("## ")) {

      closeParagraph();
      closeList();

      html += `
        <h2>
          ${formatInlineMarkdown(
            line.substring(3).trim()
          )}
        </h2>
      `;

      continue;
    }


    if (line.startsWith("### ")) {

      closeParagraph();
      closeList();

      html += `
        <h3>
          ${formatInlineMarkdown(
            line.substring(4).trim()
          )}
        </h3>
      `;

      continue;
    }


    const bulletMatch =
      line.match(/^[-*]\s+(.+)$/);

    if (bulletMatch) {

      closeParagraph();

      if (listType !== "ul") {

        closeList();

        html += "<ul>";

        listType = "ul";
      }

      html += `
        <li>
          ${formatInlineMarkdown(
            bulletMatch[1]
          )}
        </li>
      `;

      continue;
    }


    const numberedMatch =
      line.match(/^\d+\.\s+(.+)$/);

    if (numberedMatch) {

      closeParagraph();

      if (listType !== "ol") {

        closeList();

        html += "<ol>";

        listType = "ol";
      }

      html += `
        <li>
          ${formatInlineMarkdown(
            numberedMatch[1]
          )}
        </li>
      `;

      continue;
    }


    closeList();

    paragraph.push(line);
  }


  closeParagraph();
  closeList();

  return html;
}


// ============================================================================
// AUDIO
// ============================================================================

let audioContext = null;


function initAudio() {

  if (audioContext) {
    return audioContext;
  }

  const AudioContext =
    window.AudioContext ||
    window.webkitAudioContext;

  if (!AudioContext) {
    return null;
  }

  audioContext = new AudioContext();

  return audioContext;
}


function playTone(
  frequency = 440,
  duration = 0.08,
  type = "sine",
  volume = 0.035
) {

  const ctx = initAudio();

  if (!ctx) {
    return;
  }

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }


  const oscillator =
    ctx.createOscillator();

  const gain =
    ctx.createGain();


  oscillator.type = type;

  oscillator.frequency.value =
    frequency;


  gain.gain.setValueAtTime(
    0,
    ctx.currentTime
  );

  gain.gain.linearRampToValueAtTime(
    volume,
    ctx.currentTime + 0.01
  );

  gain.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + duration
  );


  oscillator.connect(gain);

  gain.connect(ctx.destination);


  oscillator.start();

  oscillator.stop(
    ctx.currentTime + duration + 0.02
  );
}


function playListeningSound() {

  playTone(
    520,
    0.08,
    "sine",
    0.04
  );

  setTimeout(() => {

    playTone(
      700,
      0.1,
      "sine",
      0.035
    );

  }, 70);
}


function playThinkingSound() {

  playTone(
    420,
    0.09,
    "sine",
    0.025
  );
}


function playAnswerSound() {

  playTone(
    600,
    0.08,
    "sine",
    0.035
  );

  setTimeout(() => {

    playTone(
      760,
      0.12,
      "sine",
      0.03
    );

  }, 80);
}


function playErrorSound() {

  playTone(
    220,
    0.16,
    "triangle",
    0.035
  );
}


// ============================================================================
// SPEECH SYNTHESIS
// ============================================================================

function cleanTextForSpeech(text) {

  if (!text) return "";

  return String(text)

    .replace(
      /^#{1,6}\s+/gm,
      ""
    )

    .replace(
      /\*\*(.*?)\*\*/g,
      "$1"
    )

    .replace(
      /\*([^*]+)\*/g,
      "$1"
    )

    .replace(
      /`([^`]+)`/g,
      "$1"
    )

    .replace(
      /^\s*[-*]\s+/gm,
      ""
    )

    .replace(
      /^\s*\d+\.\s+/gm,
      ""
    )

    .replace(
      /\n{3,}/g,
      "\n\n"
    )

    .trim();
}


function speakText(text, language = LANGUAGES.english) {

  if (!("speechSynthesis" in window)) {
    return;
  }

  if (!text) {
    return;
  }


  speechSynthesis.cancel();


  const cleanText =
    cleanTextForSpeech(text);


  const utterance =
    new SpeechSynthesisUtterance(
      cleanText
    );


  utterance.lang =
    language.code;


  utterance.rate =
    0.95;


  utterance.pitch =
    1;


  utterance.volume =
    1;


  utterance.onstart = () => {

    isSpeaking = true;

    updateOrb(
      "speaking",
      `Speaking ${language.name}`
    );

  };


  utterance.onend = () => {

    isSpeaking = false;

    updateOrb(
      "idle",
      "Tap the orb and speak"
    );

  };


  utterance.onerror = () => {

    isSpeaking = false;

    updateOrb(
      "idle",
      "Tap the orb and speak"
    );

  };


  speechSynthesis.speak(
    utterance
  );
}


function stopSpeaking() {

  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }

  isSpeaking = false;

  updateOrb(
    "idle",
    "Tap the orb and speak"
  );
}


```js
// ============================================================================
// FLOATING AI VOICE WAVE
// ============================================================================

let voiceWaveAutoStartTimer = null;

/**
 * Create the floating voice-wave interface.
 *
 * This replaces the old circular voice orb with a floating,
 * sound-reactive wave panel.
 */
function createVoiceWave() {
    if (document.getElementById("voiceWave")) {
        return;
    }

    const style = document.createElement("style");

    style.id = "voice-wave-styles";

    style.textContent = `
        /* ================================================================
           FLOATING AI VOICE WAVE
           ================================================================ */

        #voiceWave {
            position: fixed;
            right: 24px;
            bottom: 24px;

            width: 190px;
            height: 76px;

            display: flex;
            align-items: center;
            justify-content: center;

            padding: 0 18px;

            border-radius: 24px;

            background:
                linear-gradient(
                    135deg,
                    rgba(18, 59, 54, 0.92),
                    rgba(32, 96, 87, 0.88)
                );

            border: 1px solid rgba(255, 255, 255, 0.14);

            box-shadow:
                0 14px 40px rgba(0, 0, 0, 0.25),
                0 0 30px rgba(83, 180, 161, 0.14);

            backdrop-filter: blur(18px);
            -webkit-backdrop-filter: blur(18px);

            z-index: 9999;

            overflow: hidden;

            transition:
                width 0.35s ease,
                height 0.35s ease,
                transform 0.35s ease,
                box-shadow 0.35s ease,
                opacity 0.35s ease;

            user-select: none;
        }

        #voiceWave::before {
            content: "";

            position: absolute;

            width: 170px;
            height: 170px;

            border-radius: 50%;

            background:
                radial-gradient(
                    circle,
                    rgba(104, 211, 184, 0.16),
                    transparent 68%
                );

            animation: voiceWaveHalo 4s ease-in-out infinite;

            pointer-events: none;
        }

        #voiceWave:hover {
            transform: translateY(-3px);

            box-shadow:
                0 18px 45px rgba(0, 0, 0, 0.28),
                0 0 38px rgba(83, 180, 161, 0.2);
        }

        /* Wave container */

        .voice-wave-bars {
            position: relative;

            width: 128px;
            height: 48px;

            display: flex;
            align-items: center;
            justify-content: center;

            gap: 4px;

            z-index: 2;
        }

        /* Individual audio bars */

        .voice-wave-bar {
            width: 5px;
            height: 10px;

            border-radius: 999px;

            background: rgba(214, 255, 247, 0.92);

            transform-origin: center;

            opacity: 0.72;

            transition:
                height 0.12s ease,
                opacity 0.2s ease,
                transform 0.12s ease;

            animation:
                voiceWaveIdle 2.4s ease-in-out infinite;
        }

        .voice-wave-bar:nth-child(1) {
            animation-delay: -0.20s;
        }

        .voice-wave-bar:nth-child(2) {
            animation-delay: -0.35s;
        }

        .voice-wave-bar:nth-child(3) {
            animation-delay: -0.50s;
        }

        .voice-wave-bar:nth-child(4) {
            animation-delay: -0.65s;
        }

        .voice-wave-bar:nth-child(5) {
            animation-delay: -0.80s;
        }

        .voice-wave-bar:nth-child(6) {
            animation-delay: -0.95s;
        }

        .voice-wave-bar:nth-child(7) {
            animation-delay: -1.10s;
        }

        .voice-wave-bar:nth-child(8) {
            animation-delay: -0.95s;
        }

        .voice-wave-bar:nth-child(9) {
            animation-delay: -0.80s;
        }

        .voice-wave-bar:nth-child(10) {
            animation-delay: -0.65s;
        }

        .voice-wave-bar:nth-child(11) {
            animation-delay: -0.50s;
        }

        .voice-wave-bar:nth-child(12) {
            animation-delay: -0.35s;
        }

        .voice-wave-bar:nth-child(13) {
            animation-delay: -0.20s;
        }

        /* ================================================================
           STATES
           ================================================================ */

        #voiceWave.listening {
            box-shadow:
                0 18px 45px rgba(0, 0, 0, 0.28),
                0 0 42px rgba(87, 210, 181, 0.35);
        }

        #voiceWave.listening .voice-wave-bar {
            animation:
                voiceWaveListening 0.75s ease-in-out infinite;
            opacity: 1;
        }

        #voiceWave.thinking {
            box-shadow:
                0 18px 45px rgba(0, 0, 0, 0.28),
                0 0 42px rgba(130, 195, 255, 0.25);
        }

        #voiceWave.thinking .voice-wave-bar {
            animation:
                voiceWaveThinking 1.15s ease-in-out infinite;
        }

        #voiceWave.speaking {
            box-shadow:
                0 18px 45px rgba(0, 0, 0, 0.28),
                0 0 46px rgba(100, 225, 200, 0.38);
        }

        #voiceWave.speaking .voice-wave-bar {
            animation:
                voiceWaveSpeaking 0.55s ease-in-out infinite;
            opacity: 1;
        }

        #voiceWave.error {
            animation: voiceWaveError 0.45s ease;
        }

        /* ================================================================
           LABEL
           ================================================================ */

        .voice-wave-label {
            position: absolute;

            left: 0;
            right: 0;
            bottom: 7px;

            text-align: center;

            font-family:
                "IBM Plex Sans",
                system-ui,
                sans-serif;

            font-size: 10px;
            font-weight: 600;

            letter-spacing: 0.08em;

            text-transform: uppercase;

            color: rgba(235, 255, 250, 0.72);

            z-index: 3;

            pointer-events: none;

            transition:
                opacity 0.2s ease;
        }

        /* ================================================================
           ANIMATIONS
           ================================================================ */

        @keyframes voiceWaveIdle {
            0%,
            100% {
                height: 8px;
                transform: scaleY(0.8);
            }

            50% {
                height: 17px;
                transform: scaleY(1);
            }
        }

        @keyframes voiceWaveListening {
            0%,
            100% {
                height: 9px;
                transform: scaleY(0.8);
            }

            50% {
                height: 38px;
                transform: scaleY(1);
            }
        }

        @keyframes voiceWaveThinking {
            0%,
            100% {
                height: 9px;
                transform: scaleY(0.8);
            }

            50% {
                height: 29px;
                transform: scaleY(1);
            }
        }

        @keyframes voiceWaveSpeaking {
            0%,
            100% {
                height: 7px;
                transform: scaleY(0.7);
            }

            25% {
                height: 34px;
                transform: scaleY(1);
            }

            50% {
                height: 18px;
                transform: scaleY(0.85);
            }

            75% {
                height: 41px;
                transform: scaleY(1);
            }
        }

        @keyframes voiceWaveHalo {
            0%,
            100% {
                transform: scale(0.82);
                opacity: 0.35;
            }

            50% {
                transform: scale(1.12);
                opacity: 0.7;
            }
        }

        @keyframes voiceWaveError {
            0% {
                transform: translateX(0);
            }

            25% {
                transform: translateX(-4px);
            }

            50% {
                transform: translateX(4px);
            }

            75% {
                transform: translateX(-3px);
            }

            100% {
                transform: translateX(0);
            }
        }

        /* ================================================================
           MOBILE
           ================================================================ */

        @media (max-width: 600px) {
            #voiceWave {
                right: 14px;
                bottom: 14px;

                width: 165px;
                height: 68px;

                border-radius: 20px;
            }

            .voice-wave-bars {
                width: 112px;
                height: 42px;

                gap: 3px;
            }

            .voice-wave-bar {
                width: 4px;
            }

            .voice-wave-label {
                font-size: 9px;
                bottom: 6px;
            }
        }

        /* ================================================================
           REDUCED MOTION
           ================================================================ */

        @media (prefers-reduced-motion: reduce) {
            #voiceWave,
            #voiceWave::before,
            .voice-wave-bar {
                animation: none !important;
```



// ============================================================================
// SPEECH RECOGNITION
// ============================================================================

function setupVoiceRecognition() {

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;


  if (!SpeechRecognition) {

    voiceSupported = false;

    updateOrb(
      "error",
      "Voice input is not supported here"
    );

    return;
  }


  voiceSupported = true;


  speechRecognition =
    new SpeechRecognition();


  speechRecognition.lang =
    "en-US";


  speechRecognition.continuous =
    false;


  speechRecognition.interimResults =
    false;


  speechRecognition.maxAlternatives =
    1;


  speechRecognition.onstart = () => {

    isListening = true;

    initAudio();

    playListeningSound();


    updateOrb(
      "listening",
      "Listening… speak naturally"
    );
  };


  speechRecognition.onresult =
    event => {

      const transcript =
        event.results[0][0]
          .transcript
          .trim();


      isListening = false;


      if (!transcript) {

        updateOrb(
          "idle",
          "I didn't catch that"
        );

        return;
      }


      const input =
        document.getElementById(
          "askInput"
        );


      if (input) {
        input.value =
          transcript;
      }


      updateOrb(
        "thinking",
        "I heard you. Thinking…"
      );


      playThinkingSound();


      handleAsk(
        transcript,
        true
      );
    };


  speechRecognition.onerror =
    event => {

      console.error(
        "Speech recognition error:",
        event.error
      );


      isListening = false;


      if (
        event.error === "not-allowed"
      ) {

        playErrorSound();

        updateOrb(
          "error",
          "Microphone permission was denied"
        );

        setTimeout(() => {

          updateOrb(
            "idle",
            "Tap the orb and speak"
          );

        }, 2500);

        return;
      }


      if (
        event.error === "no-speech"
      ) {

        updateOrb(
          "idle",
          "No speech detected"
        );

        setTimeout(() => {

          updateOrb(
            "idle",
            "Tap the orb and speak"
          );

        }, 1800);

        return;
      }


      playErrorSound();


      updateOrb(
        "error",
        "Voice input failed"
      );


      setTimeout(() => {

        updateOrb(
          "idle",
          "Tap the orb and speak"
        );

      }, 2000);
    };


  speechRecognition.onend =
    () => {

      isListening = false;

      if (!isSpeaking) {

        const orb =
          document.getElementById(
            "voiceOrb"
          );


        if (
          orb &&
          orb.classList.contains(
            "voice-orb-listening"
          )
        ) {

          updateOrb(
            "idle",
            "Tap the orb and speak"
          );
        }
      }
    };
}


function startListening() {

  if (!voiceSupported) {

    updateOrb(
      "error",
      "Voice input is not supported"
    );

    return;
  }


  if (isListening) {
    return;
  }


  stopSpeaking();


  initAudio();


  try {

    speechRecognition.lang =
      currentVoiceLanguage;


    speechRecognition.start();

  }

  catch (error) {

    console.error(
      "Could not start speech recognition:",
      error
    );

  }
}


function stopListening() {

  if (!speechRecognition) {
    return;
  }


  if (!isListening) {
    return;
  }


  try {
    speechRecognition.stop();
  }

  catch (error) {
    console.error(error);
  }


  isListening = false;


  updateOrb(
    "idle",
    "Tap the orb and speak"
  );
}


// ============================================================================
// LANGUAGE DISPLAY
// ============================================================================

function createVoiceStatus() {

  if (
    document.getElementById(
      "voiceOrbStatus"
    )
  ) {
    return;
  }


  const status =
    document.createElement("div");


  status.id =
    "voiceOrbStatus";


  status.className =
    "voice-orb-status";


  status.textContent =
    "Tap the orb and speak";


  document.body.appendChild(
    status
  );
}


// ============================================================================
// BOOT
// ============================================================================

async function boot() {

  try {

    const me =
      await API.me();


    USER =
      me.user;


    if (USER) {

      TOPICS =
        await API.topics();


      renderApp();

    }

    else {

      renderGate();

    }

  }

  catch (error) {

    console.error(
      "Boot failed:",
      error
    );


    root.innerHTML = `
      <div
        class="loading"
        style="padding:44px;"
      >
        Unable to connect to the
        health assistant.

        Please refresh the page
        and try again.
      </div>
    `;
  }
}


// ============================================================================
// AUTH GATE
// ============================================================================

let gateMode = "login";


function renderGate() {

  root.innerHTML = `
    <div class="gate-wrap">

      <div class="gate-visual">

        <img
          src="images/hero.jpg"
          alt=""
        />

        <div class="gate-scrim"></div>

        <div class="gate-visual-brand">

          <div class="mark">
            +
          </div>

          <div class="name">
            Your Simple<br>
            Health Assistant
          </div>

        </div>

        <div class="gate-tagline">

          <h2>
            Health awareness,
            made simple.
          </h2>

          <p>
            Practical, everyday guidance
            on hygiene, nutrition,
            exercise, and more.
          </p>

        </div>

      </div>


      <div class="gate-panel">

        <div class="gate-card">

          <div id="gateBody"></div>

        </div>

      </div>

    </div>
  `;


  renderGateBody();
}


function renderGateBody() {

  const body =
    document.getElementById(
      "gateBody"
    );


  if (gateMode === "forgot") {

    body.innerHTML = `
      <button
        class="gate-back"
        id="gateBackBtn"
      >
        ← Back to log in
      </button>

      <h1 style="font-size:20px;">
        Forgot your password?
      </h1>

      <p
        class="lede"
        style="
          font-size:13.5px;
          margin-top:8px;
        "
      >
        Enter the email you signed up
        with and we'll send a reset link.
      </p>

      <div
        class="auth-card"
        style="
          margin-top:16px;
          padding:0;
          border:none;
        "
      >

        <form id="forgotForm">

          <label
            for="forgotEmail"
          >
            Email
          </label>

          <input
            id="forgotEmail"
            type="email"
            autocomplete="email"
            required
          />

          <button
            type="submit"
            class="submit-btn"
          >
            Send reset link
          </button>

          <div
            class="error-msg"
            id="forgotError"
          ></div>

          <div
            class="success-msg"
            id="forgotSuccess"
          ></div>

        </form>

      </div>
    `;


    document
      .getElementById(
        "gateBackBtn"
      )
      .addEventListener(
        "click",
        () => {

          gateMode = "login";

          renderGateBody();

        }
      );


    document
      .getElementById(
        "forgotForm"
      )
      .addEventListener(
        "submit",
        async e => {

          e.preventDefault();


          const errorBox =
            document.getElementById(
              "forgotError"
            );


          const successBox =
            document.getElementById(
              "forgotSuccess"
            );


          errorBox.textContent = "";

          successBox.textContent = "";


          const email =
            document.getElementById(
              "forgotEmail"
            )
              .value
              .trim();


          const result =
            await API.forgotPassword(
              email
            );


          if (!result.ok) {

            errorBox.textContent =
              result.data.error ||
              "Something went wrong.";

            return;
          }


          successBox.textContent =
            result.data.message ||
            "If that email is registered, a reset link has been sent.";

        }
      );


    return;
  }


  const isLogin =
    gateMode === "login";


  body.innerHTML = `

    <div class="gate-tabs">

      <button
        class="gate-tab
        ${isLogin ? "active" : ""}"
        id="tabLogin"
      >
        Log in
      </button>

      <button
        class="gate-tab
        ${!isLogin ? "active" : ""}"
        id="tabSignup"
      >
        Sign up
      </button>

    </div>


    <p
      class="lede"
      style="
        font-size:13.5px;
        margin-bottom:8px;
      "
    >
      ${
        isLogin
          ? "Log in to pick up where you left off."
          : "Create an account so your question history is saved for next time."
      }
    </p>


    <div
      class="auth-card"
      style="
        padding:0;
        border:none;
      "
    >

      <form id="gateForm">

        <label
          for="gateUsername"
        >
          Username
        </label>

        <input
          id="gateUsername"
          type="text"
          autocomplete="username"
          required
        />


        ${
          isLogin
            ? ""
            : `
              <label
                for="gateEmail"
              >
                Email
              </label>

              <input
                id="gateEmail"
                type="email"
                autocomplete="email"
                required
              />
            `
        }


        <label
          for="gatePassword"
        >
          Password
        </label>

        <input
          id="gatePassword"
          type="password"
          autocomplete="${
            isLogin
              ? "current-password"
              : "new-password"
          }"
          required
        />


        <button
          type="submit"
          class="submit-btn"
        >
          ${
            isLogin
              ? "Log in"
              : "Create account"
          }
        </button>


        <div
          class="error-msg"
          id="gateError"
        ></div>

      </form>


      ${
        isLogin
          ? `
            <button
              class="gate-link"
              id="forgotLinkBtn"
            >
              Forgot password?
            </button>
          `
          : ""
      }

    </div>
  `;


  document
    .getElementById("tabLogin")
    .addEventListener(
      "click",
      () => {

        gateMode = "login";

        renderGateBody();

      }
    );


  document
    .getElementById("tabSignup")
    .addEventListener(
      "click",
      () => {

        gateMode = "signup";

        renderGateBody();

      }
    );


  if (isLogin) {

    document
      .getElementById(
        "forgotLinkBtn"
      )
      .addEventListener(
        "click",
        () => {

          gateMode = "forgot";

          renderGateBody();

        }
      );
  }


  document
    .getElementById(
      "gateForm"
    )
    .addEventListener(
      "submit",
      async e => {

        e.preventDefault();


        const errorBox =
          document.getElementById(
            "gateError"
          );


        errorBox.textContent = "";


        const username =
          document.getElementById(
            "gateUsername"
          )
            .value
            .trim();


        const password =
          document.getElementById(
            "gatePassword"
          )
            .value;


        let result;


        if (isLogin) {

          result =
            await API.login(
              username,
              password
            );

        }

        else {

          const email =
            document.getElementById(
              "gateEmail"
            )
              .value
              .trim();


          result =
            await API.signup(
              username,
              email,
              password
            );
        }


        if (!result.ok) {

          errorBox.textContent =
            result.data.error ||
            "Something went wrong.";

          return;
        }


        USER =
          result.data.user;


        TOPICS =
          await API.topics();


        renderApp();

      }
    );
}


// ============================================================================
// MAIN APP
// ============================================================================

function renderApp() {

  root.innerHTML = `

    <div class="app">

      <aside class="sidebar">

        <div class="brand">

          <div class="mark">
            +
          </div>

          <div class="name">
            Your Simple<br>
            Health Assistant
          </div>

          <div class="sub">
            Health awareness, made simple
          </div>

        </div>

        <nav id="nav"></nav>

        <div
          class="account-box"
          id="accountBox"
        ></div>

      </aside>


      <main id="main">

        <div class="loading">
          Loading…
        </div>

      </main>

    </div>
  `;


  renderNav();

  renderAccountBox();

  goTo("home");


  // Voice UI exists globally,
  // but only becomes active when
  // the user reaches the Ask page.

  createVoiceOrb();

  createVoiceStatus();
}


function renderNav() {

  const nav =
    document.getElementById(
      "nav"
    );


  const items = [

    {
      id: "home",
      icon: "🏠",
      name: "Home"
    },

    ...TOPICS.map(t => ({
      id: t.id,
      icon: t.icon,
      name: t.name
    })),

    {
      id: "ask",
      icon: "💬",
      name: "Ask"
    }

  ];


  nav.innerHTML =
    items
      .map(it => `

        <button
          class="nav-btn
          ${
            it.id === current
              ? "active"
              : ""
          }"
          data-goto="${it.id}"
        >

          <span class="dot"></span>

          ${escapeHtml(
            it.name
          )}

        </button>

      `)
      .join("");


  nav
    .querySelectorAll(
      ".nav-btn"
    )
    .forEach(btn => {

      btn.addEventListener(
        "click",
        () =>
          goTo(
            btn.dataset.goto
          )
      );

    });
}


function renderAccountBox() {

  const box =
    document.getElementById(
      "accountBox"
    );


  box.innerHTML = `

    <div class="who">
      👤
      ${escapeHtml(
        USER.username
      )}
    </div>

    <div class="foot-note">
      Your questions are saved
      to your account.
    </div>

    <button
      class="link"
      id="accountLinkBtn"
    >
      Account
    </button>

    <button
      class="link"
      id="logoutBtn"
    >
      Sign out
    </button>
  `;


  document
    .getElementById(
      "accountLinkBtn"
    )
    .addEventListener(
      "click",
      () => goTo("account")
    );


  document
    .getElementById(
      "logoutBtn"
    )
    .addEventListener(
      "click",
      async () => {

        stopSpeaking();

        stopListening();


        await API.logout();


        USER = null;

        gateMode = "login";


        const orb =
          document.getElementById(
            "voiceOrb"
          );


        if (orb) {
          orb.remove();
        }


        const status =
          document.getElementById(
            "voiceOrbStatus"
          );


        if (status) {
          status.remove();
        }


        renderGate();

      }
    );
}


// ============================================================================
// HOME
// ============================================================================

function homeHTML() {

  return `

    <section class="page active">

      <div class="hero">

        <div class="eyebrow-row">
          Simple Health Assistant
        </div>


        <h1>
          Basic health information,
          organized simply.
        </h1>


        <p class="lede">

          A small digital tool covering
          everyday health topics and
          questions — hygiene, nutrition,
          exercise, common illnesses,
          disease prevention, and more.

        </p>


        <div class="hero-row">

          <div class="pill">
            <b>5</b>
            health topics
          </div>

          <div class="pill">
            <b>30+</b>
            specific questions answered
          </div>

          <div class="pill">
            <b>1</b>
            built-in assistant
          </div>

        </div>

      </div>


      <div class="section-title">
        BROWSE TOPICS
      </div>


      <div class="topic-grid">

        ${TOPICS.map(t => `

          <button
            class="topic-card"
            data-goto="${escapeHtml(t.id)}"
          >

            <div class="icon">
              ${t.icon}
            </div>

            <h3>
              ${escapeHtml(t.name)}
            </h3>

            <p>
              ${escapeHtml(t.short)}
            </p>

          </button>

        `).join("")}

      </div>

    </section>

  `;
}


// ============================================================================
// TOPIC
// ============================================================================

async function topicHTML(id) {

  const t =
    await API.topic(id);


  return `

    <section class="page active">

      <div class="topic-header">

        <div class="icon-lg">
          ${t.icon}
        </div>


        <div>

          <h1>
            ${escapeHtml(t.name)}
          </h1>

          <p>
            ${escapeHtml(t.intro)}
          </p>

        </div>

      </div>


      <div class="section-title">
        KEY TIPS
      </div>


      <ul class="tip-list">

        ${t.tips.map(tip => `

          <li>
            ${escapeHtml(tip)}
          </li>

        `).join("")}

      </ul>


      <div class="fact-box">

        <div class="label">
          DID YOU KNOW
        </div>

        <p>
          ${escapeHtml(t.fact)}
        </p>

      </div>

    </section>

  `;
}


// ============================================================================
// ASK PAGE
// ============================================================================

async function askHTML() {

  let historyBlock = "";


  const history =
    await API.history();


  if (history.length) {

    historyBlock = `

      <div class="section-title">
        YOUR RECENT QUESTIONS
      </div>


      <ul class="history-list">

        ${history.map(h => `

          <li>

            <b>

              ${
                h.topic
                  ? escapeHtml(
                      h.topic.icon +
                      " " +
                      h.topic.name
                    )
                  : "No match"
              }

            </b>

            —

            ${escapeHtml(
              h.question
            )}

          </li>

        `).join("")}

      </ul>

    `;
  }


  return `

    <section class="page active">

      <div class="eyebrow-row">
        Ask the assistant
      </div>


      <h1>
        What would you like to know?
      </h1>


      <p
        class="lede"
        style="margin-top:10px;"
      >

        Type your question or use
        the floating orb to talk.

        English is the default, but
        we can also answer in
        Luganda, Filipino, French,
        Spanish, or German.

      </p>


      <div class="ask-box">

        <div class="ask-row">

          <input
            id="askInput"
            type="text"
            placeholder="Type your health question..."
            autocomplete="off"
          />

          <button
            id="askBtn"
            type="button"
          >
            Ask
          </button>

        </div>


        <div
          class="language-detected"
          id="languageDetected"
        >
        </div>


        <div class="suggest-row">

          <button
            class="suggest-chip"
            data-q="What should I do for a headache?"
          >
            Headache?
          </button>


          <button
            class="suggest-chip"
            data-q="How do I treat a burn?"
          >
            Treating a burn?
          </button>


          <button
            class="suggest-chip"
            data-q="Signs of malaria?"
          >
            Signs of malaria?
          </button>


          <button
            class="suggest-chip"
            data-q="I can't sleep, what can I do?"
          >
            Trouble sleeping?
          </button>


          <button
            class="suggest-chip"
            data-q="How do I lower my stress?"
          >
            Managing stress?
          </button>

        </div>


        <div
          class="answer"
          id="answerBox"
        ></div>

      </div>


      ${historyBlock}


      <div class="disclaimer">

        This assistant gives general
        health information only.

        For diagnosis or treatment
        of any medical concern,
        please consult a qualified
        health professional.

      </div>

    </section>

  `;
}


// ============================================================================
// ACCOUNT
// ============================================================================

function accountHTML() {

  return `

    <section class="page active">

      <div class="eyebrow-row">
        Account
      </div>


      <h1>
        Hi,
        ${escapeHtml(
          USER.username
        )}.
      </h1>


      <p
        class="lede"
        style="margin-top:10px;"
      >

        You're logged in as
        ${escapeHtml(
          USER.email
        )}.

        Your question history is
        saved automatically.

      </p>


      <div class="section-title">
        CHANGE PASSWORD
      </div>


      <div class="auth-card">

        <form id="pwForm">

          <label
            for="currentPw"
          >
            Current password
          </label>


          <input
            id="currentPw"
            type="password"
            autocomplete="current-password"
            required
          />


          <label
            for="newPw"
          >
            New password
          </label>


          <input
            id="newPw"
            type="password"
            autocomplete="new-password"
            required
          />


          <label
            for="confirmPw"
          >
            Confirm new password
          </label>


          <input
            id="confirmPw"
            type="password"
            autocomplete="new-password"
            required
          />


          <button
            type="submit"
            class="submit-btn"
          >
            Update password
          </button>


          <div
            class="error-msg"
            id="pwError"
          ></div>


          <div
            class="success-msg"
            id="pwSuccess"
          ></div>

        </form>

      </div>

    </section>

  `;
}


function wireAccountPage() {

  const pwForm =
    document.getElementById(
      "pwForm"
    );


  const pwError =
    document.getElementById(
      "pwError"
    );


  const pwSuccess =
    document.getElementById(
      "pwSuccess"
    );


  pwForm.addEventListener(
    "submit",
    async e => {

      e.preventDefault();


      pwError.textContent = "";

      pwSuccess.textContent = "";


      const current_password =
        document.getElementById(
          "currentPw"
        ).value;


      const new_password =
        document.getElementById(
          "newPw"
        ).value;


      const confirm_password =
        document.getElementById(
          "confirmPw"
        ).value;


      if (
        new_password !==
        confirm_password
      ) {

        pwError.textContent =
          "New passwords don't match.";

        return;
      }


      const result =
        await API.changePassword(
          current_password,
          new_password
        );


      if (!result.ok) {

        pwError.textContent =
          result.data.error ||
          "Something went wrong.";

        return;
      }


      pwSuccess.textContent =
        "Password updated.";


      pwForm.reset();

    }
  );
}


// ============================================================================
// NAVIGATION
// ============================================================================

async function goTo(id) {

  stopSpeaking();


  current = id;


  renderNav();


  const main =
    document.getElementById(
      "main"
    );


  if (id === "home") {

    main.innerHTML =
      homeHTML();

  }


  else if (id === "ask") {

    main.innerHTML =
      '<div class="loading">Loading…</div>';


    main.innerHTML =
      await askHTML();

  }


  else if (id === "account") {

    main.innerHTML =
      accountHTML();


    wireAccountPage();

  }


  else {

    main.innerHTML =
      '<div class="loading">Loading…</div>';


    main.innerHTML =
      await topicHTML(id);
  }


  main
    .querySelectorAll(
      "[data-goto]"
    )
    .forEach(el => {

      el.addEventListener(
        "click",
        () =>
          goTo(
            el.dataset.goto
          )
      );

    });


  if (id === "ask") {

    const askBtn =
      document.getElementById(
        "askBtn"
      );


    const askInput =
      document.getElementById(
        "askInput"
      );


    if (askBtn) {

      askBtn.addEventListener(
        "click",
        () =>
          handleAsk()
      );

    }


    if (askInput) {

      askInput.addEventListener(
        "keydown",
        e => {

          if (e.key === "Enter") {

            e.preventDefault();

            handleAsk();

          }

        }
      );

    }


    document
      .querySelectorAll(
        ".suggest-chip"
      )
      .forEach(chip => {

        chip.addEventListener(
          "click",
          () => {

            const input =
              document.getElementById(
                "askInput"
              );


            if (!input) {
              return;
            }


            input.value =
              chip.dataset.q;


            handleAsk();

          }
        );

      });


    updateOrb(
      "idle",
      "Tap the orb and speak"
    );
  }


  window.scrollTo(
    0,
    0
  );
}


// ============================================================================
// ASK
// ============================================================================

async function handleAsk(
  providedText = null,
  fromVoice = false
) {

  const input =
    document.getElementById(
      "askInput"
    );


  const box =
    document.getElementById(
      "answerBox"
    );


  if (!input || !box) {
    return;
  }


  const val =
    String(
      providedText !== null
        ? providedText
        : input.value
    ).trim();


  if (!val) {
    return;
  }


  stopSpeaking();


  const language =
    detectLanguage(val);


  currentVoiceLanguage =
    language.code;


  if (
    speechRecognition
  ) {
    speechRecognition.lang =
      language.code;
  }


  const languageIndicator =
    document.getElementById(
      "languageDetected"
    );


  if (languageIndicator) {

    languageIndicator.textContent =
      `Language: ${language.name}`;

  }


  updateOrb(
    "thinking",
    `Thinking in ${language.name}…`
  );


  box.innerHTML = `

    <div class="loading">
      Thinking…
    </div>

  `;


  box.classList.add(
    "show"
  );


  try {

    const result =
      await API.ask(
        val
      );


    if (!result.matched) {

      const answer =
        language.name === "English"

          ? "Try rephrasing your question, or browse a topic directly using the menu on the left."

          : "I couldn't find a direct answer to that question. Try asking it another way or browse a health topic.";


      box.innerHTML = `

        <div class="from">
          NO MATCH FOUND
        </div>


        <div class="answer-text">

          <p>
            ${escapeHtml(answer)}
          </p>

        </div>

      `;


      playAnswerSound();


      updateOrb(
        "speaking",
        `Answering in ${language.name}`
      );


      speakText(
        answer,
        language
      );


      return;
    }


    if (result.kind === "faq") {

      box.innerHTML = `

        <div class="from">

          ${result.topic.icon}

          ${escapeHtml(
            result.topic.name
          )}

        </div>


        <div class="answer-text">

          ${renderMarkdown(
            result.answer
          )}

        </div>


        <div
          style="margin-top:20px;"
        >

          <button
            class="suggest-chip"
            data-goto="${escapeHtml(
              result.topic.id
            )}"
          >

            More on
            ${escapeHtml(
              result.topic.name
                .toLowerCase()
            )}
            →

          </button>

        </div>

      `;


      const moreButton =
        box.querySelector(
          "[data-goto]"
        );


      if (moreButton) {

        moreButton.addEventListener(
          "click",
          () =>
            goTo(
              result.topic.id
            )
        );

      }


      playAnswerSound();


      speakText(
        result.answer,
        language
      );


      return;
    }


    if (result.kind === "ai") {

      box.innerHTML = `

        <div class="from">
          💬 ASSISTANT
        </div>


        <div class="answer-text">

          ${renderMarkdown(
            result.answer
          )}

        </div>

      `;


      playAnswerSound();


      speakText(
        result.answer,
        language
      );


      return;
    }


    const fallbackText =
      result.tips.join(". ");


    box.innerHTML = `

      <div class="from">

        ${result.topic.icon}

        ${escapeHtml(
          result.topic.name
        )}

      </div>


      <div class="answer-text">

        <h2>
          Helpful tips
        </h2>


        <ul>

          ${result.tips.map(
            tip => `

              <li>
                ${escapeHtml(tip)}
              </li>

            `
          ).join("")}

        </ul>

      </div>


      <div
        style="margin-top:20px;"
      >

        <button
          class="suggest-chip"
          data-goto="${escapeHtml(
            result.topic.id
          )}"
        >

          See all
          ${escapeHtml(
            result.topic.name
              .toLowerCase()
          )}
          tips →

        </button>

      </div>

    `;


    const moreButton =
      box.querySelector(
        "[data-goto]"
      );


    if (moreButton) {

      moreButton.addEventListener(
        "click",
        () =>
          goTo(
            result.topic.id
          )
      );

    }


    playAnswerSound();


    speakText(
      fallbackText,
      language
    );

  }


  catch (error) {

    console.error(
      "Ask request failed:",
      error
    );


    playErrorSound();


    updateOrb(
      "error",
      "I couldn't reach the assistant"
    );


    box.innerHTML = `

      <div class="from">
        CONNECTION ERROR
      </div>


      <div class="answer-text">

        <p>
          We couldn't reach the
          health assistant right now.
        </p>

        <p>
          Please check the connection
          and try again.
        </p>

      </div>

    `;


    setTimeout(() => {

      updateOrb(
        "idle",
        "Tap the orb and speak"
      );

    }, 2500);
  }
}


// ============================================================================
// START
// ============================================================================

boot();
