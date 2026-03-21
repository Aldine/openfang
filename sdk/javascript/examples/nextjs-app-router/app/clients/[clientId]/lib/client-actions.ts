import { approveTask, getApprovals, getClient, getResults, getTasks, runTask } from "../../../../lib/command-center-api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export type MoveTaskTarget = "backlog" | "this_week" | "today" | "waiting" | "done";

export async function approveClientTask(taskId: string) {
  return approveTask(taskId);
}

export async function rejectClientTask(taskId: string) {
  return json<{ ok: true }>(await fetch(`/api/tasks/${taskId}/reject`, { method: "POST" }));
}

export async function requestTaskChanges(taskId: string) {
  return json<{ ok: true }>(await fetch(`/api/tasks/${taskId}/request-changes`, { method: "POST" }));
}

export async function assignClientTask(taskId: string, assignedAgent: string) {
  return json<{ task: { id: string; assigned_agent: string } }>(
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_agent: assignedAgent }),
    }),
  );
}

export async function moveClientTask(taskId: string, target: MoveTaskTarget) {
  return json<{ task: { id: string; board_column: MoveTaskTarget } }>(
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board_column: target }),
    }),
  );
}

export async function runApprovedClientTask(taskId: string) {
  return runTask(taskId);
}

export async function draftClientUpdate(clientId: string) {
  const [{ client }, { tasks }, { approvals }, { results }] = await Promise.all([
    getClient(clientId),
    getTasks(clientId),
    getApprovals(clientId),
    getResults(clientId),
  ]);

  const completed = results.filter((result) => result.status === "completed");
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending" || approval.status === "changes_requested");
  const activeTasks = tasks.filter((task) => task.status === "running" || task.status === "approved");

  const lines = [
    `Client update for ${client.business_name}`,
    "",
    `Primary goal: ${client.main_goal || "Not set"}`,
    "",
    "Completed work:",
    ...(completed.length > 0 ? completed.map((result) => `- ${result.title}`) : ["- No completed outputs yet."]),
    "",
    "Active work:",
    ...(activeTasks.length > 0 ? activeTasks.map((task) => `- ${task.title} (${task.assigned_agent})`) : ["- No active work in progress."]),
    "",
    "Needs review:",
    ...(pendingApprovals.length > 0 ? pendingApprovals.map((approval) => `- ${approval.preview_summary}`) : ["- No approvals waiting."]),
    "",
    "Recommended next step:",
    pendingApprovals.length > 0
      ? "- Clear the approval queue so execution can continue."
      : completed.length > 0
      ? "- Share the completed deliverables and confirm next priorities."
      : "- Confirm the next highest-priority deliverable.",
  ];

  return {
    title: `Update for ${client.business_name}`,
    markdown: lines.join("\n"),
  };
}