import { FormEvent, Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import { PRIORITY_LEVELS, Q_CATEGORIES, type FullQuestion } from '../../lib/types';
import { Alert, Badge, Button, Card, Field, Select, Table } from '../../components/ui';
import { base, ExportButtons, ReviewBar, ReviewStatus, useSelection } from './shared';

const CAT_LABEL: Record<string, string> = { Ambiguity: 'Ambiguity', MissingInfo: 'Missing info', Conflict: 'Conflict', Assumption: 'Assumption', EdgeCase: 'Edge case' };

export function Clarifications() {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string[] | null>(null);
  const s = useSelection();
  const params = new URLSearchParams({ ...(status && { status }), ...(category && { category }) });
  const q = useQuery({ queryKey: ['clarifications', current!.id, params.toString()], queryFn: () => api<FullQuestion[]>(`${base(current!.id)}/clarifications?${params}`) });
  const detect = useMutation({
    mutationFn: () => api<{ created: number; conflicts: number; gaps: number }>(`${base(current!.id)}/clarifications/detect`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clarifications'] }),
  });
  const regen = useMutation({
    mutationFn: () => api<{ replaced: number; generated: number; manual: string[] }>(`${base(current!.id)}/design/regenerate`, { method: 'POST', json: {} }),
    onSuccess: () => { setNotice(null); qc.invalidateQueries(); },
  });
  const rows = q.data ?? [];

  return (
    <Card title="Clarification Log – questions for understanding" actions={<ExportButtons path="clarifications" name="Clarification-Log" />}>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        {can('artefacts.edit') && <Button onClick={() => detect.mutate()} disabled={detect.isPending}>{detect.isPending ? 'Analysing…' : 'Detect conflicts & gaps'}</Button>}
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['Open', 'Answered', 'Closed'].map((x) => <option key={x}>{x}</option>)}</Select>
        <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{Q_CATEGORIES.map((x) => <option key={x} value={x}>{CAT_LABEL[x]}</option>)}</Select>
      </div>
      {detect.data && <Alert kind="success">{detect.data.created} new questions ({detect.data.conflicts} conflicts, {detect.data.gaps} gaps / edge cases).</Alert>}
      {notice && notice.length > 0 && (
        <div className="my-2"><Alert>
          The answer affects {notice.join(', ')}. These test cases are flagged for regeneration.{' '}
          <Button variant="secondary" onClick={() => regen.mutate()} disabled={regen.isPending}>Regenerate affected test cases now</Button>
        </Alert></div>
      )}
      {regen.data && <Alert kind="success">{regen.data.replaced} test cases replaced by {regen.data.generated} regenerated ones.{regen.data.manual.length ? ` Update manually (approved/executed/manual): ${regen.data.manual.join(', ')}` : ''}</Alert>}
      <ReviewBar entityType="ClarificationQuestion" selected={s.sel} onDone={s.clear} allIds={rows.map((r) => r.id)} onSelectAll={s.setAll} />
      <Table head={['', 'Q-ID', 'Req', 'Question', 'Category', 'Priority', 'Status', 'Review', '']} caption="Clarification questions">
        {rows.map((x) => (
          <Fragment key={x.id}>
            <tr className={x.status === 'Open' && x.priority === 'High' ? 'bg-red-50/50' : undefined}>
              <td className="px-2 py-2"><input type="checkbox" aria-label={`Select ${x.qId}`} checked={s.sel.has(x.id)} onChange={() => s.toggle(x.id)} /></td>
              <td className="px-2 py-2 font-mono text-xs">{x.qId}</td>
              <td className="px-2 py-2 font-mono text-xs">{x.requirement?.reqId ?? '—'}</td>
              <td className="px-2 py-2">{x.question}{x.clientAnswer && <p className="mt-1 text-xs text-green-800">Answer: {x.clientAnswer}</p>}</td>
              <td className="px-2 py-2 text-xs">{CAT_LABEL[x.category] ?? x.category}</td>
              <td className="px-2 py-2"><Badge color={x.priority === 'High' ? 'red' : x.priority === 'Medium' ? 'amber' : 'gray'}>{x.priority}</Badge></td>
              <td className="px-2 py-2"><Badge color={x.status === 'Open' ? 'amber' : 'green'}>{x.status}</Badge></td>
              <td className="px-2 py-2"><ReviewStatus item={x} /></td>
              <td className="px-2 py-2 text-right">{can('artefacts.edit') && <Button variant="ghost" aria-expanded={open === x.id} onClick={() => setOpen(open === x.id ? null : x.id)}>Edit<span className="sr-only"> {x.qId}</span></Button>}</td>
            </tr>
            {open === x.id && <tr><td colSpan={9} className="bg-slate-50 p-3"><QuestionForm q={x} onSaved={(affected) => { setOpen(null); setNotice(affected); }} /></td></tr>}
          </Fragment>
        ))}
      </Table>
      {can('artefacts.edit') && <NewQuestion />}
    </Card>
  );
}

function QuestionForm({ q, onSaved }: { q: FullQuestion; onSaved: (affected: string[]) => void }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({ question: q.question, category: q.category, priority: q.priority, status: q.status, assignedTo: q.assignedTo ?? '', clientAnswer: q.clientAnswer ?? '', impact: q.impact ?? '' });
  const m = useMutation({
    mutationFn: () => api<{ affectedTestCases: string[] }>(`${base(current!.id)}/clarifications/${q.id}`, { method: 'PATCH', json: { ...f, clientAnswer: f.clientAnswer || null, impact: f.impact || null, assignedTo: f.assignedTo || null } }),
    onSuccess: (r) => { qc.invalidateQueries(); onSaved(r.affectedTestCases); },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-3 md:grid-cols-3" onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }}>
      <div className="md:col-span-3 flex flex-col gap-1">
        <label htmlFor={`q-${q.id}`} className="text-sm font-medium">Question</label>
        <textarea id={`q-${q.id}`} rows={2} className="rounded-md border border-slate-400 p-2 text-sm" value={f.question} onChange={set('question')} />
      </div>
      <Select label="Category" value={f.category} onChange={set('category')}>{Q_CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</Select>
      <Select label="Priority" value={f.priority} onChange={set('priority')}>{PRIORITY_LEVELS.map((c) => <option key={c}>{c}</option>)}</Select>
      <Select label="Status" value={f.status} onChange={set('status')}>{['Open', 'Answered', 'Closed'].map((c) => <option key={c}>{c}</option>)}</Select>
      <Field label="Assigned to (client contact)" value={f.assignedTo} onChange={set('assignedTo')} />
      <div className="md:col-span-2 flex flex-col gap-1">
        <label htmlFor={`a-${q.id}`} className="text-sm font-medium">Client answer</label>
        <textarea id={`a-${q.id}`} rows={2} className="rounded-md border border-slate-400 p-2 text-sm" value={f.clientAnswer} onChange={set('clientAnswer')} />
      </div>
      <div className="md:col-span-3"><Field label="Impact on test cases" value={f.impact} onChange={set('impact')} hint="Filled automatically with the affected test cases when an answer is recorded." /></div>
      {m.error && <div className="md:col-span-3"><Alert>{m.error.message}</Alert></div>}
      <div className="md:col-span-3"><Button type="submit" disabled={m.isPending}>Save</Button></div>
    </form>
  );
}

function NewQuestion() {
  const { current } = useProject();
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('MissingInfo');
  const m = useMutation({
    mutationFn: () => api(`${base(current!.id)}/clarifications`, { method: 'POST', json: { question, category } }),
    onSuccess: () => { setQuestion(''); qc.invalidateQueries({ queryKey: ['clarifications'] }); },
  });
  return (
    <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="min-w-80 flex-1"><Field label="New question" value={question} onChange={(e) => setQuestion(e.target.value)} required minLength={5} /></div>
      <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>{Q_CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</Select>
      <Button type="submit" disabled={m.isPending || question.trim().length < 5}>Add question</Button>
      {m.error && <Alert>{m.error.message}</Alert>}
    </form>
  );
}
