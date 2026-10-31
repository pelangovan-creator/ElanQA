import { ReactNode, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, download } from '../../lib/api';
import { useProject } from '../../lib/project';
import { Alert, Badge, Button } from '../../components/ui';
import { AiBadge } from '../../components/AiBadge';

export const base = (projectId: string) => `/projects/${projectId}/artefacts`;

export function ExportButtons({ path, name, fullPath }: { path?: string; name: string; fullPath?: string }) {
  const { current } = useProject();
  const [err, setErr] = useState<string | null>(null);
  const url = fullPath ?? `${base(current!.id)}/${path}/export`;
  const go = (f: string) => download(`${url}?format=${f}`, `${name}.${f}`).catch((e) => setErr(e.message));
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Export ${name}`}>
      <span className="text-xs text-slate-600">Export:</span>
      <Button variant="secondary" onClick={() => go('xlsx')}>Excel</Button>
      <Button variant="secondary" onClick={() => go('pdf')}>PDF</Button>
      <Button variant="secondary" onClick={() => go('docx')}>Word</Button>
      {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
    </div>
  );
}

export function ReviewStatus({ item }: { item: { aiGenerated: boolean; reviewStatus: string; reviewComment?: string | null } }) {
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {item.reviewStatus === 'Approved' && <Badge color="green">Approved</Badge>}
      {item.reviewStatus === 'Rejected' && <Badge color="red">Rejected</Badge>}
      {item.reviewStatus === 'PendingReview' && (item.aiGenerated ? <AiBadge aiGenerated reviewStatus="PendingReview" /> : <Badge>Pending review</Badge>)}
      {item.reviewStatus === 'Rejected' && item.reviewComment && <span className="text-xs text-red-800">“{item.reviewComment}”</span>}
    </span>
  );
}

/** Selection state + bulk approve/reject bar (QA Lead / Admin). */
export function useSelection() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  return {
    sel,
    toggle: (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    setAll: (ids: string[], on: boolean) => setSel(on ? new Set(ids) : new Set()),
    clear: () => setSel(new Set()),
  };
}

export function SelectAll({ ids, sel, setAll, label }: { ids: string[]; sel: Set<string>; setAll: (ids: string[], on: boolean) => void; label: string }) {
  const all = ids.length > 0 && ids.every((i) => sel.has(i));
  return <input type="checkbox" aria-label={`Select all ${label}`} checked={all} onChange={(e) => setAll(ids, e.target.checked)} />;
}

export function ReviewBar({ entityType, selected, onDone, extra, allIds, onSelectAll }: { entityType: string; selected: Set<string>; onDone: () => void; extra?: ReactNode; allIds?: string[]; onSelectAll?: (ids: string[], on: boolean) => void }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const m = useMutation({
    mutationFn: (action: 'Approve' | 'Reject') => api(`${base(current!.id)}/review`, { method: 'POST', json: { entityType, ids: [...selected], action, comment: comment || undefined } }),
    onSuccess: () => { setComment(''); onDone(); qc.invalidateQueries(); },
  });
  if (!can('artefacts.review') && !extra) return null;
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      {allIds && onSelectAll && <label className="flex items-center gap-1 text-sm"><SelectAll ids={allIds} sel={selected} setAll={onSelectAll} label="rows" /> Select all</label>}
      <span className="text-sm" aria-live="polite">{selected.size} selected</span>
      {can('artefacts.review') && (
        <>
          <div className="flex flex-col">
            <label htmlFor={`rc-${entityType}`} className="text-xs text-slate-700">Review comment (required to reject)</label>
            <input id={`rc-${entityType}`} className="min-h-9 w-72 rounded border border-slate-400 px-2 text-sm" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <Button disabled={!selected.size || m.isPending} onClick={() => m.mutate('Approve')}>Approve</Button>
          <Button variant="danger" disabled={!selected.size || !comment.trim() || m.isPending} onClick={() => m.mutate('Reject')}>Reject</Button>
        </>
      )}
      {extra}
      {m.error && <Alert>{m.error.message}</Alert>}
    </div>
  );
}

export const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);
