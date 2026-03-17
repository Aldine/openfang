'use client';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../../lib/api-client';
import { track } from '../../lib/telemetry';

// ---------------------------------------------------------------------------
// RegistryResultCard — state machine for a single result
// ---------------------------------------------------------------------------
function RegistryResultCard({ card, installing, onInstall }) {
  const { name, description, author, version, runtime, popularity,
          installed, bundled, installable } = card;

  let badgeEl = null;
  if (bundled) {
    badgeEl = (
      <span data-cy="install-badge-bundled" className="badge badge-success" style={{ fontSize: 10 }}>
        Bundled
      </span>
    );
  } else if (installed) {
    badgeEl = (
      <span data-cy="install-badge-installed" className="badge badge-info" style={{ fontSize: 10 }}>
        Installed
      </span>
    );
  }

  let btnLabel = 'Install';
  let btnDisabled = !installable || installing;
  if (installing)   btnLabel = 'Installing…';
  if (installed)    btnLabel = 'Installed';
  if (bundled)      btnLabel = 'Bundled';   // bundled overrides installed

  return (
    <div data-cy="install-result-card" className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{name}</div>
          {description && (
            <div
              className="text-sm text-dim"
              style={{ marginTop: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
            >
              {description}
            </div>
          )}
        </div>
        <button
          data-cy="install-btn"
          data-skill={name}
          className="btn btn-primary btn-sm"
          onClick={() => installable && !installing && onInstall(name)}
          disabled={btnDisabled}
          style={{ whiteSpace: 'nowrap', minWidth: 84, flexShrink: 0 }}
        >
          {installing
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div className="spinner" style={{ width: 10, height: 10 }} />
                Installing…
              </span>
            : btnLabel}
        </button>
      </div>

      {/* Meta badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {badgeEl}
        {runtime && (
          <span className="badge badge-muted" style={{ fontSize: 10 }}>{runtime}</span>
        )}
        {version && (
          <span className="badge badge-dim" style={{ fontSize: 10 }}>v{version}</span>
        )}
        {author && (
          <span className="badge badge-dim" style={{ fontSize: 10 }}>by {author}</span>
        )}
        {popularity > 0 && (
          <span className="badge badge-dim" style={{ fontSize: 10 }}>★ {popularity.toLocaleString()}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InstallModal — main export
// ---------------------------------------------------------------------------
export default function InstallModal({ open, onClose, onInstallSuccess }) {
  const [activeTab, setActiveTab]           = useState('browse');
  const [query, setQuery]                   = useState('');
  const [searchResults, setSearchResults]   = useState([]);
  const [browseResults, setBrowseResults]   = useState([]);
  const [loadingSearch, setLoadingSearch]   = useState(false);
  const [loadingBrowse, setLoadingBrowse]   = useState(false);
  const [errorSearch, setErrorSearch]       = useState('');
  const [errorBrowse, setErrorBrowse]       = useState('');
  const [installingBySkill, setInstallingBySkill] = useState({});
  const [installSuccessName, setInstallSuccessName] = useState('');

  // ------------------------------------------------------------------
  // Load browse results whenever the modal opens
  // ------------------------------------------------------------------
  const loadBrowse = useCallback(async () => {
    if (loadingBrowse) return;
    setLoadingBrowse(true);
    setErrorBrowse('');
    try {
      const data = await apiClient.get('/api/clawhub/browse');
      setBrowseResults(Array.isArray(data) ? data : []);
    } catch (e) {
      setErrorBrowse(e.message || 'Could not load registry.');
    }
    setLoadingBrowse(false);
  }, [loadingBrowse]);

  useEffect(() => {
    if (!open) return;
    track('skill_browse_opened');
    loadBrowse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ------------------------------------------------------------------
  // Close handler — clear transient error states
  // ------------------------------------------------------------------
  const handleClose = useCallback(() => {
    setErrorSearch('');
    setErrorBrowse('');
    onClose();
  }, [onClose]);

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------
  const handleSearch = useCallback(async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoadingSearch(true);
    setErrorSearch('');

    track('skill_search_started', { query_length: q.length });

    try {
      const data = await apiClient.get(`/api/clawhub/search?q=${encodeURIComponent(q)}`);
      const results = Array.isArray(data) ? data : [];
      setSearchResults(results);
      track('skill_search_succeeded', { query_length: q.length, result_count: results.length });
    } catch (e) {
      const msg = e.message || 'Search failed.';
      setErrorSearch(msg);
      track('skill_search_failed', { query_length: q.length, error_message: msg });
    }

    setLoadingSearch(false);
  }, [query]);

  // ------------------------------------------------------------------
  // Install
  // ------------------------------------------------------------------
  const handleInstall = useCallback(async (skillName) => {
    if (installingBySkill[skillName]) return;   // guard duplicate click

    setInstallingBySkill(prev => ({ ...prev, [skillName]: true }));
    setInstallSuccessName('');

    track('skill_install_started', { skill: skillName });

    try {
      await apiClient.post('/api/skills/install', { name: skillName });

      setInstallSuccessName(skillName);

      // Mark card as installed in both result lists without re-fetching registry
      const markInstalled = cards =>
        cards.map(c => c.name === skillName ? { ...c, installed: true, installable: false } : c);
      setSearchResults(prev => markInstalled(prev));
      setBrowseResults(prev => markInstalled(prev));

      track('skill_install_succeeded', { skill: skillName });

      onInstallSuccess?.(skillName);
    } catch (e) {
      const msg = e.message || 'Install failed.';
      track('skill_install_failed', { skill: skillName, error_message: msg });

      // Resurface error near the relevant tab
      if (activeTab === 'search') setErrorSearch(msg);
      else setErrorBrowse(msg);
    }

    setInstallingBySkill(prev => ({ ...prev, [skillName]: false }));
  }, [installingBySkill, activeTab, onInstallSuccess]);

  if (!open) return null;

  const activeResults = activeTab === 'search' ? searchResults : browseResults;
  const activeLoading = activeTab === 'search' ? loadingSearch : loadingBrowse;
  const activeError   = activeTab === 'search' ? errorSearch   : errorBrowse;

  return (
    // Backdrop
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Install a skill"
      data-cy="install-modal"
      onClick={e => e.target === e.currentTarget && handleClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      {/* Panel */}
      <div
        style={{
          background: 'var(--surface, #1e1e2e)',
          border: '1px solid var(--border, #313244)',
          borderRadius: 10,
          width: '100%', maxWidth: 560,
          display: 'flex', flexDirection: 'column',
          maxHeight: '85vh',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border, #313244)' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Install a Skill</h2>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleClose}
            aria-label="Close"
            style={{ fontSize: 16, lineHeight: 1, padding: '2px 6px' }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 18px 0 18px', borderBottom: '1px solid var(--border, #313244)' }}>
          <button
            data-cy="install-tab-browse"
            className={`btn btn-sm ${activeTab === 'browse' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('browse')}
            style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
          >
            Browse
          </button>
          <button
            data-cy="install-tab-search"
            className={`btn btn-sm ${activeTab === 'search' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('search')}
            style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
          >
            Search
          </button>
        </div>

        {/* Success banner */}
        {installSuccessName && (
          <div style={{ padding: '8px 18px', background: 'var(--success-subtle, #1a2b1a)', color: 'var(--success, #a6e3a1)', fontSize: 13 }}>
            ✓ <strong>{installSuccessName}</strong> installed. Enable it from the Skills list.
          </div>
        )}

        {/* Error banner */}
        {activeError && (
          <div style={{ padding: '8px 18px', background: 'var(--error-subtle, #2b1a1a)', color: 'var(--error, #f38ba8)', fontSize: 13 }}>
            ⚠ {activeError}
          </div>
        )}

        {/* Search tab — input bar */}
        {activeTab === 'search' && (
          <form
            onSubmit={handleSearch}
            style={{ display: 'flex', gap: 8, padding: '12px 18px' }}
          >
            <input
              data-cy="install-search-input"
              type="text"
              placeholder="Search registry…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid var(--border, #313244)',
                background: 'var(--surface2, #181825)',
                color: 'inherit',
                fontSize: 13,
              }}
            />
            <button
              data-cy="install-search-submit"
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!query.trim() || loadingSearch}
            >
              {loadingSearch ? 'Searching…' : 'Search'}
            </button>
          </form>
        )}

        {/* Results list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 18px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activeLoading && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)' }}>
              Loading…
            </div>
          )}

          {!activeLoading && activeResults.length === 0 && !activeError && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)', fontSize: 13 }}>
              {activeTab === 'search'
                ? 'Enter a search query above to find skills.'
                : 'No skills found in registry.'}
            </div>
          )}

          {!activeLoading && activeResults.map(card => (
            <RegistryResultCard
              key={card.name}
              card={card}
              installing={!!installingBySkill[card.name]}
              onInstall={handleInstall}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
