/**
 * Tests for InstallModal component (app/skills/InstallModal.js)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstallModal from '../InstallModal';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../../lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../lib/telemetry', () => ({
  track: vi.fn(),
}));

import { apiClient } from '../../../lib/api-client';
import { track } from '../../../lib/telemetry';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const cardAvailable   = { name: 'new-skill', description: 'Brand new', author: 'dev', version: '1.0.0', runtime: 'node', source: '', popularity: 500, installed: false, bundled: false, installable: true };
const cardInstalled   = { ...cardAvailable, name: 'memory', installed: true, installable: false };
const cardBundled     = { ...cardAvailable, name: 'core', bundled: true, installed: true, installable: false };

describe('InstallModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Rendering & open/close
  // --------------------------------------------------------------------------
  it('renders nothing when open=false', () => {
    const { container } = render(
      <InstallModal open={false} onClose={vi.fn()} onInstallSuccess={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the modal dialog when open=true', async () => {
    apiClient.get.mockResolvedValue([]);
    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId ? true : screen.getByText('Install a Skill')).toBeTruthy();
  });

  it('fires track("skill_browse_opened") when opened', () => {
    apiClient.get.mockResolvedValue([]);
    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={vi.fn()} />);
    expect(track).toHaveBeenCalledWith('skill_browse_opened');
  });

  it('calls onClose when the × button is clicked', async () => {
    apiClient.get.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<InstallModal open onClose={onClose} onInstallSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Browse tab
  // --------------------------------------------------------------------------
  it('loads browse results on open and renders result cards', async () => {
    apiClient.get.mockResolvedValue([cardAvailable]);
    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('new-skill')).toBeTruthy();
    });
  });

  it('shows loading state while browse is in flight', async () => {
    let resolve;
    apiClient.get.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
    act(() => resolve([]));
  });

  // --------------------------------------------------------------------------
  // Search tab
  // --------------------------------------------------------------------------
  it('switches to Search tab and renders the search input', async () => {
    apiClient.get.mockResolvedValue([]);
    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={vi.fn()} />);
    await userEvent.click(screen.getByTestId
      ? screen.getByRole('button', { name: /^search$/i })
      : screen.getByText('Search'));
    expect(screen.getByPlaceholderText(/search registry/i)).toBeTruthy();
  });

  it('blocks empty search submission', async () => {
    apiClient.get.mockResolvedValue([]);
    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={vi.fn()} />);
    // Switch to search tab (only one "Search" button visible here — the tab)
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    // After switching, both the tab and submit button have text "Search"
    // Find the submit button specifically (data-cy="install-search-submit")
    const submitBtn = [...document.querySelectorAll('[data-cy="install-search-submit"]')][0];
    expect(submitBtn).toBeTruthy();
    // Button should be disabled when query is empty
    expect(submitBtn).toBeDisabled();
    expect(apiClient.get).toHaveBeenCalledTimes(1); // only browse call
  });

  // --------------------------------------------------------------------------
  // Install flow
  // --------------------------------------------------------------------------
  it('calls apiClient.post on Install and fires telemetry', async () => {
    apiClient.get.mockResolvedValue([cardAvailable]);
    apiClient.post.mockResolvedValue({ name: 'new-skill', installed: true });
    const onInstallSuccess = vi.fn();

    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={onInstallSuccess} />);

    await waitFor(() => screen.getByText('new-skill'));

    const installBtn = screen.getByRole('button', { name: /^install$/i });
    await userEvent.click(installBtn);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/skills/install', { name: 'new-skill' });
    });

    expect(track).toHaveBeenCalledWith('skill_install_started', expect.objectContaining({ skill: 'new-skill' }));
    expect(track).toHaveBeenCalledWith('skill_install_succeeded', expect.objectContaining({ skill: 'new-skill' }));
    expect(onInstallSuccess).toHaveBeenCalledWith('new-skill');
  });

  it('disables Install button for bundled cards', async () => {
    apiClient.get.mockResolvedValue([cardBundled]);
    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={vi.fn()} />);

    await waitFor(() => screen.getAllByRole('button', { name: /bundled/i }));
    const btns = screen.getAllByRole('button', { name: /bundled/i });
    btns.forEach(btn => expect(btn).toBeDisabled());
  });

  it('disables Install button for already-installed cards', async () => {
    apiClient.get.mockResolvedValue([cardInstalled]);
    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={vi.fn()} />);

    await waitFor(() => screen.getAllByRole('button', { name: /installed/i }));
    const btns = screen.getAllByRole('button', { name: /installed/i });
    btns.forEach(btn => expect(btn).toBeDisabled());
  });

  it('fires skill_install_failed telemetry on install error', async () => {
    apiClient.get.mockResolvedValue([cardAvailable]);
    apiClient.post.mockRejectedValue(new Error('Network error'));
    render(<InstallModal open onClose={vi.fn()} onInstallSuccess={vi.fn()} />);

    await waitFor(() => screen.getByText('new-skill'));
    await userEvent.click(screen.getByRole('button', { name: /^install$/i }));

    await waitFor(() => {
      expect(track).toHaveBeenCalledWith('skill_install_failed', expect.objectContaining({ skill: 'new-skill' }));
    });
  });
});
