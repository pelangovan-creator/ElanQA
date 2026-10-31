import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/auth';
import { Account } from '../pages/Account';
import { useShowMore } from '../components/ui';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ME = { id: '1', email: 'a@b.c', name: 'Asha', role: 'Tester' };

function renderAccount() {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AuthProvider><Account /></AuthProvider></MemoryRouter></QueryClientProvider>);
}

describe('My account', () => {
  beforeEach(() => localStorage.setItem('qapilot.token', 'old-token'));
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('changes the password and keeps this session on the fresh token', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).endsWith('/auth/me') ? json(ME) : json({ ok: true, token: 'new-token' }));
    renderAccount();
    await userEvent.type(await screen.findByLabelText(/current password/i), 'Old-Passw0rd!');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'N3w-Passw0rd!');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'N3w-Passw0rd!');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/signed out on every other device/i);
    expect(localStorage.getItem('qapilot.token')).toBe('new-token');
    const call = fetch.mock.calls.find(([u]) => String(u).endsWith('/auth/change-password'))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ currentPassword: 'Old-Passw0rd!', newPassword: 'N3w-Passw0rd!' });
  });

  it('flags mismatched passwords accessibly and does not submit', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(ME));
    renderAccount();
    await userEvent.type(await screen.findByLabelText(/^new password/i), 'N3w-Passw0rd!');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'different');
    const confirm = screen.getByLabelText(/confirm new password/i);
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(confirm).toHaveAccessibleDescription('The passwords do not match');
    expect(screen.getByRole('button', { name: /change password/i })).toBeDisabled();
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/auth/change-password'))).toBe(false);
  });
});

function List({ n }: { n: number }) {
  const rows = Array.from({ length: n }, (_, i) => `row ${i + 1}`);
  const page = useShowMore(rows, 100);
  return <><ul>{page.visible.map((r) => <li key={r}>{r}</li>)}</ul>{page.more}</>;
}

describe('useShowMore', () => {
  it('renders long lists in pages of 100', async () => {
    render(<List n={250} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 100 of 250');
    await userEvent.click(screen.getByRole('button', { name: 'Show 100 more' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(200);
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(250);
    expect(screen.queryByRole('button', { name: /show/i })).not.toBeInTheDocument();
  });
  it('shows no control for short lists', () => {
    render(<List n={20} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
