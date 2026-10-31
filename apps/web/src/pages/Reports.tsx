import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { DEFECT_STATUS_LABEL, isHighImpact } from '../lib/types';
import { Alert, Badge, Button, Card, Field, PageHeader, Table } from '../components/ui';
import { Tabs } from '../components/Tabs';
import { ExportButtons } from './artefacts/shared';
import { PriorityBadge, SeverityBadge } from './Defects';
import { download } from '../lib/api';

type ReportType = 'DSR' | 'WSR' | 'DefectReport';
type Tab = 'dashboard' | ReportType;
const rbase = (projectId: string) => `/projects/${projectId}/reports`;

interface DefectRow { id: string; defectId: string; title: string; severity: string; priority: string; status: string; module: string | null; assignedTo: string | null; ageDays: number; defectType: string; reportedDate: string; jiraKey: string | null }
interface Snapshot {
  period: { from: string; to: string; timeZone: string };
  execution: Record<string, number>; design: Record<string, number>; coverage: { percent: number; testCoveragePercent: number; unmapped: number; total: number };
  defects: { total: number; open: number; newInPeriod: number; closedInPeriod: number; reopenedInPeriod: number; drafts: number; reopenRate: number; rejectionRate: number; critical: DefectRow[]; list: DefectRow[]; byAssignee: Record<string, number>; byType: Record<string, number> };
  testers: { name: string; executed: number; passed: number; failed: number; blocked: number }[];
  openQuestions: { qId: string; question: string; priority: string; assignedTo: string | null; ageDays: number }[];
  moduleDensity: { module: string; testCases: number; defects: number; density: number }[];
}
interface Report {
  id: string; type: ReportType; title: string; status: 'Draft' | 'Final' | 'Sent'; updatedAt: string;
  content: { header: Record<string, string>; narrative: Record<string, string>; data: Snapshot; refreshedAt: string };
  charts: Record<string, string>; fields: { header: [string, string][]; narrative: [string, string][] }; derived: { leakagePct?: number | null };
}

export function Reports() {
  const { current } = useProject();
  const [tab, setTab] = useState<Tab>('dashboard');
  if (!current) return null;
  return (
    <>
      <PageHeader title="Reports & Dashboard" subtitle="Live KPIs, and Daily, Weekly and Defect reports filled in from project data - edit them, then export or e-mail." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'dashboard', label: 'Dashboard' }, { id: 'DSR', label: 'Daily (DSR)' }, { id: 'WSR', label: 'Weekly (WSR)' }, { id: 'DefectReport', label: 'Defect Report' }]}>
        {tab === 'dashboard' ? <Dashboard /> : <ReportsTab key={tab} type={tab} />}
      </Tabs>
    </>
  );
}

/** Server-rendered SVG (all text escaped server-side), shown inline so per-mark tooltips work; data shown as text too. */
export function Chart({ svg }: { svg: string }) {
  const title = /<title>([^<]*)<\/title>/.exec(svg)?.[1] ?? 'Chart';
  const desc = /<desc>([^<]*)<\/desc>/.exec(svg)?.[1] ?? '';
  const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return (
    <figure className="rounded-lg border border-slate-200 bg-[#fcfcfb] p-2">
      <div className="[&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">Data: {decode(title)}</summary><p className="mt-1">{decode(desc)}</p></details>
    </figure>
  );
}

function Kpi({ label, value, suffix = '', tone = 'plain', to }: { label: string; value: number | string; suffix?: string; tone?: 'plain' | 'red'; to?: string }) {
  const hot = tone === 'red' && Number(value) > 0;
  const body = <p className={`text-3xl ${hot ? 'font-extrabold text-red-800' : 'font-bold'}`}>{value}{suffix}</p>;
  return (
    <div className={`rounded-lg border p-4 ${hot ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs uppercase tracking-wide text-slate-600">{label}</p>
      {to ? <Link to={to} className="hover:underline">{body}</Link> : body}
    </div>
  );
}

function Dashboard() {
  const { current } = useProject();
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ['dashboard', current!.id, days], queryFn: () => api<{ data: Snapshot; charts: Record<string, string> }>(`${rbase(current!.id)}/dashboard?days=${days}`), refetchInterval: 60_000 });
  const d = q.data?.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Time range">
        <span className="text-sm text-slate-700">Trends for the last</span>
        {[7, 14, 30, 90].map((n) => <Button key={n} variant={n === days ? 'primary' : 'secondary'} aria-pressed={n === days} onClick={() => setDays(n)}>{n} days</Button>)}
        {d && <span className="text-xs text-slate-600">{d.period.from} – {d.period.to} ({d.period.timeZone}) · refreshes every minute</span>}
      </div>
      {!d && <p role="status">Loading…</p>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Requirement coverage" value={d.coverage.percent} suffix="%" to="/requirements" />
            <Kpi label="Execution" value={d.execution.executionPct} suffix="%" to="/execution" />
            <Kpi label="Pass rate" value={d.execution.passPct} suffix="%" />
            <Kpi label="Open defects" value={d.defects.open} to="/defects" />
            <Kpi label="Blocker / Critical / P1" value={d.defects.critical.length} tone="red" to="/monitoring" />
            <Kpi label="Drafts to review" value={d.defects.drafts} to="/defects" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{Object.entries(q.data!.charts).map(([k, svg]) => <Chart key={k} svg={svg} />)}</div>
          <CriticalTable rows={d.defects.critical} />
        </>
      )}
    </div>
  );
}

function CriticalTable({ rows }: { rows: DefectRow[] }) {
  return (
    <Card title={<>Open Blocker / Critical / P1 defects {rows.length > 0 && <Badge color="red">{rows.length}</Badge>}</>}>
      {rows.length === 0 ? <p className="text-sm text-green-800">None open.</p> : (
        <Table head={['ID', 'Title', 'Severity', 'Priority', 'Status', 'Assignee', 'Age (d)']} caption="Open high-impact defects">
          {rows.map((x) => (
            <tr key={x.id} className="bg-red-50 font-bold text-red-900">
              <td className="px-2 py-2 font-mono text-xs"><Link className="underline" to={`/defects/${x.id}`}>{x.defectId}</Link></td>
              <td className="px-2 py-2">{x.title}</td><td className="px-2 py-2"><SeverityBadge s={x.severity} /></td><td className="px-2 py-2"><PriorityBadge p={x.priority} /></td>
              <td className="px-2 py-2 text-xs">{DEFECT_STATUS_LABEL[x.status] ?? x.status}</td><td className="px-2 py-2 text-xs">{x.assignedTo ?? 'Unassigned'}</td><td className="px-2 py-2 text-xs">{x.ageDays}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function ReportsTab({ type }: { type: ReportType }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['reports', current!.id, type], queryFn: () => api<{ id: string; title: string; status: string; createdAt: string }[]>(`${rbase(current!.id)}?type=${type}`) });
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState({ date: '', from: '', to: '' });
  useEffect(() => { if (!sel && list.data?.length) setSel(list.data[0].id); }, [list.data, sel]);
  const gen = useMutation({
    mutationFn: () => api<Report>(rbase(current!.id), { method: 'POST', json: { type, ...(type === 'DSR' && form.date ? { date: form.date } : {}), ...(type !== 'DSR' && form.to ? { to: form.to } : {}), ...(type === 'DefectReport' && form.from ? { from: form.from } : {}) } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['reports'] }); setSel(r.id); },
  });
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-4">
        {can('reports.edit') && (
          <Card title="New report">
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); gen.mutate(); }}>
              {type === 'DSR' && <Field label="Report date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} hint="Default: today" />}
              {type === 'WSR' && <Field label="Week ending" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} hint="Default: today (7-day week)" />}
              {type === 'DefectReport' && <><Field label="From" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} hint="Default: 30 days ago" /><Field label="To" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></>}
              {gen.error && <Alert>{gen.error.message}</Alert>}
              <Button type="submit" disabled={gen.isPending}>{gen.isPending ? 'Generating…' : 'Generate'}</Button>
            </form>
          </Card>
        )}
        <Card title="History">
          <ul className="space-y-1 text-sm">
            {list.data?.map((r) => (
              <li key={r.id}><button className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-slate-100 ${sel === r.id ? 'bg-brand-50 font-semibold' : ''}`} aria-current={sel === r.id} onClick={() => setSel(r.id)}>
                <span>{r.title.replace(/^.* – /, '')}</span><Badge color={r.status === 'Sent' ? 'green' : r.status === 'Final' ? 'blue' : 'gray'}>{r.status}</Badge>
              </button></li>
            ))}
          </ul>
          {list.data?.length === 0 && <p className="text-sm text-slate-600">No reports yet.</p>}
        </Card>
      </div>
      {sel ? <ReportEditor key={sel} id={sel} onDeleted={() => setSel(null)} /> : <Card><p className="text-sm text-slate-600">Generate a report to start.</p></Card>}
    </div>
  );
}

function ReportEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['report', id], queryFn: () => api<Report>(`${rbase(current!.id)}/${id}`) });
  const [header, setHeader] = useState<Record<string, string> | null>(null);
  const [narr, setNarr] = useState<Record<string, string> | null>(null);
  const r = q.data;
  useEffect(() => { if (r) { setHeader(r.content.header); setNarr(r.content.narrative); } }, [r?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (x: Report) => { qc.setQueryData(['report', id], x); qc.invalidateQueries({ queryKey: ['reports'] }); };
  const save = useMutation({ mutationFn: () => api<Report>(`${rbase(current!.id)}/${id}`, { method: 'PATCH', json: { header, narrative: narr } }), onSuccess: done });
  const refresh = useMutation({ mutationFn: () => api<Report>(`${rbase(current!.id)}/${id}/refresh`, { method: 'POST' }), onSuccess: done });
  const status = useMutation({ mutationFn: (s: string) => api<Report>(`${rbase(current!.id)}/${id}/status`, { method: 'POST', json: { status: s } }), onSuccess: done });
  const del = useMutation({ mutationFn: () => api(`${rbase(current!.id)}/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['reports'] }); onDeleted(); } });
  if (!r || !header || !narr) return <Card><p role="status">Loading…</p></Card>;
  const editable = can('reports.edit') && r.status === 'Draft';
  const d = r.content.data, e = d.execution, df = d.defects;
  const err = save.error ?? refresh.error ?? status.error ?? del.error;
  const name = `${r.type}-${d.period.to}`;

  return (
    <div className="space-y-4">
      <Card title={<>{r.title} <Badge color={r.status === 'Sent' ? 'green' : r.status === 'Final' ? 'blue' : 'gray'}>{r.status}</Badge>{r.type === 'WSR' && <RagBadge rag={narr.ragStatus} />}</>}
        actions={<div className="flex flex-wrap items-center gap-2">
          <ExportButtons fullPath={`${rbase(current!.id)}/${id}/export`} name={name} />
          <Button variant="secondary" onClick={() => download(`${rbase(current!.id)}/${id}/export?format=eml`, `${name}.eml`)}>E-mail draft</Button>
        </div>}>
        <p className="text-xs text-slate-600">Data as of {new Date(r.content.refreshedAt).toLocaleString()} · period {d.period.from}{d.period.from !== d.period.to ? ` – ${d.period.to}` : ''} ({d.period.timeZone}). “E-mail draft” downloads an .eml with the PDF attached - open it in your mail program, add recipients and send.</p>
        {err && <div className="mt-2"><Alert>{err.message}</Alert></div>}
        {can('reports.edit') && (
          <div className="mt-3 flex flex-wrap gap-2">
            {editable && <><Button onClick={() => save.mutate()} disabled={save.isPending}>Save edits</Button><Button variant="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>Refresh data (keeps edits)</Button><Button variant="secondary" onClick={() => status.mutate('Final')}>Mark final</Button>
              <Button variant="danger" onClick={() => { if (confirm('Delete this draft report?')) del.mutate(); }}>Delete draft</Button></>}
            {r.status === 'Final' && <><Button onClick={() => status.mutate('Sent')}>Mark as sent</Button><Button variant="secondary" onClick={() => status.mutate('Draft')}>Back to draft</Button></>}
          </div>
        )}
        <fieldset disabled={!editable} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <legend className="sr-only">Report header</legend>
          {r.fields.header.map(([k, label]) => <Field key={k} label={label} value={header[k] ?? ''} onChange={(ev) => setHeader({ ...header, [k]: ev.target.value })} />)}
        </fieldset>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Test cases" value={e.totalTcs} /><Kpi label={r.type === 'DSR' ? 'Executed today' : 'Executed in period'} value={e.executedInPeriod} />
        <Kpi label="Execution" value={e.executionPct} suffix="%" /><Kpi label="Pass" value={e.passPct} suffix="%" />
        <Kpi label="New defects" value={df.newInPeriod} /><Kpi label="Open" value={df.open} /><Kpi label="Closed" value={df.closedInPeriod} />
        <Kpi label="Blocker/Critical/P1" value={df.critical.length} tone="red" />
      </div>
      {r.type === 'DefectReport' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Total defects" value={df.total} /><Kpi label="Reopen rate" value={df.reopenRate} suffix="%" /><Kpi label="Rejection rate" value={df.rejectionRate} suffix="%" />
          <Kpi label="Defect leakage" value={r.derived.leakagePct ?? '—'} suffix={r.derived.leakagePct != null ? '%' : ''} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{Object.entries(r.charts).map(([k, svg]) => <Chart key={k} svg={svg} />)}</div>
      <CriticalTable rows={df.critical} />
      {r.type === 'WSR' && <Card title="Defect density per module"><Table head={['Module', 'Test cases', 'Defects', 'Defects per test case']} caption="Defect density">{d.moduleDensity.map((m) => <tr key={m.module}><td className="px-2 py-2">{m.module}</td><td className="px-2 py-2">{m.testCases}</td><td className="px-2 py-2">{m.defects}</td><td className="px-2 py-2">{m.density}</td></tr>)}</Table></Card>}
      {r.type === 'DSR' && d.openQuestions.length > 0 && <Card title={`Open clarification questions (${d.openQuestions.length})`}><ul className="list-disc pl-5 text-sm">{d.openQuestions.map((x) => <li key={x.qId}><span className="font-mono text-xs">{x.qId}</span> {x.question} <span className="text-slate-600">({x.priority}{x.assignedTo ? `, ${x.assignedTo}` : ''}, {x.ageDays} d)</span></li>)}</ul></Card>}
      {r.type === 'DefectReport' && (
        <Card title={`All defects (${df.list.length})`}>
          <Table head={['ID', 'Title', 'Severity', 'Priority', 'Status', 'Module', 'Assignee', 'Type', 'Age', 'Jira']} caption="All defects">
            {df.list.map((x) => (
              <tr key={x.id} className={isHighImpact(x) && x.status !== 'Closed' ? 'bg-red-50 font-bold text-red-900' : undefined}>
                <td className="px-2 py-2 font-mono text-xs"><Link className="underline" to={`/defects/${x.id}`}>{x.defectId}</Link></td><td className="px-2 py-2">{x.title}</td>
                <td className="px-2 py-2"><SeverityBadge s={x.severity} /></td><td className="px-2 py-2"><PriorityBadge p={x.priority} /></td><td className="px-2 py-2 text-xs">{DEFECT_STATUS_LABEL[x.status] ?? x.status}</td>
                <td className="px-2 py-2 text-xs">{x.module ?? '—'}</td><td className="px-2 py-2 text-xs">{x.assignedTo ?? '—'}</td><td className="px-2 py-2 text-xs">{x.defectType}</td><td className="px-2 py-2 text-xs">{x.ageDays}</td><td className="px-2 py-2 text-xs">{x.jiraKey ?? '—'}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-slate-600">The PDF and Word exports include the screenshot of each defect.</p>
        </Card>
      )}

      <Card title="Narrative & inputs">
        <fieldset disabled={!editable} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <legend className="sr-only">Report narrative</legend>
          {r.fields.narrative.map(([k, label]) => k === 'ragStatus' ? (
            <div key={k} className="flex flex-col gap-1"><label htmlFor="rag" className="text-sm font-medium">{label}</label>
              <select id="rag" className="min-h-9 rounded-md border border-slate-400 bg-white px-2 text-sm" value={narr[k]} onChange={(ev) => setNarr({ ...narr, [k]: ev.target.value })}>{['Green', 'Amber', 'Red'].map((x) => <option key={x}>{x}</option>)}</select></div>
          ) : ['downtimeHours', 'uatDefects', 'prodDefects', 'plannedExecutionPct'].includes(k) ? (
            <Field key={k} label={label} type="number" min={0} step="any" value={narr[k] ?? ''} onChange={(ev) => setNarr({ ...narr, [k]: ev.target.value })} />
          ) : (
            <div key={k} className="flex flex-col gap-1 md:col-span-2"><label htmlFor={`n-${k}`} className="text-sm font-medium">{label}</label>
              <textarea id={`n-${k}`} rows={Math.min(10, Math.max(3, (narr[k] ?? '').split('\n').length + 1))} className="rounded-md border border-slate-400 p-2 text-sm disabled:bg-slate-50" value={narr[k] ?? ''} onChange={(ev) => setNarr({ ...narr, [k]: ev.target.value })} /></div>
          ))}
        </fieldset>
        {editable && <div className="mt-3"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save edits</Button></div>}
      </Card>
    </div>
  );
}

function RagBadge({ rag }: { rag?: string }) {
  const c = rag === 'Red' ? 'bg-red-700 text-white' : rag === 'Amber' ? 'bg-amber-400 text-slate-900' : 'bg-green-700 text-white';
  return <span className={`ml-2 rounded px-2 py-0.5 text-xs font-bold ${c}`}>{(rag ?? 'Green').toUpperCase()}</span>;
}
