import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Factory,
  FileCheck2,
  Leaf,
  MapPin,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../lib/permissions';
import {
  evaluateOrganisationAlerts,
  listOperationalRecords,
  updateOperationalRecord,
} from '../services/firestoreService';
import { populateMockDataForOrganisation } from '../services/demoSeedService';
import { evaluateExpiryStatus } from '../lib/validation';
import { cn, formatNumber, formatTimestamp, toDateObject } from '../lib/utils';
import type {
  AlertPayload,
  ApprovalPayload,
  AuditLogPayload,
  ComplianceRecordPayload,
  DowntimeLogPayload,
  EnvironmentalRecordPayload,
  IncidentPayload,
  OperationalRecord,
  ProductionLogPayload,
  QualityLogPayload,
  SafetyObservationPayload,
  TaskPayload,
  WorkPermitPayload,
} from '../types/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState, TableSkeleton } from '../components/ui/EmptyState';
import { StatusBadge, statusToTone } from '../components/ui/Badge';
import { useToast } from '../components/ui/ToastProvider';

type ActiveModuleView = 'nexus' | 'environ';
type ShiftFilter = 'ALL' | 'Shift A' | 'Shift B' | 'Shift C';

interface LineSummary {
  lineName: string;
  machine: string;
  product: string;
  supervisor: string;
  shift: string;
  targetQuantity: number;
  actualQuantity: number;
  rejectedQuantity: number;
  achievementPercent: number;
  downtimeMinutes: number;
  openDowntimeCount: number;
  status: 'running' | 'watch' | 'fault';
  logs: Array<OperationalRecord<ProductionLogPayload>>;
  downtimes: Array<OperationalRecord<DowntimeLogPayload>>;
}

interface ZoneSummary {
  zoneName: string;
  status: 'safe' | 'watch' | 'risk';
  activePermits: Array<OperationalRecord<WorkPermitPayload>>;
  openObservations: Array<OperationalRecord<SafetyObservationPayload>>;
  openIncidents: Array<OperationalRecord<IncidentPayload>>;
  envReadings: Array<OperationalRecord<EnvironmentalRecordPayload>>;
}

const DEFAULT_FACILITY_ZONES = [
  'Tank Farm',
  'Press Bay',
  'Warehouse',
  'Effluent Plant',
  'Workshop',
  'Main Stack',
];

export function OverviewDashboard() {
  const {
    user,
    activeOrg,
    activeMember,
    sites,
    departments,
    actor,
    selectedSiteId,
    selectedDepartmentId,
  } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const orgId = activeOrg?.id;

  const nexusOn = Boolean(activeOrg?.activeModules?.nexus) && hasPermission(activeMember, 'nexus.read');
  const environOn = Boolean(activeOrg?.activeModules?.environ) && hasPermission(activeMember, 'environ.read');

  const [activeView, setActiveView] = React.useState<ActiveModuleView>(() =>
    nexusOn ? 'nexus' : 'environ'
  );
  const [shiftFilter, setShiftFilter] = React.useState<ShiftFilter>('ALL');
  const [selectedLineName, setSelectedLineName] = React.useState<string>('');
  const [selectedZoneName, setSelectedZoneName] = React.useState<string>('');
  const [completingTaskId, setCompletingTaskId] = React.useState<string | null>(null);
  const [populatingMock, setPopulatingMock] = React.useState(false);

  React.useEffect(() => {
    if (activeView === 'nexus' && !nexusOn && environOn) {
      setActiveView('environ');
    } else if (activeView === 'environ' && !environOn && nexusOn) {
      setActiveView('nexus');
    }
  }, [activeView, nexusOn, environOn]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['overview', orgId, selectedSiteId, nexusOn, environOn],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) throw new Error('No active organisation');
      const siteOpt = selectedSiteId === 'ALL' ? undefined : selectedSiteId;

      const [
        tasks,
        approvals,
        alerts,
        auditLogs,
        productionLogs,
        downtimeLogs,
        qualityLogs,
        safetyObs,
        incidents,
        permits,
        complianceRecords,
        environmentalRecords,
      ] = await Promise.all([
        listOperationalRecords<TaskPayload>(orgId, 'tasks', { siteId: siteOpt }),
        listOperationalRecords<ApprovalPayload>(orgId, 'approvals', { siteId: siteOpt }),
        listOperationalRecords<AlertPayload>(orgId, 'alerts', { siteId: siteOpt }),
        listOperationalRecords<AuditLogPayload>(orgId, 'audit_logs', { siteId: siteOpt, pageSize: 30 }),
        nexusOn ? listOperationalRecords<ProductionLogPayload>(orgId, 'production_logs', { siteId: siteOpt }) : Promise.resolve([]),
        nexusOn ? listOperationalRecords<DowntimeLogPayload>(orgId, 'downtime_logs', { siteId: siteOpt }) : Promise.resolve([]),
        nexusOn ? listOperationalRecords<QualityLogPayload>(orgId, 'quality_logs', { siteId: siteOpt }) : Promise.resolve([]),
        environOn ? listOperationalRecords<SafetyObservationPayload>(orgId, 'safety_observations', { siteId: siteOpt }) : Promise.resolve([]),
        environOn ? listOperationalRecords<IncidentPayload>(orgId, 'incidents', { siteId: siteOpt }) : Promise.resolve([]),
        environOn ? listOperationalRecords<WorkPermitPayload>(orgId, 'work_permits', { siteId: siteOpt }) : Promise.resolve([]),
        environOn ? listOperationalRecords<ComplianceRecordPayload>(orgId, 'compliance_records', { siteId: siteOpt }) : Promise.resolve([]),
        environOn ? listOperationalRecords<EnvironmentalRecordPayload>(orgId, 'environmental_records', { siteId: siteOpt }) : Promise.resolve([]),
      ]);

      return {
        tasks,
        approvals,
        alerts,
        auditLogs,
        productionLogs,
        downtimeLogs,
        qualityLogs,
        safetyObs,
        incidents,
        permits,
        complianceRecords,
        environmentalRecords,
      };
    },
  });

  const filterDept = React.useCallback(
    <T,>(items: Array<OperationalRecord<T>>): Array<OperationalRecord<T>> => {
      if (selectedDepartmentId === 'ALL') return items;
      return items.filter((i) => !i.departmentId || i.departmentId === selectedDepartmentId);
    },
    [selectedDepartmentId]
  );

  const tasks = React.useMemo(() => filterDept(data?.tasks || []), [data?.tasks, filterDept]);
  const approvals = React.useMemo(() => filterDept(data?.approvals || []), [data?.approvals, filterDept]);
  const alerts = React.useMemo(() => filterDept(data?.alerts || []), [data?.alerts, filterDept]);
  const auditLogs = React.useMemo(() => data?.auditLogs || [], [data?.auditLogs]);

  const rawProductionLogs = React.useMemo(
    () => filterDept(data?.productionLogs || []),
    [data?.productionLogs, filterDept]
  );
  const productionLogs = React.useMemo(() => {
    if (shiftFilter === 'ALL') return rawProductionLogs;
    return rawProductionLogs.filter((r) => r.payload.shift === shiftFilter);
  }, [rawProductionLogs, shiftFilter]);

  const downtimeLogs = React.useMemo(() => filterDept(data?.downtimeLogs || []), [data?.downtimeLogs, filterDept]);
  const qualityLogs = React.useMemo(() => filterDept(data?.qualityLogs || []), [data?.qualityLogs, filterDept]);
  const safetyObs = React.useMemo(() => filterDept(data?.safetyObs || []), [data?.safetyObs, filterDept]);
  const incidents = React.useMemo(() => filterDept(data?.incidents || []), [data?.incidents, filterDept]);
  const permits = React.useMemo(() => filterDept(data?.permits || []), [data?.permits, filterDept]);
  const complianceRecords = React.useMemo(
    () => filterDept(data?.complianceRecords || []),
    [data?.complianceRecords, filterDept]
  );
  const environmentalRecords = React.useMemo(
    () => filterDept(data?.environmentalRecords || []),
    [data?.environmentalRecords, filterDept]
  );

  // --- NEXUS AGGREGATIONS ---
  const lineSummaries = React.useMemo<LineSummary[]>(() => {
    const map = new Map<string, LineSummary>();

    for (const log of productionLogs) {
      const name = log.payload.productionLine || 'Unassigned Line';
      const existing = map.get(name);
      const target = Number(log.payload.targetQuantity) || 0;
      const actual = Number(log.payload.actualQuantity) || 0;
      const rejected = Number(log.payload.rejectedQuantity) || 0;

      if (!existing) {
        map.set(name, {
          lineName: name,
          machine: log.payload.machine || '—',
          product: log.payload.product || '—',
          supervisor: log.payload.supervisor || '—',
          shift: log.payload.shift || 'Shift A',
          targetQuantity: target,
          actualQuantity: actual,
          rejectedQuantity: rejected,
          achievementPercent: target > 0 ? Number(((actual / target) * 100).toFixed(1)) : 0,
          downtimeMinutes: 0,
          openDowntimeCount: 0,
          status: 'running',
          logs: [log],
          downtimes: [],
        });
      } else {
        existing.targetQuantity += target;
        existing.actualQuantity += actual;
        existing.rejectedQuantity += rejected;
        existing.achievementPercent =
          existing.targetQuantity > 0
            ? Number(((existing.actualQuantity / existing.targetQuantity) * 100).toFixed(1))
            : 0;
        existing.logs.push(log);
      }
    }

    for (const dt of downtimeLogs) {
      const lineName = dt.payload.productionLine || 'Unassigned Line';
      const entry = map.get(lineName);
      const mins = Number(dt.payload.totalDowntimeMinutes) || 0;
      const isOpen = dt.payload.resolutionStatus !== 'resolved' && dt.status !== 'closed';
      if (entry) {
        entry.downtimeMinutes += mins;
        if (isOpen) entry.openDowntimeCount += 1;
        entry.downtimes.push(dt);
      }
    }

    const list = Array.from(map.values()).map((line) => {
      let status: LineSummary['status'] = 'running';
      if (line.openDowntimeCount > 0 && line.achievementPercent < 75) {
        status = 'fault';
      } else if (line.openDowntimeCount > 0 || line.achievementPercent < 88) {
        status = 'watch';
      }
      return { ...line, status };
    });

    return list.sort((a, b) => a.lineName.localeCompare(b.lineName));
  }, [productionLogs, downtimeLogs]);

  React.useEffect(() => {
    if (lineSummaries.length > 0 && !lineSummaries.some((l) => l.lineName === selectedLineName)) {
      setSelectedLineName(lineSummaries[0].lineName);
    } else if (lineSummaries.length === 0) {
      setSelectedLineName('');
    }
  }, [lineSummaries, selectedLineName]);

  const activeLine = lineSummaries.find((l) => l.lineName === selectedLineName) || lineSummaries[0] || null;

  const nexusKpis = React.useMemo(() => {
    const totalActual = productionLogs.reduce((acc, r) => acc + (Number(r.payload.actualQuantity) || 0), 0);
    const totalTarget = productionLogs.reduce((acc, r) => acc + (Number(r.payload.targetQuantity) || 0), 0);
    const avgAchievement =
      totalTarget > 0
        ? (totalActual / totalTarget) * 100
        : productionLogs.length > 0
          ? productionLogs.reduce((acc, r) => acc + (Number(r.payload.achievementPercent) || 0), 0) / productionLogs.length
          : 0;

    const openDowntimes = downtimeLogs.filter(
      (d) => d.payload.resolutionStatus !== 'resolved' && d.status !== 'closed'
    );
    const totalDowntimeMins = downtimeLogs.reduce(
      (acc, d) => acc + (Number(d.payload.totalDowntimeMinutes) || 0),
      0
    );

    const passedQuality = qualityLogs.filter((q) => q.payload.result === 'pass').length;
    const qualityPassRate = qualityLogs.length > 0 ? (passedQuality / qualityLogs.length) * 100 : 0;

    return {
      avgAchievement,
      totalActual,
      totalTarget,
      openDowntimeCount: openDowntimes.length,
      totalDowntimeMins,
      qualityPassRate,
      qualityTotal: qualityLogs.length,
    };
  }, [productionLogs, downtimeLogs, qualityLogs]);

  const nexusTrendData = React.useMemo(() => {
    if (productionLogs.length === 0) return [];
    return [...productionLogs]
      .reverse()
      .map((log, idx) => ({
        label: log.payload.productionLine.split('·')[0]?.trim() || `Run ${idx + 1}`,
        achievement: Number(log.payload.achievementPercent) || 0,
        actual: Number(log.payload.actualQuantity) || 0,
        target: Number(log.payload.targetQuantity) || 0,
      }));
  }, [productionLogs]);

  const nexusBarData = React.useMemo(
    () =>
      lineSummaries.map((l) => ({
        line: l.lineName.split('·')[0]?.trim() || l.lineName,
        actual: l.actualQuantity,
        target: l.targetQuantity,
      })),
    [lineSummaries]
  );

  // --- ENVIRON AGGREGATIONS ---
  const certThresholdDays = activeOrg?.alertThresholds?.certificationExpiryDays ?? 30;

  const certBreakdown = React.useMemo(() => {
    let valid = 0;
    let expiring = 0;
    let expired = 0;
    for (const rec of complianceRecords) {
      const { status } = evaluateExpiryStatus(rec.payload.expiryDate, certThresholdDays);
      if (status === 'expired') expired += 1;
      else if (status === 'expiring_soon') expiring += 1;
      else valid += 1;
    }
    const total = complianceRecords.length;
    const healthPercent = total > 0 ? Math.round((valid / total) * 100) : 0;
    return { valid, expiring, expired, total, healthPercent };
  }, [complianceRecords, certThresholdDays]);

  const zoneSummaries = React.useMemo<ZoneSummary[]>(() => {
    const discoveredNames = new Set<string>();
    for (const p of permits) if (p.payload.location) discoveredNames.add(p.payload.location.trim());
    for (const o of safetyObs) if (o.payload.location) discoveredNames.add(o.payload.location.trim());
    for (const i of incidents) if (i.payload.location) discoveredNames.add(i.payload.location.trim());

    const hasAnyEnviron =
      permits.length > 0 ||
      safetyObs.length > 0 ||
      incidents.length > 0 ||
      environmentalRecords.length > 0;

    if (!hasAnyEnviron) return [];

    // Keep standard architectural zones visible when facility has Environ telemetry, plus custom logged zones
    for (const z of DEFAULT_FACILITY_ZONES) {
      discoveredNames.add(z);
    }

    return Array.from(discoveredNames)
      .slice(0, 6)
      .map((zoneName) => {
        const lower = zoneName.toLowerCase();
        const zonePermits = permits.filter(
          (p) =>
            p.status !== 'closed' &&
            p.approvalStatus !== 'rejected' &&
            p.payload.location.toLowerCase().includes(lower)
        );
        const zoneObs = safetyObs.filter(
          (o) => o.status !== 'closed' && o.payload.location.toLowerCase().includes(lower)
        );
        const zoneIncidents = incidents.filter(
          (i) => i.status !== 'closed' && i.payload.location.toLowerCase().includes(lower)
        );
        const zoneEnv = environmentalRecords.filter((e) =>
          e.payload.sourceName.toLowerCase().includes(lower) ||
          (zoneName === 'Main Stack' && e.payload.sourceName.toLowerCase().includes('stack'))
        );

        const hasCritical =
          zoneIncidents.some((i) => i.payload.severity === 'major' || i.payload.severity === 'critical') ||
          zoneObs.some((o) => o.payload.riskLevel === 'high' || o.payload.riskLevel === 'critical');
        const hasWatch =
          zoneIncidents.length > 0 ||
          zoneObs.length > 0 ||
          zonePermits.some((p) => p.approvalStatus === 'pending_approval');

        const status: ZoneSummary['status'] = hasCritical ? 'risk' : hasWatch ? 'watch' : 'safe';
        return {
          zoneName,
          status,
          activePermits: zonePermits,
          openObservations: zoneObs,
          openIncidents: zoneIncidents,
          envReadings: zoneEnv,
        };
      });
  }, [permits, safetyObs, incidents, environmentalRecords]);

  React.useEffect(() => {
    if (zoneSummaries.length > 0 && !zoneSummaries.some((z) => z.zoneName === selectedZoneName)) {
      const flagged = zoneSummaries.find((z) => z.status !== 'safe');
      setSelectedZoneName((flagged || zoneSummaries[0]).zoneName);
    } else if (zoneSummaries.length === 0) {
      setSelectedZoneName('');
    }
  }, [zoneSummaries, selectedZoneName]);

  const activeZone = zoneSummaries.find((z) => z.zoneName === selectedZoneName) || zoneSummaries[0] || null;

  const environKpis = React.useMemo(() => {
    const activePermits = permits.filter((p) => p.status !== 'closed' && p.approvalStatus !== 'rejected').length;
    const openIncidents = incidents.filter((i) => i.status !== 'closed').length;
    const openObs = safetyObs.filter((o) => o.status !== 'closed').length;
    const latestEnv = environmentalRecords[0];
    const totalEnvLoad = environmentalRecords.reduce((acc, e) => acc + (Number(e.payload.value) || 0), 0);

    return {
      activePermits,
      openRisksCount: openIncidents + openObs,
      openIncidents,
      openObs,
      totalEnvLoad,
      envUnit: latestEnv?.payload.unit || 'units',
      envCount: environmentalRecords.length,
    };
  }, [permits, incidents, safetyObs, environmentalRecords]);

  const environTrendData = React.useMemo(() => {
    if (environmentalRecords.length === 0) return [];
    return [...environmentalRecords]
      .reverse()
      .map((rec) => ({
        period: rec.payload.reportingPeriod || rec.payload.sourceName,
        value: Number(rec.payload.value) || 0,
        unit: rec.payload.unit,
      }));
  }, [environmentalRecords]);

  const certDonutData = React.useMemo(
    () =>
      [
        { name: 'Valid', value: certBreakdown.valid, color: '#007e46' },
        { name: 'Expiring (<30d)', value: certBreakdown.expiring, color: '#d97706' },
        { name: 'Expired', value: certBreakdown.expired, color: '#e60018' },
      ].filter((d) => d.value > 0),
    [certBreakdown]
  );

  // --- OPERATIONAL FEEDS & ACTION QUEUES ---
  const nexusFeed = React.useMemo(() => {
    const entries: Array<{
      id: string;
      tag: string;
      tone: 'success' | 'warning' | 'danger' | 'neutral';
      summary: string;
      actor: string;
      time: unknown;
    }> = [];

    for (const p of productionLogs) {
      entries.push({
        id: `p_${p.id}`,
        tag: `${p.payload.achievementPercent.toFixed(0)}% ACH`,
        tone: p.payload.achievementPercent >= 90 ? 'success' : p.payload.achievementPercent >= 75 ? 'warning' : 'danger',
        summary: `${p.payload.productionLine} · ${p.payload.product} (${formatNumber(p.payload.actualQuantity)}/${formatNumber(p.payload.targetQuantity)} u)`,
        actor: p.payload.supervisor || p.createdByName,
        time: p.createdAt,
      });
    }
    for (const d of downtimeLogs) {
      entries.push({
        id: `d_${d.id}`,
        tag: `${d.payload.totalDowntimeMinutes}m DOWN`,
        tone: d.payload.resolutionStatus === 'resolved' ? 'neutral' : 'danger',
        summary: `${d.payload.productionLine} · ${d.payload.machine}: ${d.payload.reason}`,
        actor: d.payload.reportedBy || d.createdByName,
        time: d.createdAt,
      });
    }
    for (const q of qualityLogs) {
      entries.push({
        id: `q_${q.id}`,
        tag: q.payload.result === 'pass' ? 'QA PASS' : 'QA FAIL',
        tone: q.payload.result === 'pass' ? 'success' : 'danger',
        summary: `${q.payload.batchOrProduct} · ${q.payload.parameter} (${q.payload.measuredValue} ${q.payload.unit})`,
        actor: q.payload.inspector || q.createdByName,
        time: q.createdAt,
      });
    }
    return entries
      .sort((a, b) => (toDateObject(b.time)?.getTime() ?? 0) - (toDateObject(a.time)?.getTime() ?? 0))
      .slice(0, 6);
  }, [productionLogs, downtimeLogs, qualityLogs]);

  const environFeed = React.useMemo(() => {
    const entries: Array<{
      id: string;
      tag: string;
      tone: 'success' | 'warning' | 'danger' | 'neutral';
      summary: string;
      actor: string;
      time: unknown;
    }> = [];

    for (const p of permits) {
      entries.push({
        id: `ptw_${p.id}`,
        tag: p.payload.permitNumber,
        tone: p.approvalStatus === 'approved' ? 'success' : 'warning',
        summary: `${p.payload.permitType} @ ${p.payload.location} (${p.payload.contractor})`,
        actor: p.payload.responsiblePerson || p.createdByName,
        time: p.createdAt,
      });
    }
    for (const o of safetyObs) {
      entries.push({
        id: `obs_${o.id}`,
        tag: `${o.payload.riskLevel.toUpperCase()} RISK`,
        tone: o.payload.riskLevel === 'high' || o.payload.riskLevel === 'critical' ? 'danger' : 'warning',
        summary: `${o.payload.location} · ${o.payload.description}`,
        actor: o.payload.reportedBy || o.createdByName,
        time: o.createdAt,
      });
    }
    for (const i of incidents) {
      entries.push({
        id: `inc_${i.id}`,
        tag: `INCIDENT`,
        tone: 'danger',
        summary: `${i.payload.location} · ${i.payload.description}`,
        actor: i.createdByName,
        time: i.createdAt,
      });
    }
    for (const c of complianceRecords) {
      const { status } = evaluateExpiryStatus(c.payload.expiryDate, certThresholdDays);
      entries.push({
        id: `comp_${c.id}`,
        tag: status === 'valid' ? 'CERT VALID' : status === 'expiring_soon' ? 'EXPIRING' : 'EXPIRED',
        tone: status === 'valid' ? 'success' : status === 'expiring_soon' ? 'warning' : 'danger',
        summary: `${c.payload.requirement} · ${c.payload.certificationName}`,
        actor: c.payload.responsiblePerson,
        time: c.createdAt,
      });
    }
    return entries
      .sort((a, b) => (toDateObject(b.time)?.getTime() ?? 0) - (toDateObject(a.time)?.getTime() ?? 0))
      .slice(0, 6);
  }, [permits, safetyObs, incidents, complianceRecords, certThresholdDays]);

  const moduleTasks = React.useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.status === 'open' || t.status === 'in_progress') &&
          (t.payload.sourceModule === activeView || t.payload.sourceModule === 'core')
      ),
    [tasks, activeView]
  );

  const moduleApprovals = React.useMemo(
    () =>
      approvals.filter(
        (a) =>
          (a.approvalStatus === 'pending_approval' || a.approvalStatus === 'submitted') &&
          (a.payload.targetModule === activeView || a.payload.targetModule === 'core')
      ),
    [approvals, activeView]
  );

  const canCompleteTasks =
    hasPermission(activeMember, 'records.update') ||
    hasPermission(activeMember, 'nexus.write') ||
    hasPermission(activeMember, 'environ.write') ||
    hasPermission(activeMember, 'tasks.create');

  const handleCompleteTask = async (task: OperationalRecord<TaskPayload>) => {
    if (!orgId || !user || !activeMember) return;
    if (!canCompleteTasks) {
      notify({
        tone: 'warning',
        title: 'Read-only role',
        description: 'Your current role cannot modify task status.',
      });
      return;
    }
    setCompletingTaskId(task.id);
    try {
      await updateOperationalRecord({
        orgId,
        collectionName: 'tasks',
        recordId: task.id,
        siteId: task.siteId,
        actor: {
          uid: user.uid,
          displayName: activeMember.displayName || user.displayName || 'User',
          email: user.email || '',
          role: activeMember.role,
        },
        status: 'completed',
        auditSummary: `Completed task "${task.payload.title}" from Control Center`,
      });
      notify({
        tone: 'success',
        title: 'Task completed',
        description: task.payload.title,
      });
      await queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Could not update task',
        description: err instanceof Error ? err.message : 'Firestore write failed',
      });
    } finally {
      setCompletingTaskId(null);
    }
  };

  const canWriteNexus = nexusOn && hasPermission(activeMember, 'nexus.write');
  const canWriteEnviron = environOn && hasPermission(activeMember, 'environ.write');
  const canPopulateMock = canWriteNexus || canWriteEnviron;

  const handlePopulateMockData = async () => {
    if (!activeOrg || !activeMember || !user || !canPopulateMock) return;
    setPopulatingMock(true);
    try {
      const accessibleSiteIds =
        activeMember.role === 'org_admin' || activeMember.role === 'super_admin'
          ? sites.filter((s) => s.status === 'active').map((s) => s.id)
          : sites
              .filter((s) => s.status === 'active' && activeMember.siteIds.includes(s.id))
              .map((s) => s.id);
      const targetSiteIds =
        accessibleSiteIds.length > 0
          ? accessibleSiteIds
          : activeMember.siteIds.length > 0
            ? activeMember.siteIds
            : ['site_plt_01'];

      const scopedDeptIds = departments
        .filter((d) => d.status === 'active' && targetSiteIds.includes(d.siteId))
        .map((d) => d.id);

      const res = await populateMockDataForOrganisation({
        orgId: activeOrg.id,
        actor: {
          uid: user.uid,
          displayName: activeMember.displayName || user.displayName || 'Admin',
          role: activeMember.role,
        },
        siteIds: targetSiteIds,
        departmentIds: scopedDeptIds.length > 0 ? scopedDeptIds : activeMember.departmentIds,
        includeNexus: canWriteNexus,
        includeEnviron: canWriteEnviron,
      });

      if (actor) {
        await evaluateOrganisationAlerts(activeOrg, actor);
      }
      await queryClient.invalidateQueries();
      notify({
        tone: 'success',
        title: 'Mock data populated',
        description: `Added ${res.recordsCreated} operational records across ${[
          canWriteNexus ? 'Nexus' : null,
          canWriteEnviron ? 'Environ' : null,
        ]
          .filter(Boolean)
          .join(' & ')}.`,
      });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Unable to populate mock data',
        description: err instanceof Error ? err.message : 'Firestore write failed',
      });
    } finally {
      setPopulatingMock(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <EmptyState
          title="Unable to load Control Center"
          description={error instanceof Error ? error.message : 'Firestore read failed'}
          actionLabel="Retry"
          onAction={() => void refetch()}
        />
      </div>
    );
  }

  const openAlertsCount = alerts.filter((a) => a.status === 'open').length;

  return (
    <div className="space-y-5">
      {/* Control Center Header & Module Pill Switcher */}
      <div className="bg-white border border-[#d9dfe5] rounded-lg p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <p className="font-display text-[10px] tracking-[0.2em] uppercase text-[#555f69]">
            Control Center
          </p>
          <h1 className="font-heading text-xl sm:text-2xl font-semibold text-[#070e16] mt-1">
            Live module dashboards
          </h1>
          <p className="text-xs text-[#555f69] mt-0.5">
            {activeOrg?.name || 'Organisation'} · Real-time floor &amp; EHS operations
            {openAlertsCount > 0 ? ` · ${openAlertsCount} open alert${openAlertsCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Animated Pill Switcher (Nexus / Environ) */}
          {(nexusOn || environOn) && (
            <div className="inline-flex items-center p-1 rounded-full bg-[#edf2f8] border border-[#d9dfe5]">
              {nexusOn && (
                <button
                  type="button"
                  onClick={() => setActiveView('nexus')}
                  className={cn(
                    'relative px-4 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5',
                    activeView === 'nexus' ? 'text-white' : 'text-[#555f69] hover:text-[#070e16]'
                  )}
                >
                  {activeView === 'nexus' && (
                    <motion.span
                      layoutId="dashboard-module-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-[#e60018]"
                    />
                  )}
                  <Factory className="relative z-10 h-3.5 w-3.5" />
                  <span className="relative z-10">Nexus</span>
                </button>
              )}
              {environOn && (
                <button
                  type="button"
                  onClick={() => setActiveView('environ')}
                  className={cn(
                    'relative px-4 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5',
                    activeView === 'environ' ? 'text-white' : 'text-[#555f69] hover:text-[#070e16]'
                  )}
                >
                  {activeView === 'environ' && (
                    <motion.span
                      layoutId="dashboard-module-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-[#007e46]"
                    />
                  )}
                  <Leaf className="relative z-10 h-3.5 w-3.5" />
                  <span className="relative z-10">Environ</span>
                </button>
              )}
            </div>
          )}

          {/* Shift Filter (Nexus view) */}
          {activeView === 'nexus' && nexusOn && (
            <div className="inline-flex items-center rounded-md border border-[#d9dfe5] bg-[#f9fafc] p-0.5">
              {(['ALL', 'Shift A', 'Shift B', 'Shift C'] as ShiftFilter[]).map((sh) => (
                <button
                  key={sh}
                  type="button"
                  onClick={() => setShiftFilter(sh)}
                  className={cn(
                    'px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer',
                    shiftFilter === sh
                      ? 'bg-[#070e16] text-white'
                      : 'text-[#555f69] hover:text-[#070e16]'
                  )}
                >
                  {sh === 'ALL' ? 'All Shifts' : sh}
                </button>
              ))}
            </div>
          )}

          {/* Primary Workspace Actions */}
          {canPopulateMock && (
            <Button
              variant="outline"
              size="sm"
              disabled={populatingMock}
              onClick={() => void handlePopulateMockData()}
            >
              <Database className="h-3.5 w-3.5" />
              {populatingMock ? 'Populating...' : 'Populate Mock Data'}
            </Button>
          )}
          {activeView === 'nexus' && nexusOn && (
            <Button variant="nexus" size="sm" onClick={() => navigate('/nexus')}>
              Open Nexus <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {activeView === 'environ' && environOn && (
            <Button variant="environ" size="sm" onClick={() => navigate('/environ')}>
              Open Environ <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* NEXUS VIEW */}
      {activeView === 'nexus' && nexusOn && (
        <div className="space-y-5">
          {/* 4 Nexus KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#555f69]">
                    Avg Achievement
                  </span>
                  <span className="h-2 w-2 rounded-full bg-[#e60018]" />
                </div>
                <p className="text-2xl font-semibold text-[#070e16] font-mono-tabular mt-2">
                  {isLoading ? '—' : productionLogs.length > 0 ? `${nexusKpis.avgAchievement.toFixed(1)}%` : '0.0%'}
                </p>
                <p className="text-[11px] text-[#555f69] mt-1">
                  Across {lineSummaries.length} active production line{lineSummaries.length === 1 ? '' : 's'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#555f69]">
                  Units · {shiftFilter === 'ALL' ? 'All Shifts' : shiftFilter}
                </span>
                <p className="text-2xl font-semibold text-[#070e16] font-mono-tabular mt-2">
                  {isLoading ? '—' : formatNumber(nexusKpis.totalActual)}
                </p>
                <p className="text-[11px] text-[#555f69] font-mono-tabular mt-1">
                  Target {formatNumber(nexusKpis.totalTarget)} u
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#555f69]">
                  Active Downtime
                </span>
                <p
                  className={cn(
                    'text-2xl font-semibold font-mono-tabular mt-2',
                    nexusKpis.openDowntimeCount > 0 ? 'text-[#e60018]' : 'text-[#070e16]'
                  )}
                >
                  {isLoading ? '—' : formatNumber(nexusKpis.openDowntimeCount)}
                </p>
                <p className="text-[11px] text-[#555f69] font-mono-tabular mt-1">
                  {formatNumber(nexusKpis.totalDowntimeMins)} mins logged total
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#555f69]">
                  Quality Pass Rate
                </span>
                <p className="text-2xl font-semibold text-[#007e46] font-mono-tabular mt-2">
                  {isLoading ? '—' : nexusKpis.qualityTotal > 0 ? `${nexusKpis.qualityPassRate.toFixed(1)}%` : '—'}
                </p>
                <p className="text-[11px] text-[#555f69] mt-1">
                  {formatNumber(nexusKpis.qualityTotal)} inspection{nexusKpis.qualityTotal === 1 ? '' : 's'} logged
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Interactive Floor-Pulse + Line Detail Inspector */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Card className="lg:col-span-7">
              <CardHeader>
                <div>
                  <CardTitle>Floor-Pulse · Production Lines</CardTitle>
                  <CardDescription>Click a line to inspect output, downtime and quality status</CardDescription>
                </div>
                <span className="text-[11px] font-mono-tabular text-[#555f69]">
                  {lineSummaries.length} LINE{lineSummaries.length === 1 ? '' : 'S'}
                </span>
              </CardHeader>
              <CardContent className="p-3">
                {isLoading ? (
                  <TableSkeleton rows={4} />
                ) : lineSummaries.length === 0 ? (
                  <EmptyState
                    title="No production runs logged yet"
                    description="Populate realistic mock records or log a production run in Nexus to stream line throughput."
                    actionLabel={canPopulateMock ? (populatingMock ? 'Populating...' : 'Populate Mock Data') : 'Log Production Run'}
                    onAction={() =>
                      canPopulateMock ? void handlePopulateMockData() : navigate('/nexus')
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    {lineSummaries.map((line) => {
                      const isSelected = activeLine?.lineName === line.lineName;
                      const barWidth = Math.min(100, Math.max(0, line.achievementPercent));
                      return (
                        <button
                          key={line.lineName}
                          type="button"
                          onClick={() => setSelectedLineName(line.lineName)}
                          className={cn(
                            'w-full text-left rounded-md border p-3 transition-colors cursor-pointer',
                            isSelected
                              ? 'border-[#e60018] bg-[#fef2f2]/45'
                              : 'border-[#d9dfe5] bg-white hover:bg-[#f9fafc]'
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <span
                                className={cn(
                                  'h-7 w-7 rounded flex items-center justify-center shrink-0 border',
                                  line.status === 'running'
                                    ? 'bg-[#ecfdf5] border-[#a7f3d0] text-[#007e46]'
                                    : line.status === 'watch'
                                      ? 'bg-[#fffbeb] border-[#fde68a] text-[#d97706]'
                                      : 'bg-[#fef2f2] border-[#fecaca] text-[#e60018]'
                                )}
                              >
                                {line.status === 'running' ? (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                ) : line.status === 'watch' ? (
                                  <Clock className="h-3.5 w-3.5" />
                                ) : (
                                  <Wrench className="h-3.5 w-3.5" />
                                )}
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#070e16] truncate">
                                  {line.lineName}
                                </p>
                                <p className="text-[11px] text-[#555f69] truncate">
                                  {line.machine} · {line.shift}
                                </p>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <p className="text-xs font-semibold font-mono-tabular text-[#070e16]">
                                {formatNumber(line.actualQuantity)} / {formatNumber(line.targetQuantity)} u
                              </p>
                              <p
                                className={cn(
                                  'text-[11px] font-mono-tabular font-semibold',
                                  line.achievementPercent >= 90
                                    ? 'text-[#007e46]'
                                    : line.achievementPercent >= 75
                                      ? 'text-[#d97706]'
                                      : 'text-[#e60018]'
                                )}
                              >
                                {line.achievementPercent.toFixed(1)}%
                              </p>
                            </div>
                          </div>

                          <div className="mt-2.5 h-1.5 w-full rounded-full bg-[#edf2f8] overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${barWidth}%` }}
                              transition={{ duration: 0.45, ease: 'easeOut' }}
                              className={cn(
                                'h-full rounded-full',
                                line.status === 'running'
                                  ? 'bg-[#007e46]'
                                  : line.status === 'watch'
                                    ? 'bg-[#d97706]'
                                    : 'bg-[#e60018]'
                              )}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-5 flex flex-col">
              <CardHeader>
                <div>
                  <p className="font-display text-[9px] tracking-[0.18em] uppercase text-[#555f69]">
                    Line Detail
                  </p>
                  <CardTitle className="mt-0.5">
                    {activeLine ? activeLine.lineName : 'Select a Production Line'}
                  </CardTitle>
                </div>
                {activeLine && (
                  <StatusBadge
                    tone={
                      activeLine.status === 'running'
                        ? 'success'
                        : activeLine.status === 'watch'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {activeLine.status === 'running'
                      ? 'Nominal'
                      : activeLine.status === 'watch'
                        ? 'Watch'
                        : 'Fault'}
                  </StatusBadge>
                )}
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-between gap-4">
                <AnimatePresence mode="wait">
                  {activeLine ? (
                    <motion.div
                      key={activeLine.lineName}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-2 gap-2 text-xs bg-[#f9fafc] border border-[#e9eef4] rounded-md p-3">
                        <div>
                          <span className="text-[11px] text-[#555f69] block">Product</span>
                          <span className="font-semibold text-[#070e16]">{activeLine.product}</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-[#555f69] block">Supervisor</span>
                          <span className="font-semibold text-[#070e16]">{activeLine.supervisor}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="border border-[#d9dfe5] rounded-md p-2.5 bg-white">
                          <span className="text-[10px] uppercase tracking-wider text-[#555f69] block">
                            Achievement
                          </span>
                          <span className="text-base font-semibold font-mono-tabular text-[#070e16] mt-0.5 block">
                            {activeLine.achievementPercent.toFixed(1)}%
                          </span>
                        </div>
                        <div className="border border-[#d9dfe5] rounded-md p-2.5 bg-white">
                          <span className="text-[10px] uppercase tracking-wider text-[#555f69] block">
                            Output
                          </span>
                          <span className="text-base font-semibold font-mono-tabular text-[#070e16] mt-0.5 block">
                            {formatNumber(activeLine.actualQuantity)} u
                          </span>
                        </div>
                        <div className="border border-[#d9dfe5] rounded-md p-2.5 bg-white">
                          <span className="text-[10px] uppercase tracking-wider text-[#555f69] block">
                            Downtime
                          </span>
                          <span
                            className={cn(
                              'text-base font-semibold font-mono-tabular mt-0.5 block',
                              activeLine.downtimeMinutes > 0 ? 'text-[#e60018]' : 'text-[#070e16]'
                            )}
                          >
                            {activeLine.downtimeMinutes}m
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f69]">
                          Recent Line Events
                        </p>
                        {activeLine.downtimes.map((dt) => (
                          <div
                            key={dt.id}
                            className="text-xs rounded border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[#070e16]"
                          >
                            <div className="flex items-center justify-between gap-2 font-semibold text-[#e60018]">
                              <span>Downtime · {dt.payload.totalDowntimeMinutes}m</span>
                              <span className="text-[10px] uppercase">{dt.payload.resolutionStatus}</span>
                            </div>
                            <p className="text-[11px] text-[#555f69] mt-0.5">{dt.payload.reason}</p>
                          </div>
                        ))}
                        {activeLine.logs.slice(0, 2).map((pl) => (
                          <div
                            key={pl.id}
                            className="text-xs rounded border border-[#e9eef4] bg-[#f9fafc] px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-[#070e16]">
                                {pl.payload.shift} · {formatNumber(pl.payload.actualQuantity)} units
                              </span>
                              <span className="text-[11px] font-mono-tabular text-[#555f69]">
                                {pl.payload.rejectedQuantity} scrap
                              </span>
                            </div>
                            {pl.payload.remarks && (
                              <p className="text-[11px] text-[#555f69] mt-0.5">{pl.payload.remarks}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ) : (
                    <div className="text-xs text-[#555f69] py-8 text-center">
                      No line selected. Log a Nexus production run to inspect live details.
                    </div>
                  )}
                </AnimatePresence>

                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/nexus')}>
                  Open Full Nexus Workspace <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* 2 Nexus Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Achievement Trend</CardTitle>
                  <CardDescription>Target attainment percentage across logged production runs</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {nexusTrendData.length === 0 ? (
                  <EmptyState title="No trend data" description="Log production runs in Nexus to render attainment trends." />
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={nexusTrendData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                        <defs>
                          <linearGradient id="nexusAreaFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#e60018" stopOpacity={0.22} />
                            <stop offset="95%" stopColor="#e60018" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e9eef4" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#555f69' }} />
                        <YAxis domain={[0, 110]} tick={{ fontSize: 11, fill: '#555f69' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            borderColor: '#d9dfe5',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                          formatter={(val: unknown) => [`${val}%`, 'Achievement']}
                        />
                        <Area
                          type="monotone"
                          dataKey="achievement"
                          stroke="#e60018"
                          strokeWidth={2}
                          fill="url(#nexusAreaFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Output by Line · Actual vs Target</CardTitle>
                  <CardDescription>Produced units compared with shift targets</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {nexusBarData.length === 0 ? (
                  <EmptyState title="No output comparison" description="Add line runs in Nexus to compare actual vs target." />
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={nexusBarData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e9eef4" vertical={false} />
                        <XAxis dataKey="line" tick={{ fontSize: 11, fill: '#555f69' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#555f69' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            borderColor: '#d9dfe5',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                        />
                        <Bar dataKey="actual" name="Actual Units" fill="#e60018" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="target" name="Target Units" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Bottom 2-Col Action Pair: Floor Feed + Supervisor Action Queue */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Floor-Pulse · Operational Feed</CardTitle>
                  <CardDescription>Recent production, downtime &amp; metrology events</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate('/records')}>
                  All Logs <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="divide-y divide-[#e9eef4] py-1">
                {nexusFeed.length === 0 ? (
                  <div className="py-6">
                    <EmptyState
                      title="No Nexus feed events"
                      description="Production runs, downtime stops, and quality checks will stream here."
                    />
                  </div>
                ) : (
                  nexusFeed.map((item) => (
                    <div key={item.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={item.tone}>{item.tag}</StatusBadge>
                          <span className="text-[11px] text-[#555f69]">{item.actor}</span>
                        </div>
                        <p className="text-xs text-[#070e16] leading-snug">{item.summary}</p>
                      </div>
                      <span className="text-[11px] font-mono-tabular text-[#555f69] whitespace-nowrap shrink-0">
                        {formatTimestamp(item.time)}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Supervisor Action Queue</CardTitle>
                  <CardDescription>Open floor actions &amp; pending sign-offs</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate('/tasks')}>
                  Full Queue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {moduleTasks.length === 0 && moduleApprovals.length === 0 ? (
                  <EmptyState
                    title="Queue clear"
                    description="No open Nexus tasks or pending sign-offs in your current scope."
                  />
                ) : (
                  <>
                    {moduleApprovals.slice(0, 2).map((apr) => (
                      <div
                        key={apr.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-[#fde68a] bg-[#fffbeb]/60 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <StatusBadge tone="warning">Approval</StatusBadge>
                            <span className="text-[11px] text-[#555f69] truncate">
                              {apr.payload.requestedByName}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-[#070e16] truncate mt-1">
                            {apr.payload.recordTitle}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => navigate('/approvals')}>
                          Review
                        </Button>
                      </div>
                    ))}

                    {moduleTasks.slice(0, 4).map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-[#d9dfe5] bg-white px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <button
                            type="button"
                            disabled={completingTaskId === task.id}
                            onClick={() => void handleCompleteTask(task)}
                            title="Mark task completed"
                            aria-label={`Complete task ${task.payload.title}`}
                            className="mt-0.5 h-4 w-4 rounded border border-[#555f69] hover:border-[#007e46] hover:bg-[#ecfdf5] flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            {completingTaskId === task.id && <Check className="h-3 w-3 text-[#007e46]" />}
                          </button>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[#070e16] truncate">
                              {task.payload.title}
                            </p>
                            <p className="text-[11px] text-[#555f69] mt-0.5">
                              {task.payload.assignedToName} · Due {task.payload.dueDate}
                            </p>
                          </div>
                        </div>
                        <StatusBadge tone={statusToTone(task.payload.priority)}>
                          {task.payload.priority}
                        </StatusBadge>
                      </div>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ENVIRON VIEW */}
      {activeView === 'environ' && environOn && (
        <div className="space-y-5">
          {/* 4 Environ KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#555f69]">
                    Active Permits
                  </span>
                  <span className="h-2 w-2 rounded-full bg-[#007e46]" />
                </div>
                <p className="text-2xl font-semibold text-[#007e46] font-mono-tabular mt-2">
                  {isLoading ? '—' : formatNumber(environKpis.activePermits)}
                </p>
                <p className="text-[11px] text-[#555f69] mt-1">Authorized work-to-permit controls</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#555f69]">
                  Open Incidents &amp; Risks
                </span>
                <p
                  className={cn(
                    'text-2xl font-semibold font-mono-tabular mt-2',
                    environKpis.openRisksCount > 0 ? 'text-[#e60018]' : 'text-[#070e16]'
                  )}
                >
                  {isLoading ? '—' : formatNumber(environKpis.openRisksCount)}
                </p>
                <p className="text-[11px] text-[#555f69] mt-1">
                  {environKpis.openIncidents} incident{environKpis.openIncidents === 1 ? '' : 's'} ·{' '}
                  {environKpis.openObs} observation{environKpis.openObs === 1 ? '' : 's'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#555f69]">
                  Environmental Load
                </span>
                <p className="text-2xl font-semibold text-[#070e16] font-mono-tabular mt-2">
                  {isLoading ? '—' : formatNumber(environKpis.totalEnvLoad)}{' '}
                  <span className="text-xs font-normal text-[#555f69]">{environKpis.envUnit}</span>
                </p>
                <p className="text-[11px] text-[#555f69] mt-1">
                  Across {environKpis.envCount} logged period{environKpis.envCount === 1 ? '' : 's'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#555f69]">
                  Certification Health
                </span>
                <p className="text-2xl font-semibold text-[#007e46] font-mono-tabular mt-2">
                  {isLoading ? '—' : certBreakdown.total > 0 ? `${certBreakdown.healthPercent}%` : '—'}
                </p>
                <p className="text-[11px] text-[#555f69] mt-1">
                  {certBreakdown.valid} valid · {certBreakdown.expiring} expiring
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Interactive Spatial Site Layout + Zone Detail Inspector */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Card className="lg:col-span-7">
              <CardHeader>
                <div>
                  <CardTitle>Site Layout · EHS Risk &amp; Permit Zones</CardTitle>
                  <CardDescription>Click an industrial zone to inspect active permits and open risks</CardDescription>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[#555f69]">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[#007e46]" /> Safe
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[#d97706]" /> Watch
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[#e60018]" /> Risk
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                {isLoading ? (
                  <TableSkeleton rows={4} />
                ) : zoneSummaries.length === 0 ? (
                  <EmptyState
                    title="No Environ records logged yet"
                    description="Populate realistic mock data or submit a permit, safety observation, or compliance record in Environ."
                    actionLabel={canPopulateMock ? (populatingMock ? 'Populating...' : 'Populate Mock Data') : 'Open Environ'}
                    onAction={() =>
                      canPopulateMock ? void handlePopulateMockData() : navigate('/environ')
                    }
                  />
                ) : (
                  <div className="rounded-lg border border-[#d9dfe5] bg-[#f9fafc] p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {zoneSummaries.map((zone) => {
                      const isSelected = activeZone?.zoneName === zone.zoneName;
                      const riskCount = zone.openObservations.length + zone.openIncidents.length;
                      return (
                        <button
                          key={zone.zoneName}
                          type="button"
                          onClick={() => setSelectedZoneName(zone.zoneName)}
                          className={cn(
                            'rounded-md border p-3.5 text-left transition-all cursor-pointer flex flex-col justify-between min-h-[108px]',
                            zone.status === 'risk'
                              ? 'bg-[#fef2f2] border-[#fecaca]'
                              : zone.status === 'watch'
                                ? 'bg-[#fffbeb] border-[#fde68a]'
                                : 'bg-white border-[#d9dfe5]',
                            isSelected && 'ring-2 ring-[#070e16]'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#070e16]">
                              <MapPin className="h-3.5 w-3.5 text-[#555f69]" />
                              <span className="truncate">{zone.zoneName}</span>
                            </span>
                            <span
                              className={cn(
                                'h-2.5 w-2.5 rounded-full shrink-0',
                                zone.status === 'risk'
                                  ? 'bg-[#e60018]'
                                  : zone.status === 'watch'
                                    ? 'bg-[#d97706]'
                                    : 'bg-[#007e46]'
                              )}
                            />
                          </div>

                          <div className="mt-4 flex items-center justify-between text-[11px] font-mono-tabular text-[#555f69]">
                            <span>{zone.activePermits.length} PTW</span>
                            <span
                              className={cn(
                                riskCount > 0 ? 'font-semibold text-[#e60018]' : 'text-[#007e46]'
                              )}
                            >
                              {riskCount} {riskCount === 1 ? 'Risk' : 'Risks'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-5 flex flex-col">
              <CardHeader>
                <div>
                  <p className="font-display text-[9px] tracking-[0.18em] uppercase text-[#555f69]">
                    Zone Detail
                  </p>
                  <CardTitle className="mt-0.5">
                    {activeZone ? activeZone.zoneName : 'Select a Facility Zone'}
                  </CardTitle>
                </div>
                {activeZone && (
                  <StatusBadge
                    tone={
                      activeZone.status === 'safe'
                        ? 'success'
                        : activeZone.status === 'watch'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {activeZone.status === 'safe'
                      ? 'Clear'
                      : activeZone.status === 'watch'
                        ? 'Watch'
                        : 'Action Needed'}
                  </StatusBadge>
                )}
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-between gap-4">
                <AnimatePresence mode="wait">
                  {activeZone ? (
                    <motion.div
                      key={activeZone.zoneName}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-3 gap-2">
                        <div className="border border-[#d9dfe5] rounded-md p-2.5 bg-white">
                          <span className="text-[10px] uppercase tracking-wider text-[#555f69] block">
                            Permits
                          </span>
                          <span className="text-base font-semibold font-mono-tabular text-[#007e46] mt-0.5 block">
                            {activeZone.activePermits.length}
                          </span>
                        </div>
                        <div className="border border-[#d9dfe5] rounded-md p-2.5 bg-white">
                          <span className="text-[10px] uppercase tracking-wider text-[#555f69] block">
                            Open Risks
                          </span>
                          <span
                            className={cn(
                              'text-base font-semibold font-mono-tabular mt-0.5 block',
                              activeZone.openObservations.length + activeZone.openIncidents.length > 0
                                ? 'text-[#e60018]'
                                : 'text-[#070e16]'
                            )}
                          >
                            {activeZone.openObservations.length + activeZone.openIncidents.length}
                          </span>
                        </div>
                        <div className="border border-[#d9dfe5] rounded-md p-2.5 bg-white">
                          <span className="text-[10px] uppercase tracking-wider text-[#555f69] block">
                            Readings
                          </span>
                          <span className="text-base font-semibold font-mono-tabular text-[#070e16] mt-0.5 block">
                            {activeZone.envReadings.length}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f69]">
                          Active Zone Controls
                        </p>
                        {activeZone.activePermits.map((p) => (
                          <div
                            key={p.id}
                            className="text-xs rounded border border-[#a7f3d0] bg-[#ecfdf5]/70 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2 font-semibold text-[#007e46]">
                              <span className="flex items-center gap-1.5">
                                <FileCheck2 className="h-3.5 w-3.5" />
                                {p.payload.permitNumber} · {p.payload.permitType}
                              </span>
                              <span className="text-[10px] uppercase">{p.approvalStatus.replace('_', ' ')}</span>
                            </div>
                            <p className="text-[11px] text-[#555f69] mt-0.5">
                              {p.payload.contractor} · Resp: {p.payload.responsiblePerson}
                            </p>
                          </div>
                        ))}
                        {activeZone.openObservations.map((o) => (
                          <div
                            key={o.id}
                            className="text-xs rounded border border-[#fecaca] bg-[#fef2f2] px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2 font-semibold text-[#e60018]">
                              <span className="flex items-center gap-1.5">
                                <ShieldAlert className="h-3.5 w-3.5" />
                                {o.payload.category}
                              </span>
                              <span className="text-[10px] uppercase">{o.payload.riskLevel}</span>
                            </div>
                            <p className="text-[11px] text-[#555f69] mt-0.5">{o.payload.description}</p>
                          </div>
                        ))}
                        {activeZone.openIncidents.map((i) => (
                          <div
                            key={i.id}
                            className="text-xs rounded border border-[#fecaca] bg-[#fef2f2] px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2 font-semibold text-[#e60018]">
                              <span className="flex items-center gap-1.5">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Incident · {i.payload.category}
                              </span>
                              <span className="text-[10px] uppercase">{i.payload.severity}</span>
                            </div>
                            <p className="text-[11px] text-[#555f69] mt-0.5">{i.payload.description}</p>
                          </div>
                        ))}
                        {activeZone.activePermits.length === 0 &&
                          activeZone.openObservations.length === 0 &&
                          activeZone.openIncidents.length === 0 && (
                            <div className="text-xs rounded border border-[#e9eef4] bg-[#f9fafc] px-3 py-4 text-center text-[#555f69]">
                              No active permits or open hazards in {activeZone.zoneName}.
                            </div>
                          )}
                      </div>
                    </motion.div>
                  ) : (
                    <div className="text-xs text-[#555f69] py-8 text-center">
                      No zone selected.
                    </div>
                  )}
                </AnimatePresence>

                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/environ')}>
                  Open Full Environ Workspace <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* 2 Environ Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Environmental Readings Trend</CardTitle>
                  <CardDescription>Logged emissions, utility and resource measurements</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {environTrendData.length === 0 ? (
                  <EmptyState
                    title="No environmental readings"
                    description="Log utility or emissions metrics in Environ to plot trends."
                  />
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={environTrendData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                        <defs>
                          <linearGradient id="environAreaFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#007e46" stopOpacity={0.22} />
                            <stop offset="95%" stopColor="#007e46" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e9eef4" vertical={false} />
                        <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#555f69' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#555f69' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            borderColor: '#d9dfe5',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          name="Reading"
                          stroke="#007e46"
                          strokeWidth={2}
                          fill="url(#environAreaFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Certification Health</CardTitle>
                  <CardDescription>ISO &amp; regulatory compliance validity distribution</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {certDonutData.length === 0 ? (
                  <EmptyState
                    title="No compliance certificates"
                    description="Register certifications in Environ to track expiry health."
                  />
                ) : (
                  <div className="h-60 w-full flex flex-col sm:flex-row items-center justify-center gap-6">
                    <div className="h-52 w-52 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={certDonutData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={56}
                            outerRadius={84}
                            paddingAngle={3}
                          >
                            {certDonutData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#ffffff',
                              borderColor: '#d9dfe5',
                              borderRadius: '6px',
                              fontSize: '12px',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2.5 text-xs">
                      {certDonutData.map((item) => (
                        <div key={item.name} className="flex items-center justify-between gap-6">
                          <span className="flex items-center gap-2 text-[#070e16]">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: item.color }}
                            />
                            {item.name}
                          </span>
                          <span className="font-mono-tabular font-semibold text-[#070e16]">
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Bottom 2-Col Action Pair: Permit-Check Feed + EHS Lead Action Queue */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Permit-Check · Compliance Feed</CardTitle>
                  <CardDescription>Live permits, safety observations &amp; certification alerts</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate('/records')}>
                  All Logs <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="divide-y divide-[#e9eef4] py-1">
                {environFeed.length === 0 ? (
                  <div className="py-6">
                    <EmptyState
                      title="No Environ feed events"
                      description="Permits, safety observations, and certifications will appear here automatically."
                    />
                  </div>
                ) : (
                  environFeed.map((item) => (
                    <div key={item.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={item.tone}>{item.tag}</StatusBadge>
                          <span className="text-[11px] text-[#555f69]">{item.actor}</span>
                        </div>
                        <p className="text-xs text-[#070e16] leading-snug">{item.summary}</p>
                      </div>
                      <span className="text-[11px] font-mono-tabular text-[#555f69] whitespace-nowrap shrink-0">
                        {formatTimestamp(item.time)}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>EHS Lead Action Queue</CardTitle>
                  <CardDescription>Open corrective tasks &amp; pending permit approvals</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate('/tasks')}>
                  Full Queue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {moduleTasks.length === 0 && moduleApprovals.length === 0 ? (
                  <EmptyState
                    title="Queue clear"
                    description="No open EHS tasks or pending permit approvals in your current scope."
                  />
                ) : (
                  <>
                    {moduleApprovals.slice(0, 2).map((apr) => (
                      <div
                        key={apr.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-[#fde68a] bg-[#fffbeb]/60 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <StatusBadge tone="warning">Approval</StatusBadge>
                            <span className="text-[11px] text-[#555f69] truncate">
                              {apr.payload.requestedByName}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-[#070e16] truncate mt-1">
                            {apr.payload.recordTitle}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => navigate('/approvals')}>
                          Review
                        </Button>
                      </div>
                    ))}

                    {moduleTasks.slice(0, 4).map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-[#d9dfe5] bg-white px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <button
                            type="button"
                            disabled={completingTaskId === task.id}
                            onClick={() => void handleCompleteTask(task)}
                            title="Mark task completed"
                            aria-label={`Complete task ${task.payload.title}`}
                            className="mt-0.5 h-4 w-4 rounded border border-[#555f69] hover:border-[#007e46] hover:bg-[#ecfdf5] flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            {completingTaskId === task.id && <Check className="h-3 w-3 text-[#007e46]" />}
                          </button>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[#070e16] truncate">
                              {task.payload.title}
                            </p>
                            <p className="text-[11px] text-[#555f69] mt-0.5">
                              {task.payload.assignedToName} · Due {task.payload.dueDate}
                            </p>
                          </div>
                        </div>
                        <StatusBadge tone={statusToTone(task.payload.priority)}>
                          {task.payload.priority}
                        </StatusBadge>
                      </div>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Fallback when neither Nexus nor Environ is enabled */}
      {!nexusOn && !environOn && (
        <EmptyState
          title="No operational modules enabled"
          description="Enable Nexus or Environ in Organisation Settings or contact your administrator for module access."
          actionLabel="Open Organisation"
          onAction={() => navigate('/organisation')}
        />
      )}

      {/* Subtle Audit Trail Link Footer */}
      {auditLogs.length > 0 && (
        <div className="flex items-center justify-between text-[11px] text-[#555f69] px-1">
          <span>
            Latest audit event: <strong className="text-[#070e16]">{auditLogs[0].payload.summary}</strong>
          </span>
          <button
            type="button"
            onClick={() => navigate('/organisation')}
            className="text-[#070e16] font-medium hover:underline cursor-pointer shrink-0 ml-4"
          >
            View Audit Trail
          </button>
        </div>
      )}
    </div>
  );
}
