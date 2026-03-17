/**
 * Tests for GET /api/clawhub/search (app/api/clawhub/search/route.js)
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

import { GET } from '../search/route';
import { api } from '../../../../lib/api-server';
import { normalizeRegistryList, buildLocalSets } from '../../../../lib/skill-registry';

const rawCard = { name: 'web_search', description: 'Search', downloads: 5000 };
const installedSets = { installed: new Set(), bundled: new Set() };
const normalizedCard = {
  name: 'web_search', description: 'Search', author: '', version: '',
  runtime: '', source: '', popularity: 5000,
  installed: false, bundled: false, installable: true,
};

const makeRequest = (params) => ({
  nextUrl: { searchParams: new URLSearchParams(params) },
  url: `http://localhost/api/clawhub/search?${new URLSearchParams(params)}`,
});

describe('GET /api/clawhub/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildLocalSets.mockReturnValue(installedSets);
  });

  it('returns 400 when the q param is missing', async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 400 when the q param is empty/whitespace', async () => {
    const res = await GET(makeRequest({ q: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns a normalized RegistryCard array on a successful search', async () => {
    api.get
      .mockResolvedValueOnce([rawCard])   // /api/clawhub/search?q=...
      .mockResolvedValueOnce([]);         // /api/skills
    normalizeRegistryList.mockReturnValue([normalizedCard]);

    const res = await GET(makeRequest({ q: 'web' }));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('web_search');
    expect(normalizeRegistryList).toHaveBeenCalledOnce();
  });

  it('returns 502 when the registry fetch fails', async () => {
    const err = new Error('Registry down');
    err.status = 503;
    api.get.mockRejectedValueOnce(err);

    const res = await GET(makeRequest({ q: 'web' }));
    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe('string');
  });

  it('continues gracefully when local skills fetch fails', async () => {
    api.get
      .mockResolvedValueOnce([rawCard])
      .mockRejectedValueOnce(new Error());
    normalizeRegistryList.mockReturnValue([normalizedCard]);

    const res = await GET(makeRequest({ q: 'web' }));
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('web_search');
  });
});
