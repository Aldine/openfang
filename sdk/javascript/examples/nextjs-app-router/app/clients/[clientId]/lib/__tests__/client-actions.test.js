import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../lib/command-center-api', () => ({
  approveTask: vi.fn(),
  runTask: vi.fn(),
  getClient: vi.fn(),
  getTasks: vi.fn(),
  getApprovals: vi.fn(),
  getResults: vi.fn(),
}));

import {
  approveClientTask,
  assignClientTask,
  draftClientUpdate,
  moveClientTask,
  rejectClientTask,
  requestTaskChanges,
  runApprovedClientTask,
} from '../client-actions';
import {
  approveTask,
  getApprovals,
  getClient,
  getResults,
  getTasks,
  runTask,
} from '../../../../../lib/command-center-api';

describe('client-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('routes approve and run through existing command-center helpers', async () => {
    approveTask.mockResolvedValue({ ok: true });
    runTask.mockResolvedValue({ ok: true });

    await approveClientTask('task-1');
    await runApprovedClientTask('task-1');

    expect(approveTask).toHaveBeenCalledWith('task-1');
    expect(runTask).toHaveBeenCalledWith('task-1');
  });

  it('posts approval actions to the live task mutation routes', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await rejectClientTask('task-2');
    await requestTaskChanges('task-3');

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/tasks/task-2/reject', { method: 'POST' });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/tasks/task-3/request-changes', { method: 'POST' });
  });

  it('patches assignment and board movement through the shared task route', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ task: { id: 'task-4' } }) });

    await assignClientTask('task-4', 'ops_agent');
    await moveClientTask('task-4', 'today');

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/tasks/task-4',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ assigned_agent: 'ops_agent' }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/tasks/task-4',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ board_column: 'today' }),
      }),
    );
  });

  it('drafts a client update from live client, task, approval, and result data', async () => {
    getClient.mockResolvedValue({
      client: {
        business_name: 'Acme Co',
        main_goal: 'Increase conversions',
      },
    });
    getTasks.mockResolvedValue({
      tasks: [
        { title: 'Run nurture sequence', assigned_agent: 'ops_agent', status: 'approved' },
      ],
    });
    getApprovals.mockResolvedValue({
      approvals: [
        { status: 'pending', preview_summary: 'Approve email send' },
      ],
    });
    getResults.mockResolvedValue({
      results: [
        { status: 'completed', title: 'Weekly summary' },
      ],
    });

    const draft = await draftClientUpdate('client-1');

    expect(draft.title).toContain('Acme Co');
    expect(draft.markdown).toContain('Weekly summary');
    expect(draft.markdown).toContain('Run nurture sequence');
    expect(draft.markdown).toContain('Approve email send');
  });
});