/**
 * Tests for lib/skill-collisions.js
 */
import { describe, it, expect } from 'vitest';
import { buildCollisionMap, getCollisions } from '../skill-collisions';

// ---------------------------------------------------------------------------
// buildCollisionMap
// ---------------------------------------------------------------------------
describe('buildCollisionMap', () => {
  it('returns empty map for no skills', () => {
    expect(buildCollisionMap([]).size).toBe(0);
    expect(buildCollisionMap(null).size).toBe(0);
  });

  it('maps tools to their owning skill', () => {
    const skills = [
      { name: 'calc',   tools: ['add', 'subtract'] },
      { name: 'memory', tools: ['remember'] },
    ];
    const map = buildCollisionMap(skills);
    expect(map.get('add')).toEqual(['calc']);
    expect(map.get('remember')).toEqual(['memory']);
  });

  it('maps a shared tool to both owning skills', () => {
    const skills = [
      { name: 'calc',  tools: ['add'] },
      { name: 'math',  tools: ['add'] },
    ];
    const map = buildCollisionMap(skills);
    expect(map.get('add')).toEqual(['calc', 'math']);
  });

  it('does not duplicate skill names for same tool', () => {
    const skills = [{ name: 'calc', tools: ['add', 'add'] }];
    const map = buildCollisionMap(skills);
    expect(map.get('add')).toHaveLength(1);
  });

  it('handles tool objects with a name property', () => {
    const skills = [{ name: 'calc', tools: [{ name: 'add' }] }];
    const map = buildCollisionMap(skills);
    expect(map.has('add')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getCollisions
// ---------------------------------------------------------------------------
describe('getCollisions', () => {
  it('returns [] for no collisions', () => {
    const map = new Map([['add', ['calc']]]);
    expect(getCollisions(map)).toEqual([]);
  });

  it('returns collision entry for colliding tool', () => {
    const map = new Map([['add', ['calc', 'math']]]);
    const result = getCollisions(map);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('TOOL_NAME_COLLISION');
    expect(result[0].tool).toBe('add');
    expect(result[0].owners).toEqual(['calc', 'math']);
    expect(result[0].ok).toBe(false);
  });

  it('returns multiple entries for multiple collisions', () => {
    const map = new Map([
      ['add',   ['calc', 'math']],
      ['fetch', ['web', 'http']],
    ]);
    expect(getCollisions(map)).toHaveLength(2);
  });

  it('handles empty / null map gracefully', () => {
    expect(getCollisions(new Map())).toEqual([]);
    expect(getCollisions(null)).toEqual([]);
  });
});
