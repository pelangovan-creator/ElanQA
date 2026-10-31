import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import { DEFECT_STATUS_LABEL, isHighImpact, PRIORITIES, type MonitorCheck, type MonitorCheckSummary, type MonitorLine, type MonitorSettings } from '../lib/types';
import { Alert, Badge, Button, Card, Field, PageHeader, Table } from '../components/ui';
import { ExportButtons } from './artefacts/shared';
import { PriorityBadge, SeverityBadge } from './Defects';

export const mbase = (projectId: string) => `/projects/${projectId}/monitoring`;
const TIME_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'UTC'];

/** Local time of an instant in the check's time zone, e.g. "02 Nov, 09:30". */
const when = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

export function Monitoring() {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>('latest');
  const settings = useQuery({ queryKey: ['monitor-settings', current?.id], queryFn: () => api<MonitorSettings>(`${mbase(current!.id)}/settings`), enabled: !!current });
  const history = useQuery({ queryKey: ['monitor-checks', current?.id], queryFn: () => api<MonitorCheckSummary[]>(`${mbase(current!.id)}/checks`), enabled: !!current, refetchInterval: 60_000 });
  const check = useQuery({ queryKey: ['monitor-check', current?.id, selected], queryFn: () => api<MonitorCheck | null>(`${mbase(current!.id)}/checks/${selected}`), enabled: !!current, refetchInterval: selected === 'latest' ? 60_000 : false });
  const run = useMutation({ mutationFn: () => api<MonitorCheck>(`${mbase(current!.id)}/run`, { method: 'POST' }), onSuccess: () => { setSelected('latest'); qc.invalidateQueries({ queryKey: ['monitor-checks'] }); qc.invalidateQueries({ queryKey: ['monitor-check'] }); } });
  if (!current) return null;
  const s = settings.data;
  const c = check.data && 'summary' in check.data ? check.data : null;

  return (
    <>
      <PageHeader title="Defect Monitoring"
        subtitle={s ? (s.enabled ? `Automatic checks at ${s.morning} and ${s.evening} (${s.timeZone}). Blocker, Critical and P1 defects are highlighted in red.` : 'Automatic checks are switched off for this project.') : ''}
        actions={<>{can('project.manage') && <Button onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? 'Checking…' : 'Run check now'}</Button>}
          {c && <ExportButtons fullPath={`${mbase(current.id)}/checks/${c.id}/export`} name="Defect-Alert-Summary" />}</>} />
      {run.error && <Alert>{run.error.message}</Alert>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {!c && !check.isLoading && <Alert kind="info">No check has run yet. {s?.enabled ? `The next one runs at ${s.morning} or ${s.evening} (${s.timeZone}).` : ''} {can('project.manage') && 'You can also run one now.'}</Alert>}
          {c && <Summary c={c} />}
        </div>
        <div className="space-y-4">
          <Card title="Check history">
            <ol className="max-h-[28rem] space-y-1 overflow-auto text-sm" aria-label="Previous checks">
              {history.data?.map((h, i) => {
                const active = selected === h.id || (selected === 'latest' && i === 0);
                return (
                  <li key={h.id}>
                    <button className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-slate-100 ${active ? 'bg-brand-50 font-semibold' : ''}`} aria-current={active} onClick={() => setSelected(i === 0 ? 'latest' : h.id)}>
                      <span>{s ? when(h.createdAt, s.timeZone) : new Date(h.createdAt).toLocaleString()} · {h.slot}{h.late && <span className="ml-1 text-xs text-amber-800">(late)</span>}</span>
                      {h.criticalCount > 0 ? <Badge color="red">{h.criticalCount}</Badge> : <Badge color="green">0</Badge>}
                    </button>
                  </li>
                );
              })}
            </ol>
            {history.data?.length === 0 && <p className="text-sm text-slate-600">No checks yet.</p>}
          </Card>
          {s && <SettingsCard s={s} editable={can('project.manage')} />}
        </div>
      </div>
    </>
  );
}

function Summary({ c }: { c: MonitorCheck }) {
  const s = c.summary;
  const tile = (label: string, value: number, tone: 'red' | 'amber' | 'plain' = 'plain', to?: string) => (
    <div className={`rounded-lg border p-3 ${tone === 'red' && value > 0 ? 'border-red-300 bg-red-50 text-red-900' : tone === 'amber' && value > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs uppercase text-slate-600">{label}</p>
      <p className={`text-2xl ${tone === 'red' && value > 0 ? 'font-extrabold' : 'font-bold'}`}>{to ? <Link to={to} className="hover:underline">{value}</Link> : value}</p>
    </div>
  );
  return (
    <>
      <Card title={<>{c.slot} check · {s.localTime} <span className="text-sm font-normal text-slate-600">({s.timeZone}){c.late ? ' · ran late' : ''} · changes since {when(s.since, s.timeZone)}</span></>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {tile('Blocker / Critical / P1', s.totals.critical, 'red')}
          {tile('SLA breached', s.totals.breached, 'red')}
          {tile('Ageing high-impact', s.totals.aging, 'amber')}
          {tile('Open defects', s.totals.open, 'plain', '/defects')}
          {tile('Pending retest', s.totals.pendingRetest, 'amber')}
          {tile('Drafts to review', s.totals.drafts, 'amber', '/defects')}
        </div>
        <p className="mt-3 text-xs text-slate-600">Open by severity: {Object.entries(s.bySeverity).map(([k, v]) => `${k} ${v}`).join(' · ')} — by priority: {PRIORITIES.map((p) => `${p} ${s.byPriority[p] ?? 0}`).join(' · ')}</p>
      </Card>
      <DefectTable title="Blocker / Critical / P1 defects" rows={s.critical} tz={s.timeZone} empty="No open Blocker, Critical or P1 defects." emphasise />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DefectTable title="New since the last check" rows={s.newSince} tz={s.timeZone} compact />
        <DefectTable title="Reopened" rows={s.reopened} tz={s.timeZone} compact />
        <DefectTable title="Closed" rows={s.closed} tz={s.timeZone} compact />
        <DefectTable title="Pending retest" rows={s.pendingRetest} tz={s.timeZone} compact />
      </div>
      <DefectTable title="Ageing (high-impact defects open too long)" rows={s.aging} tz={s.timeZone} compact />
    </>
  );
}

function DefectTable({ title, rows, tz, empty = 'None.', emphasise, compact }: { title: string; rows: MonitorLine[]; tz: string; empty?: string; emphasise?: boolean; compact?: boolean }) {
  return (
    <Card title={`${title} (${rows.length})`}>
      {rows.length === 0 ? <p className="text-sm text-slate-600">{empty}</p> : (
        <Table head={compact ? ['ID', 'Title', 'Sev.', 'Pri.', 'Status', 'Age'] : ['ID', 'Title', 'Severity', 'Priority', 'Status', 'Assignee', 'Age (d)', 'Last updated', 'SLA']} caption={title}>
          {rows.map((d) => {
            const hot = emphasise || isHighImpact(d);
            return (
              <tr key={d.id} className={hot ? 'bg-red-50 font-bold text-red-900' : undefined}>
                <td className="whitespace-nowrap px-2 py-2 font-mono text-xs"><Link className="underline" to={`/defects/${d.id}`}>{d.defectId}</Link></td>
                <td className="px-2 py-2">{d.title}</td>
                <td className="px-2 py-2"><SeverityBadge s={d.severity} /></td>
                <td className="px-2 py-2"><PriorityBadge p={d.priority} /></td>
                <td className="px-2 py-2 text-xs">{DEFECT_STATUS_LABEL[d.status] ?? d.status}</td>
                {!compact && <td className="px-2 py-2 text-xs">{d.assignedTo ?? <span className="text-red-800">Unassigned</span>}</td>}
                <td className="px-2 py-2 text-xs">{d.ageDays}{compact ? ' d' : ''}</td>
                {!compact && <td className="px-2 py-2 text-xs">{when(d.lastUpdated, tz)}</td>}
                {!compact && <td className="px-2 py-2 text-xs">{d.slaBreached ? <Badge color="red">Breached · due {when(d.slaDueAt, tz)}</Badge> : <span>Due {when(d.slaDueAt, tz)}</span>}</td>}
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

function SettingsCard({ s, editable }: { s: MonitorSettings; editable: boolean }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState(s);
  const m = useMutation({ mutationFn: () => api<MonitorSettings>(`${mbase(current!.id)}/settings`, { method: 'PUT', json: f }), onSuccess: () => qc.invalidateQueries({ queryKey: ['monitor-settings'] }) });
  return (
    <Card title="Schedule & SLA">
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }}>
        <fieldset disabled={!editable} className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Automatic checks on</label>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Morning" type="time" value={f.morning} onChange={(e) => setF({ ...f, morning: e.target.value })} />
            <Field label="Evening" type="time" value={f.evening} onChange={(e) => setF({ ...f, evening: e.target.value })} />
          </div>
          <Field label="Time zone" list="tz-list" value={f.timeZone} onChange={(e) => setF({ ...f, timeZone: e.target.value })} hint="IANA name, e.g. Asia/Kolkata" />
          <datalist id="tz-list">{TIME_ZONES.map((t) => <option key={t} value={t} />)}</datalist>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-1 text-sm font-medium">SLA – hours to fix</legend>
            {PRIORITIES.map((p) => <Field key={p} label={p} type="number" min={1} max={8760} value={f.slaHours[p]} onChange={(e) => setF({ ...f, slaHours: { ...f.slaHours, [p]: Number(e.target.value) } })} />)}
          </fieldset>
          <Field label="Ageing after (days) for Blocker/Critical/P1" type="number" min={1} max={90} value={f.agingDays} onChange={(e) => setF({ ...f, agingDays: Number(e.target.value) })} />
        </fieldset>
        {m.error && <Alert>{m.error.message}</Alert>}
        {m.isSuccess && <Alert kind="success">Saved.</Alert>}
        {editable && <Button type="submit" disabled={m.isPending}>Save schedule</Button>}
        <p className="text-xs text-slate-600">Summaries appear here and on the Overview. E-mail, Slack and Teams delivery are not enabled.</p>
      </form>
    </Card>
  );
}

/** Compact card for the Overview page. */
export function LatestAlertCard() {
  const { current } = useProject();
  const q = useQuery({ queryKey: ['monitor-check', current?.id, 'latest'], queryFn: () => api<MonitorCheck | null>(`${mbase(current!.id)}/checks/latest`), enabled: !!current, refetchInterval: 60_000 });
  const c = q.data && 'summary' in q.data ? q.data : null;
  if (!c) return null;
  const s = c.summary;
  return (
    <Card title={<>Latest defect alert · {c.slot} {s.localTime}</>} className={s.totals.critical ? 'mb-6 border-red-300' : 'mb-6'} actions={<Link to="/monitoring" className="text-sm text-brand-700 underline">Open monitoring</Link>}>
      {s.totals.critical === 0 ? <p className="text-sm text-green-800">No open Blocker, Critical or P1 defects.</p> : (
        <ul className="space-y-1 text-sm">
          {s.critical.slice(0, 5).map((d) => (
            <li key={d.id} className="font-bold text-red-900"><Link to={`/defects/${d.id}`} className="underline">{d.defectId}</Link> {d.title} · {d.severity}/{d.priority} · {d.assignedTo ?? 'unassigned'} · {d.ageDays} d{d.slaBreached ? ' · SLA breached' : ''}</li>
          ))}
          {s.critical.length > 5 && <li className="text-xs text-slate-600">…and {s.critical.length - 5} more</li>}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-600">{s.newSince.length} new · {s.reopened.length} reopened · {s.closed.length} closed · {s.pendingRetest.length} pending retest · {s.aging.length} ageing</p>
    </Card>
  );
}
