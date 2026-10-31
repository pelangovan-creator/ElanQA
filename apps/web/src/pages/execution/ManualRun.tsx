import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import type { RunDetail, TestCase } from '../../lib/types';
import { Alert, Badge, Button, Card, PageHeader } from '../../components/ui';
import { xbase } from './RunPanel';
import { STATUS_COLOR } from './RunView';

const STEP_STATUS = ['Pass', 'Fail', 'Blocked', 'Skipped'] as const;

/** Guided manual execution: one test case at a time, every step marked with an actual result. */
export function ManualRun() {
  const { runId } = useParams();
  const { current } = useProject();
  const qc = useQueryClient();
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => api<RunDetail>(`${xbase(current!.id)}/runs/${runId}`), enabled: !!current });
  const tcs = useQuery({ queryKey: ['test-cases', current?.id, 'all'], queryFn: () => api<TestCase[]>(`/projects/${current!.id}/artefacts/test-cases`), enabled: !!current });
  const [idx, setIdx] = useState(0);
  const complete = useMutation({ mutationFn: () => api(`${xbase(current!.id)}/manual-runs/${runId}/complete`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries() });
  if (!run.data || !tcs.data) return <p role="status">Loading…</p>;
  const ids = run.data.summary?.testCaseIds ?? [];
  const list = ids.map((id) => tcs.data!.find((t) => t.id === id)).filter((t): t is TestCase => !!t);
  const tc = list[idx];
  const resultFor = (id: string) => run.data!.results.find((r) => r.testCaseId === id);
  const finished = run.data.status !== 'Running';

  return (
    <>
      <PageHeader title={`${run.data.runId} · Manual execution`} subtitle={`${list.length} test cases · ${run.data.passed} pass · ${run.data.failed} fail · ${run.data.blocked} blocked · ${run.data.skipped} skipped`}
        actions={<><Link to="/execution" className="inline-flex min-h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm">Back</Link>
          {!finished && <Button onClick={() => complete.mutate()}>Complete run</Button>}{finished && <Link to={`/execution/runs/${runId}`} className="inline-flex min-h-9 items-center rounded-md bg-brand-600 px-3 text-sm text-white">View results</Link>}</>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card title="Test cases">
          <ol className="space-y-1 text-sm">
            {list.map((t, i) => {
              const r = resultFor(t.id);
              return <li key={t.id}><button className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-slate-100 ${i === idx ? 'bg-brand-50 font-semibold' : ''}`} aria-current={i === idx} onClick={() => setIdx(i)}>
                <span><span className="font-mono text-xs">{t.tcId}</span> {t.title.slice(0, 40)}</span>{r ? <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge> : <Badge>Not run</Badge>}
              </button></li>;
            })}
          </ol>
        </Card>
        {tc && <Execute key={tc.id} tc={tc} runId={runId!} done={finished} existing={resultFor(tc.id)} onNext={() => setIdx(Math.min(idx + 1, list.length - 1))} />}
      </div>
    </>
  );
}

function Execute({ tc, runId, done, existing, onNext }: { tc: TestCase; runId: string; done: boolean; existing?: RunDetail['results'][number]; onNext: () => void }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const prev = new Map((existing?.stepResults ?? []).map((s) => [s.no, s]));
  const [steps, setSteps] = useState(tc.steps.map((s) => ({ no: s.no, status: (prev.get(s.no)?.status as string) ?? '', actual: prev.get(s.no)?.actual ?? '' })));
  const [notes, setNotes] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: () => api<{ id: string }>(`${xbase(current!.id)}/manual-runs/${runId}/results`, { method: 'POST', json: { testCaseId: tc.id, steps: steps.map((s) => ({ ...s, status: s.status || 'NotRun' })), notes: notes || undefined } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', runId] }),
  });
  const upload = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api(`${xbase(current!.id)}/manual-runs/${runId}/results/${existing?.id ?? save.data!.id}/attachments`, { method: 'POST', body: fd }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', runId] }),
  });
  const resultId = existing?.id ?? save.data?.id;
  const allMarked = steps.every((s) => s.status);
  return (
    <Card title={<>{tc.tcId} · {tc.title}</>}>
      {tc.preconditions && <p className="mb-2 text-sm"><strong>Pre-conditions:</strong> {tc.preconditions}</p>}
      {tc.testDataRef && <p className="mb-2 text-sm"><strong>Test data:</strong> {tc.testDataRef} (Test Data Sheet)</p>}
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <fieldset disabled={done}>
          <ol className="space-y-3">
            {tc.steps.map((s, i) => (
              <li key={s.no} className={`rounded border p-3 ${steps[i].status === 'Fail' ? 'border-red-300 bg-red-50' : steps[i].status === 'Pass' ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
                <p className="text-sm"><strong>Step {s.no}:</strong> {s.action}</p>
                <p className="text-sm text-slate-700"><strong>Expected:</strong> {s.expected}</p>
                <fieldset className="mt-2 flex flex-wrap gap-3 text-sm">
                  <legend className="sr-only">Result of step {s.no}</legend>
                  {STEP_STATUS.map((st) => <label key={st} className="flex items-center gap-1"><input type="radio" name={`step-${s.no}`} checked={steps[i].status === st} onChange={() => setSteps(steps.map((x, j) => (j === i ? { ...x, status: st } : x)))} /> {st}</label>)}
                </fieldset>
                {(steps[i].status === 'Fail' || steps[i].status === 'Blocked') && (
                  <div className="mt-2 flex flex-col gap-1">
                    <label htmlFor={`act-${s.no}`} className="text-xs font-medium">Actual result for step {s.no}</label>
                    <input id={`act-${s.no}`} required className="min-h-9 rounded border border-slate-400 px-2 text-sm" value={steps[i].actual} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, actual: e.target.value } : x)))} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-col gap-1"><label htmlFor="notes" className="text-sm font-medium">Notes</label><input id="notes" className="min-h-9 rounded border border-slate-400 px-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {save.error && <div className="mt-2"><Alert>{save.error.message}</Alert></div>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!allMarked || save.isPending}>Save result</Button>
            <Button type="button" variant="secondary" onClick={onNext}>Next test case</Button>
            {!allMarked && <span className="text-xs text-slate-600">Mark every step to save.</span>}
          </div>
        </fieldset>
      </form>
      {resultId && !done && (
        <div className="mt-4 border-t border-slate-200 pt-3">
          <label htmlFor="shot" className="text-sm font-medium">Attach screenshot (PNG, JPEG, GIF, WebP – max 10 MB)</label>
          <input id="shot" ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="mt-1 block text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
          {upload.isSuccess && <p role="status" className="text-xs text-green-800">Screenshot attached.</p>}
          {upload.error && <Alert>{upload.error.message}</Alert>}
          {existing && existing.attachments.length > 0 && <p className="text-xs text-slate-600">{existing.attachments.length} screenshot(s) attached.</p>}
        </div>
      )}
    </Card>
  );
}
