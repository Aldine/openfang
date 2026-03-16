/**
 * POST /api/onboarding/message
 *
 * Direct synchronous agent call for the onboarding first-message step.
 * Bypasses the run-store / event-bus orchestration layer (which requires
 * in-process module singletons that can split across Next.js route workers).
 *
 * Picks the best available agent (prefers 'assistant', falls back to first),
 * sends the message, and returns the response.
 *
 * Body:   { message: string }
 * 200 OK: { reply: string, agentId: string, agentName: string, latency_ms: number }
 * 4xx/5xx: { error: string }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { env } from '../../../../lib/env';

// Use the same ceiling as the openfang-client (defaults to 120 s, configurable via env)
const TIMEOUT_MS = env.OPENFANG_TIMEOUT_MS;

async function fetchJSON(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(env.OPENFANG_API_KEY ? { Authorization: `Bearer ${env.OPENFANG_API_KEY}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`${res.status} ${text.slice(0, 200)}`), { status: res.status });
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        `AI took too long to respond (>${Math.round(TIMEOUT_MS / 1000)}s). ` +
        'Your key is probably valid — the provider may be under load. ' +
        'Try "Skip for now" and come back, or try a different provider.',
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  const start = Date.now();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const message = String(body?.message ?? '').trim();
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const base = env.OPENFANG_BASE_URL;

  // ── 1. Fetch agent list ─────────────────────────────────────────────────
  let agents;
  try {
    const raw = await fetchJSON(`${base}/api/agents`, { timeout: 5_000 });
    agents = Array.isArray(raw) ? raw : (raw?.agents ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not reach the backend: ${err.message}` },
      { status: 503 },
    );
  }

  if (!agents.length) {
    return NextResponse.json(
      { error: 'No agents loaded. Check that agent files exist in ~/.openfang/agents/.' },
      { status: 503 },
    );
  }

  // ── 2. Pick best agent (prefer 'assistant', then first) ─────────────────
  const pick =
    agents.find((a) => (a.name ?? a.id ?? '').toLowerCase().includes('assistant')) ??
    agents[0];

  // ── 3. Send message ─────────────────────────────────────────────────────
  let result;
  try {
    result = await fetchJSON(`${base}/api/agents/${pick.id}/message`, {
      method: 'POST',
      body: JSON.stringify({ message }),
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    const s = String(err.message ?? '').toLowerCase();
    let friendly = err.message;
    if (s.includes('401') || s.includes('unauthorized') || s.includes('invalid') || s.includes('api key')) {
      friendly = 'Invalid API key — go back to the "Connect AI" step and re-enter your key.';
    } else if (s.includes('429') || s.includes('rate limit')) {
      friendly = 'Rate limit hit. Your key is valid — wait a moment and try again.';
    } else if (s.includes('503') || s.includes('unavailable')) {
      friendly = 'The AI provider is temporarily unavailable. Try again in a few seconds.';
    }
    return NextResponse.json({ error: friendly }, { status: 502 });
  }

  const reply = String(result?.response ?? result?.message ?? result?.content ?? result?.text ?? '');
  if (!reply) {
    return NextResponse.json(
      { error: 'The AI responded but with an empty message. This usually means the API key is not set up yet.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    reply,
    agentId: pick.id,
    agentName: pick.name ?? pick.id,
    latency_ms: Date.now() - start,
  });
}
