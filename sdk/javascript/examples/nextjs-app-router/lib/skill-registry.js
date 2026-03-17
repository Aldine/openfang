/**
 * lib/skill-registry.js
 *
 * Normalizer for remote registry (ClaWhub) search and browse results.
 *
 * Single source of truth for the field contract between the registry API
 * and the install modal UI. Keeps raw upstream payloads out of the UI layer.
 *
 * Contract rule: Installing a skill adds it to local skill inventory only.
 * It does not imply enablement, agent attachment, or runtime usage.
 *
 * States:
 *   bundled   — shipped with the daemon binary, not installable
 *   installed — present in local skill inventory
 *   available — in registry, not yet installed
 */

/**
 * Normalize a single remote registry result card.
 *
 * @param {object}   raw       Raw entry from upstream registry
 * @param {Set<string>} localInstalled  Names of locally installed skills
 * @param {Set<string>} localBundled    Names of bundled (built-in) skills
 * @returns RegistryCard
 */
export function normalizeRegistryCard(raw, localInstalled = new Set(), localBundled = new Set()) {
  const name = String(raw?.name ?? raw?.id ?? raw?.slug ?? '');

  // Local truth overrides remote guesswork
  const bundled = localBundled.has(name) || !!(raw?.bundled ?? false);
  const installed = localInstalled.has(name) || !!(raw?.installed ?? false);

  // installable: remote is available AND not bundled AND not already installed
  const installable = !bundled && !installed;

  return {
    name,
    description: String(raw?.description ?? raw?.summary ?? ''),
    author: String(raw?.author ?? raw?.publisher ?? raw?.maintainer ?? ''),
    version: String(raw?.version ?? raw?.latest_version ?? ''),
    runtime: String(raw?.runtime ?? raw?.language ?? raw?.type ?? ''),
    source: String(raw?.source ?? raw?.repository ?? raw?.registry ?? raw?.url ?? ''),
    popularity: Number(raw?.downloads ?? raw?.popularity ?? raw?.stars ?? raw?.installs ?? 0),
    installed,
    bundled,
    installable,
  };
}

/**
 * Normalize an array of registry results, merging local state.
 *
 * @param {object[]} rawList
 * @param {Set<string>} localInstalled
 * @param {Set<string>} localBundled
 * @returns RegistryCard[]
 */
export function normalizeRegistryList(rawList, localInstalled = new Set(), localBundled = new Set()) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(raw => normalizeRegistryCard(raw, localInstalled, localBundled));
}

/**
 * Build Sets of installed/bundled skill names from local skill list.
 * Call once per response — O(n) on local skills.
 *
 * @param {object[]} localSkills  Array of local skill objects (normalizeSkillCard shape)
 * @returns {{ installed: Set<string>, bundled: Set<string> }}
 */
export function buildLocalSets(localSkills) {
  const installed = new Set();
  const bundled = new Set();
  for (const s of (localSkills ?? [])) {
    const name = String(s?.name ?? '');
    if (!name) continue;
    if (s?.installed !== false) installed.add(name);
    if (s?.bundled) bundled.add(name);
  }
  return { installed, bundled };
}
