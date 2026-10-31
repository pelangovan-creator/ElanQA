import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import type { DocArtefact } from '../../lib/types';
import { Alert, Button, Card } from '../../components/ui';
import { base, ExportButtons, ReviewBar, ReviewStatus } from './shared';

/** Test Plan / Test Techniques document: generate from project data, edit section by section, review, export. */
export function DocTab({ type, name }: { type: 'TestPlan' | 'TestTechniques'; name: string }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['doc', current!.id, type], queryFn: () => api<DocArtefact | null>(`${base(current!.id)}/docs/${type}`) });
  const gen = useMutation({ mutationFn: () => api(`${base(current!.id)}/docs/${type}/generate`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['doc'] }) });
  const [editing, setEditing] = useState<string | null>(null);
  const doc = q.data;
  const fileName = type === 'TestPlan' ? 'Test-Plan' : 'Test-Techniques';

  return (
    <Card title={<>{name}{doc && <> · v{doc.version} <ReviewStatus item={doc} /></>}</>} actions={doc && <ExportButtons path={`docs/${type}`} name={fileName} />}>
      {can('artefacts.edit') && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => { if (!doc || confirm('Regenerating replaces all section text with fresh project data (a new version). Continue?')) gen.mutate(); }} disabled={gen.isPending}>
            {doc ? 'Regenerate from project data' : `Generate ${name}`}
          </Button>
          {gen.error && <Alert>{gen.error.message}</Alert>}
        </div>
      )}
      {doc && <ReviewBar entityType="Artefact" selected={new Set([doc.id])} onDone={() => qc.invalidateQueries({ queryKey: ['doc'] })} />}
      {!doc && <p className="text-sm text-slate-600">Not generated yet.</p>}
      <div className="space-y-4">
        {doc?.content.sections.map((s, i) => (
          <section key={s.key} aria-labelledby={`h-${s.key}`} className="rounded border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 id={`h-${s.key}`} className="font-semibold">{i + 1}. {s.heading}</h3>
              {can('artefacts.edit') && editing !== s.key && <Button variant="ghost" onClick={() => setEditing(s.key)}>Edit<span className="sr-only"> {s.heading}</span></Button>}
            </div>
            {editing === s.key ? <SectionEditor type={type} sectionKey={s.key} heading={s.heading} body={s.body} onDone={() => setEditing(null)} /> : <Body text={s.body} />}
          </section>
        ))}
      </div>
    </Card>
  );
}

function Body({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) out.push(<ul key={out.length} className="list-disc pl-5">{list.map((l, i) => <li key={i}>{l}</li>)}</ul>); list = []; };
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) list.push(line.slice(2));
    else { flush(); if (line.trim()) out.push(<p key={out.length}>{line}</p>); }
  }
  flush();
  return <div className="mt-2 space-y-1 text-sm">{out}</div>;
}

function SectionEditor({ type, sectionKey, heading, body, onDone }: { type: string; sectionKey: string; heading: string; body: string; onDone: () => void }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const [v, setV] = useState(body);
  const m = useMutation({ mutationFn: () => api(`${base(current!.id)}/docs/${type}/sections/${sectionKey}`, { method: 'PATCH', json: { body: v } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['doc'] }); onDone(); } });
  return (
    <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <label htmlFor={`sec-${sectionKey}`} className="text-xs text-slate-600">Edit “{heading}” – start a line with “- ” for a bullet.</label>
      <textarea id={`sec-${sectionKey}`} rows={Math.min(20, v.split('\n').length + 2)} className="w-full rounded border border-slate-400 p-2 font-mono text-sm" value={v} onChange={(e) => setV(e.target.value)} />
      {m.error && <Alert>{m.error.message}</Alert>}
      <div className="flex gap-2"><Button type="submit" disabled={m.isPending}>Save section</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}
