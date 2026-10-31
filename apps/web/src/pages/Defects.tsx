import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useBlobUrl } from '../lib/blob';
import { useProject } from '../lib/project';
import {
  DEFECT_STATUS_LABEL, DEFECT_STATUSES, DEFECT_TYPES, isHighImpact, PRIORITIES, PRIORITY_DEF, SEVERITIES, SEVERITY_DEF, type Defect,
} from '../lib/types';
import { Alert, Badge, Button, Card, Field, PageHeader, Select, Table, useShowMore } from '../components/ui';
import { Tooltip } from '../components/Tooltip';
import { Tabs } from '../components/Tabs';
import { ExportButtons } from './artefacts/shared';

export const dbase = (projectId: string) => `/projects/${projectId}/defects`;
export const SEV_COLOR: Record<string, 'red' | 'amber' | 'blue' | 'gray'> = { Blocker: 'red', Critical: 'red', Major: 'amber', Minor: 'blue', Trivial: 'gray' };
export const PRI_COLOR: Record<string, 'red' | 'amber' | 'blue' | 'gray'> = { P1: 'red', P2: 'amber', P3: 'blue', P4: 'gray' };

export function SeverityBadge({ s }: { s: string }) {
  return <Tooltip tip={`${s}: ${SEVERITY_DEF[s] ?? ''}`} label={`Severity ${s}`}><Badge color={SEV_COLOR[s]}>{s}</Badge></Tooltip>;
}
export function PriorityBadge({ p }: { p: string }) {
  return <Tooltip tip={`${p}: ${PRIORITY_DEF[p] ?? ''}`} label={`Priority ${p}`}><Badge color={PRI_COLOR[p]}>{p}</Badge></Tooltip>;
}

type Tab = 'defects' | 'drafts';

export function Defects() {
  const { current, can } = useProject();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('run') ? 'drafts' : 'defects');
  const [creating, setCreating] = useState(false);
  const drafts = useQuery({ queryKey: ['defects', current?.id, 'drafts', params.get('run')], queryFn: () => api<Defect[]>(`${dbase(current!.id)}?draft=true${params.get('run') ? `&run=${params.get('run')}` : ''}`), enabled: !!current });
  if (!current) return null;
  return (
    <>
      <PageHeader title="Defects" subtitle="Failed tests create draft defects with screenshots, video, trace and logs. Review drafts, then manage each defect through its life cycle."
        actions={<>{can('defects.create') && <Button onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : 'Log a defect'}</Button>}</>} />
      {creating && <NewDefect onDone={() => setCreating(false)} />}
      <details className="mb-4 rounded border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Severity & priority definitions</summary>
        <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
          <dl>{SEVERITIES.map((s) => <div key={s}><dt className="inline font-semibold">{s}: </dt><dd className="inline">{SEVERITY_DEF[s]}</dd></div>)}</dl>
          <dl>{PRIORITIES.map((p) => <div key={p}><dt className="inline font-semibold">{p}: </dt><dd className="inline">{PRIORITY_DEF[p]}</dd></div>)}</dl>
        </div>
      </details>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'defects', label: 'Defects' },
        { id: 'drafts', label: <>Drafts to review {drafts.data && drafts.data.length > 0 && <Badge color="amber">{drafts.data.length}</Badge>}</> },
      ]}>
        {tab === 'defects' ? <DefectList /> : <DraftList rows={drafts.data ?? []} run={params.get('run')} />}
      </Tabs>
    </>
  );
}

function DefectList() {
  const { current } = useProject();
  const [f, setF] = useState({ q: '', status: '', severity: '', priority: '', module: '', openOnly: true });
  const qs = new URLSearchParams({ ...(f.q && { q: f.q }), ...(f.status && { status: f.status }), ...(f.severity && { severity: f.severity }), ...(f.priority && { priority: f.priority }), ...(f.module && { module: f.module }) });
  const q = useQuery({ queryKey: ['defects', current!.id, qs.toString()], queryFn: () => api<Defect[]>(`${dbase(current!.id)}?${qs}`) });
  const rows = (q.data ?? []).filter((d) => !f.openOnly || d.open);
  const modules = [...new Set((q.data ?? []).map((d) => d.module).filter(Boolean))] as string[];
  const critical = rows.filter((d) => d.open && isHighImpact(d)).length;
  const page = useShowMore(rows);
  return (
    <Card title={<>Defects ({rows.length}) {critical > 0 && <Badge color="red">{critical} open Blocker/Critical/P1</Badge>}</>} actions={<ExportButtons fullPath={`${dbase(current!.id)}/export`} name="Defect-List" />}>
      <form className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Filter defects">
        <Field label="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{DEFECT_STATUSES.map((s) => <option key={s} value={s}>{DEFECT_STATUS_LABEL[s]}</option>)}</Select>
        <Select label="Severity" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="">All</option>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">All</option>{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select label="Module" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })}><option value="">All</option>{modules.map((m) => <option key={m}>{m}</option>)}</Select>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.openOnly} onChange={(e) => setF({ ...f, openOnly: e.target.checked })} /> Open only</label>
      </form>
      <Table head={['ID', 'Title', 'Severity', 'Priority', 'Status', 'Module', 'Assigned to', 'Age (d)', 'Jira']} caption="Defects">
        {page.visible.map((d) => {
          const hot = d.open && isHighImpact(d);
          return (
            <tr key={d.id} className={hot ? 'bg-red-50 font-semibold text-red-900' : undefined}>
              <td className="whitespace-nowrap px-2 py-2 font-mono text-xs"><Link className="underline" to={`/defects/${d.id}`}>{d.defectId}</Link></td>
              <td className="px-2 py-2"><Link to={`/defects/${d.id}`} className="hover:underline">{d.title}</Link>{d.testCase && <span className="block text-xs font-normal text-slate-700">{d.testCase.tcId}{d.testRunId ? ` · ${d.testRunId}` : ''}</span>}</td>
              <td className="px-2 py-2"><SeverityBadge s={d.severity} /></td>
              <td className="px-2 py-2"><PriorityBadge p={d.priority} /></td>
              <td className="px-2 py-2 text-xs">{DEFECT_STATUS_LABEL[d.status] ?? d.status}</td>
              <td className="px-2 py-2 text-xs">{d.module ?? '—'}</td>
              <td className="px-2 py-2 text-xs">{d.assignedTo ?? '—'}</td>
              <td className="px-2 py-2 text-xs">{d.ageDays}</td>
              <td className="px-2 py-2 text-xs">{d.jiraKey ?? '—'}</td>
            </tr>
          );
        })}
      </Table>
      {page.more}
      {rows.length === 0 && <p className="mt-2 text-sm text-slate-600">No defects match.</p>}
    </Card>
  );
}

function DraftList({ rows, run }: { rows: Defect[]; run: string | null }) {
  return (
    <Card title={`Draft defects from test runs${run ? ` (${run})` : ''}`}>
      <p className="mb-3 text-sm text-slate-700">Each failed test case produced a draft with its evidence attached. Open a draft to check it, then confirm it, link it to an existing defect, or discard it.</p>
      {rows.length === 0 && <Alert kind="success">No drafts waiting for review.</Alert>}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((d) => (
          <li key={d.id} className={`flex gap-3 rounded border p-3 ${isHighImpact(d) ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
            <Thumb defect={d} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold"><Link className="hover:underline" to={`/defects/${d.id}`}>{d.defectId} · {d.title}</Link></p>
              <p className="mt-1 flex flex-wrap gap-1"><SeverityBadge s={d.severity} /><PriorityBadge p={d.priority} />{d.duplicateCandidates.length > 0 && <Badge color="amber">Possible duplicate of {d.duplicateCandidates[0].defectId}</Badge>}{!d.hasScreenshot && <Badge color="red">Screenshot missing</Badge>}</p>
              <p className="mt-1 line-clamp-2 text-xs text-slate-700">{d.actualResult}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Thumb({ defect }: { defect: Defect }) {
  const { current } = useProject();
  const url = useBlobUrl(defect.thumbnailId ? `/projects/${current!.id}/execution/attachments/${defect.thumbnailId}` : null);
  return url ? <img src={url} alt={`Screenshot for ${defect.defectId}`} className="h-24 w-36 flex-none rounded border border-slate-200 object-cover object-top" /> : <div className="h-24 w-36 flex-none rounded bg-slate-100" aria-hidden="true" />;
}

function NewDefect({ onDone }: { onDone: () => void }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({ title: '', module: '', severity: 'Major', priority: '', defectType: 'Functional', stepsToReproduce: '', expectedResult: '', actualResult: '', environment: '', build: '' });
  const m = useMutation({
    mutationFn: () => api<{ id: string }>(dbase(current!.id), { method: 'POST', json: { ...f, priority: f.priority || undefined } }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['defects'] }); onDone(); navigate(`/defects/${d.id}`); },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ta = (k: keyof typeof f, label: string) => (
    <div className="flex flex-col gap-1 md:col-span-2"><label htmlFor={`nd-${k}`} className="text-sm font-medium">{label}</label><textarea id={`nd-${k}`} rows={3} className="rounded border border-slate-400 p-2 text-sm" value={f[k]} onChange={set(k)} /></div>
  );
  return (
    <Card title="Log a defect" className="mb-4">
      <form className="grid grid-cols-1 gap-3 md:grid-cols-4" onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }}>
        <div className="md:col-span-3"><Field label="Title / summary" required minLength={5} value={f.title} onChange={set('title')} placeholder="[Checkout] Payment fails when card expiry is current month" /></div>
        <Field label="Module" value={f.module} onChange={set('module')} />
        <Select label="Severity" value={f.severity} onChange={set('severity')} aria-describedby="sev-help">{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select label="Priority" value={f.priority} onChange={set('priority')}><option value="">From severity</option>{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select label="Defect type" value={f.defectType} onChange={set('defectType')}>{DEFECT_TYPES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Field label="Build / version" value={f.build} onChange={set('build')} />
        <p id="sev-help" className="text-xs text-slate-600 md:col-span-4">{f.severity}: {SEVERITY_DEF[f.severity]}{f.priority && ` · ${f.priority}: ${PRIORITY_DEF[f.priority]}`}</p>
        {ta('stepsToReproduce', 'Steps to reproduce')}
        {ta('expectedResult', 'Expected result')}
        {ta('actualResult', 'Actual result')}
        <div className="md:col-span-2"><Field label="Environment" value={f.environment} onChange={set('environment')} /></div>
        {m.error && <div className="md:col-span-4"><Alert>{m.error.message}</Alert></div>}
        <div className="md:col-span-4"><Button type="submit" disabled={m.isPending}>Create defect</Button> <span className="text-xs text-slate-600">Attach screenshots on the next screen.</span></div>
      </form>
    </Card>
  );
}
