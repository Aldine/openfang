import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/clients/client-1',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('../[clientId]/lib/client-api', () => ({
  getClientHome: vi.fn(async () => ({
    client: {
      id: 'client-1',
      name: 'Acme Co',
      industry: 'SaaS',
      main_goal: 'Increase conversions',
      approver_name: 'Dana',
      status: 'active',
      health: 'green',
      current_sprint_label: 'This cycle',
      approvals_waiting: 1,
      tasks_due_today: 2,
      last_activity_at: '2025-01-03T10:00:00.000Z',
    },
    priorities: [{ id: 'p1', title: 'Priority', owner_label: 'ops_agent', due_at: null, risk_flag: false, linked_task_id: 'task-1' }],
    approvals_waiting: [{ id: 'a1', linked_task_id: 'task-1', title: 'Approval', reason: 'Review', approval_type: 'send', status: 'needs_review', requested_by: 'ops_agent', created_at: '2025-01-03T10:00:00.000Z', preview_text: 'Review', tools_involved: [] }],
    blocked_tasks: [],
    recent_activity: [{ id: 'act1', type: 'task', title: 'Activity', summary: 'Moved forward', created_at: '2025-01-03T10:00:00.000Z', actor_label: 'ops_agent' }],
    upcoming_deadlines: [],
    health_summary: { level: 'green', delivery_confidence: 84, approval_lag_hours: 2, renewal_likelihood: 78 },
  })),
  getClientPulse: vi.fn(async () => ({
    business_snapshot: { offer: 'Revenue OS', audience: 'Ops leaders', positioning: 'Direct', current_objective: 'Increase conversions', constraints: [] },
    brand_voice: { summary: 'Direct and clear', do_not_say: [], preferred_phrases: [], tone_notes: [] },
    competitor_signals: [],
    project_context: { active_campaigns: [], linked_deliverables: [], source_links: [], supporting_documents: [] },
    missing_info: [],
    memory_facts: [{ id: 'm1', label: 'Offer', value: 'Revenue OS', source: 'manual' }],
    risks_and_opportunities: [],
  })),
  getClientPlan: vi.fn(async () => ({
    board: {
      backlog: [{ id: 'task-1', title: 'Backlog task', description: 'desc', status: 'backlog', priority: 'medium', owner_type: 'agent', owner_label: 'planner_agent', due_at: null, blocked_by_ids: [], unlocks_ids: [], approval_required: false, estimated_minutes: null }],
      this_week: [],
      today: [{ id: 'task-2', title: 'Today task', description: 'desc', status: 'today', priority: 'high', owner_type: 'agent', owner_label: 'ops_agent', due_at: null, blocked_by_ids: [], unlocks_ids: [], approval_required: true, estimated_minutes: null }],
      waiting: [],
      done: [],
    },
    dependencies: [{ task_id: 'task-2', blocked_by_ids: [], unlocks_ids: [] }],
    capacity: [{ owner_label: 'ops_agent', owner_type: 'agent', load_percent: 50, overloaded: false }],
    approval_needed: [{ id: 'task-2', title: 'Today task', description: 'desc', status: 'today', priority: 'high', owner_type: 'agent', owner_label: 'ops_agent', due_at: null, blocked_by_ids: [], unlocks_ids: [], approval_required: true, estimated_minutes: null }],
  })),
  getClientApprovals: vi.fn(async () => ({
    needs_review: [{ id: 'a1', linked_task_id: 'task-2', title: 'Needs review', reason: 'Review send', approval_type: 'send', status: 'needs_review', requested_by: 'ops_agent', created_at: '2025-01-03T10:00:00.000Z', preview_text: 'Preview', tools_involved: [] }],
    approved: [],
    rejected: [],
    changes_requested: [],
    execution_queue: [{ id: 'task-2', title: 'Today task', status: 'ready', source_approval_id: 'a1' }],
    approval_rules: [{ key: 'send', enabled: true }],
  })),
  getClientResults: vi.fn(async () => ({
    delivered_outputs: [{ id: 'r1', title: 'Weekly summary', type: 'report', status: 'ready', completed_at: '2025-01-03T10:00:00.000Z', url: null, summary: 'Summary' }],
    performance_summary: { metrics: [{ label: 'Completed outputs', value: '1', delta_label: null }] },
    lessons_learned: [],
    feedback: [],
    next_best_actions: [],
    weekly_review: { completed_count: 1, slipped_count: 0, summary: 'Solid week' },
    case_study_candidates: [],
  })),
}));

vi.mock('../[clientId]/lib/client-actions', () => ({
  approveClientTask: vi.fn(async () => ({ ok: true })),
  rejectClientTask: vi.fn(async () => ({ ok: true })),
  requestTaskChanges: vi.fn(async () => ({ ok: true })),
  assignClientTask: vi.fn(async () => ({ ok: true })),
  moveClientTask: vi.fn(async () => ({ ok: true })),
  runApprovedClientTask: vi.fn(async () => ({ ok: true })),
  draftClientUpdate: vi.fn(async () => ({ title: 'Update', markdown: 'Client update markdown' })),
}));

import ClientHomePage from '../[clientId]/page';
import ClientPulsePage from '../[clientId]/pulse/page';
import ClientPlanPage from '../[clientId]/plan/page';
import ClientApprovalsPage from '../[clientId]/approvals/page';
import ClientResultsPage from '../[clientId]/results/page';

describe('client route smoke renders', () => {
  const params = Promise.resolve({ clientId: 'client-1' });

  it('renders the home page', async () => {
    render(<ClientHomePage params={params} />);
    await waitFor(() => expect(screen.getByText('Client alignment')).toBeInTheDocument());
  });

  it('renders the pulse page', async () => {
    render(<ClientPulsePage params={params} />);
    await waitFor(() => expect(screen.getByText('Business snapshot')).toBeInTheDocument());
  });

  it('renders the plan page', async () => {
    render(<ClientPlanPage params={params} />);
    await waitFor(() => expect(screen.getByText('Weekly plan board')).toBeInTheDocument());
  });

  it('renders the approvals page', async () => {
    render(<ClientApprovalsPage params={params} />);
    await waitFor(() => expect(screen.getByText('Approval queue board')).toBeInTheDocument());
  });

  it('renders the results page', async () => {
    render(<ClientResultsPage params={params} />);
    await waitFor(() => expect(screen.getByText('Delivered outputs')).toBeInTheDocument());
  });
});