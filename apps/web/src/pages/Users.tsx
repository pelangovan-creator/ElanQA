import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ROLE_LABEL, ROLES, type Role, type User } from '../lib/types';
import { Alert, Badge, Button, Card, Field, PageHeader, Select, Table } from '../components/ui';

export function Users() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const [form, setForm] = useState({ name: '', email: '', role: 'Tester' as Role, password: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({ mutationFn: () => api('/users', { method: 'POST', json: form }), onSuccess: () => { setForm({ name: '', email: '', role: 'Tester', password: '' }); refresh(); } });
  const update = useMutation({ mutationFn: ({ id, ...data }: { id: string; role?: Role; active?: boolean }) => api(`/users/${id}`, { method: 'PATCH', json: data }), onSuccess: refresh });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };

  return (
    <>
      <PageHeader title="Users" subtitle="Global accounts and default roles. Project roles can be overridden on each project's Team card." />
      <Card title="Add user" className="mb-6">
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
          {create.error && <div className="md:col-span-4"><Alert>{create.error.message}</Alert></div>}
          <Field label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
          <Field label="Initial password" type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint="8+ chars, upper, lower, digit, symbol" />
          <div className="md:col-span-4"><Button type="submit" disabled={create.isPending}>Create user</Button></div>
        </form>
      </Card>
      <Card>
        {update.error && <Alert>{update.error.message}</Alert>}
        <Table head={['Name', 'Email', 'Role', 'Status', 'Last login', '']} caption="Users">
          {q.data?.map((u) => (
            <tr key={u.id}>
              <td className="px-2 py-2">{u.name}</td>
              <td className="px-2 py-2">{u.email}</td>
              <td className="px-2 py-2">
                <label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.name}</label>
                <select id={`role-${u.id}`} className="rounded border border-slate-300 px-1 py-1 text-sm" value={u.role} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </td>
              <td className="px-2 py-2"><Badge color={u.active ? 'green' : 'gray'}>{u.active ? 'Active' : 'Disabled'}</Badge></td>
              <td className="px-2 py-2 text-xs">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
              <td className="px-2 py-2 text-right"><Button variant="ghost" onClick={() => update.mutate({ id: u.id, active: !u.active })}>{u.active ? 'Disable' : 'Enable'}<span className="sr-only"> {u.name}</span></Button></td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
