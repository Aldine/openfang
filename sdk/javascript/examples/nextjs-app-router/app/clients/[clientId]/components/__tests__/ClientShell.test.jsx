import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClientShell from '../ClientShell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/clients/client-1/approvals',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

describe('ClientShell', () => {
  it('marks the active nav item and shows shell stats', () => {
    render(
      <ClientShell
        clientId="client-1"
        clientName="Acme Co"
        currentPage="approvals"
        approvalsWaiting={2}
        tasksDueToday={3}
        lastActivityAt="2025-01-03T10:00:00.000Z"
        health="yellow"
      >
        <div>body</div>
      </ClientShell>,
    );

    expect(screen.getByRole('heading', { name: 'Acme Co' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Approvals and Execution/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Approvals waiting')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});