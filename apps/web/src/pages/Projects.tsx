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
  const [showForm, setShowForm] = useState(false);
  const canCreate = user?.role === 'Admin' || user?.role === 'QALead';

  const open = (p: ProjectSummary) => { setCurrentId(p.id); navigate('/'); };

  return (
    <>
      <PageHeader title="Projects" subtitle="Each client engagement is a separate project with its own team, artefacts and defects."
        actions={canCreate && <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : 'New project'}</Button>} />
      {showForm && <NewProjectForm onDone={(p) => { setShowForm(false); open(p); }} />}
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
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
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
