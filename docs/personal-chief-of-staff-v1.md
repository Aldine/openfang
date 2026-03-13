# Personal Chief of Staff V1

Status: Proposed

## Product Promise

When the user opens OpenFang, it should tell them:

- what matters now,
- why it matters,
- what to do next,
- and what will happen later if nothing changes.

This product is not an agent lab as the default experience.

It is a planner operating system built on top of OpenFang's existing engine:

- agents,
- sessions,
- cron,
- skills,
- task primitives,
- approval flow,
- subagent orchestration.

## V1 Product Shape

OpenFang V1 should ship one opinionated assistant experience:

`Personal Chief of Staff`

Core loop:

1. Capture
2. Clarify
3. Plan
4. Execute
5. Review

## Existing Engine Capabilities To Reuse

The current codebase already provides useful substrate pieces:

- task queue primitives in [crates/openfang-memory/src/substrate.rs](crates/openfang-memory/src/substrate.rs#L408-L558)
- task tools in [crates/openfang-runtime/src/tool_runner.rs](crates/openfang-runtime/src/tool_runner.rs#L1699-L1751)
- agent sessions and session switching in [crates/openfang-api/src/server.rs](crates/openfang-api/src/server.rs#L142-L168) and [crates/openfang-api/src/server.rs](crates/openfang-api/src/server.rs#L470-L483)
- cron job types in [crates/openfang-types/src/scheduler.rs](crates/openfang-types/src/scheduler.rs#L157-L330)
- approvals in [crates/openfang-types/src/approval.rs](crates/openfang-types/src/approval.rs)
- current SPA routing shell in [crates/openfang-api/static/js/app.js](crates/openfang-api/static/js/app.js)

V1 should layer planner opinion on top of these, not replace them.

## V1 Assistant Roles

Use only three agents.

### 1. Planner

Responsibilities:

- inbox triage
- project breakdown
- today plan
- week plan
- time estimates
- priority scoring

Primary tools:

- `task_post`
- `task_list`
- `task_claim`
- `task_complete`
- `memory_store`
- `memory_recall`
- `cron_create`

### 2. Executor

Responsibilities:

- next action selection
- focus session kickoff
- blocker detection
- progress check-ins
- end-of-session summary

Primary tools:

- `agent_send`
- persistent session continuation
- `task_claim`
- `task_complete`
- `agent_spawn` for specialist support

### 3. Reviewer

Responsibilities:

- shutdown review
- weekly review
- postmortems
- rescheduling unfinished work
- verification before marking done

Primary tools:

- approvals
- `agent_find`
- `agent_spawn`
- task gating
- imported Superpowers review skills

## Planner Domain Schema

V1 needs a planner-specific domain model instead of raw task queue rows.

These types should live in a new planner domain module under `openfang-types` and persist through a dedicated planner store in memory/sqlite.

### Project

```rust
pub struct Project {
	pub id: String,
	pub title: String,
	pub outcome: String,
	pub status: ProjectStatus,
	pub horizon: Horizon,
	pub deadline: Option<DateTime<Utc>>,
	pub importance: Importance,
	pub owner: String,
	pub notes: String,
	pub next_milestone: Option<String>,
	pub next_action_task_id: Option<String>,
	pub risk_level: RiskLevel,
	pub last_activity_at: Option<DateTime<Utc>>,
}
```

### Task

```rust
pub struct PlannerTask {
	pub id: String,
	pub project_id: Option<String>,
	pub inbox_item_id: Option<String>,
	pub title: String,
	pub status: PlannerTaskStatus,
	pub priority: PriorityBand,
	pub effort_minutes: Option<u32>,
	pub energy_level: EnergyLevel,
	pub due_at: Option<DateTime<Utc>>,
	pub scheduled_for: Option<DateTime<Utc>>,
	pub blocked_by: Vec<String>,
	pub next_action: String,
	pub context: Vec<String>,
	pub must_today: bool,
	pub should_today: bool,
	pub could_today: bool,
}
```

### InboxItem

```rust
pub struct InboxItem {
	pub id: String,
	pub raw_text: String,
	pub source: InboxSource,
	pub captured_at: DateTime<Utc>,
	pub clarified: bool,
	pub project_id: Option<String>,
	pub task_id: Option<String>,
}
```

### Routine

```rust
pub struct Routine {
	pub id: String,
	pub name: String,
	pub trigger: RoutineTrigger,
	pub agent_id: String,
	pub thread_label: String,
	pub prompt_template: String,
	pub active: bool,
	pub last_run_at: Option<DateTime<Utc>>,
	pub next_run_at: Option<DateTime<Utc>>,
}
```

### FocusSession

```rust
pub struct FocusSession {
	pub id: String,
	pub task_id: String,
	pub thread_label: String,
	pub started_at: DateTime<Utc>,
	pub target_minutes: u32,
	pub ended_at: Option<DateTime<Utc>>,
	pub outcome: Option<String>,
	pub blockers: Vec<String>,
}
```

### ReviewNote

```rust
pub struct ReviewNote {
	pub id: String,
	pub scope: ReviewScope,
	pub date: NaiveDate,
	pub wins: Vec<String>,
	pub misses: Vec<String>,
	pub adjustments: Vec<String>,
}
```

### Goal

```rust
pub struct Goal {
	pub id: String,
	pub title: String,
	pub horizon: Horizon,
	pub success_definition: String,
	pub active: bool,
}
```

### Constraint

```rust
pub struct Constraint {
	pub id: String,
	pub kind: ConstraintKind,
	pub label: String,
	pub applies_on: Vec<Weekday>,
	pub start_time: Option<String>,
	pub end_time: Option<String>,
	pub notes: String,
}
```

## Planner Rules

These rules should be enforced in prompt logic and surfaced in UI:

- maximum 3 must-do items per day
- every task needs a `next_action`
- every project needs an owner and next milestone
- unfinished work must be rescheduled or dropped
- blocked work must show blocker
- today plans must be realistic against effort and constraints

## Session And Thread Strategy

Use persistent agent sessions as planner continuity.

Recommended labels:

- `today`
- `daily-planning`
- `midday-reset`
- `shutdown-review`
- `weekly-review`
- `focus`
- `project:<slug>`

The API already supports session listing, creation, switching, and lookup by label via [crates/openfang-api/src/server.rs](crates/openfang-api/src/server.rs#L470-L483).

V1 should add a planner helper layer that resolves or creates these labeled sessions automatically.

## Cron Routine Defaults

V1 routine schedule presets:

- 7:00 AM — daily planning
- 12:30 PM — midday reset
- 5:30 PM — shutdown review
- Sunday 4:00 PM — weekly review

These should map onto `Routine` records and compile down to existing `CronJob` records.

UI should present plain language labels, not raw cron jargon.

## Planner Skill Pack

Add a planner-oriented skill pack under a dedicated planner collection.

Initial skills:

- `daily-planning`
- `weekly-review`
- `project-breakdown`
- `focus-sprint`
- `decision-journal`

Each skill should be prompt-first and compatible with the existing `SKILL.md` support added in [crates/openfang-cli/src/main.rs](crates/openfang-cli/src/main.rs#L3258-L3425).

## Planner Prompts

### Planner system prompt

```text
You are my Chief of Staff.
Your job is to reduce ambiguity, protect focus, and convert goals into finished work.
You do not dump long lists.
You choose the next best move.
You prefer commitment over brainstorming.
You break large work into concrete next actions.
You challenge unrealistic plans.
You preserve momentum across days.
When uncertain, ask what outcome matters most.
When planning, keep workload realistic.
When reviewing, identify drift and correct it.
```

### Executor prompt rules

- stay on one task
- identify blockers quickly
- summarize progress in short bursts
- do not open unrelated work

### Reviewer prompt rules

- close loops
- surface drift
- reschedule or drop unfinished work
- require explicit evidence before marking done

## API Contract For V1

Add planner-focused APIs instead of forcing the frontend to compose raw engine endpoints.

### Inbox

- `GET /api/planner/inbox`
- `POST /api/planner/inbox`
- `POST /api/planner/inbox/{id}/clarify`
- `POST /api/planner/inbox/clarify-all`

### Projects

- `GET /api/planner/projects`
- `POST /api/planner/projects`
- `GET /api/planner/projects/{id}`
- `PUT /api/planner/projects/{id}`

### Tasks

- `GET /api/planner/tasks`
- `POST /api/planner/tasks`
- `PUT /api/planner/tasks/{id}`
- `POST /api/planner/tasks/{id}/complete`
- `POST /api/planner/tasks/{id}/reschedule`

### Planning

- `GET /api/planner/today`
- `POST /api/planner/today/generate`
- `GET /api/planner/week`
- `POST /api/planner/week/generate`

### Focus

- `GET /api/planner/focus/current`
- `POST /api/planner/focus/start`
- `POST /api/planner/focus/{id}/check-in`
- `POST /api/planner/focus/{id}/complete`

### Reviews

- `GET /api/planner/reviews/daily`
- `POST /api/planner/reviews/daily/run`
- `GET /api/planner/reviews/weekly`
- `POST /api/planner/reviews/weekly/run`

### Automations

- `GET /api/planner/routines`
- `POST /api/planner/routines`
- `PUT /api/planner/routines/{id}`
- `POST /api/planner/routines/{id}/run`

## Frontend Product Shell

Replace the main user navigation with:

- Today
- Inbox
- Projects
- Focus
- Reviews
- Automations
- Agent Console

`Agent Console` remains secondary.

### Screen Rules

#### Today

Show:

- top outcome card
- `Must / Should / Could` sections
- blockers rail
- calendar/constraint summary
- session history

#### Inbox

Show:

- fast capture box
- raw unclarified items
- one-click clarify

#### Projects

Show per card:

- outcome
- next milestone
- next action
- risk
- last activity

#### Focus

Show only:

- current task
- timer
- execution thread
- progress state

#### Reviews

Show:

- daily review log
- weekly summaries
- recurring misses
- adjustments

#### Automations

Show:

- routine name
- plain English trigger
- owning agent
- last run
- next run

## Frontend Wiring Plan

Current routes in [crates/openfang-api/static/js/app.js](crates/openfang-api/static/js/app.js) are engine-shaped.

V1 should:

1. keep existing power pages available but secondary
2. add planner-first pages under `static/js/pages/`
3. set `Today` as the default landing page

Suggested new page modules:

- `today.js`
- `inbox.js`
- `projects.js`
- `focus.js`
- `reviews.js`
- `automations.js`
- `agent-console.js`

## Backend Implementation Plan

### Phase 1 — domain layer

Add planner types and persistence:

- `crates/openfang-types/src/planner.rs`
- `crates/openfang-memory/src/planner_store.rs`

Start with sqlite-backed CRUD for:

- inbox items
- planner projects
- planner tasks
- routines
- focus sessions
- review notes

### Phase 2 — planner service

Add planner orchestration in kernel/runtime:

- generate day plan
- generate week plan
- clarify inbox item
- resolve next focus task
- run shutdown review
- run weekly review

### Phase 3 — API layer

Add planner routes to [crates/openfang-api/src/server.rs](crates/openfang-api/src/server.rs) and handlers in [crates/openfang-api/src/routes.rs](crates/openfang-api/src/routes.rs).

### Phase 4 — skill pack

Ship planner prompt skills as bundled or workspace-installable skills.

### Phase 5 — frontend

Wire the six planner pages and demote engine pages behind `Agent Console`.

## First Seven Build Steps

1. define planner schema in code
2. create planner, executor, reviewer prompts
3. add planner skill pack
4. create persistent labeled sessions
5. add cron-backed planner routines
6. build planner-first screens
7. test one real workflow for seven days

## Success Metric

Ship this milestone:

`Every morning, OpenFang gives me a realistic day plan. During the day, it keeps me focused. At night, it closes the loop and sets tomorrow up.`

If that works, the product is real.
