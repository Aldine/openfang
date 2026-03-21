'use client';

import { useEffect, useState } from 'react';

const EMPTY_STATE = {
  generatedAt: null,
  sourceHealth: {
    watchlist: { status: 'stale', generatedAt: null, error: null },
    research: { status: 'stale', generatedAt: null, error: null },
    alerts: { status: 'stale', generatedAt: null, error: null },
  },
  summary: {
    watchlistCount: 0,
    activeAlerts: 0,
    freshResearchCount: 0,
    needsReviewCount: 0,
  },
  items: [],
  feed: [],
};

function fmtTime(value) {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No timestamp';
  return date.toLocaleString();
}

function statusColor(status) {
  if (status === 'healthy') return '#22c55e';
  if (status === 'error') return '#ef4444';
  return '#f59e0b';
}

function actionTone(actionState) {
  if (actionState === 'act') return { color: '#ef4444', bg: 'rgba(239,68,68,0.08)' };
  if (actionState === 'review') return { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' };
  return { color: 'var(--text)', bg: 'rgba(148,163,184,0.08)' };
}

export default function BusinessIntelligenceTab() {
  const [data, setData] = useState(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const response = await fetch('/api/investments/business-intelligence', {
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!active) return;

        setData(payload || EMPTY_STATE);
        setError(response.ok ? null : 'Business Intelligence degraded');
      } catch (event) {
        if (!active) return;
        setData(EMPTY_STATE);
        setError(event?.message || 'Failed to load Business Intelligence');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ padding: '18px 20px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Loading Business Intelligence…</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Business Intelligence</h2>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', maxWidth: 720 }}>
            One read-only operating console for what matters now, what changed, what needs attention, and which sources are stale.
          </p>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Generated {fmtTime(data.generatedAt)}
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: '12px 14px', marginBottom: 16, color: '#f59e0b', fontSize: 12 }}>
          {error}
        </div>
      ) : null}

      <section className="grid grid-4" style={{ gap: 12, marginBottom: 16 }}>
        <SummaryCard label="Watchlist" value={data.summary.watchlistCount} />
        <SummaryCard label="Active alerts" value={data.summary.activeAlerts} />
        <SummaryCard label="Fresh research" value={data.summary.freshResearchCount} />
        <SummaryCard label="Needs review" value={data.summary.needsReviewCount} />
      </section>

      <section className="card" style={{ padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Source health</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Healthy sources still render when one source degrades.</div>
        </div>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <HealthRow label="Watchlist" meta={data.sourceHealth.watchlist} />
          <HealthRow label="Research" meta={data.sourceHealth.research} />
          <HealthRow label="Alerts" meta={data.sourceHealth.alerts} />
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
          Symbols that matter now
        </div>
        {data.items.length === 0 ? (
          <div style={{ padding: '18px 16px', fontSize: 12, color: 'var(--text-dim)' }}>
            No live investment signals available.
          </div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 110px minmax(220px,1.7fr) 140px 120px 120px 90px 110px', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <div>Symbol</div>
              <div>Watchlist</div>
              <div>Latest thesis</div>
              <div>Research freshness</div>
              <div>Active alerts</div>
              <div>Last alert</div>
              <div>Priority</div>
              <div>Action</div>
            </div>
            {data.items.map((item) => {
              const tone = actionTone(item.actionState);
              return (
                <div key={item.symbol} style={{ display: 'grid', gridTemplateColumns: '120px 110px minmax(220px,1.7fr) 140px 120px 120px 90px 110px', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--border)', alignItems: 'start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{item.symbol}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{item.inWatchlist ? 'tracked' : 'research only'}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>{item.watchlistStatus}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{item.research.stance || 'unknown'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{item.research.summary || 'No research summary'}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmtTime(item.research.updatedAt)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>{item.alerts.activeCount} active</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmtTime(item.alerts.lastTriggeredAt)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>{item.priority}</div>
                  <div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 999, background: tone.bg, color: tone.color, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {item.actionState}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
          Recent activity
        </div>
        {data.feed.length === 0 ? (
          <div style={{ padding: '18px 16px', fontSize: 12, color: 'var(--text-dim)' }}>
            No recent investment activity.
          </div>
        ) : (
          <div>
            {data.feed.map((event, index) => (
              <div key={`${event.type}-${event.symbol}-${event.createdAt}-${index}`} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>{event.symbol}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmtTime(event.createdAt)}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 3 }}>{event.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{event.type}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function HealthRow({ label, meta }) {
  const color = statusColor(meta?.status);

  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color }}>{meta?.status || 'unknown'}</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: meta?.error ? 6 : 0 }}>{fmtTime(meta?.generatedAt)}</div>
      {meta?.error ? <div style={{ fontSize: 11, color: '#ef4444', lineHeight: 1.45 }}>{meta.error}</div> : null}
    </div>
  );
}