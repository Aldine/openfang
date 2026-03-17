/**
 * GET /api/skills
 *
 * Returns a normalized list of skills suitable for the card grid.
 * Enriches each card with used_by_count from the agent usage index.
 *
 * Response shape per item:
 *   { name, description, runtime, installed, enabled, bundled,
 *     version, tool_count, used_by_count }
 */
import { NextResponse } from 'next/server';
import { api } from '../../../lib/api-server';
import { normalizeSkillCard } from '../../../lib/skills';
import { buildUsageIndex, annotateCards } from '../../../lib/skill-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await api.get('/api/skills');
    const raw = Array.isArray(data) ? data : Array.isArray(data?.skills) ? data.skills : [];
    const cards = raw.map(normalizeSkillCard);

    const index = await buildUsageIndex();
    const annotated = annotateCards(cards, index);

    return NextResponse.json(annotated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = typeof err.status === 'number' ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
