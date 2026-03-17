/**
 * POST /api/agents/preflight
 *
 * Run compatibility preflight checks for an agent manifest against the
 * local installed skill inventory. Always returns 200 with a PreflightResult
 * object — callers inspect `result.ok` to decide if spawn is safe.
 *
 * Body: { manifest_toml?: string, manifest?: object }
 *   manifest_toml takes priority if both are provided.
 *
 * Response (200): PreflightResult
 *   { ok, agent, checks[], errors[], warnings[] }
 *
 * Response (400): { error } — bad / missing body only
 * Response (502): { error } — daemon unreachable
 */
import { NextResponse } from 'next/server';
import { api } from '../../../../lib/api-server';
import {
  extractSkillsFromToml,
  extractToolsFromToml,
  normalizeSkillBinding,
} from '../../../../lib/agent-skills';
import { runPreflight } from '../../../../lib/skill-preflight';
import { buildCollisionMap } from '../../../../lib/skill-collisions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (!body?.manifest_toml && !body?.manifest) {
    return NextResponse.json(
      { error: 'Either manifest_toml or manifest is required.' },
      { status: 400 }
    );
  }

  // Build a minimal manifest object usable by runPreflight
  let manifest;
  if (body.manifest_toml) {
    const rawSkills = extractSkillsFromToml(body.manifest_toml);
    const tools     = extractToolsFromToml(body.manifest_toml);
    const nameMatch = body.manifest_toml.match(/^name\s*=\s*"([^"]*)"/m);
    manifest = {
      name:         nameMatch?.[1] ?? '',
      skills:       rawSkills.map(normalizeSkillBinding),
      capabilities: { tools },
    };
  } else {
    manifest = body.manifest;
  }

  // Fetch installed skills — propagate daemon errors
  let localSkills = [];
  try {
    const result = await api.get('/api/skills');
    localSkills  = Array.isArray(result) ? result : (result?.skills ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to fetch installed skills: ${message}` },
      { status: err?.status ?? 502 }
    );
  }

  const collisionMap = buildCollisionMap(localSkills);
  const result       = runPreflight({ manifest, localSkills, collisionMap });

  return NextResponse.json(result);
}
