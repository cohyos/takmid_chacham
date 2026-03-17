/**
 * Sefaria API Client - Browser-compatible module
 * Provides tool functions for Gemini function calling
 */

const SEFARIA_BASE = 'https://www.sefaria.org/api';

const SefariaTools = {
  /**
   * Tool declarations for Gemini function calling
   */
  declarations: [
    {
      name: 'get_jewish_text',
      description: 'Retrieve a Jewish text from the Sefaria library by reference. Supports Tanakh, Talmud, Midrash, Halakha, Kabbalah, and more. References can be in English or Hebrew. Examples: "Genesis 1:1-5", "Berakhot 2a", "Rashi on Genesis 1:1", "Shulchan Arukh, Orach Chaim 1:1"',
      parameters: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            description: 'The text reference (e.g. "Genesis 1:1", "Berakhot 2a:1-5")'
          },
          lang: {
            type: 'string',
            description: 'Language preference: "he" for Hebrew, "en" for English',
            enum: ['he', 'en']
          }
        },
        required: ['ref']
      }
    },
    {
      name: 'get_commentaries',
      description: 'Get commentaries and linked texts for a given reference. Returns commentaries from Rashi, Tosafot, Ramban, Ibn Ezra, and many others.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'The text reference to get commentaries for' }
        },
        required: ['ref']
      }
    },
    {
      name: 'search_jewish_library',
      description: 'Search across the entire Sefaria Jewish text library. Use for finding texts by topic, keyword, or concept.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (Hebrew or English)' },
          filters: {
            type: 'array',
            items: { type: 'string' },
            description: 'Category filters: "Tanakh", "Talmud", "Midrash", "Halakhah", "Kabbalah", "Mishnah"'
          },
          size: { type: 'number', description: 'Number of results (default 10, max 20)' }
        },
        required: ['query']
      }
    },
    {
      name: 'get_learning_calendar',
      description: 'Get the Jewish daily/weekly learning schedule: Daf Yomi, Parashat HaShavua, Haftarah, Mishnah Yomit, etc.',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'get_text_index',
      description: 'Get metadata and structure of a text in the Sefaria library.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the text (e.g. "Genesis", "Berakhot")' }
        },
        required: ['title']
      }
    },
    {
      name: 'get_related_texts',
      description: 'Get texts related to a given reference, including cross-references and source sheets.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'The text reference' }
        },
        required: ['ref']
      }
    }
  ],

  /**
   * Execute a tool call by name
   */
  async execute(toolName, args) {
    switch (toolName) {
      case 'get_jewish_text': return SefariaTools._getText(args.ref, args.lang);
      case 'get_commentaries': return SefariaTools._getCommentaries(args.ref);
      case 'search_jewish_library': return SefariaTools._search(args.query, args.filters, args.size);
      case 'get_learning_calendar': return SefariaTools._getCalendar();
      case 'get_text_index': return SefariaTools._getIndex(args.title);
      case 'get_related_texts': return SefariaTools._getRelated(args.ref);
      default: throw new Error('Unknown tool: ' + toolName);
    }
  },

  // --- API methods ---

  async _getText(ref, lang) {
    const params = lang ? `?lang=${lang}` : '';
    const res = await fetch(`${SEFARIA_BASE}/v3/texts/${encodeURIComponent(ref)}${params}`);
    if (!res.ok) throw new Error(`Sefaria error ${res.status} for "${ref}"`);
    const data = await res.json();

    const result = { ref: data.ref || ref, heRef: data.heRef || '' };
    if (data.versions) {
      result.versions = data.versions.map(v => ({
        language: v.language,
        title: v.versionTitle,
        text: SefariaTools._flatten(v.text)
      }));
    } else {
      result.versions = [];
      if (data.he) result.versions.push({ language: 'he', text: SefariaTools._flatten(data.he) });
      if (data.text) result.versions.push({ language: 'en', text: SefariaTools._flatten(data.text) });
    }
    return JSON.stringify(result);
  },

  async _getCommentaries(ref) {
    const res = await fetch(`${SEFARIA_BASE}/links/${encodeURIComponent(ref)}?with_text=1`);
    if (!res.ok) throw new Error(`Sefaria error ${res.status} for links on "${ref}"`);
    const data = await res.json();

    const grouped = {};
    for (const link of data.slice(0, 25)) {
      const cat = link.category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({
        ref: link.ref,
        he: SefariaTools._flatten(link.he),
        en: SefariaTools._flatten(link.text)
      });
    }
    return JSON.stringify({ baseRef: ref, count: data.length, commentaries: grouped });
  },

  async _search(query, filters, size) {
    size = Math.min(size || 10, 20);
    const body = { query, type: 'text', size, field: 'naive_lemmatizer', sort_type: 'relevance' };
    if (filters && filters.length) { body.filters = filters; body.applied_filters = filters; }

    const res = await fetch(`${SEFARIA_BASE}/search-wrapper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) return JSON.stringify({ query, total: 0, results: [], note: 'Search unavailable' });

    const data = await res.json();
    const hits = data.hits?.hits || [];
    return JSON.stringify({
      query,
      total: data.hits?.total?.value || hits.length,
      results: hits.map(h => ({
        ref: h._source?.ref || h._id,
        heRef: h._source?.heRef || '',
        text: h.highlight?.naive_lemmatizer?.[0] || h._source?.naive_lemmatizer || '',
        category: h._source?.path
      }))
    });
  },

  async _getCalendar() {
    const res = await fetch(`${SEFARIA_BASE}/calendars`);
    if (!res.ok) throw new Error(`Sefaria error ${res.status} for calendar`);
    const data = await res.json();
    return JSON.stringify({
      date: data.date,
      items: (data.calendar_items || []).map(item => ({
        title: item.title?.en || item.title,
        heTitle: item.title?.he || '',
        displayValue: item.displayValue?.en || item.displayValue,
        heDisplayValue: item.displayValue?.he || '',
        ref: item.ref,
        category: item.category
      }))
    });
  },

  async _getIndex(title) {
    const res = await fetch(`${SEFARIA_BASE}/v2/index/${encodeURIComponent(title)}`);
    if (!res.ok) throw new Error(`Sefaria error ${res.status} for index "${title}"`);
    const data = await res.json();
    return JSON.stringify({
      title: data.title, heTitle: data.heTitle,
      categories: data.categories, sectionNames: data.sectionNames, length: data.length
    });
  },

  async _getRelated(ref) {
    const res = await fetch(`${SEFARIA_BASE}/related/${encodeURIComponent(ref)}`);
    if (!res.ok) throw new Error(`Sefaria error ${res.status} for related "${ref}"`);
    const data = await res.json();
    return JSON.stringify({
      ref,
      links: (data.links || []).slice(0, 15).map(l => ({ ref: l.ref, category: l.category, type: l.type })),
      sheets: (data.sheets || []).slice(0, 5).map(s => ({ title: s.title, id: s.id }))
    });
  },

  _flatten(text) {
    if (!text) return '';
    if (typeof text === 'string') return text;
    if (Array.isArray(text)) return text.map(t => SefariaTools._flatten(t)).join(' ');
    return String(text);
  }
};
