# Integration Contract

This document freezes the supported application-facing contract for integrating external web apps, mobile apps, gateways, and internal backends with OpenFang.

Use this document as the source of truth for app integration work in this fork.

---

## Positioning

Treat OpenFang as a shared agent service behind your apps, not as application logic embedded directly into each frontend.

Recommended shape:

```text
Frontend
  -> Your backend / API
      -> OpenFang
```

Frontends should talk to your backend.
Your backend should own:

- authentication
- tenant and workspace mapping
- agent lookup and creation
- usage logging
- rate limits
- audit trails
- secret handling
- fallback behavior

Do not expose OpenFang directly to browsers in production.

---

## Frozen Contract

### Base URL

Canonical API base URL:

```bash
OPENFANG_BASE_URL=http://127.0.0.1:50051
```

This is the standard base URL for:

- app backends
- SDK usage
- channel bridges
- internal proxies
- OpenAI-compatible requests

### Authentication

Canonical auth pattern:

```http
Authorization: Bearer <OPENFANG_API_KEY>
```

When `api_key` is configured in OpenFang, app integrations should send Bearer auth on protected endpoints.

### Default env contract

```bash
OPENFANG_BASE_URL=http://127.0.0.1:50051
OPENFANG_API_KEY=replace-me
OPENFANG_DEFAULT_TEMPLATE=assistant
OPENFANG_DEFAULT_MODEL=assistant
```

Use `OPENFANG_DEFAULT_TEMPLATE` when your backend is creating or spawning agents from templates.
Use `OPENFANG_DEFAULT_MODEL` when your integration surface needs an OpenAI-compatible model alias or a channel bridge target.

### Port semantics

`50051` is the HTTP API, dashboard, SSE, WebSocket, and OpenAI-compatible API port.

`4200` is reserved for OFP/networking references where explicitly documented.

Do not use `4200` as the default app integration port.

---

## Supported App Paths

### Path A: OpenAI-compatible chat

Use this for thin product chat and fast integrations.

Primary endpoint:

```text
POST /v1/chat/completions
```

Example:

```bash
curl -X POST http://127.0.0.1:50051/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENFANG_API_KEY" \
  -d '{
    "model": "openfang:assistant",
    "messages": [{"role": "user", "content": "Say hello."}],
    "stream": false
  }'
```

Use Path A when you want:

- fastest integration time
- compatibility with existing OpenAI-style clients
- stateless or lightly stateful chat

### Path B: Managed agents

Use this for durable sessions, memory, tool use, specialist agents, or product-specific templates.

Core endpoints:

```text
POST /api/agents
POST /api/agents/{id}/message
POST /api/agents/{id}/message/stream
GET  /api/agents
GET  /api/health
GET  /api/status
```

Use Path B when you need:

- persistent agent identity
- memory and session mapping
- tool execution
- specialist templates
- product-specific agent lifecycle control

---

## Backend Rules

Your backend should be the trust boundary.

It should:

- map `user_id`, `tenant_id`, or `workspace_id` to OpenFang agent IDs
- create agents from templates instead of hardcoding prompt strings in app code
- store business data in your database and agent memory in OpenFang
- proxy streaming responses to the frontend
- add request logging, quotas, and kill switches

It should not:

- expose provider API keys to the browser
- let browsers call OpenFang directly in production
- duplicate system prompts across multiple apps
- bury tenant logic in channel adapters

---

## Template Contract

Agent templates under `agents/<name>/agent.toml` are the source of truth for product behavior.

Product integrations should prefer template-driven agents over ad hoc prompt assembly.

Each template should own:

- system prompt
- model choice
- fallback models
- tool allowlist
- resource limits
- memory scope

Start product specialization by cloning `assistant` into task-specific templates such as:

- `support-agent`
- `research-agent`
- `ops-agent`

---

## JavaScript SDK Contract

Canonical SDK construction:

```js
const { OpenFang } = require("@openfang/sdk");

const client = new OpenFang(process.env.OPENFANG_BASE_URL || "http://127.0.0.1:50051", {
  headers: process.env.OPENFANG_API_KEY
    ? { Authorization: `Bearer ${process.env.OPENFANG_API_KEY}` }
    : {},
});
```

Backends may omit the Authorization header only when OpenFang is intentionally running without `api_key` in a local-only development environment.

Repository examples:

- `sdk/javascript/examples/backend-proxy-server.js`
- `sdk/javascript/examples/sse-client.js`

---

## Channel Bridge Contract

Gateway and channel bridge code should follow the same base contract:

- `OPENFANG_BASE_URL`
- `OPENFANG_API_KEY`
- `OPENFANG_DEFAULT_MODEL`

Existing deprecated env aliases may remain temporarily for compatibility, but new integrations should use the canonical names only.

---

## Minimum Smoke Test

Before treating a version of this fork as stable for app work, verify:

```bash
curl http://127.0.0.1:50051/api/health
curl http://127.0.0.1:50051/v1/models
```

And from the JavaScript SDK:

```js
await client.health();
```

If those pass, the base app contract is alive.

---

## Stability Rule

Build app integrations against this contract, not against every feature or knob exposed elsewhere in the repo.

If examples, SDK snippets, Docker defaults, or package env names drift away from this document, this document wins and the drift should be corrected.
