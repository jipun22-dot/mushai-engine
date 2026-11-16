export type Role =
  | 'super_admin'
  | 'org_admin'
  | 'plant_head'
  | 'dept_head'
  | 'supervisor'
  | 'operator'
  | 'ehs_manager'
  | 'auditor'
  | 'viewer';

export type Permission =
  | 'dashboard.read'
  | 'users.manage'
  | 'sites.manage'
  | 'departments.manage'
  | 'nexus.read'
  | 'nexus.write'
  | 'nexus.approve'
  | 'environ.read'
  | 'environ.write'
  | 'environ.approve'
  | 'records.read'
  | 'records.create'
  | 'records.update'
  | 'records.approve'
  | 'tasks.create'
  | 'tasks.assign'
  | 'reports.read'
  | 'reports.export'
  | 'settings.manage'
  | 'audit.read';

export type ModuleKey = 'core' | 'nexus' | 'environ';

export type ApprovalStatus =
  | 'draft'
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'closed';

export type RecordSource = 'manual' | 'ai_document' | 'system';

export interface ActiveModulesConfig {
  nexus: boolean;
  environ: boolean;
}

export interface QualityParameterConfig {
  id: string;
  parameter: string;
  unit: string;
  minLimit: number;
  maxLimit: number;
}

export interface AlertThresholdsConfig {
  permitExpiryHours: number;
  certificationExpiryDays: number;
  qualityParameters?: QualityParameterConfig[];
  permitTypes?: string[];
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  activeOrganisationId?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface UserMembership {
  id: string;
  organisationId: string;
  organisationName: string;
  userId: string;
  role: Role;
  status: 'active' | 'invited' | 'deactivated';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  country?: string;
  timezone?: string;
  activeModules: ActiveModulesConfig;
  alertThresholds?: AlertThresholdsConfig;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface OrgMember {
  userId: string;
  organisationId: string;
  email: string;
  displayName: string;
  role: Role;
  siteIds: string[];
  departmentIds: string[];
  status: 'active' | 'invited' | 'deactivated';
  inviteId?: string;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Invitation {
  id: string;
  organisationId: string;
  organisationName: string;
  email: string;
  role: Exclude<Role, 'super_admin'>;
  siteIds: string[];
  departmentIds: string[];
  status: 'pending' | 'accepted' | 'revoked';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Site {
  id: string;
  organisationId: string;
  name: string;
  code: string;
  location?: string;
  timezone?: string;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Department {
  id: string;
  organisationId: string;
  siteId: string;
  name: string;
  code: string;
  headUserId?: string;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface OperationalRecord<TPayload = Record<string, unknown>> {
  id: string;
  organisationId: string;
  siteId: string;
  departmentId?: string;
  module: ModuleKey;
  recordType: string;
  createdBy: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
  source: RecordSource;
  status: string;
  approvalStatus: ApprovalStatus;
  payload: TPayload;
}

// --- NEXUS PAYLOADS ---
export interface ProductionLogPayload {
  productionDate: string;
  productionLine: string;
  machine: string;
  shift: string;
  product: string;
  targetQuantity: number;
  actualQuantity: number;
  rejectedQuantity: number;
  achievementPercent: number;
  rejectionRatePercent: number;
  supervisor: string;
  remarks?: string;
  attachments?: string[];
}

export interface ShiftReportPayload {
  date: string;
  shift: string;
  supervisor: string;
  productionSummary: string;
  issuesEncountered?: string;
  pendingWork?: string;
  handoverNotes?: string;
  reviewedBy?: string;
}

export interface DowntimeLogPayload {
  machine: string;
  productionLine: string;
  startTime: string;
  endTime: string;
  totalDowntimeMinutes: number;
  reason: string;
  reportedBy: string;
  correctiveAction?: string;
  resolutionStatus: 'open' | 'in_progress' | 'resolved';
}

export interface WorkforceRecordPayload {
  date: string;
  shift: string;
  employeeName: string;
  employeeId?: string;
  attendanceStatus: 'present' | 'absent' | 'late' | 'on_leave';
  notes?: string;
}

export interface VisitorRecordPayload {
  visitorName: string;
  company: string;
  purpose: string;
  personToMeet: string;
  entryTimestamp: string;
  exitTimestamp?: string;
}

export interface QualityLogPayload {
  inspectionDate: string;
  batchOrProduct: string;
  parameter: string;
  measuredValue: number;
  unit: string;
  minLimit: number;
  maxLimit: number;
  outOfRange: boolean;
  result: 'pass' | 'fail';
  inspector: string;
  attachments?: string[];
  notes?: string;
}

// --- ENVIRON PAYLOADS ---
export interface SafetyObservationPayload {
  observationDate: string;
  location: string;
  category: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  supportingImage?: string;
  reportedBy: string;
  assignedPerson?: string;
  correctiveAction?: string;
}

export interface IncidentPayload {
  incidentDateTime: string;
  location: string;
  category: string;
  description: string;
  severity: 'minor' | 'moderate' | 'major' | 'critical';
  peopleInvolved?: string;
  supportingFiles?: string[];
  immediateAction: string;
  investigationDetails?: string;
  correctiveActions?: string;
  history?: Array<{ timestamp: string; actor: string; note: string }>;
}

export interface WorkPermitPayload {
  permitNumber: string;
  permitType: string;
  location: string;
  contractor: string;
  responsiblePerson: string;
  startDateTime: string;
  endDateTime: string;
  hazards: string;
  precautions: string;
  approver?: string;
  closureNotes?: string;
}

export interface ComplianceRecordPayload {
  requirement: string;
  certificationName: string;
  issuingAuthority: string;
  issueDate: string;
  expiryDate: string;
  responsiblePerson: string;
  supportingDocument?: string;
}

export interface EnvironmentalRecordPayload {
  metricType: 'water_consumption' | 'electricity_consumption' | 'fuel_consumption' | 'waste_generation' | 'emissions_data' | 'environmental_inspection';
  reportingPeriod: string;
  sourceName: string;
  value: number;
  unit: string;
  methodologyNote?: string;
  notes?: string;
}

export interface CorrectiveActionPayload {
  finding: string;
  relatedRecordType?: string;
  relatedRecordId?: string;
  assignedOwner: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  actionPlan: string;
  evidence?: string;
  verificationNotes?: string;
}

// --- CORE PAYLOADS ---
export interface TaskComment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface TaskPayload {
  title: string;
  description: string;
  sourceModule: ModuleKey;
  sourceCollection?: string;
  sourceRecordId?: string;
  assignedTo: string;
  assignedToName: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate: string;
  comments: TaskComment[];
  attachments?: string[];
}

export interface ApprovalHistoryEntry {
  state: ApprovalStatus;
  actorId: string;
  actorName: string;
  comment: string;
  timestamp: string;
}

export interface ApprovalPayload {
  targetModule: ModuleKey;
  recordCollection: string;
  recordId: string;
  recordTitle: string;
  requestedBy: string;
  requestedByName: string;
  history: ApprovalHistoryEntry[];
}

export interface NotificationPayload {
  recipientUserId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  read: boolean;
}

export interface AlertPayload {
  severity: 'info' | 'warning' | 'critical';
  category:
    | 'permit_expiry'
    | 'certification_expiry'
    | 'overdue_task'
    | 'unresolved_incident'
    | 'critical_observation'
    | 'pending_approval'
    | 'quality_out_of_range';
  title: string;
  message: string;
  targetCollection: string;
  targetId: string;
  dedupKey: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
}

export interface AuditLogPayload {
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  resourceCollection: string;
  resourceId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface GeneratedReportPayload {
  reportType: string;
  title: string;
  targetModule: ModuleKey;
  periodStart: string;
  periodEnd: string;
  filters: Record<string, unknown>;
  summaryMetrics: Record<string, string | number>;
  rowCount: number;
  columns: string[];
  snapshotRows: Array<Record<string, string | number>>;
  fileFormat: 'pdf' | 'xlsx' | 'both';
  storageUrl?: string;
}

export interface AIExtractionJobPayload {
  targetModule: 'nexus' | 'environ';
  targetRecordType: string;
  fileName: string;
  mimeType: string;
  fileUrl?: string;
  extractedData?: Record<string, unknown>;
  uncertainFields: string[];
  savedRecordId?: string;
  errorMessage?: string;
}
