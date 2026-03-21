const SOURCE_KEYS = ['watchlist', 'research', 'alerts'];
const STALE_MS = 1000 * 60 * 60 * 24;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function newestTimestamp(values) {
  let latest = null;
  for (const value of values) {
    const normalized = normalizeTimestamp(value);
    if (!normalized) continue;
    if (!latest || new Date(normalized).getTime() > new Date(latest).getTime()) {
      latest = normalized;
    }
  }
  return latest;
}

function toSourceStatus(result, generatedAt) {
  if (result.status !== 'fulfilled') return 'error';
  if (!generatedAt) return 'stale';
  return Date.now() - new Date(generatedAt).getTime() > STALE_MS ? 'stale' : 'healthy';
}

function safeJson(result, fallback) {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function createSeed(symbol) {
  return {
    symbol,
    inWatchlist: false,
    priority: 'medium',
    watchlistStatus: 'untracked',
    research: {
      stance: 'unknown',
      summary: '',
      updatedAt: null,
      confidence: null,
    },
    alerts: {
      activeCount: 0,
      lastTriggeredAt: null,
      severity: null,
    },
    actionState: 'monitor',
    _feed: [],
  };
}

function normalizeSymbol(value) {
  return String(value || '').toUpperCase().trim();
}

function normalizeWatchlist(payload) {
  const rows = safeArray(payload?.items || payload?.watchlist || payload?.data || payload);
  const items = new Map();

  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol || row.ticker);
    if (!symbol) continue;

    const current = createSeed(symbol);
    current.inWatchlist = true;
    current.priority = row.priority || 'medium';
    current.watchlistStatus = row.status || row.watch_status || 'watching';

    const createdAt = normalizeTimestamp(row.created_at || row.updated_at);
    if (createdAt) {
      current._feed.push({
        type: 'watchlist_changed',
        symbol,
        title: `${symbol} added to watchlist`,
        createdAt,
      });
    }

    items.set(symbol, current);
  }

  return {
    generatedAt: newestTimestamp([
      payload?.generated_at,
      payload?.generatedAt,
      ...rows.map((row) => row.updated_at || row.created_at),
    ]),
    items,
  };
}

function normalizeResearch(payload, items) {
  const rows = safeArray(payload?.items || payload?.research || payload?.theses || payload?.data || payload);

  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol || row.ticker);
    if (!symbol) continue;

    const current = items.get(symbol) || createSeed(symbol);
    const updatedAt = normalizeTimestamp(
      row.updated_at || row.generated_at || row.created_at || row.last_reviewed_at,
    );

    current.research = {
      stance: row.stance || row.thesis_status || row.sentiment || row.rating || 'unknown',
      summary: row.summary || row.why_it_matters || row.thesis || row.note || '',
      updatedAt,
      confidence: typeof row.confidence === 'number' ? row.confidence : null,
    };

    if (updatedAt) {
      current._feed.push({
        type: 'research_updated',
        symbol,
        title: current.research.summary || `${symbol} research updated`,
        createdAt: updatedAt,
      });
    }

    items.set(symbol, current);
  }

  return {
    generatedAt: newestTimestamp([
      payload?.generated_at,
      payload?.generatedAt,
      ...rows.map((row) => row.updated_at || row.generated_at || row.created_at),
    ]),
  };
}

function isActiveAlert(row) {
  if (typeof row.active === 'boolean') return row.active;
  if (typeof row.resolved === 'boolean') return !row.resolved;
  if (typeof row.approval_required === 'boolean' && row.approval_status === 'pending') return true;
  const status = String(row.status || '').toLowerCase();
  return status === 'active' || status === 'open' || status === 'pending';
}

function normalizeAlerts(payload, items) {
  const rows = safeArray(payload?.items || payload?.alerts || payload?.data || payload);

  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol || row.ticker);
    if (!symbol) continue;

    const current = items.get(symbol) || createSeed(symbol);
    const createdAt = normalizeTimestamp(row.created_at || row.updated_at || row.triggered_at);
    const active = isActiveAlert(row);

    current.alerts.activeCount += active ? 1 : 0;
    current.alerts.lastTriggeredAt = newestTimestamp([
      current.alerts.lastTriggeredAt,
      createdAt,
    ]);
    current.alerts.severity = row.severity || current.alerts.severity || null;

    if (createdAt) {
      current._feed.push({
        type: 'alert_triggered',
        symbol,
        title: row.title || row.why_it_matters || row.message || 'Alert triggered',
        createdAt,
      });
    }

    items.set(symbol, current);
  }

  return {
    generatedAt: newestTimestamp([
      payload?.generated_at,
      payload?.generatedAt,
      ...rows.map((row) => row.created_at || row.updated_at || row.triggered_at),
    ]),
  };
}

function deriveActionState(item) {
  if (item.alerts.activeCount > 0 && item.alerts.severity === 'high') return 'act';
  if (item.alerts.activeCount > 0 || item.research.stance === 'unknown') return 'review';
  return 'monitor';
}

function actionRank(actionState) {
  return { act: 0, review: 1, monitor: 2, blocked: 3 }[actionState] ?? 4;
}

function freshnessRank(updatedAt) {
  if (!updatedAt) return Number.POSITIVE_INFINITY;
  return Date.now() - new Date(updatedAt).getTime();
}

function summarize(items) {
  const rows = [...items.values()].map((item) => {
    item.actionState = deriveActionState(item);
    delete item._feed;
    return item;
  });

  const summary = {
    watchlistCount: rows.filter((item) => item.inWatchlist).length,
    activeAlerts: rows.reduce((sum, item) => sum + (item.alerts.activeCount || 0), 0),
    freshResearchCount: rows.filter((item) => item.research.updatedAt).length,
    needsReviewCount: rows.filter((item) => item.actionState !== 'monitor').length,
  };

  rows.sort((left, right) => (
    actionRank(left.actionState) - actionRank(right.actionState) ||
    (right.alerts.activeCount || 0) - (left.alerts.activeCount || 0) ||
    freshnessRank(left.research.updatedAt) - freshnessRank(right.research.updatedAt) ||
    left.symbol.localeCompare(right.symbol)
  ));

  return { rows, summary };
}

function buildMeta(key, result, generatedAt) {
  return {
    status: toSourceStatus(result, generatedAt),
    generatedAt,
    error: result.status === 'rejected' ? result.reason?.message || `${key} unavailable` : null,
  };
}

async function buildBusinessIntelligenceSnapshot(fetchSource) {
  const results = await Promise.allSettled([
    fetchSource('/api/investments/watchlist'),
    fetchSource('/api/investments/research'),
    fetchSource('/api/investments/alerts'),
  ]);

  const [watchlistResult, researchResult, alertsResult] = results;

  const watchlistPayload = normalizeWatchlist(safeJson(watchlistResult, { items: [] }));
  const items = watchlistPayload.items;
  const researchPayload = normalizeResearch(safeJson(researchResult, { items: [] }), items);
  const alertsPayload = normalizeAlerts(safeJson(alertsResult, { items: [] }), items);

  const feed = [...items.values()]
    .flatMap((item) => item._feed || [])
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 20);

  const { rows, summary } = summarize(items);
  const allFailed = results.every((result) => result.status === 'rejected');

  return {
    status: allFailed ? 503 : 200,
    body: {
      generatedAt: new Date().toISOString(),
      sourceHealth: {
        watchlist: buildMeta(SOURCE_KEYS[0], watchlistResult, watchlistPayload.generatedAt),
        research: buildMeta(SOURCE_KEYS[1], researchResult, researchPayload.generatedAt),
        alerts: buildMeta(SOURCE_KEYS[2], alertsResult, alertsPayload.generatedAt),
      },
      summary,
      items: rows,
      feed,
    },
  };
}

module.exports = {
  buildBusinessIntelligenceSnapshot,
  normalizeSymbol,
};