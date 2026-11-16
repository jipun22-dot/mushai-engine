import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { createId, slugify, toDateObject } from '../lib/utils';
import { buildAlertDedupKey, evaluateExpiryStatus } from '../lib/validation';
import type {
  ActiveModulesConfig,
  AlertPayload,
  AlertThresholdsConfig,
  ApprovalHistoryEntry,
  ApprovalPayload,
  ApprovalStatus,
  AuditLogPayload,
  ComplianceRecordPayload,
  Department,
  IncidentPayload,
  Invitation,
  ModuleKey,
  NotificationPayload,
  OperationalRecord,
  Organisation,
  OrgMember,
  QualityLogPayload,
  RecordSource,
  Role,
  SafetyObservationPayload,
  Site,
  TaskPayload,
  WorkPermitPayload,
} from '../types/domain';
import { provisionAuthUserWithoutLogout, setActiveOrganisationForUser } from './authService';

export interface ActorContext {
  uid: string;
  displayName: string;
  email: string;
  role: string;
}

export async function getOrganisation(orgId: string): Promise<Organisation | null> {
  const path = `organisations/${orgId}`;
  try {
    const snap = await getDoc(doc(db, 'organisations', orgId));
    return snap.exists() ? (snap.data() as Organisation) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getOrgMember(orgId: string, uid: string): Promise<OrgMember | null> {
  const path = `organisations/${orgId}/members/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'organisations', orgId, 'members', uid));
    return snap.exists() ? (snap.data() as OrgMember) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createOrganisationWithAdmin(params: {
  user: { uid: string; email: string; displayName: string };
  name: string;
  industry: string;
  country: string;
  timezone: string;
  activeModules: ActiveModulesConfig;
  initialSiteName?: string;
  initialSiteCode?: string;
  initialDeptName?: string;
}): Promise<string> {
  const orgId = createId('org');
  const slug = slugify(params.name) || orgId;
  const membershipId = `${orgId}_${params.user.uid}`;
  const siteId = createId('site');
  const deptId = createId('dept');

  const defaultThresholds: AlertThresholdsConfig = {
    permitExpiryHours: 24,
    certificationExpiryDays: 30,
    permitTypes: ['Hot Work', 'Confined Space', 'Electrical Work', 'Work at Height', 'Excavation'],
    qualityParameters: [
      { id: 'qp_temp', parameter: 'Process Temperature', unit: '°C', minLimit: 18, maxLimit: 85 },
      { id: 'qp_pressure', parameter: 'Line Pressure', unit: 'bar', minLimit: 2.0, maxLimit: 8.5 },
      { id: 'qp_weight', parameter: 'Unit Weight Tolerance', unit: 'g', minLimit: 98, maxLimit: 102 },
    ],
  };

  // Phase 1: atomic org + org_admin member + user_membership
  const batch = writeBatch(db);
  batch.set(doc(db, 'organisations', orgId), {
    id: orgId,
    name: params.name.trim(),
    slug,
    industry: params.industry.trim() || 'Manufacturing',
    country: params.country.trim() || 'Global',
    timezone: params.timezone || 'UTC',
    activeModules: params.activeModules,
    alertThresholds: defaultThresholds,
    createdBy: params.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'organisations', orgId, 'members', params.user.uid), {
    userId: params.user.uid,
    organisationId: orgId,
    email: params.user.email.toLowerCase(),
    displayName: params.user.displayName || params.user.email.split('@')[0] || 'Admin',
    role: 'org_admin',
    siteIds: [siteId],
    departmentIds: [deptId],
    status: 'active',
    createdBy: params.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'user_memberships', membershipId), {
    id: membershipId,
    organisationId: orgId,
    organisationName: params.name.trim(),
    userId: params.user.uid,
    role: 'org_admin',
    status: 'active',
    createdBy: params.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organisations/${orgId}`);
  }

  // Phase 2: create initial site + department + audit entry
  try {
    const setupBatch = writeBatch(db);
    setupBatch.set(doc(db, 'organisations', orgId, 'sites', siteId), {
      id: siteId,
      organisationId: orgId,
      name: params.initialSiteName?.trim() || 'Primary Plant',
      code: params.initialSiteCode?.trim().toUpperCase() || 'PLT-01',
      location: params.country.trim() || 'Primary Facility',
      timezone: params.timezone || 'UTC',
      status: 'active',
      createdBy: params.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    setupBatch.set(doc(db, 'organisations', orgId, 'departments', deptId), {
      id: deptId,
      organisationId: orgId,
      siteId,
      name: params.initialDeptName?.trim() || 'Operations & Production',
      code: 'OPS-01',
      status: 'active',
      createdBy: params.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const auditId = createId('aud');
    setupBatch.set(doc(db, 'organisations', orgId, 'audit_logs', auditId), {
      id: auditId,
      organisationId: orgId,
      siteId: 'ALL',
      module: 'core',
      recordType: 'audit_log',
      createdBy: params.user.uid,
      createdByName: params.user.displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: 'system',
      status: 'logged',
      approvalStatus: 'closed',
      payload: {
        actorId: params.user.uid,
        actorName: params.user.displayName,
        actorRole: 'org_admin',
        action: 'organisation.created',
        resourceCollection: 'organisations',
        resourceId: orgId,
        summary: `Registered organisation ${params.name} with initial site and department`,
      } satisfies AuditLogPayload,
    });

    await setupBatch.commit();
    await setActiveOrganisationForUser(params.user.uid, orgId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organisations/${orgId}/sites/${siteId}`);
  }

  return orgId;
}

export async function updateOrganisationConfig(
  orgId: string,
  actor: ActorContext,
  updates: Partial<Pick<Organisation, 'name' | 'industry' | 'country' | 'timezone' | 'activeModules' | 'alertThresholds'>>
): Promise<void> {
  const path = `organisations/${orgId}`;
  try {
    await updateDoc(doc(db, 'organisations', orgId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(orgId, 'ALL', actor, {
      action: 'organisation.updated',
      resourceCollection: 'organisations',
      resourceId: orgId,
      summary: `Updated organisation configuration (${Object.keys(updates).join(', ')})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function listSites(orgId: string): Promise<Site[]> {
  const path = `organisations/${orgId}/sites`;
  try {
    const q = query(collection(db, 'organisations', orgId, 'sites'), where('organisationId', '==', orgId), limit(100));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Site);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createSite(
  orgId: string,
  actor: ActorContext,
  input: { name: string; code: string; location?: string; timezone?: string }
): Promise<Site> {
  const siteId = createId('site');
  const path = `organisations/${orgId}/sites/${siteId}`;
  const siteData = {
    id: siteId,
    organisationId: orgId,
    name: input.name.trim(),
    code: input.code.trim().toUpperCase(),
    location: input.location?.trim() || '',
    timezone: input.timezone || 'UTC',
    status: 'active' as const,
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'organisations', orgId, 'sites', siteId), siteData);
    await writeAuditLog(orgId, siteId, actor, {
      action: 'site.created',
      resourceCollection: 'sites',
      resourceId: siteId,
      summary: `Created plant site ${siteData.name} (${siteData.code})`,
    });
    return siteData;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSiteStatus(
  orgId: string,
  actor: ActorContext,
  siteId: string,
  updates: Partial<Pick<Site, 'name' | 'code' | 'location' | 'timezone' | 'status'>>
): Promise<void> {
  const path = `organisations/${orgId}/sites/${siteId}`;
  try {
    await updateDoc(doc(db, 'organisations', orgId, 'sites', siteId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(orgId, siteId, actor, {
      action: 'site.updated',
      resourceCollection: 'sites',
      resourceId: siteId,
      summary: `Updated site ${siteId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function listDepartments(orgId: string): Promise<Department[]> {
  const path = `organisations/${orgId}/departments`;
  try {
    const q = query(collection(db, 'organisations', orgId, 'departments'), where('organisationId', '==', orgId), limit(200));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Department);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createDepartment(
  orgId: string,
  actor: ActorContext,
  input: { siteId: string; name: string; code: string; headUserId?: string }
): Promise<Department> {
  const deptId = createId('dept');
  const path = `organisations/${orgId}/departments/${deptId}`;
  const deptData = {
    id: deptId,
    organisationId: orgId,
    siteId: input.siteId,
    name: input.name.trim(),
    code: input.code.trim().toUpperCase(),
    ...(input.headUserId ? { headUserId: input.headUserId } : {}),
    status: 'active' as const,
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'organisations', orgId, 'departments', deptId), deptData);
    await writeAuditLog(orgId, input.siteId, actor, {
      action: 'department.created',
      resourceCollection: 'departments',
      resourceId: deptId,
      summary: `Created department ${deptData.name} (${deptData.code})`,
    });
    return deptData;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const path = `organisations/${orgId}/members`;
  try {
    const q = query(collection(db, 'organisations', orgId, 'members'), where('organisationId', '==', orgId), limit(200));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as OrgMember);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function updateOrgMember(
  orgId: string,
  actor: ActorContext,
  memberUserId: string,
  updates: Partial<Pick<OrgMember, 'role' | 'siteIds' | 'departmentIds' | 'status' | 'displayName'>>
): Promise<void> {
  const path = `organisations/${orgId}/members/${memberUserId}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'organisations', orgId, 'members', memberUserId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    if (updates.role || updates.status) {
      batch.update(doc(db, 'user_memberships', `${orgId}_${memberUserId}`), {
        ...(updates.role ? { role: updates.role } : {}),
        ...(updates.status ? { status: updates.status } : {}),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    await writeAuditLog(orgId, 'ALL', actor, {
      action: 'member.updated',
      resourceCollection: 'members',
      resourceId: memberUserId,
      summary: `Updated member ${memberUserId} (${Object.keys(updates).join(', ')})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createInvitation(
  orgId: string,
  orgName: string,
  actor: ActorContext,
  input: {
    email: string;
    role: Exclude<Role, 'super_admin'>;
    siteIds: string[];
    departmentIds: string[];
  }
): Promise<Invitation> {
  const inviteId = createId('inv');
  const path = `invitations/${inviteId}`;
  const data: Invitation = {
    id: inviteId,
    organisationId: orgId,
    organisationName: orgName,
    email: input.email.trim().toLowerCase(),
    role: input.role,
    siteIds: input.siteIds,
    departmentIds: input.departmentIds,
    status: 'pending',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'invitations', inviteId), data);
    await writeAuditLog(orgId, 'ALL', actor, {
      action: 'invitation.created',
      resourceCollection: 'invitations',
      resourceId: inviteId,
      summary: `Invited ${data.email} as ${data.role}`,
    });
    return data;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listOrgInvitations(orgId: string, createdByUid: string): Promise<Invitation[]> {
  const path = 'invitations';
  try {
    const q = query(collection(db, 'invitations'), where('createdBy', '==', createdByUid), limit(100));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as Invitation)
      .filter((inv) => inv.organisationId === orgId);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function revokeInvitation(orgId: string, actor: ActorContext, inviteId: string): Promise<void> {
  const path = `invitations/${inviteId}`;
  try {
    await updateDoc(doc(db, 'invitations', inviteId), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(orgId, 'ALL', actor, {
      action: 'invitation.revoked',
      resourceCollection: 'invitations',
      resourceId: inviteId,
      summary: `Revoked invitation ${inviteId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function provisionClientMemberWithCredentials(
  orgId: string,
  orgName: string,
  actor: ActorContext,
  input: {
    displayName: string;
    email: string;
    password: string;
    role: Exclude<Role, 'super_admin'>;
    siteIds: string[];
    departmentIds: string[];
  }
): Promise<{ userId: string; email: string; displayName: string; role: Role }> {
  const provisioned = await provisionAuthUserWithoutLogout({
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    allowExisting: false,
  });

  const membershipId = `${orgId}_${provisioned.uid}`;
  const path = `organisations/${orgId}/members/${provisioned.uid}`;
  const batch = writeBatch(db);

  batch.set(doc(db, 'organisations', orgId, 'members', provisioned.uid), {
    userId: provisioned.uid,
    organisationId: orgId,
    email: provisioned.email,
    displayName: provisioned.displayName,
    role: input.role,
    siteIds: input.siteIds,
    departmentIds: input.departmentIds,
    status: 'active',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'user_memberships', membershipId), {
    id: membershipId,
    organisationId: orgId,
    organisationName: orgName,
    userId: provisioned.uid,
    role: input.role,
    status: 'active',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await writeAuditLog(orgId, 'ALL', actor, {
      action: 'member.credentials_issued',
      resourceCollection: 'members',
      resourceId: provisioned.uid,
      summary: `Issued client credentials for ${provisioned.email} (${input.role})`,
    });
    return {
      userId: provisioned.uid,
      email: provisioned.email,
      displayName: provisioned.displayName,
      role: input.role,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function listOperationalRecords<TPayload = Record<string, unknown>>(
  orgId: string,
  collectionName: string,
  options?: { siteId?: string; pageSize?: number }
): Promise<Array<OperationalRecord<TPayload>>> {
  const path = `organisations/${orgId}/${collectionName}`;
  try {
    const constraints: QueryConstraint[] = [where('organisationId', '==', orgId)];
    if (options?.siteId && options.siteId !== 'ALL') {
      constraints.push(where('siteId', '==', options.siteId));
    }
    constraints.push(orderBy('createdAt', 'desc'));
    constraints.push(limit(options?.pageSize ?? 100));
    const q = query(collection(db, 'organisations', orgId, collectionName), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as OperationalRecord<TPayload>);
  } catch (error) {
    // Fallback if composite index on siteId+createdAt isn't built yet
    try {
      const qFallback = query(
        collection(db, 'organisations', orgId, collectionName),
        where('organisationId', '==', orgId),
        limit(options?.pageSize ?? 100)
      );
      const snap = await getDocs(qFallback);
      const items = snap.docs.map((d) => d.data() as OperationalRecord<TPayload>);
      const filtered = options?.siteId && options.siteId !== 'ALL'
        ? items.filter((r) => r.siteId === options.siteId)
        : items;
      return filtered.sort((a, b) => {
        const ta = toDateObject(a.createdAt)?.getTime() ?? 0;
        const tb = toDateObject(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
    } catch (fallbackErr) {
      handleFirestoreError(fallbackErr, OperationType.LIST, path);
    }
  }
}

export async function createOperationalRecord<TPayload extends object>(params: {
  orgId: string;
  collectionName: string;
  siteId: string;
  departmentId?: string;
  module: ModuleKey;
  recordType: string;
  actor: ActorContext;
  source?: RecordSource;
  status: string;
  approvalStatus: ApprovalStatus;
  payload: TPayload;
  recordTitle?: string;
  requestApproval?: boolean;
}): Promise<OperationalRecord<TPayload>> {
  const id = createId(params.recordType.slice(0, 4));
  const path = `organisations/${params.orgId}/${params.collectionName}/${id}`;
  const docData: OperationalRecord<TPayload> = {
    id,
    organisationId: params.orgId,
    siteId: params.siteId,
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    module: params.module,
    recordType: params.recordType,
    createdBy: params.actor.uid,
    createdByName: params.actor.displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    source: params.source ?? 'manual',
    status: params.status,
    approvalStatus: params.approvalStatus,
    payload: params.payload,
  };

  try {
    await setDoc(doc(db, 'organisations', params.orgId, params.collectionName, id), docData);

    await writeAuditLog(params.orgId, params.siteId, params.actor, {
      action: `${params.collectionName}.created`,
      resourceCollection: params.collectionName,
      resourceId: id,
      summary: `Created ${params.recordType} record (${params.recordTitle || id})`,
    });

    if (params.requestApproval && (params.approvalStatus === 'submitted' || params.approvalStatus === 'pending_approval')) {
      const approvalId = createId('apr');
      const approvalPayload: ApprovalPayload = {
        targetModule: params.module,
        recordCollection: params.collectionName,
        recordId: id,
        recordTitle: params.recordTitle || `${params.recordType} (${id})`,
        requestedBy: params.actor.uid,
        requestedByName: params.actor.displayName,
        history: [
          {
            state: params.approvalStatus,
            actorId: params.actor.uid,
            actorName: params.actor.displayName,
            comment: 'Submitted for operational review',
            timestamp: new Date().toISOString(),
          },
        ],
      };
      await setDoc(doc(db, 'organisations', params.orgId, 'approvals', approvalId), {
        id: approvalId,
        organisationId: params.orgId,
        siteId: params.siteId,
        ...(params.departmentId ? { departmentId: params.departmentId } : {}),
        module: 'core',
        recordType: 'approval',
        createdBy: params.actor.uid,
        createdByName: params.actor.displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        source: 'system',
        status: 'pending_approval',
        approvalStatus: 'pending_approval',
        payload: approvalPayload,
      });
    }

    return docData;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateOperationalRecord<TPayload extends object>(params: {
  orgId: string;
  collectionName: string;
  recordId: string;
  siteId: string;
  actor: ActorContext;
  status?: string;
  approvalStatus?: ApprovalStatus;
  payload?: TPayload;
  auditSummary?: string;
}): Promise<void> {
  const path = `organisations/${params.orgId}/${params.collectionName}/${params.recordId}`;
  const updateBody: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (params.status !== undefined) updateBody.status = params.status;
  if (params.approvalStatus !== undefined) updateBody.approvalStatus = params.approvalStatus;
  if (params.payload !== undefined) updateBody.payload = params.payload;

  try {
    await updateDoc(doc(db, 'organisations', params.orgId, params.collectionName, params.recordId), updateBody);
    await writeAuditLog(params.orgId, params.siteId, params.actor, {
      action: `${params.collectionName}.updated`,
      resourceCollection: params.collectionName,
      resourceId: params.recordId,
      summary: params.auditSummary || `Updated ${params.collectionName} (${params.recordId})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function transitionApproval(params: {
  orgId: string;
  approvalRecord: OperationalRecord<ApprovalPayload>;
  nextState: ApprovalStatus;
  comment: string;
  actor: ActorContext;
}): Promise<void> {
  const { orgId, approvalRecord, nextState, comment, actor } = params;
  const entry: ApprovalHistoryEntry = {
    state: nextState,
    actorId: actor.uid,
    actorName: actor.displayName,
    comment: comment.trim() || `Transitioned to ${nextState}`,
    timestamp: new Date().toISOString(),
  };
  const updatedHistory = [...(approvalRecord.payload.history || []), entry].slice(-30);

  const batch = writeBatch(db);
  batch.update(doc(db, 'organisations', orgId, 'approvals', approvalRecord.id), {
    status: nextState,
    approvalStatus: nextState,
    payload: {
      ...approvalRecord.payload,
      history: updatedHistory,
    },
    updatedAt: serverTimestamp(),
  });

  if (approvalRecord.payload.recordCollection && approvalRecord.payload.recordId) {
    batch.update(
      doc(db, 'organisations', orgId, approvalRecord.payload.recordCollection, approvalRecord.payload.recordId),
      {
        approvalStatus: nextState,
        status: nextState === 'approved' ? 'approved' : nextState === 'rejected' ? 'rejected' : nextState === 'closed' ? 'closed' : 'pending_approval',
        updatedAt: serverTimestamp(),
      }
    );
  }

  const notifId = createId('ntf');
  batch.set(doc(db, 'organisations', orgId, 'notifications', notifId), {
    id: notifId,
    organisationId: orgId,
    siteId: approvalRecord.siteId,
    module: 'core',
    recordType: 'notification',
    createdBy: actor.uid,
    createdByName: actor.displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    source: 'system',
    status: 'unread',
    approvalStatus: 'closed',
    payload: {
      recipientUserId: approvalRecord.payload.requestedBy,
      type: 'approval_decision',
      title: `Approval ${nextState.toUpperCase()}: ${approvalRecord.payload.recordTitle}`,
      message: `${actor.displayName} marked this item as ${nextState}. ${comment ? `Note: ${comment}` : ''}`,
      link: '/approvals',
      read: false,
    } satisfies NotificationPayload,
  });

  try {
    await batch.commit();
    await writeAuditLog(orgId, approvalRecord.siteId, actor, {
      action: `approval.${nextState}`,
      resourceCollection: approvalRecord.payload.recordCollection,
      resourceId: approvalRecord.payload.recordId,
      summary: `${nextState.toUpperCase()} ${approvalRecord.payload.recordTitle}: ${entry.comment}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `organisations/${orgId}/approvals/${approvalRecord.id}`);
  }
}

export async function writeAuditLog(
  orgId: string,
  siteId: string,
  actor: ActorContext,
  details: Omit<AuditLogPayload, 'actorId' | 'actorName' | 'actorRole'>
): Promise<void> {
  const id = createId('aud');
  try {
    await setDoc(doc(db, 'organisations', orgId, 'audit_logs', id), {
      id,
      organisationId: orgId,
      siteId: siteId || 'ALL',
      module: 'core',
      recordType: 'audit_log',
      createdBy: actor.uid,
      createdByName: actor.displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: 'system',
      status: 'logged',
      approvalStatus: 'closed',
      payload: {
        actorId: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        ...details,
      } satisfies AuditLogPayload,
    });
  } catch (error) {
    console.warn('Audit log write skipped:', error);
  }
}

export async function upsertDeduplicatedAlert(params: {
  orgId: string;
  siteId: string;
  actor: ActorContext;
  alert: Omit<AlertPayload, 'dedupKey'>;
}): Promise<boolean> {
  const dedupKey = buildAlertDedupKey(params.orgId, params.alert.category, params.alert.targetId);
  const alertId = `alt_${dedupKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 110)}`;
  const ref = doc(db, 'organisations', params.orgId, 'alerts', alertId);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const existingData = existing.data() as OperationalRecord<AlertPayload>;
      if (existingData.status !== 'resolved') {
        return false; // Deduplicated: do not recreate or spam for the same unresolved condition
      }
    }

    await setDoc(ref, {
      id: alertId,
      organisationId: params.orgId,
      siteId: params.siteId,
      module: 'core',
      recordType: 'alert',
      createdBy: params.actor.uid,
      createdByName: params.actor.displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: 'system',
      status: 'open',
      approvalStatus: 'submitted',
      payload: {
        ...params.alert,
        dedupKey,
      } satisfies AlertPayload,
    });
    return true;
  } catch (error) {
    console.warn('Alert upsert warning:', error);
    return false;
  }
}

export async function evaluateOrganisationAlerts(
  org: Organisation,
  actor: ActorContext
): Promise<number> {
  let createdCount = 0;
  const orgId = org.id;
  const permitHours = org.alertThresholds?.permitExpiryHours ?? 24;
  const certDays = org.alertThresholds?.certificationExpiryDays ?? 30;
  const now = new Date();

  const [permits, certs, tasks, incidents, observations, qualityLogs] = await Promise.all([
    org.activeModules.environ ? listOperationalRecords<WorkPermitPayload>(orgId, 'work_permits', { pageSize: 100 }) : Promise.resolve([]),
    org.activeModules.environ ? listOperationalRecords<ComplianceRecordPayload>(orgId, 'compliance_records', { pageSize: 100 }) : Promise.resolve([]),
    listOperationalRecords<TaskPayload>(orgId, 'tasks', { pageSize: 100 }),
    org.activeModules.environ ? listOperationalRecords<IncidentPayload>(orgId, 'incidents', { pageSize: 100 }) : Promise.resolve([]),
    org.activeModules.environ ? listOperationalRecords<SafetyObservationPayload>(orgId, 'safety_observations', { pageSize: 100 }) : Promise.resolve([]),
    org.activeModules.nexus ? listOperationalRecords<QualityLogPayload>(orgId, 'quality_logs', { pageSize: 100 }) : Promise.resolve([]),
  ]);

  for (const permit of permits) {
    if (permit.status === 'closed' || permit.approvalStatus === 'closed') continue;
    const end = new Date(permit.payload.endDateTime);
    if (!Number.isNaN(end.getTime())) {
      const hoursLeft = (end.getTime() - now.getTime()) / 3600000;
      if (hoursLeft <= permitHours) {
        const created = await upsertDeduplicatedAlert({
          orgId,
          siteId: permit.siteId,
          actor,
          alert: {
            severity: hoursLeft <= 0 ? 'critical' : 'warning',
            category: 'permit_expiry',
            title: `Permit ${permit.payload.permitNumber} ${hoursLeft <= 0 ? 'Expired' : 'Expiring Soon'}`,
            message: `${permit.payload.permitType} permit at ${permit.payload.location} ends ${permit.payload.endDateTime}.`,
            targetCollection: 'work_permits',
            targetId: permit.id,
          },
        });
        if (created) createdCount += 1;
      }
    }
  }

  for (const cert of certs) {
    const evalRes = evaluateExpiryStatus(cert.payload.expiryDate, certDays, now);
    if (evalRes.status !== 'valid') {
      const created = await upsertDeduplicatedAlert({
        orgId,
        siteId: cert.siteId,
        actor,
        alert: {
          severity: evalRes.status === 'expired' ? 'critical' : 'warning',
          category: 'certification_expiry',
          title: `Certification ${evalRes.status === 'expired' ? 'Expired' : 'Expiring'}: ${cert.payload.certificationName}`,
          message: `Expires ${cert.payload.expiryDate} (${evalRes.daysRemaining} days remaining). Responsible: ${cert.payload.responsiblePerson}.`,
          targetCollection: 'compliance_records',
          targetId: cert.id,
        },
      });
      if (created) createdCount += 1;
    }
  }

  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'cancelled') continue;
    const due = new Date(task.payload.dueDate);
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) {
      const created = await upsertDeduplicatedAlert({
        orgId,
        siteId: task.siteId,
        actor,
        alert: {
          severity: task.payload.priority === 'critical' ? 'critical' : 'warning',
          category: 'overdue_task',
          title: `Overdue Task: ${task.payload.title}`,
          message: `Due on ${task.payload.dueDate}, assigned to ${task.payload.assignedToName}.`,
          targetCollection: 'tasks',
          targetId: task.id,
        },
      });
      if (created) createdCount += 1;
    }
  }

  for (const inc of incidents) {
    if (inc.status === 'closed' || inc.approvalStatus === 'closed') continue;
    if (inc.payload.severity === 'major' || inc.payload.severity === 'critical') {
      const created = await upsertDeduplicatedAlert({
        orgId,
        siteId: inc.siteId,
        actor,
        alert: {
          severity: 'critical',
          category: 'unresolved_incident',
          title: `Unresolved ${inc.payload.severity.toUpperCase()} Incident`,
          message: `${inc.payload.category} at ${inc.payload.location}: ${inc.payload.description.slice(0, 120)}`,
          targetCollection: 'incidents',
          targetId: inc.id,
        },
      });
      if (created) createdCount += 1;
    }
  }

  for (const obs of observations) {
    if (obs.status === 'closed' || obs.approvalStatus === 'closed') continue;
    if (obs.payload.riskLevel === 'critical') {
      const created = await upsertDeduplicatedAlert({
        orgId,
        siteId: obs.siteId,
        actor,
        alert: {
          severity: 'critical',
          category: 'critical_observation',
          title: `Critical Safety Observation: ${obs.payload.category}`,
          message: `Reported at ${obs.payload.location}: ${obs.payload.description.slice(0, 120)}`,
          targetCollection: 'safety_observations',
          targetId: obs.id,
        },
      });
      if (created) createdCount += 1;
    }
  }

  for (const ql of qualityLogs) {
    if (ql.payload.outOfRange && ql.approvalStatus !== 'closed') {
      const created = await upsertDeduplicatedAlert({
        orgId,
        siteId: ql.siteId,
        actor,
        alert: {
          severity: 'warning',
          category: 'quality_out_of_range',
          title: `Out-of-Range Quality Spec: ${ql.payload.parameter}`,
          message: `Batch ${ql.payload.batchOrProduct} measured ${ql.payload.measuredValue} ${ql.payload.unit} (limits ${ql.payload.minLimit}–${ql.payload.maxLimit}).`,
          targetCollection: 'quality_logs',
          targetId: ql.id,
        },
      });
      if (created) createdCount += 1;
    }
  }

  return createdCount;
}
