/**
 * Tests for lib/agent-skills.js
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeSkillBinding,
  parseSkillBindings,
  validateSkillBindings,
  deriveSuggestedSkills,
  extractSkillsFromToml,
  extractToolsFromToml,
} from '../agent-skills';

// ---------------------------------------------------------------------------
// normalizeSkillBinding
// ---------------------------------------------------------------------------
describe('normalizeSkillBinding', () => {
  it('fills defaults for empty input', () => {
    const b = normalizeSkillBinding({});
    expect(b.name).toBe('');
    expect(b.required).toBe(true);
    expect(b.source).toBe('unknown');
  });

  it('preserves explicit required=false', () => {
    const b = normalizeSkillBinding({ name: 'web_search', required: false });
    expect(b.required).toBe(false);
  });

  it('coerces numeric name to string', () => {
    const b = normalizeSkillBinding({ name: 42 });
    expect(b.name).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// parseSkillBindings
// ---------------------------------------------------------------------------
describe('parseSkillBindings', () => {
  it('returns [] for manifest with no skills key', () => {
    expect(parseSkillBindings({})).toEqual([]);
  });

  it('returns [] for non-array skills', () => {
    expect(parseSkillBindings({ skills: 'oops' })).toEqual([]);
  });

  it('filters out entries with empty names', () => {
    const r = parseSkillBindings({ skills: [{ name: '' }, { name: 'calc' }] });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('calc');
  });

  it('normalizes all entries', () => {
    const r = parseSkillBindings({
      skills: [{ name: 'calc', version: '1.0.0', required: false }],
    });
    expect(r[0].required).toBe(false);
    expect(r[0].version).toBe('1.0.0');
  });
});

// ---------------------------------------------------------------------------
// validateSkillBindings
// ---------------------------------------------------------------------------
describe('validateSkillBindings', () => {
  it('passes valid bindings', () => {
    const { ok, errors } = validateSkillBindings([
      { name: 'web_search' },
      { name: 'memory' },
    ]);
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('catches empty skill name', () => {
    const { ok, errors } = validateSkillBindings([{ name: '' }]);
    expect(ok).toBe(false);
    expect(errors[0].code).toBe('EMPTY_SKILL_NAME');
  });

  it('catches duplicate skill name', () => {
    const { ok, errors } = validateSkillBindings([
      { name: 'calc' },
      { name: 'calc' },
    ]);
    expect(ok).toBe(false);
    expect(errors[0].code).toBe('DUPLICATE_SKILL_NAME');
  });

  it('handles null/undefined gracefully', () => {
    expect(validateSkillBindings(null).ok).toBe(true);
    expect(validateSkillBindings(undefined).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveSuggestedSkills
// ---------------------------------------------------------------------------
describe('deriveSuggestedSkills', () => {
  it('returns [] when no tools in manifest', () => {
    expect(deriveSuggestedSkills({})).toEqual([]);
  });

  it('deduplicates repeated tool names', () => {
    const r = deriveSuggestedSkills({ capabilities: { tools: ['calc', 'calc', 'web'] } });
    expect(r).toHaveLength(2);
  });

  it('marks all returned entries as suggested=true', () => {
    const r = deriveSuggestedSkills({ capabilities: { tools: ['calc'] } });
    expect(r[0].suggested).toBe(true);
  });

  it('picks up version and source from localSkills', () => {
    const local = [{ name: 'calc', version: '2.1.0', bundled: false }];
    const r = deriveSuggestedSkills({ capabilities: { tools: ['calc'] } }, local);
    expect(r[0].version).toBe('2.1.0');
    expect(r[0].source).toBe('local');
  });

  it('marks source=bundled for bundled skills', () => {
    const local = [{ name: 'calc', version: '1.0.0', bundled: true }];
    const r = deriveSuggestedSkills({ capabilities: { tools: ['calc'] } }, local);
    expect(r[0].source).toBe('bundled');
  });
});

// ---------------------------------------------------------------------------
// extractSkillsFromToml
// ---------------------------------------------------------------------------
describe('extractSkillsFromToml', () => {
  it('returns [] for empty / null input', () => {
    expect(extractSkillsFromToml('')).toEqual([]);
    expect(extractSkillsFromToml(null)).toEqual([]);
  });

  it('parses a single [[skills]] block', () => {
    const toml = `
name = "agent"

[[skills]]
name = "calc"
version = "1.0.0"
required = true
`;
    const r = extractSkillsFromToml(toml);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('calc');
    expect(r[0].version).toBe('1.0.0');
    expect(r[0].required).toBe(true);
  });

  it('parses multiple [[skills]] blocks', () => {
    const toml = `
[[skills]]
name = "calc"
version = "1.0.0"

[[skills]]
name = "memory"
version = "0.2.0"
required = false
`;
    const r = extractSkillsFromToml(toml);
    expect(r).toHaveLength(2);
    expect(r[1].name).toBe('memory');
    expect(r[1].required).toBe(false);
  });

  it('ignores blocks without a name', () => {
    const toml = `
[[skills]]
version = "1.0.0"
`;
    expect(extractSkillsFromToml(toml)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractToolsFromToml
// ---------------------------------------------------------------------------
describe('extractToolsFromToml', () => {
  it('returns [] when no tools line', () => {
    expect(extractToolsFromToml('name = "x"')).toEqual([]);
  });

  it('parses a tools array', () => {
    const toml = 'tools = ["search", "browse", "calc"]';
    expect(extractToolsFromToml(toml)).toEqual(['search', 'browse', 'calc']);
  });

  it('handles empty array', () => {
    expect(extractToolsFromToml('tools = []')).toEqual([]);
  });
});
