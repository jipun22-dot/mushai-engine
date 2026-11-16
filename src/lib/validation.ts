import { z } from 'zod';

// --- DETERMINISTIC CALCULATIONS ---

export function calculateProductionMetrics(targetQuantity: number, actualQuantity: number, rejectedQuantity: number) {
  const safeTarget = Math.max(0, Number(targetQuantity) || 0);
  const safeActual = Math.max(0, Number(actualQuantity) || 0);
  const safeRejected = Math.max(0, Math.min(safeActual, Number(rejectedQuantity) || 0));

  const achievementPercent = safeTarget > 0 ? Number(((safeActual / safeTarget) * 100).toFixed(2)) : 0;
  const rejectionRatePercent = safeActual > 0 ? Number(((safeRejected / safeActual) * 100).toFixed(2)) : 0;
  return { achievementPercent, rejectionRatePercent };
}

export function calculateDowntimeMinutes(startTime: string, endTime: string): number {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid start or end timestamp');
  }
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) {
    throw new Error('End time cannot precede start time');
  }
  return Math.round(diffMs / 60000);
}

export function evaluateQualityMeasurement(measuredValue: number, minLimit: number, maxLimit: number) {
  const outOfRange = measuredValue < minLimit || measuredValue > maxLimit;
  return {
    outOfRange,
    result: (outOfRange ? 'fail' : 'pass') as 'pass' | 'fail',
  };
}

export function evaluateExpiryStatus(expiryDateStr: string, thresholdDays: number, now = new Date()): {
  daysRemaining: number;
  status: 'valid' | 'expiring_soon' | 'expired';
} {
  const expiry = new Date(expiryDateStr);
  if (Number.isNaN(expiry.getTime())) {
    return { daysRemaining: 0, status: 'valid' };
  }
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { daysRemaining: diffDays, status: 'expired' };
  if (diffDays <= thresholdDays) return { daysRemaining: diffDays, status: 'expiring_soon' };
  return { daysRemaining: diffDays, status: 'valid' };
}

export function buildAlertDedupKey(orgId: string, category: string, targetId: string): string {
  return `${orgId}__${category}__${targetId}`;
}

// --- ZOD SCHEMAS ---

export const organisationSchema = z.object({
  name: z.string().trim().min(2, 'Organisation name must be at least 2 characters').max(160),
  industry: z.string().trim().max(100).optional().default('Manufacturing'),
  country: z.string().trim().max(80).optional().default(''),
  timezone: z.string().trim().max(64).optional().default('UTC'),
  nexusEnabled: z.boolean().default(true),
  environEnabled: z.boolean().default(true),
});

export const siteSchema = z.object({
  name: z.string().trim().min(2).max(140),
  code: z.string().trim().min(2).max(32),
  location: z.string().trim().max(200).optional().default(''),
  timezone: z.string().trim().max(64).optional().default('UTC'),
});

export const departmentSchema = z.object({
  siteId: z.string().min(1, 'Site is required'),
  name: z.string().trim().min(2).max(140),
  code: z.string().trim().min(2).max(32),
  headUserId: z.string().max(128).optional().default(''),
});

export const productionLogSchema = z.object({
  productionDate: z.string().min(1, 'Production date is required'),
  siteId: z.string().min(1, 'Site is required'),
  departmentId: z.string().optional().default(''),
  productionLine: z.string().trim().min(1, 'Production line is required').max(120),
  machine: z.string().trim().min(1, 'Machine is required').max(120),
  shift: z.string().min(1, 'Shift is required'),
  product: z.string().trim().min(1, 'Product is required').max(140),
  targetQuantity: z.coerce.number().min(1, 'Target quantity must be > 0'),
  actualQuantity: z.coerce.number().min(0, 'Actual quantity cannot be negative'),
  rejectedQuantity: z.coerce.number().min(0, 'Rejected quantity cannot be negative'),
  supervisor: z.string().trim().min(1, 'Supervisor is required').max(120),
  remarks: z.string().max(1000).optional().default(''),
});

export const shiftReportSchema = z.object({
  date: z.string().min(1),
  shift: z.string().min(1),
  siteId: z.string().min(1),
  departmentId: z.string().min(1),
  supervisor: z.string().trim().min(1).max(120),
  productionSummary: z.string().trim().min(4).max(2000),
  issuesEncountered: z.string().max(2000).optional().default(''),
  pendingWork: z.string().max(2000).optional().default(''),
  handoverNotes: z.string().max(2000).optional().default(''),
});

export const downtimeLogSchema = z.object({
  siteId: z.string().min(1),
  departmentId: z.string().optional().default(''),
  machine: z.string().trim().min(1).max(120),
  productionLine: z.string().trim().min(1).max(120),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  reason: z.string().trim().min(2).max(500),
  reportedBy: z.string().trim().min(1).max(120),
  correctiveAction: z.string().max(1000).optional().default(''),
  resolutionStatus: z.enum(['open', 'in_progress', 'resolved']),
}).refine((val) => {
  const s = new Date(val.startTime).getTime();
  const e = new Date(val.endTime).getTime();
  return !Number.isNaN(s) && !Number.isNaN(e) && e >= s;
}, { message: 'End time must be after or equal to start time', path: ['endTime'] });

export const workforceRecordSchema = z.object({
  date: z.string().min(1),
  siteId: z.string().min(1),
  departmentId: z.string().min(1),
  shift: z.string().min(1),
  employeeName: z.string().trim().min(1).max(120),
  employeeId: z.string().max(64).optional().default(''),
  attendanceStatus: z.enum(['present', 'absent', 'late', 'on_leave']),
  notes: z.string().max(500).optional().default(''),
});

export const visitorRecordSchema = z.object({
  siteId: z.string().min(1),
  visitorName: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(140),
  purpose: z.string().trim().min(2).max(300),
  personToMeet: z.string().trim().min(1).max(120),
  entryTimestamp: z.string().min(1),
  exitTimestamp: z.string().optional().default(''),
});

export const qualityLogSchema = z.object({
  inspectionDate: z.string().min(1),
  siteId: z.string().min(1),
  departmentId: z.string().optional().default(''),
  batchOrProduct: z.string().trim().min(1).max(140),
  parameter: z.string().trim().min(1).max(120),
  measuredValue: z.coerce.number(),
  unit: z.string().trim().min(1).max(40),
  minLimit: z.coerce.number(),
  maxLimit: z.coerce.number(),
  inspector: z.string().trim().min(1).max(120),
  notes: z.string().max(1000).optional().default(''),
}).refine((val) => val.maxLimit >= val.minLimit, {
  message: 'Upper limit must be greater than or equal to lower limit',
  path: ['maxLimit'],
});

export const safetyObservationSchema = z.object({
  observationDate: z.string().min(1),
  siteId: z.string().min(1),
  departmentId: z.string().min(1),
  location: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().min(4).max(2000),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  reportedBy: z.string().trim().min(1).max(120),
  assignedPerson: z.string().max(120).optional().default(''),
  correctiveAction: z.string().max(1000).optional().default(''),
});

export const incidentSchema = z.object({
  incidentDateTime: z.string().min(1),
  siteId: z.string().min(1),
  departmentId: z.string().min(1),
  location: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().min(4).max(2000),
  severity: z.enum(['minor', 'moderate', 'major', 'critical']),
  peopleInvolved: z.string().max(400).optional().default(''),
  immediateAction: z.string().trim().min(2).max(1000),
  investigationDetails: z.string().max(2000).optional().default(''),
  correctiveActions: z.string().max(2000).optional().default(''),
});

export const workPermitSchema = z.object({
  permitNumber: z.string().trim().min(2).max(64),
  permitType: z.string().trim().min(2).max(80),
  siteId: z.string().min(1),
  location: z.string().trim().min(1).max(160),
  contractor: z.string().trim().min(1).max(140),
  responsiblePerson: z.string().trim().min(1).max(120),
  startDateTime: z.string().min(1),
  endDateTime: z.string().min(1),
  hazards: z.string().trim().min(2).max(1000),
  precautions: z.string().trim().min(2).max(1000),
}).refine((val) => {
  const s = new Date(val.startDateTime).getTime();
  const e = new Date(val.endDateTime).getTime();
  return !Number.isNaN(s) && !Number.isNaN(e) && e > s;
}, { message: 'Permit end time must be after start time', path: ['endDateTime'] });

export const complianceRecordSchema = z.object({
  requirement: z.string().trim().min(2).max(200),
  certificationName: z.string().trim().min(2).max(200),
  issuingAuthority: z.string().trim().min(2).max(160),
  issueDate: z.string().min(1),
  expiryDate: z.string().min(1),
  siteId: z.string().min(1),
  responsiblePerson: z.string().trim().min(1).max(120),
});

export const environmentalRecordSchema = z.object({
  metricType: z.enum([
    'water_consumption',
    'electricity_consumption',
    'fuel_consumption',
    'waste_generation',
    'emissions_data',
    'environmental_inspection',
  ]),
  siteId: z.string().min(1),
  departmentId: z.string().optional().default(''),
  reportingPeriod: z.string().trim().min(2).max(80),
  sourceName: z.string().trim().min(2).max(140),
  value: z.coerce.number().min(0),
  unit: z.string().trim().min(1).max(40),
  methodologyNote: z.string().max(500).optional().default(''),
  notes: z.string().max(1000).optional().default(''),
});

export const correctiveActionSchema = z.object({
  siteId: z.string().min(1),
  finding: z.string().trim().min(3).max(1000),
  relatedRecordType: z.string().max(64).optional().default(''),
  relatedRecordId: z.string().max(128).optional().default(''),
  assignedOwner: z.string().trim().min(1).max(120),
  dueDate: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  actionPlan: z.string().trim().min(4).max(2000),
});

export const taskSchema = z.object({
  siteId: z.string().min(1),
  departmentId: z.string().optional().default(''),
  title: z.string().trim().min(2).max(180),
  description: z.string().max(2000).optional().default(''),
  sourceModule: z.enum(['core', 'nexus', 'environ']).default('core'),
  assignedTo: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  dueDate: z.string().min(1),
});
