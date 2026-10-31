import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download } from '../lib/api';
import { useProject } from '../lib/project';
import { ROLE_LABEL, ROLES, type Role } from '../lib/types';
import { Alert, Button, Card, Field, PageHeader, Select, Table } from '../components/ui';
import { LatestAlertCard } from './Monitoring';

const STLC = [
  ['Requirement analysis', 'Upload BRD/SRS, zero-miss extraction, coverage & RTM', '/requirements'],
  ['Test design', 'Clarifications, scenarios, test cases, techniques, plan, data', '/artefacts'],
  ['Test execution', 'Playwright automation and guided manual runs', '/execution'],
  ['Defect management', 'Auto-defects with screenshots, evidence and a step-by-step Jira guide', '/defects'],
  ['Monitoring & reporting', 'Morning / evening defect checks, DSR, WSR, defect report, dashboard', '/reports'],
  ['Test closure', 'Closure report with open-defect risk assessment', '/closure'],
] as const;

export function Overview() {
  const { current, can } = useProject();
  if (!current) return <><PageHeader title="Welcome to QA Pilot" /><Card><p className="text-sm">You are not a member of any project yet. <Link className="text-brand-700 underline" to="/projects">Go to projects</Link>.</p></Card></>;

  return (
    <>
      <PageHeader title={current.name} subtitle={`${current.key} · ${current.client ?? 'No client'} · ${current.status}`}
        actions={can('project.export') && <Button variant="secondary" onClick={() => download(`/projects/${current.id}/export`, `${current.key}-backup.zip`)}>Export full project backup</Button>} />
      <LatestAlertCard />
      <Card title="Life cycle" className="mb-6">
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {STLC.map(([t, d, to], i) => (
            <li key={t} className="rounded-md border border-slate-200 p-3">
              <p className="text-sm font-semibold">{i + 1}. {t}</p>
              <p className="text-xs text-slate-600">{d}</p>
              <p className="mt-2"><Link to={to} className="text-sm text-brand-700 underline">Open<span className="sr-only"> {t}</span></Link></p>
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {can('project.manage') && <ProjectDetailsForm />}
        <Members />
        {can('project.manage') && <Settings />}
      </div>
    </>
  );
}

function ProjectDetailsForm() {
  const { current } = useProject();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: current!.name, client: current!.client ?? '', description: current!.description ?? '', status: current!.status });
  const m = useMutation({
    mutationFn: () => api(`/projects/${current!.id}`, { method: 'PATCH', json: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project'] }); qc.invalidateQueries({ queryKey: ['projects'] }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };
  return (
    <Card title="Project details">
      <form onSubmit={submit} className="space-y-3">
        {m.error && <Alert>{m.error.message}</Alert>}
        {m.isSuccess && <Alert kind="success">Saved.</Alert>}
        <Field label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label="Client" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
        <Field label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          {['Active', 'OnHold', 'Closed', 'Archived'].map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Button type="submit" disabled={m.isPending}>Save</Button>
      </form>
    </Card>
  );
}

function Members() {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const manage = can('project.manage');
  const dir = useQuery({ queryKey: ['directory'], queryFn: () => api<{ id: string; name: string; role: Role }[]>('/users/directory'), enabled: manage });
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<Role>('Tester');
  const refresh = () => qc.invalidateQueries({ queryKey: ['project'] });
  const add = useMutation({ mutationFn: () => api(`/projects/${current!.id}/members`, { method: 'POST', json: { userId, role } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (uid: string) => api(`/projects/${current!.id}/members/${uid}`, { method: 'DELETE' }), onSuccess: refresh });
  const memberIds = new Set(current!.members.map((m) => m.user.id));

  return (
    <Card title="Team">
      {(add.error || remove.error) && <Alert>{(add.error ?? remove.error)!.message}</Alert>}
      <Table head={['Name', 'Email', 'Project role', ...(manage ? [''] : [])]} caption="Project members">
        {current!.members.map((m) => (
          <tr key={m.id}>
            <td className="px-2 py-2">{m.user.name}</td>
            <td className="px-2 py-2">{m.user.email}</td>
            <td className="px-2 py-2">{ROLE_LABEL[m.role]}</td>
            {manage && <td className="px-2 py-2 text-right"><Button variant="ghost" onClick={() => remove.mutate(m.user.id)}>Remove<span className="sr-only"> {m.user.name}</span></Button></td>}
          </tr>
        ))}
      </Table>
      {manage && (
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (userId) add.mutate(); }}>
          <Select label="Add user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Select…</option>
            {dir.data?.filter((u) => !memberIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
          <Button type="submit" disabled={!userId}>Add</Button>
        </form>
      )}
    </Card>
  );
}

function Settings() {
  const { current } = useProject();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', current!.id], queryFn: () => api<{ key: string; value: string; encrypted: boolean }[]>(`/projects/${current!.id}/settings`) });
  const [form, setForm] = useState({ key: '', value: '', encrypted: true });
  const m = useMutation({
    mutationFn: () => api(`/projects/${current!.id}/settings`, { method: 'PUT', json: form }),
    onSuccess: () => { setForm({ key: '', value: '', encrypted: true }); qc.invalidateQueries({ queryKey: ['settings'] }); },
  });
  return (
    <Card title="Project settings & secrets">
      <p className="mb-3 text-xs text-slate-600">Secrets (Jira token, test credentials, webhooks) are AES-256-GCM encrypted at rest and only shown masked.</p>
      {m.error && <Alert>{m.error.message}</Alert>}
      <Table head={['Key', 'Value', 'Encrypted']} caption="Project settings">
        {q.data?.map((s) => <tr key={s.key}><td className="px-2 py-2 font-mono text-xs">{s.key}</td><td className="px-2 py-2 font-mono text-xs">{s.value}</td><td className="px-2 py-2">{s.encrypted ? 'Yes' : 'No'}</td></tr>)}
      </Table>
      <form className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Key" required value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="jira.apiToken" />
        <Field label="Value" required type={form.encrypted ? 'password' : 'text'} autoComplete="off" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.encrypted} onChange={(e) => setForm({ ...form, encrypted: e.target.checked })} /> Encrypt value</label>
        <div><Button type="submit" disabled={m.isPending}>Save setting</Button></div>
      </form>
    </Card>
  );
}
