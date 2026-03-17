/**
 * Takmid Chacham - Express Server
 * Browser-based Talmid Chacham AI agent
 */

const express = require('express');
const path = require('path');
const { TalmidChachamAgent } = require('./lib/agent');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory session store (conversation history per session)
const sessions = new Map();
const SESSION_TTL = 60 * 60 * 1000; // 1 hour

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [], lastAccess: Date.now() });
  }
  const session = sessions.get(sessionId);
  session.lastAccess = Date.now();
  return session;
}

// Cleanup stale sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 10 * 60 * 1000);

// Create agent instance
function createAgent() {
  const config = {};

  // Vertex AI mode (preferred for production)
  if (process.env.VERTEX_PROJECT) {
    config.vertexProject = process.env.VERTEX_PROJECT;
    config.vertexLocation = process.env.VERTEX_LOCATION || 'us-central1';
    console.log(`Using Vertex AI (project: ${config.vertexProject}, location: ${config.vertexLocation})`);
  }
  // Gemini API key mode (simpler setup)
  else if (process.env.GEMINI_API_KEY) {
    config.apiKey = process.env.GEMINI_API_KEY;
    console.log('Using Gemini API with API key');
  }
  else {
    console.error('ERROR: Set VERTEX_PROJECT (for Vertex AI) or GEMINI_API_KEY (for Gemini API)');
    console.error('Example: GEMINI_API_KEY=your-key node server.js');
    process.exit(1);
  }

  if (process.env.GEMINI_MODEL) {
    config.model = process.env.GEMINI_MODEL;
  }

  return new TalmidChachamAgent(config);
}

const agent = createAgent();

// --- API Routes ---

/**
 * POST /api/chat
 * Main chat endpoint - streams agent responses via Server-Sent Events style JSON
 */
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  const sid = sessionId || crypto.randomUUID();
  const session = getSession(sid);

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    // Send session ID first
    res.write(JSON.stringify({ type: 'session', sessionId: sid }) + '\n');

    let fullText = '';

    for await (const event of agent.chat(message, session.history)) {
      res.write(JSON.stringify(event) + '\n');

      if (event.type === 'text') {
        fullText += event.content;
      }
    }

    // Update conversation history
    session.history.push({ role: 'user', parts: [{ text: message }] });
    if (fullText) {
      session.history.push({ role: 'model', parts: [{ text: fullText }] });
    }

    // Keep history manageable (last 20 turns)
    if (session.history.length > 40) {
      session.history = session.history.slice(-40);
    }

    res.write(JSON.stringify({ type: 'done' }) + '\n');
    res.end();
  } catch (err) {
    console.error('Chat error:', err);
    res.write(JSON.stringify({ type: 'error', content: err.message }) + '\n');
    res.end();
  }
});

/**
 * POST /api/reset
 * Reset conversation history for a session
 */
app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId);
  }
  res.json({ ok: true });
});

/**
 * GET /api/health
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: agent.useVertexAI ? 'vertex-ai' : 'gemini-api',
    model: agent.model
  });
});

// Serve the SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  תקמיד חכם - Takmid Chacham`);
  console.log(`  Running at http://localhost:${PORT}`);
  console.log(`  Model: ${agent.model}`);
  console.log();
});
