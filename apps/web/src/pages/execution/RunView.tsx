import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download } from '../../lib/api';
import { useBlobUrl } from '../../lib/blob';
import { useProject } from '../../lib/project';
import { RUN_MODE_LABEL, type AttachmentMeta, type RunDetail, type RunResult } from '../../lib/types';
import { Alert, Badge, Button, Card, PageHeader, Table } from '../../components/ui';
import { xbase } from './RunPanel';

export const STATUS_COLOR: Record<string, 'green' | 'red' | 'amber' | 'gray' | 'blue'> = { Pass: 'green', Fail: 'red', Blocked: 'amber', Skipped: 'gray', Completed: 'green', Running: 'blue', Queued: 'gray', Aborted: 'amber', Error: 'red' };
const KIND_LABEL: Record<string, string> = {
  FailureScreenshot: 'Screenshot at failure', FullPageScreenshot: 'Full-page screenshot', AnnotatedScreenshot: 'Annotated screenshot', Video: 'Video', Trace: 'Playwright trace',
  ConsoleLog: 'Console log', NetworkLog: 'Network log', Manual: 'Screenshot',
};

export function RunView() {
  const { runId } = useParams();
  const { current, can } = useProject();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['run', runId], queryFn: () => api<RunDetail>(`${xbase(current!.id)}/runs/${runId}`), enabled: !!current,
    refetchInterval: (query) => (['Queued', 'Running'].includes(query.state.data?.status ?? 'Queued') ? 1500 : false),
  });
  const abort = useMutation({ mutationFn: () => api(`${xbase(current!.id)}/runs/${runId}/abort`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['run', runId] }) });
  const logRef = useRef<HTMLPreElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [q.data?.log]);
  const r = q.data;
  if (!r) return <p role="status">Loading run…</p>;
  const done = r.passed + r.failed + r.blocked + r.skipped;
  const pct = r.total ? Math.round((done / r.total) * 100) : 0;
  const active = ['Queued', 'Running'].includes(r.status);

  return (
    <>
      <PageHeader title={`${r.runId} · ${r.kind === 'Manual' ? 'Manual run' : RUN_MODE_LABEL[r.mode] ?? r.mode}`}
        subtitle={`${r.environment?.name ?? 'No environment'}${r.environment?.baseUrl ? ` (${r.environment.baseUrl})` : ''} · build ${r.build ?? '—'} · by ${r.executedBy ?? '—'} · ${r.startedAt ? new Date(r.startedAt).toLocaleString() : ''}`}
        actions={<><Link to="/execution" className="inline-flex min-h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm">Back</Link>{active && r.kind === 'Automated' && can('execution.run') && <Button variant="danger" onClick={() => abort.mutate()}>Abort run</Button>}</>} />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge>
          <div className="min-w-64 flex-1">
            <div className="h-4 overflow-hidden rounded bg-slate-200" role="progressbar" aria-label="Execution progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="flex h-full" style={{ width: `${pct}%` }}>
                {(['passed', 'failed', 'blocked', 'skipped'] as const).map((k) => r[k] > 0 && <div key={k} className={{ passed: 'bg-green-600', failed: 'bg-red-600', blocked: 'bg-amber-500', skipped: 'bg-slate-400' }[k]} style={{ width: `${(r[k] / done) * 100}%` }} />)}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-600">{done} of {r.total} done ({pct}%)</p>
          </div>
          <p className="flex gap-2 text-sm" aria-live="polite">
            <Badge color="green">{r.passed} Pass</Badge><Badge color="red">{r.failed} Fail</Badge><Badge color="amber">{r.blocked} Blocked</Badge><Badge>{r.skipped} Skipped</Badge>
          </p>
        </div>
        {r.status === 'Completed' && r.failed > 0 && <p className="mt-2 text-sm"><Link className="font-semibold text-brand-700 underline" to={`/defects?run=${r.runId}`}>Review the draft defects created from {r.runId}</Link></p>}
        {r.summary?.notAutomated && r.summary.notAutomated.length > 0 && <p className="mt-2 text-xs text-slate-600">Not in this automated run (manual only): {r.summary.notAutomated.join(', ')}</p>}
      </Card>
      {r.kind === 'Automated' && (
        <Card title="Live log" className="mb-4">
          <pre ref={logRef} className="max-h-72 overflow-auto rounded bg-slate-900 p-3 text-xs leading-5 text-slate-100" tabIndex={0} role="region" aria-label="Run log">{r.log}</pre>
        </Card>
      )}
      <Card title={`Results (${r.results.length})`}>
        {abort.error && <Alert>{abort.error.message}</Alert>}
        <Table head={['TC', 'Title', 'Browser', 'Status', 'Duration', 'Evidence', '']} caption="Run results">
          {r.results.map((x) => (
            <Fragment key={x.id}>
              <tr className={x.status === 'Fail' ? 'bg-red-50/60' : undefined}>
                <td className="px-2 py-2 font-mono text-xs">{x.testCase.tcId}</td>
                <td className="px-2 py-2">{x.testCase.title}{x.status !== 'Pass' && x.error && <p className="mt-1 line-clamp-2 text-xs text-red-800">{x.error.split('\n')[0]}</p>}</td>
                <td className="px-2 py-2 text-xs">{x.browser}</td>
                <td className="px-2 py-2"><Badge color={STATUS_COLOR[x.status]}>{x.status}</Badge></td>
                <td className="px-2 py-2 text-xs">{x.durationMs != null ? `${(x.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                <td className="px-2 py-2 text-xs">{x.attachments.length || '—'}</td>
                <td className="px-2 py-2 text-right"><Button variant="ghost" aria-expanded={open === x.id} onClick={() => setOpen(open === x.id ? null : x.id)}>Details<span className="sr-only"> {x.testCase.tcId}</span></Button></td>
              </tr>
              {open === x.id && <tr><td colSpan={7} className="bg-slate-50 p-3"><ResultDetail result={x} /></td></tr>}
            </Fragment>
          ))}
        </Table>
        {!r.results.length && <p className="mt-2 text-sm text-slate-600">{active ? 'Waiting for the first result…' : 'No results.'}</p>}
      </Card>
    </>
  );
}

function ResultDetail({ result }: { result: RunResult }) {
  const images = result.attachments.filter((a) => a.mimeType.startsWith('image/'));
  const files = result.attachments.filter((a) => !a.mimeType.startsWith('image/'));
  return (
    <div className="space-y-3">
      {result.error && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-red-900">{result.error}</pre>}
      {result.stepResults.length > 0 && (
        <ol className="space-y-0.5 text-xs">
          {result.stepResults.map((s, i) => (
            <li key={i} className={s.error || s.status === 'Fail' ? 'text-red-800' : ''}>
              {s.error || s.status === 'Fail' ? '✗' : '✓'} {s.title ?? `Step ${s.no}: ${result.testCase.steps.find((t) => t.no === s.no)?.action ?? ''}`}{s.actual ? ` – ${s.actual}` : ''}{s.error ? ` – ${s.error.split('\n')[0]}` : ''}
            </li>
          ))}
        </ol>
      )}
      {images.length > 0 && <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{images.map((a) => <Thumb key={a.id} a={a} />)}</div>}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((a) => <EvidenceButton key={a.id} a={a} />)}
        </div>
      )}
      {files.some((a) => a.kind === 'Trace') && <p className="text-xs text-slate-600">Open a trace with <code>npx playwright show-trace trace.zip</code> or at trace.playwright.dev.</p>}
    </div>
  );
}

function EvidenceButton({ a }: { a: AttachmentMeta }) {
  const { current } = useProject();
  return <Button variant="secondary" onClick={() => download(`${xbase(current!.id)}/attachments/${a.id}`, a.fileName)}>{KIND_LABEL[a.kind] ?? a.kind} ({Math.ceil(a.sizeBytes / 1024)} KB)</Button>;
}

function Thumb({ a }: { a: AttachmentMeta }) {
  const { current } = useProject();
  const url = useBlobUrl(`${xbase(current!.id)}/attachments/${a.id}`);
  return (
    <figure className="rounded border border-slate-200 bg-white p-2">
      {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${KIND_LABEL[a.kind] ?? a.kind} for this result`} className="max-h-48 w-full object-contain" /></a> : <div className="h-32 animate-pulse bg-slate-100" />}
      <figcaption className="mt-1 text-xs text-slate-600">{KIND_LABEL[a.kind] ?? a.kind}</figcaption>
    </figure>
  );
}

export function RunHistory() {
  const { current } = useProject();
  const q = useQuery({ queryKey: ['runs', current!.id], queryFn: () => api<import('../../lib/types').RunSummary[]>(`${xbase(current!.id)}/runs`), refetchInterval: 5000 });
  return (
    <Card title="Execution history">
      <Table head={['Run', 'Type', 'Environment', 'Build', 'Status', 'Pass', 'Fail', 'Blocked', 'Skipped', 'Started', '']} caption="Test runs">
        {q.data?.map((r) => (
          <tr key={r.id}>
            <td className="px-2 py-2 font-mono text-xs">{r.runId}</td>
            <td className="px-2 py-2 text-xs">{r.kind === 'Manual' ? 'Manual' : RUN_MODE_LABEL[r.mode] ?? r.mode}</td>
            <td className="px-2 py-2 text-xs">{r.environment ? `${r.environment.name} (${r.environment.envType})` : '—'}</td>
            <td className="px-2 py-2 text-xs">{r.build ?? '—'}</td>
            <td className="px-2 py-2"><Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge></td>
            <td className="px-2 py-2 text-xs">{r.passed}</td><td className="px-2 py-2 text-xs font-semibold text-red-800">{r.failed || ''}</td>
            <td className="px-2 py-2 text-xs">{r.blocked || ''}</td><td className="px-2 py-2 text-xs">{r.skipped || ''}</td>
            <td className="px-2 py-2 text-xs">{new Date(r.startedAt ?? r.createdAt).toLocaleString()}</td>
            <td className="px-2 py-2 text-right"><Link className="text-sm text-brand-700 underline" to={r.kind === 'Manual' && r.status === 'Running' ? `/execution/manual/${r.id}` : `/execution/runs/${r.id}`}>Open<span className="sr-only"> {r.runId}</span></Link></td>
          </tr>
        ))}
      </Table>
      {q.data?.length === 0 && <p className="mt-2 text-sm text-slate-600">No runs yet.</p>}
    </Card>
  );
}
