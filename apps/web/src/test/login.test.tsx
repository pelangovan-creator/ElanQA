import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { Login } from '../pages/Login';

describe('Login', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has labelled fields and shows the server error accessibly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'Invalid email or password' }), { status: 401, headers: { 'content-type': 'application/json' } }));
    render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Login /></AuthProvider></QueryClientProvider>);
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.c');
    await userEvent.type(screen.getByLabelText(/password/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('stores the token on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ token: 'jwt', user: { id: '1', email: 'a@b.c', name: 'A', role: 'Tester' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Login /></AuthProvider></QueryClientProvider>);
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.c');
    await userEvent.type(screen.getByLabelText(/password/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await vi.waitFor(() => expect(localStorage.getItem('qapilot.token')).toBe('jwt'));
  });
});
