import { Role } from './enums';

/**
 * Permission matrix. Global role applies unless a project-level membership role overrides it.
 * Admin implicitly has every permission.
 */
export const PERMISSIONS = {
  'users.manage': ['Admin'],
  'project.create': ['Admin', 'QALead'],
  'project.manage': ['Admin', 'QALead'], // edit project, members, settings, integrations
  'project.view': ['Admin', 'QALead', 'Tester', 'Developer', 'Client'],
  'project.export': ['Admin', 'QALead'],
  'audit.view': ['Admin', 'QALead'],
  'requirements.edit': ['Admin', 'QALead', 'Tester'],
  'coverage.acknowledge': ['Admin', 'QALead'],
  'artefacts.edit': ['Admin', 'QALead', 'Tester'],
  'artefacts.review': ['Admin', 'QALead'],
  'execution.run': ['Admin', 'QALead', 'Tester'],
  'defects.create': ['Admin', 'QALead', 'Tester'],
  'defects.update': ['Admin', 'QALead', 'Tester', 'Developer'],
  'reports.edit': ['Admin', 'QALead'],
  'closure.trigger': ['Admin', 'QALead'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleHas(role: Role | string, permission: Permission): boolean {
  if (role === 'Admin') return true;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}
