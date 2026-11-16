import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  listUserMemberships,
  provisionAuthUserWithoutLogout,
  registerWithEmail,
  setActiveOrganisationForUser,
  signInWithEmail,
} from './authService';
import type { Role } from '../types/domain';

export const DEMO_ORG_ID = 'org_mushai_demo';
export const DEMO_ORG_NAME = 'Apex Precision Manufacturing';
export const DEMO_SHARED_PASSWORD = 'MushaiDemo@2026!';

export interface DemoCredential {
  role: Role;
  label: string;
  displayName: string;
  email: string;
  password: string;
  scopeSummary: string;
  siteIds: string[];
  departmentIds: string[];
}

export const DEMO_CREDENTIALS: DemoCredential[] = [
  {
    role: 'super_admin',
    label: 'Super Admin',
    displayName: 'Aarav Sharma',
    email: 'superadmin@mushai.demo',
    password: DEMO_SHARED_PASSWORD,
    scopeSummary: 'All Sites · Full Platform Control',
    siteIds: ['site_plt_01', 'site_plt_02'],
    departmentIds: ['dept_prod_01', 'dept_qual_01', 'dept_ehs_01'],
  },
  {
    role: 'org_admin',
    label: 'Organisation Admin',
    displayName: 'Priya Nair',
    email: 'orgadmin@mushai.demo',
    password: DEMO_SHARED_PASSWORD,
    scopeSummary: 'All Sites · Tenant, Users & Settings',
    siteIds: ['site_plt_01', 'site_plt_02'],
    departmentIds: ['dept_prod_01', 'dept_qual_01', 'dept_ehs_01'],
  },
  {
    role: 'plant_head',
    label: 'Plant Head',
    displayName: 'Vikram Kulkarni',
    email: 'planthead@mushai.demo',
    password: DEMO_SHARED_PASSWORD,
    scopeSummary: 'PLT-01 · Departments & Plant Approvals',
    siteIds: ['site_plt_01'],
    departmentIds: ['dept_prod_01', 'dept_qual_01', 'dept_ehs_01'],
  },
  {
    role: 'dept_head',
    label: 'Department Head',
    displayName: 'Sneha Iyer',
    email: 'depthead@mushai.demo',
    password: DEMO_SHARED_PASSWORD,
    scopeSummary: 'PLT-01 · Operations & Approvals',
    siteIds: ['site_plt_01'],
    departmentIds: ['dept_prod_01', 'dept_qual_01'],
  },
  {
    role: 'supervisor',
    label: 'Supervisor',
    displayName: 'Rohan Deshmukh',
    email: 'supervisor@mushai.demo',
    password: DEMO_SHARED_PASSWORD,
    scopeSummary: 'PLT-01 · Shifts, Tasks & Approvals',
    siteIds: ['site_plt_01'],
    departmentIds: ['dept_prod_01'],
  },
  {
    role: 'operator',
    label: 'Operator',
    displayName: 'Karthik Verma',
    email: 'operator@mushai.demo',
    password: DEMO_SHARED_PASSWORD,
    scopeSummary: 'PLT-01 · Nexus Logs & Tasks',
    siteIds: ['site_plt_01'],
    departmentIds: ['dept_prod_01'],
  },
  {
    role: 'ehs_manager',
    label: 'EHS Manager',
    displayName: 'Meera Krishnan',
    email: 'ehsmanager@mushai.demo',
    password: DEMO_SHARED_PASSWORD,
    scopeSummary: 'PLT-01 & PLT-02 · Environ Compliance',
    siteIds: ['site_plt_01', 'site_plt_02'],
    departmentIds: ['dept_ehs_01'],
  },
  {
    role: 'auditor',
    label: 'Auditor',
    displayName: 'Devika Rao',
    email: 'auditor@mushai.demo',
    password: DEMO_SHARED_PASSWORD,
    scopeSummary: 'PLT-01 & PLT-02 · Read, Audit & Export',
    siteIds: ['site_plt_01', 'site_plt_02'],
    departmentIds: ['dept_prod_01', 'dept_qual_01', 'dept_ehs_01'],
  },
  {
    role: 'viewer',
    label: 'Viewer',
    displayName: 'Arjun Patel',
    email: 'viewer@mushai.demo',
    password: DEMO_SHARED_PASSWORD,
    scopeSummary: 'PLT-01 · Read-Only Dashboards',
    siteIds: ['site_plt_01'],
    departmentIds: ['dept_prod_01'],
  },
];

async function signInOrCreatePrimaryOrgAdmin() {
  const orgAdmin = DEMO_CREDENTIALS.find((c) => c.role === 'org_admin')!;
  try {
    return await signInWithEmail(orgAdmin.email, orgAdmin.password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/user-not-found') || msg.includes('auth/invalid-credential')) {
      return await registerWithEmail(orgAdmin.email, orgAdmin.password, orgAdmin.displayName);
    }
    throw err;
  }
}

export interface PopulateMockDataParams {
  orgId: string;
  actor: {
    uid: string;
    displayName: string;
    role: Role;
  };
  siteIds: string[];
  departmentIds: string[];
  includeNexus: boolean;
  includeEnviron: boolean;
  fixedPrefix?: string;
}

export interface PopulateMockDataResult {
  recordsCreated: number;
}

export async function populateMockDataForOrganisation(
  params: PopulateMockDataParams
): Promise<PopulateMockDataResult> {
  const { orgId, actor, siteIds, departmentIds, includeNexus, includeEnviron, fixedPrefix } = params;
  const primarySite = siteIds[0] || 'site_plt_01';
  const secondarySite = siteIds[1] || primarySite;
  const primaryDept = departmentIds[0];
  const secondaryDept = departmentIds[1] || primaryDept;
  const ehsDept = departmentIds[2] || primaryDept;

  const prefix = fixedPrefix || `mock_${Date.now().toString(36)}`;
  const makeId = (suffix: string) => `${prefix}_${suffix}`;

  const now = new Date();
  const isoDay = (offsetDays: number) =>
    new Date(now.getTime() + offsetDays * 24 * 3600_000).toISOString().slice(0, 10);
  const isoDateTime = (offsetHours: number) =>
    new Date(now.getTime() + offsetHours * 3600_000).toISOString().slice(0, 16);
  const monthStr = (offsetMonths: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const today = isoDay(0);
  const yesterday = isoDay(-1);
  const twoDaysAgo = isoDay(-2);
  const nextWeekDate = isoDay(7);
  const soonExpiryDate = isoDay(14);
  const expiredDate = isoDay(-12);

  const batch = writeBatch(db);
  let recordsCreated = 0;

  const addRecord = (
    collectionName: string,
    idSuffix: string,
    record: {
      siteId: string;
      departmentId?: string;
      module: 'nexus' | 'environ' | 'core';
      recordType: string;
      status: string;
      approvalStatus: 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'rejected' | 'closed';
      source?: 'manual' | 'ai_document' | 'system';
      payload: Record<string, unknown>;
    }
  ) => {
    const docId = makeId(idSuffix);
    batch.set(doc(db, 'organisations', orgId, collectionName, docId), {
      id: docId,
      organisationId: orgId,
      siteId: record.siteId,
      ...(record.departmentId ? { departmentId: record.departmentId } : {}),
      module: record.module,
      recordType: record.recordType,
      createdBy: actor.uid,
      createdByName: actor.displayName || 'User',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: record.source || 'manual',
      status: record.status,
      approvalStatus: record.approvalStatus,
      payload: record.payload,
    });
    recordsCreated += 1;
    return docId;
  };

  if (includeNexus) {
    const prodRuns = [
      {
        suffix: 'prod_01',
        siteId: primarySite,
        status: 'approved',
        approvalStatus: 'approved' as const,
        payload: {
          productionDate: today,
          productionLine: 'Line 1 · CNC Cell',
          machine: 'DMG Mori NLX-2500',
          shift: 'Shift A',
          product: 'Rotor Shaft RS-420',
          targetQuantity: 500,
          actualQuantity: 486,
          rejectedQuantity: 6,
          achievementPercent: 97.2,
          rejectionRatePercent: 1.23,
          supervisor: 'Rohan Deshmukh',
          remarks: 'Steady spindle load and cycle time across Shift A.',
        },
      },
      {
        suffix: 'prod_02',
        siteId: primarySite,
        status: 'submitted',
        approvalStatus: 'submitted' as const,
        payload: {
          productionDate: today,
          productionLine: 'Line 2 · Stamping',
          machine: 'Hydraulic Press HP-04',
          shift: 'Shift B',
          product: 'Housing Bracket HB-19',
          targetQuantity: 600,
          actualQuantity: 418,
          rejectedQuantity: 14,
          achievementPercent: 69.7,
          rejectionRatePercent: 3.35,
          supervisor: 'Rohan Deshmukh',
          remarks: '45m pressure calibration stop during die changeover.',
        },
      },
      {
        suffix: 'prod_03',
        siteId: primarySite,
        status: 'approved',
        approvalStatus: 'approved' as const,
        payload: {
          productionDate: today,
          productionLine: 'Line 3 · Weld & Coat',
          machine: 'Robotic Weld Cell RW-02',
          shift: 'Shift A',
          product: 'Chassis Frame CF-88',
          targetQuantity: 420,
          actualQuantity: 356,
          rejectedQuantity: 4,
          achievementPercent: 84.8,
          rejectionRatePercent: 1.12,
          supervisor: 'Sneha Iyer',
          remarks: 'Scheduled powder coat cartridge swap completed.',
        },
      },
      {
        suffix: 'prod_04',
        siteId: secondarySite,
        status: 'approved',
        approvalStatus: 'approved' as const,
        payload: {
          productionDate: today,
          productionLine: 'Line 4 · Final Pack',
          machine: 'Auto-Packer AP-09',
          shift: 'Shift B',
          product: 'Finished Assembly SKU-K33',
          targetQuantity: 520,
          actualQuantity: 498,
          rejectedQuantity: 3,
          achievementPercent: 95.8,
          rejectionRatePercent: 0.6,
          supervisor: 'Vikram Kulkarni',
          remarks: 'Vision scanner recalibrated at shift start.',
        },
      },
      {
        suffix: 'prod_05',
        siteId: primarySite,
        status: 'approved',
        approvalStatus: 'approved' as const,
        payload: {
          productionDate: yesterday,
          productionLine: 'Line 1 · CNC Cell',
          machine: 'DMG Mori NLX-2500',
          shift: 'Shift C',
          product: 'Rotor Shaft RS-420',
          targetQuantity: 460,
          actualQuantity: 438,
          rejectedQuantity: 5,
          achievementPercent: 95.2,
          rejectionRatePercent: 1.14,
          supervisor: 'Karthik Verma',
          remarks: 'Overnight unmanned bar-feed run nominal.',
        },
      },
      {
        suffix: 'prod_06',
        siteId: primarySite,
        status: 'approved',
        approvalStatus: 'approved' as const,
        payload: {
          productionDate: yesterday,
          productionLine: 'Line 2 · Stamping',
          machine: 'Hydraulic Press HP-04',
          shift: 'Shift A',
          product: 'Housing Bracket HB-19',
          targetQuantity: 550,
          actualQuantity: 495,
          rejectedQuantity: 8,
          achievementPercent: 90.0,
          rejectionRatePercent: 1.62,
          supervisor: 'Rohan Deshmukh',
          remarks: 'Coil feed tension adjusted smoothly.',
        },
      },
      {
        suffix: 'prod_07',
        siteId: secondarySite,
        status: 'approved',
        approvalStatus: 'approved' as const,
        payload: {
          productionDate: twoDaysAgo,
          productionLine: 'Line 3 · Weld & Coat',
          machine: 'Robotic Weld Cell RW-02',
          shift: 'Shift C',
          product: 'Chassis Frame CF-88',
          targetQuantity: 400,
          actualQuantity: 368,
          rejectedQuantity: 5,
          achievementPercent: 92.0,
          rejectionRatePercent: 1.36,
          supervisor: 'Sneha Iyer',
          remarks: 'Shielding gas purge nominal.',
        },
      },
    ];

    for (const run of prodRuns) {
      addRecord('production_logs', run.suffix, {
        siteId: run.siteId,
        departmentId: primaryDept,
        module: 'nexus',
        recordType: 'production_log',
        status: run.status,
        approvalStatus: run.approvalStatus,
        payload: run.payload,
      });
    }

    addRecord('downtime_logs', 'down_01', {
      siteId: primarySite,
      departmentId: primaryDept,
      module: 'nexus',
      recordType: 'downtime_log',
      status: 'open',
      approvalStatus: 'submitted',
      payload: {
        machine: 'Hydraulic Press HP-04',
        productionLine: 'Line 2 · Stamping',
        startTime: isoDateTime(-5),
        endTime: isoDateTime(-4),
        totalDowntimeMinutes: 45,
        reason: 'Pressure sensor calibration drift detected during die changeover.',
        reportedBy: 'Karthik Verma',
        correctiveAction: 'Replaced manifold transducer and queued QA verification.',
        resolutionStatus: 'in_progress',
      },
    });

    addRecord('downtime_logs', 'down_02', {
      siteId: primarySite,
      departmentId: primaryDept,
      module: 'nexus',
      recordType: 'downtime_log',
      status: 'closed',
      approvalStatus: 'approved',
      payload: {
        machine: 'Robotic Weld Cell RW-02',
        productionLine: 'Line 3 · Weld & Coat',
        startTime: isoDateTime(-20),
        endTime: isoDateTime(-19),
        totalDowntimeMinutes: 22,
        reason: 'Scheduled nozzle tip cleaning and wire spool replacement.',
        reportedBy: 'Sneha Iyer',
        correctiveAction: 'Tip replaced; weld arc stability verified.',
        resolutionStatus: 'resolved',
      },
    });

    addRecord('quality_logs', 'qual_01', {
      siteId: primarySite,
      departmentId: secondaryDept,
      module: 'nexus',
      recordType: 'quality_log',
      status: 'approved',
      approvalStatus: 'approved',
      payload: {
        inspectionDate: today,
        batchOrProduct: 'BATCH-2026-441',
        parameter: 'Unit Weight Tolerance',
        measuredValue: 100.4,
        unit: 'g',
        minLimit: 98,
        maxLimit: 102,
        outOfRange: false,
        result: 'pass',
        inspector: 'Sneha Iyer',
        notes: 'Within statistical control bounds.',
      },
    });

    addRecord('quality_logs', 'qual_02', {
      siteId: primarySite,
      departmentId: secondaryDept,
      module: 'nexus',
      recordType: 'quality_log',
      status: 'approved',
      approvalStatus: 'approved',
      payload: {
        inspectionDate: today,
        batchOrProduct: 'BATCH-2026-442',
        parameter: 'Line Pressure',
        measuredValue: 6.2,
        unit: 'bar',
        minLimit: 2.0,
        maxLimit: 8.5,
        outOfRange: false,
        result: 'pass',
        inspector: 'Sneha Iyer',
        notes: 'Hydro-test fixture nominal.',
      },
    });

    addRecord('quality_logs', 'qual_03', {
      siteId: primarySite,
      departmentId: secondaryDept,
      module: 'nexus',
      recordType: 'quality_log',
      status: 'open',
      approvalStatus: 'pending_approval',
      payload: {
        inspectionDate: today,
        batchOrProduct: 'BATCH-2026-443',
        parameter: 'Process Temperature',
        measuredValue: 88.4,
        unit: '°C',
        minLimit: 18,
        maxLimit: 85,
        outOfRange: true,
        result: 'fail',
        inspector: 'Sneha Iyer',
        notes: 'Exceeds upper curing limit on Line 3 oven; lot quarantined.',
      },
    });

    addRecord('quality_logs', 'qual_04', {
      siteId: secondarySite,
      departmentId: secondaryDept,
      module: 'nexus',
      recordType: 'quality_log',
      status: 'approved',
      approvalStatus: 'approved',
      payload: {
        inspectionDate: yesterday,
        batchOrProduct: 'BATCH-2026-439',
        parameter: 'Unit Weight Tolerance',
        measuredValue: 99.6,
        unit: 'g',
        minLimit: 98,
        maxLimit: 102,
        outOfRange: false,
        result: 'pass',
        inspector: 'Karthik Verma',
        notes: 'Packaged lot cleared for dispatch.',
      },
    });

    addRecord('shift_reports', 'shf_01', {
      siteId: primarySite,
      departmentId: primaryDept,
      module: 'nexus',
      recordType: 'shift_report',
      status: 'approved',
      approvalStatus: 'approved',
      payload: {
        date: today,
        shift: 'Shift A',
        supervisor: 'Rohan Deshmukh',
        productionSummary: 'CNC Cell hit 97.2% attainment; Weld Cell completed scheduled nozzle PM.',
        issuesEncountered: 'Minor coolant top-up on Spindle 2.',
        pendingWork: 'Complete QA release on Batch 443.',
        handoverNotes: 'Maintain die inspection interval at 250 strokes.',
      },
    });

    addRecord('workforce_records', 'wf_01', {
      siteId: primarySite,
      departmentId: primaryDept,
      module: 'nexus',
      recordType: 'workforce_record',
      status: 'logged',
      approvalStatus: 'approved',
      payload: {
        date: today,
        shift: 'Shift A',
        employeeName: 'Karthik Verma',
        employeeId: 'EMP-1042',
        attendanceStatus: 'present',
        notes: 'Assigned to CNC Cell Line 1.',
      },
    });

    addRecord('visitor_records', 'vis_01', {
      siteId: primarySite,
      departmentId: primaryDept,
      module: 'nexus',
      recordType: 'visitor_record',
      status: 'logged',
      approvalStatus: 'approved',
      payload: {
        visitorName: 'S. Subramanian',
        company: 'TUV Rheinland Audit Team',
        purpose: 'Annual metrology calibration verification',
        personToMeet: 'Sneha Iyer',
        entryTimestamp: isoDateTime(-3),
      },
    });
  }

  if (includeEnviron) {
    addRecord('safety_observations', 'obs_01', {
      siteId: primarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'safety_observation',
      status: 'open',
      approvalStatus: 'pending_approval',
      payload: {
        observationDate: today,
        location: 'Tank Farm',
        category: 'Unsafe Condition',
        description: 'Secondary spill pallet edge seal requires replacement near drum staging.',
        riskLevel: 'high',
        reportedBy: 'Meera Krishnan',
        assignedPerson: 'Rohan Deshmukh',
        correctiveAction: 'Install replacement containment tray before next shift.',
      },
    });

    addRecord('safety_observations', 'obs_02', {
      siteId: primarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'safety_observation',
      status: 'open',
      approvalStatus: 'submitted',
      payload: {
        observationDate: today,
        location: 'Effluent Plant',
        category: 'Housekeeping',
        description: 'Effluent pH probe calibration due after sensor drift reading.',
        riskLevel: 'medium',
        reportedBy: 'Meera Krishnan',
        assignedPerson: 'Vikram Kulkarni',
        correctiveAction: 'Auto-sample queued for lab check.',
      },
    });

    addRecord('safety_observations', 'obs_03', {
      siteId: secondarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'safety_observation',
      status: 'closed',
      approvalStatus: 'approved',
      payload: {
        observationDate: yesterday,
        location: 'Warehouse',
        category: 'PPE Compliance',
        description: 'Forklift pedestrian lane mirror cleaned and high-vis tape refreshed.',
        riskLevel: 'low',
        reportedBy: 'Vikram Kulkarni',
        assignedPerson: 'Arjun Patel',
        correctiveAction: 'Completed and verified during morning walkdown.',
      },
    });

    addRecord('incidents', 'inc_01', {
      siteId: primarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'incident',
      status: 'open',
      approvalStatus: 'pending_approval',
      payload: {
        incidentDateTime: isoDateTime(-10),
        location: 'Press Bay',
        category: 'Near Miss',
        description: 'Hydraulic return hose misting detected behind guard panel HP-04.',
        severity: 'moderate',
        peopleInvolved: 'Maintenance Crew B',
        immediateAction: 'Isolated press pressure and applied lockout/tagout.',
        investigationDetails: 'Swaged fitting fatigue inspected.',
        correctiveActions: 'Replace braided hose assembly across HP-01 through HP-04.',
      },
    });

    addRecord('work_permits', 'ptw_01', {
      siteId: primarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'work_permit',
      status: 'active',
      approvalStatus: 'pending_approval',
      payload: {
        permitNumber: 'PTW-2026-089',
        permitType: 'Hot Work',
        location: 'Press Bay',
        contractor: 'Thermotech Engineering Services',
        responsiblePerson: 'Vikram Kulkarni',
        startDateTime: isoDateTime(-2),
        endDateTime: isoDateTime(22),
        hazards: 'Welding sparks near insulated hydraulic piping.',
        precautions: 'Fire blanket, CO2 extinguisher standby, 30-min post-work fire watch.',
      },
    });

    addRecord('work_permits', 'ptw_02', {
      siteId: secondarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'work_permit',
      status: 'active',
      approvalStatus: 'approved',
      payload: {
        permitNumber: 'PTW-2026-092',
        permitType: 'Confined Space',
        location: 'Tank Farm',
        contractor: 'Apex Maintenance Crew',
        responsiblePerson: 'Meera Krishnan',
        startDateTime: isoDateTime(-4),
        endDateTime: isoDateTime(20),
        hazards: 'Low oxygen potential during solvent tank inspection.',
        precautions: 'Continuous O2/LEL gas monitor, rescue harness, standby attendant.',
      },
    });

    addRecord('work_permits', 'ptw_03', {
      siteId: primarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'work_permit',
      status: 'active',
      approvalStatus: 'approved',
      payload: {
        permitNumber: 'PTW-2026-095',
        permitType: 'Electrical Work',
        location: 'Workshop',
        contractor: 'VoltGrid Switchgear Services',
        responsiblePerson: 'Rohan Deshmukh',
        startDateTime: isoDateTime(-1),
        endDateTime: isoDateTime(18),
        hazards: '415V busbar panel arc flash risk.',
        precautions: 'LOTO padlocks verified, insulated gloves & arc shield mandatory.',
      },
    });

    addRecord('compliance_records', 'comp_01', {
      siteId: primarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'compliance_record',
      status: 'expiring_soon',
      approvalStatus: 'approved',
      payload: {
        requirement: 'ISO 45001:2018 Occupational Health & Safety',
        certificationName: 'Plant Safety Surveillance Audit Certificate',
        issuingAuthority: 'TUV Rheinland Industrial Services',
        issueDate: '2025-11-30',
        expiryDate: soonExpiryDate,
        responsiblePerson: 'Meera Krishnan',
      },
    });

    addRecord('compliance_records', 'comp_02', {
      siteId: primarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'compliance_record',
      status: 'valid',
      approvalStatus: 'approved',
      payload: {
        requirement: 'ISO 14001:2015 Environmental Management',
        certificationName: 'Air & Effluent Compliance Consent',
        issuingAuthority: 'State Pollution Control Board',
        issueDate: '2026-01-15',
        expiryDate: '2028-01-15',
        responsiblePerson: 'Meera Krishnan',
      },
    });

    addRecord('compliance_records', 'comp_03', {
      siteId: secondarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'compliance_record',
      status: 'valid',
      approvalStatus: 'approved',
      payload: {
        requirement: 'Factory Boiler & Pressure Vessel Inspection',
        certificationName: 'Form-V Statutory Fitness Certificate',
        issuingAuthority: 'Directorate of Industrial Safety',
        issueDate: '2026-03-10',
        expiryDate: '2027-03-10',
        responsiblePerson: 'Vikram Kulkarni',
      },
    });

    addRecord('compliance_records', 'comp_04', {
      siteId: primarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'compliance_record',
      status: 'expired',
      approvalStatus: 'submitted',
      payload: {
        requirement: 'Hazardous Waste Manifest Renewal',
        certificationName: 'TSDF Disposal Authorization',
        issuingAuthority: 'Regional Environment Board',
        issueDate: '2024-11-01',
        expiryDate: expiredDate,
        responsiblePerson: 'Meera Krishnan',
      },
    });

    const envTrajectory = [
      { suffix: 'env_01', offset: -5, siteId: primarySite, source: 'Main Stack & Boiler Line', value: 218 },
      { suffix: 'env_02', offset: -4, siteId: primarySite, source: 'Main Stack & Boiler Line', value: 209 },
      { suffix: 'env_03', offset: -3, siteId: secondarySite, source: 'Assembly Hub Utility Grid', value: 201 },
      { suffix: 'env_04', offset: -2, siteId: primarySite, source: 'Main Stack & Boiler Line', value: 196 },
      { suffix: 'env_05', offset: -1, siteId: primarySite, source: 'Main Stack & Boiler Line', value: 188 },
      { suffix: 'env_06', offset: 0, siteId: secondarySite, source: 'Assembly Hub Utility Grid', value: 174 },
    ];

    for (const em of envTrajectory) {
      addRecord('environmental_records', em.suffix, {
        siteId: em.siteId,
        departmentId: ehsDept,
        module: 'environ',
        recordType: 'environmental_record',
        status: 'logged',
        approvalStatus: 'approved',
        payload: {
          metricType: 'emissions_data',
          reportingPeriod: monthStr(em.offset),
          sourceName: em.source,
          value: em.value,
          unit: 'tCO2',
          notes: 'Monthly Scope 1 & 2 energy-intensity monitoring.',
        },
      });
    }

    addRecord('corrective_actions', 'capa_01', {
      siteId: primarySite,
      departmentId: ehsDept,
      module: 'environ',
      recordType: 'corrective_action',
      status: 'in_progress',
      approvalStatus: 'submitted',
      payload: {
        finding: 'Spill pallet seal degradation & TSDF disposal renewal due',
        assignedOwner: 'Meera Krishnan',
        dueDate: nextWeekDate,
        priority: 'high',
        actionPlan: 'Install heavy-duty HDPE secondary containment pallet and upload TSDF renewal receipt.',
      },
    });
  }

  // Core shared tasks & approvals
  if (includeEnviron) {
    addRecord('tasks', 'task_01', {
      siteId: primarySite,
      module: 'core',
      recordType: 'task',
      status: 'open',
      approvalStatus: 'submitted',
      payload: {
        title: 'Replace spill containment tray in Tank Farm',
        description: 'Linked to high-risk safety observation in Tank Farm.',
        sourceModule: 'environ',
        assignedTo: actor.uid,
        assignedToName: 'Rohan Deshmukh',
        priority: 'high',
        dueDate: nextWeekDate,
        comments: [],
      },
    });

    addRecord('tasks', 'task_04', {
      siteId: primarySite,
      module: 'core',
      recordType: 'task',
      status: 'open',
      approvalStatus: 'submitted',
      payload: {
        title: 'Renew TSDF Hazardous Waste Disposal Authorization',
        description: 'Compliance record flagged expired; submit renewal manifest.',
        sourceModule: 'environ',
        assignedTo: actor.uid,
        assignedToName: 'Meera Krishnan',
        priority: 'critical',
        dueDate: today,
        comments: [],
      },
    });

    addRecord('approvals', 'apr_01', {
      siteId: primarySite,
      module: 'core',
      recordType: 'approval',
      status: 'pending_approval',
      approvalStatus: 'pending_approval',
      source: 'system',
      payload: {
        targetModule: 'environ',
        recordCollection: 'work_permits',
        recordId: makeId('ptw_01'),
        recordTitle: 'Hot Work Permit PTW-2026-089 — Press Bay',
        requestedBy: actor.uid,
        requestedByName: 'Vikram Kulkarni',
        history: [
          {
            state: 'pending_approval',
            actorId: actor.uid,
            actorName: actor.displayName || 'System',
            comment: 'Submitted Hot Work permit for EHS sign-off',
            timestamp: new Date().toISOString(),
          },
        ],
      },
    });
  }

  if (includeNexus) {
    addRecord('tasks', 'task_02', {
      siteId: primarySite,
      module: 'core',
      recordType: 'task',
      status: 'open',
      approvalStatus: 'submitted',
      payload: {
        title: 'Verify Line 2 press hydraulic pressure calibration',
        description: 'Follow-up after 45m downtime event on Hydraulic Press HP-04.',
        sourceModule: 'nexus',
        assignedTo: actor.uid,
        assignedToName: 'Rohan Deshmukh',
        priority: 'high',
        dueDate: nextWeekDate,
        comments: [],
      },
    });

    addRecord('tasks', 'task_03', {
      siteId: primarySite,
      module: 'core',
      recordType: 'task',
      status: 'open',
      approvalStatus: 'submitted',
      payload: {
        title: 'Quarantine & re-inspect Batch 443 curing temperature deviation',
        description: 'Measured 88.4 °C vs 85 °C upper limit.',
        sourceModule: 'nexus',
        assignedTo: actor.uid,
        assignedToName: 'Sneha Iyer',
        priority: 'high',
        dueDate: nextWeekDate,
        comments: [],
      },
    });

    addRecord('approvals', 'apr_02', {
      siteId: primarySite,
      module: 'core',
      recordType: 'approval',
      status: 'pending_approval',
      approvalStatus: 'pending_approval',
      source: 'system',
      payload: {
        targetModule: 'nexus',
        recordCollection: 'production_logs',
        recordId: makeId('prod_02'),
        recordTitle: 'Line 2 · Stamping Shift B Run Sign-Off',
        requestedBy: actor.uid,
        requestedByName: 'Rohan Deshmukh',
        history: [
          {
            state: 'pending_approval',
            actorId: actor.uid,
            actorName: actor.displayName || 'System',
            comment: 'Submitted Shift B stamping log with downtime notes',
            timestamp: new Date().toISOString(),
          },
        ],
      },
    });
  }

  addRecord('audit_logs', 'aud_01', {
    siteId: 'ALL',
    module: 'core',
    recordType: 'audit_log',
    status: 'logged',
    approvalStatus: 'closed',
    source: 'system',
    payload: {
      actorId: actor.uid,
      actorName: actor.displayName || 'System',
      actorRole: actor.role,
      action: 'sample_data.populated',
      resourceCollection: 'organisations',
      resourceId: orgId,
      summary: `Populated ${recordsCreated + 1} operational mock records across enabled modules.`,
    },
  });

  try {
    await batch.commit();
    return { recordsCreated };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organisations/${orgId}`);
  }
}

async function seedDemoOrganisationAndRecords(adminUid: string, adminName: string) {
  const membershipId = `${DEMO_ORG_ID}_${adminUid}`;

  // Batch 1: Organisation + org_admin member + user_membership
  const orgBatch = writeBatch(db);
  orgBatch.set(doc(db, 'organisations', DEMO_ORG_ID), {
    id: DEMO_ORG_ID,
    name: DEMO_ORG_NAME,
    slug: 'apex-precision-manufacturing',
    industry: 'Automotive & Industrial Components',
    country: 'India',
    timezone: 'Asia/Kolkata',
    activeModules: {
      nexus: true,
      environ: true,
    },
    alertThresholds: {
      permitExpiryHours: 24,
      certificationExpiryDays: 30,
      permitTypes: ['Hot Work', 'Confined Space', 'Electrical Work', 'Work at Height', 'Excavation'],
      qualityParameters: [
        { id: 'qp_temp', parameter: 'Process Temperature', unit: '°C', minLimit: 18, maxLimit: 85 },
        { id: 'qp_pressure', parameter: 'Line Pressure', unit: 'bar', minLimit: 2.0, maxLimit: 8.5 },
        { id: 'qp_weight', parameter: 'Unit Weight Tolerance', unit: 'g', minLimit: 98, maxLimit: 102 },
      ],
    },
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  orgBatch.set(doc(db, 'organisations', DEMO_ORG_ID, 'members', adminUid), {
    userId: adminUid,
    organisationId: DEMO_ORG_ID,
    email: 'orgadmin@mushai.demo',
    displayName: adminName,
    role: 'org_admin',
    siteIds: ['site_plt_01', 'site_plt_02'],
    departmentIds: ['dept_prod_01', 'dept_qual_01', 'dept_ehs_01'],
    status: 'active',
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  orgBatch.set(doc(db, 'user_memberships', membershipId), {
    id: membershipId,
    organisationId: DEMO_ORG_ID,
    organisationName: DEMO_ORG_NAME,
    userId: adminUid,
    role: 'org_admin',
    status: 'active',
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await orgBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organisations/${DEMO_ORG_ID}`);
  }

  // Batch 2: Sites & Departments
  const structBatch = writeBatch(db);

  structBatch.set(doc(db, 'organisations', DEMO_ORG_ID, 'sites', 'site_plt_01'), {
    id: 'site_plt_01',
    organisationId: DEMO_ORG_ID,
    name: 'Pune Precision Plant',
    code: 'PLT-01',
    location: 'Chakan Industrial Area, Pune',
    timezone: 'Asia/Kolkata',
    status: 'active',
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  structBatch.set(doc(db, 'organisations', DEMO_ORG_ID, 'sites', 'site_plt_02'), {
    id: 'site_plt_02',
    organisationId: DEMO_ORG_ID,
    name: 'Chennai Assembly Hub',
    code: 'PLT-02',
    location: 'Sriperumbudur, Chennai',
    timezone: 'Asia/Kolkata',
    status: 'active',
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  structBatch.set(doc(db, 'organisations', DEMO_ORG_ID, 'departments', 'dept_prod_01'), {
    id: 'dept_prod_01',
    organisationId: DEMO_ORG_ID,
    siteId: 'site_plt_01',
    name: 'Production & CNC Machining',
    code: 'PROD-01',
    status: 'active',
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  structBatch.set(doc(db, 'organisations', DEMO_ORG_ID, 'departments', 'dept_qual_01'), {
    id: 'dept_qual_01',
    organisationId: DEMO_ORG_ID,
    siteId: 'site_plt_01',
    name: 'Quality & Metrology Lab',
    code: 'QUAL-01',
    status: 'active',
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  structBatch.set(doc(db, 'organisations', DEMO_ORG_ID, 'departments', 'dept_ehs_01'), {
    id: 'dept_ehs_01',
    organisationId: DEMO_ORG_ID,
    siteId: 'site_plt_01',
    name: 'Environment, Health & Safety',
    code: 'EHS-01',
    status: 'active',
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await structBatch.commit();
    await populateMockDataForOrganisation({
      orgId: DEMO_ORG_ID,
      actor: { uid: adminUid, displayName: adminName, role: 'org_admin' },
      siteIds: ['site_plt_01', 'site_plt_02'],
      departmentIds: ['dept_prod_01', 'dept_qual_01', 'dept_ehs_01'],
      includeNexus: true,
      includeEnviron: true,
      fixedPrefix: 'demo',
    });
    await setActiveOrganisationForUser(adminUid, DEMO_ORG_ID);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organisations/${DEMO_ORG_ID}/sites`);
  }
}

export async function provisionAllDemoRoles(onProgress?: (message: string) => void): Promise<void> {
  onProgress?.('Connecting primary demo Organisation Admin...');
  const adminUser = await signInOrCreatePrimaryOrgAdmin();
  const adminCred = DEMO_CREDENTIALS.find((c) => c.role === 'org_admin')!;

  const existingMemberships = await listUserMemberships(adminUser.uid);
  const hasDemoOrg = existingMemberships.some((m) => m.organisationId === DEMO_ORG_ID);

  if (!hasDemoOrg) {
    onProgress?.('Seeding demo organisation, plant sites & sample records...');
    await seedDemoOrganisationAndRecords(adminUser.uid, adminCred.displayName);
  }

  const otherRoles = DEMO_CREDENTIALS.filter((c) => c.role !== 'org_admin');
  for (let i = 0; i < otherRoles.length; i++) {
    const cred = otherRoles[i];
    onProgress?.(`Provisioning role ${i + 1}/${otherRoles.length}: ${cred.label}...`);
    const provisioned = await provisionAuthUserWithoutLogout({
      email: cred.email,
      password: cred.password,
      displayName: cred.displayName,
      allowExisting: true,
    });

    const memberRef = doc(db, 'organisations', DEMO_ORG_ID, 'members', provisioned.uid);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      const batch = writeBatch(db);
      const membershipId = `${DEMO_ORG_ID}_${provisioned.uid}`;

      batch.set(memberRef, {
        userId: provisioned.uid,
        organisationId: DEMO_ORG_ID,
        email: cred.email,
        displayName: cred.displayName,
        role: cred.role,
        siteIds: cred.siteIds,
        departmentIds: cred.departmentIds,
        status: 'active',
        createdBy: adminUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'user_memberships', membershipId), {
        id: membershipId,
        organisationId: DEMO_ORG_ID,
        organisationName: DEMO_ORG_NAME,
        userId: provisioned.uid,
        role: cred.role,
        status: 'active',
        createdBy: adminUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `organisations/${DEMO_ORG_ID}/members/${provisioned.uid}`);
      }
    }
  }
}

export async function signInWithDemoRole(
  role: Role,
  onProgress?: (message: string) => void
): Promise<void> {
  const cred = DEMO_CREDENTIALS.find((c) => c.role === role);
  if (!cred) {
    throw new Error(`Unknown demo role: ${role}`);
  }

  // Fast path: try direct sign-in first
  try {
    onProgress?.(`Signing in as ${cred.label}...`);
    const signedUser = await signInWithEmail(cred.email, cred.password);
    const memberships = await listUserMemberships(signedUser.uid);
    if (memberships.length > 0) {
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const notProvisioned =
      msg.includes('auth/user-not-found') ||
      msg.includes('auth/invalid-credential') ||
      msg.includes('auth/wrong-password');
    if (!notProvisioned) {
      throw err;
    }
  }

  // Provision the demo workspace and all 9 roles, then sign in as requested role
  await provisionAllDemoRoles(onProgress);
  onProgress?.(`Opening workspace as ${cred.label}...`);
  await signInWithEmail(cred.email, cred.password);
}
