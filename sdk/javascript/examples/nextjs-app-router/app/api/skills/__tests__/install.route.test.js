/**
 * Tests for POST /api/skills/install (app/api/skills/install/route.js)
 *
 * Constraint: installing a skill NEVER mutates agent references,
 * enablement state, or runtime configuration.
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

vi.mock('../../../../lib/skill-registry', () => ({
  buildLocalSets: vi.fn(),
}));

import { POST } from '../install/route';
import { api } from '../../../../lib/api-server';
import { buildLocalSets } from '../../../../lib/skill-registry';

const makeRequest = (body) => ({
  json: () => Promise.resolve(body),
});

const localSkills = [
  { name: 'web_search', installed: true, bundled: true },
  { name: 'memory', installed: true, bundled: false },
];

describe('POST /api/skills/install', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(localSkills);
    buildLocalSets.mockReturnValue({
      installed: new Set(['memory']),
      bundled: new Set(['web_search']),
    });
  });

  it('returns 400 for missing body', async () => {
    const req = { json: () => Promise.reject(new SyntaxError('bad json')) };
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 400 when name is empty/missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('returns 400 when trying to install a bundled skill', async () => {
    const res = await POST(makeRequest({ name: 'web_search' }));
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 409 when the skill is already installed', async () => {
    const res = await POST(makeRequest({ name: 'memory' }));
    expect(res.status).toBe(409);
    expect(typeof res.body.error).toBe('string');
  });

  it('returns success payload when install succeeds', async () => {
    api.get.mockResolvedValue([]);    // no local skills — clear the way
    buildLocalSets.mockReturnValue({ installed: new Set(), bundled: new Set() });
    api.post.mockResolvedValue({ name: 'new-skill', enabled: false, version: '1.0.0' });

    const res = await POST(makeRequest({ name: 'new-skill' }));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('new-skill');
    expect(res.body.installed).toBe(true);
    expect(res.body.bundled).toBe(false);
    expect(typeof res.body.enabled).toBe('boolean');
  });

  it('returns 404 when daemon reports skill not found', async () => {
    buildLocalSets.mockReturnValue({ installed: new Set(), bundled: new Set() });
    const err = new Error('Not found');
    err.status = 404;
    api.post.mockRejectedValue(err);

    const res = await POST(makeRequest({ name: 'ghost-skill' }));
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 502 on upstream failure', async () => {
    buildLocalSets.mockReturnValue({ installed: new Set(), bundled: new Set() });
    const err = new Error('Timeout');
    err.status = 503;
    api.post.mockRejectedValue(err);

    const res = await POST(makeRequest({ name: 'remote-skill' }));
    expect(res.status).toBe(502);
  });

  it('success response does not include used_by or agent references', async () => {
    api.get.mockResolvedValue([]);
    buildLocalSets.mockReturnValue({ installed: new Set(), bundled: new Set() });
    api.post.mockResolvedValue({ name: 'clean-skill', enabled: false, version: '2.0.0' });

    const res = await POST(makeRequest({ name: 'clean-skill' }));
    expect(res.body).not.toHaveProperty('used_by');
    expect(res.body).not.toHaveProperty('used_by_count');
    expect(res.body).not.toHaveProperty('agents');
  });
});
