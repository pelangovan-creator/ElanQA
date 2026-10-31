import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProject } from '../../lib/project';
import { BROWSERS, RUN_MODE_LABEL, RUN_MODES, type Environment, type TestCase } from '../../lib/types';
import { Alert, Badge, Button, Card, Field, Select } from '../../components/ui';

export const xbase = (projectId: string) => `/projects/${projectId}/execution`;

interface GenResult { testCases: number; automated: number; todo: number; ai: number; keptEdited: number; files: number; warnings: string[] }

export function RunPanel() {
  const { current, can } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const envs = useQuery({ queryKey: ['environments', current!.id], queryFn: () => api<Environment[]>(`${xbase(current!.id)}/environments`) });
  const tcs = useQuery({ queryKey: ['test-cases', current!.id, 'all'], queryFn: () => api<TestCase[]>(`/projects/${current!.id}/artefacts/test-cases`) });
  const [envId, setEnvId] = useState('');
  const [mode, setMode] = useState<string>('All');
  const [module, setModule] = useState('');
  const [priority, setPriority] = useState('High');
  const [build, setBuild] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [browsers, setBrowsers] = useState<string[]>([]);
  const [includePending, setIncludePending] = useState(false);
  const env = envs.data?.find((e) => e.id === (envId || envs.data?.[0]?.id));
  const modules = [...new Set((tcs.data ?? []).map((t) => t.module))];
  const body = { mode, module: mode === 'Module' ? module || modules[0] : undefined, priority: mode === 'Priority' ? priority : undefined, testCaseIds: mode === 'Selected' ? [...selected] : undefined };

  const preview = useQuery({
    queryKey: ['run-preview', current!.id, JSON.stringify(body)],
    queryFn: () => api<{ total: number; automated: number; testCases: { tcId: string; automatedScriptId: string | null }[] }>(`${xbase(current!.id)}/runs/preview`, { method: 'POST', json: body }),
    enabled: mode !== 'Selected' || selected.size > 0,
  });
  const gen = useMutation({
    mutationFn: () => api<GenResult>(`${xbase(current!.id)}/scripts/generate`, { method: 'POST', json: { environmentId: env?.id, includePending } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const start = useMutation({
    mutationFn: () => api<{ id: string }>(`${xbase(current!.id)}/runs`, { method: 'POST', json: { ...body, environmentId: env!.id, build: build || undefined, browsers: browsers.length ? browsers : undefined } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['runs'] }); navigate(`/execution/runs/${r.id}`); },
  });
  const manual = useMutation({
    mutationFn: () => api<{ id: string }>(`${xbase(current!.id)}/manual-runs`, { method: 'POST', json: { ...body, environmentId: env?.id, build: build || undefined } }),
    onSuccess: (r) => navigate(`/execution/manual/${r.id}`),
  });

  if (envs.data && !envs.data.length) return <Alert kind="info">Add a test environment first (Environments tab): application URL, browsers and test accounts.</Alert>;
  const notAutomated = (preview.data?.testCases ?? []).filter((t) => !t.automatedScriptId).map((t) => t.tcId);

  return (
    <div className="space-y-6">
      <Card title="1. Automation scripts">
        <p className="mb-3 text-sm text-slate-700">Approved automation-candidate test cases are converted into Playwright scripts (Page Object Model, data-driven from the Test Data Sheet). The selected environment's pages are opened first to find the real field labels.</p>
        {can('execution.run') && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => gen.mutate()} disabled={gen.isPending || !env}>{gen.isPending ? 'Generating…' : 'Generate / update scripts'}</Button>
            <label className="text-sm"><input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} /> Include test cases still pending review</label>
          </div>
        )}
        {gen.error && <Alert>{gen.error.message}</Alert>}
        {gen.data && (
          <div className="mt-3"><Alert kind="success">
            {gen.data.testCases} test cases: {gen.data.automated} automated{gen.data.ai ? ` (${gen.data.ai} by Claude)` : ''}, {gen.data.todo} need a person (reported as Skipped until scripted).
            {gen.data.keptEdited > 0 && ` ${gen.data.keptEdited} edited script(s) kept.`}
            {gen.data.warnings.map((w) => <span key={w} className="block text-amber-900">⚠ {w}</span>)}
          </Alert></div>
        )}
      </Card>

      <Card title="2. Run test cases">
        <div className="grid gap-3 md:grid-cols-4">
          <Select label="Environment" value={env?.id ?? ''} onChange={(e) => setEnvId(e.target.value)}>
            {envs.data?.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.envType}) – {e.baseUrl}</option>)}
          </Select>
          <Select label="What to run" value={mode} onChange={(e) => setMode(e.target.value)}>
            {RUN_MODES.map((m) => <option key={m} value={m}>{RUN_MODE_LABEL[m]}</option>)}
          </Select>
          {mode === 'Module' && <Select label="Module" value={module || modules[0] || ''} onChange={(e) => setModule(e.target.value)}>{modules.map((m) => <option key={m}>{m}</option>)}</Select>}
          {mode === 'Priority' && <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>{['High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}</Select>}
          <Field label="Build / version" value={build} onChange={(e) => setBuild(e.target.value)} placeholder="e.g. 1.4.2" />
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Browsers (override)</legend>
            <div className="flex gap-3 text-sm">{BROWSERS.map((b) => <label key={b}><input type="checkbox" checked={browsers.includes(b)} onChange={(e) => setBrowsers(e.target.checked ? [...browsers, b] : browsers.filter((x) => x !== b))} /> {b}</label>)}</div>
            <span className="text-xs text-slate-600">Default: {env?.browsers.join(', ')}</span>
          </fieldset>
        </div>
        {mode === 'Selected' && (
          <fieldset className="mt-3 max-h-64 overflow-auto rounded border border-slate-200 p-2">
            <legend className="px-1 text-sm font-medium">Test cases ({selected.size} selected)</legend>
            {tcs.data?.map((t) => (
              <label key={t.id} className="flex items-start gap-2 py-0.5 text-sm">
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => { const n = new Set(selected); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setSelected(n); }} />
                <span><span className="font-mono text-xs">{t.tcId}</span> {t.title} {t.automatedScriptId ? <Badge color="blue">script</Badge> : <Badge>manual</Badge>}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {can('execution.run') && <Button className="min-h-11 px-5 text-base" onClick={() => start.mutate()} disabled={start.isPending || !env || !preview.data?.automated}>▶ Run Test Cases</Button>}
          {can('execution.run') && <Button variant="secondary" onClick={() => manual.mutate()} disabled={manual.isPending || !preview.data?.total}>Execute manually (guided)</Button>}
          <span role="status" className="text-sm text-slate-700">
            {preview.data ? `${preview.data.total} test cases selected · ${preview.data.automated} have scripts${notAutomated.length ? ` · ${notAutomated.length} manual only` : ''}` : mode === 'Selected' ? 'Select test cases' : ''}
          </span>
        </div>
        {(start.error || manual.error) && <div className="mt-2"><Alert>{(start.error ?? manual.error)!.message}</Alert></div>}
      </Card>
    </div>
  );
}
