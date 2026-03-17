/**
 * Talmid Chacham Agent - Browser-side Gemini + Sefaria
 * Runs entirely in the browser, no server needed
 * Uses Google Gemini REST API directly with function calling
 */

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
- **get_learning_calendar**: השתמש כשנשאל על לימוד יומי, דף יומי, פרשת השבוע וכו׳
- **get_text_index**: השתמש לקבלת מידע על מבנה ספר
- **get_related_texts**: השתמש למציאת מקורות קשורים

בכל תשובה, ציין את המקורות המדויקים שעליהם אתה מסתמך.`;

const MAX_TOOL_ROUNDS = 8;

class TalmidChachamBrowserAgent {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model || 'gemini-2.0-flash';
    this.conversationHistory = [];
  }

  /**
   * Call Gemini REST API directly
   */
  async _callGemini(contents, tools) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents,
      tools: tools && tools.length > 0 ? tools : undefined,
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      generationConfig: {
        temperature: 0.3
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${err}`);
    }

    return res.json();
  }

  /**
   * Process a user message through the agent loop
   * @param {string} userMessage
   * @param {function} onEvent - Callback for streaming events
   */
  async chat(userMessage, onEvent) {
    const tools = [{
      functionDeclarations: SefariaTools.declarations
    }];

    // Build contents from history + new message
    const contents = [
      ...this.conversationHistory,
      { role: 'user', parts: [{ text: userMessage }] }
    ];

    let round = 0;
    let finalText = '';

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      let response;
      try {
        response = await this._callGemini(contents, tools);
      } catch (err) {
        onEvent({ type: 'error', content: err.message });
        return;
      }

      const candidate = response.candidates?.[0];
      if (!candidate) {
        onEvent({ type: 'error', content: 'No response from model' });
        return;
      }

      const parts = candidate.content?.parts || [];
      const functionCalls = parts.filter(p => p.functionCall);
      const textParts = parts.filter(p => p.text);

      // Add model response to conversation
      contents.push({ role: 'model', parts });

      // Yield text parts
      if (textParts.length > 0) {
        const text = textParts.map(p => p.text).join('');
        finalText += text;
        onEvent({ type: 'text', content: text });
      }

      // If no function calls, we're done
      if (functionCalls.length === 0) {
        break;
      }

      // Execute function calls
      const functionResponses = [];
      for (const fc of functionCalls) {
        const { name, args } = fc.functionCall;

        onEvent({ type: 'tool_call', name, args });

        try {
          const result = await SefariaTools.execute(name, args || {});
          functionResponses.push({
            functionResponse: {
              name,
              response: { result: result.slice(0, 15000) }
            }
          });
          onEvent({ type: 'tool_result', name, success: true });
        } catch (err) {
          functionResponses.push({
            functionResponse: {
              name,
              response: { error: err.message }
            }
          });
          onEvent({ type: 'tool_result', name, success: false, error: err.message });
        }
      }

      // Add function responses and continue
      contents.push({ role: 'user', parts: functionResponses });
    }

    // Update conversation history
    this.conversationHistory.push({ role: 'user', parts: [{ text: userMessage }] });
    if (finalText) {
      this.conversationHistory.push({ role: 'model', parts: [{ text: finalText }] });
    }

    // Keep history manageable
    if (this.conversationHistory.length > 30) {
      this.conversationHistory = this.conversationHistory.slice(-30);
    }

    onEvent({ type: 'done' });
  }

  resetHistory() {
    this.conversationHistory = [];
  }
}
