/**
 * Tests for POST /api/agents/preflight
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init?.status ?? 200 }),
  },
}));

vi.mock('../../../../lib/api-server', () => ({
  api: { get: vi.fn() },
}));

import { POST } from '../preflight/route';
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
describe('POST /api/agents/preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue([installedCalc]);
  });

  it('returns 400 when body is missing both manifest_toml and manifest', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = { json: async () => { throw new SyntaxError('bad json'); } };
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns ok=true for manifest with no [[skills]]', async () => {
    const toml = `name = "my-agent"\n[model]\nprovider = "groq"\n`;
    const res = await POST(makeRequest({ manifest_toml: toml }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns ok=true when all required skills are installed', async () => {
    const toml = `name = "my-agent"\n\n[[skills]]\nname = "calc"\nversion = "1.0.0"\nrequired = true\n`;
    const res = await POST(makeRequest({ manifest_toml: toml }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns ok=false with SKILL_NOT_INSTALLED when required skill is missing', async () => {
    api.get.mockResolvedValue([]);  // no skills installed
    const toml = `name = "my-agent"\n\n[[skills]]\nname = "calc"\nversion = "1.0.0"\nrequired = true\n`;
    const res = await POST(makeRequest({ manifest_toml: toml }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors[0].code).toBe('SKILL_NOT_INSTALLED');
  });

  it('returns 502 when daemon skills endpoint is unavailable', async () => {
    api.get.mockRejectedValue({ message: 'Connection refused', status: 502 });
    const toml = `name = "my-agent"\n\n[[skills]]\nname = "calc"\n`;
    const res = await POST(makeRequest({ manifest_toml: toml }));
    expect(res.status).toBe(502);
  });
});
