export type Role = 'Admin' | 'QALead' | 'Tester' | 'Developer' | 'Client';
export const ROLES: Role[] = ['Admin', 'QALead', 'Tester', 'Developer', 'Client'];
export const ROLE_LABEL: Record<Role, string> = { Admin: 'Admin', QALead: 'QA Lead', Tester: 'Tester', Developer: 'Developer', Client: 'Client (view-only)' };

export interface User { id: string; email: string; name: string; role: Role; active?: boolean; lastLoginAt?: string | null }
export interface ProjectSummary {
  id: string; key: string; name: string; client?: string | null; description?: string | null; status: string;
  startDate?: string | null; endDate?: string | null; myRole?: Role; memberCount?: number;
}
export interface ProjectDetail extends ProjectSummary {
  members: { id: string; role: Role; user: User }[];
  permissions: string[];
}
export interface AuditItem {
  id: string; action: string; entityType: string; entityId?: string | null; before?: string | null; after?: string | null;
  createdAt: string; user?: { name: string; email: string } | null;
}
