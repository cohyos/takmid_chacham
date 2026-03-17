/**
 * MCP Client - Connects to remote MCP servers (Sefaria, HebCal)
 * Discovers tools dynamically and exposes them for Gemini function calling
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

// Default MCP server endpoints (no API keys needed)
const DEFAULT_MCP_SERVERS = {
  sefaria: {
    url: 'https://mcp.sefaria.org/sse',
    name: 'Sefaria',
    description: 'Jewish texts library - Tanakh, Talmud, Midrash, Halakha, commentaries, manuscripts'
  },
  hebcal: {
    url: 'https://www.hebcal.com/mcp',
    name: 'HebCal',
    description: 'Jewish calendar - holidays, zmanim, parasha, candle lighting times'
  }
};

class McpToolManager {
  constructor(serverConfigs = DEFAULT_MCP_SERVERS) {
    this.serverConfigs = serverConfigs;
    this.clients = new Map();       // serverId -> MCP Client
    this.toolMap = new Map();       // toolName -> { serverId, schema }
    this.ready = false;
  }

  /**
   * Connect to all configured MCP servers and discover tools
   */
  async connect() {
    const results = [];

    for (const [serverId, config] of Object.entries(this.serverConfigs)) {
      try {
        const client = new Client(
          { name: 'takmid-chacham', version: '1.0.0' },
          { capabilities: { tools: {} } }
        );

        const transport = new SSEClientTransport(new URL(config.url));
        await client.connect(transport);

        this.clients.set(serverId, client);

        // Discover tools
        const { tools } = await client.listTools();
        for (const tool of tools) {
          // Prefix tool names to avoid collisions
          const prefixedName = `${serverId}__${tool.name}`;
          this.toolMap.set(prefixedName, {
            serverId,
            originalName: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          });
        }

        results.push({
          serverId,
          name: config.name,
          status: 'connected',
          toolCount: tools.length,
          tools: tools.map(t => t.name)
        });

        console.log(`  MCP [${config.name}]: connected (${tools.length} tools)`);
      } catch (err) {
        results.push({
          serverId,
          name: config.name,
          status: 'error',
          error: err.message
        });
        console.error(`  MCP [${config.name}]: connection failed - ${err.message}`);
      }
    }

    this.ready = true;
    return results;
  }

  /**
   * Get Gemini-compatible function declarations for all discovered tools
   */
  getGeminiFunctionDeclarations() {
    const declarations = [];

    for (const [prefixedName, toolInfo] of this.toolMap) {
      declarations.push({
        name: prefixedName,
        description: `[${this.serverConfigs[toolInfo.serverId]?.name || toolInfo.serverId}] ${toolInfo.description || ''}`,
        parameters: this._convertToGeminiSchema(toolInfo.inputSchema)
      });
    }

    return declarations;
  }

  /**
   * Execute a tool call via the appropriate MCP server
   */
  async callTool(prefixedName, args) {
    const toolInfo = this.toolMap.get(prefixedName);
    if (!toolInfo) {
      throw new Error(`Unknown tool: ${prefixedName}`);
    }

    const client = this.clients.get(toolInfo.serverId);
    if (!client) {
      throw new Error(`MCP server not connected: ${toolInfo.serverId}`);
    }

    const result = await client.callTool({
      name: toolInfo.originalName,
      arguments: args || {}
    });

    // Extract text content from MCP result
    if (result.content) {
      return result.content
        .map(c => {
          if (c.type === 'text') return c.text;
          if (c.type === 'image') return `[Image: ${c.mimeType}]`;
          return JSON.stringify(c);
        })
        .join('\n');
    }

    return JSON.stringify(result);
  }

  /**
   * Get a human-readable display name for a tool
   */
  getToolDisplayName(prefixedName) {
    const toolInfo = this.toolMap.get(prefixedName);
    if (!toolInfo) return prefixedName;
    const serverName = this.serverConfigs[toolInfo.serverId]?.name || toolInfo.serverId;
    return `${serverName}: ${toolInfo.originalName}`;
  }

  /**
   * Disconnect all MCP clients
   */
  async disconnect() {
    for (const [serverId, client] of this.clients) {
      try {
        await client.close();
      } catch (err) {
        console.error(`Error disconnecting ${serverId}:`, err.message);
      }
    }
    this.clients.clear();
    this.toolMap.clear();
    this.ready = false;
  }

  /**
   * Convert JSON Schema to Gemini-compatible parameter schema
   * Gemini function calling uses a subset of JSON Schema
   */
  _convertToGeminiSchema(inputSchema) {
    if (!inputSchema) {
      return { type: 'object', properties: {} };
    }

    // Deep clone and clean the schema for Gemini compatibility
    return this._cleanSchemaForGemini(JSON.parse(JSON.stringify(inputSchema)));
  }

  _cleanSchemaForGemini(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    // Remove unsupported keywords
    delete schema.$schema;
    delete schema.additionalProperties;
    delete schema.default;
    delete schema.examples;
    delete schema.$ref;
    delete schema.allOf;
    delete schema.anyOf;
    delete schema.oneOf;
    delete schema.not;
    delete schema.if;
    delete schema.then;
    delete schema.else;

    // Recursively clean nested schemas
    if (schema.properties) {
      for (const key of Object.keys(schema.properties)) {
        schema.properties[key] = this._cleanSchemaForGemini(schema.properties[key]);
      }
    }
    if (schema.items) {
      schema.items = this._cleanSchemaForGemini(schema.items);
    }

    return schema;
  }
}

module.exports = { McpToolManager, DEFAULT_MCP_SERVERS };
