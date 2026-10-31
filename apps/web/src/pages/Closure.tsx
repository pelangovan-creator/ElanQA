import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download } from '../lib/api';
import { useProject } from '../lib/project';
import { DEFECT_STATUS_LABEL } from '../lib/types';
import { Alert, Badge, Button, Card, Field, PageHeader, Table } from '../components/ui';
import { ExportButtons } from './artefacts/shared';
import { Chart } from './Reports';
import { PriorityBadge, SeverityBadge } from './Defects';

const cbase = (projectId: string) => `/projects/${projectId}/closure`;
type Level = 'High' | 'Medium' | 'Low';
type Trigger = 'AllDefectsClosed' | 'CriticalClosed' | 'ClientRequest';
interface Risk { id: string; defectId: string; title: string; severity: string; priority: string; status: string; isDraft: boolean; businessImpact: Level; likelihood: Level; riskLevel: Level; impactDescription: string; workaround: string; mitigation: string; owner: string }
interface Exit { key: string; criterion: string; met: boolean; actual: string; comment: string }
interface Sign { role: 'QALead' | 'PM' | 'Client'; name: string; decision: string; comment: string; signedAt: string | null }
interface Closure {
  id: string; title: string; status: 'Draft' | 'Final' | 'SignedOff'; updatedAt: string; triggerLabel: string;
  content: {
    trigger: Trigger; triggerReason: string; header: Record<string, string>; narrative: Record<string, string>; risks: Risk[]; exitCriteria: Exit[];
    recommendation: { decision: 'Go' | 'ConditionalGo' | 'NoGo'; reason: string; conditions: string; suggested: string }; signOff: Sign[]; refreshedAt: string;
    data: { execution: Record<string, number>; coverage: { percent: number; unmapped: number }; defects: { total: number; reopenRate: number; rejectionRate: number }; design: { automated: number } };
    extra: { typesPerformed: { testType: string; count: number }[]; techniquesPerformed: { technique: string; count: number }[]; environments: { name: string; envType: string; baseUrl: string; browsers: string }[]; rtm: { executionStatus: string }[]; deliverables: { name: string; where: string }[] };
  };
  charts: Record<string, string>; fields: { header: [string, string][]; narrative: [string, string][] };
}
interface Eligibility { open: number; openCritical: number; drafts: number; triggers: Record<Trigger, { met: boolean; label: string; detail: string }> }

const DECISION: Record<string, { label: string; cls: string }> = {
  Go: { label: 'GO', cls: 'bg-green-700 text-white' }, ConditionalGo: { label: 'CONDITIONAL GO', cls: 'bg-amber-400 text-slate-900' }, NoGo: { label: 'NO-GO', cls: 'bg-red-700 text-white' },
};
const ROLE: Record<string, string> = { QALead: 'QA Lead', PM: 'Project Manager', Client: 'Client' };
const level = (i: Level, l: Level): Level => { const s = { High: 3, Medium: 2, Low: 1 }; const v = s[i] * s[l]; return v >= 6 ? 'High' : v >= 3 ? 'Medium' : 'Low'; };
const LEVEL_COLOR: Record<Level, 'red' | 'amber' | 'green'> = { High: 'red', Medium: 'amber', Low: 'green' };

export function Closure() {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const el = useQuery({ queryKey: ['closure-eligibility', current?.id], queryFn: () => api<Eligibility>(`${cbase(current!.id)}/eligibility`), enabled: !!current });
  const list = useQuery({ queryKey: ['closures', current?.id], queryFn: () => api<{ id: string; title: string; status: string; createdAt: string }[]>(cbase(current!.id)), enabled: !!current });
  const [sel, setSel] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [release, setRelease] = useState('');
  useEffect(() => { if (!sel && list.data?.length) setSel(list.data[0].id); }, [list.data, sel]);
  const gen = useMutation({
    mutationFn: (trigger: Trigger) => api<Closure>(cbase(current!.id), { method: 'POST', json: { trigger, reason: trigger === 'ClientRequest' ? reason : undefined, release: release || undefined } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['closures'] }); setSel(r.id); setReason(''); },
  });
  if (!current) return null;
  return (
    <>
      <PageHeader title="Test Closure" subtitle="Close testing when all defects are closed, when all Blocker/Critical/P1 defects are closed, or at the client's request - with the risk of every open defect made explicit." />
      <Card title="Closure conditions" className="mb-4">
        {el.data && (
          <ul className="space-y-2">
            {(Object.entries(el.data.triggers) as [Trigger, Eligibility['triggers'][Trigger]][]).map(([k, t]) => (
              <li key={k} className={`flex flex-wrap items-center justify-between gap-3 rounded border p-3 ${t.met ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
                <div>
                  <p className="font-semibold">{k === 'ClientRequest' ? '•' : t.met ? '✓' : '✗'} {t.label}</p>
                  <p className="text-sm text-slate-700">{t.detail}</p>
                  {k === 'ClientRequest' && can('closure.trigger') && (
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[2fr_minmax(0,1fr)]">
                      <Field label="Reason for the client's request (required)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client must go live on Friday for a regulatory date" />
                      <Field label="Release / version" value={release} onChange={(e) => setRelease(e.target.value)} />
                    </div>
                  )}
                </div>
                {can('closure.trigger') && <Button disabled={!t.met || gen.isPending || (k === 'ClientRequest' && reason.trim().length < 10)} variant={k === 'ClientRequest' ? 'danger' : 'primary'} onClick={() => gen.mutate(k)}>Generate closure report</Button>}
              </li>
            ))}
          </ul>
        )}
        {el.data && el.data.open > 0 && <p className="mt-3 text-sm text-red-800"><strong>{el.data.open}</strong> defect(s) are not closed ({el.data.openCritical} Blocker/Critical/P1, {el.data.drafts} unreviewed draft(s)). Closing now will list each with its risk.</p>}
        {gen.error && <div className="mt-2"><Alert>{gen.error.message}</Alert></div>}
      </Card>
      {list.data && list.data.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Closure reports">
          {list.data.map((r) => <Button key={r.id} variant={sel === r.id ? 'primary' : 'secondary'} aria-pressed={sel === r.id} onClick={() => setSel(r.id)}>{r.title.replace('Test Closure Report – ', '')} · {r.status}</Button>)}
        </div>
      )}
      {sel && <Editor key={sel} id={sel} />}
    </>
  );
}

function Editor({ id }: { id: string }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['closure', id], queryFn: () => api<Closure>(`${cbase(current!.id)}/${id}`) });
  const [draft, setDraft] = useState<Closure['content'] | null>(null);
  const r = q.data;
  useEffect(() => { if (r) setDraft(structuredClone(r.content)); }, [r?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (x: Closure) => { qc.setQueryData(['closure', id], x); qc.invalidateQueries({ queryKey: ['closures'] }); qc.invalidateQueries({ queryKey: ['closure-eligibility'] }); };
  const save = useMutation({
    mutationFn: () => api<Closure>(`${cbase(current!.id)}/${id}`, { method: 'PATCH', json: {
      header: draft!.header, narrative: draft!.narrative,
      risks: draft!.risks.map(({ id: rid, businessImpact, likelihood, impactDescription, workaround, mitigation, owner }) => ({ id: rid, businessImpact, likelihood, impactDescription, workaround, mitigation, owner })),
      recommendation: { decision: draft!.recommendation.decision, reason: draft!.recommendation.reason, conditions: draft!.recommendation.conditions },
      exitComments: Object.fromEntries(draft!.exitCriteria.map((x) => [x.key, x.comment])),
    } }),
    onSuccess: done,
  });
  const refresh = useMutation({ mutationFn: () => api<Closure>(`${cbase(current!.id)}/${id}/refresh`, { method: 'POST' }), onSuccess: done });
  const status = useMutation({ mutationFn: (s: string) => api<Closure>(`${cbase(current!.id)}/${id}/status`, { method: 'POST', json: { status: s } }), onSuccess: done });
  if (!r || !draft) return <Card><p role="status">Loading…</p></Card>;
  const editable = can('closure.trigger') && r.status === 'Draft';
  const d = draft, e = r.content.data.execution;
  const setRisk = (i: number, patch: Partial<Risk>) => setDraft({ ...d, risks: d.risks.map((x, j) => (j === i ? { ...x, ...patch, riskLevel: level(patch.businessImpact ?? x.businessImpact, patch.likelihood ?? x.likelihood) } : x)) });
  const err = save.error ?? refresh.error ?? status.error;
  const dec = DECISION[d.recommendation.decision];
  const high = d.risks.filter((x) => x.riskLevel === 'High').length;
  const rtmCounts = r.content.extra.rtm.reduce((m, x) => ({ ...m, [x.executionStatus]: (m[x.executionStatus] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <div className="space-y-4">
      <Card title={<>{r.title} <Badge color={r.status === 'SignedOff' ? 'green' : r.status === 'Final' ? 'blue' : 'gray'}>{r.status === 'SignedOff' ? 'Signed off' : r.status}</Badge></>}
        actions={<div className="flex flex-wrap gap-2"><ExportButtons fullPath={`${cbase(current!.id)}/${id}/export`} name="Test-Closure-Report" /><Button variant="secondary" onClick={() => download(`${cbase(current!.id)}/${id}/export?format=eml`, 'Test-Closure-Report.eml')}>E-mail draft</Button></div>}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-md px-4 py-2 text-xl font-extrabold ${dec.cls}`} aria-label={`Recommendation: ${dec.label}`}>{dec.label}</span>
          <div className="text-sm"><p><strong>Trigger:</strong> {r.triggerLabel}{d.triggerReason ? ` – “${d.triggerReason}”` : ''}</p>
            {d.recommendation.decision !== d.recommendation.suggested && <p className="text-slate-600">QA Pilot suggests {DECISION[d.recommendation.suggested]?.label} based on the data.</p>}</div>
        </div>
        {d.risks.length > 0 && (
          <div role="alert" className="mt-3 rounded-md border-2 border-red-600 bg-red-50 p-3 text-red-900">
            <p className="text-base font-bold">{d.risks.length} defect(s) remain OPEN at closure{high ? ` – ${high} High risk` : ''}.</p>
            <p className="text-sm">Each carries the business risk assessed below until it is fixed. The risk assessment must be complete (workaround and owner for every defect) before the report can be finalised.</p>
          </div>
        )}
        {err && <div className="mt-3"><Alert>{err.message}</Alert></div>}
        {can('closure.trigger') && (
          <div className="mt-3 flex flex-wrap gap-2">
            {editable && <><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button><Button variant="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>Refresh data (keeps edits)</Button><Button variant="secondary" onClick={() => status.mutate('Final')}>Mark final (ready for sign-off)</Button></>}
            {r.status === 'Final' && <Button variant="secondary" onClick={() => { if (confirm('Back to draft? Any signatures are cleared.')) status.mutate('Draft'); }}>Back to draft</Button>}
          </div>
        )}
      </Card>

      <Card title="Go / No-Go recommendation">
        <fieldset disabled={!editable} className="grid grid-cols-1 gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-1"><label htmlFor="dec" className="text-sm font-medium">Recommendation</label>
            <select id="dec" className="min-h-9 rounded-md border border-slate-400 bg-white px-2 text-sm" value={d.recommendation.decision} onChange={(ev) => setDraft({ ...d, recommendation: { ...d.recommendation, decision: ev.target.value as Closure['content']['recommendation']['decision'] } })}>
              <option value="Go">Go</option><option value="ConditionalGo">Conditional Go</option><option value="NoGo">No-Go</option></select></div>
          <div className="flex flex-col gap-1"><label htmlFor="dec-r" className="text-sm font-medium">Reason</label><textarea id="dec-r" rows={2} className="rounded-md border border-slate-400 p-2 text-sm" value={d.recommendation.reason} onChange={(ev) => setDraft({ ...d, recommendation: { ...d.recommendation, reason: ev.target.value } })} /></div>
          <div className="flex flex-col gap-1 md:col-span-2"><label htmlFor="dec-c" className="text-sm font-medium">Conditions (for Conditional Go)</label><textarea id="dec-c" rows={3} className="rounded-md border border-slate-400 p-2 text-sm" value={d.recommendation.conditions} onChange={(ev) => setDraft({ ...d, recommendation: { ...d.recommendation, conditions: ev.target.value } })} /></div>
        </fieldset>
      </Card>

      <Card title={`Open defects & risk assessment (${d.risks.length})`}>
        {d.risks.length === 0 ? <p className="text-sm text-green-800">No defects are open at closure.</p> : (
          <div className="space-y-3">
            {d.risks.map((x, i) => (
              <fieldset key={x.id} disabled={!editable} className={`rounded-md border p-3 ${x.riskLevel === 'High' ? 'border-red-400 bg-red-50' : x.riskLevel === 'Medium' ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                <legend className="px-1 text-sm font-bold"><Link className="underline" to={`/defects/${x.id}`}>{x.defectId}</Link> {x.title}</legend>
                <p className="mb-2 flex flex-wrap items-center gap-1 text-xs"><SeverityBadge s={x.severity} /><PriorityBadge p={x.priority} /><Badge>{x.isDraft ? 'Draft (unreviewed)' : DEFECT_STATUS_LABEL[x.status] ?? x.status}</Badge><span className="ml-2">Risk level:</span><Badge color={LEVEL_COLOR[x.riskLevel]}>{x.riskLevel}</Badge></p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  {(['businessImpact', 'likelihood'] as const).map((k) => (
                    <div key={k} className="flex flex-col gap-1"><label htmlFor={`${k}-${x.id}`} className="text-xs font-medium">{k === 'businessImpact' ? 'Business impact' : 'Likelihood'}</label>
                      <select id={`${k}-${x.id}`} className="min-h-9 rounded border border-slate-400 bg-white px-2 text-sm" value={x[k]} onChange={(ev) => setRisk(i, { [k]: ev.target.value as Level })}>{['High', 'Medium', 'Low'].map((v) => <option key={v}>{v}</option>)}</select></div>
                  ))}
                  <div className="md:col-span-2"><Field label="Owner" value={x.owner} onChange={(ev) => setRisk(i, { owner: ev.target.value })} /></div>
                  <div className="md:col-span-4"><Field label="Business impact description" value={x.impactDescription} onChange={(ev) => setRisk(i, { impactDescription: ev.target.value })} /></div>
                  <div className="md:col-span-2"><Field label="Workaround (required)" value={x.workaround} onChange={(ev) => setRisk(i, { workaround: ev.target.value })} /></div>
                  <div className="md:col-span-2"><Field label="Mitigation / recommendation" value={x.mitigation} onChange={(ev) => setRisk(i, { mitigation: ev.target.value })} /></div>
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </Card>

      <Card title="Exit criteria check">
        <Table head={['Criterion', 'Result', 'Actual', 'Comment']} caption="Exit criteria">
          {d.exitCriteria.map((x, i) => (
            <tr key={x.key} className={x.met ? '' : 'bg-red-50'}>
              <td className="px-2 py-2">{x.criterion}</td>
              <td className="px-2 py-2">{x.met ? <Badge color="green">✓ Met</Badge> : <Badge color="red">✗ Not met</Badge>}</td>
              <td className="px-2 py-2 text-xs">{x.actual}</td>
              <td className="px-2 py-2"><label className="sr-only" htmlFor={`ex-${x.key}`}>Comment on {x.criterion}</label><input id={`ex-${x.key}`} disabled={!editable} className="min-h-8 w-full rounded border border-slate-300 px-2 text-sm" value={x.comment} onChange={(ev) => setDraft({ ...d, exitCriteria: d.exitCriteria.map((c, j) => (j === i ? { ...c, comment: ev.target.value } : c)) })} /></td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Document control & release">
        <fieldset disabled={!editable} className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <legend className="sr-only">Header</legend>
          {r.fields.header.map(([k, label]) => <Field key={k} label={label} value={d.header[k] ?? ''} onChange={(ev) => setDraft({ ...d, header: { ...d.header, [k]: ev.target.value } })} />)}
        </fieldset>
      </Card>

      <Card title="Test summary">
        <div className="mb-3 grid grid-cols-2 gap-3 text-center md:grid-cols-4 lg:grid-cols-8">
          {[['Planned', e.totalTcs], ['Executed', e.executed], ['Passed', e.passed], ['Failed', e.failed], ['Blocked', e.blocked], ['Not run', e.notRun], ['Execution', `${e.executionPct}%`], ['Pass rate', `${e.passPct}%`]].map(([l, v]) => (
            <div key={String(l)} className="rounded border border-slate-200 bg-white p-2"><p className="text-xs uppercase text-slate-600">{l}</p><p className="text-xl font-bold">{v}</p></div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{Object.entries(r.charts).map(([k, svg]) => <Chart key={k} svg={svg} />)}</div>
        <p className="mt-3 text-sm">Requirement coverage <strong>{r.content.data.coverage.percent}%</strong> · final RTM: {Object.entries(rtmCounts).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'} · defects {r.content.data.defects.total}, reopen rate {r.content.data.defects.reopenRate}%, rejection rate {r.content.data.defects.rejectionRate}% · {r.content.data.design.automated} automated test cases</p>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3 text-sm">
          <div><h3 className="font-semibold">Test types performed</h3><ul className="list-disc pl-5">{r.content.extra.typesPerformed.map((t) => <li key={t.testType}>{t.testType} ({t.count})</li>)}</ul></div>
          <div><h3 className="font-semibold">Techniques applied</h3><ul className="list-disc pl-5">{r.content.extra.techniquesPerformed.map((t) => <li key={t.technique}>{t.technique} ({t.count})</li>)}</ul></div>
          <div><h3 className="font-semibold">Environments</h3><ul className="list-disc pl-5">{r.content.extra.environments.map((x) => <li key={x.name}>{x.name} ({x.envType}) – {x.baseUrl} – {x.browsers}</li>)}{!r.content.extra.environments.length && <li>None configured</li>}</ul></div>
        </div>
      </Card>

      <Card title="Scope, deviations, lessons & recommendations">
        <fieldset disabled={!editable} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <legend className="sr-only">Narrative</legend>
          {r.fields.narrative.map(([k, label]) => (
            <div key={k} className="flex flex-col gap-1"><label htmlFor={`cn-${k}`} className="text-sm font-medium">{label}</label>
              <textarea id={`cn-${k}`} rows={Math.min(8, Math.max(3, (d.narrative[k] ?? '').split('\n').length + 1))} className="rounded-md border border-slate-400 p-2 text-sm disabled:bg-slate-50" value={d.narrative[k] ?? ''} onChange={(ev) => setDraft({ ...d, narrative: { ...d.narrative, [k]: ev.target.value } })} /></div>
          ))}
        </fieldset>
        {editable && <div className="mt-3"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></div>}
      </Card>

      <Card title="Deliverables">
        <ul className="grid grid-cols-1 gap-1 text-sm md:grid-cols-2">{r.content.extra.deliverables.map((x) => <li key={x.name}>✓ <strong>{x.name}</strong> <span className="text-slate-600">– {x.where}</span></li>)}</ul>
      </Card>

      <SignOff r={r} />
    </div>
  );
}

function SignOff({ r }: { r: Closure }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const isClient = current?.myRole === 'Client';
  const [f, setF] = useState<Record<string, { name: string; decision: string; comment: string }>>({});
  const m = useMutation({
    mutationFn: (role: string) => api<Closure>(`${cbase(current!.id)}/${r.id}/sign`, { method: 'POST', json: { role, ...(f[role] ?? {}), decision: f[role]?.decision || 'Approved' } }),
    onSuccess: (x) => { qc.setQueryData(['closure', r.id], x); qc.invalidateQueries({ queryKey: ['closures'] }); },
  });
  return (
    <Card title="Sign-off">
      {r.status === 'Draft' && <p className="mb-3 text-sm text-slate-600">Sign-off opens once the report is marked final.</p>}
      {m.error && <Alert>{m.error.message}</Alert>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {r.content.signOff.map((s) => {
          const mayRecord = r.status === 'Final' && !s.signedAt && (can('closure.trigger') || (isClient && s.role === 'Client'));
          const v = f[s.role] ?? { name: '', decision: 'Approved', comment: '' };
          return (
            <div key={s.role} className={`rounded-md border p-3 ${s.signedAt ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
              <h3 className="font-semibold">{ROLE[s.role]}</h3>
              {s.signedAt ? (
                <p className="mt-1 text-sm">✓ <strong>{s.name}</strong> – {s.decision === 'ApprovedWithConditions' ? 'Approved with conditions' : s.decision}<br /><span className="text-xs text-slate-600">{new Date(s.signedAt).toLocaleString()}</span>{s.comment && <><br /><span className="text-xs">“{s.comment}”</span></>}</p>
              ) : mayRecord ? (
                <form className="mt-2 space-y-2" onSubmit={(ev) => { ev.preventDefault(); m.mutate(s.role); }}>
                  {!isClient && <Field label="Name" value={v.name} onChange={(ev) => setF({ ...f, [s.role]: { ...v, name: ev.target.value } })} placeholder="Defaults to you" />}
                  <div className="flex flex-col gap-1"><label htmlFor={`sd-${s.role}`} className="text-sm font-medium">Decision</label>
                    <select id={`sd-${s.role}`} className="min-h-9 rounded border border-slate-400 bg-white px-2 text-sm" value={v.decision} onChange={(ev) => setF({ ...f, [s.role]: { ...v, decision: ev.target.value } })}>
                      <option value="Approved">Approved</option><option value="ApprovedWithConditions">Approved with conditions</option><option value="Rejected">Rejected</option></select></div>
                  <Field label="Comment" value={v.comment} onChange={(ev) => setF({ ...f, [s.role]: { ...v, comment: ev.target.value } })} />
                  <Button type="submit" disabled={m.isPending}>Sign as {ROLE[s.role]}</Button>
                </form>
              ) : <p className="mt-1 text-sm text-slate-600">Not signed</p>}
            </div>
          );
        })}
      </div>
      {r.status === 'SignedOff' && <p className="mt-3 text-sm text-green-800">All parties have signed. {r.content.signOff.some((s) => s.decision === 'Rejected') ? 'One party rejected - the project stays open.' : 'The project is now marked Closed.'}</p>}
    </Card>
  );
}
