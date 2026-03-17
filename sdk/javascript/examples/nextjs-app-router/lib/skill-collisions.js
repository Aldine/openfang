/**
 * lib/skill-collisions.js
 *
 * Tool name collision detection across installed skills.
 *
 * Rules (Phase 4):
 *   - Two installed skills must not expose the same tool name.
 *   - Collisions are never silent — callers decide how to surface them.
 *   - No implicit priority ordering — collisions are always an error.
 *
 * @typedef {{ ok: false, code: 'TOOL_NAME_COLLISION', tool: string, owners: string[], message: string }} CollisionEntry
 */

/**
 * Build tool → [owning skill names] map from installed skills.
 *
 * Each installed skill may optionally carry a `tools` array (strings or
 * objects with a `name` field). Skills without a `tools` property contribute
 * nothing to the map.
 *
 * @param {object[]} localSkills
 * @returns {Map<string, string[]>}
 */
export function buildCollisionMap(localSkills) {
  const map = new Map();

  for (const skill of (localSkills ?? [])) {
    const skillName = String(skill?.name ?? '').trim();
    if (!skillName) continue;

    const tools = Array.isArray(skill.tools) ? skill.tools : [];
    for (const raw of tools) {
      const tool = typeof raw === 'string' ? raw : String(raw?.name ?? '');
      if (!tool) continue;

      const owners = map.get(tool) ?? [];
      if (!owners.includes(skillName)) owners.push(skillName);
      map.set(tool, owners);
    }
  }

  return map;
}

/**
 * Extract all collision entries from a collision map.
 *
 * A collision exists when a tool name has more than one owning skill.
 *
 * @param {Map<string, string[]>} collisionMap
 * @returns {CollisionEntry[]}
 */
export function getCollisions(collisionMap) {
  const collisions = [];

  for (const [tool, owners] of (collisionMap ?? new Map()).entries()) {
    if (owners.length > 1) {
      collisions.push({
        ok:      false,
        code:    'TOOL_NAME_COLLISION',
        tool,
        owners:  [...owners],
        message: `Tool name "${tool}" is exposed by multiple installed skills: ${owners.join(', ')}.`,
      });
    }
  }

  return collisions;
}
