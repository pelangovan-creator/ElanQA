import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import type { ScriptSummary } from '../../lib/types';
import { Alert, Badge, Button, Card } from '../../components/ui';
import { xbase } from './RunPanel';

const KIND = { config: 'Configuration', support: 'Support library', pageObject: 'Page Objects', data: 'Test data', spec: 'Test specs' } as Record<string, string>;

export function Scripts() {
  const { current } = useProject();
  const q = useQuery({ queryKey: ['scripts', current!.id], queryFn: () => api<ScriptSummary[]>(`${xbase(current!.id)}/scripts`) });
  const [sel, setSel] = useState<string | null>(null);
  const groups = Object.keys(KIND).map((k) => [k, (q.data ?? []).filter((s) => s.kind === k)] as const).filter(([, v]) => v.length);
  if (q.data?.length === 0) return <Alert kind="info">No scripts yet. Generate them on the Run tab.</Alert>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card title="Playwright project">
        <nav aria-label="Script files" className="max-h-[70vh] overflow-auto text-sm">
          {groups.map(([k, files]) => (
            <div key={k} className="mb-3">
              <h3 className="mb-1 text-xs font-semibold uppercase text-slate-600">{KIND[k]} ({files.length})</h3>
              <ul>{files.map((f) => (
                <li key={f.id}><button className={`w-full rounded px-2 py-1 text-left font-mono text-xs hover:bg-slate-100 ${sel === f.id ? 'bg-brand-50 font-semibold' : ''}`} aria-current={sel === f.id} onClick={() => setSel(f.id)}>
                  {f.path}{!f.aiGenerated && <span className="ml-1 text-[10px] text-amber-800">edited</span>}
                </button></li>
              ))}</ul>
            </div>
          ))}
        </nav>
      </Card>
      {sel ? <Editor key={sel} id={sel} /> : <Card><p className="text-sm text-slate-600">Select a file to view or edit it.</p></Card>}
    </div>
  );
}

function Editor({ id }: { id: string }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['script', id], queryFn: () => api<{ path: string; content: string; aiGenerated: boolean; updatedAt: string }>(`${xbase(current!.id)}/scripts/${id}`) });
  const [text, setText] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => api(`${xbase(current!.id)}/scripts/${id}`, { method: 'PATCH', json: { content: text } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['scripts'] }); qc.invalidateQueries({ queryKey: ['script', id] }); setText(null); } });
  if (!q.data) return <Card><p role="status">Loading…</p></Card>;
  const value = text ?? q.data.content;
  return (
    <Card title={<span className="font-mono text-sm">{q.data.path} {q.data.aiGenerated ? <Badge color="amber">Generated</Badge> : <Badge color="blue">Edited – kept on regeneration</Badge>}</span>}
      actions={can('execution.run') && <Button disabled={text === null || save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      {save.error && <Alert>{save.error.message}</Alert>}
      <label htmlFor="code" className="sr-only">Contents of {q.data.path}</label>
      <textarea id="code" spellCheck={false} readOnly={!can('execution.run')} className="h-[65vh] w-full rounded border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100" value={value}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); const t = e.currentTarget; const s = t.selectionStart; setText(value.slice(0, s) + '  ' + value.slice(t.selectionEnd)); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; }); } }} />
      <p className="mt-1 text-xs text-slate-600">Tab inserts two spaces; press Esc then Tab to leave the editor. QA Pilot runs files exactly as saved.</p>
    </Card>
  );
}
