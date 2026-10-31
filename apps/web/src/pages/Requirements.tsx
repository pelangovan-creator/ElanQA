import { FormEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download } from '../lib/api';
import { useProject } from '../lib/project';
import {
  CATEGORIES, CATEGORY_LABEL, DOC_TYPES, SOURCE_KINDS,
  type CoverageSummary, type Question, type RequirementDocument, type RequirementItem, type RtmRow, type VersionDetail,
} from '../lib/types';
import { Alert, Badge, Button, Card, Field, PageHeader, Select, Table } from '../components/ui';
import { Tabs } from '../components/Tabs';
import { AiBadge } from '../components/AiBadge';

type Tab = 'documents' | 'items' | 'coverage' | 'rtm' | 'questions';

const COVERAGE_COLOR: Record<string, 'green' | 'blue' | 'amber' | 'red'> = { Covered: 'green', Informational: 'blue', Acknowledged: 'amber', Unmapped: 'red' };
const EXEC_COLOR: Record<string, 'green' | 'red' | 'amber' | 'gray'> = { Pass: 'green', Fail: 'red', Blocked: 'amber' };

export function Requirements() {
  const { current } = useProject();
  const [tab, setTab] = useState<Tab>('documents');
  const cov = useQuery({ queryKey: ['coverage', current?.id], queryFn: () => api<CoverageSummary>(`/projects/${current!.id}/requirements/coverage`), enabled: !!current });
  if (!current) return null;

  return (
    <>
      <PageHeader title="Requirements & RTM" subtitle="Upload client documents. Every sentence, bullet, table cell and footnote becomes a traceable requirement item." />
      {cov.data && cov.data.total > 0 && <CoverageBar c={cov.data} onOpen={() => setTab('coverage')} />}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'documents', label: 'Documents' },
        { id: 'items', label: `Requirement items${cov.data ? ` (${cov.data.total})` : ''}` },
        { id: 'coverage', label: <>Coverage {cov.data && cov.data.unmapped > 0 && <Badge color="red">{cov.data.unmapped} unmapped</Badge>}</> },
        { id: 'rtm', label: 'Traceability matrix' },
        { id: 'questions', label: 'Clarifications' },
      ]}>
        {tab === 'documents' && <Documents />}
        {tab === 'items' && <Items />}
        {tab === 'coverage' && <Coverage />}
        {tab === 'rtm' && <Rtm />}
        {tab === 'questions' && <Questions />}
      </Tabs>
    </>
  );
}

function CoverageBar({ c, onOpen }: { c: CoverageSummary; onOpen: () => void }) {
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-56 flex-1">
          <div className="flex justify-between text-sm"><span className="font-semibold">Requirement coverage</span><span>{c.coveragePercent}%</span></div>
          <div className="mt-1 h-3 overflow-hidden rounded bg-slate-200" role="progressbar" aria-label="Requirement coverage" aria-valuenow={c.coveragePercent} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full ${c.complete ? 'bg-green-600' : 'bg-brand-600'}`} style={{ width: `${c.coveragePercent}%` }} />
          </div>
        </div>
        <p className="text-sm">
          <Badge color="green">{c.covered} covered</Badge> <Badge color="blue">{c.informational} informational</Badge>{' '}
          <Badge color="amber">{c.acknowledged} acknowledged</Badge> <Badge color="red">{c.unmapped} unmapped</Badge>
        </p>
        {!c.complete && <Button variant="secondary" onClick={onOpen}>Review gaps</Button>}
        {c.complete && <Badge color="green">✓ Phase can be completed – no unmapped items</Badge>}
      </div>
    </Card>
  );
}

// ───────────────────────────── Documents ─────────────────────────────

function useInvalidateRequirements() {
  const qc = useQueryClient();
  return () => ['documents', 'items', 'coverage', 'rtm', 'questions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

function Documents() {
  const { current, can } = useProject();
  const docs = useQuery({ queryKey: ['documents', current!.id], queryFn: () => api<RequirementDocument[]>(`/projects/${current!.id}/requirements/documents`) });
  const [detail, setDetail] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {can('requirements.edit') && <UploadForm />}
      {docs.data?.length === 0 && <Alert kind="info">No documents yet. Upload a BRD, FRD, SRS, user stories, wireframes, an email or a change request.</Alert>}
      {docs.data?.map((d) => (
        <Card key={d.id} title={<>{d.docKey} · {d.title} <Badge>{d.docType}</Badge></>} actions={can('requirements.edit') && <NewVersionButton documentId={d.id} onDone={setDetail} />}>
          <Table head={['Version', 'File', 'Status', 'Items', 'Words (original / extracted)', 'Reverse check', '']} caption={`Versions of ${d.title}`}>
            {d.versions.map((v) => (
              <tr key={v.id}>
                <td className="px-2 py-2">v{v.version}{v === d.versions[0] && <span className="ml-1 text-xs text-slate-500">(current)</span>}</td>
                <td className="px-2 py-2">{v.fileName} {v.ocrUsed && <Badge color="amber">OCR</Badge>}</td>
                <td className="px-2 py-2"><Badge color={v.parseStatus === 'Parsed' ? 'green' : v.parseStatus === 'Failed' ? 'red' : 'gray'}>{v.parseStatus}</Badge>
                  {v.parseError && <p className="text-xs text-red-700">{v.parseError}</p>}</td>
                <td className="px-2 py-2">{v.itemCount}</td>
                <td className="px-2 py-2">{v.wordCountOriginal ?? '—'} / {v.wordCountExtracted ?? '—'}</td>
                <td className="px-2 py-2">{v.reverseCheckOk === true ? <Badge color="green">✓ Nothing dropped</Badge> : v.reverseCheckOk === false ? <Badge color="red">✗ Words missing</Badge> : '—'}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" aria-expanded={detail === v.id} onClick={() => setDetail(detail === v.id ? null : v.id)}>Details</Button>
                  <Button variant="ghost" onClick={() => download(`/projects/${current!.id}/requirements/versions/${v.id}/original`, v.fileName)}>Original<span className="sr-only"> {v.fileName}</span></Button>
                </td>
              </tr>
            ))}
          </Table>
          {d.versions.some((v) => v.id === detail) && <VersionDetails versionId={detail!} />}
        </Card>
      ))}
    </div>
  );
}

function UploadForm() {
  const { current } = useProject();
  const invalidate = useInvalidateRequirements();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('SRS');
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', fileRef.current!.files![0]);
      if (title) fd.append('title', title);
      fd.append('docType', docType);
      return api<VersionDetail>(`/projects/${current!.id}/requirements/documents`, { method: 'POST', body: fd });
    },
    onSuccess: () => { setTitle(''); if (fileRef.current) fileRef.current.value = ''; invalidate(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (fileRef.current?.files?.length) m.mutate(); };

  return (
    <Card title="Upload requirement document">
      <form onSubmit={submit} className="grid items-end gap-3 md:grid-cols-4">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="req-file" className="text-sm font-medium">File <span aria-hidden="true" className="text-red-700">*</span></label>
          <input id="req-file" ref={fileRef} type="file" required aria-describedby="req-file-hint" className="text-sm"
            accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.eml,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp" />
          <p id="req-file-hint" className="text-xs text-slate-600">PDF, DOCX, XLSX, CSV, TXT, MD, email (.eml) or images (OCR). Max 25 MB. The original is stored unchanged.</p>
        </div>
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to file name" />
        <Select label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)}>
          {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
        </Select>
        <div className="md:col-span-4 flex items-center gap-3">
          <Button type="submit" disabled={m.isPending}>{m.isPending ? 'Uploading & analysing…' : 'Upload & extract'}</Button>
          {m.isPending && <span role="status" className="text-sm text-slate-600">Parsing, splitting and classifying – scanned files use OCR and take longer.</span>}
        </div>
        {m.error && <div className="md:col-span-4"><Alert>{m.error.message}</Alert></div>}
        {m.data && <div className="md:col-span-4"><UploadResult v={m.data} /></div>}
      </form>
    </Card>
  );
}

function UploadResult({ v }: { v: VersionDetail }) {
  if (v.parseStatus !== 'Parsed') return <Alert>Parsing failed: {v.parseError}</Alert>;
  return (
    <Alert kind={v.reverseCheckOk ? 'success' : 'error'}>
      {v.document.docKey} v{v.version}: {v.itemCount} atomic items extracted. Reverse check: {v.wordCountOriginal} original words vs {v.wordCountExtracted} extracted
      {v.reverseCheckOk ? ' – nothing dropped.' : ' – some words are missing, see Details.'}
    </Alert>
  );
}

function NewVersionButton({ documentId, onDone }: { documentId: string; onDone: (versionId: string) => void }) {
  const { current } = useProject();
  const invalidate = useInvalidateRequirements();
  const ref = useRef<HTMLInputElement>(null);
  const m = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<VersionDetail>(`/projects/${current!.id}/requirements/documents/${documentId}/versions`, { method: 'POST', body: fd });
    },
    onSuccess: (v) => { invalidate(); onDone(v.id); },
  });
  return (
    <div className="flex items-center gap-2">
      {m.error && <span role="alert" className="text-xs text-red-700">{m.error.message}</span>}
      <input ref={ref} type="file" className="hidden" aria-hidden="true" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) m.mutate(f); e.target.value = ''; }} />
      <Button variant="secondary" disabled={m.isPending} onClick={() => ref.current?.click()}>{m.isPending ? 'Analysing…' : 'Upload new version'}</Button>
    </div>
  );
}

function VersionDetails({ versionId }: { versionId: string }) {
  const { current } = useProject();
  const q = useQuery({ queryKey: ['version', versionId], queryFn: () => api<VersionDetail>(`/projects/${current!.id}/requirements/versions/${versionId}`) });
  const v = q.data;
  if (!v) return <p role="status" className="mt-3 text-sm">Loading…</p>;
  return (
    <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
      {v.warnings.length > 0 && <Alert kind="info"><ul className="list-disc pl-4">{v.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
      {v.reverseCheck && (
        <div>
          <h3 className="text-sm font-semibold">Reverse check (document rebuilt from extracted items)</h3>
          <p className="text-sm">Original: <strong>{v.reverseCheck.originalWords}</strong> words · Extracted: <strong>{v.reverseCheck.extractedWords}</strong> words ·{' '}
            {v.reverseCheck.ok ? <span className="text-green-700">every word accounted for</span> : <span className="font-semibold text-red-700">missing words detected</span>}</p>
          {v.reverseCheck.missing.length > 0 && <p className="text-sm text-red-700">Missing: {v.reverseCheck.missing.map((m) => `${m.word}×${m.count}`).join(', ')}</p>}
        </div>
      )}
      {v.diff && (
        <div>
          <h3 className="text-sm font-semibold">Changes from the previous version</h3>
          <p className="mb-2 text-sm">{v.diff.unchanged} unchanged · {v.diff.added.length} added · {v.diff.modified.length} modified · {v.diff.removed.length} removed</p>
          {v.diff.impactedTestCases.length > 0 && <Alert>Impacted test cases (flagged for regeneration): {v.diff.impactedTestCases.join(', ')}</Alert>}
          <ul className="mt-2 space-y-1 text-sm">
            {v.diff.added.map((a) => <li key={`a${a.reqId}`} className="rounded bg-green-50 px-2 py-1"><Badge color="green">Added</Badge> <span className="font-mono text-xs">{a.reqId}</span> {a.text}</li>)}
            {v.diff.modified.map((m) => (
              <li key={`m${m.reqId}`} className="rounded bg-amber-50 px-2 py-1"><Badge color="amber">Modified</Badge> <span className="font-mono text-xs">{m.reqId}</span>{' '}
                <del className="text-red-800">{m.oldText}</del> → <ins className="text-green-800 no-underline">{m.newText}</ins></li>
            ))}
            {v.diff.removed.map((r) => <li key={`r${r.reqId}`} className="rounded bg-red-50 px-2 py-1"><Badge color="red">Removed</Badge> <span className="font-mono text-xs">{r.reqId}</span> <del>{r.text}</del></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Items ─────────────────────────────

function Items() {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const [f, setF] = useState({ q: '', category: '', kind: '', coverage: '', ambiguous: false, changed: false });
  const [take, setTake] = useState(200);
  const params = new URLSearchParams({ take: String(take), ...(f.q && { q: f.q }), ...(f.category && { category: f.category }), ...(f.kind && { kind: f.kind }),
    ...(f.coverage && { coverage: f.coverage }), ...(f.ambiguous && { ambiguous: 'true' }), ...(f.changed && { changed: 'true' }) });
  const q = useQuery({ queryKey: ['items', current!.id, params.toString()], queryFn: () => api<{ total: number; items: RequirementItem[] }>(`/projects/${current!.id}/requirements/items?${params}`) });
  const update = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) => api(`/projects/${current!.id}/requirements/items/${id}`, { method: 'PATCH', json: { category } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); qc.invalidateQueries({ queryKey: ['coverage'] }); },
  });

  return (
    <Card>
      <form className="mb-4 grid gap-2 md:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Filter requirement items">
        <Field label="Search text or ID" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="">All</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </Select>
        <Select label="Source" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="">All</option>{SOURCE_KINDS.map((k) => <option key={k}>{k}</option>)}
        </Select>
        <Select label="Coverage" value={f.coverage} onChange={(e) => setF({ ...f, coverage: e.target.value })}>
          <option value="">All</option>{['Unmapped', 'Covered', 'Informational', 'Acknowledged'].map((k) => <option key={k}>{k}</option>)}
        </Select>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.ambiguous} onChange={(e) => setF({ ...f, ambiguous: e.target.checked })} /> Ambiguous only</label>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.changed} onChange={(e) => setF({ ...f, changed: e.target.checked })} /> Added/modified</label>
      </form>
      {update.error && <Alert>{update.error.message}</Alert>}
      <p className="mb-2 text-sm text-slate-600" role="status">{q.data ? `Showing ${q.data.items.length} of ${q.data.total} items` : 'Loading…'}</p>
      <Table head={['ID', 'Source', 'Location', 'Requirement text (verbatim)', 'Category', 'Flags', 'Coverage']} caption="Requirement items">
        {q.data?.items.map((i) => (
          <tr key={i.id} className={i.coverageStatus === 'Unmapped' ? 'bg-red-50/40' : undefined}>
            <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{i.reqId}</td>
            <td className="px-2 py-2 text-xs">{i.sourceKind}</td>
            <td className="px-2 py-2 text-xs">{i.version.document.docKey}{i.section ? ` §${i.section}` : ''}{i.page ? ` p.${i.page}` : ''}</td>
            <td className={`px-2 py-2 ${i.sourceKind === 'Header' ? 'font-semibold' : ''} ${i.sourceKind === 'TableRow' ? 'text-slate-500' : ''}`}>
              {i.text}
              {i.previousText && <p className="text-xs text-slate-500">Was: <del>{i.previousText}</del></p>}
            </td>
            <td className="px-2 py-2">
              {can('requirements.edit') ? (
                <>
                  <label className="sr-only" htmlFor={`cat-${i.id}`}>Category for {i.reqId}</label>
                  <select id={`cat-${i.id}`} className="rounded border border-slate-300 px-1 py-1 text-xs" value={i.category} onChange={(e) => update.mutate({ id: i.id, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                </>
              ) : CATEGORY_LABEL[i.category]}
              {i.subCategory && <span className="block text-xs text-slate-500">{i.subCategory}</span>}
            </td>
            <td className="space-x-1 space-y-1 px-2 py-2">
              {i.ambiguousTerms.map((t) => <Badge key={t} color="amber">“{t}”</Badge>)}
              {i.changeType && i.changeType !== 'Unchanged' && <Badge color={i.changeType === 'Added' ? 'green' : 'amber'}>{i.changeType}</Badge>}
              {i.aiGenerated && <Badge>AI-classified</Badge>}
            </td>
            <td className="px-2 py-2"><Badge color={COVERAGE_COLOR[i.coverageStatus]}>{i.coverageStatus}</Badge></td>
          </tr>
        ))}
      </Table>
      {q.data && q.data.items.length < q.data.total && <Button variant="secondary" className="mt-3" onClick={() => setTake(take + 500)}>Load more</Button>}
    </Card>
  );
}

// ───────────────────────────── Coverage ─────────────────────────────

function Coverage() {
  const { current, can } = useProject();
  const invalidate = useInvalidateRequirements();
  const q = useQuery({ queryKey: ['coverage', current!.id], queryFn: () => api<CoverageSummary>(`/projects/${current!.id}/requirements/coverage`) });
  const accept = useMutation({ mutationFn: () => api<{ updated: number }>(`/projects/${current!.id}/requirements/coverage/accept-suggestions`, { method: 'POST' }), onSuccess: invalidate });
  const c = q.data;
  if (!c) return <p role="status">Loading…</p>;

  return (
    <div className="space-y-4">
      <Alert kind="info">
        Every item must be covered by at least one test scenario/case (test design arrives in Phase 3), or be marked <strong>Informational – no test needed</strong> with a reason,
        or be explicitly <strong>acknowledged by the QA Lead</strong>. The requirement analysis phase can only be completed when no item is unmapped.
      </Alert>
      {c.suggestions > 0 && can('requirements.edit') && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm"><strong>{c.suggestions}</strong> unmapped items were classified as Informational or Out of scope. Review them, then accept to mark them “no test needed”.</p>
            <Button variant="secondary" disabled={accept.isPending} onClick={() => accept.mutate()}>Accept {c.suggestions} suggestions</Button>
          </div>
        </Card>
      )}
      <Card title={<span className={c.unmapped ? 'text-red-800' : 'text-green-800'}>{c.unmapped ? `${c.unmapped} unmapped items` : 'No unmapped items – coverage complete'}</span>}>
        {c.unmapped > 0 && (
          <Table head={['ID', 'Location', 'Text', 'Category', 'Action']} caption="Unmapped requirement items">
            {c.unmappedItems.map((i) => (
              <tr key={i.id} className="bg-red-50/60">
                <td className="whitespace-nowrap px-2 py-2 font-mono text-xs font-semibold text-red-800">{i.reqId}</td>
                <td className="px-2 py-2 text-xs">{i.section ? `§${i.section}` : ''}{i.page ? ` p.${i.page}` : ''}</td>
                <td className="px-2 py-2">{i.text}</td>
                <td className="px-2 py-2 text-xs">{CATEGORY_LABEL[i.category]}</td>
                <td className="px-2 py-2">{can('requirements.edit') ? <GapAction itemId={i.id} reqId={i.reqId} /> : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function GapAction({ itemId, reqId }: { itemId: string; reqId: string }) {
  const { current, can } = useProject();
  const invalidate = useInvalidateRequirements();
  const [mode, setMode] = useState<'Informational' | 'Acknowledged' | null>(null);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/projects/${current!.id}/requirements/items/${itemId}/coverage`, { method: 'POST', json: { status: mode, reason } }),
    onSuccess: invalidate,
  });
  if (!mode) {
    return (
      <div className="flex flex-wrap gap-1">
        <Button variant="secondary" onClick={() => setMode('Informational')}>No test needed<span className="sr-only"> for {reqId}</span></Button>
        {can('coverage.acknowledge') && <Button variant="secondary" onClick={() => setMode('Acknowledged')}>Acknowledge gap<span className="sr-only"> for {reqId}</span></Button>}
      </div>
    );
  }
  return (
    <form className="flex min-w-64 flex-col gap-1" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label={mode === 'Informational' ? `Why does ${reqId} need no test?` : `Why is the gap on ${reqId} accepted?`} required value={reason} onChange={(e) => setReason(e.target.value)} />
      {m.error && <p role="alert" className="text-xs text-red-700">{m.error.message}</p>}
      <div className="flex gap-1"><Button type="submit" disabled={!reason.trim() || m.isPending}>Save</Button><Button variant="ghost" type="button" onClick={() => setMode(null)}>Cancel</Button></div>
    </form>
  );
}

// ───────────────────────────── RTM ─────────────────────────────

function Rtm() {
  const { current } = useProject();
  const [hideStructural, setHide] = useState(true);
  const q = useQuery({ queryKey: ['rtm', current!.id], queryFn: () => api<RtmRow[]>(`/projects/${current!.id}/requirements/rtm`) });
  const rows = (q.data ?? []).filter((r) => !hideStructural || (r.sourceKind !== 'Header' && r.sourceKind !== 'TableRow'));
  return (
    <Card title="Requirement Traceability Matrix" actions={
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => download(`/projects/${current!.id}/requirements/rtm/export?format=xlsx`, 'RTM.xlsx')}>Export Excel</Button>
        <Button variant="secondary" onClick={() => download(`/projects/${current!.id}/requirements/rtm/export?format=csv`, 'RTM.csv')}>Export CSV</Button>
      </div>}>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={hideStructural} onChange={(e) => setHide(e.target.checked)} /> Hide headings and table-row summaries</label>
      <Table head={['Requirement ID', 'Requirement text', 'Scenario IDs', 'Test case IDs', 'Execution', 'Defect IDs', 'Coverage']} caption="Requirement traceability matrix">
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{r.reqId}</td>
            <td className="px-2 py-2">{r.text}{r.noTestReason && <p className="text-xs text-slate-500">No test: {r.noTestReason}</p>}</td>
            <td className="px-2 py-2 text-xs">{r.scenarioIds.join(', ') || '—'}</td>
            <td className="px-2 py-2 text-xs">{r.testCaseIds.join(', ') || '—'}</td>
            <td className="px-2 py-2"><Badge color={EXEC_COLOR[r.executionStatus] ?? 'gray'}>{r.executionStatus}</Badge></td>
            <td className="px-2 py-2 text-xs">{r.defectIds.join(', ') || '—'}</td>
            <td className="px-2 py-2"><Badge color={COVERAGE_COLOR[r.coverageStatus]}>{r.coverageStatus}</Badge></td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

// ───────────────────────────── Questions ─────────────────────────────

function Questions() {
  const { current } = useProject();
  const q = useQuery({ queryKey: ['questions', current!.id], queryFn: () => api<Question[]>(`/projects/${current!.id}/requirements/questions`) });
  return (
    <Card title="Clarification questions raised from ambiguous wording">
      <p className="mb-3 text-sm text-slate-600">Editing, answering, assigning to the client and conflict/gap detection come with the full Clarification Log in Phase 3.</p>
      <Table head={['Q-ID', 'Requirement', 'Location', 'Question', 'Priority', 'Status', '']} caption="Clarification questions">
        {q.data?.map((x) => (
          <tr key={x.id}>
            <td className="px-2 py-2 font-mono text-xs">{x.qId}</td>
            <td className="px-2 py-2 font-mono text-xs">{x.requirement?.reqId ?? '—'}</td>
            <td className="px-2 py-2 text-xs">{x.sectionPage ?? '—'}</td>
            <td className="px-2 py-2">{x.question}</td>
            <td className="px-2 py-2"><Badge color={x.priority === 'High' ? 'red' : 'gray'}>{x.priority}</Badge></td>
            <td className="px-2 py-2">{x.status}</td>
            <td className="px-2 py-2"><AiBadge aiGenerated={x.aiGenerated} reviewStatus={x.reviewStatus} /></td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
