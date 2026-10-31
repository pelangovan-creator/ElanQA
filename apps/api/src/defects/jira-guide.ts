/**
 * Manual "create this ticket in Jira" guide (section 6.1). QA Pilot does NOT connect to Jira:
 * the guide gives the 11 steps with the defect's own values ready to copy, and an illustrated
 * screen for each step showing where to click and what to enter.
 */
export const JIRA_PRIORITY: Record<string, string> = { P1: 'Highest', P2: 'High', P3: 'Medium', P4: 'Low' };

export interface GuideDefect {
  defectId: string; title: string; module: string | null; requirementId: string | null; environment: string | null; build: string | null;
  browserDeviceOs: string | null; preconditions: string | null; stepsToReproduce: string | null; testDataUsed: string | null;
  expectedResult: string | null; actualResult: string | null; severity: string; priority: string; assignedTo: string | null;
  testRunId: string | null; tcId: string | null; attachments: { kind: string; fileName: string }[];
}
export interface GuideStep {
  no: number; title: string; instruction: string;
  values: { label: string; value: string; copy?: boolean }[];
  /** Area highlighted in the illustration. */
  focus: 'project' | 'create' | 'type' | 'summary' | 'description' | 'priority' | 'meta' | 'people' | 'attach' | 'link' | 'done';
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function jiraDescription(d: GuideDefect): string {
  const block = (h: string, v: string | null) => (v ? `*${h}*\n${v}\n` : '');
  return [
    block('Pre-conditions', d.preconditions),
    block('Steps to Reproduce', d.stepsToReproduce),
    block('Expected Result', d.expectedResult),
    block('Actual Result', d.actualResult),
    `*Environment:* ${d.environment ?? '—'}`,
    `*Build:* ${d.build ?? '—'}`,
    `*Browser / Device / OS:* ${d.browserDeviceOs ?? '—'}`,
    `*Test Data:* ${d.testDataUsed ?? '—'}`,
    `*Severity:* ${d.severity}`,
    `*References:* QA Pilot ${d.defectId}${d.tcId ? ` · ${d.tcId}` : ''}${d.testRunId ? ` · ${d.testRunId}` : ''}${d.requirementId ? ` · ${d.requirementId}` : ''}`,
  ].join('\n');
}

export function buildGuide(d: GuideDefect): GuideStep[] {
  const labels = ['QA', 'QA-Pilot', d.module ? slug(d.module) : null, d.testRunId ? 'Regression' : null].filter(Boolean).join(', ');
  const evidence = d.attachments.map((a) => a.fileName);
  return [
    { no: 1, focus: 'project', title: 'Log in to Jira and open the correct project', instruction: 'Sign in to your Jira site and open the project where this application\'s bugs are tracked (ask your QA Lead if you are unsure which project).', values: [] },
    { no: 2, focus: 'create', title: 'Click Create', instruction: 'Click the Create button in the top navigation bar. The "Create issue" form opens.', values: [] },
    { no: 3, focus: 'type', title: 'Select Issue Type = Bug', instruction: 'In the Issue type field, choose Bug.', values: [{ label: 'Issue type', value: 'Bug' }] },
    { no: 4, focus: 'summary', title: 'Enter the Summary', instruction: 'Paste the defect title into Summary.', values: [{ label: 'Summary', value: d.title, copy: true }] },
    { no: 5, focus: 'description', title: 'Fill in the Description', instruction: 'Paste the prepared description. It contains steps to reproduce, expected and actual result, environment, build, browser/device and test data.', values: [{ label: 'Description', value: jiraDescription(d), copy: true }] },
    { no: 6, focus: 'priority', title: 'Set Priority and Severity', instruction: `Set Priority using the mapping P1→Highest, P2→High, P3→Medium, P4→Low. If your Jira has a Severity field, set it too.`, values: [{ label: 'Priority', value: `${JIRA_PRIORITY[d.priority] ?? d.priority} (QA Pilot ${d.priority})` }, { label: 'Severity (custom field, if configured)', value: d.severity }] },
    { no: 7, focus: 'meta', title: 'Set Component, Affects Version, Labels and Sprint', instruction: 'Fill the classification fields your project uses.', values: [{ label: 'Component', value: d.module ?? '—', copy: !!d.module }, { label: 'Affects Version', value: d.build ?? '—', copy: !!d.build }, { label: 'Labels', value: labels, copy: true }, { label: 'Sprint', value: 'Current sprint (if your project uses sprints)' }] },
    { no: 8, focus: 'people', title: 'Set Assignee and Reporter', instruction: 'Choose the assignee, or leave it empty so the team can triage it. Reporter is normally you.', values: [{ label: 'Assignee', value: d.assignedTo ?? 'Leave unassigned for triage' }, { label: 'Reporter', value: 'You' }] },
    { no: 9, focus: 'attach', title: 'Attach the screenshots, video and logs', instruction: evidence.length ? 'Click "Download evidence (ZIP)" in QA Pilot, unzip it, and drag the files into the Attachment area.' : 'Attach a screenshot of the problem (mandatory) and any logs.', values: evidence.length ? [{ label: 'Files', value: evidence.join(', ') }] : [] },
    { no: 10, focus: 'link', title: 'Link the related Story / Epic / Requirement', instruction: 'Under Linked issues choose "relates to" (or "blocks" if this defect blocks the story) and select the story or epic for this requirement.', values: [{ label: 'Link type', value: 'relates to' }, { label: 'Requirement', value: d.requirementId ?? '—' }] },
    { no: 11, focus: 'done', title: 'Click Create and copy the key back', instruction: 'Click Create. Jira shows the new key (for example PROJ-123). Copy it and paste it into "Jira ticket" in QA Pilot so the defect is traceable.', values: [{ label: 'QA Pilot defect', value: d.defectId }] },
  ];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clip = (s: string | null | undefined, n: number) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Illustrated screen for one step: a neutral issue-tracker mock with the relevant control highlighted. */
export function stepHtml(step: GuideStep, d: GuideDefect): string {
  const hl = (area: GuideStep['focus']) => (step.focus === area ? ' hl' : '');
  const callout = `<div class="callout"><span class="num">${step.no}</span>${esc(step.title)}</div>`;
  const modalOpen = !['project', 'create', 'done'].includes(step.focus);
  const desc = jiraDescription(d).split('\n').slice(0, 9).map((l) => esc(clip(l, 95))).join('<br>');
  const field = (label: string, value: string, area: GuideStep['focus'], cls = '') => `<div class="f${hl(area)} ${cls}"><label>${esc(label)}</label><div class="in">${value}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#172b4d;background:#f4f5f7;width:1200px;height:750px;overflow:hidden;position:relative}
  .top{height:52px;background:#fff;border-bottom:1px solid #dfe1e6;display:flex;align-items:center;gap:22px;padding:0 18px}
  .logo{font-weight:bold;color:#253858} .nav{color:#42526e} .create{background:#2457c5;color:#fff;padding:7px 14px;border-radius:4px;font-weight:bold}
  .side{position:absolute;top:52px;left:0;width:230px;bottom:0;background:#fafbfc;border-right:1px solid #dfe1e6;padding:16px}
  .proj{padding:8px;border-radius:4px;margin-bottom:6px;color:#42526e} .proj.on{background:#e9f0fe;color:#2457c5;font-weight:bold}
  .main{position:absolute;top:52px;left:230px;right:0;bottom:0;padding:24px}
  .board{display:flex;gap:12px} .col{flex:1;background:#ebecf0;border-radius:4px;padding:8px;height:420px} .card{background:#fff;border-radius:3px;height:46px;margin:6px 0;box-shadow:0 1px 1px #091e4240}
  .shade{position:absolute;inset:0;background:rgba(9,30,66,.45)}
  .modal{position:absolute;top:64px;left:260px;width:680px;height:640px;background:#fff;border-radius:6px;box-shadow:0 8px 24px #0005;padding:18px 22px;overflow:hidden}
  .modal h2{margin:0 0 12px;font-size:18px} .row{display:flex;gap:12px} .row .f{flex:1}
  .f{margin-bottom:9px;padding:4px;border-radius:5px} .f label{display:block;font-size:11px;font-weight:bold;color:#5e6c84;margin-bottom:3px}
  .in{border:2px solid #dfe1e6;border-radius:3px;padding:6px 8px;min-height:30px;background:#fafbfc;line-height:1.35} .tall .in{height:150px;overflow:hidden;font-size:11px}
  .drop{border:2px dashed #b3bac5;border-radius:4px;padding:10px;color:#5e6c84;font-size:11px}
  .btns{position:absolute;bottom:14px;right:22px;display:flex;gap:8px} .btn{padding:7px 14px;border-radius:4px;background:#f4f5f7} .btn.p{background:#2457c5;color:#fff;font-weight:bold}
  .hl{outline:4px solid #dc2626;outline-offset:3px;background:#fff5f5;position:relative;z-index:2}
  .create.hl,.btn.p.hl{background:#2457c5;color:#fff}
  .callout{position:absolute;right:16px;top:64px;z-index:5;max-width:300px;background:#dc2626;color:#fff;padding:10px 12px;border-radius:6px;font-weight:bold;box-shadow:0 4px 12px #0004}
  .num{display:inline-block;background:#fff;color:#dc2626;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;margin-right:8px}
  .toast{position:absolute;left:250px;bottom:30px;width:420px;background:#fff;border-left:6px solid #22a06b;border-radius:4px;box-shadow:0 8px 24px #0004;padding:14px;z-index:3}
  .wm{position:absolute;left:12px;bottom:8px;font-size:11px;color:#6b778c;z-index:6;background:#fffd;padding:2px 6px;border-radius:3px}
  </style></head><body>
  <div class="top"><span class="logo">Issue tracker</span><span class="nav">Your work</span><span class="nav">Projects ▾</span><span class="nav">Filters ▾</span><span class="create${hl('create')}">+ Create</span></div>
  <div class="side"><div style="font-size:11px;color:#5e6c84;margin-bottom:8px">PROJECTS</div><div class="proj on${hl('project')}">▣ Your Jira project</div><div class="proj">▣ Other project</div><div class="proj">▣ Support desk</div></div>
  <div class="main"><div class="board">${[0, 1, 2].map((c) => `<div class="col"><div style="font-size:11px;color:#5e6c84">${['TO DO', 'IN PROGRESS', 'DONE'][c]}</div>${'<div class="card"></div>'.repeat(4 - c)}</div>`).join('')}</div></div>
  ${modalOpen ? `<div class="shade"></div><div class="modal"><h2>Create issue</h2>
    <div class="row">${field('Project', 'Your Jira project', 'project')}${field('Issue type *', '🐞 Bug', 'type')}</div>
    ${field('Summary *', esc(clip(d.title, 90)), 'summary')}
    ${field('Description', desc, 'description', 'tall')}
    <div class="row">${field('Priority', esc(`${JIRA_PRIORITY[d.priority] ?? d.priority}`), 'priority')}${field('Severity', esc(d.severity), 'priority')}${field('Component', esc(d.module ?? '—'), 'meta')}${field('Affects version', esc(d.build ?? '—'), 'meta')}</div>
    <div class="row">${field('Labels', esc(clip(['QA', 'QA-Pilot', d.module ? slug(d.module) : ''].filter(Boolean).join(' · '), 40)), 'meta')}${field('Assignee', esc(d.assignedTo ?? 'Unassigned'), 'people')}${field('Reporter', 'You', 'people')}</div>
    <div class="row"><div class="f${hl('attach')}"><label>Attachment</label><div class="drop">${d.attachments.length ? esc(clip(d.attachments.map((a) => a.fileName).join(', '), 120)) : 'Drop files to attach, or browse'}</div></div>
      <div class="f${hl('link')}"><label>Linked issues</label><div class="in">relates to · ${esc(clip(d.requirementId ?? 'story / epic', 30))}</div></div></div>
    <div class="btns"><span class="btn">Cancel</span><span class="btn p${hl('done')}">Create</span></div></div>` : ''}
  ${step.focus === 'done' ? `<div class="toast hl"><b>✓ Issue PROJ-123 has been created</b><br><span style="color:#5e6c84">“${esc(clip(d.title, 60))}”</span><br><span style="color:#2457c5;text-decoration:underline">PROJ-123</span> – copy this key into QA Pilot (${esc(d.defectId)} → Jira ticket)</div>` : ''}
  ${callout}
  <div class="wm">Illustration – your Jira screen may look different · QA Pilot ${esc(d.defectId)}</div>
  </body></html>`;
}
