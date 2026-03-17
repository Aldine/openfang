/**
 * POST /api/agents/spawn
 *
 * Proxy to daemon POST /api/agents — spawns a new agent from a TOML manifest.
 *
 * Body: { manifest_toml: string }
 * Response: { agent_id, name, status, preflight? }
 *
 * When the manifest contains [[skills]] bindings, preflight checks run before
 * forwarding to the daemon.  Required-skill failures return 400 with:
 *   { error, code: 'PREFLIGHT_FAILED', preflight: PreflightResult }
 * Warnings do not block spawn — they are forwarded in the 201 response.
 *
 * Agents with no [[skills]] section are spawned without preflight (legacy mode).
 *
 * Server-side validation mirrors client-side rules in lib/spawn-validation.js.
 * Any rule change must be made in that shared module.
 */
import { NextResponse } from 'next/server';
import { api } from '../../../../lib/api-server';
import { validateSpawnName } from '../../../../lib/spawn-validation';
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

  if (!body?.manifest_toml) {
    return NextResponse.json({ error: 'manifest_toml is required.' }, { status: 400 });
  }

  // Extract and validate the name from the TOML before forwarding.
  // The daemon does its own validation too; this gives the user a fast, clear error.
  const nameMatch = body.manifest_toml.match(/^name\s*=\s*"([^"]*)"/m);
  if (nameMatch) {
    const { error } = validateSpawnName(nameMatch[1]);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
  }

  // ── Preflight ────────────────────────────────────────────────────────────
  // Run only when the manifest has explicit [[skills]] bindings.
  // Agents with no [[skills]] section are spawned without preflight (legacy mode).
  let preflight = null;
  const rawSkills = extractSkillsFromToml(body.manifest_toml);
  if (rawSkills.length > 0) {
    const tools    = extractToolsFromToml(body.manifest_toml);
    const manifest = {
      name:         nameMatch?.[1] ?? '',
      skills:       rawSkills.map(normalizeSkillBinding),
      capabilities: { tools },
    };

    let localSkills = [];
    try {
      const result = await api.get('/api/skills');
      localSkills  = Array.isArray(result) ? result : (result?.skills ?? []);
    } catch {
      // Skills endpoint unreachable — propagate as a soft failure rather than
      // blocking the spawn: the daemon spawn call below will fail independently
      // if the daemon itself is down, so we let it surface there instead.
      localSkills = [];
    }

    const collisionMap = buildCollisionMap(localSkills);
    preflight          = runPreflight({ manifest, localSkills, collisionMap });

    if (!preflight.ok) {
      return NextResponse.json(
        { error: 'Agent preflight failed. Resolve skill errors before spawning.', code: 'PREFLIGHT_FAILED', preflight },
        { status: 400 }
      );
    }
  }

  try {
    const data = await api.post('/api/agents', { manifest_toml: body.manifest_toml });
    return NextResponse.json({
      ...data,
      preflight: preflight
        ? { ok: true, warnings: preflight.warnings }
        : undefined,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = typeof err.status === 'number' ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
