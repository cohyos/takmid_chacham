/**
 * Takmid Chacham - Frontend Application
 */

(function () {
  'use strict';

  // --- State ---
  let sessionId = null;
  let isLoading = false;

  // --- DOM Elements ---
  const messagesEl = document.getElementById('messages');
  const chatForm = document.getElementById('chat-form');
  const userInput = document.getElementById('user-input');
  const btnSend = document.getElementById('btn-send');
  const btnReset = document.getElementById('btn-reset');
  const btnCalendar = document.getElementById('btn-calendar');

  // --- Auto-resize textarea ---
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
  });

  // --- Submit on Enter (Shift+Enter for newline) ---
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  // --- Quick action buttons ---
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-quick')) {
      const query = e.target.dataset.query;
      if (query) sendMessage(query);
    }
  });

  // --- Form submit ---
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = userInput.value.trim();
    if (!text || isLoading) return;
    sendMessage(text);
  });

  // --- Reset conversation ---
  btnReset.addEventListener('click', async () => {
    if (sessionId) {
      try {
        await fetch('/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
      } catch (e) { /* ignore */ }
    }
    sessionId = null;
    // Clear all messages except the welcome
    const msgs = messagesEl.querySelectorAll('.message, .tool-indicator');
    const first = msgs[0];
    msgs.forEach((m, i) => { if (i > 0) m.remove(); });
    userInput.focus();
  });

  // --- Calendar button ---
  btnCalendar.addEventListener('click', () => {
    sendMessage('מה הלימוד היומי של היום?');
  });

  // --- Main send function ---
  async function sendMessage(text) {
    if (isLoading) return;
    isLoading = true;
    btnSend.disabled = true;
    userInput.value = '';
    userInput.style.height = 'auto';

    // Add user message
    appendMessage('user', text);

    // Add typing indicator
    const typingEl = createTypingIndicator();
    messagesEl.appendChild(typingEl);
    scrollToBottom();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Remove typing indicator
      typingEl.remove();

      // Read NDJSON stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentAssistantEl = null;
      let currentTextContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          switch (event.type) {
            case 'session':
              sessionId = event.sessionId;
              break;

            case 'text':
              if (!currentAssistantEl) {
                currentAssistantEl = appendMessage('assistant', '');
              }
              currentTextContent += event.content;
              renderMarkdown(currentAssistantEl.querySelector('.message-text'), currentTextContent);
              scrollToBottom();
              break;

            case 'tool_call':
              addToolIndicator(event.name, event.args, false, event.displayName);
              scrollToBottom();
              break;

            case 'tool_result':
              markToolDone(event.name, event.success);
              break;

            case 'error':
              appendMessage('assistant', event.content || 'An error occurred');
              break;

            case 'done':
              break;
          }
        }
      }
    } catch (err) {
      typingEl.remove();
      appendMessage('assistant', `שגיאה: ${err.message}`);
    } finally {
      isLoading = false;
      btnSend.disabled = false;
      userInput.focus();
      scrollToBottom();
    }
  }

  // --- UI Helpers ---

  function appendMessage(role, text) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;

    const avatarEl = document.createElement('div');
    avatarEl.className = 'message-avatar';
    avatarEl.textContent = role === 'user' ? '👤' : '📖';

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';

    const textEl = document.createElement('div');
    textEl.className = 'message-text';

    if (role === 'user') {
      textEl.textContent = text;
    } else {
      renderMarkdown(textEl, text);
    }

    contentEl.appendChild(textEl);
    msgEl.appendChild(avatarEl);
    msgEl.appendChild(contentEl);
    messagesEl.appendChild(msgEl);
    scrollToBottom();

    return msgEl;
  }

  function createTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'message assistant-message';
    el.innerHTML = `
      <div class="message-avatar">📖</div>
      <div class="message-content">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    return el;
  }

  // Tool display labels - supports both direct API and MCP tool names
  const TOOL_LABELS = {
    // Direct API mode tools
    get_jewish_text: { icon: '📜', label: 'מביא טקסט' },
    get_commentaries: { icon: '📝', label: 'מביא פירושים' },
    search_jewish_library: { icon: '🔍', label: 'מחפש בספרייה' },
    get_learning_calendar: { icon: '🗓️', label: 'בודק לוח לימוד' },
    get_text_index: { icon: '📑', label: 'בודק מבנה ספר' },
    get_related_texts: { icon: '🔗', label: 'מחפש מקורות קשורים' },
    // Sefaria MCP tools
    sefaria__get_text: { icon: '📜', label: 'מביא טקסט' },
    sefaria__text_search: { icon: '🔍', label: 'מחפש בספרייה' },
    sefaria__english_semantic_search: { icon: '🔎', label: 'חיפוש סמנטי' },
    sefaria__get_current_calendar: { icon: '🗓️', label: 'בודק לוח לימוד' },
    sefaria__get_links_between_texts: { icon: '🔗', label: 'מחפש קשרים' },
    sefaria__search_in_book: { icon: '📖', label: 'מחפש בספר' },
    sefaria__search_in_dictionaries: { icon: '📚', label: 'מחפש במילון' },
    sefaria__get_english_translations: { icon: '🌐', label: 'מביא תרגומים' },
    sefaria__get_topic_details: { icon: '💡', label: 'מביא פרטי נושא' },
    sefaria__clarify_name_argument: { icon: '✏️', label: 'מברר שם' },
    sefaria__clarify_search_path_filter: { icon: '📋', label: 'מברר נתיב' },
    sefaria__get_text_or_category_shape: { icon: '📐', label: 'בודק מבנה' },
    sefaria__get_text_catalogue_info: { icon: '📑', label: 'מביא מידע ביבליוגרפי' },
    sefaria__get_available_manuscripts: { icon: '📜', label: 'מחפש כתבי יד' },
    sefaria__get_manuscript_image: { icon: '🖼️', label: 'מביא תמונת כתב יד' },
    // HebCal MCP tools
    hebcal__holidays: { icon: '🕎', label: 'חגים ומועדים' },
    hebcal__shabbat: { icon: '🕯️', label: 'זמני שבת' },
    hebcal__converter: { icon: '📅', label: 'המרת תאריך' },
    hebcal__zmanim: { icon: '⏰', label: 'זמני היום' },
    hebcal__leyning: { icon: '📜', label: 'קריאת התורה' },
  };

  function getToolInfo(toolName, displayName) {
    if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
    // Fallback: derive from displayName or tool name
    const isHebcal = toolName.startsWith('hebcal__');
    const isSefaria = toolName.startsWith('sefaria__');
    const icon = isHebcal ? '🗓️' : isSefaria ? '📖' : '⚙️';
    const label = displayName || toolName.replace(/^(sefaria|hebcal)__/, '').replace(/_/g, ' ');
    return { icon, label };
  }

  function addToolIndicator(toolName, args, done, displayName) {
    const info = getToolInfo(toolName, displayName);
    const el = document.createElement('div');
    el.className = 'tool-indicator' + (done ? ' done' : '');
    el.dataset.tool = toolName;

    let detail = '';
    if (args) {
      if (args.ref) detail = args.ref;
      else if (args.query) detail = args.query;
      else if (args.title) detail = args.title;
      else if (args.text_ref) detail = args.text_ref;
      else if (args.topic) detail = args.topic;
    }

    el.innerHTML = `
      <span class="tool-icon">${info.icon}</span>
      <span>${info.label}${detail ? ': ' + escapeHtml(detail) : ''}</span>
      ${done ? '' : '<div class="spinner"></div>'}
    `;
    messagesEl.appendChild(el);
  }

  function markToolDone(toolName, success) {
    const indicators = messagesEl.querySelectorAll(`.tool-indicator[data-tool="${toolName}"]:not(.done)`);
    const el = indicators[indicators.length - 1];
    if (el) {
      el.classList.add('done');
      const spinner = el.querySelector('.spinner');
      if (spinner) spinner.remove();
      if (!success) {
        el.style.borderColor = '#f0c0c0';
        el.style.background = '#fff0f0';
      }
    }
  }

  function scrollToBottom() {
    const container = document.querySelector('.chat-container');
    container.scrollTop = container.scrollHeight;
  }

  // --- Markdown Rendering (lightweight) ---

  function renderMarkdown(el, text) {
    if (!text) {
      el.innerHTML = '';
      return;
    }

    let html = escapeHtml(text);

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold & italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    // Merge adjacent blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

    // Sefaria references - make clickable
    html = html.replace(
      /\(([^)]*(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Berakhot|Shabbat|Eruvin|Pesachim|Rosh Hashana|Yoma|Sukkah|Beitzah|Megillah|Taanit|Moed Katan|Chagigah|Yevamot|Ketubot|Nedarim|Nazir|Sotah|Gittin|Kiddushin|Bava Kamma|Bava Metzia|Bava Batra|Sanhedrin|Makkot|Shevuot|Avodah Zarah|Horayot|Zevachim|Menachot|Chullin|Bekhorot|Arakhin|Temurah|Keritot|Meilah|Tamid|Niddah|Rashi|Tosafot|Ramban|Rambam|Shulchan Arukh|Mishneh Torah|Mishnah|Pirkei Avot)[^)]*\d[^)]*)\)/gi,
      '(<a class="source-ref" href="https://www.sefaria.org/$1" target="_blank" rel="noopener">$1</a>)'
    );

    // Lists
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Paragraphs (double newlines)
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[1-3]>)/g, '$1');
    html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');

    el.innerHTML = html;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
