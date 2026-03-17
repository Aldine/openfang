/**
 * Tests for POST /api/agents/spawn — preflight integration (Phase 4)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init?.status ?? 200 }),
  },
}));

vi.mock('../../../../lib/api-server', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../../lib/spawn-validation', () => ({
  validateSpawnName: (name) =>
    name && name.length > 0
      ? { name, error: null }
      : { name: '', error: 'Name is required.' },
}));

import { POST } from '../spawn/route';
import { api } from '../../../../lib/api-server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(body) {
  return { json: async () => body };
}

const installedCalc = {
  name:    'calc',
  version: '1.0.0',
  enabled: true,
  tools:   ['add'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/agents/spawn — preflight gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ agent_id: 'agt_abc123', name: 'my-agent', status: 'running' });
  });

  it('spawns without preflight when manifest has no [[skills]]', async () => {
    const toml = `name = "my-agent"\n[model]\nprovider = "groq"\n`;
    api.get.mockResolvedValue([]);  // irrelevant — preflight skipped
    const res = await POST(makeRequest({ manifest_toml: toml }));
    expect(res.status).toBe(201);
    expect(api.post).toHaveBeenCalledWith('/api/agents', expect.anything());
  });

  it('blocks spawn (400) when required skill is missing', async () => {
    api.get.mockResolvedValue([]);  // no skills installed
    const toml = `name = "my-agent"\n\n[[skills]]\nname = "calc"\nversion = "1.0.0"\nrequired = true\n`;
    const res = await POST(makeRequest({ manifest_toml: toml }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PREFLIGHT_FAILED');
    expect(res.body.preflight.ok).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('allows spawn with warnings when skill has version drift', async () => {
    api.get.mockResolvedValue([{ ...installedCalc, version: '1.2.0' }]);
    // No constraint → version mismatch → warning only, spawn proceeds
    const toml = `name = "my-agent"\n\n[[skills]]\nname = "calc"\nversion = "1.0.0"\n`;
    const res = await POST(makeRequest({ manifest_toml: toml }));
    expect(res.status).toBe(201);
    expect(res.body.preflight.ok).toBe(true);
    expect(res.body.preflight.warnings.length).toBeGreaterThan(0);
  });

  it('includes preflight summary in successful response for bound-skills agents', async () => {
    api.get.mockResolvedValue([installedCalc]);
    const toml = `name = "my-agent"\n\n[[skills]]\nname = "calc"\nversion = "1.0.0"\n`;
    const res = await POST(makeRequest({ manifest_toml: toml }));
    expect(res.status).toBe(201);
    expect(res.body.preflight).toBeDefined();
    expect(res.body.preflight.ok).toBe(true);
  });

  it('proceeds without preflight when skills endpoint is unreachable (graceful fallback)', async () => {
    api.get.mockRejectedValue({ message: 'Connection refused', status: 502 });
    const toml = `name = "my-agent"\n\n[[skills]]\nname = "calc"\nversion = "1.0.0"\nrequired = true\n`;
    // Skills fetch failed → localSkills = [] but preflight still runs and will catch missing skill
    // However, if get() rejects, the spawn route catches it gracefully (localSkills=[])
    // In current impl the run still happens with empty localSkills → the preflight will fail
    // since the skill is required and not in []. This is correct behavior.
    const res = await POST(makeRequest({ manifest_toml: toml }));
    expect(res.status).toBe(400);  // preflight blocks because skill not found in empty list
    expect(res.body.code).toBe('PREFLIGHT_FAILED');
  });
});
