/**
 * Tests for GET /api/clawhub/browse (app/api/clawhub/browse/route.js)
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

vi.mock('../../../../lib/skill-registry', () => ({
  normalizeRegistryList: vi.fn(),
  buildLocalSets: vi.fn(),
}));

import { GET } from '../browse/route';
import { api } from '../../../../lib/api-server';
import { normalizeRegistryList, buildLocalSets } from '../../../../lib/skill-registry';

const rawCard = { name: 'web_search', description: 'Search', downloads: 5000 };
const installedSets = { installed: new Set(), bundled: new Set() };
const normalizedCard = {
  name: 'web_search', description: 'Search', author: '', version: '',
  runtime: '', source: '', popularity: 5000,
  installed: false, bundled: false, installable: true,
};

describe('GET /api/clawhub/browse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildLocalSets.mockReturnValue(installedSets);
  });

  it('returns a normalized RegistryCard array on success', async () => {
    api.get
      .mockResolvedValueOnce([rawCard])      // /api/clawhub/browse
      .mockResolvedValueOnce([]);            // /api/skills
    normalizeRegistryList.mockReturnValue([normalizedCard]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('web_search');
    expect(normalizeRegistryList).toHaveBeenCalledOnce();
  });

  it('returns 502 when the registry fetch fails', async () => {
    const err = new Error('Registry down');
    err.status = 503;
    api.get.mockRejectedValueOnce(err);   // registry fails

    const res = await GET();
    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe('string');
  });

  it('continues gracefully when local skills fetch fails', async () => {
    api.get
      .mockResolvedValueOnce([rawCard])    // /api/clawhub/browse — ok
      .mockRejectedValueOnce(new Error()); // /api/skills — fail
    normalizeRegistryList.mockReturnValue([normalizedCard]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('web_search');
  });

  it('returns an empty array when the registry returns no results', async () => {
    api.get.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    normalizeRegistryList.mockReturnValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
