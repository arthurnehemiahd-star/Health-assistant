"""
================================================================================
 YOUR SIMPLE HEALTH ASSISTANT — BACKEND
 A Creative Digital Tool for Improving Health Awareness and Better Development
================================================================================

This file is the WHOLE backend — a pure JSON API.

Features:
  - Health topics + FAQ knowledge base
  - SQLite database
  - User accounts and authentication
  - Ask history
  - Password reset emails
  - Hugging Face AI
  - Automatic language matching
  - English, Luganda, Filipino, French, Spanish, German
  - Flask API routes under /api/...

LANGUAGE BEHAVIOR
--------------------------------------------------------------------------------

The user does NOT need to select a language.

English is the default.

If the user writes in:
    - Luganda
    - Filipino
    - French
    - Spanish
    - German

the AI is instructed to answer in that same language.

Example:

    User: French
    Assistant: French

    User: Luganda
    Assistant: Luganda

    User: Spanish
    Assistant: Spanish

If the language cannot be confidently identified, English is used.

The browser voice system is handled separately by the frontend.

--------------------------------------------------------------------------------
RUN LOCALLY
--------------------------------------------------------------------------------

    pip install -r requirements.txt
    python app.py

--------------------------------------------------------------------------------
RENDER
--------------------------------------------------------------------------------

Start command:

    gunicorn app:app

Required environment variables:

    SECRET_KEY
    FRONTEND_ORIGIN
    APP_BASE_URL

Hugging Face:

    HF_TOKEN
    HF_MODEL

Recommended model:

    openai/gpt-oss-120b

Password reset:

    SMTP_EMAIL
    SMTP_APP_PASSWORD

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

from flask import Flask, jsonify, request, session
from werkzeug.security import generate_password_hash, check_password_hash

from huggingface_hub import InferenceClient


# ==============================================================================
# PATHS / CONFIGURATION
# ==============================================================================

BASE_DIR = Path(__file__).resolve().parent

DB_PATH = BASE_DIR / "health_assistant.db"

FRONTEND_ORIGIN = os.environ.get(
    "FRONTEND_ORIGIN",
    "http://127.0.0.1:5500"
)

APP_BASE_URL = os.environ.get(
    "APP_BASE_URL",
    FRONTEND_ORIGIN
)


# ==============================================================================
# FLASK APP
# ==============================================================================

app = Flask(__name__)

app.secret_key = os.environ.get(
    "SECRET_KEY",
    secrets.token_hex(32)
)

app.permanent_session_lifetime = timedelta(days=30)

_frontend_is_https = FRONTEND_ORIGIN.startswith("https://")

app.config.update(
    SESSION_COOKIE_SAMESITE="None" if _frontend_is_https else "Lax",
    SESSION_COOKIE_SECURE=_frontend_is_https,
)


# ==============================================================================
# CORS
# ==============================================================================

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        return app.make_default_options_response()


@app.after_request
def add_cors_headers(response):

    response.headers["Access-Control-Allow-Origin"] = FRONTEND_ORIGIN

    response.headers["Access-Control-Allow-Credentials"] = "true"

    response.headers["Access-Control-Allow-Methods"] = (
        "GET, POST, OPTIONS"
    )

    response.headers["Access-Control-Allow-Headers"] = (
        "Content-Type"
    )

    return response


# ==============================================================================
# HEALTH TOPICS
# ==============================================================================

TOPICS = [
    {
        "id": "hygiene",
        "icon": "🧼",
        "name": "Hygiene",
        "short": "Daily habits that stop germs spreading.",
        "intro": (
            "Good hygiene is one of the simplest, cheapest ways to prevent "
            "illness. A few consistent daily habits make the biggest difference."
        ),
        "tips": [
            "Wash your hands with soap for at least 20 seconds, especially before eating and after using the toilet.",
            "Brush your teeth twice a day and floss regularly to prevent gum disease and cavities.",
            "Bathe regularly and change into clean clothes, especially after sweating.",
            "Cover your mouth and nose with your elbow when you cough or sneeze.",
            "Keep your nails short and clean to stop dirt and germs collecting under them.",
            "Clean and disinfect shared surfaces like doorknobs, phones, and desks regularly.",
        ],
        "fact": (
            "The single most effective hygiene habit for preventing disease "
            "is handwashing with soap."
        ),
    },

    {
        "id": "nutrition",
        "icon": "🥗",
        "name": "Nutrition",
        "short": "Eating well to fuel your body properly.",
        "intro": (
            "Balanced nutrition supports energy, growth, immunity, and "
            "long-term health. It's about consistent balance, not perfection."
        ),
        "tips": [
            "Eat a variety of foods: vegetables, fruits, whole grains, proteins, and healthy fats.",
            "Drink plenty of clean water throughout the day.",
            "Limit added sugar, salt, and highly processed or fried foods.",
            "Eat regular meals rather than skipping meals.",
            "Include local, seasonal fruits and vegetables when possible.",
            "Try to include different food groups rather than eliminating entire food groups.",
        ],
        "fact": (
            "A simple balanced meal can include vegetables or fruit, a protein "
            "source, and a grain or other source of carbohydrates."
        ),
    },

    {
        "id": "exercise",
        "icon": "🏃",
        "name": "Exercise",
        "short": "Moving your body to stay strong and well.",
        "intro": (
            "Regular physical activity strengthens the heart, muscles, and mind. "
            "It doesn't need a gym — consistency matters more than intensity."
        ),
        "tips": [
            "Aim for regular moderate activity such as brisk walking.",
            "Mix activities such as walking, running, cycling, or bodyweight exercises.",
            "Warm up before exercise and cool down afterward.",
            "Take movement breaks if you sit for long periods.",
            "Choose activities you enjoy so they're easier to maintain.",
            "Rest and recover — sleep and rest are part of a healthy routine.",
        ],
        "fact": (
            "Short periods of physical activity can add up throughout the day."
        ),
    },

    {
        "id": "illnesses",
        "icon": "🩺",
        "name": "Common Illnesses",
        "short": "Recognizing everyday health problems early.",
        "intro": (
            "Knowing the early signs of common illnesses helps you respond "
            "quickly and know when to seek professional care."
        ),
        "tips": [
            "Colds and flu can cause a runny nose, cough, sore throat, fatigue, and fever.",
            "Malaria can cause fever, chills, headache, and body aches and requires testing in affected areas.",
            "Diarrheal illness can cause dehydration, so fluids are important.",
            "Skin infections may cause redness, swelling, warmth, or discharge.",
            "Headaches and fatigue can sometimes be linked to dehydration, poor sleep, or stress.",
            "Severe, sudden, or worsening symptoms need professional medical attention.",
        ],
        "fact": (
            "Many illnesses share symptoms, so symptoms alone cannot always "
            "identify the exact cause."
        ),
    },

    {
        "id": "prevention",
        "icon": "🛡",
        "name": "Disease Prevention",
        "short": "Reducing your risk before problems start.",
        "intro": (
            "Prevention is one of the most effective ways to protect health. "
            "Small, consistent habits can make a meaningful difference."
        ),
        "tips": [
            "Keep vaccinations up to date.",
            "Get enough sleep and maintain a consistent sleep schedule.",
            "Store and prepare food safely.",
            "Use mosquito nets or other protection in malaria-risk areas.",
            "Avoid tobacco products.",
            "Attend appropriate health checkups.",
        ],
        "fact": (
            "Many health risks can be reduced through healthy habits, "
            "preventive care, and avoiding tobacco."
        ),
    },
]


# ==============================================================================
# TOPIC KEYWORDS
# ==============================================================================

TOPIC_KEYWORDS = {

    "hygiene": [
        "hygiene",
        "wash",
        "hand",
        "hands",
        "soap",
        "teeth",
        "brush",
        "bath",
        "clean",
        "germ",
        "germs",
        "nails",
    ],

    "nutrition": [
        "nutrition",
        "food",
        "eat",
        "eating",
        "diet",
        "fruit",
        "vegetable",
        "vegetables",
        "sugar",
        "water",
        "meal",
        "meals",
    ],

    "exercise": [
        "exercise",
        "workout",
        "run",
        "running",
        "walk",
        "walking",
        "fitness",
        "stretch",
        "gym",
        "active",
        "activity",
    ],

    "illnesses": [
        "illness",
        "sick",
        "sickness",
        "cold",
        "flu",
        "fever",
        "malaria",
        "diarrhea",
        "diarrhoea",
        "headache",
        "infection",
        "disease",
        "symptom",
        "symptoms",
    ],

    "prevention": [
        "prevent",
        "prevention",
        "vaccine",
        "vaccination",
        "sleep",
        "risk",
        "checkup",
        "smoking",
        "mosquito",
    ],
}


def _topic_by_id(topic_id):

    return next(
        (
            topic
            for topic in TOPICS
            if topic["id"] == topic_id
        ),
        None
    )


# ==============================================================================
# FAQ KNOWLEDGE BASE
# ==============================================================================

FAQ = [

    {
        "id": "headache",
        "topic": "illnesses",
        "keywords": [
            "headache",
            "head ache",
            "migraine",
        ],
        "answer": (
            "Most headaches are caused by things such as dehydration, stress, "
            "poor sleep, or eye strain. Rest, drink water, and give yourself "
            "time to recover. Seek medical care if a headache is sudden and "
            "severe, follows a head injury, or comes with confusion, stiff neck, "
            "vision changes, or other serious symptoms."
        ),
    },

    {
        "id": "fever",
        "topic": "illnesses",
        "keywords": [
            "fever",
            "high temperature",
            "temperature",
        ],
        "answer": (
            "A fever is often a sign that the body is responding to an infection. "
            "Rest, drink fluids, and avoid overheating. Seek medical advice if "
            "the fever is very high, lasts several days, or occurs with serious "
            "symptoms such as difficulty breathing, confusion, or a severe rash."
        ),
    },

    {
        "id": "cough",
        "topic": "illnesses",
        "keywords": [
            "cough",
            "coughing",
        ],
        "answer": (
            "A cough is usually the body's way of clearing irritants or mucus "
            "from the airway. Warm fluids, rest, and honey for people over "
            "1 year old may help. Medical advice is appropriate if the cough "
            "persists, becomes severe, or occurs with chest pain or breathing "
            "difficulty."
        ),
    },

    {
        "id": "sore-throat",
        "topic": "illnesses",
        "keywords": [
            "sore throat",
            "throat pain",
            "throat hurts",
        ],
        "answer": (
            "A sore throat is commonly caused by viral infections, irritation, "
            "or allergies. Warm fluids, rest, and salt-water gargling may help. "
            "Seek medical advice if it is severe, persistent, or associated with "
            "high fever or difficulty swallowing."
        ),
    },

    {
        "id": "stomach-ache",
        "topic": "illnesses",
        "keywords": [
            "stomach ache",
            "stomachache",
            "stomach pain",
            "abdominal pain",
            "belly pain",
        ],
        "answer": (
            "Mild stomach pain can have many causes, including gas, food, or "
            "stress. Rest and light food may help when symptoms are mild. "
            "Seek medical care promptly for severe or worsening pain, pain with "
            "fever or repeated vomiting, or symptoms that do not improve."
        ),
    },

    {
        "id": "diarrhea",
        "topic": "prevention",
        "keywords": [
            "diarrhea",
            "diarrhoea",
            "loose stool",
            "runny stomach",
        ],
        "answer": (
            "Diarrhea is often caused by contaminated food or water or by a "
            "stomach infection. The main concern is dehydration, so replace "
            "lost fluids and electrolytes. Seek medical care if there is blood, "
            "severe dehydration, or symptoms that persist or become worse."
        ),
    },

    {
        "id": "food-poisoning",
        "topic": "prevention",
        "keywords": [
            "food poisoning",
            "bad food",
            "contaminated food",
        ],
        "answer": (
            "Food poisoning can cause nausea, vomiting, stomach cramps, and "
            "diarrhea. Rest and take small, regular amounts of fluid. Seek "
            "medical care if symptoms are severe, persistent, or there are "
            "signs of dehydration."
        ),
    },

    {
        "id": "dehydration",
        "topic": "nutrition",
        "keywords": [
            "dehydration",
            "dehydrated",
            "not drinking enough water",
        ],
        "answer": (
            "Common signs of dehydration include thirst, dark urine, dry mouth, "
            "fatigue, and dizziness. Drink fluids regularly and increase intake "
            "when you're losing fluids through heat, exercise, vomiting, or "
            "diarrhea. Severe dehydration requires urgent medical attention."
        ),
    },

    {
        "id": "cuts-wounds",
        "topic": "hygiene",
        "keywords": [
            "cut",
            "wound",
            "bleeding",
            "injury",
        ],
        "answer": (
            "For a minor cut, wash your hands, rinse the wound with clean water, "
            "apply gentle pressure with a clean cloth if it is bleeding, and "
            "cover it with a clean dressing. Seek medical care for deep wounds, "
            "bleeding that will not stop, or signs of infection."
        ),
    },

    {
        "id": "burns",
        "topic": "hygiene",
        "keywords": [
            "burn",
            "burnt",
            "scald",
        ],
        "answer": (
            "For a minor burn, cool the area under cool running water for around "
            "20 minutes and then protect it with a clean dressing. Avoid applying "
            "ice, butter, or oil. Larger or serious burns require medical care."
        ),
    },

    {
        "id": "allergies",
        "topic": "prevention",
        "keywords": [
            "allergy",
            "allergies",
            "allergic reaction",
            "hives",
            "itchy skin",
        ],
        "answer": (
            "Mild allergic reactions can cause itching, sneezing, or a mild rash. "
            "Avoiding the trigger can help. If there is swelling of the face or "
            "throat, difficulty breathing, or severe dizziness, seek emergency "
            "medical help immediately."
        ),
    },

    {
        "id": "stress",
        "topic": "prevention",
        "keywords": [
            "stress",
            "stressed",
            "anxiety",
            "anxious",
            "overwhelmed",
        ],
        "answer": (
            "Stress can affect sleep, concentration, digestion, and general "
            "well-being. Regular sleep, movement, social connection, and breaking "
            "large tasks into smaller steps can help. If stress is persistent "
            "or interfering with everyday life, talking to a trusted adult, "
            "counselor, or health professional can be useful."
        ),
    },

    {
        "id": "sleep",
        "topic": "prevention",
        "keywords": [
            "sleep",
            "insomnia",
            "can't sleep",
            "trouble sleeping",
            "tired",
        ],
        "answer": (
            "Good sleep supports concentration, mood, growth, and general health. "
            "A consistent bedtime, a comfortable dark room, and reducing stimulating "
            "activities before bed can help. If sleep problems continue for weeks, "
            "consider talking with a health professional."
        ),
    },

    {
        "id": "skin-rash",
        "topic": "illnesses",
        "keywords": [
            "rash",
            "skin rash",
            "itchy skin",
            "skin irritation",
        ],
        "answer": (
            "Rashes can have many causes, including irritation, allergies, heat, "
            "and infections. Avoiding a suspected irritant and keeping the skin "
            "clean may help mild cases. Seek medical advice if a rash spreads "
            "quickly, becomes very painful, blisters, or occurs with fever."
        ),
    },

    {
        "id": "eye-strain",
        "topic": "prevention",
        "keywords": [
            "eye strain",
            "tired eyes",
            "screen time",
            "eyes hurt",
        ],
        "answer": (
            "Eye strain can happen after long periods of close-up or screen use. "
            "Try taking regular breaks and looking into the distance periodically. "
            "Good lighting can also help. Persistent or significant eye pain "
            "should be checked by an eye-care professional."
        ),
    },

    {
        "id": "back-pain",
        "topic": "exercise",
        "keywords": [
            "back pain",
            "backache",
            "sore back",
        ],
        "answer": (
            "Mild back pain often improves with gentle movement and avoiding "
            "activities that clearly make it worse. Complete bed rest is usually "
            "not helpful. Seek medical advice if the pain is severe, persistent, "
            "or accompanied by weakness, numbness, or other concerning symptoms."
        ),
    },

    {
        "id": "blood-pressure",
        "topic": "prevention",
        "keywords": [
            "blood pressure",
            "hypertension",
            "bp",
        ],
        "answer": (
            "Blood pressure can be affected by many factors, including genetics, "
            "diet, activity, stress, and certain health conditions. High blood "
            "pressure often causes no obvious symptoms, so measurement is important. "
            "A health professional can help interpret an actual blood-pressure reading."
        ),
    },

    {
        "id": "diabetes",
        "topic": "nutrition",
        "keywords": [
            "diabetes",
            "blood sugar",
            "sugar levels",
        ],
        "answer": (
            "Diabetes affects how the body handles blood glucose. Symptoms can "
            "include increased thirst, frequent urination, tiredness, and changes "
            "in weight, although symptoms vary. Testing by a health professional "
            "is needed to determine whether someone has diabetes."
        ),
    },

    {
        "id": "common-cold",
        "topic": "illnesses",
        "keywords": [
            "common cold",
            "runny nose",
            "blocked nose",
            "stuffy nose",
        ],
        "answer": (
            "The common cold usually improves on its own. Rest, fluids, and "
            "comfortable warm drinks can help with symptoms. Seek medical advice "
            "if symptoms become severe, last unusually long, or worsen after "
            "initially improving."
        ),
    },

    {
        "id": "insect-bites",
        "topic": "prevention",
        "keywords": [
            "insect bite",
            "mosquito bite",
            "bug bite",
            "bee sting",
        ],
        "answer": (
            "Clean the affected area and avoid scratching it. A cool compress "
            "can reduce mild swelling or itching. Seek medical help for a severe "
            "allergic reaction or if fever develops after a mosquito bite in a "
            "malaria-risk area."
        ),
    },

    {
        "id": "nosebleed",
        "topic": "illnesses",
        "keywords": [
            "nosebleed",
            "nose bleeding",
            "bleeding nose",
        ],
        "answer": (
            "For a nosebleed, sit upright, lean slightly forward, and gently "
            "pinch the soft part of the nose continuously for about 10 minutes. "
            "Avoid tilting your head backward. Seek medical care if the bleeding "
            "does not stop or happens repeatedly."
        ),
    },

    {
        "id": "sunburn",
        "topic": "hygiene",
        "keywords": [
            "sunburn",
            "sun burn",
            "too much sun",
        ],
        "answer": (
            "For mild sunburn, cool the skin gently, drink fluids, and protect "
            "the area from further sun exposure. Avoid deliberately breaking "
            "blisters. Severe burns or symptoms of heat illness require medical care."
        ),
    },

    {
        "id": "ear-pain",
        "topic": "illnesses",
        "keywords": [
            "ear pain",
            "earache",
            "ear ache",
            "ear infection",
        ],
        "answer": (
            "Ear pain can have several causes, including infections, congestion, "
            "or irritation. A warm compress may provide comfort for mild pain. "
            "Seek medical advice if pain is severe or occurs with fever, discharge, "
            "or hearing changes."
        ),
    },

    {
        "id": "menstrual-cramps",
        "topic": "exercise",
        "keywords": [
            "period pain",
            "menstrual cramps",
            "period cramps",
        ],
        "answer": (
            "Mild menstrual cramps are common and may improve with warmth, "
            "gentle movement, and rest. If pain is severe, unusually different, "
            "or repeatedly interferes with normal activities, talk with a health "
            "professional."
        ),
    },

    {
        "id": "child-fever",
        "topic": "illnesses",
        "keywords": [
            "baby fever",
            "child fever",
            "kid fever",
            "infant fever",
        ],
        "answer": (
            "For a feverish child, offer fluids and monitor their temperature "
            "and behavior. Very young infants with fever need prompt medical "
            "assessment. Any child with difficulty breathing, unusual drowsiness, "
            "a concerning rash, or severe symptoms should receive urgent care."
        ),
    },

    {
        "id": "vaccination",
        "topic": "prevention",
        "keywords": [
            "vaccine",
            "vaccination",
            "immunization",
            "immunisation",
        ],
        "answer": (
            "Vaccinations help protect against several serious infectious diseases. "
            "Schedules vary by age and country. If you're unsure which vaccines "
            "are due, a local health center or qualified health worker can check "
            "the appropriate schedule."
        ),
    },

    {
        "id": "muscle-cramp",
        "topic": "exercise",
        "keywords": [
            "muscle cramp",
            "leg cramp",
            "cramping muscle",
        ],
        "answer": (
            "Muscle cramps can occur after exercise, dehydration, or prolonged "
            "muscle use. Gentle stretching and hydration may help. Repeated or "
            "unexplained cramps are worth discussing with a health professional."
        ),
    },

    {
        "id": "weight",
        "topic": "nutrition",
        "keywords": [
            "lose weight",
            "healthy weight",
            "gain weight",
            "weight loss",
        ],
        "answer": (
            "Healthy development is more important than chasing a particular "
            "body size or appearance. Regular meals, varied nutritious foods, "
            "movement, sleep, and support from trusted adults or health professionals "
            "are safer approaches than extreme diets or restrictive eating."
        ),
    },

    {
        "id": "smoking",
        "topic": "prevention",
        "keywords": [
            "smoking",
            "quit smoking",
            "cigarettes",
            "tobacco",
        ],
        "answer": (
            "Tobacco use can damage the lungs, heart, blood vessels, and other "
            "parts of the body. Avoiding tobacco is one of the strongest ways "
            "to protect long-term health. If someone is trying to stop, support "
            "from a health professional or trusted adult can help."
        ),
    },

    {
        "id": "choking",
        "topic": "hygiene",
        "keywords": [
            "choking",
            "choke",
        ],
        "answer": (
            "Choking can become a medical emergency very quickly. If someone "
            "cannot breathe, speak, or cough effectively, call your local emergency "
            "service and follow instructions from emergency responders. A trained "
            "person should provide appropriate first aid while help is coming."
        ),
    },
]


# ==============================================================================
# MATCHING FUNCTIONS
# ==============================================================================

def _score(text, keywords):

    text = text.lower()

    return sum(
        1
        for keyword in keywords
        if keyword in text
    )


def _match_faq(query):

    best_entry = None
    best_score = 0

    for entry in FAQ:

        score = _score(
            query,
            entry["keywords"]
        )

        if score > best_score:
            best_entry = entry
            best_score = score

    return best_entry


def _match_topic(query):

    best_id = None
    best_score = 0

    for topic_id, words in TOPIC_KEYWORDS.items():

        score = _score(
            query,
            words
        )

        if score > best_score:
            best_id = topic_id
            best_score = score

    return (
        _topic_by_id(best_id)
        if best_id
        else None
    )


# ==============================================================================
# HUGGING FACE AI
# ==============================================================================

HF_TOKEN = os.environ.get("HF_TOKEN")

HF_MODEL = os.environ.get(
    "HF_MODEL",
    "openai/gpt-oss-120b"
)


# ==============================================================================
# AI SYSTEM PROMPT
# ==============================================================================

AI_SYSTEM_PROMPT = """
You are the AI assistant inside "Your Simple Health Assistant".

Your job is to provide clear, useful, easy-to-understand health information.

The user may ask about symptoms, illnesses, nutrition, exercise, sleep,
hygiene, prevention, first aid, mental wellbeing, medical terminology,
health science, or general health questions.

==================================================
AUTOMATIC LANGUAGE BEHAVIOR
==================================================

IMPORTANT:

The user does NOT choose a language from a menu.

You must automatically identify the language used by the user.

Supported languages include:

- English
- Luganda
- Filipino
- French
- Spanish
- German

ALWAYS answer in the SAME LANGUAGE that the user used.

Examples:

If the user writes in English:
Answer in English.

If the user writes in Luganda:
Answer in Luganda.

If the user writes in Filipino:
Answer in Filipino.

If the user writes in French:
Answer in French.

If the user writes in Spanish:
Answer in Spanish.

If the user writes in German:
Answer in German.

Do NOT automatically translate the user's question into English
and then answer in English.

Do NOT explain that you detected their language unless the user asks.

If the user mixes languages, use the language that is dominant in
their question.

If the language is unclear or cannot be confidently identified,
use English.

The language rule applies to the ENTIRE answer, including:

- headings
- explanations
- bullet points
- numbered lists
- warnings
- safety advice

Do not switch back to English halfway through an answer unless the
user specifically asks for English.

==================================================
RESPONSE STYLE
==================================================

Answer the actual question first.

Write naturally, like a modern helpful AI assistant.

Do NOT force every answer into one short paragraph.

When useful, organize the answer with Markdown-style formatting.

For example:

## Main explanation

A short explanation of the answer.

**Important:** Highlight important information using bold text.

### What may help

- First useful point
- Second useful point
- Third useful point

### When to get help

1. First situation
2. Second situation
3. Third situation

Use:

- **bold text** for important ideas
- `##` headings for major sections
- `###` headings for smaller sections
- bullet points when listing several items
- numbered lists when explaining steps
- short paragraphs
- clear spacing between sections

Do not over-format simple questions.

For a simple question, a short direct answer is better.

For a complex question, give a structured explanation.

==================================================
HEALTH SAFETY
==================================================

You provide general health education.

You are NOT a doctor and must not claim to diagnose the user.

Do not say that the user definitely has a particular disease.

If several conditions could cause a symptom, explain that there can be
multiple possible causes.

Do not prescribe personalized medication doses.

Do not tell the user to replace professional medical care with your answer.

If a question requires an examination, laboratory test, scan, or other
professional assessment, explain that appropriately.

If symptoms sound potentially serious or urgent, clearly recommend seeking
urgent medical help.

If the user describes a medical emergency, prioritize getting emergency help
over giving a long explanation.

==================================================
AGE APPROPRIATE
==================================================

Keep explanations appropriate for a general audience, including teenagers.

Do not provide dangerous instructions.

Do not encourage unsafe medical experiments, extreme dieting, harmful
substance use, or risky behavior.

For questions about body weight or appearance, focus on health, growth,
nutrition, strength, energy, and wellbeing rather than judging appearance.

==================================================
ACCURACY
==================================================

Do not invent medical facts.

If you are uncertain, say so.

Do not pretend to know information that has not been provided.

Avoid unnecessary technical language.

If a medical term is useful, explain it in simple language.

==================================================
NON-HEALTH QUESTIONS
==================================================

If a question is completely unrelated to health, politely explain that
Your Simple Health Assistant is primarily designed for health-related
questions.

Still answer briefly if a simple explanation is appropriate, but make it
clear that the application is designed primarily for health information.

==================================================
ANSWER LENGTH AND SPACING
==================================================

Keep simple questions reasonably concise, but do not make the answer feel
compressed.

For complicated questions, give enough explanation to be genuinely useful.

Do not cram multiple ideas into one paragraph.

Prefer short paragraphs of about 2–4 sentences.

Leave a blank line between paragraphs.

Leave a blank line before and after major headings.

When the answer contains several separate points, use a bullet list instead
of putting everything into one paragraph.

When explaining a process or sequence, use a numbered list with each step
on its own line.

When answering a question with several parts, give each part its own section.

Use headings when the subject changes significantly.

Important information may be emphasized with **bold text**.

Do not turn every sentence into a separate paragraph.

Do not repeat the user's question unnecessarily.

Do not end every response with the exact same sentence.

The goal is to make answers feel natural, readable, spacious, and similar to
a modern AI assistant rather than a compact block of text.
"""


# ==============================================================================
# AI REQUEST
# ==============================================================================

def ask_ai(question):
    """
    Send a question to Hugging Face.

    The system prompt automatically tells the model to answer in the
    same language as the user's question.
    """

    if not HF_TOKEN:

        print(
            "[AI] HF_TOKEN is not configured."
        )

        return None

    try:

        client = InferenceClient(
            api_key=HF_TOKEN,
            provider="auto",
        )

        completion = client.chat.completions.create(
            model=HF_MODEL,

            messages=[
                {
                    "role": "system",
                    "content": AI_SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": question,
                },
            ],

            max_tokens=900,
            temperature=0.4,
        )

        if not completion.choices:

            print(
                "[AI] Hugging Face returned no choices."
            )

            return None

        message = completion.choices[0].message

        if not message:
            return None

        answer = message.content

        if not answer:
            return None

        answer = answer.strip()

        return (
            answer
            if answer
            else None
        )

    except Exception as error:

        print(
            f"[AI] Hugging Face request failed: {error}"
        )

        return None


# ==============================================================================
# LOCAL ANSWER TRANSLATION
# ==============================================================================

def translate_local_answer(
    question,
    local_answer,
    topic_name=None
):
    """
    Translate a local FAQ/topic answer into the same language as the
    user's question.

    This is used because the local FAQ itself is stored in English.

    If AI translation is unavailable, the original English answer is
    returned as a safe fallback.
    """

    if not HF_TOKEN:
        return local_answer

    context = ""

    if topic_name:
        context = (
            f"\nHealth topic: {topic_name}\n"
        )

    translation_prompt = f"""
The user asked this health question:

{question}

The application has this verified local health answer:

{local_answer}

{context}

Rewrite the answer in the SAME LANGUAGE used by the user.

Supported languages include:
English, Luganda, Filipino, French, Spanish, and German.

Important rules:

1. Detect the user's language automatically.
2. Answer entirely in that language.
3. Do not translate the user's question back to English.
4. Preserve the medical meaning and safety warnings.
5. Do not add unsupported medical claims.
6. Do not diagnose the user.
7. Do not change the safety level of the original answer.
8. Keep the answer clear and natural.
9. You may improve the formatting with headings or bullet points when useful.
10. If the user's language is unclear, use English.

Return ONLY the answer.
"""

    try:

        client = InferenceClient(
            api_key=HF_TOKEN,
            provider="auto",
        )

        completion = client.chat.completions.create(
            model=HF_MODEL,

            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a careful medical-information "
                        "translator. Preserve the meaning and safety "
                        "of the provided answer."
                    ),
                },
                {
                    "role": "user",
                    "content": translation_prompt,
                },
            ],

            max_tokens=900,
            temperature=0.2,
        )

        if not completion.choices:
            return local_answer

        message = completion.choices[0].message

        if not message:
            return local_answer

        translated = message.content

        if not translated:
            return local_answer

        translated = translated.strip()

        return (
            translated
            if translated
            else local_answer
        )

    except Exception as error:

        print(
            f"[AI] Local answer translation failed: {error}"
        )

        return local_answer


# ==============================================================================
# EMAIL LAYER
# ==============================================================================

SMTP_EMAIL = os.environ.get(
    "SMTP_EMAIL"
)

SMTP_APP_PASSWORD = os.environ.get(
    "SMTP_APP_PASSWORD"
)

EMAIL_RE = re.compile(
    r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
)


def send_reset_email(
    to_email,
    reset_link
):

    print(
        f"[password reset] link for {to_email}: {reset_link}"
    )

    if not SMTP_EMAIL or not SMTP_APP_PASSWORD:

        print(
            "[password reset] SMTP_EMAIL / SMTP_APP_PASSWORD "
            "not set — email not sent."
        )

        return False

    subject = (
        "Reset your Your Simple Health Assistant password"
    )

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

        with smtplib.SMTP(
            "smtp.gmail.com",
            587,
            timeout=15
        ) as server:

            server.starttls()

            server.login(
                SMTP_EMAIL,
                SMTP_APP_PASSWORD
            )

            server.sendmail(
                SMTP_EMAIL,
                [to_email],
                msg.as_string()
            )

        return True

    except Exception as error:

        print(
            f"[password reset] failed to send email: {error}"
        )

        return False


# ==============================================================================
# DATABASE
# ==============================================================================

def get_db():

    conn = sqlite3.connect(
        DB_PATH
    )

    conn.row_factory = sqlite3.Row

    conn.execute(
        "PRAGMA foreign_keys = ON"
    )

    return conn


def init_db():

    conn = get_db()

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ask_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            question TEXT NOT NULL,
            matched_topic TEXT,
            asked_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        )
        """
    )

    conn.commit()

    conn.close()


def current_user():

    user_id = session.get(
        "user_id"
    )

    if not user_id:
        return None

    conn = get_db()

    row = conn.execute(
        """
        SELECT
            id,
            username,
            email,
            password_hash,
            created_at
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()

    conn.close()

    return (
        dict(row)
        if row
        else None
    )


# ==============================================================================
# API — TOPICS
# ==============================================================================

@app.get("/api/topics")
def api_topics():

    summary = [
        {
            "id": topic["id"],
            "icon": topic["icon"],
            "name": topic["name"],
            "short": topic["short"],
        }
        for topic in TOPICS
    ]

    return jsonify(summary)


@app.get("/api/topics/<topic_id>")
def api_topic_detail(topic_id):

    topic = _topic_by_id(
        topic_id
    )

    if topic is None:

        return jsonify({
            "error": "Topic not found"
        }), 404

    return jsonify(topic)


# ==============================================================================
# API — ASK AI
# ==============================================================================

@app.get("/api/ask")
def api_ask():

    query = request.args.get(
        "q",
        ""
    ).strip()

    if not query:

        return jsonify({
            "error": "Missing query parameter 'q'"
        }), 400

    faq_hit = _match_faq(
        query
    )

    matched_topic_id = None

    # ==========================================================================
    # FIRST: LOCAL FAQ
    # ==========================================================================

    if faq_hit:

        topic = _topic_by_id(
            faq_hit["topic"]
        )

        matched_topic_id = faq_hit["topic"]

        # ----------------------------------------------------------------------
        # If the question is English, use the verified local answer directly.
        #
        # For other languages, ask the AI to translate the verified answer
        # while preserving its meaning and safety.
        # ----------------------------------------------------------------------

        answer = faq_hit["answer"]

        translated_answer = translate_local_answer(
            question=query,
            local_answer=answer,
            topic_name=topic["name"]
        )

        result = {
            "matched": True,
            "kind": "faq",
            "question": query,
            "answer": translated_answer,
            "topic": {
                "id": topic["id"],
                "icon": topic["icon"],
                "name": topic["name"],
            },
        }

    # ==========================================================================
    # SECOND: HUGGING FACE
    # ==========================================================================

    else:

        ai_answer = ask_ai(
            query
        )

        if ai_answer:

            result = {
                "matched": True,
                "kind": "ai",
                "question": query,
                "answer": ai_answer,
            }

        # ======================================================================
        # THIRD: LOCAL TOPIC FALLBACK
        # ======================================================================

        else:

            topic = _match_topic(
                query
            )

            if topic:

                matched_topic_id = topic["id"]

                local_topic_answer = (
                    "\n".join(
                        f"- {tip}"
                        for tip in topic["tips"][:3]
                    )
                )

                translated_topic_answer = (
                    translate_local_answer(
                        question=query,
                        local_answer=local_topic_answer,
                        topic_name=topic["name"]
                    )
                )

                result = {
                    "matched": True,
                    "kind": "topic",
                    "topic": {
                        "id": topic["id"],
                        "icon": topic["icon"],
                        "name": topic["name"],
                    },
                    "tips": topic["tips"][:3],
                    "translated_answer": translated_topic_answer,
                }

            else:

                result = {
                    "matched": False
                }

    # ==========================================================================
    # SAVE HISTORY
    # ==========================================================================

    user = current_user()

    if user:

        conn = get_db()

        conn.execute(
            """
            INSERT INTO ask_history
            (
                user_id,
                question,
                matched_topic
            )
            VALUES (?, ?, ?)
            """,
            (
                user["id"],
                query,
                matched_topic_id,
            ),
        )

        conn.commit()

        conn.close()

    return jsonify(result)


# ==============================================================================
# AUTHENTICATION
# ==============================================================================

def _valid_password(password):

    return len(password) >= 6


@app.post("/api/auth/signup")
def api_signup():

    data = request.get_json(
        silent=True
    ) or {}

    username = (
        data.get("username") or ""
    ).strip()

    email = (
        data.get("email") or ""
    ).strip().lower()

    password = (
        data.get("password") or ""
    )

    if len(username) < 3:

        return jsonify({
            "error": "Username must be at least 3 characters."
        }), 400

    if not EMAIL_RE.match(email):

        return jsonify({
            "error": "Please enter a valid email address."
        }), 400

    if not _valid_password(password):

        return jsonify({
            "error": "Password must be at least 6 characters."
        }), 400

    conn = get_db()

    existing = conn.execute(
        """
        SELECT id
        FROM users
        WHERE username = ?
           OR email = ?
        """,
        (
            username,
            email,
        ),
    ).fetchone()

    if existing:

        conn.close()

        return jsonify({
            "error": (
                "That username or email is already registered."
            )
        }), 409

    password_hash = generate_password_hash(
        password
    )

    cur = conn.execute(
        """
        INSERT INTO users
        (
            username,
            email,
            password_hash
        )
        VALUES (?, ?, ?)
        """,
        (
            username,
            email,
            password_hash,
        ),
    )

    conn.commit()

    user_id = cur.lastrowid

    conn.close()

    session.permanent = True

    session["user_id"] = user_id

    return jsonify({
        "user": {
            "id": user_id,
            "username": username,
            "email": email,
        }
    }), 201


@app.post("/api/auth/login")
def api_login():

    data = request.get_json(
        silent=True
    ) or {}

    username = (
        data.get("username") or ""
    ).strip()

    password = (
        data.get("password") or ""
    )

    conn = get_db()

    row = conn.execute(
        """
        SELECT
            id,
            username,
            email,
            password_hash
        FROM users
        WHERE username = ?
        """,
        (username,),
    ).fetchone()

    conn.close()

    if (
        not row
        or not check_password_hash(
            row["password_hash"],
            password
        )
    ):

        return jsonify({
            "error": "Incorrect username or password."
        }), 401

    session.permanent = True

    session["user_id"] = row["id"]

    return jsonify({
        "user": {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
        }
    })


@app.post("/api/auth/logout")
def api_logout():

    session.clear()

    return jsonify({
        "ok": True
    })


@app.get("/api/auth/me")
def api_me():

    user = current_user()

    public_user = (
        {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
        }
        if user
        else None
    )

    return jsonify({
        "user": public_user
    })


@app.post("/api/auth/change-password")
def api_change_password():

    user = current_user()

    if not user:

        return jsonify({
            "error": "Not logged in."
        }), 401

    data = request.get_json(
        silent=True
    ) or {}

    current_password = (
        data.get("current_password") or ""
    )

    new_password = (
        data.get("new_password") or ""
    )

    if not check_password_hash(
        user["password_hash"],
        current_password
    ):

        return jsonify({
            "error": "Current password is incorrect."
        }), 401

    if not _valid_password(
        new_password
    ):

        return jsonify({
            "error": (
                "New password must be at least 6 characters."
            )
        }), 400

    new_hash = generate_password_hash(
        new_password
    )

    conn = get_db()

    conn.execute(
        """
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
        """,
        (
            new_hash,
            user["id"],
        ),
    )

    conn.commit()

    conn.close()

    return jsonify({
        "ok": True
    })


# ==============================================================================
# PASSWORD RESET
# ==============================================================================

RESET_TOKEN_LIFETIME_MINUTES = 30


@app.post("/api/auth/forgot-password")
def api_forgot_password():

    data = request.get_json(
        silent=True
    ) or {}

    email = (
        data.get("email") or ""
    ).strip().lower()

    generic_response = jsonify({
        "ok": True,
        "message": (
            "If that email is registered, "
            "a reset link has been sent."
        ),
    })

    if not EMAIL_RE.match(email):

        return generic_response

    conn = get_db()

    row = conn.execute(
        """
        SELECT id
        FROM users
        WHERE email = ?
        """,
        (email,),
    ).fetchone()

    if not row:

        conn.close()

        return generic_response

    token = secrets.token_urlsafe(
        32
    )

    expires_at = (
        datetime.now(timezone.utc)
        + timedelta(
            minutes=RESET_TOKEN_LIFETIME_MINUTES
        )
    ).isoformat()

    conn.execute(
        """
        INSERT INTO password_reset_tokens
        (
            user_id,
            token,
            expires_at
        )
        VALUES (?, ?, ?)
        """,
        (
            row["id"],
            token,
            expires_at,
        ),
    )

    conn.commit()

    conn.close()

    reset_link = (
        f"{APP_BASE_URL.rstrip('/')}"
        f"/reset-password?token={token}"
    )

    send_reset_email(
        email,
        reset_link
    )

    return generic_response


@app.post("/api/auth/reset-password")
def api_reset_password():

    data = request.get_json(
        silent=True
    ) or {}

    token = (
        data.get("token") or ""
    ).strip()

    new_password = (
        data.get("new_password") or ""
    )

    if not token:

        return jsonify({
            "error": "Missing reset token."
        }), 400

    if not _valid_password(
        new_password
    ):

        return jsonify({
            "error": "Password must be at least 6 characters."
        }), 400

    conn = get_db()

    row = conn.execute(
        """
        SELECT
            id,
            user_id,
            expires_at,
            used
        FROM password_reset_tokens
        WHERE token = ?
        """,
        (token,),
    ).fetchone()

    if not row:

        conn.close()

        return jsonify({
            "error": "This reset link is invalid."
        }), 400

    if row["used"]:

        conn.close()

        return jsonify({
            "error": (
                "This reset link has already been used."
            )
        }), 400

    expires_at = datetime.fromisoformat(
        row["expires_at"]
    )

    if expires_at.tzinfo is None:

        expires_at = expires_at.replace(
            tzinfo=timezone.utc
        )

    if datetime.now(timezone.utc) > expires_at:

        conn.close()

        return jsonify({
            "error": (
                "This reset link has expired. "
                "Please request a new one."
            )
        }), 400

    new_hash = generate_password_hash(
        new_password
    )

    conn.execute(
        """
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
        """,
        (
            new_hash,
            row["user_id"],
        ),
    )

    conn.execute(
        """
        UPDATE password_reset_tokens
        SET used = 1
        WHERE id = ?
        """,
        (row["id"],),
    )

    conn.commit()

    conn.close()

    return jsonify({
        "ok": True
    })


# ==============================================================================
# HISTORY
# ==============================================================================

@app.get("/api/history")
def api_history():

    user = current_user()

    if not user:

        return jsonify({
            "error": "Not logged in."
        }), 401

    conn = get_db()

    rows = conn.execute(
        """
        SELECT
            question,
            matched_topic,
            asked_at
        FROM ask_history
        WHERE user_id = ?
        ORDER BY asked_at DESC
        LIMIT 20
        """,
        (user["id"],),
    ).fetchall()

    conn.close()

    history = []

    for row in rows:

        topic = (
            _topic_by_id(
                row["matched_topic"]
            )
            if row["matched_topic"]
            else None
        )

        history.append({
            "question": row["question"],
            "asked_at": row["asked_at"],
            "topic": (
                {
                    "id": topic["id"],
                    "icon": topic["icon"],
                    "name": topic["name"],
                }
                if topic
                else None
            ),
        })

    return jsonify(
        history
    )


# ==============================================================================
# ROOT HEALTH CHECK
# ==============================================================================

@app.get("/")
def health_check():

    return jsonify({
        "status": "ok",

        "service": (
            "Your Simple Health Assistant — backend API"
        ),

        "note": (
            "This is the API only. "
            "The app itself is the separate frontend."
        ),
    })


# ==============================================================================
# DATABASE INITIALIZATION
# ==============================================================================

init_db()


# ==============================================================================
# LOCAL ENTRY POINT
# ==============================================================================

if __name__ == "__main__":

    app.run(
        host="0.0.0.0",

        port=int(
            os.environ.get(
                "PORT",
                5000
            )
        ),

        debug=True,
    )
