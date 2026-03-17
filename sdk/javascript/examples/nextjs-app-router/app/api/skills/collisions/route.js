/**
 * GET /api/skills/collisions
 *
 * Returns all tool name collisions across currently installed skills.
 * A collision exists when two or more installed skills expose the same tool name.
 *
 * Response (200): CollisionEntry[]
 *   [] when no collisions — never 4xx for an empty set.
 *
 * Response (502): { error } — daemon unreachable
 */
import { NextResponse } from 'next/server';
import { api } from '../../../../lib/api-server';
import { buildCollisionMap, getCollisions } from '../../../../lib/skill-collisions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let localSkills;
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
  const collisions   = getCollisions(collisionMap);

  return NextResponse.json(collisions);
}
