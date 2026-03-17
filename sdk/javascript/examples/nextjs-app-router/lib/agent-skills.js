/**
 * lib/agent-skills.js
 *
 * Agent skill binding utilities.
 *
 * Phase 4 rules:
 *   - An agent's skill dependencies are defined by its explicit [[skills]] list
 *   - Tool-derived reference (capabilities.tools) is for MIGRATION SUGGESTIONS only
 *   - Binding is per agent template / saved config — not global
 *   - Skill versions must be recorded at bind time
 *   - Installing or enabling a skill does not attach it to any agent
 *
 * @typedef {{ name: string, version: string, constraint: string, required: boolean, source: string, suggested?: boolean }} SkillBinding
 */

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a single raw skill binding object.
 *
 * @param {object} raw
 * @returns {SkillBinding}
 */
export function normalizeSkillBinding(raw) {
  return {
    name:       String(raw?.name ?? ''),
    version:    String(raw?.version ?? ''),
    constraint: String(raw?.constraint ?? ''),
    required:   raw?.required !== false,           // default true
    source:     String(raw?.source ?? 'unknown'),
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the skills array from a parsed manifest object.
 * Returns [] if the manifest has no explicit skills declaration.
 *
 * @param {object} manifest  Parsed manifest (may have a skills array)
 * @returns {SkillBinding[]}
 */
export function parseSkillBindings(manifest) {
  const raw = manifest?.skills;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSkillBinding).filter(b => b.name);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate skill bindings for schema correctness.
 * Checks: no empty names, no duplicate skill names.
 *
 * @param {SkillBinding[]} bindings
 * @returns {{ ok: boolean, errors: object[] }}
 */
export function validateSkillBindings(bindings) {
  const errors = [];
  const seen = new Set();

  for (const b of (bindings ?? [])) {
    if (!b.name) {
      errors.push({ code: 'EMPTY_SKILL_NAME', message: 'Skill binding must include a name.' });
      continue;
    }
    if (seen.has(b.name)) {
      errors.push({
        code:    'DUPLICATE_SKILL_NAME',
        skill:   b.name,
        message: `Duplicate skill binding: "${b.name}". Each skill may be bound once per manifest.`,
      });
    }
    seen.add(b.name);
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Migration — derive suggestions from tool references
// ---------------------------------------------------------------------------

/**
 * Derive skill binding suggestions from capabilities.tools for legacy manifests.
 *
 * Does NOT write anything to disk — caller decides whether to persist.
 *
 * Each entry in capabilities.tools is treated as a canonical skill name
 * (current convention where tool names == skill names). Multiple refs
 * to the same skill are deduplicated.
 *
 * @param {object}     manifest     Parsed manifest (may have capabilities.tools)
 * @param {object[]}   localSkills  Installed skill list (for version/source info)
 * @returns {SkillBinding[]}  Each entry includes `suggested: true` as a migration flag
 */
export function deriveSuggestedSkills(manifest, localSkills = []) {
  const tools = Array.isArray(manifest?.capabilities?.tools)
    ? manifest.capabilities.tools
    : [];
  if (tools.length === 0) return [];

  const localMap = new Map((localSkills ?? []).map(s => [String(s?.name ?? ''), s]));
  const seen     = new Set();
  const bindings = [];

  for (const tool of tools) {
    const skillName = String(tool ?? '').trim();
    if (!skillName || seen.has(skillName)) continue;
    seen.add(skillName);

    const local = localMap.get(skillName);
    bindings.push({
      name:       skillName,
      version:    String(local?.version ?? ''),
      constraint: '',
      required:   true,
      source:     local?.bundled ? 'bundled' : local ? 'local' : 'unknown',
      suggested:  true,   // UI should label these as "Suggested from tool references"
    });
  }

  return bindings;
}

// ---------------------------------------------------------------------------
// Minimal TOML skill extraction (no external deps)
// ---------------------------------------------------------------------------

/**
 * Extract [[skills]] tables from a raw TOML string.
 *
 * Supports only the Phase 4 manifest shape:
 *   - string fields:  key = "value"
 *   - boolean fields: key = true | false
 *
 * @param {string} toml
 * @returns {object[]}  Raw key-value objects for each [[skills]] block
 */
export function extractSkillsFromToml(toml) {
  if (!toml || typeof toml !== 'string') return [];

  const blocks = [];
  const parts  = toml.split(/^\[\[skills\]\]/m);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    // Stop at the next TOML section header
    const cut     = block.search(/^\[/m);
    const content = cut !== -1 ? block.slice(0, cut) : block;
    const obj     = {};

    for (const line of content.split('\n')) {
      const strM  = line.match(/^\s*(\w+)\s*=\s*"([^"]*)"\s*$/);
      if (strM)  { obj[strM[1]]  = strM[2];              continue; }
      const boolM = line.match(/^\s*(\w+)\s*=\s*(true|false)\s*$/);
      if (boolM) { obj[boolM[1]] = boolM[2] === 'true';  continue; }
    }

    if (obj.name) blocks.push(obj);
  }

  return blocks;
}

/**
 * Extract capabilities.tools from a raw TOML string.
 * Returns [] if not found.
 *
 * @param {string} toml
 * @returns {string[]}
 */
export function extractToolsFromToml(toml) {
  if (!toml || typeof toml !== 'string') return [];
  const m = toml.match(/^tools\s*=\s*\[([^\]]*)\]/m);
  if (!m) return [];
  return m[1]
    .split(',')
    .map(s => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/**
 * Build a minimal manifest object from a TOML string.
 * Extracts name, skills, and capabilities.tools.
 *
 * @param {string} toml
 * @returns {object}  Partial manifest object suitable for preflight
 */
export function manifestFromToml(toml) {
  if (!toml) return {};

  const nameM  = toml.match(/^name\s*=\s*"([^"]*)"/m);
  const skills = extractSkillsFromToml(toml).map(normalizeSkillBinding);
  const tools  = extractToolsFromToml(toml);

  return {
    name:         nameM ? nameM[1] : '',
    skills:       skills.length ? skills : undefined,
    capabilities: tools.length ? { tools } : undefined,
  };
}
