/**
 * Talmid Chacham Agent - Orchestrates Gemini + Sefaria tools
 * Implements an agentic loop with function calling
 */

const { GoogleGenAI } = require('@google/genai');
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
- כשנשאל שאלה, חפש תחילה את המקורות הרלוונטיים בספריא
- הבא את הטקסט המדויק של המקורות
- הסבר את הסוגיה תוך התייחסות למפרשים השונים
- אם יש מחלוקת הלכתית, ציין את הדעות השונות ואת ההכרעה המקובלת
- חבר בין נושאים ומקורות כשזה מעשיר את הלימוד

## שימוש בכלים
- **get_jewish_text**: השתמש לשליפת טקסט מדויק ממקור ספציפי
- **get_commentaries**: השתמש לקבלת פירושים על פסוק או משנה
- **search_jewish_library**: השתמש לחיפוש נושא רחב בספרייה
- **get_learning_calendar**: השתמש כשנשאל על לימוד יומי, דף יומי, פרשת השבוע וכו'
- **get_text_index**: השתמש לקבלת מידע על מבנה ספר
- **get_related_texts**: השתמש למציאת מקורות קשורים

בכל תשובה, ציין את המקורות המדויקים שעליהם אתה מסתמך.`;

const MAX_TOOL_ROUNDS = 8;

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
    this.sefaria = new SefariaClient();
  }

  /**
   * Process a user message through the agent loop
   * @param {string} userMessage - The user's question/message
   * @param {Array} conversationHistory - Previous messages for context
   * @returns {AsyncGenerator} Yields partial responses and tool calls
   */
  async *chat(userMessage, conversationHistory = []) {
    const tools = [{
      functionDeclarations: SefariaClient.getToolDeclarations()
    }];

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
          args
        };

        try {
          const result = await this.sefaria.executeTool(name, args || {});
          functionResponses.push({
            functionResponse: {
              name,
              response: { result: JSON.stringify(result).slice(0, 15000) }
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
}

module.exports = { TalmidChachamAgent, SYSTEM_PROMPT };
