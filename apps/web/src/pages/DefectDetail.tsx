import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download } from '../lib/api';
import { useBlobUrl } from '../lib/blob';
import { useProject } from '../lib/project';
import { DEFECT_STATUS_LABEL, DEFECT_TYPES, isHighImpact, PRIORITIES, PRIORITY_DEF, SEVERITIES, SEVERITY_DEF, type AttachmentMeta, type DefectDetail as DD } from '../lib/types';
import { Alert, Badge, Button, Card, Field, PageHeader, Select } from '../components/ui';
import { ExportButtons } from './artefacts/shared';
import { dbase, PriorityBadge, SeverityBadge } from './Defects';
import { JiraGuide } from './JiraGuide';

const KIND_LABEL: Record<string, string> = {
  AnnotatedScreenshot: 'Annotated screenshot', FailureScreenshot: 'Screenshot at failure', FullPageScreenshot: 'Full-page screenshot', Manual: 'Screenshot / upload',
  Video: 'Video', Trace: 'Playwright trace', ConsoleLog: 'Console log', NetworkLog: 'Network log',
};
const IMAGE_ORDER = ['AnnotatedScreenshot', 'FailureScreenshot', 'FullPageScreenshot', 'Manual'];
const NEEDS_COMMENT = new Set(['Rejected', 'NotABug', 'Deferred', 'Reopened']);

export function DefectDetail() {
  const { id } = useParams();
  const { current } = useProject();
  const q = useQuery({ queryKey: ['defect', id], queryFn: () => api<DD>(`${dbase(current!.id)}/${id}`), enabled: !!current });
  const [guide, setGuide] = useState(false);
  if (!q.data) return <p role="status">{q.error ? q.error.message : 'Loading…'}</p>;
  const d = q.data;
  return (
    <>
      <PageHeader title={`${d.defectId}${d.isDraft ? ' (draft)' : ''}`} subtitle={d.title}
        actions={<><Link to="/defects" className="inline-flex min-h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm">All defects</Link>
          {!d.isDraft && <Button onClick={() => setGuide(true)}>{d.jiraKey ? `Jira: ${d.jiraKey}` : 'Create in Jira – step-by-step guide'}</Button>}<ExportButtons fullPath={`${dbase(current!.id)}/${d.id}/export`} name={d.defectId} /></>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge color={d.open ? 'blue' : 'gray'}>{DEFECT_STATUS_LABEL[d.status] ?? d.status}</Badge><SeverityBadge s={d.severity} /><PriorityBadge p={d.priority} /><Badge>{d.defectType}</Badge>
        <span className="text-sm text-slate-600">Age {d.ageDays} day(s){d.testCase ? ` · ${d.testCase.tcId}` : ''}{d.testRunId ? ` · ${d.testRunId}` : ''}</span>
        {d.jiraKey && (d.jiraUrl ? <a href={d.jiraUrl} target="_blank" rel="noreferrer" className="text-sm text-brand-700 underline">Jira {d.jiraKey}<span className="sr-only"> (opens in a new tab)</span></a> : <span className="text-sm">Jira {d.jiraKey}</span>)}
        {isHighImpact(d) && d.open && <Badge color="red">Blocker/Critical/P1 – high impact</Badge>}
      </div>
      {d.isDraft ? <DraftReview d={d} /> : <Lifecycle d={d} />}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-4">
          <Evidence d={d} />
          <Fields key={d.id + d.status} d={d} />
        </div>
        <History d={d} />
      </div>
      {guide && <JiraGuide d={d} onClose={() => setGuide(false)} />}
    </>
  );
}

function DraftReview({ d }: { d: DD }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => qc.invalidateQueries();
  const confirm = useMutation({ mutationFn: () => api(`${dbase(current!.id)}/${d.id}/confirm`, { method: 'POST' }), onSuccess: refresh });
  const link = useMutation({ mutationFn: (targetId: string) => api<{ id: string }>(`${dbase(current!.id)}/${d.id}/link`, { method: 'POST', json: { targetId } }), onSuccess: (t) => { refresh(); navigate(`/defects/${t.id}`); } });
  const discard = useMutation({ mutationFn: () => api(`${dbase(current!.id)}/${d.id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); navigate('/defects'); } });
  const err = confirm.error ?? link.error ?? discard.error;
  return (
    <Card title="Review this draft">
      <p className="text-sm">Created automatically from a failed test{d.testRunId ? ` in ${d.testRunId}` : ''}. Check the fields and evidence below, then decide.</p>
      {d.duplicateCandidates.length > 0 && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold">This may already be reported:</p>
          <ul className="mt-1 space-y-1 text-sm">
            {d.duplicateCandidates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Link to={`/defects/${c.id}`} className="font-mono underline">{c.defectId}</Link> {c.title} <Badge>{DEFECT_STATUS_LABEL[c.status] ?? c.status}</Badge>
                <span className="text-xs text-slate-600">{Math.round(c.score * 100)}% · {c.reason}</span>
                {can('defects.create') && <Button variant="secondary" onClick={() => link.mutate(c.id)} disabled={link.isPending}>Link to {c.defectId} instead</Button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!d.hasScreenshot && <div className="mt-3"><Alert>A screenshot is mandatory. Attach one under Evidence before confirming.</Alert></div>}
      {err && <div className="mt-3"><Alert>{err.message}</Alert></div>}
      {can('defects.create') && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => confirm.mutate()} disabled={!d.hasScreenshot || confirm.isPending}>Confirm as {d.duplicateCandidates.length ? 'a new ' : ''}defect</Button>
          <Button variant="danger" onClick={() => { if (window.confirm(`Discard draft ${d.defectId}? Its evidence stays on the test run.`)) discard.mutate(); }}>Discard draft</Button>
        </div>
      )}
    </Card>
  );
}

function Lifecycle({ d }: { d: DD }) {
  const { current } = useProject();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['directory'], queryFn: () => api<{ id: string; name: string; role: string }[]>('/users/directory') });
  const [to, setTo] = useState<string | null>(null);
  const [f, setF] = useState({ comment: '', assignedTo: d.assignedTo ?? '', rootCause: d.rootCause ?? '', fixVersion: d.fixVersion ?? '', duplicateOfId: '' });
  const m = useMutation({
    mutationFn: () => api(`${dbase(current!.id)}/${d.id}/transition`, { method: 'POST', json: { to, comment: f.comment || undefined, assignedTo: f.assignedTo || undefined, rootCause: f.rootCause || undefined, fixVersion: f.fixVersion || undefined, duplicateOfId: f.duplicateOfId || undefined } }),
    onSuccess: () => { setTo(null); setF({ ...f, comment: '' }); qc.invalidateQueries(); },
  });
  if (!d.allowedTransitions.length) return <Card><p className="text-sm text-slate-600">No status changes available to you for a defect in “{DEFECT_STATUS_LABEL[d.status]}”.</p></Card>;
  return (
    <Card title="Move through the life cycle">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Next status">
        {d.allowedTransitions.map((s) => <Button key={s} variant={to === s ? 'primary' : 'secondary'} aria-pressed={to === s} onClick={() => setTo(to === s ? null : s)}>→ {DEFECT_STATUS_LABEL[s] ?? s}</Button>)}
      </div>
      {to && (
        <form className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          {to === 'Assigned' && <Select label="Assign to" required value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}><option value="">Select…</option>{users.data?.map((u) => <option key={u.id} value={u.name}>{u.name} ({u.role})</option>)}</Select>}
          {to === 'Fixed' && <><div className="md:col-span-2"><Field label="Root cause" required value={f.rootCause} onChange={(e) => setF({ ...f, rootCause: e.target.value })} /></div><Field label="Fix version" value={f.fixVersion} onChange={(e) => setF({ ...f, fixVersion: e.target.value })} /></>}
          {to === 'Duplicate' && <Field label="Original defect ID" required value={f.duplicateOfId} onChange={(e) => setF({ ...f, duplicateOfId: e.target.value })} placeholder="DEF-0001" />}
          <div className="md:col-span-3"><Field label={`Comment${NEEDS_COMMENT.has(to) ? '' : ' (optional)'}`} required={NEEDS_COMMENT.has(to)} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></div>
          {m.error && <div className="md:col-span-3"><Alert>{m.error.message}</Alert></div>}
          <div><Button type="submit" disabled={m.isPending}>Set to {DEFECT_STATUS_LABEL[to] ?? to}</Button></div>
        </form>
      )}
    </Card>
  );
}

function Fields({ d }: { d: DD }) {
  const { current, can, projects } = useProject();
  void projects;
  const qc = useQueryClient();
  const role = current?.myRole;
  const devOnly = role === 'Developer';
  const canEdit = can('defects.update');
  const [f, setF] = useState({
    title: d.title, description: d.description ?? '', module: d.module ?? '', requirementId: d.requirementId ?? '', environment: d.environment ?? '', build: d.build ?? '',
    browserDeviceOs: d.browserDeviceOs ?? '', preconditions: d.preconditions ?? '', stepsToReproduce: d.stepsToReproduce ?? '', testDataUsed: d.testDataUsed ?? '',
    expectedResult: d.expectedResult ?? '', actualResult: d.actualResult ?? '', severity: d.severity, priority: d.priority, defectType: d.defectType,
    rootCause: d.rootCause ?? '', fixVersion: d.fixVersion ?? '', targetDate: d.targetDate?.slice(0, 10) ?? '',
  });
  const m = useMutation({
    mutationFn: () => {
      const body = devOnly ? { rootCause: f.rootCause || null, fixVersion: f.fixVersion || null, targetDate: f.targetDate || null } : { ...f, targetDate: f.targetDate || null };
      return api(`${dbase(current!.id)}/${d.id}`, { method: 'PATCH', json: body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['defect', d.id] }),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const lock = !canEdit || devOnly;
  const ta = (k: keyof typeof f, label: string, rows = 3, editable = !lock) => (
    <div className="flex flex-col gap-1"><label htmlFor={`df-${k}`} className="text-sm font-medium">{label}</label><textarea id={`df-${k}`} rows={rows} readOnly={!editable} className="rounded border border-slate-400 p-2 text-sm read-only:bg-slate-50" value={f[k]} onChange={set(k)} /></div>
  );
  return (
    <Card title="Defect report">
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-4">
        <fieldset disabled={lock} className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <legend className="sr-only">Summary and classification</legend>
          <div className="md:col-span-4"><Field label="Title / summary" value={f.title} onChange={set('title')} /></div>
          <div>
            <Select label="Severity" value={f.severity} onChange={set('severity')} aria-describedby="sev-def">{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</Select>
            <p id="sev-def" className="mt-1 text-xs text-slate-600">{SEVERITY_DEF[f.severity]}</p>
          </div>
          <div>
            <Select label="Priority" value={f.priority} onChange={set('priority')} aria-describedby="pri-def">{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</Select>
            <p id="pri-def" className="mt-1 text-xs text-slate-600">{PRIORITY_DEF[f.priority]}</p>
          </div>
          <Select label="Defect type" value={f.defectType} onChange={set('defectType')}>{DEFECT_TYPES.map((s) => <option key={s}>{s}</option>)}</Select>
          <Field label="Module / feature" value={f.module} onChange={set('module')} />
          <Field label="Requirement ID(s)" value={f.requirementId} onChange={set('requirementId')} />
          <Field label="Environment" value={f.environment} onChange={set('environment')} />
          <Field label="Build / version" value={f.build} onChange={set('build')} />
          <Field label="Browser / device / OS" value={f.browserDeviceOs} onChange={set('browserDeviceOs')} />
        </fieldset>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ta('description', 'Description')}
          {ta('preconditions', 'Pre-conditions')}
          {ta('stepsToReproduce', 'Steps to reproduce', 6)}
          {ta('testDataUsed', 'Test data used', 6)}
          {ta('expectedResult', 'Expected result')}
          {ta('actualResult', 'Actual result')}
        </div>
        <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <legend className="mb-1 text-sm font-semibold">Resolution{devOnly ? ' (you can edit these)' : ''}</legend>
          <div className="md:col-span-3">{ta('rootCause', 'Root cause', 2, canEdit)}</div>
          <Field label="Fix version" value={f.fixVersion} onChange={set('fixVersion')} />
          <Field label="Target date" type="date" value={f.targetDate} onChange={set('targetDate')} />
          <div className="text-sm"><p><strong>Assigned to:</strong> {d.assignedTo ?? '—'}</p><p><strong>Reported:</strong> {d.reportedBy ?? '—'}, {new Date(d.reportedDate).toLocaleDateString()}</p><p><strong>Retest:</strong> {d.retestResult ?? '—'} · <strong>Closed:</strong> {d.closedDate ? new Date(d.closedDate).toLocaleDateString() : '—'}</p>{d.duplicateOf && <p><strong>Duplicate of:</strong> <Link className="underline" to={`/defects/${d.duplicateOf.id}`}>{d.duplicateOf.defectId}</Link></p>}</div>
        </fieldset>
        {m.error && <Alert>{m.error.message}</Alert>}
        {m.isSuccess && <Alert kind="success">Saved.</Alert>}
        {canEdit && <Button type="submit" disabled={m.isPending}>Save changes</Button>}
      </form>
    </Card>
  );
}

function Evidence({ d }: { d: DD }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const up = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api(`${dbase(current!.id)}/${d.id}/attachments`, { method: 'POST', body: fd }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['defect', d.id] }),
  });
  const images = IMAGE_ORDER.flatMap((k) => d.attachments.filter((a) => a.kind === k && a.mimeType.startsWith('image/')));
  const videos = d.attachments.filter((a) => a.mimeType.startsWith('video/'));
  const files = d.attachments.filter((a) => !a.mimeType.startsWith('image/') && !a.mimeType.startsWith('video/'));
  return (
    <Card title={`Evidence (${d.attachments.length})`} actions={can('defects.update') && <>
      <input ref={ref} type="file" className="hidden" tabIndex={-1} aria-hidden="true" accept="image/png,image/jpeg,image/gif,image/webp,video/webm,video/mp4,application/zip,application/json,application/pdf,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} />
      <Button variant="secondary" onClick={() => ref.current?.click()} disabled={up.isPending}>{up.isPending ? 'Uploading…' : 'Attach file'}</Button></>}>
      {up.error && <Alert>{up.error.message}</Alert>}
      {images.length > 0 && <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{images.map((a) => <Img key={a.id} a={a} />)}</div>}
      {videos.map((a) => <Video key={a.id} a={a} />)}
      {files.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{files.map((a) => <Button key={a.id} variant="secondary" onClick={() => download(`/projects/${current!.id}/execution/attachments/${a.id}`, a.fileName)}>{KIND_LABEL[a.kind] ?? a.kind} ({Math.ceil(a.sizeBytes / 1024)} KB)</Button>)}</div>}
      {d.attachments.some((a) => a.kind === 'Trace') && <p className="mt-2 text-xs text-slate-600">Open a trace with <code>npx playwright show-trace</code> or at trace.playwright.dev. Typed passwords are redacted.</p>}
      {!d.attachments.length && <p className="text-sm text-slate-600">No evidence attached yet.</p>}
    </Card>
  );
}

function Img({ a }: { a: AttachmentMeta }) {
  const { current } = useProject();
  const url = useBlobUrl(`/projects/${current!.id}/execution/attachments/${a.id}`);
  return (
    <figure className="rounded border border-slate-200 p-2">
      {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={KIND_LABEL[a.kind] ?? a.fileName} className="max-h-56 w-full object-contain" /></a> : <div className="h-40 animate-pulse bg-slate-100" />}
      <figcaption className="mt-1 text-xs text-slate-600">{KIND_LABEL[a.kind] ?? a.kind}</figcaption>
    </figure>
  );
}

function Video({ a }: { a: AttachmentMeta }) {
  const { current } = useProject();
  const url = useBlobUrl(`/projects/${current!.id}/execution/attachments/${a.id}`);
  return url ? <figure className="mt-3"><video src={url} controls className="max-h-80 w-full rounded border border-slate-200" aria-label="Recording of the failed test" /><figcaption className="text-xs text-slate-600">Video recording (no audio)</figcaption></figure> : null;
}

function History({ d }: { d: DD }) {
  const { current, can } = useProject();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const m = useMutation({ mutationFn: () => api(`${dbase(current!.id)}/${d.id}/comments`, { method: 'POST', json: { text } }), onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['defect', d.id] }); } });
  const label = (h: DD['history'][number]) => h.kind === 'Comment' ? 'commented'
    : h.kind === 'StatusChange' ? `${h.fromValue ? `${DEFECT_STATUS_LABEL[h.fromValue] ?? h.fromValue} → ` : ''}${DEFECT_STATUS_LABEL[h.toValue ?? ''] ?? h.toValue}`
    : `changed ${h.field}: ${h.fromValue ?? '—'} → ${h.toValue ?? '—'}`;
  return (
    <Card title="Comments & history">
      <ol className="space-y-3 text-sm" aria-label="Defect history">
        {d.history.map((h) => (
          <li key={h.id} className="border-l-2 border-slate-300 pl-3">
            <p className="text-xs text-slate-600">{new Date(h.createdAt).toLocaleString()} · <strong>{h.userName}</strong> {label(h)}</p>
            {h.comment && <p className="whitespace-pre-wrap">{h.comment}</p>}
          </li>
        ))}
      </ol>
      {can('defects.update') && (
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <label htmlFor="cmt" className="text-sm font-medium">Add a comment</label>
          <textarea id="cmt" rows={3} className="w-full rounded border border-slate-400 p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
          {m.error && <Alert>{m.error.message}</Alert>}
          <Button type="submit" disabled={!text.trim() || m.isPending}>Comment</Button>
        </form>
      )}
    </Card>
  );
}
