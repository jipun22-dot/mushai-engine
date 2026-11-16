import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Plus, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { canApproveModule, canWriteModule } from '../lib/permissions';
import {
  createOperationalRecord,
  listOperationalRecords,
  updateOperationalRecord,
  upsertDeduplicatedAlert,
} from '../services/firestoreService';
import {
  calculateDowntimeMinutes,
  calculateProductionMetrics,
  downtimeLogSchema,
  evaluateQualityMeasurement,
  productionLogSchema,
  qualityLogSchema,
  shiftReportSchema,
  visitorRecordSchema,
  workforceRecordSchema,
} from '../lib/validation';
import { formatNumber } from '../lib/utils';
import type {
  DowntimeLogPayload,
  OperationalRecord,
  ProductionLogPayload,
  QualityLogPayload,
  ShiftReportPayload,
  TaskPayload,
  VisitorRecordPayload,
  WorkforceRecordPayload,
} from '../types/domain';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { EmptyState, TableSkeleton } from '../components/ui/EmptyState';
import { StatusBadge, statusToTone } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { UniversalForm, type UniversalFieldDef } from '../components/forms/UniversalForm';
import { useToast } from '../components/ui/ToastProvider';

type NexusTab = 'overview' | 'production' | 'shifts' | 'downtime' | 'workforce' | 'visitors' | 'quality';

export function NexusPage() {
  const { activeOrg, activeMember, sites, departments, members, selectedSiteId, selectedDepartmentId, actor } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = React.useState<NexusTab>('overview');
  const [modalKind, setModalKind] = React.useState<Exclude<NexusTab, 'overview'> | null>(null);

  const orgId = activeOrg?.id;
  const canWrite = canWriteModule(activeMember, 'nexus');
  const canApprove = canApproveModule(activeMember, 'nexus');
  const configuredQualityParams = activeOrg?.alertThresholds?.qualityParameters || [];

  const { data, isLoading } = useQuery({
    queryKey: ['nexus', orgId, selectedSiteId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) throw new Error('No active organisation');
      const siteOpt = selectedSiteId === 'ALL' ? undefined : selectedSiteId;
      const [productionLogs, shiftReports, downtimeLogs, workforceRecords, visitorRecords, qualityLogs, tasks] =
        await Promise.all([
          listOperationalRecords<ProductionLogPayload>(orgId, 'production_logs', { siteId: siteOpt }),
          listOperationalRecords<ShiftReportPayload>(orgId, 'shift_reports', { siteId: siteOpt }),
          listOperationalRecords<DowntimeLogPayload>(orgId, 'downtime_logs', { siteId: siteOpt }),
          listOperationalRecords<WorkforceRecordPayload>(orgId, 'workforce_records', { siteId: siteOpt }),
          listOperationalRecords<VisitorRecordPayload>(orgId, 'visitor_records', { siteId: siteOpt }),
          listOperationalRecords<QualityLogPayload>(orgId, 'quality_logs', { siteId: siteOpt }),
          listOperationalRecords<TaskPayload>(orgId, 'tasks', { siteId: siteOpt }),
        ]);
      return { productionLogs, shiftReports, downtimeLogs, workforceRecords, visitorRecords, qualityLogs, tasks };
    },
  });

  const filterDept = <T,>(rows: Array<OperationalRecord<T>>): Array<OperationalRecord<T>> =>
    selectedDepartmentId === 'ALL' ? rows : rows.filter((r) => r.departmentId === selectedDepartmentId);

  const productionLogs = filterDept(data?.productionLogs || []);
  const shiftReports = filterDept(data?.shiftReports || []);
  const downtimeLogs = filterDept(data?.downtimeLogs || []);
  const workforceRecords = filterDept(data?.workforceRecords || []);
  const visitorRecords = data?.visitorRecords || [];
  const qualityLogs = filterDept(data?.qualityLogs || []);
  const nexusTasks = filterDept(data?.tasks || []).filter((t) => t.payload.sourceModule === 'nexus');

  // --- REAL CALCULATED KPIs ---
  const totalProduced = productionLogs.reduce((acc, r) => acc + (Number(r.payload.actualQuantity) || 0), 0);
  const totalTarget = productionLogs.reduce((acc, r) => acc + (Number(r.payload.targetQuantity) || 0), 0);
  const totalDowntimeMinutes = downtimeLogs.reduce((acc, r) => acc + (Number(r.payload.totalDowntimeMinutes) || 0), 0);
  const qualityPassCount = qualityLogs.filter((q) => q.payload.result === 'pass').length;
  const qualityFailCount = qualityLogs.filter((q) => q.payload.result === 'fail').length;
  const pendingShiftReports = shiftReports.filter(
    (s) => s.approvalStatus === 'submitted' || s.approvalStatus === 'pending_approval'
  ).length;
  const outstandingNexusTasks = nexusTasks.filter((t) => t.status === 'open' || t.status === 'in_progress').length;

  // Machine availability calculated strictly where shift/production + downtime exist (assumes 480 min per logged shift entry)
  const scheduledRunMinutes = productionLogs.length * 480;
  const machineAvailability =
    scheduledRunMinutes > 0
      ? Math.max(0, Math.min(100, ((scheduledRunMinutes - totalDowntimeMinutes) / scheduledRunMinutes) * 100))
      : null;

  const productionByShift = React.useMemo(() => {
    const map = new Map<string, { shift: string; actual: number; target: number }>();
    for (const log of productionLogs) {
      const shift = log.payload.shift || 'Unassigned';
      const cur = map.get(shift) || { shift, actual: 0, target: 0 };
      cur.actual += Number(log.payload.actualQuantity) || 0;
      cur.target += Number(log.payload.targetQuantity) || 0;
      map.set(shift, cur);
    }
    return Array.from(map.values());
  }, [productionLogs]);

  const productionByLine = React.useMemo(() => {
    const map = new Map<string, { line: string; actual: number; rejected: number }>();
    for (const log of productionLogs) {
      const line = log.payload.productionLine || 'Unassigned';
      const cur = map.get(line) || { line, actual: 0, rejected: 0 };
      cur.actual += Number(log.payload.actualQuantity) || 0;
      cur.rejected += Number(log.payload.rejectedQuantity) || 0;
      map.set(line, cur);
    }
    return Array.from(map.values());
  }, [productionLogs]);

  const siteName = (id: string) => sites.find((s) => s.id === id)?.code || id;

  const invalidateNexus = async () => {
    await queryClient.invalidateQueries({ queryKey: ['nexus', orgId] });
    await queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
  };

  // --- FORM DEFINITIONS ---
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowLocalStr = new Date().toISOString().slice(0, 16);

  const productionFields: UniversalFieldDef[] = [
    { name: 'productionDate', label: 'Production Date', type: 'date', required: true, defaultValue: todayStr },
    { name: 'siteId', label: 'Plant / Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'departmentId', label: 'Department', type: 'department' },
    { name: 'shift', label: 'Shift', type: 'select', required: true, defaultValue: 'Shift A', options: [
      { value: 'Shift A', label: 'Shift A (Morning)' },
      { value: 'Shift B', label: 'Shift B (Afternoon)' },
      { value: 'Shift C', label: 'Shift C (Night)' },
    ] },
    { name: 'productionLine', label: 'Production Line', type: 'text', required: true, placeholder: 'Line 1 — Stamping' },
    { name: 'machine', label: 'Machine / Equipment', type: 'text', required: true, placeholder: 'CNC-Press-04' },
    { name: 'product', label: 'Product / SKU', type: 'text', required: true, placeholder: 'Rotor Housing Rev-B' },
    { name: 'supervisor', label: 'Supervisor', type: 'user', required: true, defaultValue: actor?.displayName || '' },
    { name: 'targetQuantity', label: 'Target Quantity', type: 'number', required: true, placeholder: '1000' },
    { name: 'actualQuantity', label: 'Actual Quantity', type: 'number', required: true, placeholder: '960' },
    { name: 'rejectedQuantity', label: 'Rejected Quantity', type: 'number', required: true, defaultValue: 0 },
    { name: 'attachment', label: 'Supporting Document', type: 'file' },
    { name: 'remarks', label: 'Remarks', type: 'textarea', colSpan: 2, placeholder: 'Line speed notes or variance observations' },
  ];

  const shiftFields: UniversalFieldDef[] = [
    { name: 'date', label: 'Shift Date', type: 'date', required: true, defaultValue: todayStr },
    { name: 'shift', label: 'Shift', type: 'select', required: true, defaultValue: 'Shift A', options: [
      { value: 'Shift A', label: 'Shift A' },
      { value: 'Shift B', label: 'Shift B' },
      { value: 'Shift C', label: 'Shift C' },
    ] },
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'departmentId', label: 'Department', type: 'department', required: true },
    { name: 'supervisor', label: 'Shift Supervisor', type: 'user', required: true, defaultValue: actor?.displayName || '' },
    { name: 'productionSummary', label: 'Production Summary', type: 'textarea', required: true, colSpan: 2 },
    { name: 'issuesEncountered', label: 'Issues Encountered', type: 'textarea', colSpan: 2 },
    { name: 'pendingWork', label: 'Pending Work', type: 'textarea', colSpan: 2 },
    { name: 'handoverNotes', label: 'Handover Notes', type: 'textarea', colSpan: 2 },
  ];

  const downtimeFields: UniversalFieldDef[] = [
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'departmentId', label: 'Department', type: 'department' },
    { name: 'machine', label: 'Machine / Equipment', type: 'text', required: true, placeholder: 'Hydraulic Press #2' },
    { name: 'productionLine', label: 'Production Line', type: 'text', required: true, placeholder: 'Assembly Line B' },
    { name: 'startTime', label: 'Downtime Start', type: 'datetime', required: true, defaultValue: nowLocalStr },
    { name: 'endTime', label: 'Downtime End', type: 'datetime', required: true, defaultValue: nowLocalStr },
    { name: 'reportedBy', label: 'Reported By', type: 'user', required: true, defaultValue: actor?.displayName || '' },
    { name: 'resolutionStatus', label: 'Resolution Status', type: 'select', required: true, defaultValue: 'open', options: [
      { value: 'open', label: 'Open' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'resolved', label: 'Resolved' },
    ] },
    { name: 'reason', label: 'Root Cause / Reason', type: 'textarea', required: true, colSpan: 2 },
    { name: 'correctiveAction', label: 'Corrective Action Taken', type: 'textarea', colSpan: 2 },
  ];

  const workforceFields: UniversalFieldDef[] = [
    { name: 'date', label: 'Attendance Date', type: 'date', required: true, defaultValue: todayStr },
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'departmentId', label: 'Department', type: 'department', required: true },
    { name: 'shift', label: 'Shift', type: 'select', required: true, defaultValue: 'Shift A', options: [
      { value: 'Shift A', label: 'Shift A' },
      { value: 'Shift B', label: 'Shift B' },
      { value: 'Shift C', label: 'Shift C' },
    ] },
    { name: 'employeeName', label: 'Employee Name', type: 'text', required: true },
    { name: 'employeeId', label: 'Employee Code', type: 'text', placeholder: 'EMP-1042' },
    { name: 'attendanceStatus', label: 'Attendance Status', type: 'select', required: true, defaultValue: 'present', options: [
      { value: 'present', label: 'Present' },
      { value: 'late', label: 'Late' },
      { value: 'absent', label: 'Absent' },
      { value: 'on_leave', label: 'On Leave' },
    ] },
    { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
  ];

  const visitorFields: UniversalFieldDef[] = [
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'visitorName', label: 'Visitor Full Name', type: 'text', required: true },
    { name: 'company', label: 'Company / Organization', type: 'text', required: true },
    { name: 'personToMeet', label: 'Host / Person to Meet', type: 'user', required: true },
    { name: 'purpose', label: 'Purpose of Visit', type: 'text', required: true, colSpan: 2 },
    { name: 'entryTimestamp', label: 'Entry Time', type: 'datetime', required: true, defaultValue: nowLocalStr },
    { name: 'exitTimestamp', label: 'Exit Time (if departed)', type: 'datetime' },
  ];

  const qualityFields: UniversalFieldDef[] = [
    { name: 'inspectionDate', label: 'Inspection Date', type: 'date', required: true, defaultValue: todayStr },
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'departmentId', label: 'Department', type: 'department' },
    { name: 'batchOrProduct', label: 'Batch / Product ID', type: 'text', required: true, placeholder: 'BATCH-2026-11A' },
    {
      name: 'parameter',
      label: 'Quality Parameter',
      type: 'text',
      required: true,
      defaultValue: configuredQualityParams[0]?.parameter || 'Process Temperature',
      helperText: configuredQualityParams.length > 0
        ? `Configured templates: ${configuredQualityParams.map((p) => `${p.parameter} (${p.minLimit}–${p.maxLimit} ${p.unit})`).join(', ')}`
        : undefined,
    },
    { name: 'unit', label: 'Unit', type: 'text', required: true, defaultValue: configuredQualityParams[0]?.unit || '°C' },
    { name: 'minLimit', label: 'Lower Acceptance Limit', type: 'decimal', required: true, defaultValue: configuredQualityParams[0]?.minLimit ?? 18 },
    { name: 'maxLimit', label: 'Upper Acceptance Limit', type: 'decimal', required: true, defaultValue: configuredQualityParams[0]?.maxLimit ?? 85 },
    { name: 'measuredValue', label: 'Measured Value', type: 'decimal', required: true },
    { name: 'inspector', label: 'Inspector', type: 'user', required: true, defaultValue: actor?.displayName || '' },
    { name: 'attachment', label: 'Lab Report Attachment', type: 'file' },
    { name: 'notes', label: 'Inspection Remarks', type: 'textarea', colSpan: 2 },
  ];

  const handleMarkShiftReviewed = async (record: OperationalRecord<ShiftReportPayload>) => {
    if (!orgId || !actor) return;
    await updateOperationalRecord({
      orgId,
      collectionName: 'shift_reports',
      recordId: record.id,
      siteId: record.siteId,
      actor,
      status: 'reviewed',
      approvalStatus: 'approved',
      payload: { ...record.payload, reviewedBy: actor.displayName },
      auditSummary: `Reviewed shift handover report for ${record.payload.date} (${record.payload.shift})`,
    });
    notify({ tone: 'success', title: 'Shift Report Reviewed' });
    await invalidateNexus();
  };

  const handleLogVisitorExit = async (record: OperationalRecord<VisitorRecordPayload>) => {
    if (!orgId || !actor) return;
    const exitTs = new Date().toISOString().slice(0, 16);
    await updateOperationalRecord({
      orgId,
      collectionName: 'visitor_records',
      recordId: record.id,
      siteId: record.siteId,
      actor,
      status: 'checked_out',
      approvalStatus: 'closed',
      payload: { ...record.payload, exitTimestamp: exitTs },
      auditSummary: `Checked out visitor ${record.payload.visitorName}`,
    });
    notify({ tone: 'success', title: 'Visitor Checked Out' });
    await invalidateNexus();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        moduleAccent="nexus"
        title="Nexus — Manufacturing Operations"
        subtitle="Production execution, shift handovers, downtime analysis, workforce, gate logs & quality inspection."
        actions={
          canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="nexus" size="sm" onClick={() => setModalKind('production')}>
                <Plus className="h-3.5 w-3.5" />
                Log Production
              </Button>
              <Button variant="outline" size="sm" onClick={() => setModalKind('downtime')}>
                <Plus className="h-3.5 w-3.5" />
                Log Downtime
              </Button>
              <Button variant="outline" size="sm" onClick={() => setModalKind('quality')}>
                <Plus className="h-3.5 w-3.5" />
                Quality Inspection
              </Button>
            </div>
          )
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as NexusTab)}>
        <TabsList>
          <TabsTrigger value="overview" accent="nexus">Dashboard</TabsTrigger>
          <TabsTrigger value="production" accent="nexus">Production Logs ({productionLogs.length})</TabsTrigger>
          <TabsTrigger value="shifts" accent="nexus">Shift Reports ({shiftReports.length})</TabsTrigger>
          <TabsTrigger value="downtime" accent="nexus">Downtime ({downtimeLogs.length})</TabsTrigger>
          <TabsTrigger value="workforce" accent="nexus">Workforce ({workforceRecords.length})</TabsTrigger>
          <TabsTrigger value="visitors" accent="nexus">Gate &amp; Visitors ({visitorRecords.length})</TabsTrigger>
          <TabsTrigger value="quality" accent="nexus">Quality &amp; Lab ({qualityLogs.length})</TabsTrigger>
        </TabsList>

        {/* NEXUS DASHBOARD */}
        <TabsContent value="overview" className="space-y-5 mt-5">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Total Production</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#070e16] mt-1">
                  {formatNumber(totalProduced)}
                </p>
                <p className="text-[11px] text-[#555f69] mt-0.5">Target {formatNumber(totalTarget)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Total Downtime</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#e60018] mt-1">
                  {formatNumber(totalDowntimeMinutes)}m
                </p>
                <p className="text-[11px] text-[#555f69] mt-0.5">{downtimeLogs.length} events</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Machine Availability</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#070e16] mt-1">
                  {machineAvailability !== null ? `${machineAvailability.toFixed(1)}%` : '—'}
                </p>
                <p className="text-[11px] text-[#555f69] mt-0.5">
                  {machineAvailability !== null ? 'Calculated vs shift window' : 'Awaiting run logs'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Quality Pass / Fail</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#070e16] mt-1">
                  {qualityPassCount} / <span className={qualityFailCount > 0 ? 'text-[#e60018]' : ''}>{qualityFailCount}</span>
                </p>
                <p className="text-[11px] text-[#555f69] mt-0.5">{qualityLogs.length} inspections</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Pending Shift Reports</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#070e16] mt-1">
                  {pendingShiftReports}
                </p>
                <p className="text-[11px] text-[#555f69] mt-0.5">Awaiting review</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Operational Tasks</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#070e16] mt-1">
                  {outstandingNexusTasks}
                </p>
                <p className="text-[11px] text-[#555f69] mt-0.5">Outstanding</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Production by Shift</CardTitle>
                  <CardDescription>Actual vs target units across logged shifts</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {productionByShift.length === 0 ? (
                  <EmptyState
                    title="No shift production logged"
                    description="Create your first production log to visualize output by shift."
                    actionLabel={canWrite ? 'Log Production' : undefined}
                    onAction={canWrite ? () => setModalKind('production') : undefined}
                  />
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={productionByShift} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e9eef4" vertical={false} />
                        <XAxis dataKey="shift" tick={{ fontSize: 11, fill: '#555f69' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#555f69' }} />
                        <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#d9dfe5', fontSize: '12px' }} />
                        <Bar dataKey="target" name="Target" fill="#d9dfe5" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="actual" name="Actual" fill="#e60018" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Production by Line</CardTitle>
                  <CardDescription>Actual output and rejections per production line</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {productionByLine.length === 0 ? (
                  <EmptyState
                    title="No line metrics available"
                    description="Production line throughput appears once production logs are submitted."
                  />
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={productionByLine} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e9eef4" vertical={false} />
                        <XAxis dataKey="line" tick={{ fontSize: 11, fill: '#555f69' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#555f69' }} />
                        <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#d9dfe5', fontSize: '12px' }} />
                        <Bar dataKey="actual" name="Actual Output" fill="#070e16" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="rejected" name="Rejected" fill="#e60018" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* A. PRODUCTION LOGS */}
        <TabsContent value="production" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Production Logs</CardTitle>
                <CardDescription>Achievement &amp; rejection rates calculated deterministically from output quantities</CardDescription>
              </div>
              {canWrite && (
                <Button variant="nexus" size="sm" onClick={() => setModalKind('production')}>
                  <Plus className="h-3.5 w-3.5" /> New Production Log
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : productionLogs.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No production logs recorded"
                    description="Record shift output, machine usage, and rejections."
                    actionLabel={canWrite ? 'Log Production' : undefined}
                    onAction={canWrite ? () => setModalKind('production') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Line / Machine</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Achiev.</TableHead>
                      <TableHead className="text-right">Rej. Rate</TableHead>
                      <TableHead>Approval</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productionLogs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono-tabular">{r.payload.productionDate}</TableCell>
                        <TableCell className="text-xs font-mono-tabular">{siteName(r.siteId)}</TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{r.payload.productionLine}</div>
                          <div className="text-[#555f69]">{r.payload.machine} · {r.payload.shift}</div>
                        </TableCell>
                        <TableCell className="text-xs font-medium">{r.payload.product}</TableCell>
                        <TableCell className="text-right text-xs font-mono-tabular">{formatNumber(r.payload.targetQuantity)}</TableCell>
                        <TableCell className="text-right text-xs font-mono-tabular font-semibold">{formatNumber(r.payload.actualQuantity)}</TableCell>
                        <TableCell className="text-right text-xs font-mono-tabular">{r.payload.achievementPercent.toFixed(1)}%</TableCell>
                        <TableCell className="text-right text-xs font-mono-tabular">{r.payload.rejectionRatePercent.toFixed(2)}%</TableCell>
                        <TableCell><StatusBadge tone={statusToTone(r.approvalStatus)}>{r.approvalStatus}</StatusBadge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* B. SHIFT REPORTS */}
        <TabsContent value="shifts" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Shift Handover Reports</CardTitle>
                <CardDescription>End-of-shift operational summaries, issues, and supervisor review</CardDescription>
              </div>
              {canWrite && (
                <Button variant="nexus" size="sm" onClick={() => setModalKind('shifts')}>
                  <Plus className="h-3.5 w-3.5" /> Submit Shift Report
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : shiftReports.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No shift reports submitted"
                    description="Supervisors can log shift production summaries and handover items."
                    actionLabel={canWrite ? 'Submit Shift Report' : undefined}
                    onAction={canWrite ? () => setModalKind('shifts') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date / Shift</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Supervisor</TableHead>
                      <TableHead>Summary</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shiftReports.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono-tabular">
                          {r.payload.date} · {r.payload.shift}
                        </TableCell>
                        <TableCell className="text-xs font-mono-tabular">{siteName(r.siteId)}</TableCell>
                        <TableCell className="text-xs">{r.payload.supervisor}</TableCell>
                        <TableCell className="text-xs max-w-md truncate">{r.payload.productionSummary}</TableCell>
                        <TableCell><StatusBadge tone={statusToTone(r.approvalStatus)}>{r.approvalStatus}</StatusBadge></TableCell>
                        <TableCell className="text-right">
                          {canApprove && r.approvalStatus !== 'approved' && (
                            <Button variant="outline" size="sm" onClick={() => void handleMarkShiftReviewed(r)}>
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#007e46]" />
                              Mark Reviewed
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

        {/* C. DOWNTIME LOGS */}
        <TabsContent value="downtime" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Equipment Downtime Logs</CardTitle>
                <CardDescription>Validated timestamp duration calculation and resolution tracking</CardDescription>
              </div>
              {canWrite && (
                <Button variant="nexus" size="sm" onClick={() => setModalKind('downtime')}>
                  <Plus className="h-3.5 w-3.5" /> Log Downtime
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : downtimeLogs.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No downtime events recorded"
                    description="Log unplanned stoppages or equipment maintenance windows."
                    actionLabel={canWrite ? 'Log Downtime' : undefined}
                    onAction={canWrite ? () => setModalKind('downtime') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Machine / Line</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Window</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Resolution</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {downtimeLogs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">
                          <div className="font-medium">{r.payload.machine}</div>
                          <div className="text-[#555f69]">{r.payload.productionLine}</div>
                        </TableCell>
                        <TableCell className="text-xs font-mono-tabular">{siteName(r.siteId)}</TableCell>
                        <TableCell className="text-xs font-mono-tabular">
                          {r.payload.startTime.replace('T', ' ')} → {r.payload.endTime.replace('T', ' ')}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono-tabular font-semibold text-[#e60018]">
                          {r.payload.totalDowntimeMinutes} min
                        </TableCell>
                        <TableCell className="text-xs max-w-xs truncate">{r.payload.reason}</TableCell>
                        <TableCell>
                          <StatusBadge tone={statusToTone(r.payload.resolutionStatus)}>
                            {r.payload.resolutionStatus}
                          </StatusBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* D. WORKFORCE RECORDS */}
        <TabsContent value="workforce" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Workforce Shift &amp; Attendance Records</CardTitle>
                <CardDescription>Daily shift allocation and attendance entries</CardDescription>
              </div>
              {canWrite && (
                <Button variant="nexus" size="sm" onClick={() => setModalKind('workforce')}>
                  <Plus className="h-3.5 w-3.5" /> Record Attendance
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : workforceRecords.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No workforce records"
                    description="Log employee shift assignments and attendance."
                    actionLabel={canWrite ? 'Record Attendance' : undefined}
                    onAction={canWrite ? () => setModalKind('workforce') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date / Shift</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workforceRecords.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono-tabular">{r.payload.date} · {r.payload.shift}</TableCell>
                        <TableCell className="text-xs font-medium">
                          {r.payload.employeeName} {r.payload.employeeId ? `(${r.payload.employeeId})` : ''}
                        </TableCell>
                        <TableCell className="text-xs font-mono-tabular">{siteName(r.siteId)}</TableCell>
                        <TableCell>
                          <StatusBadge tone={statusToTone(r.payload.attendanceStatus)}>
                            {r.payload.attendanceStatus}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-xs text-[#555f69]">{r.payload.notes || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* E. GATE & VISITOR RECORDS */}
        <TabsContent value="visitors" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Gate &amp; Visitor Logbook</CardTitle>
                <CardDescription>Plant entry/exit tracking and host verification</CardDescription>
              </div>
              {canWrite && (
                <Button variant="nexus" size="sm" onClick={() => setModalKind('visitors')}>
                  <Plus className="h-3.5 w-3.5" /> Register Visitor
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : visitorRecords.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No gate entries recorded"
                    description="Register contractors, auditors, and facility visitors."
                    actionLabel={canWrite ? 'Register Visitor' : undefined}
                    onAction={canWrite ? () => setModalKind('visitors') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Visitor / Company</TableHead>
                      <TableHead>Purpose / Host</TableHead>
                      <TableHead>Entry Time</TableHead>
                      <TableHead>Exit Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visitorRecords.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">
                          <div className="font-medium">{r.payload.visitorName}</div>
                          <div className="text-[#555f69]">{r.payload.company}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{r.payload.purpose}</div>
                          <div className="text-[#555f69]">Host: {r.payload.personToMeet}</div>
                        </TableCell>
                        <TableCell className="text-xs font-mono-tabular">{r.payload.entryTimestamp.replace('T', ' ')}</TableCell>
                        <TableCell className="text-xs font-mono-tabular">
                          {r.payload.exitTimestamp ? r.payload.exitTimestamp.replace('T', ' ') : 'On Site'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={statusToTone(r.approvalStatus)}>{r.status}</StatusBadge>
                        </TableCell>
                        <TableCell className="text-right">
                          {canWrite && !r.payload.exitTimestamp && (
                            <Button variant="outline" size="sm" onClick={() => void handleLogVisitorExit(r)}>
                              <Clock className="h-3.5 w-3.5" /> Log Exit
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

        {/* F. QUALITY & LAB RECORDS */}
        <TabsContent value="quality" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Quality &amp; Laboratory Inspection Records</CardTitle>
                <CardDescription>Configurable acceptance limits with automatic out-of-range detection</CardDescription>
              </div>
              {canWrite && (
                <Button variant="nexus" size="sm" onClick={() => setModalKind('quality')}>
                  <Plus className="h-3.5 w-3.5" /> New Inspection
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : qualityLogs.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No quality inspections logged"
                    description="Submit batch parameter readings to verify acceptance limits."
                    actionLabel={canWrite ? 'New Inspection' : undefined}
                    onAction={canWrite ? () => setModalKind('quality') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Batch / Product</TableHead>
                      <TableHead>Parameter</TableHead>
                      <TableHead className="text-right">Measured</TableHead>
                      <TableHead className="text-right">Limits</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Inspector</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qualityLogs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono-tabular">{r.payload.inspectionDate}</TableCell>
                        <TableCell className="text-xs font-medium">{r.payload.batchOrProduct}</TableCell>
                        <TableCell className="text-xs">{r.payload.parameter}</TableCell>
                        <TableCell className={`text-right text-xs font-mono-tabular font-semibold ${r.payload.outOfRange ? 'text-[#e60018]' : ''}`}>
                          {r.payload.measuredValue} {r.payload.unit}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono-tabular text-[#555f69]">
                          {r.payload.minLimit}–{r.payload.maxLimit} {r.payload.unit}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={r.payload.outOfRange ? 'danger' : 'success'}>
                            {r.payload.outOfRange ? 'FAIL · OUT OF RANGE' : 'PASS'}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-xs text-[#555f69]">{r.payload.inspector}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* FORM DIALOGS */}
      <Dialog open={modalKind !== null} onOpenChange={(open) => !open && setModalKind(null)}>
        <DialogContent
          title={
            modalKind === 'production'
              ? 'Log Production Run'
              : modalKind === 'shifts'
                ? 'Submit Shift Handover Report'
                : modalKind === 'downtime'
                  ? 'Log Equipment Downtime'
                  : modalKind === 'workforce'
                    ? 'Record Workforce Attendance'
                    : modalKind === 'visitors'
                      ? 'Register Gate Visitor'
                      : 'Quality / Lab Inspection'
          }
          description="Validated against Nexus schemas and written directly to Firestore with audit history."
        >
          {modalKind === 'production' && orgId && actor && (
            <UniversalForm
              formId="nexus_production"
              orgId={orgId}
              fields={productionFields}
              schema={productionLogSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="nexus"
              renderCalculatedSummary={(vals) => {
                const m = calculateProductionMetrics(
                  Number(vals.targetQuantity),
                  Number(vals.actualQuantity),
                  Number(vals.rejectedQuantity)
                );
                return (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#555f69]">Calculated Yield Preview:</span>
                    <span className="font-mono-tabular font-semibold text-[#070e16]">
                      Achievement: {m.achievementPercent.toFixed(1)}% · Rejection Rate: {m.rejectionRatePercent.toFixed(2)}%
                    </span>
                  </div>
                );
              }}
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals, mode) => {
                const metrics = calculateProductionMetrics(
                  Number(vals.targetQuantity),
                  Number(vals.actualQuantity),
                  Number(vals.rejectedQuantity)
                );
                await createOperationalRecord<ProductionLogPayload>({
                  orgId,
                  collectionName: 'production_logs',
                  siteId: String(vals.siteId),
                  departmentId: vals.departmentId ? String(vals.departmentId) : undefined,
                  module: 'nexus',
                  recordType: 'production_log',
                  actor,
                  status: mode === 'draft' ? 'draft' : 'submitted',
                  approvalStatus: mode === 'draft' ? 'draft' : 'pending_approval',
                  requestApproval: mode === 'submit',
                  recordTitle: `${vals.product} · ${vals.productionLine}`,
                  payload: {
                    productionDate: String(vals.productionDate),
                    productionLine: String(vals.productionLine),
                    machine: String(vals.machine),
                    shift: String(vals.shift),
                    product: String(vals.product),
                    targetQuantity: Number(vals.targetQuantity) || 0,
                    actualQuantity: Number(vals.actualQuantity) || 0,
                    rejectedQuantity: Number(vals.rejectedQuantity) || 0,
                    achievementPercent: metrics.achievementPercent,
                    rejectionRatePercent: metrics.rejectionRatePercent,
                    supervisor: String(vals.supervisor),
                    remarks: String(vals.remarks || ''),
                    attachments: vals.attachment ? [String(vals.attachment)] : [],
                  },
                });
                notify({ tone: 'success', title: 'Production Log Saved' });
                setModalKind(null);
                await invalidateNexus();
              }}
            />
          )}

          {modalKind === 'shifts' && orgId && actor && (
            <UniversalForm
              formId="nexus_shift"
              orgId={orgId}
              fields={shiftFields}
              schema={shiftReportSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="nexus"
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals, mode) => {
                await createOperationalRecord<ShiftReportPayload>({
                  orgId,
                  collectionName: 'shift_reports',
                  siteId: String(vals.siteId),
                  departmentId: vals.departmentId ? String(vals.departmentId) : undefined,
                  module: 'nexus',
                  recordType: 'shift_report',
                  actor,
                  status: mode === 'draft' ? 'draft' : 'submitted',
                  approvalStatus: mode === 'draft' ? 'draft' : 'pending_approval',
                  requestApproval: mode === 'submit',
                  recordTitle: `Shift Report ${vals.date} (${vals.shift})`,
                  payload: {
                    date: String(vals.date),
                    shift: String(vals.shift),
                    supervisor: String(vals.supervisor),
                    productionSummary: String(vals.productionSummary),
                    issuesEncountered: String(vals.issuesEncountered || ''),
                    pendingWork: String(vals.pendingWork || ''),
                    handoverNotes: String(vals.handoverNotes || ''),
                  },
                });
                notify({ tone: 'success', title: 'Shift Report Saved' });
                setModalKind(null);
                await invalidateNexus();
              }}
            />
          )}

          {modalKind === 'downtime' && orgId && actor && (
            <UniversalForm
              formId="nexus_downtime"
              orgId={orgId}
              fields={downtimeFields}
              schema={downtimeLogSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="nexus"
              renderCalculatedSummary={(vals) => {
                try {
                  const mins = calculateDowntimeMinutes(String(vals.startTime), String(vals.endTime));
                  return (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#555f69]">Validated Downtime Duration:</span>
                      <span className="font-mono-tabular font-semibold text-[#e60018]">{mins} minutes</span>
                    </div>
                  );
                } catch (e) {
                  return (
                    <div className="text-xs text-[#e60018] flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {e instanceof Error ? e.message : 'Invalid timestamps'}
                    </div>
                  );
                }
              }}
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals, mode) => {
                const mins = calculateDowntimeMinutes(String(vals.startTime), String(vals.endTime));
                await createOperationalRecord<DowntimeLogPayload>({
                  orgId,
                  collectionName: 'downtime_logs',
                  siteId: String(vals.siteId),
                  departmentId: vals.departmentId ? String(vals.departmentId) : undefined,
                  module: 'nexus',
                  recordType: 'downtime_log',
                  actor,
                  status: String(vals.resolutionStatus || 'open'),
                  approvalStatus: mode === 'draft' ? 'draft' : 'submitted',
                  recordTitle: `Downtime ${vals.machine} (${mins}m)`,
                  payload: {
                    machine: String(vals.machine),
                    productionLine: String(vals.productionLine),
                    startTime: String(vals.startTime),
                    endTime: String(vals.endTime),
                    totalDowntimeMinutes: mins,
                    reason: String(vals.reason),
                    reportedBy: String(vals.reportedBy),
                    correctiveAction: String(vals.correctiveAction || ''),
                    resolutionStatus: vals.resolutionStatus as 'open' | 'in_progress' | 'resolved',
                  },
                });
                notify({ tone: 'success', title: `Downtime Logged (${mins} min)` });
                setModalKind(null);
                await invalidateNexus();
              }}
            />
          )}

          {modalKind === 'workforce' && orgId && actor && (
            <UniversalForm
              formId="nexus_workforce"
              orgId={orgId}
              fields={workforceFields}
              schema={workforceRecordSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="nexus"
              allowDraft={false}
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals) => {
                await createOperationalRecord<WorkforceRecordPayload>({
                  orgId,
                  collectionName: 'workforce_records',
                  siteId: String(vals.siteId),
                  departmentId: vals.departmentId ? String(vals.departmentId) : undefined,
                  module: 'nexus',
                  recordType: 'workforce_record',
                  actor,
                  status: String(vals.attendanceStatus),
                  approvalStatus: 'submitted',
                  payload: {
                    date: String(vals.date),
                    shift: String(vals.shift),
                    employeeName: String(vals.employeeName),
                    employeeId: String(vals.employeeId || ''),
                    attendanceStatus: vals.attendanceStatus as WorkforceRecordPayload['attendanceStatus'],
                    notes: String(vals.notes || ''),
                  },
                });
                notify({ tone: 'success', title: 'Workforce Attendance Recorded' });
                setModalKind(null);
                await invalidateNexus();
              }}
            />
          )}

          {modalKind === 'visitors' && orgId && actor && (
            <UniversalForm
              formId="nexus_visitor"
              orgId={orgId}
              fields={visitorFields}
              schema={visitorRecordSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="nexus"
              allowDraft={false}
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals) => {
                const hasExited = Boolean(vals.exitTimestamp);
                await createOperationalRecord<VisitorRecordPayload>({
                  orgId,
                  collectionName: 'visitor_records',
                  siteId: String(vals.siteId),
                  module: 'nexus',
                  recordType: 'visitor_record',
                  actor,
                  status: hasExited ? 'checked_out' : 'on_site',
                  approvalStatus: hasExited ? 'closed' : 'pending_approval',
                  requestApproval: !hasExited,
                  recordTitle: `Visitor: ${vals.visitorName} (${vals.company})`,
                  payload: {
                    visitorName: String(vals.visitorName),
                    company: String(vals.company),
                    purpose: String(vals.purpose),
                    personToMeet: String(vals.personToMeet),
                    entryTimestamp: String(vals.entryTimestamp),
                    exitTimestamp: vals.exitTimestamp ? String(vals.exitTimestamp) : undefined,
                  },
                });
                notify({ tone: 'success', title: 'Visitor Registered' });
                setModalKind(null);
                await invalidateNexus();
              }}
            />
          )}

          {modalKind === 'quality' && orgId && actor && (
            <UniversalForm
              formId="nexus_quality"
              orgId={orgId}
              fields={qualityFields}
              schema={qualityLogSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="nexus"
              renderCalculatedSummary={(vals) => {
                const mv = Number(vals.measuredValue);
                const minL = Number(vals.minLimit);
                const maxL = Number(vals.maxLimit);
                if (Number.isNaN(mv) || vals.measuredValue === '') return null;
                const evalRes = evaluateQualityMeasurement(mv, minL, maxL);
                return (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#555f69]">Automated Spec Check:</span>
                    <span className={`font-semibold ${evalRes.outOfRange ? 'text-[#e60018]' : 'text-[#007e46]'}`}>
                      {evalRes.outOfRange ? 'OUT OF RANGE (FAIL — Will flag alert)' : 'WITHIN LIMITS (PASS)'}
                    </span>
                  </div>
                );
              }}
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals, mode) => {
                const evalRes = evaluateQualityMeasurement(
                  Number(vals.measuredValue),
                  Number(vals.minLimit),
                  Number(vals.maxLimit)
                );
                const created = await createOperationalRecord<QualityLogPayload>({
                  orgId,
                  collectionName: 'quality_logs',
                  siteId: String(vals.siteId),
                  departmentId: vals.departmentId ? String(vals.departmentId) : undefined,
                  module: 'nexus',
                  recordType: 'quality_log',
                  actor,
                  status: evalRes.result,
                  approvalStatus: mode === 'draft' ? 'draft' : evalRes.outOfRange ? 'pending_approval' : 'submitted',
                  requestApproval: evalRes.outOfRange && mode === 'submit',
                  recordTitle: `${vals.batchOrProduct} · ${vals.parameter}`,
                  payload: {
                    inspectionDate: String(vals.inspectionDate),
                    batchOrProduct: String(vals.batchOrProduct),
                    parameter: String(vals.parameter),
                    measuredValue: Number(vals.measuredValue),
                    unit: String(vals.unit),
                    minLimit: Number(vals.minLimit),
                    maxLimit: Number(vals.maxLimit),
                    outOfRange: evalRes.outOfRange,
                    result: evalRes.result,
                    inspector: String(vals.inspector),
                    attachments: vals.attachment ? [String(vals.attachment)] : [],
                    notes: String(vals.notes || ''),
                  },
                });
                if (evalRes.outOfRange) {
                  await upsertDeduplicatedAlert({
                    orgId,
                    siteId: String(vals.siteId),
                    actor,
                    alert: {
                      severity: 'warning',
                      category: 'quality_out_of_range',
                      title: `Out-of-Range Quality Spec: ${vals.parameter}`,
                      message: `Batch ${vals.batchOrProduct} measured ${vals.measuredValue} ${vals.unit} (limits ${vals.minLimit}–${vals.maxLimit}).`,
                      targetCollection: 'quality_logs',
                      targetId: created.id,
                    },
                  });
                }
                notify({
                  tone: evalRes.outOfRange ? 'warning' : 'success',
                  title: evalRes.outOfRange ? 'Quality Logged — Out-of-Range Flagged' : 'Quality Inspection Saved',
                });
                setModalKind(null);
                await invalidateNexus();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
