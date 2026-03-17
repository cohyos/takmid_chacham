/**
 * Takmid Chacham - Browser App (GitHub Pages compatible)
 * No server required - runs entirely in the browser
 */

(function () {
  'use strict';

  // --- State ---
  let agent = null;
  let isLoading = false;

  // --- DOM ---
  const setupScreen = document.getElementById('setup-screen');
  const chatScreen = document.getElementById('chat-screen');
  const setupForm = document.getElementById('setup-form');
  const apiKeyInput = document.getElementById('api-key-input');
  const saveKeyCheckbox = document.getElementById('save-key');
  const modelSelect = document.getElementById('model-select');
  const messagesEl = document.getElementById('messages');
  const chatForm = document.getElementById('chat-form');
  const userInput = document.getElementById('user-input');
  const btnSend = document.getElementById('btn-send');
  const btnReset = document.getElementById('btn-reset');
  const btnCalendar = document.getElementById('btn-calendar');
  const btnSettings = document.getElementById('btn-settings');

  // --- Restore saved settings ---
  const savedKey = localStorage.getItem('takmid_api_key');
  const savedModel = localStorage.getItem('takmid_model');
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }
  if (savedModel) {
    modelSelect.value = savedModel;
  }

  // Auto-start if key is saved
  if (savedKey) {
    startChat(savedKey, savedModel || 'gemini-2.0-flash');
  }

  // --- Setup form ---
  setupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = apiKeyInput.value.trim();
    if (!key) return;

    const model = modelSelect.value;

    if (saveKeyCheckbox.checked) {
      localStorage.setItem('takmid_api_key', key);
      localStorage.setItem('takmid_model', model);
    } else {
      localStorage.removeItem('takmid_api_key');
      localStorage.removeItem('takmid_model');
    }

    startChat(key, model);
  });

  function startChat(apiKey, model) {
    agent = new TalmidChachamBrowserAgent(apiKey, model);
    setupScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    userInput.focus();
  }

  // --- Auto-resize textarea ---
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
  });

  // --- Enter to send ---
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  // --- Quick actions ---
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-quick')) {
      const query = e.target.dataset.query;
      if (query) sendMessage(query);
    }
  });

  // --- Submit ---
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = userInput.value.trim();
    if (!text || isLoading) return;
    sendMessage(text);
  });

  // --- Reset ---
  btnReset.addEventListener('click', () => {
    if (agent) agent.resetHistory();
    const msgs = messagesEl.querySelectorAll('.message, .tool-indicator');
    msgs.forEach((m, i) => { if (i > 0) m.remove(); });
    userInput.focus();
  });

  // --- Calendar ---
  btnCalendar.addEventListener('click', () => {
    sendMessage('מה הלימוד היומי של היום?');
  });

  // --- Settings (back to setup) ---
  btnSettings.addEventListener('click', () => {
    chatScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
  });

  // --- Send message ---
  async function sendMessage(text) {
    if (isLoading || !agent) return;
    isLoading = true;
    btnSend.disabled = true;
    userInput.value = '';
    userInput.style.height = 'auto';

    appendMessage('user', text);

    const typingEl = createTypingIndicator();
    messagesEl.appendChild(typingEl);
    scrollToBottom();

    let currentAssistantEl = null;
    let currentTextContent = '';

    try {
      await agent.chat(text, (event) => {
        switch (event.type) {
          case 'text':
            if (typingEl.parentNode) typingEl.remove();
            if (!currentAssistantEl) {
              currentAssistantEl = appendMessage('assistant', '');
            }
            currentTextContent += event.content;
            renderMarkdown(currentAssistantEl.querySelector('.message-text'), currentTextContent);
            scrollToBottom();
            break;

          case 'tool_call':
            if (typingEl.parentNode) typingEl.remove();
            addToolIndicator(event.name, event.args, false);
            scrollToBottom();
            break;

          case 'tool_result':
            markToolDone(event.name, event.success);
            break;

          case 'error':
            if (typingEl.parentNode) typingEl.remove();
            appendMessage('assistant', event.content || 'An error occurred');
            break;

          case 'done':
            break;
        }
      });
    } catch (err) {
      if (typingEl.parentNode) typingEl.remove();
      appendMessage('assistant', 'שגיאה: ' + err.message);
    } finally {
      if (typingEl.parentNode) typingEl.remove();
      isLoading = false;
      btnSend.disabled = false;
      userInput.focus();
      scrollToBottom();
    }
  }

  // --- UI Helpers ---

  function appendMessage(role, text) {
    const msgEl = document.createElement('div');
    msgEl.className = 'message ' + (role === 'user' ? 'user-message' : 'assistant-message');

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
    el.innerHTML = '<div class="message-avatar">📖</div><div class="message-content"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>';
    return el;
  }

  const TOOL_LABELS = {
    get_jewish_text: { icon: '📜', label: 'מביא טקסט' },
    get_commentaries: { icon: '📝', label: 'מביא פירושים' },
    search_jewish_library: { icon: '🔍', label: 'מחפש בספרייה' },
    get_learning_calendar: { icon: '🗓️', label: 'בודק לוח לימוד' },
    get_text_index: { icon: '📑', label: 'בודק מבנה ספר' },
    get_related_texts: { icon: '🔗', label: 'מחפש מקורות קשורים' }
  };

  function addToolIndicator(toolName, args, done) {
    const info = TOOL_LABELS[toolName] || { icon: '⚙️', label: toolName };
    const el = document.createElement('div');
    el.className = 'tool-indicator' + (done ? ' done' : '');
    el.dataset.tool = toolName;

    let detail = '';
    if (args) {
      if (args.ref) detail = args.ref;
      else if (args.query) detail = args.query;
      else if (args.title) detail = args.title;
    }

    el.innerHTML = '<span class="tool-icon">' + info.icon + '</span>' +
      '<span>' + info.label + (detail ? ': ' + escapeHtml(detail) : '') + '</span>' +
      (done ? '' : '<div class="spinner"></div>');
    messagesEl.appendChild(el);
  }

  function markToolDone(toolName, success) {
    const indicators = messagesEl.querySelectorAll('.tool-indicator[data-tool="' + toolName + '"]:not(.done)');
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
    if (container) container.scrollTop = container.scrollHeight;
  }

  // --- Markdown ---

  function renderMarkdown(el, text) {
    if (!text) { el.innerHTML = ''; return; }

    let html = escapeHtml(text);

    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

    // Sefaria links
    html = html.replace(
      /\(([^)]*(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Berakhot|Shabbat|Eruvin|Pesachim|Rosh Hashana|Yoma|Sukkah|Beitzah|Megillah|Taanit|Moed Katan|Chagigah|Yevamot|Ketubot|Nedarim|Nazir|Sotah|Gittin|Kiddushin|Bava Kamma|Bava Metzia|Bava Batra|Sanhedrin|Makkot|Shevuot|Avodah Zarah|Horayot|Zevachim|Menachot|Chullin|Bekhorot|Arakhin|Temurah|Keritot|Meilah|Tamid|Niddah|Rashi|Tosafot|Ramban|Rambam|Shulchan Arukh|Mishneh Torah|Mishnah|Pirkei Avot)[^)]*\d[^)]*)\)/gi,
      '(<a class="source-ref" href="https://www.sefaria.org/$1" target="_blank" rel="noopener">$1</a>)'
    );

    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
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
