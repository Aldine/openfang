import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../lib/command-center-api', () => ({
  getClient: vi.fn(),
  getTasks: vi.fn(),
  getApprovals: vi.fn(),
  getResults: vi.fn(),
}));

import {
  getClientApprovals,
  getClientPlan,
  getClientResults,
} from '../client-api';
import {
  getApprovals,
  getClient,
  getResults,
  getTasks,
} from '../../../../../lib/command-center-api';

const client = {
  id: 'client-1',
  business_name: 'Acme Co',
  industry: 'SaaS',
  main_goal: 'Increase conversions',
  approvers: [{ name: 'Dana' }],
  updated_at: '2025-01-03T10:00:00.000Z',
  offer: 'Revenue OS',
  customer: 'Ops leaders',
  notes: 'Sharp, direct, confident.',
  website_url: 'https://acme.test',
  approval_mode: 'required',
};

const tasks = [
  {
    id: 'task-backlog',
    title: 'Backlog task',
    type: 'research',
    status: 'draft',
    board_column: 'backlog',
    priority: 'medium',
    assigned_agent: 'planner_agent',
    required_tools: [],
    approval_required: false,
    approval_status: 'none',
    input_snapshot: { goal: 'Research competitors' },
  },
  {
    id: 'task-waiting',
    title: 'Approval-gated task',
    type: 'delivery',
    status: 'pending_approval',
    board_column: 'waiting',
    priority: 'high',
    assigned_agent: 'review_agent',
    required_tools: [],
    approval_required: true,
    approval_status: 'changes_requested',
    input_snapshot: { goal: 'Review outbound copy' },
  },
  {
    id: 'task-running',
    title: 'Execution task',
    type: 'delivery',
    status: 'running',
    board_column: 'today',
    priority: 'high',
    assigned_agent: 'ops_agent',
    required_tools: [],
    approval_required: false,
    approval_status: 'approved',
    input_snapshot: { goal: 'Ship approved work' },
  },
  {
    id: 'task-done',
    title: 'Completed task',
    type: 'delivery',
    status: 'completed',
    board_column: 'done',
    priority: 'low',
    assigned_agent: 'writer_agent',
    required_tools: [],
    approval_required: false,
    approval_status: 'approved',
    input_snapshot: { goal: 'Finalize update' },
  },
];

const approvals = [
  {
    id: 'approval-1',
    task_id: 'task-waiting',
    client_id: 'client-1',
    requested_by: 'review_agent',
    status: 'changes_requested',
    preview_summary: 'Publish landing page update',
    tool_actions: ['publish'],
  },
  {
    id: 'approval-2',
    task_id: 'task-running',
    client_id: 'client-1',
    requested_by: 'ops_agent',
    status: 'approved',
    preview_summary: 'Run approved sequence',
    tool_actions: ['send'],
  },
];

const results = [
  {
    id: 'result-1',
    task_id: 'task-done',
    client_id: 'client-1',
    status: 'completed',
    output_type: 'report',
    title: 'Weekly summary',
    content_markdown: 'Completed work summary',
    started_at: '2025-01-03T09:00:00.000Z',
    completed_at: '2025-01-03T09:30:00.000Z',
  },
];

describe('client-api mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClient.mockResolvedValue({ client });
    getTasks.mockResolvedValue({ tasks });
    getApprovals.mockResolvedValue({ approvals });
    getResults.mockResolvedValue({ results });
  });

  it('maps board columns and approval-needed tasks into the plan board', async () => {
    const plan = await getClientPlan('client-1');

    expect(plan.board.backlog.map(item => item.id)).toEqual(['task-backlog']);
    expect(plan.board.waiting.map(item => item.id)).toEqual(['task-waiting']);
    expect(plan.board.today.map(item => item.id)).toEqual(['task-running']);
    expect(plan.board.done.map(item => item.id)).toEqual(['task-done']);
    expect(plan.approval_needed.map(item => item.id)).toContain('task-waiting');
  });

  it('preserves linked task ids and changes-requested approvals', async () => {
    const view = await getClientApprovals('client-1');

    expect(view.changes_requested).toHaveLength(1);
    expect(view.changes_requested[0]).toMatchObject({
      id: 'approval-1',
      linked_task_id: 'task-waiting',
      status: 'changes_requested',
    });
  });

  it('summarizes results metrics with approvals waiting included', async () => {
    const view = await getClientResults('client-1');

    expect(view.performance_summary.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Completed outputs', value: '1' }),
        expect.objectContaining({ label: 'Approvals waiting', value: '1' }),
        expect.objectContaining({ label: 'Tracked tasks', value: '4' }),
      ]),
    );
  });
});