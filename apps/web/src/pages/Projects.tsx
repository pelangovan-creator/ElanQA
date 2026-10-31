import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { ROLE_LABEL, type ProjectSummary } from '../lib/types';
import { Alert, Badge, Button, Card, Field, PageHeader, Table } from '../components/ui';

export function Projects() {
  const { user } = useAuth();
  const { projects, setCurrentId } = useProject();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState<'new' | 'restore' | null>(null);
  const canCreate = user?.role === 'Admin' || user?.role === 'QALead';

  const open = (p: ProjectSummary) => { setCurrentId(p.id); navigate('/'); };

  return (
    <>
      <PageHeader title="Projects" subtitle="Each client engagement is a separate project with its own team, artefacts and defects."
        actions={canCreate && <div className="flex gap-2">
          <Button variant="secondary" aria-expanded={showForm === 'restore'} onClick={() => setShowForm((s) => (s === 'restore' ? null : 'restore'))}>{showForm === 'restore' ? 'Cancel restore' : 'Restore from backup'}</Button>
          <Button aria-expanded={showForm === 'new'} onClick={() => setShowForm((s) => (s === 'new' ? null : 'new'))}>{showForm === 'new' ? 'Cancel' : 'New project'}</Button>
        </div>} />
      {showForm === 'new' && <NewProjectForm onDone={(p) => { setShowForm(null); open(p); }} />}
      {showForm === 'restore' && <RestoreForm onOpen={(p) => { setShowForm(null); open(p); }} />}
      <Card>
        {projects.length === 0 ? <p className="text-sm text-slate-600">No projects yet.</p> : (
          <Table head={['Key', 'Name', 'Client', 'Status', 'My role', 'Members', '']} caption="Projects">
            {projects.map((p) => (
              <tr key={p.id}>
                <td className="px-2 py-2 font-mono">{p.key}</td>
                <td className="px-2 py-2">{p.name}</td>
                <td className="px-2 py-2">{p.client ?? '—'}</td>
                <td className="px-2 py-2"><Badge color={p.status === 'Active' ? 'green' : 'gray'}>{p.status}</Badge></td>
                <td className="px-2 py-2">{p.myRole ? ROLE_LABEL[p.myRole] : '—'}</td>
                <td className="px-2 py-2">{p.memberCount}</td>
                <td className="px-2 py-2 text-right"><Button variant="secondary" onClick={() => open(p)}>Open<span className="sr-only"> {p.name}</span></Button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function NewProjectForm({ onDone }: { onDone: (p: ProjectSummary) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: '', name: '', client: '', description: '' });
  const m = useMutation({
    mutationFn: () => api<ProjectSummary>('/projects', { method: 'POST', json: { ...form, client: form.client || undefined, description: form.description || undefined } }),
    onSuccess: async (p) => { await qc.invalidateQueries({ queryKey: ['projects'] }); onDone(p); },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: k === 'key' ? e.target.value.toUpperCase() : e.target.value });
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };

  return (
    <Card title="New project" className="mb-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {m.error && <div className="md:col-span-2"><Alert>{m.error.message}</Alert></div>}
        <Field label="Project key" required value={form.key} onChange={set('key')} maxLength={10} hint="2–10 capitals/digits, e.g. SHOP. Used in IDs." />
        <Field label="Project name" required value={form.name} onChange={set('name')} />
        <Field label="Client" value={form.client} onChange={set('client')} />
        <Field label="Description" value={form.description} onChange={set('description')} />
        <div className="md:col-span-2"><Button type="submit" disabled={m.isPending}>Create project</Button></div>
      </form>
    </Card>
  );
}

interface RestoreResult { project: ProjectSummary; counts: Record<string, number>; files: number; warnings: string[] }

/** Restores a "full project backup" ZIP as a new project (new key); the original is never touched. */
function RestoreForm({ onOpen }: { onOpen: (p: ProjectSummary) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const restore = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('key', key);
      if (name.trim()) fd.append('name', name.trim());
      fd.append('file', file!);
      return api<RestoreResult>('/projects/restore', { method: 'POST', body: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
  const r = restore.data;
  const submit = (e: FormEvent) => { e.preventDefault(); restore.mutate(); };
  return (
    <Card title="Restore from backup" className="mb-6">
      {r ? (
        <div className="flex flex-col gap-3">
          <Alert kind="success">Restored <strong>{r.project.key} – {r.project.name}</strong>: {r.counts.RequirementItem ?? 0} requirements, {r.counts.TestCase ?? 0} test cases, {r.counts.TestRun ?? 0} runs, {r.counts.Defect ?? 0} defects, {r.counts.Report ?? 0} reports and {r.files} files.</Alert>
          {r.warnings.length > 0 && <Alert kind="info"><p className="font-semibold">Check these:</p><ul className="list-disc pl-5">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
          <div><Button onClick={() => onOpen(r.project)}>Open {r.project.key}</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <p className="text-sm text-slate-700 md:col-span-3">Choose a <em>full project backup</em> (.zip, from a project's Overview page). It is restored as a <strong>new project</strong> with all requirements, test design, runs, evidence, defects, reports and audit history; the original project is not changed. Team members are matched by e-mail.</p>
          {restore.error && <div className="md:col-span-3"><Alert>{restore.error.message}</Alert></div>}
          <div className="flex flex-col gap-1">
            <label htmlFor="restore-file" className="text-sm font-medium text-slate-800">Backup file<span aria-hidden="true" className="text-red-700"> *</span></label>
            <input id="restore-file" type="file" accept=".zip,application/zip" required className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Field label="New project key" required value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} pattern="[A-Z][A-Z0-9]{1,9}" hint="2–10 letters/digits; must not be in use" />
          <Field label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} hint="Default: original name + (restored)" />
          <div className="md:col-span-3"><Button type="submit" disabled={restore.isPending || !file}>{restore.isPending ? 'Restoring…' : 'Restore'}</Button></div>
        </form>
      )}
    </Card>
  );
}
