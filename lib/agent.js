/**
 * Talmid Chacham Agent - Orchestrates Gemini + MCP tools (Sefaria, HebCal)
 * Implements an agentic loop with function calling
 *
 * Supports two modes:
 * 1. MCP mode (preferred): Connects to official Sefaria & HebCal MCP servers via SSE
 * 2. Fallback mode: Uses direct Sefaria REST API calls
 */

const { GoogleGenAI } = require('@google/genai');
const { McpToolManager } = require('./mcp-client');
const { SefariaClient } = require('./sefaria');

const SYSTEM_PROMPT = `אתה תלמיד חכם מלומד ומעמיק, בקיא בכל חלקי התורה: תנ"ך, משנה, תלמוד בבלי וירושלמי, מדרש, הלכה, קבלה, מחשבת ישראל, ומוסר.

## תפקידך
אתה משמש כעוזר לימודי עבור לומדי תורה. תפקידך לסייע בלימוד, להסביר סוגיות, לחבר בין מקורות, ולהעמיק בנושאים תורניים.

## עקרונות מנחים
1. **אמינות מקורות**: תמיד השתמש בכלים הזמינים לך לאמת מקורות מספריית ספריא. אל תצטט מקורות מזיכרונך בלי לאמת אותם.
2. **גישה אורתודוקסית**: פעל בהתאם למסורת ישראל, כולל תורה שבכתב ותורה שבעל פה, פוסקי ההלכה, ומפרשי התורה המקובלים.
3. **ענווה**: אם אינך בטוח בתשובה, אמור זאת. עדיף לומר "איני יודע" מאשר לטעות בדבר הלכה.
4. **העמקה**: כשנשאל שאלה, נסה לתת תשובה מקיפה הכוללת מקורות רלוונטיים, פירושים שונים, ומחלוקות כשיש.
5. **שפה**: ענה בשפה שבה נשאלת השאלה. אם השאלה בעברית - ענה בעברית. אם באנגלית - ענה באנגלית. ציטוטי מקורות יהיו תמיד בשפת המקור עם תרגום כשצריך.

## דרך עבודה
- כשנשאל שאלה, חפש תחילה את המקורות הרלוונטיים באמצעות הכלים שלך
- הבא את הטקסט המדויק של המקורות
- הסבר את הסוגיה תוך התייחסות למפרשים השונים
- אם יש מחלוקת הלכתית, ציין את הדעות השונות ואת ההכרעה המקובלת
- חבר בין נושאים ומקורות כשזה מעשיר את הלימוד
- לשאלות הקשורות ללוח השנה העברי, זמני תפילה, פרשת השבוע, חגים - השתמש בכלי HebCal
- לשליפת טקסטים, פירושים, חיפוש מקורות - השתמש בכלי Sefaria

בכל תשובה, ציין את המקורות המדויקים שעליהם אתה מסתמך.`;

const MAX_TOOL_ROUNDS = 10;

class TalmidChachamAgent {
  constructor(config = {}) {
    this.vertexProject = config.vertexProject;
    this.vertexLocation = config.vertexLocation || 'us-central1';
    this.apiKey = config.apiKey;
    this.useVertexAI = !!config.vertexProject;

    const genaiConfig = this.useVertexAI
      ? { vertexai: true, project: this.vertexProject, location: this.vertexLocation }
      : { apiKey: this.apiKey };

    this.genai = new GoogleGenAI(genaiConfig);
    this.model = config.model || 'gemini-2.0-flash';

    // MCP tool manager (connects to Sefaria & HebCal MCP servers)
    this.mcpManager = new McpToolManager(config.mcpServers);

    // Fallback: direct Sefaria API client
    this.sefariaFallback = new SefariaClient();

    this.useMcp = false; // Set to true after successful MCP connection
  }

  /**
   * Initialize MCP connections. Call once at startup.
   * Falls back to direct API if MCP servers are unreachable.
   */
  async initialize() {
    console.log('Connecting to MCP servers...');
    try {
      const results = await this.mcpManager.connect();
      const connected = results.filter(r => r.status === 'connected');

      if (connected.length > 0) {
        this.useMcp = true;
        console.log(`MCP mode: ${connected.length} server(s) connected, ${this.mcpManager.toolMap.size} tools available`);
        return { mode: 'mcp', servers: results };
      }
    } catch (err) {
      console.error('MCP connection error:', err.message);
    }

    console.log('Falling back to direct Sefaria API mode');
    this.useMcp = false;
    return { mode: 'fallback', servers: [] };
  }

  /**
   * Get the current tool declarations based on active mode
   */
  _getToolDeclarations() {
    if (this.useMcp) {
      return this.mcpManager.getGeminiFunctionDeclarations();
    }
    return SefariaClient.getToolDeclarations();
  }

  /**
   * Execute a tool call based on active mode
   */
  async _executeTool(name, args) {
    if (this.useMcp) {
      const result = await this.mcpManager.callTool(name, args);
      // Truncate very long results
      return typeof result === 'string' ? result.slice(0, 15000) : JSON.stringify(result).slice(0, 15000);
    }
    const result = await this.sefariaFallback.executeTool(name, args);
    return JSON.stringify(result).slice(0, 15000);
  }

  /**
   * Get a human-readable name for a tool
   */
  _getToolDisplayName(name) {
    if (this.useMcp) {
      return this.mcpManager.getToolDisplayName(name);
    }
    return name;
  }

  /**
   * Process a user message through the agent loop
   * @param {string} userMessage - The user's question/message
   * @param {Array} conversationHistory - Previous messages for context
   * @returns {AsyncGenerator} Yields partial responses and tool calls
   */
  async *chat(userMessage, conversationHistory = []) {
    const declarations = this._getToolDeclarations();
    const tools = declarations.length > 0
      ? [{ functionDeclarations: declarations }]
      : [];

    const contents = [
      ...conversationHistory,
      { role: 'user', parts: [{ text: userMessage }] }
    ];

    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const response = await this.genai.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools,
          temperature: 0.3,
        }
      });

      const candidate = response.candidates?.[0];
      if (!candidate) {
        yield { type: 'error', content: 'No response from model' };
        return;
      }

      const parts = candidate.content?.parts || [];
      const functionCalls = parts.filter(p => p.functionCall);
      const textParts = parts.filter(p => p.text);

      // Add model response to conversation
      contents.push({ role: 'model', parts });

      // If there are text parts, yield them
      if (textParts.length > 0) {
        const text = textParts.map(p => p.text).join('');
        yield { type: 'text', content: text };
      }

      // If no function calls, we're done
      if (functionCalls.length === 0) {
        return;
      }

      // Execute function calls
      const functionResponses = [];
      for (const fc of functionCalls) {
        const { name, args } = fc.functionCall;

        yield {
          type: 'tool_call',
          name,
          displayName: this._getToolDisplayName(name),
          args
        };

        try {
          const result = await this._executeTool(name, args || {});
          functionResponses.push({
            functionResponse: {
              name,
              response: { result }
            }
          });

          yield {
            type: 'tool_result',
            name,
            success: true
          };
        } catch (err) {
          functionResponses.push({
            functionResponse: {
              name,
              response: { error: err.message }
            }
          });

          yield {
            type: 'tool_result',
            name,
            success: false,
            error: err.message
          };
        }
      }

      // Add function responses and continue the loop
      contents.push({ role: 'user', parts: functionResponses });
    }

    yield { type: 'error', content: 'Maximum tool rounds exceeded' };
  }

  /**
   * Simple non-streaming chat (returns final text)
   */
  async ask(userMessage, conversationHistory = []) {
    let finalText = '';
    const toolCalls = [];

    for await (const event of this.chat(userMessage, conversationHistory)) {
      if (event.type === 'text') {
        finalText += event.content;
      } else if (event.type === 'tool_call') {
        toolCalls.push(event);
      }
    }

    return { text: finalText, toolCalls };
  }

  /**
   * Cleanup MCP connections
   */
  async shutdown() {
    if (this.useMcp) {
      await this.mcpManager.disconnect();
    }
  }
}

module.exports = { TalmidChachamAgent, SYSTEM_PROMPT };
