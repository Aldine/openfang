# Local Inference Tier for OpenFang

Status: Proposed

## Product Intent

OpenFang should support a local cost-cutting tier without becoming a local-only product.

The split is:

- browser workers for fast local orchestration help
- a localhost model server for local inference
- OpenFang server APIs for durable truth, workflow state, approvals, and audit

This keeps planner UX fast and private while preserving restart-safe orchestration.

## Mental Model

Use four execution tiers.

### Tier A — Deterministic browser help

No model call.

Use for:

- task splitting heuristics
- dedupe
- ranking
- candidate scoring
- JSON validation
- context assembly
- local retrieval over already-indexed planner data

### Tier B — Small local model in browser

Use only for narrow tasks where latency matters more than perfect quality.

Use for:

- agent recommendation
- short routing decisions
- short rewrite
- lightweight translation
- brief summarization

Do not use for:

- long-form generation
- code generation
- high-risk customer output
- multi-step reasoning

### Tier C — Localhost model server

Run a local inference server on the laptop.

Primary targets:

- Ollama on localhost
- llama.cpp `llama-server` on localhost

Use for:

- planner clarify when heuristics are low confidence
- recommendation fallback
- local translation
- short plan synthesis
- local embeddings and retrieval support

### Tier D — Cloud fallback

Use only when:

- confidence is low
- output risk is high
- task complexity is high
- quality failure costs more than API spend

## OpenFang Architecture Split

### Browser responsibilities

The browser owns ephemeral speed work only.

Components:

- dedicated worker pool for parallel planner jobs
- one `SharedWorker` for cross-tab cache and reuse
- optional tiny in-browser model runtime for narrow tasks

The browser should never be the source of durable workflow truth.

### OpenFang server responsibilities

OpenFang remains the durable control plane.

It owns:

- planner state
- workflow runs
- approvals
- event log
- audit trail
- sync and persistence
- fallback policy decisions

### Local model server responsibilities

The local model server is only an inference helper.

It owns:

- token generation
- embeddings generation
- local model warm state

It does not own workflow state.

## Recommended Local Models

Start boring.

### Default first choice

`qwen3.5:9b`

Use as the first serious local planner model candidate for:

- routing
- task split
- agent recommendation
- translation
- short summaries
- planner-side classification

Reason:

- materially stronger than tiny browser-only models
- still small enough to be realistic for a laptop local tier
- good fit for narrow planner and orchestration tasks before cloud escalation

### Secondary choices

- small embedding model for local planner retrieval
- tiny browser-safe model for offline recommendation and translation only

## Worker Design

### Dedicated worker pool

Use dedicated workers for:

- classify inbox text
- split candidate tasks
- score candidate specialists
- rerank plan items
- assemble retrieval context
- validate structured JSON outputs

Pool size rule:

$min(max(2, hardwareConcurrency - 1), 6)$

Operational defaults:

- `2-4` workers for local model-adjacent tasks
- `4-6` workers for deterministic planner tasks

### SharedWorker

Use one `SharedWorker` per origin for:

- cross-tab embeddings cache
- local retrieval index handle
- model warmup state
- local task queue coordination
- localhost result cache

Do not put durable planner truth in the `SharedWorker`.

## First OpenFang Components To Add

### 1. Local inference capability registry

Add a small capability layer that answers:

- is browser worker pool available?
- is `SharedWorker` available?
- is WebGPU available?
- is localhost model reachable?
- which local model profile is active?

Suggested shape:

- browser reports capability snapshot to OpenFang
- OpenFang stores only the latest advisory snapshot, not required state

### 2. Local model adapter

Add a provider-neutral localhost adapter in OpenFang.

Supported backends:

- `ollama`
- `llama_cpp_openai_compat`

Suggested config keys:

```toml
[local_inference]
enabled = true
mode = "advisory"
base_url = "http://127.0.0.1:11434"
provider = "ollama"
planner_model = "qwen3.5:9b"
embedding_model = "nomic-embed-text"
cloud_fallback = true
```

`advisory` means local inference can help but server-side cloud fallback still exists.

### 3. Planner confidence policy

Planner requests should produce:

- result
- confidence
- source tier
- fallback decision reason

Suggested response contract:

```json
{
  "result": {},
  "confidence": 0.84,
  "tier": "localhost_model",
  "fallback_used": false,
  "reason": "local confidence above threshold"
}
```

### 4. Browser local orchestration service

Add a front-end service layer that hides worker and localhost details from page code.

Suggested modules:

- `local-orchestration-client.js`
- `worker-pool.js`
- `shared-worker.js`
- `local-model-client.js`

## Fallback Rules

Use a strict escalation ladder.

### Planner clarify

1. heuristic split in worker pool
2. if confidence high, accept
3. else call localhost model
4. if confidence still low, call cloud planner path

### Agent recommendation

1. deterministic rules first
2. browser worker rerank
3. localhost model if ambiguous
4. cloud only if recommendation materially affects outcome

### Translation

1. browser model if short and supported
2. localhost model for normal short-form translation
3. cloud for high-risk customer text

### Summarization

1. deterministic extractive summary when possible
2. localhost model for short abstractive summary
3. cloud for complex or externally visible summaries

## Phase Plan

### Phase 1 — Browser worker pool only

Scope:

- move planner clarify helpers off the main thread
- move recommendation scoring off the main thread
- keep existing server APIs as truth
- no local LLM yet

Acceptance:

- Today rebuild stays responsive
- clarify and recommendation do not block UI thread
- no durable planner logic lives only in browser memory

### Phase 2 — Localhost model adapter

Scope:

- add localhost provider adapter
- support Ollama first
- add planner fallback policy
- use local model for recommendation, translation, and ambiguous clarify

Acceptance:

- planner can call `http://127.0.0.1:11434`
- low-risk planner tasks can complete locally
- cloud fallback triggers only on low confidence or high risk

### Phase 3 — SharedWorker cache

Scope:

- add cross-tab cache
- reuse embeddings index and warm model session metadata
- avoid duplicate warmup across tabs

Acceptance:

- second tab avoids duplicate local setup work
- cross-tab recommendation latency improves

### Phase 4 — Optional in-browser tiny model

Scope:

- tiny browser model for recommendation, translation, and short summary only
- keep feature behind capability checks and config

Acceptance:

- supported hardware can perform narrow planner tasks fully offline
- unsupported hardware falls back cleanly without UX breakage

## First Endpoints To Wire

Keep this small.

### Existing endpoints to reuse

- planner inbox and clarify flows
- planner today rebuild
- workflow run endpoints

### New endpoints to add

#### `POST /api/local/capabilities`

Browser posts advisory capability snapshot.

Example payload:

```json
{
  "shared_worker": true,
  "webgpu": true,
  "hardware_concurrency": 12,
  "localhost_models": ["qwen3.5:9b"],
  "local_server_reachable": true
}
```

#### `GET /api/local/policy`

Returns planner thresholds and routing policy.

#### `POST /api/local/planner/clarify`

Optional thin endpoint for server-evaluated local-vs-cloud routing when planner clarify is requested.

#### `POST /api/local/planner/recommend`

Optional thin endpoint for specialist recommendation with confidence metadata.

These should remain adapters over planner logic, not a separate planner system.

## Non-Goals

Not in the first slice:

- browser-owned durable workflow state
- offline-first workflow engine
- full local replacement for cloud coding models
- browser-only approvals
- browser-only audit log
- parallel distributed multi-model scheduling

## Operational Guardrails

- local inference failure must degrade gracefully
- planner state must still work when no local model exists
- approvals remain server-side only
- every local result should carry confidence and source tier
- customer-facing high-risk output must prefer cloud or explicit human review

## Implementation Order for OpenFang

1. worker pool for planner heuristics
2. localhost adapter with Ollama support
3. `qwen3.5:9b` local planner profile
4. fallback policy wiring in planner services
5. `SharedWorker` cache
6. optional browser tiny-model path

## Recommendation

Build the laptop tier as assisted intelligence, not as a second control plane.

That means:

- browser for speed
- localhost for cheap inference
- OpenFang for truth

That is the stable version of a local tier for this product.
