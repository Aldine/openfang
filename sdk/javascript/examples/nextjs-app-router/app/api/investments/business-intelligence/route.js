import { NextResponse } from 'next/server';
import { buildBusinessIntelligenceSnapshot } from '../../../../lib/investments/business-intelligence';

async function fetchJson(request, path) {
  const url = new URL(path, request.url);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

export async function GET(request) {
  const result = await buildBusinessIntelligenceSnapshot((path) => fetchJson(request, path));
  return NextResponse.json(result.body, { status: result.status });
}