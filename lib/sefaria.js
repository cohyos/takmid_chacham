/**
 * Sefaria API Client - provides tool functions for accessing Jewish texts
 * Acts as a local MCP-like interface to Sefaria.org's public API
 */

const SEFARIA_BASE = 'https://www.sefaria.org/api';

class SefariaClient {
  /**
   * Fetch a Jewish text by reference
   * @param {string} ref - Text reference (e.g. "Genesis 1:1", "משנה ברכות א:א", "Rashi on Genesis 1:1")
   * @param {object} options - Optional parameters
   * @param {string} options.lang - Language: 'he' for Hebrew, 'en' for English, 'bi' for bilingual
   * @param {boolean} options.context - Whether to include surrounding context
   */
  async getText(ref, options = {}) {
    const params = new URLSearchParams();
    if (options.lang) params.set('lang', options.lang);
    if (options.context === false) params.set('context', '0');

    const encodedRef = encodeURIComponent(ref);
    const url = `${SEFARIA_BASE}/v3/texts/${encodedRef}?${params}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Sefaria API error: ${res.status} for ref "${ref}"`);
    }
    const data = await res.json();

    return this._formatTextResponse(data, ref);
  }

  /**
   * Get commentaries/links for a given text reference
   * @param {string} ref - Text reference
   */
  async getCommentaries(ref) {
    const encodedRef = encodeURIComponent(ref);
    const url = `${SEFARIA_BASE}/links/${encodedRef}?with_text=1`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Sefaria API error: ${res.status} for links on "${ref}"`);
    }
    const data = await res.json();

    // Group by commentary type and limit results
    const grouped = {};
    for (const link of data.slice(0, 30)) {
      const cat = link.category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({
        ref: link.ref,
        he: this._flattenText(link.he),
        en: this._flattenText(link.text),
        type: link.type,
        sourceRef: link.sourceRef
      });
    }

    return {
      baseRef: ref,
      commentaryCount: data.length,
      commentaries: grouped
    };
  }

  /**
   * Search the Sefaria library
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @param {string} options.type - 'text' for source texts, 'sheet' for user sheets
   * @param {number} options.size - Number of results (default 10)
   * @param {string[]} options.filters - Category filters (e.g. ["Talmud", "Midrash"])
   */
  async search(query, options = {}) {
    const type = options.type || 'text';
    const size = options.size || 10;

    const body = {
      query,
      type,
      size,
      field: 'naive_lemmatizer',
      sort_type: 'relevance'
    };

    if (options.filters && options.filters.length > 0) {
      body.filters = options.filters;
      body.applied_filters = options.filters;
    }

    const url = `${SEFARIA_BASE}/search-wrapper`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      // Fallback to GET search
      return this._searchFallback(query, size);
    }

    const data = await res.json();
    return this._formatSearchResponse(data, query);
  }

  /**
   * Get the daily/weekly learning calendar (Daf Yomi, Parashat HaShavua, etc.)
   */
  async getCalendar() {
    const url = `${SEFARIA_BASE}/calendars`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Sefaria API error: ${res.status} for calendar`);
    }
    const data = await res.json();

    return {
      date: data.date,
      timezone: data.timezone,
      items: (data.calendar_items || []).map(item => ({
        title: item.title?.en || item.title,
        heTitle: item.title?.he || '',
        displayValue: item.displayValue?.en || item.displayValue,
        heDisplayValue: item.displayValue?.he || '',
        ref: item.ref,
        category: item.category,
        description: item.description?.en || ''
      }))
    };
  }

  /**
   * Get the index/table of contents for a specific text
   * @param {string} title - Title of the text (e.g. "Genesis", "Berakhot")
   */
  async getIndex(title) {
    const encodedTitle = encodeURIComponent(title);
    const url = `${SEFARIA_BASE}/v2/index/${encodedTitle}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Sefaria API error: ${res.status} for index "${title}"`);
    }
    const data = await res.json();

    return {
      title: data.title,
      heTitle: data.heTitle,
      categories: data.categories,
      sectionNames: data.sectionNames,
      length: data.length,
      order: data.order
    };
  }

  /**
   * Get related texts for a reference (connections, sheets, notes, etc.)
   * @param {string} ref - Text reference
   */
  async getRelated(ref) {
    const encodedRef = encodeURIComponent(ref);
    const url = `${SEFARIA_BASE}/related/${encodedRef}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Sefaria API error: ${res.status} for related "${ref}"`);
    }
    const data = await res.json();

    return {
      ref,
      links: (data.links || []).slice(0, 20).map(l => ({
        ref: l.ref,
        category: l.category,
        type: l.type
      })),
      sheets: (data.sheets || []).slice(0, 5).map(s => ({
        title: s.title,
        id: s.id,
        owner_name: s.owner_name
      }))
    };
  }

  // ---- Tool definitions for Gemini function calling ----

  static getToolDeclarations() {
    return [
      {
        name: 'get_jewish_text',
        description: `Retrieve a Jewish text from the Sefaria library by reference. Supports Tanakh, Talmud, Midrash, Halakha, Kabbalah, and more. References can be in English or Hebrew. Examples: "Genesis 1:1-5", "Berakhot 2a", "Rashi on Genesis 1:1", "משנה ברכות א:א", "Shulchan Arukh, Orach Chaim 1:1"`,
        parameters: {
          type: 'object',
          properties: {
            ref: {
              type: 'string',
              description: 'The text reference (e.g. "Genesis 1:1", "Berakhot 2a:1-5", "Rambam Hilchot Shabbat 1:1")'
            },
            lang: {
              type: 'string',
              description: 'Language preference: "he" for Hebrew, "en" for English, "bi" for bilingual',
              enum: ['he', 'en', 'bi']
            }
          },
          required: ['ref']
        }
      },
      {
        name: 'get_commentaries',
        description: 'Get commentaries and linked texts for a given reference. Returns commentaries from Rashi, Tosafot, Ramban, Ibn Ezra, and many others as available.',
        parameters: {
          type: 'object',
          properties: {
            ref: {
              type: 'string',
              description: 'The text reference to get commentaries for'
            }
          },
          required: ['ref']
        }
      },
      {
        name: 'search_jewish_library',
        description: 'Search across the entire Sefaria Jewish text library. Use for finding texts by topic, keyword, or concept. Can filter by category.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (Hebrew or English)'
            },
            filters: {
              type: 'array',
              items: { type: 'string' },
              description: 'Category filters: "Tanakh", "Talmud", "Midrash", "Halakhah", "Kabbalah", "Liturgy", "Tosefta", "Mishnah", etc.'
            },
            size: {
              type: 'number',
              description: 'Number of results to return (default 10, max 20)'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'get_learning_calendar',
        description: 'Get the Jewish daily/weekly learning schedule: Daf Yomi, Parashat HaShavua, Haftarah, 929, Mishnah Yomit, and other learning cycles.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_text_index',
        description: 'Get metadata and structure information about a text in the Sefaria library (sections, length, categories).',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Title of the text (e.g. "Genesis", "Berakhot", "Mishneh Torah")'
            }
          },
          required: ['title']
        }
      },
      {
        name: 'get_related_texts',
        description: 'Get texts related to a given reference, including cross-references, related topics, and user-created source sheets.',
        parameters: {
          type: 'object',
          properties: {
            ref: {
              type: 'string',
              description: 'The text reference'
            }
          },
          required: ['ref']
        }
      }
    ];
  }

  /**
   * Execute a tool call by name
   */
  async executeTool(toolName, args) {
    switch (toolName) {
      case 'get_jewish_text':
        return this.getText(args.ref, { lang: args.lang || 'bi' });
      case 'get_commentaries':
        return this.getCommentaries(args.ref);
      case 'search_jewish_library':
        return this.search(args.query, {
          filters: args.filters,
          size: Math.min(args.size || 10, 20)
        });
      case 'get_learning_calendar':
        return this.getCalendar();
      case 'get_text_index':
        return this.getIndex(args.title);
      case 'get_related_texts':
        return this.getRelated(args.ref);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // ---- Private helpers ----

  _flattenText(text) {
    if (!text) return '';
    if (typeof text === 'string') return text;
    if (Array.isArray(text)) return text.map(t => this._flattenText(t)).join(' ');
    return String(text);
  }

  _formatTextResponse(data, ref) {
    const result = {
      ref: data.ref || ref,
      heRef: data.heRef || '',
      versions: []
    };

    // Extract text versions
    if (data.versions) {
      for (const v of data.versions) {
        result.versions.push({
          language: v.language,
          versionTitle: v.versionTitle,
          text: this._flattenText(v.text)
        });
      }
    }

    // Fallback for older API format
    if (result.versions.length === 0) {
      if (data.he) {
        result.versions.push({
          language: 'he',
          versionTitle: 'Hebrew',
          text: this._flattenText(data.he)
        });
      }
      if (data.text) {
        result.versions.push({
          language: 'en',
          versionTitle: 'English',
          text: this._flattenText(data.text)
        });
      }
    }

    return result;
  }

  _formatSearchResponse(data, query) {
    const hits = data.hits?.hits || [];
    return {
      query,
      total: data.hits?.total?.value || data.hits?.total || hits.length,
      results: hits.map(hit => ({
        ref: hit._source?.ref || hit._id,
        heRef: hit._source?.heRef || '',
        text: hit.highlight?.naive_lemmatizer?.[0] || hit._source?.naive_lemmatizer || '',
        category: hit._source?.path,
        score: hit._score
      }))
    };
  }

  async _searchFallback(query, size) {
    const params = new URLSearchParams({
      q: query,
      size: String(size)
    });
    const url = `${SEFARIA_BASE}/search/text?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { query, total: 0, results: [], error: 'Search temporarily unavailable' };
    }
    const data = await res.json();
    return this._formatSearchResponse(data, query);
  }
}

module.exports = { SefariaClient };
