import { describe, expect, it } from 'vitest';
import {
  canApproveModule,
  canWriteModule,
  hasPermission,
  hasSiteAccess,
  ROLE_LABELS,
} from '../lib/permissions';
import { DEMO_CREDENTIALS } from '../services/demoSeedService';
import type { OrgMember, Role } from '../types/domain';

function makeMember(overrides: Partial<OrgMember>): OrgMember {
  return {
    userId: 'user_1',
    organisationId: 'org_alpha',
    email: 'user@alpha.com',
    displayName: 'Test User',
    role: 'operator',
    siteIds: ['site_1'],
    departmentIds: ['dept_1'],
    status: 'active',
    createdBy: 'admin_1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RBAC Permissions & Multi-Tenant Site Restrictions', () => {
  it('allows operator to write Nexus logs but denies Nexus approval and Environ writes', () => {
    const operator = makeMember({ role: 'operator' });
    expect(canWriteModule(operator, 'nexus')).toBe(true);
    expect(canApproveModule(operator, 'nexus')).toBe(false);
    expect(canWriteModule(operator, 'environ')).toBe(false);
    expect(hasPermission(operator, 'users.manage')).toBe(false);
  });

  it('allows ehs_manager to write and approve Environ but not manage users or write Nexus', () => {
    const ehs = makeMember({ role: 'ehs_manager' });
    expect(canWriteModule(ehs, 'environ')).toBe(true);
    expect(canApproveModule(ehs, 'environ')).toBe(true);
    expect(canWriteModule(ehs, 'nexus')).toBe(false);
    expect(hasPermission(ehs, 'audit.read')).toBe(true);
    expect(hasPermission(ehs, 'users.manage')).toBe(false);
  });

  it('restricts viewer and auditor from mutating records or exporting unauthorized actions', () => {
    const viewer = makeMember({ role: 'viewer' });
    const auditor = makeMember({ role: 'auditor' });

    expect(canWriteModule(viewer, 'nexus')).toBe(false);
    expect(canWriteModule(viewer, 'environ')).toBe(false);
    expect(hasPermission(viewer, 'reports.export')).toBe(false);

    expect(canWriteModule(auditor, 'nexus')).toBe(false);
    expect(hasPermission(auditor, 'audit.read')).toBe(true);
    expect(hasPermission(auditor, 'reports.export')).toBe(true);
  });

  it('revokes all permissions immediately when member is deactivated', () => {
    const deactivatedAdmin = makeMember({ role: 'org_admin', status: 'deactivated' });
    expect(hasPermission(deactivatedAdmin, 'dashboard.read')).toBe(false);
    expect(hasPermission(deactivatedAdmin, 'users.manage')).toBe(false);
    expect(hasSiteAccess(deactivatedAdmin, 'site_1')).toBe(false);
  });

  it('enforces site isolation for non-admin roles while granting org_admin full site access', () => {
    const supervisor = makeMember({ role: 'supervisor', siteIds: ['site_1'] });
    const admin = makeMember({ role: 'org_admin', siteIds: ['site_1'] });

    expect(hasSiteAccess(supervisor, 'site_1')).toBe(true);
    expect(hasSiteAccess(supervisor, 'site_2')).toBe(false);
    expect(hasSiteAccess(admin, 'site_2')).toBe(true);
  });

  it('provides unique demo credentials for all 9 RBAC roles', () => {
    const expectedRoles = Object.keys(ROLE_LABELS) as Role[];
    const demoRoles = DEMO_CREDENTIALS.map((c) => c.role);
    const demoEmails = new Set(DEMO_CREDENTIALS.map((c) => c.email));
    expect(demoRoles).toHaveLength(9);
    expect(demoEmails.size).toBe(9);
    for (const r of expectedRoles) {
      expect(demoRoles).toContain(r);
    }
  });
});
