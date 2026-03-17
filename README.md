# תקמיד חכם - Takmid Chacham

סוכן AI מבוסס דפדפן המשמש כתלמיד חכם, מופעל על ידי Gemini (Vertex AI) עם גישה לספריית ספריא של טקסטים יהודיים.

A browser-based AI agent that serves as a Torah scholar, powered by Gemini/Vertex AI with access to the Sefaria Jewish texts library.

## Features

- **Gemini-Powered Torah Scholar** - Uses Google's Gemini model with a specialized Talmid Chacham system prompt
- **Sefaria Integration** - Real-time access to Tanakh, Talmud, Midrash, Halakha, commentaries, and more via Sefaria's API
- **Function Calling Agent Loop** - Gemini autonomously searches and retrieves texts to provide sourced answers
- **Hebrew RTL Interface** - Full right-to-left support for Hebrew text
- **Bilingual** - Works in both Hebrew and English
- **Conversation Memory** - Maintains context across the session

## Architecture

```
Browser (HTML/CSS/JS)
    ↕ NDJSON streaming
Express Server (Node.js)
    ↕ Function Calling
Gemini / Vertex AI ←→ Sefaria API (MCP-style tools)
```

### Sefaria Tools (MCP-compatible)

| Tool | Description |
|------|-------------|
| `get_jewish_text` | Retrieve any text by reference (bilingual) |
| `get_commentaries` | Get Rashi, Tosafot, Ramban, etc. on a text |
| `search_jewish_library` | Full-text search across the library |
| `get_learning_calendar` | Daf Yomi, Parashat HaShavua, etc. |
| `get_text_index` | Text metadata and structure |
| `get_related_texts` | Cross-references and related sources |

## Quick Start

### Option A: Gemini API Key (simplest)

```bash
# Get a free API key at https://aistudio.google.com/apikey
npm install
GEMINI_API_KEY=your-key npm start
```

### Option B: Vertex AI (production)

```bash
# Requires Google Cloud project with Vertex AI API enabled
gcloud auth application-default login
npm install
VERTEX_PROJECT=your-project-id npm start
```

Then open http://localhost:3000

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `VERTEX_PROJECT` | Option 1 | Google Cloud project ID |
| `VERTEX_LOCATION` | No | Region (default: us-central1) |
| `GEMINI_API_KEY` | Option 2 | Gemini API key |
| `GEMINI_MODEL` | No | Model name (default: gemini-2.0-flash) |
| `PORT` | No | Server port (default: 3000) |

## Example Queries

- "הסבר לי את המשנה הראשונה במסכת ברכות"
- "מה המקור ההלכתי להדלקת נרות שבת?"
- "What does Rashi say about Genesis 1:1?"
- "מה הדף היומי?"
- "הסבר את מחלוקת בית שמאי ובית הלל בנר חנוכה"
