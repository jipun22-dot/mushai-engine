import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserPlus, Power, Ban, KeyRound, Copy, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission, ROLE_LABELS } from '../lib/permissions';
import {
  createDepartment,
  createInvitation,
  createSite,
  listOperationalRecords,
  listOrgInvitations,
  provisionClientMemberWithCredentials,
  revokeInvitation,
  updateOrgMember,
  updateSiteStatus,
} from '../services/firestoreService';
import { formatTimestamp } from '../lib/utils';
import type { AuditLogPayload, OrgMember, Role } from '../types/domain';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { Input, Label } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { EmptyState, TableSkeleton } from '../components/ui/EmptyState';
import { StatusBadge, statusToTone } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { useToast } from '../components/ui/ToastProvider';

const ASSIGNABLE_ROLES: Array<Exclude<Role, 'super_admin'>> = [
  'org_admin',
  'plant_head',
  'dept_head',
  'supervisor',
  'operator',
  'ehs_manager',
  'auditor',
  'viewer',
];

export function OrganisationPage() {
  const { activeOrg, activeMember, sites, departments, members, actor, refreshContext } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const orgId = activeOrg?.id;
  const canManageSites = hasPermission(activeMember, 'sites.manage');
  const canManageDepts = hasPermission(activeMember, 'departments.manage');
  const canManageUsers = hasPermission(activeMember, 'users.manage');
  const canReadAudit = hasPermission(activeMember, 'audit.read');

  const [siteModal, setSiteModal] = React.useState(false);
  const [deptModal, setDeptModal] = React.useState(false);
  const [inviteModal, setInviteModal] = React.useState(false);
  const [credModal, setCredModal] = React.useState(false);
  const [editMember, setEditMember] = React.useState<OrgMember | null>(null);

  // Forms state
  const [siteName, setSiteName] = React.useState('');
  const [siteCode, setSiteCode] = React.useState('');
  const [siteLocation, setSiteLocation] = React.useState('');

  const [deptSiteId, setDeptSiteId] = React.useState(sites[0]?.id || '');
  const [deptName, setDeptName] = React.useState('');
  const [deptCode, setDeptCode] = React.useState('');

  const [invEmail, setInvEmail] = React.useState('');
  const [invRole, setInvRole] = React.useState<Exclude<Role, 'super_admin'>>('supervisor');
  const [invSiteIds, setInvSiteIds] = React.useState<string[]>(sites[0]?.id ? [sites[0].id] : []);

  const [credName, setCredName] = React.useState('');
  const [credEmail, setCredEmail] = React.useState('');
  const [credPassword, setCredPassword] = React.useState('');
  const [credRole, setCredRole] = React.useState<Exclude<Role, 'super_admin'>>('operator');
  const [credSiteIds, setCredSiteIds] = React.useState<string[]>(sites[0]?.id ? [sites[0].id] : []);
  const [credBusy, setCredBusy] = React.useState(false);
  const [issuedReceipt, setIssuedReceipt] = React.useState<{
    displayName: string;
    email: string;
    password: string;
    role: Role;
  } | null>(null);
  const [copiedReceipt, setCopiedReceipt] = React.useState(false);

  const [editRole, setEditRole] = React.useState<Role>('operator');
  const [editSiteIds, setEditSiteIds] = React.useState<string[]>([]);
  const [editDeptIds, setEditDeptIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!deptSiteId && sites[0]?.id) setDeptSiteId(sites[0].id);
    if (invSiteIds.length === 0 && sites[0]?.id) setInvSiteIds([sites[0].id]);
    if (credSiteIds.length === 0 && sites[0]?.id) setCredSiteIds([sites[0].id]);
  }, [sites, deptSiteId, invSiteIds.length, credSiteIds.length]);

  const { data: invitations = [] } = useQuery({
    queryKey: ['invitations', orgId, actor?.uid],
    enabled: Boolean(orgId && actor && canManageUsers),
    queryFn: async () => (orgId && actor ? listOrgInvitations(orgId, actor.uid) : []),
  });

  const { data: auditLogs = [], isLoading: loadingAudit } = useQuery({
    queryKey: ['audit_logs', orgId],
    enabled: Boolean(orgId && canReadAudit),
    queryFn: async () => (orgId ? listOperationalRecords<AuditLogPayload>(orgId, 'audit_logs', { pageSize: 100 }) : []),
  });

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !actor) return;
    await createSite(orgId, actor, { name: siteName, code: siteCode, location: siteLocation });
    notify({ tone: 'success', title: `Created site ${siteName}` });
    setSiteModal(false);
    setSiteName('');
    setSiteCode('');
    setSiteLocation('');
    await refreshContext();
  };

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !actor) return;
    await createDepartment(orgId, actor, { siteId: deptSiteId, name: deptName, code: deptCode });
    notify({ tone: 'success', title: `Created department ${deptName}` });
    setDeptModal(false);
    setDeptName('');
    setDeptCode('');
    await refreshContext();
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg || !actor) return;
    await createInvitation(activeOrg.id, activeOrg.name, actor, {
      email: invEmail,
      role: invRole,
      siteIds: invSiteIds,
      departmentIds: [],
    });
    notify({ tone: 'success', title: 'Invitation Created', description: `Sent to ${invEmail}` });
    setInviteModal(false);
    setInvEmail('');
    await queryClient.invalidateQueries({ queryKey: ['invitations', activeOrg.id] });
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !actor || !editMember) return;
    await updateOrgMember(orgId, actor, editMember.userId, {
      role: editRole,
      siteIds: editSiteIds,
      departmentIds: editDeptIds,
    });
    notify({ tone: 'success', title: 'Member Updated' });
    setEditMember(null);
    await refreshContext();
  };

  const generateClientPassword = () => {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const digits = Math.floor(1000 + Math.random() * 9000);
    setCredPassword(`Mushai#${suffix}${digits}`);
  };

  const handleIssueCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg || !actor) return;
    setCredBusy(true);
    try {
      const issued = await provisionClientMemberWithCredentials(activeOrg.id, activeOrg.name, actor, {
        displayName: credName,
        email: credEmail,
        password: credPassword,
        role: credRole,
        siteIds: credSiteIds,
        departmentIds: [],
      });
      setCredModal(false);
      setIssuedReceipt({
        displayName: issued.displayName,
        email: issued.email,
        password: credPassword,
        role: issued.role,
      });
      setCredName('');
      setCredEmail('');
      setCredPassword('');
      notify({
        tone: 'success',
        title: 'Client Credentials Issued',
        description: `${issued.email} can now sign in with their issued password.`,
      });
      await refreshContext();
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Unable to issue credentials',
        description: err instanceof Error ? err.message : 'Unexpected error',
      });
    } finally {
      setCredBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisation Management"
        subtitle="Multi-site plant hierarchy, departments, team access control & immutable audit trail."
      />

      <Tabs defaultValue="sites">
        <TabsList>
          <TabsTrigger value="sites">Sites ({sites.length})</TabsTrigger>
          <TabsTrigger value="departments">Departments ({departments.length})</TabsTrigger>
          <TabsTrigger value="members">Employees &amp; Roles ({members.length})</TabsTrigger>
          {canManageUsers && <TabsTrigger value="invitations">Invitations ({invitations.length})</TabsTrigger>}
          {canReadAudit && <TabsTrigger value="audit">Audit History ({auditLogs.length})</TabsTrigger>}
        </TabsList>

        {/* SITES */}
        <TabsContent value="sites" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Plants &amp; Sites</CardTitle>
                <CardDescription>Physical facilities belonging to {activeOrg?.name}</CardDescription>
              </div>
              {canManageSites && (
                <Button variant="primary" size="sm" onClick={() => setSiteModal(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add Site
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Site Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sites.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs font-mono-tabular font-semibold">{s.code}</TableCell>
                      <TableCell className="text-xs font-medium">{s.name}</TableCell>
                      <TableCell className="text-xs text-[#555f69]">{s.location || '—'}</TableCell>
                      <TableCell><StatusBadge tone={statusToTone(s.status)}>{s.status}</StatusBadge></TableCell>
                      <TableCell className="text-right">
                        {canManageSites && orgId && actor && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              await updateSiteStatus(orgId, actor, s.id, {
                                status: s.status === 'active' ? 'inactive' : 'active',
                              });
                              await refreshContext();
                            }}
                          >
                            <Power className="h-3.5 w-3.5" />
                            {s.status === 'active' ? 'Deactivate' : 'Activate'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* DEPARTMENTS */}
        <TabsContent value="departments" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Departments</CardTitle>
                <CardDescription>Functional units assigned to plant sites</CardDescription>
              </div>
              {canManageDepts && (
                <Button variant="primary" size="sm" onClick={() => setDeptModal(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add Department
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {departments.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No departments" description="Add departments under your plant sites." />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departments.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-xs font-mono-tabular font-semibold">{d.code}</TableCell>
                        <TableCell className="text-xs font-medium">{d.name}</TableCell>
                        <TableCell className="text-xs font-mono-tabular">
                          {sites.find((s) => s.id === d.siteId)?.code || d.siteId}
                        </TableCell>
                        <TableCell><StatusBadge tone={statusToTone(d.status)}>{d.status}</StatusBadge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* EMPLOYEES & ROLES */}
        <TabsContent value="members" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Employees &amp; Role Assignments</CardTitle>
                <CardDescription>Site access, department scope, and account activation</CardDescription>
              </div>
              {canManageUsers && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      if (!credPassword) generateClientPassword();
                      setCredModal(true);
                    }}
                  >
                    <KeyRound className="h-3.5 w-3.5" /> Issue Client Credentials
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setInviteModal(true)}>
                    <UserPlus className="h-3.5 w-3.5" /> Invite by Email
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Authorized Sites</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Manage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell className="text-xs">
                        <div className="font-medium">{m.displayName}</div>
                        <div className="text-[#555f69]">{m.email}</div>
                      </TableCell>
                      <TableCell className="text-xs font-medium">{ROLE_LABELS[m.role]}</TableCell>
                      <TableCell className="text-xs font-mono-tabular text-[#555f69]">
                        {m.role === 'org_admin' || m.role === 'super_admin'
                          ? 'All Sites'
                          : m.siteIds.map((sid) => sites.find((s) => s.id === sid)?.code || sid).join(', ') || 'None'}
                      </TableCell>
                      <TableCell><StatusBadge tone={statusToTone(m.status)}>{m.status}</StatusBadge></TableCell>
                      <TableCell className="text-right">
                        {canManageUsers && (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditMember(m);
                                setEditRole(m.role);
                                setEditSiteIds(m.siteIds);
                                setEditDeptIds(m.departmentIds);
                              }}
                            >
                              Edit Access
                            </Button>
                            {m.userId !== actor?.uid && orgId && actor && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  await updateOrgMember(orgId, actor, m.userId, {
                                    status: m.status === 'active' ? 'deactivated' : 'active',
                                  });
                                  await refreshContext();
                                }}
                              >
                                {m.status === 'active' ? 'Deactivate' : 'Activate'}
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* INVITATIONS */}
        {canManageUsers && (
          <TabsContent value="invitations" className="mt-5">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Employee Invitations</CardTitle>
                  <CardDescription>Invited users see their pending invitation automatically upon sign-in</CardDescription>
                </div>
                <Button variant="primary" size="sm" onClick={() => setInviteModal(true)}>
                  <UserPlus className="h-3.5 w-3.5" /> New Invitation
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {invitations.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title="No invitations sent"
                      description="Invite plant heads, supervisors, operators, or EHS managers."
                      actionLabel="Invite Employee"
                      onAction={() => setInviteModal(true)}
                    />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invitations.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="text-xs font-medium">{inv.email}</TableCell>
                          <TableCell className="text-xs">{ROLE_LABELS[inv.role]}</TableCell>
                          <TableCell><StatusBadge tone={statusToTone(inv.status)}>{inv.status}</StatusBadge></TableCell>
                          <TableCell className="text-xs font-mono-tabular text-[#555f69]">{formatTimestamp(inv.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            {inv.status === 'pending' && orgId && actor && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={async () => {
                                  await revokeInvitation(orgId, actor, inv.id);
                                  await queryClient.invalidateQueries({ queryKey: ['invitations', orgId] });
                                }}
                              >
                                <Ban className="h-3.5 w-3.5" /> Revoke
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* AUDIT HISTORY */}
        {canReadAudit && (
          <TabsContent value="audit" className="mt-5">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Immutable Audit History</CardTitle>
                  <CardDescription>Append-only system and user activity log enforced by Firestore Rules</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingAudit ? (
                  <TableSkeleton rows={6} />
                ) : auditLogs.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="No audit logs" description="Actions across the organisation will be logged here." />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Action</TableHead>
                        <TableHead>Collection</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead>Actor</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Timestamp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs font-mono-tabular font-medium">{log.payload.action}</TableCell>
                          <TableCell className="text-xs font-mono-tabular text-[#555f69]">{log.payload.resourceCollection}</TableCell>
                          <TableCell className="text-xs max-w-md truncate">{log.payload.summary}</TableCell>
                          <TableCell className="text-xs">{log.payload.actorName}</TableCell>
                          <TableCell className="text-xs text-[#555f69]">{log.payload.actorRole}</TableCell>
                          <TableCell className="text-xs font-mono-tabular text-[#555f69]">{formatTimestamp(log.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* ADD SITE DIALOG */}
      <Dialog open={siteModal} onOpenChange={setSiteModal}>
        <DialogContent title="Add Plant / Site" description="Create a new physical site under your organisation.">
          <form onSubmit={(e) => void handleCreateSite(e)} className="space-y-4">
            <div>
              <Label>Site Name *</Label>
              <Input required value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Pune Assembly Plant" />
            </div>
            <div>
              <Label>Site Code *</Label>
              <Input required value={siteCode} onChange={(e) => setSiteCode(e.target.value)} placeholder="PLT-02" />
            </div>
            <div>
              <Label>Location</Label>
              <Input value={siteLocation} onChange={(e) => setSiteLocation(e.target.value)} placeholder="Pune, India" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSiteModal(false)}>Cancel</Button>
              <Button type="submit" variant="primary">Create Site</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ADD DEPARTMENT DIALOG */}
      <Dialog open={deptModal} onOpenChange={setDeptModal}>
        <DialogContent title="Add Department" description="Assign a functional department to a plant site.">
          <form onSubmit={(e) => void handleCreateDept(e)} className="space-y-4">
            <div>
              <Label>Plant / Site *</Label>
              <Select value={deptSiteId} onChange={(e) => setDeptSiteId(e.target.value)}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Department Name *</Label>
              <Input required value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="CNC Machining" />
            </div>
            <div>
              <Label>Department Code *</Label>
              <Input required value={deptCode} onChange={(e) => setDeptCode(e.target.value)} placeholder="MACH-01" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeptModal(false)}>Cancel</Button>
              <Button type="submit" variant="primary">Create Department</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* INVITE EMPLOYEE DIALOG */}
      <Dialog open={inviteModal} onOpenChange={setInviteModal}>
        <DialogContent title="Invite Team Member" description="Invited users receive access to selected sites upon signing in with this email.">
          <form onSubmit={(e) => void handleCreateInvite(e)} className="space-y-4">
            <div>
              <Label>Employee Work Email *</Label>
              <Input type="email" required value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="engineer@company.com" />
            </div>
            <div>
              <Label>Role *</Label>
              <Select value={invRole} onChange={(e) => setInvRole(e.target.value as Exclude<Role, 'super_admin'>)}>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Authorized Sites</Label>
              <div className="space-y-1.5 border border-[#d9dfe5] rounded-md p-3">
                {sites.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={invSiteIds.includes(s.id)}
                      onChange={(e) =>
                        setInvSiteIds((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                        )
                      }
                    />
                    <span>{s.code} — {s.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setInviteModal(false)}>Cancel</Button>
              <Button type="submit" variant="primary">Send Invitation</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT MEMBER ACCESS DIALOG */}
      <Dialog open={editMember !== null} onOpenChange={(open) => !open && setEditMember(null)}>
        <DialogContent title={`Edit Access: ${editMember?.displayName || ''}`} description="Assign role, sites, and departments.">
          {editMember && (
            <form onSubmit={(e) => void handleSaveMember(e)} className="space-y-4">
              <div>
                <Label>Role</Label>
                <Select value={editRole} onChange={(e) => setEditRole(e.target.value as Role)}>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Authorized Sites</Label>
                <div className="space-y-1.5 border border-[#d9dfe5] rounded-md p-3 max-h-40 overflow-y-auto">
                  {sites.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editSiteIds.includes(s.id)}
                        onChange={(e) =>
                          setEditSiteIds((prev) =>
                            e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                          )
                        }
                      />
                      <span>{s.code} — {s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>Assigned Departments</Label>
                <div className="space-y-1.5 border border-[#d9dfe5] rounded-md p-3 max-h-40 overflow-y-auto">
                  {departments.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editDeptIds.includes(d.id)}
                        onChange={(e) =>
                          setEditDeptIds((prev) =>
                            e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id)
                          )
                        }
                      />
                      <span>{d.code} — {d.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditMember(null)}>Cancel</Button>
                <Button type="submit" variant="primary">Save Access</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ISSUE CLIENT CREDENTIALS DIALOG */}
      <Dialog open={credModal} onOpenChange={setCredModal}>
        <DialogContent
          title="Issue Client Login Credentials"
          description="Provision a login email and password directly for a client user or operator."
        >
          <form onSubmit={(e) => void handleIssueCredentials(e)} className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input
                required
                value={credName}
                onChange={(e) => setCredName(e.target.value)}
                placeholder="Rajesh Kulkarni"
              />
            </div>
            <div>
              <Label>Login Email *</Label>
              <Input
                type="email"
                required
                value={credEmail}
                onChange={(e) => setCredEmail(e.target.value)}
                placeholder="rajesh@clientplant.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="mb-0">Initial Password *</Label>
                <button
                  type="button"
                  onClick={generateClientPassword}
                  className="text-xs font-medium text-[#070e16] hover:underline cursor-pointer"
                >
                  Generate strong password
                </button>
              </div>
              <Input
                type="text"
                required
                minLength={8}
                value={credPassword}
                onChange={(e) => setCredPassword(e.target.value)}
                className="font-mono-tabular"
                placeholder="Minimum 8 characters"
              />
            </div>
            <div>
              <Label>Assigned Role *</Label>
              <Select
                value={credRole}
                onChange={(e) => setCredRole(e.target.value as Exclude<Role, 'super_admin'>)}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Authorized Sites</Label>
              <div className="space-y-1.5 border border-[#d9dfe5] rounded-md p-3 max-h-36 overflow-y-auto">
                {sites.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={credSiteIds.includes(s.id)}
                      onChange={(e) =>
                        setCredSiteIds((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                        )
                      }
                    />
                    <span>
                      {s.code} — {s.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" type="button" onClick={() => setCredModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={credBusy}>
                {credBusy ? 'Creating Account...' : 'Create Client Credentials'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ISSUED CREDENTIALS RECEIPT */}
      <Dialog open={issuedReceipt !== null} onOpenChange={(open) => !open && setIssuedReceipt(null)}>
        <DialogContent
          title="Client Credentials Ready"
          description="Share these login credentials securely with the client."
        >
          {issuedReceipt && (
            <div className="space-y-4">
              <div className="rounded-md border border-[#d9dfe5] bg-[#f9fafc] p-4 space-y-2 text-xs">
                <div className="flex justify-between gap-4">
                  <span className="text-[#555f69]">Portal URL</span>
                  <span className="font-mono-tabular text-[#070e16] truncate">
                    {window.location.origin}/auth
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[#555f69]">User</span>
                  <span className="font-medium text-[#070e16]">{issuedReceipt.displayName}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[#555f69]">Role</span>
                  <span className="font-medium text-[#070e16]">{ROLE_LABELS[issuedReceipt.role]}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[#555f69]">Email</span>
                  <span className="font-mono-tabular font-semibold text-[#070e16]">
                    {issuedReceipt.email}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[#555f69]">Password</span>
                  <span className="font-mono-tabular font-semibold text-[#070e16]">
                    {issuedReceipt.password}
                  </span>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    const summary = `Mushai Systems Portal: ${window.location.origin}/auth\nEmail: ${issuedReceipt.email}\nPassword: ${issuedReceipt.password}\nRole: ${ROLE_LABELS[issuedReceipt.role]}`;
                    await navigator.clipboard.writeText(summary);
                    setCopiedReceipt(true);
                    window.setTimeout(() => setCopiedReceipt(false), 2000);
                  }}
                >
                  {copiedReceipt ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#007e46]" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy Credentials
                    </>
                  )}
                </Button>
                <Button variant="primary" onClick={() => setIssuedReceipt(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
