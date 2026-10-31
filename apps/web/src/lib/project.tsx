import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ProjectDetail, ProjectSummary } from './types';

const KEY = 'qapilot.project';
interface ProjectCtx {
  projects: ProjectSummary[];
  current: ProjectDetail | undefined;
  currentId: string | null;
  setCurrentId: (id: string | null) => void;
  can: (perm: string) => boolean;
  refetchProjects: () => void;
}
const Ctx = createContext<ProjectCtx | null>(null);

/** Multi-project support: remembers the selected project and exposes its permissions. */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [currentId, setId] = useState<string | null>(() => localStorage.getItem(KEY));
  const list = useQuery({ queryKey: ['projects'], queryFn: () => api<ProjectSummary[]>('/projects') });
  const projects = list.data ?? [];

  useEffect(() => {
    if (!list.data) return;
    if (!currentId || !list.data.some((p) => p.id === currentId)) setCurrentId(list.data[0]?.id ?? null);
  }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only fetch a project the signed-in user can actually see (a stale id from another session is ignored).
  const visible = !!currentId && projects.some((p) => p.id === currentId);
  const detail = useQuery({ queryKey: ['project', currentId], queryFn: () => api<ProjectDetail>(`/projects/${currentId}`), enabled: visible });

  const setCurrentId = (id: string | null) => {
    if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY);
    setId(id);
  };
  const can = (perm: string) => !!detail.data?.permissions.includes(perm);

  return <Ctx.Provider value={{ projects, current: visible ? detail.data : undefined, currentId, setCurrentId, can, refetchProjects: () => list.refetch() }}>{children}</Ctx.Provider>;
}

export function useProject() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useProject outside ProjectProvider');
  return ctx;
}
