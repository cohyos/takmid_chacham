# תקמיד חכם - Takmid Chacham

סוכן AI מבוסס דפדפן המשמש כתלמיד חכם, מופעל על ידי Gemini (Vertex AI) עם גישה לשרתי MCP של ספריא ו-HebCal.

A browser-based AI agent that serves as a Torah scholar, powered by Gemini/Vertex AI with access to the official Sefaria and HebCal MCP servers for Jewish texts and calendar data.

## Features

- **Gemini-Powered Torah Scholar** - Uses Google's Gemini model with a specialized Talmid Chacham system prompt
- **Official Sefaria MCP** - Connects to `mcp.sefaria.org` for 15 tools: text retrieval, search, commentaries, manuscripts, topics, and more
- **HebCal MCP** - Connects to `hebcal.com/mcp` for Jewish calendar, holidays, zmanim, and candle lighting times
- **Automatic Fallback** - If MCP servers are unreachable, falls back to direct Sefaria REST API
- **Function Calling Agent Loop** - Gemini autonomously selects and calls tools to provide sourced answers
- **Hebrew RTL Interface** - Full right-to-left support for Hebrew text
- **Bilingual** - Works in both Hebrew and English
- **Conversation Memory** - Maintains context across the session

## Architecture

The project has two deployment modes:

### Static (GitHub Pages) — `docs/`
```
Browser (HTML/CSS/JS)
    ↕ Direct API calls
    ↓
┌──────────────────────┐  ┌──────────────────┐
│ Gemini REST API      │  │ Sefaria REST API │
│ (user provides key)  │  │ (6 tools, CORS)  │
└──────────────────────┘  └──────────────────┘
```

### Full Server — `server.js`
```
Browser (HTML/CSS/JS)
    ↕ NDJSON streaming
Express Server (Node.js)
    ↕ Gemini Function Calling (agent loop)
    ↕
Gemini / Vertex AI
    ↕ selects & calls tools
    ↓
┌─────────────────────────┐  ┌───────────────────┐
│ Sefaria MCP (SSE)       │  │ HebCal MCP (SSE)  │
│ mcp.sefaria.org/sse     │  │ hebcal.com/mcp    │
│ 15 tools - Jewish texts │  │ Calendar & zmanim │
└─────────────────────────┘  └───────────────────┘
         ↓ fallback
┌─────────────────────────┐
│ Sefaria REST API        │
│ (direct, 6 tools)       │
└─────────────────────────┘
```

### MCP Tools (discovered dynamically)

**Sefaria MCP** (15 tools):
| Tool | Description |
|------|-------------|
| `get_text` | Retrieve Jewish texts by reference |
| `text_search` | Full library search |
| `english_semantic_search` | Embeddings-based similarity search |
| `get_current_calendar` | Jewish calendar learning schedule |
| `get_links_between_texts` | Cross-references between texts |
| `search_in_book` | Targeted search within a book |
| `search_in_dictionaries` | Dictionary lookups |
| `get_english_translations` | Available translations |
| `get_topic_details` | Topics in Jewish thought |
| `get_text_or_category_shape` | Hierarchical text structure |
| `get_text_catalogue_info` | Bibliographic/structural data |
| `get_available_manuscripts` | Historical manuscript metadata |
| `get_manuscript_image` | Manuscript image access |
| `clarify_name_argument` | Autocomplete for titles/topics |
| `clarify_search_path_filter` | Book name validation |

**HebCal MCP**: Jewish holidays, Shabbat times, date conversion, zmanim, Torah readings

## Quick Start

### Option 0: GitHub Pages (no server needed)

A fully static version is available at **[cohyos.github.io/takmid_chacham](https://cohyos.github.io/takmid_chacham/)** — runs entirely in the browser with no backend.

To deploy your own:
1. Fork this repo
2. Go to **Settings → Pages → Source**: select `Deploy from a branch`, branch `main`, folder `/docs`
3. Get a free [Gemini API key](https://aistudio.google.com/apikey) and enter it in the UI

The static version calls Gemini and Sefaria APIs directly from the browser (6 tools). For the full 15+ MCP tools, use the Node.js server below.

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

## Deployment to the Web

To make the agent accessible over the internet:

### Cloud Run (recommended)

```bash
# Build and deploy
gcloud run deploy takmid-chacham \
  --source . \
  --set-env-vars "GEMINI_API_KEY=your-key" \
  --allow-unauthenticated \
  --region us-central1
```

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Other platforms
Works on any Node.js hosting: Railway, Render, Fly.io, Vercel (with serverless adapter), etc.

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `VERTEX_PROJECT` | Option 1 | Google Cloud project ID |
| `VERTEX_LOCATION` | No | Region (default: us-central1) |
| `GEMINI_API_KEY` | Option 2 | Gemini API key |
| `GEMINI_MODEL` | No | Model name (default: gemini-2.0-flash) |
| `PORT` | No | Server port (default: 3000) |
| `SEFARIA_MCP_URL` | No | Custom Sefaria MCP endpoint (default: https://mcp.sefaria.org/sse) |
| `HEBCAL_MCP_URL` | No | Custom HebCal MCP endpoint (default: https://www.hebcal.com/mcp) |

## Example Queries

- "הסבר לי את המשנה הראשונה במסכת ברכות"
- "מה המקור ההלכתי להדלקת נרות שבת?"
- "What does Rashi say about Genesis 1:1?"
- "מה הדף היומי?"
- "הסבר את מחלוקת בית שמאי ובית הלל בנר חנוכה"
- "מתי שבת הבאה ומה זמן הדלקת נרות?"
- "Show me the Aleppo Codex manuscript for Genesis 1"
