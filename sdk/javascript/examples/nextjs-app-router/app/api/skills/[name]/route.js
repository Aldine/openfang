/**
 * GET /api/skills/[name]
 *
 * Returns full skill detail for the drawer.
 *
 * Response shape:
 *   { name, description, runtime, installed, enabled, bundled,
 *     version, source, entrypoint, prompt_context, tools[], used_by[] }
 */
import { NextResponse } from 'next/server';
import { api } from '../../../../lib/api-server';
import { normalizeSkillDetail } from '../../../../lib/skills';
import { buildUsageIndex } from '../../../../lib/skill-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const name = params?.name;
  if (!name) {
    return NextResponse.json({ error: 'Skill name is required.' }, { status: 400 });
  }

  try {
    const [raw, index] = await Promise.all([
      api.get(`/api/skills/${encodeURIComponent(name)}`),
      buildUsageIndex(),
    ]);
    const used_by = index.get(name) ?? [];
    return NextResponse.json(normalizeSkillDetail(raw, used_by));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = typeof err.status === 'number' ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
