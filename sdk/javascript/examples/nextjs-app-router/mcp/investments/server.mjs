import { createRequire } from 'node:module';

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

const require = createRequire(import.meta.url);
const { api } = require('../../lib/api-server.js');
const {
  buildBusinessIntelligenceSnapshot,
  normalizeSymbol,
} = require('../../lib/investments/business-intelligence.js');

const host = process.env.OPENFANG_INVESTMENTS_MCP_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.OPENFANG_INVESTMENTS_MCP_PORT || '8787', 10);
const token = String(process.env.OPENFANG_INVESTMENTS_MCP_TOKEN || '').trim();
const allowedOrigins = String(process.env.OPENFANG_INVESTMENTS_MCP_ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const allowedHosts = String(process.env.OPENFANG_INVESTMENTS_MCP_ALLOWED_HOSTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function buildJsonRpcError(code, message, id = null) {
  return {
    jsonrpc: '2.0',
    error: { code, message },
    id,
  };
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.length > 0) return allowedOrigins.includes(origin);
  return isLoopbackOrigin(origin);
}

function requireBearerAuth(req, res, next) {
  if (!token) {
    res.status(500).json(buildJsonRpcError(-32603, 'Server misconfigured: OPENFANG_INVESTMENTS_MCP_TOKEN is required'));
    return;
  }

  const header = String(req.headers.authorization || '');
  if (header !== `Bearer ${token}`) {
    res.status(401).json(buildJsonRpcError(-32001, 'Unauthorized'));
    return;
  }

  next();
}

function validateOrigin(req, res, next) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!isAllowedOrigin(origin)) {
    res.status(403).json(buildJsonRpcError(-32003, 'Origin not allowed'));
    return;
  }

  next();
}

async function fetchInvestmentSource(path) {
  try {
    return await api.get(path);
  } catch (error) {
    if (error?.status === 404 || error?.status === 405) {
      if (path.endsWith('/watchlist')) return [];
      if (path.endsWith('/research')) return { research: [], theses: [] };
      if (path.endsWith('/alerts')) return [];
    }
    throw error;
  }
}

async function getSnapshot() {
  const result = await buildBusinessIntelligenceSnapshot(fetchInvestmentSource);
  return result.body;
}

function jsonResource(uri, value) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function missingSymbol(kind, symbol, snapshot) {
  return {
    generatedAt: snapshot.generatedAt,
    sourceHealth: snapshot.sourceHealth,
    symbol,
    error: `${kind} not found`,
  };
}

async function listTrackedSymbols() {
  const snapshot = await getSnapshot();
  return snapshot.items.map((item) => item.symbol);
}

function buildServer() {
  const server = new McpServer(
    {
      name: 'openfang-investments-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        resources: {},
        prompts: {},
      },
    },
  );

  server.registerResource(
    'bi-overview',
    'bi://overview',
    {
      title: 'BI Overview',
      description: 'Unified read-only investment operating snapshot',
      mimeType: 'application/json',
    },
    async (uri) => jsonResource(uri, await getSnapshot()),
  );

  server.registerResource(
    'watchlist-symbols',
    'watchlist://symbols',
    {
      title: 'Watchlist Symbols',
      description: 'Current watchlist state from the shared investment snapshot',
      mimeType: 'application/json',
    },
    async (uri) => {
      const snapshot = await getSnapshot();
      const items = snapshot.items.filter((item) => item.inWatchlist);
      return jsonResource(uri, {
        generatedAt: snapshot.generatedAt,
        sourceHealth: snapshot.sourceHealth,
        count: items.length,
        items,
      });
    },
  );

  server.registerResource(
    'watchlist-symbol',
    new ResourceTemplate('watchlist://symbol/{ticker}', {
      list: async () => {
        const symbols = await listTrackedSymbols();
        return {
          resources: symbols.map((symbol) => ({
            name: symbol,
            uri: `watchlist://symbol/${encodeURIComponent(symbol)}`,
            description: `Unified watchlist state for ${symbol}`,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Watchlist Symbol',
      description: 'Watchlist detail for a single tracked symbol',
      mimeType: 'application/json',
    },
    async (uri, { ticker }) => {
      const snapshot = await getSnapshot();
      const symbol = normalizeSymbol(ticker);
      const item = snapshot.items.find((entry) => entry.symbol === symbol && entry.inWatchlist);
      return jsonResource(uri, item ? {
        generatedAt: snapshot.generatedAt,
        sourceHealth: snapshot.sourceHealth,
        symbol,
        item,
      } : missingSymbol('watchlist symbol', symbol, snapshot));
    },
  );

  server.registerResource(
    'research-symbol',
    new ResourceTemplate('research://symbol/{ticker}', {
      list: async () => {
        const symbols = await listTrackedSymbols();
        return {
          resources: symbols.map((symbol) => ({
            name: symbol,
            uri: `research://symbol/${encodeURIComponent(symbol)}`,
            description: `Latest research state for ${symbol}`,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Research Symbol',
      description: 'Research detail for a single tracked symbol',
      mimeType: 'application/json',
    },
    async (uri, { ticker }) => {
      const snapshot = await getSnapshot();
      const symbol = normalizeSymbol(ticker);
      const item = snapshot.items.find((entry) => entry.symbol === symbol && (entry.research.summary || entry.research.updatedAt));
      return jsonResource(uri, item ? {
        generatedAt: snapshot.generatedAt,
        sourceHealth: snapshot.sourceHealth,
        symbol,
        research: item.research,
        actionState: item.actionState,
      } : missingSymbol('research symbol', symbol, snapshot));
    },
  );

  server.registerResource(
    'alerts-active',
    'alerts://active',
    {
      title: 'Active Alerts',
      description: 'All tracked symbols with currently active alerts',
      mimeType: 'application/json',
    },
    async (uri) => {
      const snapshot = await getSnapshot();
      const items = snapshot.items.filter((item) => item.alerts.activeCount > 0);
      return jsonResource(uri, {
        generatedAt: snapshot.generatedAt,
        sourceHealth: snapshot.sourceHealth,
        count: items.length,
        items,
      });
    },
  );

  server.registerResource(
    'alerts-symbol',
    new ResourceTemplate('alerts://symbol/{ticker}', {
      list: async () => {
        const symbols = await listTrackedSymbols();
        return {
          resources: symbols.map((symbol) => ({
            name: symbol,
            uri: `alerts://symbol/${encodeURIComponent(symbol)}`,
            description: `Alert state for ${symbol}`,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Alerts By Symbol',
      description: 'Alert state for a single tracked symbol',
      mimeType: 'application/json',
    },
    async (uri, { ticker }) => {
      const snapshot = await getSnapshot();
      const symbol = normalizeSymbol(ticker);
      const item = snapshot.items.find((entry) => entry.symbol === symbol && (entry.alerts.activeCount > 0 || entry.alerts.lastTriggeredAt));
      return jsonResource(uri, item ? {
        generatedAt: snapshot.generatedAt,
        sourceHealth: snapshot.sourceHealth,
        symbol,
        alerts: item.alerts,
        actionState: item.actionState,
      } : missingSymbol('alerts symbol', symbol, snapshot));
    },
  );

  server.registerPrompt(
    'morning-brief',
    {
      title: 'Morning Brief',
      description: 'Build a focused market-open investment brief from the live BI snapshot',
      argsSchema: z.object({
        focusSymbols: z.string().optional().describe('Comma-separated ticker list'),
        maxItems: z.number().int().min(1).max(25).default(12),
      }),
    },
    async ({ focusSymbols, maxItems }) => {
      const snapshot = await getSnapshot();
      const focusSet = new Set(
        String(focusSymbols || '')
          .split(',')
          .map((value) => normalizeSymbol(value))
          .filter(Boolean),
      );
      const items = focusSet.size > 0
        ? snapshot.items.filter((item) => focusSet.has(item.symbol))
        : snapshot.items.slice(0, maxItems);
      const feed = focusSet.size > 0
        ? snapshot.feed.filter((item) => focusSet.has(item.symbol)).slice(0, maxItems)
        : snapshot.feed.slice(0, maxItems);

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                'Write a tight morning investment brief from this live OpenFang snapshot.',
                'Answer in four sections: what matters now, what changed, what needs action, and where data is stale or degraded.',
                '',
                JSON.stringify({
                  generatedAt: snapshot.generatedAt,
                  sourceHealth: snapshot.sourceHealth,
                  summary: snapshot.summary,
                  items,
                  feed,
                }, null, 2),
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'review-symbol',
    {
      title: 'Review Symbol',
      description: 'Review a single symbol with watchlist, research, and alert context',
      argsSchema: z.object({
        ticker: z.string().describe('Ticker symbol, for example AAPL'),
      }),
    },
    async ({ ticker }) => {
      const snapshot = await getSnapshot();
      const symbol = normalizeSymbol(ticker);
      const item = snapshot.items.find((entry) => entry.symbol === symbol);

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Review ${symbol} using this live investment snapshot.`,
                'Answer in four sections: current stance, what changed, risks and contradictions, action now.',
                '',
                JSON.stringify(item ? {
                  generatedAt: snapshot.generatedAt,
                  sourceHealth: snapshot.sourceHealth,
                  item,
                } : missingSymbol('tracked symbol', symbol, snapshot), null, 2),
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'portfolio-risk-scan',
    {
      title: 'Portfolio Risk Scan',
      description: 'Scan the current operating state for attention, freshness, and alert risk',
      argsSchema: z.object({
        maxItems: z.number().int().min(1).max(50).default(20),
      }),
    },
    async ({ maxItems }) => {
      const snapshot = await getSnapshot();
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                'Run a portfolio risk scan on this OpenFang investment operating snapshot.',
                'Look for symbols requiring review now, clusters of alerts, stale research, and degraded source health. End with a ranked action list.',
                '',
                JSON.stringify({
                  generatedAt: snapshot.generatedAt,
                  sourceHealth: snapshot.sourceHealth,
                  summary: snapshot.summary,
                  items: snapshot.items.slice(0, maxItems),
                }, null, 2),
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  return server;
}

const app = createMcpExpressApp({
  host,
  allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'openfang-investments-mcp',
    host,
    port,
  });
});

app.use('/mcp', validateOrigin, requireBearerAuth);

app.post('/mcp', async (req, res) => {
  const server = buildServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on('close', () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json(buildJsonRpcError(-32603, 'Internal server error'));
    }
  }
});

app.get('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').send('Method Not Allowed');
});

app.delete('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').send('Method Not Allowed');
});

app.listen(port, host, (error) => {
  if (error) {
    console.error('Failed to start OpenFang investments MCP server:', error);
    process.exit(1);
  }

  console.log(`OpenFang investments MCP server listening on http://${host}:${port}/mcp`);
});