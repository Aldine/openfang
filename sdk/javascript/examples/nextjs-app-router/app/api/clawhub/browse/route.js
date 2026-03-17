/**
 * GET /api/clawhub/browse
 *
 * Proxy browse (featured / popular) listing to the ClaWhub registry backend,
 * merge local installed/bundled state, and return normalized result cards.
 *
 * Returns: RegistryCard[]
 *
 * Errors:
 *   502 — daemon / registry unreachable
 */
import { NextResponse } from 'next/server';
import { api } from '../../../../lib/api-server';
import { normalizeRegistryList, buildLocalSets } from '../../../../lib/skill-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [registryData, localData] = await Promise.allSettled([
      api.get('/api/clawhub/browse'),
      api.get('/api/skills'),
    ]);

    if (registryData.status === 'rejected') {
      const err = registryData.reason;
      const message = err instanceof Error ? err.message : 'Registry browse failed.';
      const status = typeof err?.status === 'number' ? err.status : 502;
      return NextResponse.json({ error: message }, { status: status >= 500 ? 502 : status });
    }

    const rawResults = Array.isArray(registryData.value)
      ? registryData.value
      : registryData.value?.results ?? registryData.value?.skills ?? [];

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
