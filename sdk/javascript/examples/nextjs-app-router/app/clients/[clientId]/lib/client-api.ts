import {
  getApprovals,
  getClient,
  getResults,
  getTasks,
} from "../../../../lib/command-center-api";
import type {
  ApprovalItem,
  ClientApprovalsResponse,
  ClientHomeResponse,
  ClientMemoryFact,
  ClientPlanResponse,
  ClientPulseResponse,
  ClientResultsResponse,
  ClientSummary,
  HealthLevel,
  RiskOrOpportunity,
  TaskItem,
} from "./client-types";
import type {
  ApprovalItem as CommandCenterApproval,
  ClientProfile,
  PlannedTask,
  RunResult,
} from "../../../../lib/command-center-types";

function mapHealth(tasks: PlannedTask[], approvals: CommandCenterApproval[], results: RunResult[]): HealthLevel {
  const failedTasks = tasks.filter((task) => task.status === "failed").length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending" || approval.status === "changes_requested").length;
  const failedResults = results.filter((result) => result.status === "failed").length;
  if (failedTasks > 0 || failedResults > 0) return "red";
  if (pendingApprovals > 0 || tasks.some((task) => task.status === "pending_approval" || task.board_column === "waiting")) return "yellow";
  return "green";
}

function deriveClientSummary(profile: ClientProfile, tasks: PlannedTask[], approvals: CommandCenterApproval[], results: RunResult[]): ClientSummary {
  const lastActivityCandidates = [profile.updated_at, ...results.map((result) => result.completed_at)].filter(Boolean);
  const last_activity_at = lastActivityCandidates.length > 0
    ? lastActivityCandidates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
    : null;
  const health = mapHealth(tasks, approvals, results);
  return {
    id: profile.id,
    name: profile.business_name,
    industry: profile.industry,
    main_goal: profile.main_goal,
    approver_name: profile.approvers[0]?.name || "Approval queue",
    status: health === "red" ? "at_risk" : "active",
    health,
    current_sprint_label: "This cycle",
    approvals_waiting: approvals.filter((approval) => approval.status === "pending" || approval.status === "changes_requested").length,
    tasks_due_today: tasks.filter((task) => task.board_column === "today" || task.status === "approved" || task.status === "running").length,
    last_activity_at,
  };
}

function mapApprovalType(item: CommandCenterApproval): ApprovalItem["approval_type"] {
  const summary = item.preview_summary.toLowerCase();
  if (summary.includes("email") || summary.includes("send")) return "send";
  if (summary.includes("publish")) return "publish";
  if (summary.includes("delivery")) return "delivery";
  if (summary.includes("tool")) return "tool_use";
  if (summary.includes("assignment")) return "assignment";
  return "tool_use";
}

function mapApprovalStatus(status: CommandCenterApproval["status"]): ApprovalItem["status"] {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "changes_requested") return "changes_requested";
  return "needs_review";
}

function mapApproval(item: CommandCenterApproval): ApprovalItem {
  return {
    id: item.id,
    linked_task_id: item.task_id,
    title: item.preview_summary,
    reason: item.preview_summary,
    approval_type: mapApprovalType(item),
    status: mapApprovalStatus(item.status),
    requested_by: item.requested_by,
    created_at: new Date().toISOString(),
    preview_text: item.preview_summary,
    tools_involved: item.tool_actions,
  };
}

function mapTaskStatus(task: PlannedTask): TaskItem["status"] {
  if (task.board_column === "backlog") return "backlog";
  if (task.board_column === "this_week") return "this_week";
  if (task.board_column === "today") return task.status === "running" ? "running" : "today";
  if (task.board_column === "waiting") return task.status === "failed" ? "failed" : "waiting";
  if (task.board_column === "done") return "done";
  if (task.status === "completed") return "done";
  if (task.status === "running") return "running";
  if (task.status === "failed") return "failed";
  if (task.status === "approved") return "today";
  if (task.status === "pending_approval") return "waiting";
  return "backlog";
}

function mapTask(task: PlannedTask): TaskItem {
  return {
    id: task.id,
    title: task.title,
    description: String(task.input_snapshot?.goal || task.type || task.title),
    status: mapTaskStatus(task),
    priority: task.priority,
    owner_type: "agent",
    owner_label: task.assigned_agent,
    due_at: null,
    blocked_by_ids: [],
    unlocks_ids: [],
    approval_required: task.approval_required,
    estimated_minutes: null,
  };
}

function deriveRecentActivity(tasks: PlannedTask[], approvals: CommandCenterApproval[], results: RunResult[]) {
  return [
    ...approvals.map((approval) => ({
      id: `approval-${approval.id}`,
      type: "approval" as const,
      title: approval.preview_summary,
      summary: `Approval requested by ${approval.requested_by}`,
      created_at: new Date().toISOString(),
      actor_label: approval.requested_by,
    })),
    ...results.map((result) => ({
      id: `result-${result.id}`,
      type: "delivery" as const,
      title: result.title,
      summary: `${result.output_type} completed`,
      created_at: result.completed_at,
      actor_label: "results_agent",
    })),
    ...tasks.map((task) => ({
      id: `task-${task.id}`,
      type: "task" as const,
      title: task.title,
      summary: `Task is ${task.status.replace(/_/g, " ")}`,
      created_at: new Date().toISOString(),
      actor_label: task.assigned_agent,
    })),
  ]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 8);
}

function derivePulseFacts(profile: ClientProfile, tasks: PlannedTask[], results: RunResult[]): ClientMemoryFact[] {
  return [
    { id: "offer", label: "Offer", value: profile.offer, source: "manual" as const },
    { id: "customer", label: "Audience", value: profile.customer, source: "manual" as const },
    { id: "goal", label: "Current goal", value: profile.main_goal, source: "manual" as const },
    { id: "notes", label: "Notes", value: profile.notes || "No notes captured yet.", source: "manual" as const },
    { id: "results", label: "Completed outputs", value: `${results.length} result${results.length === 1 ? "" : "s"}`, source: "result" as const },
    { id: "tasks", label: "Tracked tasks", value: `${tasks.length} task${tasks.length === 1 ? "" : "s"}`, source: "agent" as const },
  ].filter((fact) => fact.value && fact.value.trim().length > 0);
}

function deriveRisks(profile: ClientProfile, tasks: PlannedTask[], approvals: CommandCenterApproval[]): RiskOrOpportunity[] {
  const items: RiskOrOpportunity[] = [];
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending" || approval.status === "changes_requested").length;
  if (pendingApprovals > 0) {
    items.push({
      id: "risk-approvals",
      kind: "risk",
      severity: pendingApprovals > 2 ? "high" : "medium",
      title: "Approval queue is slowing delivery",
      description: `${pendingApprovals} item${pendingApprovals === 1 ? " is" : "s are"} waiting on review.`,
      suggested_next_step: "Review and clear the approval queue.",
    });
  }
  if (profile.website_url) {
    items.push({
      id: "opportunity-site",
      kind: "opportunity",
      severity: "medium",
      title: "Site-backed context is available",
      description: "The client profile already includes a site URL that can feed research and content generation.",
      suggested_next_step: "Refresh pulse research and compare current messaging against the offer.",
    });
  }
  if (tasks.some((task) => task.status === "failed")) {
    items.push({
      id: "risk-failed",
      kind: "risk",
      severity: "high",
      title: "Failed work needs review",
      description: "One or more planned tasks failed in the current cycle.",
      suggested_next_step: "Inspect failed outputs and reassign or revise before rerunning.",
    });
  }
  return items;
}

export async function getClientHome(clientId: string): Promise<ClientHomeResponse> {
  const [{ client: profile }, { tasks }, { approvals }, { results }] = await Promise.all([
    getClient(clientId),
    getTasks(clientId),
    getApprovals(clientId),
    getResults(clientId),
  ]);
  const summary = deriveClientSummary(profile, tasks, approvals, results);
  const mappedTasks = tasks.map(mapTask);
  const pendingApprovals = approvals.map(mapApproval).filter((approval) => approval.status === "needs_review");
  return {
    client: summary,
    priorities: mappedTasks
      .filter((task) => task.status !== "done")
      .slice(0, 3)
      .map((task) => ({
        id: task.id,
        title: task.title,
        owner_label: task.owner_label,
        due_at: task.due_at,
        risk_flag: task.approval_required || task.status === "failed",
        linked_task_id: task.id,
      })),
    approvals_waiting: pendingApprovals,
    blocked_tasks: mappedTasks.filter((task) => task.status === "waiting" || task.status === "failed"),
    recent_activity: deriveRecentActivity(tasks, approvals, results),
    upcoming_deadlines: [],
    health_summary: {
      level: summary.health,
      delivery_confidence: summary.health === "green" ? 84 : summary.health === "yellow" ? 61 : 32,
      approval_lag_hours: pendingApprovals.length > 0 ? pendingApprovals.length * 4 : null,
      renewal_likelihood: summary.health === "green" ? 78 : summary.health === "yellow" ? 62 : 38,
    },
  };
}

export async function getClientPulse(clientId: string): Promise<ClientPulseResponse> {
  const [{ client: profile }, { tasks }, { approvals }, { results }] = await Promise.all([
    getClient(clientId),
    getTasks(clientId),
    getApprovals(clientId),
    getResults(clientId),
  ]);
  return {
    business_snapshot: {
      offer: profile.offer,
      audience: profile.customer,
      positioning: profile.industry,
      current_objective: profile.main_goal,
      constraints: profile.approval_mode === "required" ? ["Approval required before client-facing sends"] : [],
    },
    brand_voice: {
      summary: profile.notes || "No brand voice summary stored yet.",
      do_not_say: [],
      preferred_phrases: [],
      tone_notes: ["Use the client profile and current goal as the baseline tone anchor."],
    },
    competitor_signals: profile.website_url
      ? [{
          id: "signal-site",
          competitor_name: "Market scan",
          change_summary: `Research anchor available at ${profile.website_url}`,
          impact: "medium",
          source_label: "client profile",
          detected_at: profile.updated_at,
        }]
      : [],
    project_context: {
      active_campaigns: tasks.map((task) => task.title).slice(0, 4),
      linked_deliverables: results.map((result) => result.title).slice(0, 4),
      source_links: profile.website_url ? [profile.website_url] : [],
      supporting_documents: [],
    },
    missing_info: [
      !profile.offer ? { id: "missing-offer", question: "Define the current offer in more detail.", owner_label: "client_manager", requested_at: null } : null,
      !profile.customer ? { id: "missing-audience", question: "Clarify the target audience and buyer profile.", owner_label: "research_agent", requested_at: null } : null,
    ].filter(Boolean) as ClientPulseResponse["missing_info"],
    memory_facts: derivePulseFacts(profile, tasks, results),
    risks_and_opportunities: deriveRisks(profile, tasks, approvals),
  };
}

export async function getClientPlan(clientId: string): Promise<ClientPlanResponse> {
  const [{ tasks }] = await Promise.all([getTasks(clientId)]);
  const mappedTasks = tasks.map(mapTask);
  const ownerCounts = new Map<string, number>();
  for (const task of mappedTasks) {
    ownerCounts.set(task.owner_label, (ownerCounts.get(task.owner_label) || 0) + 1);
  }
  return {
    board: {
      backlog: mappedTasks.filter((task) => task.status === "backlog"),
      this_week: mappedTasks.filter((task) => task.status === "this_week"),
      today: mappedTasks.filter((task) => task.status === "today" || task.status === "running"),
      waiting: mappedTasks.filter((task) => task.status === "waiting" || task.status === "failed"),
      done: mappedTasks.filter((task) => task.status === "done"),
    },
    dependencies: mappedTasks.map((task) => ({
      task_id: task.id,
      blocked_by_ids: task.blocked_by_ids,
      unlocks_ids: task.unlocks_ids,
    })),
    capacity: Array.from(ownerCounts.entries()).map(([owner_label, count]) => ({
      owner_label,
      owner_type: "agent" as const,
      load_percent: Math.min(100, count * 25),
      overloaded: count >= 4,
    })),
    approval_needed: mappedTasks.filter((task) => task.approval_required),
  };
}

export async function getClientApprovals(clientId: string): Promise<ClientApprovalsResponse> {
  const [{ approvals }, { tasks }] = await Promise.all([getApprovals(clientId), getTasks(clientId)]);
  const mappedApprovals = approvals.map(mapApproval);
  return {
    needs_review: mappedApprovals.filter((approval) => approval.status === "needs_review"),
    approved: mappedApprovals.filter((approval) => approval.status === "approved"),
    rejected: mappedApprovals.filter((approval) => approval.status === "rejected"),
    changes_requested: mappedApprovals.filter((approval) => approval.status === "changes_requested"),
    execution_queue: tasks
      .filter((task) => task.status === "approved" || task.status === "running" || task.status === "completed" || task.status === "failed")
      .map((task) => ({
        id: task.id,
        title: task.title,
        status:
          task.status === "approved"
            ? "ready"
            : task.status === "running"
            ? "running"
            : task.status === "completed"
            ? "completed"
            : "failed",
        source_approval_id: approvals.find((approval) => approval.task_id === task.id)?.id || null,
      })),
    approval_rules: [
      { key: "send", enabled: true },
      { key: "publish", enabled: true },
      { key: "delivery", enabled: true },
      { key: "tool_use", enabled: true },
      { key: "financial", enabled: true },
      { key: "assignment", enabled: true },
    ],
  };
}

export async function getClientResults(clientId: string): Promise<ClientResultsResponse> {
  const [{ results }, { tasks }, { approvals }] = await Promise.all([
    getResults(clientId),
    getTasks(clientId),
    getApprovals(clientId),
  ]);
  const completed = results.filter((result) => result.status === "completed");
  const failed = results.filter((result) => result.status === "failed");
  return {
    delivered_outputs: results.map((result) => ({
      id: result.id,
      title: result.title,
      type: result.output_type.includes("email") ? "email" : result.output_type.includes("report") ? "report" : "deliverable",
      status: result.status === "completed" ? "ready" : "draft",
      completed_at: result.completed_at,
      url: null,
      summary: result.content_markdown.slice(0, 180),
    })),
    performance_summary: {
      metrics: [
        { label: "Completed outputs", value: String(completed.length), delta_label: null },
        { label: "Failed outputs", value: String(failed.length), delta_label: null },
        { label: "Approvals waiting", value: String(approvals.filter((approval) => approval.status === "pending" || approval.status === "changes_requested").length), delta_label: null },
        { label: "Tracked tasks", value: String(tasks.length), delta_label: null },
      ],
    },
    lessons_learned: [
      ...completed.slice(0, 2).map((result) => ({ id: `win-${result.id}`, type: "win" as const, text: `${result.title} completed successfully.` })),
      ...failed.slice(0, 2).map((result) => ({ id: `miss-${result.id}`, type: "miss" as const, text: `${result.title} needs follow-up due to a failed run.` })),
      ...(approvals.some((approval) => approval.status === "pending" || approval.status === "changes_requested")
        ? [{ id: "blocker-approval", type: "blocker" as const, text: "Pending approvals are slowing execution." }]
        : []),
    ],
    feedback: [],
    next_best_actions: [
      ...(approvals.some((approval) => approval.status === "pending" || approval.status === "changes_requested")
        ? [{ id: "next-approval", title: "Clear pending approvals", reason: "Execution is waiting on review.", type: "follow_up" as const }]
        : []),
      ...(failed.length > 0
        ? [{ id: "next-rerun", title: "Review failed outputs", reason: "One or more results failed and need intervention.", type: "task" as const }]
        : []),
      ...(completed.length > 0
        ? [{ id: "next-update", title: "Draft a client update", reason: "There is enough completed work to summarize progress.", type: "follow_up" as const }]
        : []),
    ],
    weekly_review: {
      completed_count: completed.length,
      slipped_count: tasks.filter((task) => task.status === "failed" || task.status === "pending_approval").length,
      summary: `${completed.length} completed output${completed.length === 1 ? "" : "s"}, ${failed.length} failed, and ${approvals.filter((approval) => approval.status === "pending" || approval.status === "changes_requested").length} approval item${approvals.filter((approval) => approval.status === "pending" || approval.status === "changes_requested").length === 1 ? "" : "s"} waiting.`,
    },
    case_study_candidates: completed.slice(0, 2).map((result) => ({
      id: `case-${result.id}`,
      title: result.title,
      proof_point: result.output_type,
      quote_candidate: null,
    })),
  };
}