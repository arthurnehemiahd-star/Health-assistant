/* ------------------------------------------------------------------------
   FRONTEND LOGIC
   Every fact about topics, FAQ/AI answers, and account/session detail
   comes from the backend via fetch(`${API_BASE}/api/...`). Nothing here
   hardcodes health content or stores passwords — this file only renders
   whatever the API returns.

   Structure:
     - Not logged in  -> renderGate() : a login/signup card, nothing else
                          reachable until the person signs in.
     - Logged in      -> renderApp()  : the normal sidebar + pages UI.
------------------------------------------------------------------------ */

// API_BASE comes from config.js, loaded before this file.

// credentials: 'include' is required on every call — it's what makes
// the browser send/receive the login session cookie even though the
// frontend and backend are on two different domains once deployed.
const API = {
  topics: () => fetch(`${API_BASE}/api/topics`, {credentials: 'include'}).then(r => r.json()),
  topic: (id) => fetch(`${API_BASE}/api/topics/${id}`, {credentials: 'include'}).then(r => r.json()),
  ask: (q) => fetch(`${API_BASE}/api/ask?q=${encodeURIComponent(q)}`, {credentials: 'include'}).then(r => r.json()),
  me: () => fetch(`${API_BASE}/api/auth/me`, {credentials: 'include'}).then(r => r.json()),
  signup: (username, email, password) => fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST", headers: {"Content-Type":"application/json"}, credentials: 'include',
    body: JSON.stringify({username, email, password})
  }).then(async r => ({ ok: r.ok, data: await r.json() })),
  login: (username, password) => fetch(`${API_BASE}/api/auth/login`, {
    method: "POST", headers: {"Content-Type":"application/json"}, credentials: 'include',
    body: JSON.stringify({username, password})
  }).then(async r => ({ ok: r.ok, data: await r.json() })),
  logout: () => fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: 'include' }).then(r => r.json()),
  changePassword: (current_password, new_password) => fetch(`${API_BASE}/api/auth/change-password`, {
    method: "POST", headers: {"Content-Type":"application/json"}, credentials: 'include',
    body: JSON.stringify({current_password, new_password})
  }).then(async r => ({ ok: r.ok, data: await r.json() })),
  forgotPassword: (email) => fetch(`${API_BASE}/api/auth/forgot-password`, {
    method: "POST", headers: {"Content-Type":"application/json"}, credentials: 'include',
    body: JSON.stringify({email})
  }).then(async r => ({ ok: r.ok, data: await r.json() })),
  history: () => fetch(`${API_BASE}/api/history`, {credentials: 'include'}).then(r => r.json()),
};

const root = document.getElementById("root");

let TOPICS = [];
let USER = null;      // { id, username, email } or null
let current = "home";

async function boot(){
  const me = await API.me();
  USER = me.user;
  if(USER){
    TOPICS = await API.topics();
    renderApp();
  } else {
    renderGate();
  }
}

/* ==========================================================================
   AUTH GATE — shown before login/signup. Nothing else is reachable.
========================================================================== */

let gateMode = "login"; // "login" | "signup" | "forgot"

function renderGate(){
  root.innerHTML = `
    <div class="gate-wrap">
      <div class="gate-visual">
        <img src="images/hero.jpg" alt="">
        <div class="gate-scrim"></div>
        <div class="gate-visual-brand">
          <div class="mark">+</div>
          <div class="name">Your Simple<br>Health Assistant</div>
        </div>
        <div class="gate-tagline">
          <h2>Health awareness, made simple.</h2>
          <p>Practical, everyday guidance on hygiene, nutrition, exercise, and more — right when you need it.</p>
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

function renderGateBody(){
  const body = document.getElementById("gateBody");

  if(gateMode === "forgot"){
    body.innerHTML = `
      <button class="gate-back" id="gateBackBtn">← Back to log in</button>
      <h1 style="font-size:20px;">Forgot your password?</h1>
      <p class="lede" style="font-size:13.5px; margin-top:8px;">Enter the email you signed up with and we'll send a reset link to it.</p>
      <div class="auth-card" style="margin-top:16px; padding:0; border:none;">
        <form id="forgotForm">
          <label for="forgotEmail">Email</label>
          <input id="forgotEmail" type="email" autocomplete="email" required />
          <button type="submit" class="submit-btn">Send reset link</button>
          <div class="error-msg" id="forgotError"></div>
          <div class="success-msg" id="forgotSuccess"></div>
        </form>
      </div>
    `;
    document.getElementById("gateBackBtn").addEventListener("click", ()=>{
      gateMode = "login";
      renderGateBody();
    });
    document.getElementById("forgotForm").addEventListener("submit", async (e)=>{
      e.preventDefault();
      const errorBox = document.getElementById("forgotError");
      const successBox = document.getElementById("forgotSuccess");
      errorBox.textContent = "";
      successBox.textContent = "";
      const email = document.getElementById("forgotEmail").value.trim();

      const result = await API.forgotPassword(email);
      if(!result.ok){
        errorBox.textContent = result.data.error || "Something went wrong.";
        return;
      }
      successBox.textContent = result.data.message || "If that email is registered, a reset link has been sent.";
    });
    return;
  }

  // login or signup
  const isLogin = gateMode === "login";
  body.innerHTML = `
    <div class="gate-tabs">
      <button class="gate-tab ${isLogin ? 'active' : ''}" id="tabLogin">Log in</button>
      <button class="gate-tab ${!isLogin ? 'active' : ''}" id="tabSignup">Sign up</button>
    </div>
    <p class="lede" style="font-size:13.5px; margin-bottom:8px;">
      ${isLogin ? "Log in to pick up where you left off." : "Create an account so your question history is saved for next time."}
    </p>
    <div class="auth-card" style="padding:0; border:none;">
      <form id="gateForm">
        <label for="gateUsername">Username</label>
        <input id="gateUsername" type="text" autocomplete="username" required />
        ${isLogin ? "" : `
        <label for="gateEmail">Email</label>
        <input id="gateEmail" type="email" autocomplete="email" required />
        `}
        <label for="gatePassword">Password</label>
        <input id="gatePassword" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required />
        <button type="submit" class="submit-btn">${isLogin ? "Log in" : "Create account"}</button>
        <div class="error-msg" id="gateError"></div>
      </form>
      ${isLogin ? `<button class="gate-link" id="forgotLinkBtn">Forgot password?</button>` : ""}
    </div>
  `;

  document.getElementById("tabLogin").addEventListener("click", ()=>{ gateMode = "login"; renderGateBody(); });
  document.getElementById("tabSignup").addEventListener("click", ()=>{ gateMode = "signup"; renderGateBody(); });
  if(isLogin){
    document.getElementById("forgotLinkBtn").addEventListener("click", ()=>{ gateMode = "forgot"; renderGateBody(); });
  }

  document.getElementById("gateForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const errorBox = document.getElementById("gateError");
    errorBox.textContent = "";
    const username = document.getElementById("gateUsername").value.trim();
    const password = document.getElementById("gatePassword").value;

    let result;
    if(isLogin){
      result = await API.login(username, password);
    } else {
      const email = document.getElementById("gateEmail").value.trim();
      result = await API.signup(username, email, password);
    }

    if(!result.ok){
      errorBox.textContent = result.data.error || "Something went wrong.";
      return;
    }
    USER = result.data.user;
    TOPICS = await API.topics();
    renderApp();
  });
}

/* ==========================================================================
   MAIN APP — only ever rendered once USER is set.
========================================================================== */

function renderApp(){
  root.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <div class="mark">+</div>
          <div class="name">Your Simple<br>Health Assistant</div>
          <div class="sub">Health awareness, made simple</div>
        </div>
        <nav id="nav"></nav>
        <div class="account-box" id="accountBox"></div>
      </aside>
      <main id="main"><div class="loading">Loading…</div></main>
    </div>
  `;
  renderNav();
  renderAccountBox();
  goTo("home");
}

function renderNav(){
  const nav = document.getElementById("nav");
  const items = [{id:"home", icon:"🏠", name:"Home"}, ...TOPICS.map(t=>({id:t.id, icon:t.icon, name:t.name})), {id:"ask", icon:"💬", name:"Ask"}];
  nav.innerHTML = items.map(it => `
    <button class="nav-btn ${it.id===current?'active':''}" data-goto="${it.id}">
      <span class="dot"></span>${it.name}
    </button>
  `).join("");
  nav.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> goTo(btn.dataset.goto));
  });
}

function renderAccountBox(){
  const box = document.getElementById("accountBox");
  box.innerHTML = `
    <div class="who">👤 ${USER.username}</div>
    <div class="foot-note">Your questions are saved to your account.</div>
    <button class="link" id="accountLinkBtn">Account</button>
    <button class="link" id="logoutBtn">Sign out</button>
  `;
  document.getElementById("accountLinkBtn").addEventListener("click", ()=> goTo("account"));
  document.getElementById("logoutBtn").addEventListener("click", async ()=>{
    await API.logout();
    USER = null;
    gateMode = "login";
    renderGate();
  });
}

function homeHTML(){
  return `
  <section class="page active">
    <div class="hero">
      <div class="eyebrow-row">Simple Health Assistant</div>
      <h1>Basic health information, organized simply.</h1>
      <p class="lede">A small digital tool covering everyday health topics and questions — hygiene, nutrition, exercise, common illnesses, disease prevention, and a lot in between — built to make health awareness easier to access and understand.</p>
      <div class="hero-row">
        <div class="pill"><b>5</b> health topics</div>
        <div class="pill"><b>30+</b> specific questions answered</div>
        <div class="pill"><b>1</b> built-in assistant</div>
      </div>
    </div>
    <div class="section-title">BROWSE TOPICS</div>
    <div class="topic-grid">
      ${TOPICS.map(t=>`
        <button class="topic-card" data-goto="${t.id}">
          <div class="icon">${t.icon}</div>
          <h3>${t.name}</h3>
          <p>${t.short}</p>
        </button>
      `).join("")}
    </div>
  </section>`;
}

async function topicHTML(id){
  const t = await API.topic(id);
  return `
  <section class="page active">
    <div class="topic-header">
      <div class="icon-lg">${t.icon}</div>
      <div>
        <h1>${t.name}</h1>
        <p>${t.intro}</p>
      </div>
    </div>
    <div class="section-title">KEY TIPS</div>
    <ul class="tip-list">
      ${t.tips.map(tip=>`<li>${tip}</li>`).join("")}
    </ul>
    <div class="fact-box">
      <div class="label">DID YOU KNOW</div>
      <p>${t.fact}</p>
    </div>
  </section>`;
}

async function askHTML(){
  let historyBlock = "";
  const history = await API.history();
  if(history.length){
    historyBlock = `
      <div class="section-title">YOUR RECENT QUESTIONS</div>
      <ul class="history-list">
        ${history.map(h => `<li><b>${h.topic ? h.topic.icon + " " + h.topic.name : "No match"}</b> — ${h.question}</li>`).join("")}
      </ul>
    `;
  }
  return `
  <section class="page active">
    <div class="eyebrow-row">Ask the assistant</div>
    <h1>What would you like to know?</h1>
    <p class="lede" style="margin-top:10px;">Ask anything concerning health — a symptom, a habit, first aid, or general wellbeing — in your own words. Your questions are saved to your account.</p>
    <div class="ask-box">
      <div class="ask-row">
        <input id="askInput" type="text" placeholder="e.g. what should I do for a headache?" />
        <button id="askBtn">Ask</button>
      </div>
      <div class="suggest-row">
        <button class="suggest-chip" data-q="What should I do for a headache?">Headache?</button>
        <button class="suggest-chip" data-q="How do I treat a burn?">Treating a burn?</button>
        <button class="suggest-chip" data-q="Signs of malaria?">Signs of malaria?</button>
        <button class="suggest-chip" data-q="I can't sleep, what can I do?">Trouble sleeping?</button>
        <button class="suggest-chip" data-q="How do I lower my stress?">Managing stress?</button>
      </div>
      <div class="answer" id="answerBox"></div>
    </div>
    ${historyBlock}
    <div class="disclaimer">This assistant gives general health information only. For diagnosis or treatment of any medical concern, please consult a qualified health professional.</div>
  </section>`;
}

function accountHTML(){
  return `
  <section class="page active">
    <div class="eyebrow-row">Account</div>
    <h1>Hi, ${USER.username}.</h1>
    <p class="lede" style="margin-top:10px;">You're logged in as ${USER.email}. Your question history is saved automatically — visit the Ask page to see it.</p>

    <div class="section-title">CHANGE PASSWORD</div>
    <div class="auth-card">
      <form id="pwForm">
        <label for="currentPw">Current password</label>
        <input id="currentPw" type="password" autocomplete="current-password" required />
        <label for="newPw">New password</label>
        <input id="newPw" type="password" autocomplete="new-password" required />
        <label for="confirmPw">Confirm new password</label>
        <input id="confirmPw" type="password" autocomplete="new-password" required />
        <button type="submit" class="submit-btn">Update password</button>
        <div class="error-msg" id="pwError"></div>
        <div class="success-msg" id="pwSuccess"></div>
      </form>
    </div>
  </section>`;
}

function wireAccountPage(){
  const pwForm = document.getElementById("pwForm");
  const pwError = document.getElementById("pwError");
  const pwSuccess = document.getElementById("pwSuccess");
  pwForm.addEventListener("submit", async (e)=>{
    e.preventDefault();
    pwError.textContent = "";
    pwSuccess.textContent = "";
    const current_password = document.getElementById("currentPw").value;
    const new_password = document.getElementById("newPw").value;
    const confirm_password = document.getElementById("confirmPw").value;

    if(new_password !== confirm_password){
      pwError.textContent = "New passwords don't match.";
      return;
    }
    const result = await API.changePassword(current_password, new_password);
    if(!result.ok){
      pwError.textContent = result.data.error || "Something went wrong.";
      return;
    }
    pwSuccess.textContent = "Password updated.";
    pwForm.reset();
  });
}

async function goTo(id){
  current = id;
  renderNav();
  const main = document.getElementById("main");

  if(id === "home"){
    main.innerHTML = homeHTML();
  } else if(id === "ask"){
    main.innerHTML = '<div class="loading">Loading…</div>';
    main.innerHTML = await askHTML();
  } else if(id === "account"){
    main.innerHTML = accountHTML();
    wireAccountPage();
  } else {
    main.innerHTML = '<div class="loading">Loading…</div>';
    main.innerHTML = await topicHTML(id);
  }

  main.querySelectorAll("[data-goto]").forEach(el=>{
    el.addEventListener("click", ()=> goTo(el.dataset.goto));
  });

  if(id === "ask"){
    document.getElementById("askBtn").addEventListener("click", handleAsk);
    document.getElementById("askInput").addEventListener("keydown", e=>{
      if(e.key === "Enter") handleAsk();
    });
    document.querySelectorAll(".suggest-chip").forEach(chip=>{
      chip.addEventListener("click", ()=>{
        document.getElementById("askInput").value = chip.dataset.q;
         function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function renderMarkdown(text) {
    if (!text) {
        return "";
    }

    const lines = String(text).replace(/\r\n/g, "\n").split("\n");

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

        const content = paragraph.join(" ").trim();

        if (content) {
            html += `<p>${formatInlineMarkdown(content)}</p>`;
        }

        paragraph = [];
    }

    function formatInlineMarkdown(value) {
        let result = escapeHtml(value);

        // Bold: **text**
        result = result.replace(
            /\*\*(.+?)\*\*/g,
            "<strong>$1</strong>"
        );

        // Italic: *text*
        result = result.replace(
            /(^|[^*])\*([^*]+)\*(?!\*)/g,
            "$1<em>$2</em>"
        );

        // Inline code: `text`
        result = result.replace(
            /`([^`]+)`/g,
            "<code>$1</code>"
        );

        return result;
    }

    for (const rawLine of lines) {
        const line = rawLine.trim();

        // Empty line = new paragraph/section
        if (!line) {
            closeParagraph();
            closeList();
            continue;
        }

        // ## Heading
        if (line.startsWith("## ")) {
            closeParagraph();
            closeList();

            html += `<h2>${formatInlineMarkdown(
                line.substring(3)
            )}</h2>`;

            continue;
        }

        // ### Heading
        if (line.startsWith("### ")) {
            closeParagraph();
            closeList();

            html += `<h3>${formatInlineMarkdown(
                line.substring(4)
            )}</h3>`;

            continue;
        }

        // Bullet list
        const bulletMatch = line.match(/^[-*]\s+(.+)$/);

        if (bulletMatch) {
            closeParagraph();

            if (listType !== "ul") {
                closeList();
                html += "<ul>";
                listType = "ul";
            }

            html += `<li>${formatInlineMarkdown(
                bulletMatch[1]
            )}</li>`;

            continue;
        }

        // Numbered list
        const numberedMatch = line.match(/^\d+\.\s+(.+)$/);

        if (numberedMatch) {
            closeParagraph();

            if (listType !== "ol") {
                closeList();
                html += "<ol>";
                listType = "ol";
            }

            html += `<li>${formatInlineMarkdown(
                numberedMatch[1]
            )}</li>`;

            continue;
        }

        // Normal text
        closeList();
        paragraph.push(line);
    }

    closeParagraph();
    closeList();

    return html;
}
        handleAsk();
      });
    });
  }
  window.scrollTo(0,0);
}

async function handleAsk(){
  const val = document.getElementById("askInput").value.trim();
  const box = document.getElementById("answerBox");
  if(!val) return;

  box.innerHTML = '<div class="loading">Thinking…</div>';
  box.classList.add("show");

  const result = await API.ask(val);

  if(!result.matched){
    box.innerHTML = `
      <div class="from">NO MATCH FOUND</div>
      <p style="font-size:14.5px; color:var(--ink-soft);">Try rephrasing, or browse a topic directly using the menu on the left — hygiene, nutrition, exercise, common illnesses, or disease prevention.</p>
    `;
    return;
  }

  if(result.kind === "faq"){
    box.innerHTML = `
      <div class="from">${result.topic.icon} ${result.topic.name}</div>
      <p class="answer-text">${result.answer}</p>
      <div style="margin-top:12px;">
        <button class="suggest-chip" data-goto="${result.topic.id}">More on ${result.topic.name.toLowerCase()} →</button>
      </div>
    `;
    box.querySelector("[data-goto]").addEventListener("click", ()=> goTo(result.topic.id));
  } else if(result.kind === "ai"){
    box.innerHTML = `
      <div class="from">💬 ASSISTANT</div>
      <p class="answer-text">${result.answer}</p>
    `;
  } else {
    box.innerHTML = `
      <div class="from">${result.topic.icon} ${result.topic.name}</div>
      <ul class="tip-list">${result.tips.map(tip=>`<li>${tip}</li>`).join("")}</ul>
      <div style="margin-top:12px;">
        <button class="suggest-chip" data-goto="${result.topic.id}">See all ${result.topic.name.toLowerCase()} tips →</button>
      </div>
    `;
    box.querySelector("[data-goto]").addEventListener("click", ()=> goTo(result.topic.id));
  }
}

boot();
