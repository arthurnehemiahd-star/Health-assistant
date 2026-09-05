"""
================================================================================
 YOUR SIMPLE HEALTH ASSISTANT — BACKEND (deploy separately from the frontend)
 A Creative Digital Tool for Improving Health Awareness and Better Development
================================================================================

This file is the WHOLE backend — a pure JSON API. It contains:
  - The health content (topics + a broad FAQ knowledge base)
  - The SQLite database layer (users, ask-history, password-reset tokens)
  - Every Flask route, all under /api/... — this file returns JSON only.
    It does NOT serve any HTML, CSS, or JS.

The FRONTEND is a completely separate static site (in a sibling
`frontend/` folder) meant to be deployed to Vercel. Because the frontend
and backend live on different domains once deployed, this file enables
CORS with credentials so the browser can still send the login session
cookie across origins.

--------------------------------------------------------------------------------
WHY THE BACKEND CAN'T ALSO GO ON VERCEL
--------------------------------------------------------------------------------
Vercel runs Python code as serverless functions with an EPHEMERAL
filesystem — each request can hit a different, short-lived container, so
a local SQLite file (health_assistant.db) will NOT reliably persist
accounts, sessions, or history there. That's not a Flask limitation,
it's how Vercel's serverless platform works.

So: deploy the FRONTEND (frontend/ folder) to Vercel — that part is a
perfect fit, it's just static files. Deploy this BACKEND to a host with a
persistent disk instead, such as Render or Railway (both have free
tiers). They run this exact file as a normal, always-on server, so
SQLite works fine.

--------------------------------------------------------------------------------
RUN LOCALLY
--------------------------------------------------------------------------------
    pip install -r requirements.txt
    python3 app.py
    -> API is now at http://127.0.0.1:5000/api/...
    (a health_assistant.db SQLite file is created automatically next to
     this script the first time you run it)

To use it with the frontend locally: open frontend/index.html directly
in a browser (or serve the frontend/ folder with any static file server)
— it already points at http://127.0.0.1:5000 by default (see API_BASE at
the top of frontend/js/app.js).

--------------------------------------------------------------------------------
DEPLOY THE BACKEND (Render / Railway / PythonAnywhere)
--------------------------------------------------------------------------------
Start command:
    gunicorn app:app

Required environment variables:
    SECRET_KEY        A long random string — keeps login sessions secure
                       and consistent across restarts. Generate one with:
                       python3 -c "import secrets; print(secrets.token_hex(32))"
    FRONTEND_ORIGIN   The exact URL of your deployed Vercel frontend, e.g.
                       https://your-app-name.vercel.app
                       (needed for CORS — see below)
    APP_BASE_URL      Same as FRONTEND_ORIGIN — used to build the link
                       inside password-reset emails, since that page now
                       lives on the frontend, not here.

--------------------------------------------------------------------------------
CORS & CROSS-SITE COOKIES
--------------------------------------------------------------------------------
Since the frontend (Vercel) and backend (Render/Railway) are on different
domains, two things are required for login sessions to work at all:
  1. CORS must explicitly allow the frontend's origin, with credentials
     enabled (already set up below via flask-cors).
  2. The session cookie must be sent with SameSite=None; Secure — which
     requires HTTPS. Both Vercel and Render/Railway serve over HTTPS by
     default, so this works automatically once deployed. (Note: this
     means cookie-based login won't work if you test the deployed
     backend from a plain http:// page.)

--------------------------------------------------------------------------------
OPTIONAL: TRUE "ASK ANYTHING" AI ANSWERS — FREE, NO BILLING REQUIRED
--------------------------------------------------------------------------------
By default, questions are answered from a local, free, offline FAQ + topic
list (see FAQ / TOPIC_KEYWORDS below). To let the assistant answer genuinely
ANY health question — not just the ones built in — this uses Google's
Gemini API, which has a standing FREE tier (no credit card required):

    1. Go to https://aistudio.google.com/apikey and create a free API key
       with your Google account.
    2. Set it as an environment variable (never hardcode it in this file):

           GEMINI_API_KEY=your-key-here

When this is set, any question that doesn't match the local FAQ is sent to
Gemini and answered live, at no cost within the free daily quota. With no
key set, the app still works exactly as before, answering from the local
FAQ/topics only — nothing breaks if you skip this step.

Free-tier quotas are set by Google and can change — check current limits
at https://ai.google.dev/gemini-api/docs/rate-limits before relying on a
specific number for a live deployment with many users.

--------------------------------------------------------------------------------
FORGOT PASSWORD — SENDING RESET EMAILS VIA GMAIL
--------------------------------------------------------------------------------
"Forgot password" sends the user a reset link by email, using a Gmail
account you control as the sender. Gmail will NOT accept your normal login
password for this — you need an "App Password":

    1. Turn on 2-Step Verification on the Gmail account you'll send from:
       https://myaccount.google.com/security
    2. Create an App Password: https://myaccount.google.com/apppasswords
       (choose "Mail" as the app). Google gives you a 16-character code.
    3. Set these environment variables (never hardcode them in this file):

           SMTP_EMAIL=youraddress@gmail.com
           SMTP_APP_PASSWORD=the16charactercode

The reset link now points to the FRONTEND's reset-password page (since
that page lives on Vercel, not here), using APP_BASE_URL:

           APP_BASE_URL=https://your-app-name.vercel.app

With no SMTP_EMAIL/SMTP_APP_PASSWORD set, "forgot password" still runs
without crashing — it just can't actually send the email, so the reset
link only appears in the server log (useful for local testing).
================================================================================
"""

import os
import re
import sqlite3
import secrets
import smtplib
from email.mime.text import MIMEText
from datetime import timedelta, datetime, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, request, session
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "health_assistant.db"

# The deployed frontend's URL (Vercel). Falls back to a typical local dev
# address so `python3 app.py` + opening frontend/index.html locally just
# works without any setup.
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://127.0.0.1:5500")
APP_BASE_URL = os.environ.get("APP_BASE_URL", FRONTEND_ORIGIN)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))
app.permanent_session_lifetime = timedelta(days=30)

# Cross-site session cookie: required because the frontend (Vercel) and
# this backend (Render/Railway) are on different domains once deployed.
# SameSite=None + Secure is what lets the browser send the cookie
# cross-origin at all — but Secure cookies are only ever sent over
# HTTPS, so this only applies once FRONTEND_ORIGIN is a real https://
# deployment. Locally (http://127.0.0.1:...) we fall back to normal
# cookie behavior so login still works while testing before you deploy.
_frontend_is_https = FRONTEND_ORIGIN.startswith("https://")
app.config.update(
    SESSION_COOKIE_SAMESITE="None" if _frontend_is_https else "Lax",
    SESSION_COOKIE_SECURE=_frontend_is_https,
)


# ==============================================================================
# CORS — implemented directly with Flask hooks (no extra dependency).
# Only the configured FRONTEND_ORIGIN is allowed, and credentials (the
# session cookie) are permitted, which is what lets a separately-hosted
# frontend stay logged in against this API.
# ==============================================================================

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        return app.make_default_options_response()


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = FRONTEND_ORIGIN
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


# ==============================================================================
# DATA LAYER — health content
# ==============================================================================

TOPICS = [
    {
        "id": "hygiene", "icon": "🧼", "name": "Hygiene",
        "short": "Daily habits that stop germs spreading.",
        "intro": "Good hygiene is one of the simplest, cheapest ways to prevent "
                 "illness. A few consistent daily habits make the biggest difference.",
        "tips": [
            "Wash your hands with soap for at least 20 seconds, especially before eating and after using the toilet.",
            "Brush your teeth twice a day and floss regularly to prevent gum disease and cavities.",
            "Bathe daily and change into clean clothes, especially after sweating.",
            "Cover your mouth and nose with your elbow (not your hand) when you cough or sneeze.",
            "Keep your nails short and clean to stop dirt and germs collecting under them.",
            "Clean and disinfect shared surfaces like doorknobs, phones, and desks regularly.",
        ],
        "fact": "The single most effective hygiene habit for preventing disease is handwashing with soap — it can reduce diarrheal illness by around 30%.",
    },
    {
        "id": "nutrition", "icon": "🥗", "name": "Nutrition",
        "short": "Eating well to fuel your body properly.",
        "intro": "Balanced nutrition supports energy, growth, immunity, and long-term health. It's about consistent balance, not perfection.",
        "tips": [
            "Eat a variety of foods: vegetables, fruits, whole grains, proteins, and healthy fats.",
            "Drink plenty of clean water throughout the day — aim for 6 to 8 glasses.",
            "Limit added sugar, salt, and highly processed or fried foods.",
            "Eat regular meals rather than skipping meals, especially breakfast.",
            "Include local, seasonal fruits and vegetables — they're fresher and often cheaper.",
            "Watch portion sizes rather than eliminating entire food groups.",
        ],
        "fact": "A plate that's roughly half vegetables and fruit, a quarter protein, and a quarter whole grains is a simple, evidence-based way to balance most meals.",
    },
    {
        "id": "exercise", "icon": "🏃", "name": "Exercise",
        "short": "Moving your body to stay strong and well.",
        "intro": "Regular physical activity strengthens the heart, muscles, and mind. It doesn't need a gym — consistency matters more than intensity.",
        "tips": [
            "Aim for at least 30 minutes of moderate activity most days, like brisk walking.",
            "Mix cardio (running, cycling, walking) with strength activities (bodyweight exercises, carrying loads).",
            "Stretch before and after exercise to reduce the risk of injury.",
            "Take movement breaks if you sit for long periods — stand and stretch every hour.",
            "Choose activities you enjoy so it's easier to stay consistent.",
            "Rest and recover — sleep and rest days are part of a healthy exercise routine, not a break from it.",
        ],
        "fact": "Even short bursts of activity add up — three 10-minute walks give similar benefits to one 30-minute walk.",
    },
    {
        "id": "illnesses", "icon": "🩺", "name": "Common Illnesses",
        "short": "Recognizing everyday health problems early.",
        "intro": "Knowing the early signs of common illnesses helps you respond quickly and know when to seek professional care.",
        "tips": [
            "Colds and flu: watch for a runny nose, cough, sore throat, fatigue, and mild fever. Rest and fluids usually help.",
            "Malaria: fever, chills, headache, and body aches are warning signs — seek testing and treatment promptly in affected areas.",
            "Diarrheal illness: often caused by unsafe water or food; stay hydrated with oral rehydration solution and seek care if it persists.",
            "Skin infections: redness, swelling, or pus around a wound should be cleaned and monitored, and treated if it worsens.",
            "Headaches and fatigue: can signal dehydration, poor sleep, or stress — check the basics before assuming something more serious.",
            "Any severe, sudden, or worsening symptoms (difficulty breathing, high fever, severe pain) need urgent professional care.",
        ],
        "fact": "Many common illnesses share early symptoms like fatigue and mild fever — tracking how symptoms change over 24 to 48 hours helps distinguish minor issues from ones needing a doctor.",
    },
    {
        "id": "prevention", "icon": "🛡", "name": "Disease Prevention",
        "short": "Reducing your risk before problems start.",
        "intro": "Prevention is almost always more effective — and cheaper — than treatment. Small, consistent choices lower your risk significantly.",
        "tips": [
            "Keep vaccinations up to date for yourself and your family.",
            "Sleep for 7 to 9 hours a night to support your immune system.",
            "Store and prepare food safely to avoid foodborne illness.",
            "Use mosquito nets or repellents in areas where malaria or other mosquito-borne diseases are common.",
            "Avoid smoking and limit alcohol, both major risk factors for chronic disease.",
            "Go for regular health checkups, even when you feel well, to catch problems early.",
        ],
        "fact": "The World Health Organization estimates a large share of chronic disease worldwide is preventable through diet, activity, and avoiding tobacco alone.",
    },
]

TOPIC_KEYWORDS = {
    "hygiene": ["hygiene", "wash", "hand", "hands", "soap", "teeth", "brush", "bath", "clean", "germ", "germs", "nails"],
    "nutrition": ["nutrition", "food", "eat", "eating", "diet", "fruit", "vegetable", "vegetables", "sugar", "water", "meal", "meals"],
    "exercise": ["exercise", "workout", "run", "running", "walk", "walking", "fitness", "stretch", "gym", "active", "activity"],
    "illnesses": ["illness", "sick", "sickness", "cold", "flu", "fever", "malaria", "diarrhea", "diarrhoea", "headache", "infection", "disease", "symptom", "symptoms"],
    "prevention": ["prevent", "prevention", "vaccine", "vaccination", "sleep", "risk", "checkup", "smoking", "mosquito"],
}


def _topic_by_id(topic_id):
    return next((t for t in TOPICS if t["id"] == topic_id), None)


# A broader knowledge base of specific, everyday health questions — lets
# someone ask "almost anything concerning health" and get a direct answer,
# rather than only the 5 broad topics above.
FAQ = [
    {"id": "headache", "topic": "illnesses", "keywords": ["headache", "head ache", "migraine"],
     "answer": "Most headaches are caused by dehydration, stress, poor sleep, or eye strain. Rest in a quiet, dim room, drink water, and consider a mild pain reliever if needed. See a doctor if it's sudden and severe, follows a head injury, or comes with confusion, stiff neck, or vision changes."},
    {"id": "fever", "topic": "illnesses", "keywords": ["fever", "high temperature", "temperature"],
     "answer": "A fever is often the body fighting an infection. Rest, drink fluids, and dress lightly to help your body cool down. Seek medical care if a fever is above 39°C (102°F), lasts more than 3 days, or comes with severe symptoms like difficulty breathing or a rash."},
    {"id": "cough", "topic": "illnesses", "keywords": ["cough", "coughing"],
     "answer": "A cough is usually the body clearing irritants or mucus from the airway. Warm fluids, honey (for adults and children over 1 year), and rest often help. See a doctor if a cough lasts more than 2-3 weeks, brings up blood, or comes with chest pain or breathlessness."},
    {"id": "sore-throat", "topic": "illnesses", "keywords": ["sore throat", "throat pain", "throat hurts"],
     "answer": "A sore throat is commonly caused by viral infections, dry air, or allergies. Warm salt-water gargles, warm fluids, and rest usually help within a few days. See a doctor if it's severe, lasts over a week, or comes with high fever or difficulty swallowing."},
    {"id": "stomach-ache", "topic": "illnesses", "keywords": ["stomach ache", "stomachache", "stomach pain", "abdominal pain", "belly pain"],
     "answer": "Mild stomach pain is often linked to what you've eaten, gas, or stress, and often settles with rest and light food. Seek care promptly for severe or worsening pain, pain with fever or vomiting, or pain that doesn't improve after a day."},
    {"id": "diarrhea", "topic": "prevention", "keywords": ["diarrhea", "diarrhoea", "loose stool", "runny stomach"],
     "answer": "Diarrhea is often caused by unsafe water, food, or a stomach bug. The priority is staying hydrated — use oral rehydration solution (water, salt, and sugar) and continue eating light food. Seek care if it lasts more than 2 days, contains blood, or comes with signs of dehydration."},
    {"id": "food-poisoning", "topic": "prevention", "keywords": ["food poisoning", "bad food", "contaminated food"],
     "answer": "Food poisoning usually causes nausea, vomiting, or diarrhea within hours of eating contaminated food. Rest, sip fluids slowly, and avoid solid food until symptoms ease. Seek care if symptoms are severe, persistent, or you show signs of dehydration."},
    {"id": "dehydration", "topic": "nutrition", "keywords": ["dehydration", "dehydrated", "not drinking enough water"],
     "answer": "Signs of dehydration include thirst, dark urine, dry mouth, fatigue, and dizziness. Drink water steadily throughout the day rather than large amounts at once, and increase intake in hot weather or when unwell. Severe dehydration (confusion, no urination, rapid heartbeat) needs urgent care."},
    {"id": "cuts-wounds", "topic": "hygiene", "keywords": ["cut", "wound", "bleeding", "injury"],
     "answer": "For a minor cut: wash your hands, rinse the wound with clean water, apply gentle pressure with a clean cloth to stop bleeding, then cover with a clean dressing. Seek medical care for deep cuts, wounds that won't stop bleeding, or signs of infection like spreading redness or pus."},
    {"id": "burns", "topic": "hygiene", "keywords": ["burn", "burnt", "scald"],
     "answer": "For a minor burn: cool the area under cool (not ice-cold) running water for about 20 minutes, then cover loosely with a clean, non-fluffy dressing. Don't apply butter, oil, or ice. Seek urgent care for large burns, burns on the face or hands, or blistering."},
    {"id": "allergies", "topic": "prevention", "keywords": ["allergy", "allergies", "allergic reaction", "hives", "itchy skin"],
     "answer": "Mild allergic reactions (itching, sneezing, a mild rash) often respond to avoiding the trigger and antihistamines. Seek emergency care immediately for a severe reaction with swelling of the face or throat, difficulty breathing, or dizziness — this can be life-threatening."},
    {"id": "stress", "topic": "prevention", "keywords": ["stress", "stressed", "anxiety", "anxious", "overwhelmed"],
     "answer": "Ongoing stress can affect sleep, digestion, and immunity. Regular exercise, sleep, connecting with others, and breaking tasks into smaller steps can help manage it. If stress or anxiety is persistent and affecting daily life, talking to a counselor or health professional is a good next step."},
    {"id": "sleep", "topic": "prevention", "keywords": ["sleep", "insomnia", "can't sleep", "trouble sleeping", "tired"],
     "answer": "Most adults need 7 to 9 hours of sleep a night. A consistent bedtime, a dark and quiet room, and avoiding screens or caffeine before bed can improve sleep quality. See a doctor if poor sleep persists for weeks despite good habits."},
    {"id": "skin-rash", "topic": "illnesses", "keywords": ["rash", "skin rash", "itchy skin", "skin irritation"],
     "answer": "Many rashes come from irritation, allergies, heat, or mild infections and settle with gentle cleaning and avoiding the irritant. See a doctor if a rash spreads quickly, blisters, is very painful, or comes with fever."},
    {"id": "eye-strain", "topic": "prevention", "keywords": ["eye strain", "tired eyes", "screen time", "eyes hurt"],
     "answer": "Eye strain from screens is common — try the 20-20-20 rule: every 20 minutes, look at something 20 feet away for 20 seconds. Ensure good lighting and consider an eye check-up if discomfort continues."},
    {"id": "back-pain", "topic": "exercise", "keywords": ["back pain", "backache", "sore back"],
     "answer": "Mild back pain often improves with gentle movement, good posture, and avoiding heavy lifting for a few days — complete bed rest usually isn't recommended. See a doctor if pain is severe, spreads down a leg, or comes with numbness or loss of bladder control."},
    {"id": "blood-pressure", "topic": "prevention", "keywords": ["blood pressure", "hypertension", "bp"],
     "answer": "Healthy blood pressure habits include regular exercise, reducing salt intake, managing stress, and limiting alcohol. High blood pressure often has no symptoms, so regular checkups are the main way to catch it early."},
    {"id": "diabetes", "topic": "nutrition", "keywords": ["diabetes", "blood sugar", "sugar levels"],
     "answer": "Diabetes risk is lowered by maintaining a healthy weight, staying active, and limiting sugary and highly processed foods. Warning signs include excessive thirst, frequent urination, and fatigue — see a doctor for testing if these appear."},
    {"id": "common-cold", "topic": "illnesses", "keywords": ["common cold", "runny nose", "blocked nose", "stuffy nose"],
     "answer": "The common cold usually clears on its own within 7 to 10 days. Rest, fluids, and steam inhalation can ease symptoms. See a doctor if symptoms are severe, last longer than 10 days, or worsen after initially improving."},
    {"id": "insect-bites", "topic": "prevention", "keywords": ["insect bite", "mosquito bite", "bug bite", "bee sting"],
     "answer": "Clean the bite area and apply a cold compress to reduce swelling and itching; avoid scratching to prevent infection. Seek care for signs of a severe allergic reaction, or fever after a mosquito bite in a malaria-risk area."},
    {"id": "nosebleed", "topic": "illnesses", "keywords": ["nosebleed", "nose bleeding", "bleeding nose"],
     "answer": "For a nosebleed: sit upright, lean slightly forward, and pinch the soft part of your nose for about 10 minutes. Avoid tilting your head back. See a doctor if bleeding doesn't stop after 20 minutes or happens frequently."},
    {"id": "sunburn", "topic": "hygiene", "keywords": ["sunburn", "sun burn", "too much sun"],
     "answer": "For sunburn, cool the skin with a cool (not cold) compress, moisturize, and stay hydrated; avoid further sun exposure until it heals. Seek care for severe blistering, fever, or signs of heatstroke."},
    {"id": "ear-pain", "topic": "illnesses", "keywords": ["ear pain", "earache", "ear ache", "ear infection"],
     "answer": "Mild ear pain can come from fluid buildup, colds, or minor irritation and may ease with rest and a warm compress. See a doctor if pain is severe, comes with fever, discharge, or hearing changes, especially in young children."},
    {"id": "menstrual-cramps", "topic": "exercise", "keywords": ["period pain", "menstrual cramps", "period cramps"],
     "answer": "Mild period cramps often ease with a warm compress, gentle movement, and rest. See a doctor if pain is severe, disrupts daily life, or is unusual for you, as this can sometimes signal an underlying condition."},
    {"id": "child-fever", "topic": "illnesses", "keywords": ["baby fever", "child fever", "kid fever", "infant fever"],
     "answer": "For a feverish child, dress them lightly, offer fluids, and monitor their temperature and behavior. Seek urgent care for infants under 3 months with any fever, or any child with a very high fever, rash, difficulty breathing, or unusual drowsiness."},
    {"id": "vaccination", "topic": "prevention", "keywords": ["vaccine", "vaccination", "immunization", "immunisation"],
     "answer": "Vaccination schedules protect against many serious diseases and are usually available for free or low-cost at local health centers. Keep an up-to-date record and consult a health worker if you're unsure which vaccines are due."},
    {"id": "muscle-cramp", "topic": "exercise", "keywords": ["muscle cramp", "leg cramp", "cramping muscle"],
     "answer": "Muscle cramps are often caused by dehydration, overexertion, or low electrolytes. Gently stretch and massage the muscle, and drink water. Recurring cramps may be worth mentioning to a doctor."},
    {"id": "weight", "topic": "nutrition", "keywords": ["lose weight", "healthy weight", "gain weight", "weight loss"],
     "answer": "Sustainable weight management usually comes from a balanced diet, regular activity, and consistent sleep rather than extreme diets. For personalized targets, especially if you have a health condition, a doctor or nutritionist can advise safely."},
    {"id": "smoking", "topic": "prevention", "keywords": ["smoking", "quit smoking", "cigarettes", "tobacco"],
     "answer": "Quitting smoking rapidly lowers your risk of heart disease, cancer, and lung problems, with benefits starting within hours. Support such as counseling, nicotine replacement, or a quit-smoking program can significantly improve your chances of success."},
    {"id": "choking", "topic": "hygiene", "keywords": ["choking", "choke"],
     "answer": "If someone is choking and can't cough, speak, or breathe, give up to 5 firm back blows between the shoulder blades, followed by up to 5 abdominal thrusts, repeating until the object is cleared. Call emergency services immediately if the person cannot breathe."},
]


def _score(text, keywords):
    text = text.lower()
    return sum(1 for kw in keywords if kw in text)


def _match_faq(query):
    """Find the FAQ entry whose keywords best match the query."""
    best_entry, best_score = None, 0
    for entry in FAQ:
        s = _score(query, entry["keywords"])
        if s > best_score:
            best_entry, best_score = entry, s
    return best_entry


def _match_topic(query):
    """Fallback: match one of the 5 broad topics if no specific FAQ hit."""
    best_id, best_score = None, 0
    for topic_id, words in TOPIC_KEYWORDS.items():
        s = _score(query, words)
        if s > best_score:
            best_id, best_score = topic_id, s
    return _topic_by_id(best_id) if best_id else None


# ==============================================================================
# OPTIONAL AI LAYER — genuinely open-ended health Q&A via Google's Gemini
# API, which has a standing free tier (no billing required). Only used
# when GEMINI_API_KEY is set. Fails safely (returns None) on any error,
# so the caller always has a local fallback.
# ==============================================================================

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

AI_SYSTEM_PROMPT = (
    "You are the assistant inside 'Your Simple Health Assistant', a basic "
    "health-awareness tool. Answer the user's health question directly and "
    "in plain language, in 2-4 short sentences. "
    "Give general educational information only — never a diagnosis, a "
    "specific dosage, or a definitive treatment plan. "
    "Always end with a brief note to see a qualified health professional "
    "for anything serious, persistent, or urgent. "
    "If the question describes a medical emergency (e.g. severe bleeding, "
    "chest pain, difficulty breathing, suicidal thoughts), tell the person "
    "clearly to seek emergency help or a crisis line immediately, before "
    "anything else. "
    "If the question is not about health at all, say briefly that you can "
    "only help with health-related questions."
)


def ask_ai(question):
    """Send a question to the Gemini API (free tier) and return the answer
    text, or None if no API key is configured or the call fails for any
    reason (network error, rate limit, invalid key, etc)."""
    if not GEMINI_API_KEY:
        return None

    try:
        response = requests.post(
            GEMINI_URL,
            params={"key": GEMINI_API_KEY},
            headers={"content-type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [{"text": question}]}],
                "systemInstruction": {"parts": [{"text": AI_SYSTEM_PROMPT}]},
                "generationConfig": {"maxOutputTokens": 300, "temperature": 0.4},
            },
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()
        candidates = data.get("candidates", [])
        if not candidates:
            return None
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts).strip()
        return text or None
    except Exception:
        # Network error, bad key, rate limit, etc. — fail safely and let
        # the caller fall back to the local FAQ/topic matching instead.
        return None


# ==============================================================================
# EMAIL LAYER — sends "forgot password" reset links via Gmail SMTP.
# Requires SMTP_EMAIL + SMTP_APP_PASSWORD (see setup notes at the top of
# this file). Fails safely: if not configured, or the send fails, the
# reset link is written to the server log instead so local testing still
# works without email set up.
# ==============================================================================

SMTP_EMAIL = os.environ.get("SMTP_EMAIL")
SMTP_APP_PASSWORD = os.environ.get("SMTP_APP_PASSWORD")
# APP_BASE_URL is already defined near the top of this file (it's the
# frontend's URL) — reused here to build the link inside reset emails.

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def send_reset_email(to_email, reset_link):
    """Email a password-reset link to the user. Returns True if the email
    was actually sent, False otherwise (and logs the link either way so
    it's never lost during local development)."""
    print(f"[password reset] link for {to_email}: {reset_link}")

    if not SMTP_EMAIL or not SMTP_APP_PASSWORD:
        print("[password reset] SMTP_EMAIL / SMTP_APP_PASSWORD not set — email not sent.")
        return False

    subject = "Reset your Your Simple Health Assistant password"
    body = (
        "We received a request to reset your password.\n\n"
        f"Click this link to choose a new password:\n{reset_link}\n\n"
        "This link expires in 30 minutes. If you didn't request this, "
        "you can safely ignore this email."
    )
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = SMTP_EMAIL
    msg["To"] = to_email

    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
            server.sendmail(SMTP_EMAIL, [to_email], msg.as_string())
        return True
    except Exception as e:
        print(f"[password reset] failed to send email: {e}")
        return False


# ==============================================================================
# DATA LAYER — accounts & history (SQLite)
# ==============================================================================

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ask_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            question TEXT NOT NULL,
            matched_topic TEXT,
            asked_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    conn = get_db()
    row = conn.execute(
        "SELECT id, username, email, password_hash, created_at FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


# ==============================================================================
# API ROUTES  (all JSON, no HTML)
# ==============================================================================

@app.get("/api/topics")
def api_topics():
    summary = [
        {"id": t["id"], "icon": t["icon"], "name": t["name"], "short": t["short"]}
        for t in TOPICS
    ]
    return jsonify(summary)


@app.get("/api/topics/<topic_id>")
def api_topic_detail(topic_id):
    topic = _topic_by_id(topic_id)
    if topic is None:
        return jsonify({"error": "Topic not found"}), 404
    return jsonify(topic)


@app.get("/api/ask")
def api_ask():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "Missing query parameter 'q'"}), 400

    faq_hit = _match_faq(query)
    matched_topic_id = None

    if faq_hit:
        # Fast, free, offline path for questions we already have prepared.
        topic = _topic_by_id(faq_hit["topic"])
        matched_topic_id = faq_hit["topic"]
        result = {
            "matched": True,
            "kind": "faq",
            "question": query,
            "answer": faq_hit["answer"],
            "topic": {"id": topic["id"], "icon": topic["icon"], "name": topic["name"]},
        }
    else:
        # Nothing prepared matches — try the AI for a genuinely open-ended
        # answer (only runs if ANTHROPIC_API_KEY is configured).
        ai_answer = ask_ai(query)
        if ai_answer:
            result = {
                "matched": True,
                "kind": "ai",
                "question": query,
                "answer": ai_answer,
            }
        else:
            # No AI configured (or the call failed) — fall back to the
            # broad topic match so the app still gives *something* useful.
            topic = _match_topic(query)
            if topic:
                matched_topic_id = topic["id"]
                result = {
                    "matched": True,
                    "kind": "topic",
                    "topic": {"id": topic["id"], "icon": topic["icon"], "name": topic["name"]},
                    "tips": topic["tips"][:3],
                }
            else:
                result = {"matched": False}

    user = current_user()
    if user:
        conn = get_db()
        conn.execute(
            "INSERT INTO ask_history (user_id, question, matched_topic) VALUES (?, ?, ?)",
            (user["id"], query, matched_topic_id),
        )
        conn.commit()
        conn.close()

    return jsonify(result)


# ---- Auth ---------------------------------------------------------------

def _valid_password(pw):
    return len(pw) >= 6


@app.post("/api/auth/signup")
def api_signup():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters."}), 400
    if not EMAIL_RE.match(email):
        return jsonify({"error": "Please enter a valid email address."}), 400
    if not _valid_password(password):
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM users WHERE username = ? OR email = ?", (username, email)
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "That username or email is already registered."}), 409

    password_hash = generate_password_hash(password)
    cur = conn.execute(
        "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
        (username, email, password_hash),
    )
    conn.commit()
    user_id = cur.lastrowid
    conn.close()

    session.permanent = True
    session["user_id"] = user_id
    return jsonify({"user": {"id": user_id, "username": username, "email": email}}), 201


@app.post("/api/auth/login")
def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    conn = get_db()
    row = conn.execute(
        "SELECT id, username, email, password_hash FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()

    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "Incorrect username or password."}), 401

    session.permanent = True
    session["user_id"] = row["id"]
    return jsonify({"user": {"id": row["id"], "username": row["username"], "email": row["email"]}})


@app.post("/api/auth/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/auth/me")
def api_me():
    user = current_user()
    public_user = {"id": user["id"], "username": user["username"], "email": user["email"]} if user else None
    return jsonify({"user": public_user})


@app.post("/api/auth/change-password")
def api_change_password():
    user = current_user()
    if not user:
        return jsonify({"error": "Not logged in."}), 401

    data = request.get_json(silent=True) or {}
    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""

    if not check_password_hash(user["password_hash"], current_password):
        return jsonify({"error": "Current password is incorrect."}), 401
    if not _valid_password(new_password):
        return jsonify({"error": "New password must be at least 6 characters."}), 400

    new_hash = generate_password_hash(new_password)
    conn = get_db()
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user["id"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---- Forgot / reset password ---------------------------------------------

RESET_TOKEN_LIFETIME_MINUTES = 30


@app.post("/api/auth/forgot-password")
def api_forgot_password():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()

    # Always return the same generic message whether or not the email is
    # registered — this stops someone from using this endpoint to check
    # which emails have accounts.
    generic_response = jsonify({
        "ok": True,
        "message": "If that email is registered, a reset link has been sent.",
    })

    if not EMAIL_RE.match(email):
        return generic_response

    conn = get_db()
    row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        conn.close()
        return generic_response

    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_LIFETIME_MINUTES)).isoformat()
    conn.execute(
        "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
        (row["id"], token, expires_at),
    )
    conn.commit()
    conn.close()

    reset_link = f"{APP_BASE_URL.rstrip('/')}/reset-password?token={token}"
    send_reset_email(email, reset_link)

    return generic_response


@app.post("/api/auth/reset-password")
def api_reset_password():
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    new_password = data.get("new_password") or ""

    if not token:
        return jsonify({"error": "Missing reset token."}), 400
    if not _valid_password(new_password):
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    conn = get_db()
    row = conn.execute(
        "SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = ?",
        (token,),
    ).fetchone()

    if not row:
        conn.close()
        return jsonify({"error": "This reset link is invalid."}), 400
    if row["used"]:
        conn.close()
        return jsonify({"error": "This reset link has already been used."}), 400

    expires_at = datetime.fromisoformat(row["expires_at"])
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        conn.close()
        return jsonify({"error": "This reset link has expired. Please request a new one."}), 400

    new_hash = generate_password_hash(new_password)
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, row["user_id"]))
    conn.execute("UPDATE password_reset_tokens SET used = 1 WHERE id = ?", (row["id"],))
    conn.commit()
    conn.close()

    return jsonify({"ok": True})


@app.get("/api/history")
def api_history():
    user = current_user()
    if not user:
        return jsonify({"error": "Not logged in."}), 401

    conn = get_db()
    rows = conn.execute(
        """SELECT question, matched_topic, asked_at
           FROM ask_history WHERE user_id = ?
           ORDER BY asked_at DESC LIMIT 20""",
        (user["id"],),
    ).fetchall()
    conn.close()

    history = []
    for r in rows:
        topic = _topic_by_id(r["matched_topic"]) if r["matched_topic"] else None
        history.append({
            "question": r["question"],
            "asked_at": r["asked_at"],
            "topic": {"id": topic["id"], "icon": topic["icon"], "name": topic["name"]} if topic else None,
        })
    return jsonify(history)


# ==============================================================================
# ROOT ROUTE — just a plain-text health check, since this backend serves
# no HTML at all. Useful for confirming the deployment is alive (Render/
# Railway often ping "/" automatically) and for a quick sanity check in
# a browser. The actual app lives entirely on the frontend now.
# ==============================================================================

@app.get("/")
def health_check():
    return jsonify({
        "status": "ok",
        "service": "Your Simple Health Assistant — backend API",
        "note": "This is the API only. The app itself is the separate frontend.",
    })


# ==============================================================================
# ENTRY POINT
# ==============================================================================

init_db()

if __name__ == "__main__":
    # debug=True is fine for local development; hosts like Render/Railway
    # will instead run this via: gunicorn app:app
    app.run(debug=True)
