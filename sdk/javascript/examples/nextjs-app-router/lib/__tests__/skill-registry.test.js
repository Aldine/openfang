/**
 * Unit tests for lib/skill-registry.js
 *
 * Pure functions — no mocks needed.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeRegistryCard,
  normalizeRegistryList,
  buildLocalSets,
} from '../skill-registry';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const rawWebSearch = {
  name: 'web_search',
  description: 'Search the web',
  author: 'openfang',
  version: '1.2.0',
  runtime: 'node',
  source: 'https://clawhub.dev/web_search',
  downloads: 10000,
};

const rawMemory = {
  id: 'memory',
  description: 'Memory access',
  publisher: 'community',
  latest_version: '0.3.0',
  language: 'python',
  stars: 250,
};

const rawMinimal = { slug: 'bare-minimum' };

const REGISTRY_CARD_FIELDS = [
  'name', 'description', 'author', 'version', 'runtime',
  'source', 'popularity', 'installed', 'bundled', 'installable',
];

// ---------------------------------------------------------------------------
// normalizeRegistryCard
// ---------------------------------------------------------------------------
describe('normalizeRegistryCard', () => {
  it('returns all required RegistryCard fields', () => {
    const card = normalizeRegistryCard(rawWebSearch);
    for (const field of REGISTRY_CARD_FIELDS) {
      expect(card).toHaveProperty(field);
    }
  });

  it('prefers name > id > slug when deriving the card name', () => {
    expect(normalizeRegistryCard({ name: 'a', id: 'b', slug: 'c' }).name).toBe('a');
    expect(normalizeRegistryCard({ id: 'b', slug: 'c' }).name).toBe('b');
    expect(normalizeRegistryCard({ slug: 'c' }).name).toBe('c');
  });

  it('maps popularity from downloads || popularity || stars || installs', () => {
    expect(normalizeRegistryCard({ name: 'a', downloads: 999 }).popularity).toBe(999);
    expect(normalizeRegistryCard({ name: 'a', popularity: 500 }).popularity).toBe(500);
    expect(normalizeRegistryCard({ name: 'a', stars: 77 }).popularity).toBe(77);
    expect(normalizeRegistryCard({ name: 'a', installs: 42 }).popularity).toBe(42);
    expect(normalizeRegistryCard({ name: 'a' }).popularity).toBe(0);
  });

  it('sets installable=true when skill is neither bundled nor installed', () => {
    const card = normalizeRegistryCard(rawWebSearch);
    expect(card.bundled).toBe(false);
    expect(card.installed).toBe(false);
    expect(card.installable).toBe(true);
  });

  it('sets installable=false for bundled skills (local set wins)', () => {
    const bundledSet = new Set(['web_search']);
    const card = normalizeRegistryCard(rawWebSearch, new Set(), bundledSet);
    expect(card.bundled).toBe(true);
    expect(card.installable).toBe(false);
  });

  it('sets installable=false for already-installed skills (local set wins)', () => {
    const installedSet = new Set(['web_search']);
    const card = normalizeRegistryCard(rawWebSearch, installedSet, new Set());
    expect(card.installed).toBe(true);
    expect(card.installable).toBe(false);
  });

  it('local installed state overrides remote installed=false', () => {
    const raw = { ...rawWebSearch, installed: false };
    const localInstalled = new Set(['web_search']);
    const card = normalizeRegistryCard(raw, localInstalled);
    expect(card.installed).toBe(true);
  });

  it('handles null/undefined raw gracefully (no throw)', () => {
    expect(() => normalizeRegistryCard(null)).not.toThrow();
    expect(() => normalizeRegistryCard(undefined)).not.toThrow();
    const card = normalizeRegistryCard(null);
    expect(card.name).toBe('');
    expect(card.installable).toBe(true); // not bundled, not installed
  });

  it('maps alternate field names (id, language, publisher, stars, latest_version)', () => {
    const card = normalizeRegistryCard(rawMemory);
    expect(card.name).toBe('memory');
    expect(card.author).toBe('community');
    expect(card.version).toBe('0.3.0');
    expect(card.runtime).toBe('python');
    expect(card.popularity).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// normalizeRegistryList
// ---------------------------------------------------------------------------
describe('normalizeRegistryList', () => {
  it('normalizes an array of cards and returns RegistryCard[]', () => {
    const result = normalizeRegistryList([rawWebSearch, rawMemory]);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('web_search');
    expect(result[1].name).toBe('memory');
  });

  it('returns an empty array for non-array input', () => {
    expect(normalizeRegistryList(null)).toEqual([]);
    expect(normalizeRegistryList(undefined)).toEqual([]);
    expect(normalizeRegistryList({})).toEqual([]);
  });

  it('propagates local installed/bundled sets to all cards', () => {
    const installed = new Set(['web_search']);
    const bundled = new Set(['memory']);
    const result = normalizeRegistryList([rawWebSearch, rawMemory], installed, bundled);
    expect(result.find(c => c.name === 'web_search').installed).toBe(true);
    expect(result.find(c => c.name === 'memory').bundled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildLocalSets
// ---------------------------------------------------------------------------
describe('buildLocalSets', () => {
  it('adds installed skills to the installed set', () => {
    const skills = [{ name: 'web_search', installed: true, bundled: false }];
    const { installed } = buildLocalSets(skills);
    expect(installed.has('web_search')).toBe(true);
  });

  it('adds bundled skills to the bundled set', () => {
    const skills = [{ name: 'core', installed: true, bundled: true }];
    const { bundled } = buildLocalSets(skills);
    expect(bundled.has('core')).toBe(true);
  });

  it('treats installed=undefined as installed (truthy default)', () => {
    const skills = [{ name: 'default_on' }];
    const { installed } = buildLocalSets(skills);
    expect(installed.has('default_on')).toBe(true);
  });

  it('excludes skills with installed=false', () => {
    const skills = [{ name: 'not_installed', installed: false }];
    const { installed } = buildLocalSets(skills);
    expect(installed.has('not_installed')).toBe(false);
  });

  it('returns empty sets for null/undefined/empty input', () => {
    const r1 = buildLocalSets(null);
    const r2 = buildLocalSets([]);
    expect(r1.installed.size).toBe(0);
    expect(r1.bundled.size).toBe(0);
    expect(r2.installed.size).toBe(0);
  });

  it('skips entries without a name', () => {
    const skills = [{ runtime: 'node' }];
    const { installed } = buildLocalSets(skills);
    expect(installed.size).toBe(0); // nameless entry ignored
  });
});
