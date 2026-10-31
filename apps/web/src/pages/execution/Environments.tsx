import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import { BROWSERS, type Environment } from '../../lib/types';
import { Alert, Badge, Button, Card, Field, Select } from '../../components/ui';
import { xbase } from './RunPanel';

export function Environments() {
  const { current, can } = useProject();
  const q = useQuery({ queryKey: ['environments', current!.id], queryFn: () => api<Environment[]>(`${xbase(current!.id)}/environments`) });
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {q.data?.map((e) => edit === e.id ? <EnvForm key={e.id} env={e} onDone={() => setEdit(null)} /> : (
        <Card key={e.id} title={<>{e.name} <Badge>{e.envType}</Badge></>} actions={can('execution.run') && <Button variant="secondary" onClick={() => setEdit(e.id)}>Edit<span className="sr-only"> {e.name}</span></Button>}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-2">
            <div><dt className="inline font-semibold">URL: </dt><dd className="inline">{e.baseUrl}</dd></div>
            <div><dt className="inline font-semibold">Browsers: </dt><dd className="inline">{e.browsers.join(', ')} · viewport {e.viewport ?? '1366x768'}</dd></div>
            <div><dt className="inline font-semibold">Parallel workers / retries / timeout: </dt><dd className="inline">{e.workers} / {e.retries} / {e.timeoutMs / 1000}s</dd></div>
            <div><dt className="inline font-semibold">Test accounts: </dt><dd className="inline">{Object.entries(e.credentials).map(([r, c]) => `${r}: ${c.username} (${c.password})`).join(' · ') || 'none'}</dd></div>
            <div className="md:col-span-2"><dt className="inline font-semibold">Module paths: </dt><dd className="inline">{Object.entries(e.modulePaths).map(([m, p]) => `${m} → ${p}`).join(' · ') || 'defaults (/module-name)'}</dd></div>
            {e.lastProbe && <div className="md:col-span-2"><dt className="inline font-semibold">Last page probe ({new Date(e.lastProbe.at).toLocaleString()}): </dt>
              <dd className="inline">{Object.entries(e.lastProbe.pages).map(([m, p]) => `${m} ${p.path}: ${p.error ?? (p.status && p.status >= 400 ? `HTTP ${p.status}` : p.labels.join(', ') || 'no fields')}`).join(' · ')}</dd></div>}
          </dl>
        </Card>
      ))}
      {can('execution.run') && (edit === 'new' ? <EnvForm onDone={() => setEdit(null)} /> : <Button onClick={() => setEdit('new')}>Add environment</Button>)}
    </div>
  );
}

function EnvForm({ env, onDone }: { env?: Environment; onDone: () => void }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: env?.name ?? 'QA', envType: env?.envType ?? 'QA', baseUrl: env?.baseUrl ?? '', browsers: env?.browsers ?? ['chromium'], viewport: env?.viewport ?? '1366x768',
    workers: env?.workers ?? 2, retries: env?.retries ?? 0, timeoutSec: (env?.timeoutMs ?? 30000) / 1000,
    paths: Object.entries(env?.modulePaths ?? {}).map(([m, p]) => `${m}=${p}`).join('\n'),
  });
  const [creds, setCreds] = useState(Object.entries(env?.credentials ?? { Tester: { username: '', password: '' } }).map(([role, c]) => ({ role, username: c.username, password: '' })));
  const m = useMutation({
    mutationFn: () => {
      const modulePaths = Object.fromEntries(f.paths.split('\n').map((l) => l.split('=').map((s) => s.trim())).filter((p) => p.length === 2 && p[0] && p[1].startsWith('/')));
      const body = { name: f.name, envType: f.envType, baseUrl: f.baseUrl, browsers: f.browsers, viewport: f.viewport, workers: Number(f.workers), retries: Number(f.retries), timeoutMs: Number(f.timeoutSec) * 1000, modulePaths,
        credentials: Object.fromEntries(creds.filter((c) => c.role && c.username).map((c) => [c.role, { username: c.username, password: c.password }])) };
      return env ? api(`${xbase(current!.id)}/environments/${env.id}`, { method: 'PATCH', json: body }) : api(`${xbase(current!.id)}/environments`, { method: 'POST', json: body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['environments'] }); onDone(); },
  });
  const del = useMutation({ mutationFn: () => api(`${xbase(current!.id)}/environments/${env!.id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['environments'] }); onDone(); } });
  return (
    <Card title={env ? `Edit ${env.name}` : 'New environment'}>
      <form className="grid grid-cols-1 gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select label="Type" value={f.envType} onChange={(e) => setF({ ...f, envType: e.target.value })}>{['QA', 'UAT', 'Staging', 'Dev', 'Production'].map((t) => <option key={t}>{t}</option>)}</Select>
        <div className="md:col-span-2"><Field label="Application URL" required type="url" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} placeholder="https://qa.example.com" /></div>
        <fieldset className="flex flex-col gap-1"><legend className="text-sm font-medium">Browsers</legend>
          <div className="flex gap-3 text-sm">{BROWSERS.map((b) => <label key={b}><input type="checkbox" checked={f.browsers.includes(b)} onChange={(e) => setF({ ...f, browsers: e.target.checked ? [...f.browsers, b] : f.browsers.filter((x) => x !== b) })} /> {b}</label>)}</div>
        </fieldset>
        <Field label="Viewport (W×H)" value={f.viewport} onChange={(e) => setF({ ...f, viewport: e.target.value })} hint="e.g. 1366x768 or 390x844 (mobile)" />
        <Field label="Parallel workers" type="number" min={1} max={16} value={f.workers} onChange={(e) => setF({ ...f, workers: Number(e.target.value) })} />
        <Field label="Retries" type="number" min={0} max={3} value={f.retries} onChange={(e) => setF({ ...f, retries: Number(e.target.value) })} />
        <Field label="Timeout per test (s)" type="number" min={5} max={300} value={f.timeoutSec} onChange={(e) => setF({ ...f, timeoutSec: Number(e.target.value) })} />
        <div className="md:col-span-3 flex flex-col gap-1">
          <label htmlFor="paths" className="text-sm font-medium">Module paths (one per line: Module=/path)</label>
          <textarea id="paths" rows={3} className="rounded border border-slate-400 p-2 font-mono text-sm" value={f.paths} onChange={(e) => setF({ ...f, paths: e.target.value })} placeholder={'Login=/login\nCheckout=/cart/checkout'} />
        </div>
        <fieldset className="md:col-span-4 rounded border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium">Test accounts (stored encrypted; passwords are never shown again)</legend>
          {creds.map((c, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_2fr_2fr_auto]">
              <Field label="Role" value={c.role} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
              <Field label="Username / e-mail" autoComplete="off" value={c.username} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, username: e.target.value } : x)))} />
              <Field label="Password" type="password" autoComplete="new-password" value={c.password} placeholder={env?.credentials[c.role] ? 'Leave empty to keep' : ''} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, password: e.target.value } : x)))} />
              <Button type="button" variant="ghost" className="self-end" onClick={() => setCreds(creds.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button type="button" variant="secondary" className="mt-2" onClick={() => setCreds([...creds, { role: '', username: '', password: '' }])}>Add account</Button>
        </fieldset>
        {(m.error || del.error) && <div className="md:col-span-4"><Alert>{(m.error ?? del.error)!.message}</Alert></div>}
        <div className="md:col-span-4 flex gap-2">
          <Button type="submit" disabled={m.isPending}>Save</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          {env && <Button type="button" variant="danger" onClick={() => { if (confirm(`Delete environment ${env.name}?`)) del.mutate(); }}>Delete</Button>}
        </div>
      </form>
    </Card>
  );
}
