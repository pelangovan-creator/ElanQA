import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download } from '../lib/api';
import { useBlobUrl } from '../lib/blob';
import { useProject } from '../lib/project';
import type { DefectDetail } from '../lib/types';
import { Alert, Button, Field } from '../components/ui';
import { dbase } from './Defects';

interface Guide {
  defectId: string; jiraPriority: string; description: string; evidenceCount: number;
  steps: { no: number; title: string; instruction: string; values: { label: string; value: string; copy?: boolean }[] }[];
}

/** One-click manual guide: create this defect in Jira by hand (QA Pilot does not connect to Jira). */
export function JiraGuide({ d, onClose }: { d: DefectDetail; onClose: () => void }) {
  const { current, can } = useProject();
  const q = useQuery({ queryKey: ['jira-guide', d.id, d.title, d.priority, d.assignedTo], queryFn: () => api<Guide>(`${dbase(current!.id)}/${d.id}/jira-guide`) });
  const heading = useRef<HTMLHeadingElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const dl = (path: string, name: string) => download(`${dbase(current!.id)}/${d.id}/${path}`, name).catch((e) => setErr(e.message));

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-900/50 px-4" role="dialog" aria-modal="true" aria-labelledby="jg-title">
      <div className="mx-auto my-4 max-w-5xl rounded-lg bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-slate-200 bg-white p-4">
          <div>
            <h2 id="jg-title" ref={heading} tabIndex={-1} className="text-lg font-bold">Create {d.defectId} in Jira – step by step</h2>
            <p className="text-sm text-slate-600">QA Pilot does not connect to Jira. Follow the steps; every value below is ready to copy.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(q.data?.evidenceCount ?? 0) > 0 && <Button onClick={() => dl('evidence.zip', `${d.defectId}-evidence.zip`)}>Download evidence (ZIP)</Button>}
            <Button variant="secondary" onClick={() => dl('jira-guide/export?format=pdf', `${d.defectId}-Jira-guide.pdf`)}>Guide as PDF</Button>
            <Button variant="secondary" onClick={() => dl('jira-guide/export?format=docx', `${d.defectId}-Jira-guide.docx`)}>Guide as Word</Button>
            <Button variant="ghost" onClick={onClose}>Close<span className="sr-only"> the Jira guide</span></Button>
          </div>
        </header>
        <div className="space-y-6 p-4">
          {err && <Alert>{err}</Alert>}
          {!q.data && <p role="status">{q.error ? q.error.message : 'Preparing the guide…'}</p>}
          <ol className="space-y-6">
            {q.data?.steps.map((s) => (
              <li key={s.no} className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_1.4fr]">
                <div>
                  <h3 className="text-base font-semibold"><span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-sm text-white" aria-hidden="true">{s.no}</span>Step {s.no}: {s.title}</h3>
                  <p className="mt-2 text-sm">{s.instruction}</p>
                  {s.values.length > 0 && (
                    <dl className="mt-3 space-y-2">
                      {s.values.map((v) => (
                        <div key={v.label} className="rounded bg-slate-50 p-2">
                          <dt className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">{v.label}{v.copy && <CopyButton text={v.value} label={v.label} />}</dt>
                          <dd className={`mt-1 text-sm ${v.value.includes('\n') ? 'max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs' : ''}`}>{v.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {s.no === 9 && (q.data?.evidenceCount ?? 0) > 0 && <Button className="mt-3" variant="secondary" onClick={() => dl('evidence.zip', `${d.defectId}-evidence.zip`)}>Download evidence (ZIP)</Button>}
                  {s.no === 11 && can('defects.update') && <JiraKeyForm d={d} />}
                </div>
                <StepImage defectId={d.id} no={s.no} title={s.title} version={`${d.title}|${d.priority}|${d.assignedTo}|${d.attachments.length}`} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function StepImage({ defectId, no, title, version }: { defectId: string; no: number; title: string; version: string }) {
  const { current } = useProject();
  const url = useBlobUrl(`${dbase(current!.id)}/${defectId}/jira-guide/steps/${no}.png?v=${encodeURIComponent(version)}`);
  return (
    <figure>
      {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Illustration of step ${no}: ${title}. The field to use is outlined in red.`} className="w-full rounded border border-slate-200" /></a>
        : <div className="aspect-[16/10] w-full animate-pulse rounded bg-slate-100" />}
      <figcaption className="mt-1 text-xs text-slate-600">Illustration – your Jira screen may look different. Click to enlarge.</figcaption>
    </figure>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-slate-100"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? 'Copied ✓' : 'Copy'}<span className="sr-only"> {label}</span>
    </button>
  );
}

function JiraKeyForm({ d }: { d: DefectDetail }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const [key, setKey] = useState(d.jiraKey ?? '');
  const [url, setUrl] = useState(d.jiraUrl ?? '');
  const m = useMutation({
    mutationFn: () => api(`${dbase(current!.id)}/${d.id}`, { method: 'PATCH', json: { jiraKey: key.trim().toUpperCase() || null, jiraUrl: url.trim() || null } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['defect', d.id] }),
  });
  return (
    <form className="mt-3 space-y-2 rounded border border-green-300 bg-green-50 p-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="text-sm font-semibold">Jira ticket for {d.defectId}</p>
      <Field label="Jira key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="PROJ-123" />
      <Field label="Ticket link (optional)" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-site.atlassian.net/browse/PROJ-123" />
      {m.error && <Alert>{m.error.message}</Alert>}
      {m.isSuccess && <Alert kind="success">Saved – {d.defectId} now shows the Jira key.</Alert>}
      <Button type="submit" disabled={m.isPending}>Save Jira key</Button>
    </form>
  );
}
