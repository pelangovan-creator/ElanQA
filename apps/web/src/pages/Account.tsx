import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/types';
import { Alert, Button, Card, Field, PageHeader } from '../components/ui';

/** The signed-in user's own account: change password, sign out on every device. */
export function Account() {
  const { user, logout } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [done, setDone] = useState(false);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.newPassword;

  const change = useMutation({
    mutationFn: () => api<{ ok: true; token: string }>('/auth/change-password', { method: 'POST', json: { currentPassword: form.currentPassword, newPassword: form.newPassword } }),
    // Other sessions are signed out by the server; this one continues with the fresh token.
    onSuccess: (r) => { tokenStore.set(r.token); setForm({ currentPassword: '', newPassword: '', confirm: '' }); setDone(true); },
  });
  const everywhere = useMutation({ mutationFn: () => api('/auth/logout-all', { method: 'POST' }), onSuccess: logout });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!mismatch) { setDone(false); change.mutate(); } };

  return (
    <>
      <PageHeader title="My account" subtitle={`${user?.name} · ${user?.email} · ${user ? ROLE_LABEL[user.role] : ''}`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Change password">
          <form onSubmit={submit} className="flex flex-col gap-3">
            {change.error && <Alert>{change.error.message}</Alert>}
            {done && <Alert kind="success">Password changed. You have been signed out on every other device.</Alert>}
            <Field label="Current password" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
            <Field label="New password" type="password" autoComplete="new-password" required minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} hint="8+ characters with upper and lower case, a digit and a symbol" />
            <Field label="Confirm new password" type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={mismatch ? 'The passwords do not match' : undefined} />
            <div><Button type="submit" disabled={change.isPending || mismatch}>Change password</Button></div>
          </form>
        </Card>
        <Card title="Sessions">
          <p className="mb-3 text-sm text-slate-700">Signed in on a shared or lost device? Sign out everywhere ends every session, including this one.</p>
          {everywhere.error && <Alert>{everywhere.error.message}</Alert>}
          <Button variant="danger" onClick={() => everywhere.mutate()} disabled={everywhere.isPending}>Sign out everywhere</Button>
        </Card>
      </div>
    </>
  );
}
