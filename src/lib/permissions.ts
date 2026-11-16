import type { ModuleKey, OrgMember, Permission, Role } from '../types/domain';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  org_admin: 'Organisation Admin',
  plant_head: 'Plant Head',
  dept_head: 'Department Head',
  supervisor: 'Supervisor',
  operator: 'Operator',
  ehs_manager: 'EHS Manager',
  auditor: 'Auditor',
  viewer: 'Viewer',
};

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    'dashboard.read',
    'users.manage',
    'sites.manage',
    'departments.manage',
    'nexus.read',
    'nexus.write',
    'nexus.approve',
    'environ.read',
    'environ.write',
    'environ.approve',
    'records.read',
    'records.create',
    'records.update',
    'records.approve',
    'tasks.create',
    'tasks.assign',
    'reports.read',
    'reports.export',
    'settings.manage',
    'audit.read',
  ],
  org_admin: [
    'dashboard.read',
    'users.manage',
    'sites.manage',
    'departments.manage',
    'nexus.read',
    'nexus.write',
    'nexus.approve',
    'environ.read',
    'environ.write',
    'environ.approve',
    'records.read',
    'records.create',
    'records.update',
    'records.approve',
    'tasks.create',
    'tasks.assign',
    'reports.read',
    'reports.export',
    'settings.manage',
    'audit.read',
  ],
  plant_head: [
    'dashboard.read',
    'departments.manage',
    'nexus.read',
    'nexus.write',
    'nexus.approve',
    'environ.read',
    'environ.write',
    'environ.approve',
    'records.read',
    'records.create',
    'records.update',
    'records.approve',
    'tasks.create',
    'tasks.assign',
    'reports.read',
    'reports.export',
    'audit.read',
  ],
  dept_head: [
    'dashboard.read',
    'nexus.read',
    'nexus.write',
    'nexus.approve',
    'environ.read',
    'environ.write',
    'environ.approve',
    'records.read',
    'records.create',
    'records.update',
    'records.approve',
    'tasks.create',
    'tasks.assign',
    'reports.read',
    'reports.export',
  ],
  supervisor: [
    'dashboard.read',
    'nexus.read',
    'nexus.write',
    'nexus.approve',
    'environ.read',
    'environ.write',
    'records.read',
    'records.create',
    'records.update',
    'records.approve',
    'tasks.create',
    'tasks.assign',
    'reports.read',
  ],
  operator: [
    'dashboard.read',
    'nexus.read',
    'nexus.write',
    'records.read',
    'records.create',
    'tasks.create',
  ],
  ehs_manager: [
    'dashboard.read',
    'environ.read',
    'environ.write',
    'environ.approve',
    'records.read',
    'records.create',
    'records.update',
    'records.approve',
    'tasks.create',
    'tasks.assign',
    'reports.read',
    'reports.export',
    'audit.read',
  ],
  auditor: [
    'dashboard.read',
    'nexus.read',
    'environ.read',
    'records.read',
    'reports.read',
    'reports.export',
    'audit.read',
  ],
  viewer: [
    'dashboard.read',
    'nexus.read',
    'environ.read',
    'records.read',
    'reports.read',
  ],
};

export function hasPermission(member: OrgMember | null | undefined, permission: Permission): boolean {
  if (!member || member.status !== 'active') return false;
  return ROLE_PERMISSIONS[member.role]?.includes(permission) ?? false;
}

export function hasSiteAccess(member: OrgMember | null | undefined, siteId: string): boolean {
  if (!member || member.status !== 'active') return false;
  if (member.role === 'super_admin' || member.role === 'org_admin') return true;
  if (siteId === 'ALL') return member.siteIds.length > 0;
  return member.siteIds.includes(siteId);
}

export function canApproveModule(member: OrgMember | null | undefined, moduleKey: ModuleKey): boolean {
  if (!member || member.status !== 'active') return false;
  if (moduleKey === 'nexus') return hasPermission(member, 'nexus.approve');
  if (moduleKey === 'environ') return hasPermission(member, 'environ.approve');
  return hasPermission(member, 'records.approve');
}

export function canWriteModule(member: OrgMember | null | undefined, moduleKey: ModuleKey): boolean {
  if (!member || member.status !== 'active') return false;
  if (moduleKey === 'nexus') return hasPermission(member, 'nexus.write');
  if (moduleKey === 'environ') return hasPermission(member, 'environ.write');
  return hasPermission(member, 'records.create');
}
