import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useProject } from '../lib/project';
import { ROLE_LABEL } from '../lib/types';
import { Badge, Button } from './ui';

/** Navigation for the full STLC. Items for later phases are listed but marked "Coming soon". */
const NAV: { to: string; label: string; phase: number }[] = [
  { to: '/', label: 'Overview', phase: 1 },
  { to: '/requirements', label: 'Requirements & RTM', phase: 2 },
  { to: '/artefacts', label: 'Test Artefacts', phase: 3 },
  { to: '/execution', label: 'Test Execution', phase: 4 },
  { to: '/defects', label: 'Defects', phase: 5 },
  { to: '/monitoring', label: 'Defect Monitoring', phase: 7 },
  { to: '/reports', label: 'Reports & Dashboard', phase: 8 },
  { to: '/closure', label: 'Test Closure', phase: 9 },
  { to: '/audit', label: 'Audit Trail', phase: 1 },
];
const CURRENT_PHASE = 2;

export function Layout() {
  const { user, logout } = useAuth();
  const { projects, current, currentId, setCurrentId } = useProject();

  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Skip to main content</a>
      <aside className="border-b border-slate-200 bg-brand-900 text-white md:min-h-screen md:w-64 md:border-b-0">
        <div className="p-4">
          <p className="text-lg font-bold">QA Pilot</p>
          <p className="text-xs text-brand-100">Software testing life cycle</p>
        </div>
        <div className="px-4 pb-3">
          <label htmlFor="project-switch" className="mb-1 block text-xs text-brand-100">Project</label>
          <select id="project-switch" className="w-full rounded bg-white px-2 py-1.5 text-sm text-slate-900" value={currentId ?? ''}
            onChange={(e) => setCurrentId(e.target.value || null)}>
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.key} – {p.name}</option>)}
          </select>
        </div>
        <nav aria-label="Main" className="flex flex-row flex-wrap gap-1 px-2 pb-3 md:flex-col">
          {NAV.map((n) => n.phase <= CURRENT_PHASE ? (
            <NavLink key={n.to} to={n.to} end className={({ isActive }) => `rounded px-3 py-2 text-sm ${isActive ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'}`}>{n.label}</NavLink>
          ) : (
            <span key={n.to} aria-disabled="true" className="flex items-center justify-between rounded px-3 py-2 text-sm text-brand-100/80">
              {n.label}<span className="text-[10px] uppercase">Soon</span>
            </span>
          ))}
          <NavLink to="/projects" className={({ isActive }) => `rounded px-3 py-2 text-sm ${isActive ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'}`}>All projects</NavLink>
          {user?.role === 'Admin' && <NavLink to="/users" className={({ isActive }) => `rounded px-3 py-2 text-sm ${isActive ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'}`}>Users</NavLink>}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
          <p className="text-sm text-slate-700">{current ? <><strong>{current.name}</strong> · {current.client ?? 'No client'}</> : 'Select or create a project'}</p>
          <div className="flex items-center gap-3">
            <span className="text-sm">{user?.name}</span>
            {current?.myRole && <Badge color="blue">{ROLE_LABEL[current.myRole]}</Badge>}
            <Button variant="secondary" onClick={logout}>Sign out</Button>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl p-6"><Outlet /></main>
      </div>
    </div>
  );
}
