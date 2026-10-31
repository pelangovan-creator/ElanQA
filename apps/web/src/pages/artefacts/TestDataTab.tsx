import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import type { TestData } from '../../lib/types';
import { Alert, Button, Card, Field, Table } from '../../components/ui';
import { base, ExportButtons, lines, ReviewBar, ReviewStatus, useSelection } from './shared';

const BOUNDS = [['minMinus1', 'min-1'], ['min', 'min'], ['minPlus1', 'min+1'], ['maxMinus1', 'max-1'], ['max', 'max'], ['maxPlus1', 'max+1']] as const;

export function TestDataTab() {
  const { current, can } = useProject();
  const q = useQuery({ queryKey: ['test-data', current!.id], queryFn: () => api<TestData[]>(`${base(current!.id)}/test-data`) });
  const [open, setOpen] = useState<string | null>(null);
  const s = useSelection();
  const rows = q.data ?? [];
  return (
    <Card title={`Test Data Sheet (${rows.length})`} actions={<ExportButtons path="test-data" name="Test-Data-Sheet" />}>
      <Alert kind="info">All data is synthetic (example.com e-mails, fictional 555-01xx phones, public test cards). Account passwords live only in encrypted environment credentials. The Excel export drives data-driven automated tests.</Alert>
      <div className="mt-3"><ReviewBar entityType="TestDataItem" selected={s.sel} onDone={s.clear} allIds={rows.map((r) => r.id)} onSelectAll={s.setAll} /></div>
      <Table head={['', 'Data ID', 'Field', 'Type', 'Valid', 'Invalid', 'Boundaries', 'Used by', 'Review', '']} caption="Test data">
        {rows.map((d) => (
          <Fragment key={d.id}>
            <tr>
              <td className="px-2 py-2"><input type="checkbox" aria-label={`Select ${d.dataId}`} checked={s.sel.has(d.id)} onChange={() => s.toggle(d.id)} /></td>
              <td className="px-2 py-2 font-mono text-xs">{d.dataId}</td>
              <td className="px-2 py-2">{d.fieldName}</td>
              <td className="px-2 py-2 text-xs">{d.dataType}</td>
              <td className="max-w-56 break-words px-2 py-2 text-xs">{d.validValues.join(' · ')}</td>
              <td className="max-w-56 break-words px-2 py-2 text-xs">{d.invalidValues.join(' · ')}</td>
              <td className="max-w-64 break-words px-2 py-2 text-xs">{d.boundaryValues ? BOUNDS.filter(([k]) => d.boundaryValues![k]).map(([k, l]) => `${l}: ${d.boundaryValues![k]}`).join(' · ') : '—'}</td>
              <td className="px-2 py-2 font-mono text-xs">{d.tcIds.join(', ') || '—'}</td>
              <td className="px-2 py-2"><ReviewStatus item={d} /></td>
              <td className="px-2 py-2 text-right">{can('artefacts.edit') && <Button variant="ghost" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id)}>Edit<span className="sr-only"> {d.dataId}</span></Button>}</td>
            </tr>
            {open === d.id && <tr><td colSpan={10} className="bg-slate-50 p-3"><DataForm d={d} onDone={() => setOpen(null)} /></td></tr>}
          </Fragment>
        ))}
      </Table>
    </Card>
  );
}

function DataForm({ d, onDone }: { d: TestData; onDone: () => void }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({
    fieldName: d.fieldName, dataType: d.dataType, valid: d.validValues.join('\n'), invalid: d.invalidValues.join('\n'), specialChars: d.specialChars ?? '',
    emptyNull: d.emptyNull ?? '', expectedBehaviour: d.expectedBehaviour ?? '', environment: d.environment ?? '', notes: d.notes ?? '', bounds: { ...(d.boundaryValues ?? {}) } as Record<string, string>,
  });
  const m = useMutation({
    mutationFn: () => api(`${base(current!.id)}/test-data/${d.id}`, { method: 'PATCH', json: {
      fieldName: f.fieldName, dataType: f.dataType, validValues: lines(f.valid), invalidValues: lines(f.invalid), specialChars: f.specialChars, emptyNull: f.emptyNull,
      expectedBehaviour: f.expectedBehaviour, environment: f.environment, notes: f.notes, boundaryValues: f.bounds,
    } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['test-data'] }); onDone(); },
  });
  const ta = (id: string, label: string, v: string, on: (v: string) => void) => (
    <div className="flex flex-col gap-1"><label htmlFor={id} className="text-sm font-medium">{label}</label><textarea id={id} rows={4} className="rounded border border-slate-400 p-1 text-sm" value={v} onChange={(e) => on(e.target.value)} /></div>
  );
  return (
    <form className="grid grid-cols-1 gap-3 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Field name" value={f.fieldName} onChange={(e) => setF({ ...f, fieldName: e.target.value })} />
      <Field label="Data type" value={f.dataType} onChange={(e) => setF({ ...f, dataType: e.target.value })} />
      <Field label="Environment" value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })} />
      {ta(`v-${d.id}`, 'Valid values (one per line)', f.valid, (v) => setF({ ...f, valid: v }))}
      {ta(`i-${d.id}`, 'Invalid values (one per line)', f.invalid, (v) => setF({ ...f, invalid: v }))}
      <fieldset className="grid grid-cols-2 gap-1"><legend className="text-sm font-medium">Boundary values</legend>
        {BOUNDS.map(([k, l]) => <Field key={k} label={l} value={f.bounds[k] ?? ''} onChange={(e) => setF({ ...f, bounds: { ...f.bounds, [k]: e.target.value } })} />)}
      </fieldset>
      <Field label="Special characters" value={f.specialChars} onChange={(e) => setF({ ...f, specialChars: e.target.value })} />
      <Field label="Empty / null" value={f.emptyNull} onChange={(e) => setF({ ...f, emptyNull: e.target.value })} />
      <Field label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <div className="md:col-span-3"><Field label="Expected behaviour" value={f.expectedBehaviour} onChange={(e) => setF({ ...f, expectedBehaviour: e.target.value })} /></div>
      {m.error && <div className="md:col-span-3"><Alert>{m.error.message}</Alert></div>}
      <div><Button type="submit" disabled={m.isPending}>Save</Button></div>
    </form>
  );
}
