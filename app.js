```javascript
/* ------------------------------------------------------------------------
   FRONTEND LOGIC
   Every fact about topics, FAQ/AI answers, and account/session detail
   comes from the backend via fetch(`${API_BASE}/api/...`).

   Voice features:
     - Push-to-talk
     - Continuous conversation mode
     - Speech-to-text
     - Text-to-speech
     - Automatic conversation listening
------------------------------------------------------------------------ */

// API_BASE comes from config.js, loaded before this file.


/* ========================================================================
   API
   ======================================================================== */

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


const root = document.getElementById("root");

let TOPICS = [];
let USER = null;
let current = "home";


/* ========================================================================
   VOICE SYSTEM
   ======================================================================== */

/*
   Browser support.

   Chrome and Edge normally expose SpeechRecognition as:
     window.SpeechRecognition
   Some browsers expose:
     window.webkitSpeechRecognition
*/

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition ||
  null;


/*
   Voice state.
*/

let recognition = null;

let voiceMode = "none";
// none
// push
// conversation

let voiceListening = false;
let voiceSpeaking = false;
let conversationShouldContinue = false;

let lastVoiceQuestion = "";


/*
   Speech synthesis.

   We use the browser's built-in speech engine for the first version.
*/

function speakText(text, afterSpeak = null) {

  if (!("speechSynthesis" in window)) {
    if (afterSpeak) {
      afterSpeak();
    }
    return;
  }

  const cleanText = String(text || "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/\n+/g, ". ")
    .trim();

  if (!cleanText) {
    if (afterSpeak) {
      afterSpeak();
    }
    return;
  }

  window.speechSynthesis.cancel();

  const utterance =
    new SpeechSynthesisUtterance(cleanText);

  /*
     A natural but moderate voice speed.
  */
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;

  /*
     Prefer an English voice when available.
  */
  const voices =
    window.speechSynthesis.getVoices();

  const preferredVoice =
    voices.find(v =>
      /^en/i.test(v.lang) &&
      /Google|Microsoft|Samantha|Natural/i.test(v.name)
    ) ||
    voices.find(v => /^en/i.test(v.lang)) ||
    voices[0];

  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }


  voiceSpeaking = true;
  updateVoiceUI();


  utterance.onend = () => {

    voiceSpeaking = false;

    updateVoiceUI();

    if (afterSpeak) {
      afterSpeak();
    }
  };


  utterance.onerror = () => {

    voiceSpeaking = false;

    updateVoiceUI();

    if (afterSpeak) {
      afterSpeak();
    }
  };


  window.speechSynthesis.speak(utterance);
}


/*
   Stop text-to-speech.
*/

function stopSpeaking() {

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  voiceSpeaking = false;

  updateVoiceUI();
}


/*
   Check whether speech recognition is available.
*/

function voiceSupported() {
  return !!SpeechRecognition;
}


/*
   Create recognition object.
*/

function createRecognition() {

  if (!voiceSupported()) {
    return null;
  }

  const rec =
    new SpeechRecognition();

  /*
     We want normal conversational speech.
  */
  rec.lang = "en-US";

  /*
     Push-to-talk only needs one final result.

     Conversation mode restarts recognition after each answer.
  */
  rec.continuous = false;

  /*
     We show interim speech in the input.
  */
  rec.interimResults = true;

  rec.maxAlternatives = 1;


  rec.onstart = () => {

    voiceListening = true;

    updateVoiceUI();
  };


  rec.onresult = event => {

    let transcript = "";
    let finalTranscript = "";


    for (
      let i = event.resultIndex;
      i < event.results.length;
      i++
    ) {

      const text =
        event.results[i][0].transcript;

      transcript += text;

      if (event.results[i].isFinal) {
        finalTranscript += text;
      }
    }


    const input =
      document.getElementById("askInput");


    if (input && transcript) {
      input.value = transcript.trim();
    }


    /*
       Once we have final speech, send it to the assistant.
    */

    if (finalTranscript.trim()) {

      const question =
        finalTranscript.trim();

      lastVoiceQuestion = question;

      if (input) {
        input.value = question;
      }

      /*
         Stop recognition before asking the AI.
      */
      try {
        rec.stop();
      } catch (error) {
        console.warn("Recognition stop:", error);
      }


      /*
         The actual answer is handled by handleAsk().
      */
      handleAsk({
        voice: true,
        conversation:
          voiceMode === "conversation"
      });
    }
  };


  rec.onerror = event => {

    console.warn(
      "Speech recognition error:",
      event.error
    );

    voiceListening = false;

    updateVoiceUI();


    /*
       Some errors are normal browser behavior.
    */

    if (
      event.error === "not-allowed" ||
      event.error === "service-not-allowed"
    ) {

      showVoiceMessage(
        "Microphone access was blocked. Please allow microphone access in the browser."
      );

      conversationShouldContinue = false;

      return;
    }


    if (event.error === "no-speech") {

      /*
         In conversation mode, keep listening.
      */

      if (
        voiceMode === "conversation" &&
        conversationShouldContinue &&
        !voiceSpeaking
      ) {

        setTimeout(() => {
          startConversationListening();
        }, 500);
      }

      return;
    }
  };


  rec.onend = () => {

    voiceListening = false;

    updateVoiceUI();


    /*
       Conversation mode:
       after recognition ends, we only restart when the
       previous AI response has finished speaking.
    */

    if (
      voiceMode === "conversation" &&
      conversationShouldContinue &&
      !voiceSpeaking
    ) {

      /*
         A short delay makes the transition feel more natural.
      */

      setTimeout(() => {

        if (
          voiceMode === "conversation" &&
          conversationShouldContinue &&
          !voiceSpeaking
        ) {
          startConversationListening();
        }

      }, 400);
    }
  };


  return rec;
}


/*
   Initialize recognition.
*/

function ensureRecognition() {

  if (!voiceSupported()) {

    showVoiceMessage(
      "Voice recognition is not supported in this browser. Chrome or Edge is recommended."
    );

    return false;
  }


  if (!recognition) {
    recognition = createRecognition();
  }


  return !!recognition;
}


/*
   Start push-to-talk.
*/

function startPushToTalk() {

  if (!ensureRecognition()) {
    return;
  }


  /*
     Stop any conversation mode.
  */

  conversationShouldContinue = false;
  voiceMode = "push";

  stopSpeaking();


  const input =
    document.getElementById("askInput");

  if (input) {
    input.value = "";
    input.placeholder = "Listening…";
  }


  try {

    recognition.start();

  } catch (error) {

    console.warn(
      "Could not start recognition:",
      error
    );
  }


  updateVoiceUI();
}


/*
   Start continuous conversation.
*/

function startConversation() {

  if (!ensureRecognition()) {
    return;
  }


  stopSpeaking();

  voiceMode = "conversation";

  conversationShouldContinue = true;

  const input =
    document.getElementById("askInput");

  if (input) {
    input.value = "";
    input.placeholder = "Conversation mode is listening…";
  }


  startConversationListening();

  updateVoiceUI();
}


/*
   Start the actual microphone listener for conversation mode.
*/

function startConversationListening() {

  if (
    !conversationShouldContinue ||
    voiceSpeaking ||
    voiceListening
  ) {
    return;
  }


  if (!recognition) {
    recognition = createRecognition();
  }


  try {

    recognition.start();

  } catch (error) {

    /*
       Calling start while already starting can throw.
       We simply wait for the current recognition cycle.
    */

    console.warn(
      "Conversation recognition:",
      error
    );
  }
}


/*
   Stop all voice activity.
*/

function stopVoice() {

  conversationShouldContinue = false;

  voiceMode = "none";

  voiceListening = false;

  stopSpeaking();


  if (recognition) {

    try {
      recognition.stop();
    } catch (error) {
      console.warn(
        "Recognition stop:",
        error
      );
    }
  }


  const input =
    document.getElementById("askInput");

  if (input) {
    input.placeholder =
      "e.g. what should I do for a headache?";
  }


  updateVoiceUI();
}


/*
   Display voice-related status.
*/

function showVoiceMessage(message) {

  const box =
    document.getElementById("voiceStatus");

  if (!box) {
    return;
  }

  box.textContent = message;
  box.classList.add("show");
}


/*
   Clear voice status.
*/

function clearVoiceMessage() {

  const box =
    document.getElementById("voiceStatus");

  if (!box) {
    return;
  }

  box.textContent = "";
  box.classList.remove("show");
}


/*
   Update voice controls.
*/

function updateVoiceUI() {

  const pushBtn =
    document.getElementById("pushVoiceBtn");

  const conversationBtn =
    document.getElementById("conversationVoiceBtn");

  const stopBtn =
    document.getElementById("stopVoiceBtn");

  const status =
    document.getElementById("voiceStatus");


  if (!pushBtn && !conversationBtn && !stopBtn) {
    return;
  }


  /*
     Push-to-talk button.
  */

  if (pushBtn) {

    if (
      voiceMode === "push" &&
      voiceListening
    ) {

      pushBtn.textContent =
        "🔴 Listening…";

      pushBtn.classList.add("active");

    } else {

      pushBtn.textContent =
        "🎙️ Push to Talk";

      pushBtn.classList.remove("active");
    }
  }


  /*
     Conversation button.
  */

  if (conversationBtn) {

    if (voiceMode === "conversation") {

      conversationBtn.textContent =
        voiceSpeaking
          ? "🔊 Assistant speaking…"
          : voiceListening
            ? "🎙️ Listening…"
            : "🗣️ Conversation active";

      conversationBtn.classList.add("active");

    } else {

      conversationBtn.textContent =
        "🗣️ Conversation";

      conversationBtn.classList.remove("active");
    }
  }


  /*
     Stop button.
  */

  if (stopBtn) {

    stopBtn.style.display =
      voiceMode !== "none"
        ? "inline-flex"
        : "none";
  }


  /*
     Status text.
  */

  if (status) {

    if (voiceSpeaking) {

      status.textContent =
        "🔊 Assistant is speaking…";

      status.classList.add("show");

    } else if (voiceListening) {

      status.textContent =
        "🎙️ Listening…";

      status.classList.add("show");

    } else if (voiceMode === "conversation") {

      status.textContent =
        "🗣️ Conversation mode is ready.";

      status.classList.add("show");

    } else {

      status.textContent = "";

      status.classList.remove("show");
    }
  }
}


/* ========================================================================
   SAFE MARKDOWN RENDERER
   ======================================================================== */

function escapeHtml(text) {

  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function formatInlineMarkdown(value) {

  let result =
    escapeHtml(value);


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

  if (!text) {
    return "";
  }


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

    } else if (listType === "ol") {
      html += "</ol>";
    }

    listType = null;
  }


  function closeParagraph() {

    if (paragraph.length === 0) {
      return;
    }


    const content =
      paragraph.join(" ").trim();


    if (content) {

      html +=
        `<p>${formatInlineMarkdown(content)}</p>`;
    }


    paragraph = [];
  }


  for (const rawLine of lines) {

    const line =
      rawLine.trim();


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


/* ========================================================================
   STARTUP
   ======================================================================== */

async function boot() {

  try {

    const me =
      await API.me();


    USER = me.user;


    if (USER) {

      TOPICS =
        await API.topics();

      renderApp();

    } else {

      renderGate();
    }

  } catch (error) {

    console.error(
      "Boot failed:",
      error
    );


    root.innerHTML = `
      <div
        class="loading"
        style="padding:44px;"
      >
        Unable to connect to the health assistant.
        Please refresh the page and try again.
      </div>
    `;
  }
}


/* ========================================================================
   AUTH GATE
   ======================================================================== */

let gateMode = "login";


function renderGate() {

  root.innerHTML = `

    <div class="gate-wrap">

      <div class="gate-visual">

        <img
          src="images/hero.jpg"
          alt=""
        >

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
            Health awareness, made simple.
          </h2>

          <p>
            Practical, everyday guidance on hygiene, nutrition,
            exercise, and more — right when you need it.
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
    document.getElementById("gateBody");


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
        style="font-size:13.5px; margin-top:8px;"
      >
        Enter the email you signed up with and we'll send
        a reset link to it.
      </p>


      <div
        class="auth-card"
        style="margin-top:16px; padding:0; border:none;"
      >

        <form id="forgotForm">

          <label for="forgotEmail">
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
      .getElementById("gateBackBtn")
      .addEventListener("click", () => {

        gateMode = "login";

        renderGateBody();
      });


    document
      .getElementById("forgotForm")
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
            document
              .getElementById("forgotEmail")
              .value
              .trim();


          const result =
            await API.forgotPassword(email);


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
        class="gate-tab ${isLogin ? "active" : ""}"
        id="tabLogin"
      >
        Log in
      </button>


      <button
        class="gate-tab ${!isLogin ? "active" : ""}"
        id="tabSignup"
      >
        Sign up
      </button>

    </div>


    <p
      class="lede"
      style="font-size:13.5px; margin-bottom:8px;"
    >
      ${
        isLogin
          ? "Log in to pick up where you left off."
          : "Create an account so your question history is saved for next time."
      }
    </p>


    <div
      class="auth-card"
      style="padding:0; border:none;"
    >

      <form id="gateForm">

        <label for="gateUsername">
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
              <label for="gateEmail">
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


        <label for="gatePassword">
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
    .addEventListener("click", () => {

      gateMode = "login";

      renderGateBody();
    });


  document
    .getElementById("tabSignup")
    .addEventListener("click", () => {

      gateMode = "signup";

      renderGateBody();
    });


  if (isLogin) {

    document
      .getElementById("forgotLinkBtn")
      .addEventListener("click", () => {

        gateMode = "forgot";

        renderGateBody();
      });
  }


  document
    .getElementById("gateForm")
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
          document
            .getElementById("gateUsername")
            .value
            .trim();


        const password =
          document
            .getElementById("gatePassword")
            .value;


        let result;


        if (isLogin) {

          result =
            await API.login(
              username,
              password
            );

        } else {

          const email =
            document
              .getElementById("gateEmail")
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


/* ========================================================================
   MAIN APP
   ======================================================================== */

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
}


/* ========================================================================
   NAVIGATION
   ======================================================================== */

function renderNav() {

  const nav =
    document.getElementById("nav");


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
          class="nav-btn ${
            it.id === current
              ? "active"
              : ""
          }"
          data-goto="${it.id}"
        >

          <span class="dot"></span>

          ${escapeHtml(it.name)}

        </button>

      `)
      .join("");


  nav
    .querySelectorAll(".nav-btn")
    .forEach(btn => {

      btn.addEventListener(
        "click",
        () => goTo(btn.dataset.goto)
      );

    });
}


/* ========================================================================
   ACCOUNT BOX
   ======================================================================== */

function renderAccountBox() {

  const box =
    document.getElementById(
      "accountBox"
    );


  box.innerHTML = `

    <div class="who">
      👤 ${escapeHtml(USER.username)}
    </div>


    <div class="foot-note">
      Your questions are saved to your account.
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
    .getElementById("accountLinkBtn")
    .addEventListener(
      "click",
      () => goTo("account")
    );


  document
    .getElementById("logoutBtn")
    .addEventListener(
      "click",
      async () => {

        stopVoice();

        await API.logout();

        USER = null;

        gateMode = "login";

        renderGate();
      }
    );
}


/* ========================================================================
   HOME PAGE
   ======================================================================== */

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
          A small digital tool covering everyday health topics and questions —
          hygiene, nutrition, exercise, common illnesses, disease prevention,
          and a lot in between — built to make health awareness easier to
          access and understand.
        </p>


        <div class="hero-row">

          <div class="pill">
            <b>5</b> health topics
          </div>


          <div class="pill">
            <b>30+</b> specific questions answered
          </div>


          <div class="pill">
            <b>1</b> built-in assistant
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
            data-goto="${t.id}"
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


/* ========================================================================
   TOPIC PAGE
   ======================================================================== */

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


/* ========================================================================
   ASK PAGE
   ======================================================================== */

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

            ${escapeHtml(h.question)}

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
        Ask anything concerning health — a symptom, a habit, first aid,
        or general wellbeing — in your own words. Your questions are saved
        to your account.
      </p>


      <div class="ask-box">

        <div class="ask-row">

          <input
            id="askInput"
            type="text"
            placeholder="e.g. what should I do for a headache?"
          />


          <button id="askBtn">
            Ask
          </button>

        </div>


        <!-- ============================================================
             VOICE CONTROLS
             ============================================================ -->

        <div class="voice-controls">

          <button
            type="button"
            id="pushVoiceBtn"
            class="voice-btn"
          >
            🎙️ Push to Talk
          </button>


          <button
            type="button"
            id="conversationVoiceBtn"
            class="voice-btn"
          >
            🗣️ Conversation
          </button>


          <button
            type="button"
            id="stopVoiceBtn"
            class="voice-btn voice-stop"
            style="display:none;"
          >
            ⏹️ Stop
          </button>

        </div>


        <div
          id="voiceStatus"
          class="voice-status"
        ></div>


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
        This assistant gives general health information only.
        For diagnosis or treatment of any medical concern, please
        consult a qualified health professional.
      </div>

    </section>
  `;
}


/* ========================================================================
   ACCOUNT PAGE
   ======================================================================== */

function accountHTML() {

  return `

    <section class="page active">

      <div class="eyebrow-row">
        Account
      </div>


      <h1>
        Hi, ${escapeHtml(USER.username)}.
      </h1>


      <p
        class="lede"
        style="margin-top:10px;"
      >
        You're logged in as ${escapeHtml(USER.email)}.
        Your question history is saved automatically — visit the Ask page
        to see it.
      </p>


      <div class="section-title">
        CHANGE PASSWORD
      </div>


      <div class="auth-card">

        <form id="pwForm">

          <label for="currentPw">
            Current password
          </label>


          <input
            id="currentPw"
            type="password"
            autocomplete="current-password"
            required
          />


          <label for="newPw">
            New password
          </label>


          <input
            id="newPw"
            type="password"
            autocomplete="new-password"
            required
          />


          <label for="confirmPw">
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


/* ========================================================================
   ACCOUNT PAGE LOGIC
   ======================================================================== */

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


/* ========================================================================
   PAGE ROUTING
   ======================================================================== */

async function goTo(id) {

  /*
     Stop conversation when leaving Ask.
  */

  if (
    current === "ask" &&
    id !== "ask"
  ) {
    stopVoice();
  }


  current = id;

  renderNav();


  const main =
    document.getElementById(
      "main"
    );


  if (id === "home") {

    main.innerHTML =
      homeHTML();

  } else if (id === "ask") {

    main.innerHTML =
      '<div class="loading">Loading…</div>';


    main.innerHTML =
      await askHTML();

  } else if (id === "account") {

    main.innerHTML =
      accountHTML();


    wireAccountPage();

  } else {

    main.innerHTML =
      '<div class="loading">Loading…</div>';


    main.innerHTML =
      await topicHTML(id);
  }


  /*
     Buttons that navigate.
  */

  main
    .querySelectorAll("[data-goto]")
    .forEach(el => {

      el.addEventListener(
        "click",
        () => goTo(
          el.dataset.goto
        )
      );

    });


  /*
     ASK PAGE.
  */

  if (id === "ask") {

    const askBtn =
      document.getElementById(
        "askBtn"
      );


    const askInput =
      document.getElementById(
        "askInput"
      );


    const pushVoiceBtn =
      document.getElementById(
        "pushVoiceBtn"
      );


    const conversationVoiceBtn =
      document.getElementById(
        "conversationVoiceBtn"
      );


    const stopVoiceBtn =
      document.getElementById(
        "stopVoiceBtn"
      );


    askBtn.addEventListener(
      "click",
      () => handleAsk()
    );


    askInput.addEventListener(
      "keydown",
      e => {

        if (e.key === "Enter") {
          handleAsk();
        }

      }
    );


    /*
       Push-to-talk.
    */

    pushVoiceBtn.addEventListener(
      "click",
      () => {

        if (
          voiceMode === "push" &&
          voiceListening
        ) {

          stopVoice();

        } else {

          clearVoiceMessage();

          startPushToTalk();
        }
      }
    );


    /*
       Conversation mode.
    */

    conversationVoiceBtn.addEventListener(
      "click",
      () => {

        if (
          voiceMode === "conversation"
        ) {

          stopVoice();

        } else {

          clearVoiceMessage();

          startConversation();
        }
      }
    );


    /*
       Stop voice.
    */

    stopVoiceBtn.addEventListener(
      "click",
      () => stopVoice()
    );


    /*
       Suggested questions.
    */

    document
      .querySelectorAll(".suggest-chip")
      .forEach(chip => {

        chip.addEventListener(
          "click",
          () => {

            const input =
              document.getElementById(
                "askInput"
              );


            input.value =
              chip.dataset.q;


            handleAsk();
          }
        );

      });


    updateVoiceUI();
  }


  window.scrollTo(0, 0);
}


/* ========================================================================
   ASK / AI
   ======================================================================== */

async function handleAsk(options = {}) {

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
    input.value.trim();


  if (!val) {
    return;
  }


  /*
     Determine whether this request came from voice.
  */

  const fromVoice =
    options.voice === true;


  const conversationRequest =
    options.conversation === true;


  /*
     Thinking state.
  */

  box.innerHTML = `

    <div class="loading">
      ${
        fromVoice
          ? "Thinking…"
          : "Thinking…"
      }
    </div>

  `;


  box.classList.add("show");


  try {

    const result =
      await API.ask(val);


    /*
       No match.
    */

    if (!result.matched) {

      box.innerHTML = `

        <div class="from">
          NO MATCH FOUND
        </div>


        <div class="answer-text">

          <p>
            Try rephrasing your question, or browse a topic directly
            using the menu on the left.
          </p>


          <p>
            Available topics include
            <strong>hygiene</strong>,
            <strong>nutrition</strong>,
            <strong>exercise</strong>,
            <strong>common illnesses</strong>,
            and
            <strong>disease prevention</strong>.
          </p>

        </div>
      `;


      /*
         Speak the fallback in voice mode.
      */

      if (fromVoice) {

        speakText(
          "I couldn't find a matching health topic. Try rephrasing your question or browse one of the health topics.",
          () => {

            if (
              conversationRequest &&
              conversationShouldContinue
            ) {
              startConversationListening();
            }

          }
        );
      }


      return;
    }


    /*
       LOCAL FAQ.
    */

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


        <div style="margin-top:20px;">

          <button
            class="suggest-chip"
            data-goto="${result.topic.id}"
          >
            More on
            ${escapeHtml(
              result.topic.name.toLowerCase()
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
          () => {

            stopVoice();

            goTo(
              result.topic.id
            );

          }
        );
      }


      /*
         Voice answer.
      */

      if (fromVoice) {

        speakText(
          result.answer,
          () => {

            if (
              conversationRequest &&
              conversationShouldContinue
            ) {
              startConversationListening();
            }

          }
        );
      }


    /*
       HUGGING FACE AI.
    */

    } else if (result.kind === "ai") {

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


      /*
         Voice answer.
      */

      if (fromVoice) {

        speakText(
          result.answer,
          () => {

            if (
              conversationRequest &&
              conversationShouldContinue
            ) {
              startConversationListening();
            }

          }
        );
      }


    /*
       LOCAL TOPIC FALLBACK.
    */

    } else {

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

            ${result.tips.map(tip => `

              <li>
                ${escapeHtml(tip)}
              </li>

            `).join("")}

          </ul>

        </div>


        <div style="margin-top:20px;">

          <button
            class="suggest-chip"
            data-goto="${result.topic.id}"
          >
            See all
            ${escapeHtml(
              result.topic.name.toLowerCase()
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
          () => {

            stopVoice();

            goTo(
              result.topic.id
            );

          }
        );
      }


      /*
         Voice answer.
      */

      if (fromVoice) {

        const spokenTips =
          Array.isArray(result.tips)
            ? result.tips.join(". ")
            : "";


        speakText(
          `Here are some helpful tips. ${spokenTips}`,
          () => {

            if (
              conversationRequest &&
              conversationShouldContinue
            ) {
              startConversationListening();
            }

          }
        );
      }
    }


  } catch (error) {

    console.error(
      "Ask request failed:",
      error
    );


    box.innerHTML = `

      <div class="from">
        CONNECTION ERROR
      </div>


      <div class="answer-text">

        <p>
          We couldn't reach the health assistant right now.
        </p>


        <p>
          Please check the connection and try again.
        </p>

      </div>
    `;


    if (fromVoice) {

      speakText(
        "We couldn't reach the health assistant right now. Please check the connection and try again.",
        () => {

          if (
            conversationRequest &&
            conversationShouldContinue
          ) {
            startConversationListening();
          }

        }
      );
    }
  }
}


/* ========================================================================
   START APPLICATION
   ======================================================================== */

boot();
```
