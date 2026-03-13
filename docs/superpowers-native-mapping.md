# Superpowers-to-OpenFang Native Mapping Design

Status: Proposed

## Goal

Map high-value Superpowers concepts onto native OpenFang primitives without turning Superpowers into a separate runtime.

The design should:

- keep imported Superpowers skills compatible as `prompt_only` skills,
- translate workflow concepts into existing OpenFang tools and APIs,
- avoid hardcoding one-off behavior into the CLI,
- preserve OpenFang's capability model, approvals, and subagent limits.

## Non-Goals

This design does not:

- reimplement the full Superpowers host runtime,
- add a separate planner engine outside the kernel/runtime,
- require every Superpowers skill to become a first-class Rust tool,
- bypass OpenFang security policy or tool allowlists.

## Current State

OpenFang already supports importing Superpowers `SKILL.md` content through the OpenClaw compatibility path. Those skills load as `prompt_only` skills and inject instructions into prompts, but they do not yet have a native execution mapping for concepts such as planning, review, verification, and subagent orchestration.

The relevant native primitives already exist:

- planning/task coordination: `task_post`, `task_claim`, `task_complete`, `task_list`
- subagent orchestration: `agent_find`, `agent_spawn`, `agent_send`, `agent_list`, `agent_kill`
- shared context: `memory_store`, `memory_recall`
- checkpoints and human gating: approval flow
- reusable orchestration: workflows
- role shaping: agent skill assignment

## Core Decision

Use a runtime-side translation layer that teaches agents how to realize Superpowers concepts with existing OpenFang tools.

This layer should live in prompt/runtime handling, not in the CLI.

That keeps the architecture aligned with how OpenFang already works:

- skills influence prompts,
- tools remain native OpenFang tools,
- kernel/runtime enforce policy,
- workflows remain the durable orchestration mechanism.

## Architecture

### 1. Compatibility Catalog

Add a small, data-driven compatibility catalog for Superpowers concepts.

The catalog should describe:

- concept name
- intent/trigger phrases
- preferred native OpenFang tools
- expected execution pattern
- optional workflow recipe
- optional approval recommendation

Example conceptual entries:

- `planning`
- `review`
- `verification`
- `subagent_orchestration`
- `brainstorming`
- `handoff`

This is not a new tool system. It is metadata used to augment prompts and generate consistent guidance.

### 2. Prompt Augmentation Layer

When a relevant Superpowers skill is active, `prompt_builder` should inject a compact “native mapping” section.

That section should translate instruction language into OpenFang-native behavior. Example:

- “make a plan” -> create or update a task board using `task_post` and inspect it with `task_list`
- “delegate to a subagent” -> discover or spawn with `agent_find` / `agent_spawn`, then send work with `agent_send`
- “store notes for later” -> use `memory_store`, then recover with `memory_recall`
- “request review” -> either create a review task or route to a reviewer agent, optionally behind approval gates

This gives imported Superpowers skills operational meaning without changing their file format.

### 3. Workflow Recipe Layer

Some Superpowers concepts are stronger when modeled as repeatable workflow shapes rather than ad hoc prompt advice.

V1 should define recipe patterns, even if they are initially prompt-only:

- `plan -> execute -> review -> revise`
- `fan-out research -> collect -> synthesize`
- `delegate -> wait -> verify -> complete`
- `draft -> critique -> patch -> verify`

These recipes should map cleanly onto the existing workflow engine and task queue.

### 4. Approval and Policy Integration

Superpowers-style review and completion should respect OpenFang policy.

The translation layer should never imply unrestricted action. It should explicitly steer agents toward:

- approvals for high-impact actions,
- existing capability checks,
- subagent depth rules,
- agent skill allowlists.

### 5. Agent Role Shaping

When Superpowers guidance suggests specialist agents, OpenFang should use its own primitives:

- prefer `agent_find` when a suitable specialist already exists,
- use `agent_spawn` when a role-specific agent is needed,
- optionally constrain the spawned agent with selected skills or tool profiles,
- use `agent_send` as the handoff boundary.

This preserves OpenFang's registry and lifecycle model instead of inventing a parallel concept.

## Concept Mapping

### Planning

Superpowers intent:

- break work into explicit steps,
- keep track of progress,
- update the plan as work changes.

OpenFang mapping:

- create plan items with `task_post`
- inspect backlog/progress with `task_list`
- claim active work with `task_claim`
- close completed items with `task_complete`
- optionally persist rationale or summaries with `memory_store`

V1 guidance:

- use task queue operations as the default plan substrate,
- reserve workflows for repeatable multi-agent pipelines,
- do not invent a separate todo mechanism.

### Review

Superpowers intent:

- request critique from a separate perspective,
- verify quality before completion,
- avoid self-certifying important work.

OpenFang mapping:

- send draft output to a reviewer agent via `agent_find` + `agent_send`
- if no reviewer exists, create one via `agent_spawn`
- track requested review as a task item
- use approvals for human-required checkpoints

V1 guidance:

- “review” means either a reviewer agent loop or an approval-gated checkpoint,
- “request code review” maps to reviewer delegation, not a custom review tool.

### Verification

Superpowers intent:

- test or validate before marking done,
- record whether acceptance criteria were met.

OpenFang mapping:

- represent verification as explicit task steps,
- route execution/testing to existing file/shell/native tools available to the acting agent,
- record summary or evidence in memory when useful,
- complete the parent task only after verification is done.

V1 guidance:

- verification is a process pattern layered on top of existing execution tools,
- no dedicated verification engine is required for the first version.

### Subagent Orchestration

Superpowers intent:

- split work across specialized assistants,
- coordinate handoffs,
- gather results back into the main flow.

OpenFang mapping:

- discover existing agents with `agent_find`
- spawn purpose-built workers with `agent_spawn`
- send scoped tasks with `agent_send`
- track handoffs and completion status with task board operations
- use memory for shared facts and synthesized results

V1 guidance:

- keep the parent agent as coordinator,
- keep subagent work scoped and auditable,
- rely on existing subagent depth restrictions.

### Brainstorming

Superpowers intent:

- generate options before choosing a path.

OpenFang mapping:

- use either a short task list of options or a fan-out workflow,
- optionally spawn multiple role-specific agents for divergent thinking,
- collect/summarize outputs back into the coordinator.

### Handoff / Completion

Superpowers intent:

- leave clear state for the next actor,
- make completion criteria explicit.

OpenFang mapping:

- summarize work and decisions into `memory_store`
- mark task state explicitly with `task_complete`
- publish events when useful for triggers or downstream workflows

## Proposed Implementation Shape

### Phase 1: Prompt-Level Mapping

Add a compact compatibility module that returns mapping guidance for active Superpowers concepts.

Candidate files:

- `crates/openfang-runtime/src/prompt_builder.rs`
- new helper such as `crates/openfang-runtime/src/superpowers_compat.rs`

Behavior:

- detect when imported Superpowers skills are active,
- append concise native-tool translation guidance,
- keep output small to avoid token bloat.

### Phase 2: Structured Concept Catalog

Move compatibility entries into a typed catalog so the runtime can reason about them more consistently.

Candidate responsibilities:

- list supported concepts,
- expose mapping summaries,
- expose optional workflow recipe names,
- support future UI/API introspection.

### Phase 3: Workflow/Task Templates

Add reusable templates for the highest-value patterns:

- draft/review/revise
- research/synthesize
- delegate/verify/complete

These can be documented first, then exposed in CLI/API later if needed.

## Why This Approach

### Benefits

- minimal architectural risk
- reuses existing tools and security controls
- avoids duplicating planner/reviewer/subagent runtimes
- keeps imported Superpowers skills useful immediately
- creates a clean path toward richer workflow integration later

### Tradeoffs

- V1 behavior is guidance-first, not fully automatic orchestration
- some Superpowers workflows will still depend on model compliance with prompts
- richer automation will require follow-up work in workflows, triggers, or UI surfaces

## Rejected Alternatives

### Hardcode Each Skill Individually

Rejected because it does not scale and couples OpenFang runtime behavior to one external skill library.

### Implement a Separate Superpowers Runtime

Rejected because OpenFang already has agent lifecycle, tasks, workflows, approvals, and skills. A parallel runtime would duplicate core architecture and security enforcement.

### Force Everything Through the Workflow Engine

Rejected for V1 because many Superpowers concepts are lightweight operating habits, not always formal workflows. Tasks plus prompt guidance are a better first fit.

## Testing Strategy

When implementation begins, validation should cover:

1. unit tests for concept-to-tool mapping output
2. prompt builder tests verifying guidance injection only when relevant
3. runtime tests ensuring subagent policy is still enforced
4. live daemon test with imported Superpowers skills installed
5. end-to-end scenario tests for:
   - planning via task queue
   - review via reviewer agent handoff
   - subagent delegation with result return

## Initial Implementation Plan

1. add `superpowers_compat` helper in runtime
2. define concept mapping catalog and concise guidance renderer
3. wire prompt augmentation into `prompt_builder`
4. gate injection on active/imported Superpowers skills
5. add focused unit tests
6. document behavior in docs
7. run build, tests, clippy, and live integration verification

## Expected Outcome

After V1, imported Superpowers skills should remain `prompt_only`, but their key instructions will map naturally onto OpenFang-native execution:

- plans become tasks,
- reviews become reviewer-agent or approval checkpoints,
- delegation becomes agent orchestration,
- completion becomes explicit task/memory state,
- repeated patterns can graduate into workflows over time.
