import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import { PRIORITY_LEVELS, SCENARIO_TYPES, type Scenario } from '../../lib/types';
import { Alert, Badge, Button, Card, Field, Select, Table } from '../../components/ui';
import { base, ExportButtons, ReviewBar, ReviewStatus, useSelection } from './shared';

export function Scenarios() {
  const { current, can } = useProject();
  const q = useQuery({ queryKey: ['scenarios', current!.id], queryFn: () => api<Scenario[]>(`${base(current!.id)}/scenarios`) });
  const [open, setOpen] = useState<string | null>(null);
  const [module, setModule] = useState('');
  const s = useSelection();
  const rows = (q.data ?? []).filter((x) => !module || x.module === module);
  const modules = [...new Set((q.data ?? []).map((x) => x.module))];
  return (
    <Card title={`Test Scenarios (${q.data?.length ?? 0})`} actions={<ExportButtons path="scenarios" name="Test-Scenarios" />}>
      <div className="mb-3"><Select label="Module" value={module} onChange={(e) => setModule(e.target.value)}><option value="">All</option>{modules.map((m) => <option key={m}>{m}</option>)}</Select></div>
      <ReviewBar entityType="TestScenario" selected={s.sel} onDone={s.clear} allIds={rows.map((r) => r.id)} onSelectAll={s.setAll} />
      <Table head={['', 'ID', 'Module', 'Requirement IDs', 'Description', 'Type', 'Priority', 'TCs', 'Review', '']} caption="Test scenarios">
        {rows.map((x) => (
          <Fragment key={x.id}>
            <tr>
              <td className="px-2 py-2"><input type="checkbox" aria-label={`Select ${x.scenarioId}`} checked={s.sel.has(x.id)} onChange={() => s.toggle(x.id)} /></td>
              <td className="px-2 py-2 font-mono text-xs">{x.scenarioId}</td>
              <td className="px-2 py-2 text-xs">{x.module}</td>
              <td className="px-2 py-2 font-mono text-xs">{x.requirements.map((r) => r.reqId).join(', ')}</td>
              <td className="px-2 py-2">{x.description}</td>
              <td className="px-2 py-2"><Badge color={x.scenarioType === 'Negative' ? 'red' : x.scenarioType === 'Edge' ? 'amber' : x.scenarioType === 'EndToEnd' ? 'blue' : 'green'}>{x.scenarioType}</Badge></td>
              <td className="px-2 py-2 text-xs">{x.priority}</td>
              <td className="px-2 py-2 text-xs">{x._count.testCases}</td>
              <td className="px-2 py-2"><ReviewStatus item={x} /></td>
              <td className="px-2 py-2 text-right">{can('artefacts.edit') && <Button variant="ghost" aria-expanded={open === x.id} onClick={() => setOpen(open === x.id ? null : x.id)}>Edit<span className="sr-only"> {x.scenarioId}</span></Button>}</td>
            </tr>
            {open === x.id && <tr><td colSpan={10} className="bg-slate-50 p-3"><ScenarioForm s={x} onDone={() => setOpen(null)} /></td></tr>}
          </Fragment>
        ))}
      </Table>
    </Card>
  );
}

function ScenarioForm({ s, onDone }: { s: Scenario; onDone: () => void }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({ module: s.module, description: s.description, scenarioType: s.scenarioType, priority: s.priority, preconditions: s.preconditions ?? '' });
  const save = useMutation({ mutationFn: () => api(`${base(current!.id)}/scenarios/${s.id}`, { method: 'PATCH', json: f }), onSuccess: () => { qc.invalidateQueries(); onDone(); } });
  const del = useMutation({ mutationFn: () => api(`${base(current!.id)}/scenarios/${s.id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries(); onDone(); } });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid grid-cols-1 gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Module" value={f.module} onChange={set('module')} />
      <Select label="Type" value={f.scenarioType} onChange={set('scenarioType')}>{SCENARIO_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
      <Select label="Priority" value={f.priority} onChange={set('priority')}>{PRIORITY_LEVELS.map((t) => <option key={t}>{t}</option>)}</Select>
      <div className="md:col-span-4"><Field label="Description" value={f.description} onChange={set('description')} /></div>
      <div className="md:col-span-4"><Field label="Pre-conditions" value={f.preconditions} onChange={set('preconditions')} /></div>
      {(save.error || del.error) && <div className="md:col-span-4"><Alert>{(save.error ?? del.error)!.message}</Alert></div>}
      <div className="md:col-span-4 flex gap-2"><Button type="submit">Save</Button><Button type="button" variant="danger" onClick={() => { if (confirm(`Delete ${s.scenarioId}? Its test cases are kept but unlinked.`)) del.mutate(); }}>Delete</Button></div>
    </form>
  );
}
