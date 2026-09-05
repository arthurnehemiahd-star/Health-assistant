# Your Simple Health Assistant

This project is split into two independently-deployed parts:

```
health_assistant/
├── backend/          ← Deploy to Render, Railway, or similar (needs persistent disk)
│   ├── app.py
│   └── requirements.txt
└── frontend/          ← Deploy to Vercel (plain static site)
    ├── index.html
    ├── reset-password.html
    ├── css/style.css
    ├── js/config.js   ← the ONE file you edit after deploying the backend
    ├── js/app.js
    ├── images/hero.jpg
    ├── vercel.json
    └── favicon files
```

## Why two different hosts?

Vercel runs Python as serverless functions with an **ephemeral
filesystem** — the SQLite database this app uses to store accounts,
sessions, and question history would not reliably persist there.

So: the **frontend** (pure HTML/CSS/JS, no database) goes on Vercel,
where it's a perfect fit. The **backend** (Flask + SQLite) goes on a host
that keeps a normal always-on server with persistent storage — Render
and Railway both have free tiers that work well for this.

## Deploy order

**1. Deploy the backend first** (e.g. Render):
   - Push the `backend/` folder as its own repo (or point Render at the
     `backend/` subfolder of a monorepo).
   - Start command: `gunicorn app:app`
   - Set environment variables (see the comments at the top of `app.py`
     for full details on each):
     - `SECRET_KEY` — a long random string
     - `FRONTEND_ORIGIN` — your Vercel URL (you'll get this in step 2 —
       it's fine to redeploy the backend once you have it)
     - `APP_BASE_URL` — same as `FRONTEND_ORIGIN`
     - `SMTP_EMAIL` / `SMTP_APP_PASSWORD` — optional, for "forgot
       password" emails (see setup instructions in `app.py`)
     - `GEMINI_API_KEY` — optional, for free "ask anything" AI answers
       (see setup instructions in `app.py`)
   - Note the resulting URL, e.g. `https://your-app.onrender.com`

**2. Point the frontend at the backend:**
   - Open `frontend/js/config.js` and change:
     ```js
     const API_BASE = "https://your-app.onrender.com";
     ```

**3. Deploy the frontend to Vercel:**
   - Push the `frontend/` folder (Vercel auto-detects it as a static
     site — no build step needed).
   - Note the resulting URL, e.g. `https://your-app.vercel.app`

**4. Go back and set `FRONTEND_ORIGIN`/`APP_BASE_URL`** on the backend
   to that real Vercel URL, then redeploy the backend so CORS and the
   password-reset email links point to the right place.

## Testing locally before you deploy anything

1. `cd backend && pip install -r requirements.txt && python3 app.py`
   → API runs at `http://127.0.0.1:5000`
2. Leave `frontend/js/config.js` as `http://127.0.0.1:5000` (the default)
3. Open `frontend/index.html` directly in a browser, or serve the folder
   with `python3 -m http.server 5500` from inside `frontend/`.

Everything — signup, login, forgot password, the FAQ/AI assistant, and
the new login screen hero image — works locally exactly the same way it
will once deployed.
