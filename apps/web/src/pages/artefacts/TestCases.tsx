import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import { PRIORITY_LEVELS, SEVERITIES, SUITES, TECHNIQUE_LABEL, TECHNIQUES, TEST_TYPES, type RequirementItem, type Step, type TestCase } from '../../lib/types';
import { Alert, Badge, Button, Card, Field, Select, Table, useShowMore } from '../../components/ui';
import { base, ExportButtons, ReviewBar, ReviewStatus, useSelection } from './shared';

interface GenResult { scenarios: number; testCases: number; testData: number; items: number; ai: boolean; message?: string }

export function TestCases() {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({ q: '', module: '', technique: '', review: '', regen: false });
  const [editing, setEditing] = useState<string | null>(null);
  const s = useSelection();
  const params = new URLSearchParams({ ...(f.q && { q: f.q }), ...(f.module && { module: f.module }), ...(f.technique && { technique: f.technique }), ...(f.review && { review: f.review }), ...(f.regen && { regen: 'true' }) });
  const filtered = params.toString() !== '';
  const all = useQuery({ queryKey: ['test-cases', current!.id, 'all'], queryFn: () => api<TestCase[]>(`${base(current!.id)}/test-cases`) });
  // Unfiltered view reuses the full list instead of downloading it twice.
  const fq = useQuery({ queryKey: ['test-cases', current!.id, params.toString()], queryFn: () => api<TestCase[]>(`${base(current!.id)}/test-cases?${params}`), enabled: filtered });
  const q = filtered ? fq : all;
  const gen = useMutation({ mutationFn: (scope: string) => api<GenResult>(`${base(current!.id)}/design/generate`, { method: 'POST', json: { scope } }), onSuccess: () => qc.invalidateQueries() });
  const regen = useMutation({ mutationFn: () => api<{ replaced: number; generated: number; manual: string[] }>(`${base(current!.id)}/design/regenerate`, { method: 'POST', json: {} }), onSuccess: () => qc.invalidateQueries() });
  const rows = q.data ?? [];
  const page = useShowMore(rows);
  const modules = [...new Set((all.data ?? []).map((t) => t.module))];
  const flagged = (all.data ?? []).filter((t) => t.needsRegeneration).length;

  if (editing) return <TestCaseEditor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />;

  return (
    <Card title={`Test Cases (${all.data?.length ?? 0})`} actions={<ExportButtons path="test-cases" name="Test-Cases" />}>
      {can('artefacts.edit') && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => gen.mutate('unmapped')} disabled={gen.isPending}>{gen.isPending ? 'Generating…' : 'Generate for unmapped requirements'}</Button>
          <Button variant="secondary" onClick={() => setEditing('new')}>New test case</Button>
          {gen.data && <span role="status" className="text-sm">{gen.data.message ?? `${gen.data.testCases} test cases, ${gen.data.scenarios} scenarios and ${gen.data.testData} test data rows created for ${gen.data.items} requirements (${gen.data.ai ? 'Claude + rules' : 'rule-based'}).`}</span>}
          {gen.error && <Alert>{gen.error.message}</Alert>}
        </div>
      )}
      {flagged > 0 && (
        <div className="mb-3"><Alert>
          {flagged} test case(s) are flagged because their requirement changed or a clarification was answered.{' '}
          {can('artefacts.edit') && <Button variant="secondary" onClick={() => regen.mutate()} disabled={regen.isPending}>Regenerate flagged</Button>}
        </Alert></div>
      )}
      {regen.data && <Alert kind="success">{regen.data.replaced} replaced by {regen.data.generated} regenerated test cases.{regen.data.manual.length ? ` Needs manual update: ${regen.data.manual.join(', ')}` : ''}</Alert>}
      <form className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label="Filter test cases">
        <Field label="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select label="Module" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })}><option value="">All</option>{modules.map((m) => <option key={m}>{m}</option>)}</Select>
        <Select label="Technique" value={f.technique} onChange={(e) => setF({ ...f, technique: e.target.value })}><option value="">All</option>{TECHNIQUES.map((t) => <option key={t} value={t}>{TECHNIQUE_LABEL[t]}</option>)}</Select>
        <Select label="Review" value={f.review} onChange={(e) => setF({ ...f, review: e.target.value })}><option value="">All</option>{['PendingReview', 'Approved', 'Rejected'].map((t) => <option key={t}>{t}</option>)}</Select>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.regen} onChange={(e) => setF({ ...f, regen: e.target.checked })} /> Flagged for regeneration</label>
      </form>
      <ReviewBar entityType="TestCase" selected={s.sel} onDone={s.clear} allIds={rows.map((r) => r.id)} onSelectAll={s.setAll} />
      <Table head={['', 'TC ID', 'Req', 'Module', 'Title', 'Technique', 'Type', 'Priority', 'Auto', 'Review', '']} caption="Test cases">
        {page.visible.map((t) => (
          <tr key={t.id} className={t.needsRegeneration ? 'bg-amber-50' : undefined}>
            <td className="px-2 py-2"><input type="checkbox" aria-label={`Select ${t.tcId}`} checked={s.sel.has(t.id)} onChange={() => s.toggle(t.id)} /></td>
            <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{t.tcId}{t.needsRegeneration && <span className="block"><Badge color="amber">Regenerate</Badge></span>}</td>
            <td className="px-2 py-2 font-mono text-xs">{t.requirements.map((r) => r.reqId).join(', ')}</td>
            <td className="px-2 py-2 text-xs">{t.module}</td>
            <td className="px-2 py-2">{t.title}<span className="block text-xs text-slate-500">{t.steps.length} steps{t.testDataRef ? ` · data ${t.testDataRef}` : ''}{t.suites.length ? ` · ${t.suites.join(', ')}` : ''}</span></td>
            <td className="px-2 py-2 text-xs">{TECHNIQUE_LABEL[t.technique] ?? t.technique}</td>
            <td className="px-2 py-2 text-xs">{t.testType}</td>
            <td className="px-2 py-2"><Badge color={t.priority === 'High' ? 'red' : t.priority === 'Medium' ? 'amber' : 'gray'}>{t.priority}</Badge></td>
            <td className="px-2 py-2 text-xs">{t.automationCandidate ? 'Y' : 'N'}</td>
            <td className="px-2 py-2"><ReviewStatus item={t} /></td>
            <td className="px-2 py-2 text-right"><Button variant="ghost" onClick={() => setEditing(t.id)}>{can('artefacts.edit') ? 'Open' : 'View'}<span className="sr-only"> {t.tcId}</span></Button></td>
          </tr>
        ))}
      </Table>
      {page.more}
      {q.data?.length === 0 && <p className="mt-3 text-sm text-slate-600">No test cases yet. Upload requirements, then generate.</p>}
    </Card>
  );
}

function TestCaseEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { current, can } = useProject();
  const tc = useQuery({ queryKey: ['test-case', id], queryFn: () => api<TestCase>(`${base(current!.id)}/test-cases/${id}`), enabled: !!id });
  if (id && !tc.data) return <p role="status">Loading…</p>;
  return <EditorForm key={tc.data?.id ?? 'new'} tc={tc.data} readOnly={!can('artefacts.edit')} onClose={onClose} />;
}

function EditorForm({ tc, readOnly, onClose }: { tc?: TestCase; readOnly: boolean; onClose: () => void }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const reqs = useQuery({ queryKey: ['items', current!.id, 'all-for-links'], queryFn: () => api<{ items: RequirementItem[] }>(`/projects/${current!.id}/requirements/items?take=1000`) });
  const [f, setF] = useState({
    title: tc?.title ?? '', module: tc?.module ?? '', description: tc?.description ?? '', preconditions: tc?.preconditions ?? '', testDataRef: tc?.testDataRef ?? '',
    priority: tc?.priority ?? 'Medium', severityIfFailed: tc?.severityIfFailed ?? 'Major', testType: tc?.testType ?? 'Functional', technique: tc?.technique ?? 'UseCase',
    automationCandidate: tc?.automationCandidate ?? true, suites: tc?.suites ?? ['Regression'], comments: tc?.comments ?? '',
    reqIds: (tc?.requirements ?? []).map((r) => r.reqId).join(', '),
  });
  const [steps, setSteps] = useState<Step[]>(tc?.steps.length ? tc.steps : [{ no: 1, action: '', expected: '' }]);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const wanted = f.reqIds.split(/[,\s]+/).filter(Boolean);
      const map = new Map((reqs.data?.items ?? []).map((i) => [i.reqId, i.id]));
      const missing = wanted.filter((w) => !map.has(w));
      if (missing.length) throw new Error(`Unknown requirement IDs: ${missing.join(', ')}`);
      const { reqIds: _r, ...rest } = f;
      void _r;
      const body = { ...rest, steps: steps.map(({ action, expected }) => ({ action, expected })), requirementIds: wanted.map((w) => map.get(w)!), clearRegeneration: true, testDataRef: f.testDataRef || null };
      return tc ? api(`${base(current!.id)}/test-cases/${tc.id}`, { method: 'PATCH', json: body }) : api(`${base(current!.id)}/test-cases`, { method: 'POST', json: body });
    },
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });
  const del = useMutation({ mutationFn: () => api(`${base(current!.id)}/test-cases/${tc!.id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries(); onClose(); } });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const setStep = (i: number, k: 'action' | 'expected', v: string) => setSteps(steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const move = (i: number, d: -1 | 1) => { const n = [...steps]; [n[i], n[i + d]] = [n[i + d], n[i]]; setSteps(n); };

  return (
    <Card title={tc ? <>{tc.tcId} <ReviewStatus item={tc} /></> : 'New test case'} actions={<Button variant="secondary" onClick={onClose}>Back to list</Button>}>
      {tc?.needsRegeneration && <Alert>This test case is flagged: its requirement changed or a clarification was answered. Saving clears the flag.</Alert>}
      <form onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
        <fieldset disabled={readOnly} className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-3"><Field label="Title" required value={f.title} onChange={set('title')} /></div>
          <Field label="Module" required value={f.module} onChange={set('module')} />
          <div className="md:col-span-2"><Field label="Requirement IDs" value={f.reqIds} onChange={set('reqIds')} hint="Comma-separated, e.g. REQ-005.02, REQ-006.01" /></div>
          <Field label="Test data reference" value={f.testDataRef} onChange={set('testDataRef')} />
          <Select label="Priority" value={f.priority} onChange={set('priority')}>{PRIORITY_LEVELS.map((x) => <option key={x}>{x}</option>)}</Select>
          <Select label="Severity if failed" value={f.severityIfFailed} onChange={set('severityIfFailed')}>{SEVERITIES.map((x) => <option key={x}>{x}</option>)}</Select>
          <Select label="Test type" value={f.testType} onChange={set('testType')}>{TEST_TYPES.map((x) => <option key={x}>{x}</option>)}</Select>
          <Select label="Technique used" value={f.technique} onChange={set('technique')}>{TECHNIQUES.map((x) => <option key={x} value={x}>{TECHNIQUE_LABEL[x]}</option>)}</Select>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Automation & suites</legend>
            <label className="text-sm"><input type="checkbox" checked={f.automationCandidate} onChange={(e) => setF({ ...f, automationCandidate: e.target.checked })} /> Automation candidate</label>
            <div className="flex gap-2 text-sm">{SUITES.map((x) => <label key={x}><input type="checkbox" checked={f.suites.includes(x)} onChange={(e) => setF({ ...f, suites: e.target.checked ? [...f.suites, x] : f.suites.filter((y) => y !== x) })} /> {x}</label>)}</div>
          </fieldset>
          <div className="md:col-span-4 flex flex-col gap-1"><label htmlFor="tc-desc" className="text-sm font-medium">Description</label><textarea id="tc-desc" rows={2} className="rounded-md border border-slate-400 p-2 text-sm" value={f.description} onChange={set('description')} /></div>
          <div className="md:col-span-4"><Field label="Pre-conditions" value={f.preconditions} onChange={set('preconditions')} /></div>

          <div className="md:col-span-4">
            <h3 className="mb-2 text-sm font-semibold">Test steps</h3>
            <ol className="space-y-2">
              {steps.map((st, i) => (
                <li key={i} className="grid grid-cols-1 gap-2 rounded border border-slate-200 p-2 md:grid-cols-[2rem_1fr_1fr_auto]">
                  <span className="pt-2 text-sm font-semibold" aria-hidden="true">{i + 1}.</span>
                  <div className="flex flex-col"><label htmlFor={`sa-${i}`} className="text-xs">Step {i + 1} action</label><textarea id={`sa-${i}`} rows={2} className="rounded border border-slate-400 p-1 text-sm" value={st.action} onChange={(e) => setStep(i, 'action', e.target.value)} /></div>
                  <div className="flex flex-col"><label htmlFor={`se-${i}`} className="text-xs">Step {i + 1} expected result</label><textarea id={`se-${i}`} rows={2} className="rounded border border-slate-400 p-1 text-sm" value={st.expected} onChange={(e) => setStep(i, 'expected', e.target.value)} /></div>
                  {!readOnly && <div className="flex flex-col gap-1">
                    <Button type="button" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`}>↑</Button>
                    <Button type="button" variant="ghost" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`}>↓</Button>
                    <Button type="button" variant="ghost" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}>✕</Button>
                  </div>}
                </li>
              ))}
            </ol>
            {!readOnly && <Button type="button" variant="secondary" className="mt-2" onClick={() => setSteps([...steps, { no: steps.length + 1, action: '', expected: '' }])}>Add step</Button>}
          </div>
          <div className="md:col-span-4"><Field label="Comments" value={f.comments} onChange={set('comments')} /></div>
        </fieldset>
        {err && <div className="mt-3"><Alert>{err}</Alert></div>}
        {!readOnly && <div className="mt-4 flex gap-2">
          <Button type="submit" disabled={save.isPending}>Save{tc?.reviewStatus === 'Approved' ? ' (sends back for review)' : ''}</Button>
          {tc && <Button type="button" variant="danger" onClick={() => { if (confirm(`Delete ${tc.tcId}?`)) del.mutate(); }}>Delete</Button>}
        </div>}
      </form>
    </Card>
  );
}
