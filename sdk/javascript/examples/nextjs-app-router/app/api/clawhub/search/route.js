/**
 * GET /api/clawhub/search?q=...
 *
 * Proxy search to the ClaWhub registry backend, merge local installed/bundled
 * state, and return normalized result cards.
 *
 * Returns: RegistryCard[]
 *
 * Errors:
 *   400 — missing or empty query
 *   502 — daemon / registry unreachable
 */
import { NextResponse } from 'next/server';
import { api } from '../../../../lib/api-server';
import { normalizeRegistryList, buildLocalSets } from '../../../../lib/skill-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const searchParams = request.nextUrl?.searchParams ?? new URL(request.url).searchParams;
  const q = (searchParams.get('q') ?? '').trim();

  if (!q) {
    return NextResponse.json({ error: 'Query parameter `q` is required.' }, { status: 400 });
  }

  try {
    // Fetch registry results and local skill list in parallel
    const [registryData, localData] = await Promise.allSettled([
      api.get(`/api/clawhub/search?q=${encodeURIComponent(q)}`),
      api.get('/api/skills'),
    ]);

    const rawResults = registryData.status === 'fulfilled'
      ? (Array.isArray(registryData.value) ? registryData.value : registryData.value?.results ?? [])
      : [];

    if (registryData.status === 'rejected') {
      const err = registryData.reason;
      const status = typeof err?.status === 'number' ? err.status : 502;
      // Surface upstream failures with a readable message
      const message = err instanceof Error ? err.message : 'Registry search failed.';
      return NextResponse.json({ error: message }, { status: status >= 500 ? 502 : status });
    }

    const localSkills = localData.status === 'fulfilled'
      ? (Array.isArray(localData.value) ? localData.value : localData.value?.skills ?? [])
      : [];

    const { installed, bundled } = buildLocalSets(localSkills);
    const results = normalizeRegistryList(rawResults, installed, bundled);

    return NextResponse.json(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = typeof err?.status === 'number' ? err.status : 502;
    return NextResponse.json({ error: message }, { status: status >= 500 ? 502 : status });
  }
}
