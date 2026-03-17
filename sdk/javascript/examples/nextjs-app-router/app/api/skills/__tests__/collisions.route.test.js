/**
 * Tests for GET /api/skills/collisions
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init?.status ?? 200 }),
  },
}));

vi.mock('../../../../lib/api-server', () => ({
  api: { get: vi.fn() },
}));

import { GET } from '../collisions/route';
import { api } from '../../../../lib/api-server';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /api/skills/collisions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns [] when no skills are installed', async () => {
    api.get.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns [] when no tool name collisions exist', async () => {
    api.get.mockResolvedValue([
      { name: 'calc',   tools: ['add', 'subtract'] },
      { name: 'memory', tools: ['remember'] },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns a collision entry when two skills share a tool name', async () => {
    api.get.mockResolvedValue([
      { name: 'calc', tools: ['add'] },
      { name: 'math', tools: ['add'] },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].code).toBe('TOOL_NAME_COLLISION');
    expect(res.body[0].tool).toBe('add');
    expect(res.body[0].owners).toEqual(['calc', 'math']);
  });

  it('returns 502 when daemon is unavailable', async () => {
    api.get.mockRejectedValue({ message: 'Daemon down', status: 502 });
    const res = await GET();
    expect(res.status).toBe(502);
    expect(res.body.error).toBeDefined();
  });
});
