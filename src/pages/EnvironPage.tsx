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
import { Plus, CheckCircle2, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { canApproveModule, canWriteModule } from '../lib/permissions';
import {
  createOperationalRecord,
  listOperationalRecords,
  updateOperationalRecord,
  upsertDeduplicatedAlert,
} from '../services/firestoreService';
import {
  complianceRecordSchema,
  correctiveActionSchema,
  environmentalRecordSchema,
  evaluateExpiryStatus,
  incidentSchema,
  safetyObservationSchema,
  workPermitSchema,
} from '../lib/validation';
import { formatNumber } from '../lib/utils';
import type {
  ComplianceRecordPayload,
  CorrectiveActionPayload,
  EnvironmentalRecordPayload,
  IncidentPayload,
  OperationalRecord,
  SafetyObservationPayload,
  WorkPermitPayload,
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

type EnvironTab = 'overview' | 'observations' | 'incidents' | 'permits' | 'compliance' | 'environmental' | 'capa';

export function EnvironPage() {
  const { activeOrg, activeMember, sites, departments, members, selectedSiteId, selectedDepartmentId, actor } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = React.useState<EnvironTab>('overview');
  const [modalKind, setModalKind] = React.useState<Exclude<EnvironTab, 'overview'> | null>(null);
  const [selectedIncident, setSelectedIncident] = React.useState<OperationalRecord<IncidentPayload> | null>(null);
  const [incidentNote, setIncidentNote] = React.useState('');

  const orgId = activeOrg?.id;
  const canWrite = canWriteModule(activeMember, 'environ');
  const canApprove = canApproveModule(activeMember, 'environ');
  const certThresholdDays = activeOrg?.alertThresholds?.certificationExpiryDays ?? 30;
  const configuredPermitTypes = activeOrg?.alertThresholds?.permitTypes || [
    'Hot Work',
    'Confined Space',
    'Electrical Work',
    'Work at Height',
  ];

  const { data, isLoading } = useQuery({
    queryKey: ['environ', orgId, selectedSiteId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) throw new Error('No active organisation');
      const siteOpt = selectedSiteId === 'ALL' ? undefined : selectedSiteId;
      const [observations, incidents, permits, compliance, environmental, capas] = await Promise.all([
        listOperationalRecords<SafetyObservationPayload>(orgId, 'safety_observations', { siteId: siteOpt }),
        listOperationalRecords<IncidentPayload>(orgId, 'incidents', { siteId: siteOpt }),
        listOperationalRecords<WorkPermitPayload>(orgId, 'work_permits', { siteId: siteOpt }),
        listOperationalRecords<ComplianceRecordPayload>(orgId, 'compliance_records', { siteId: siteOpt }),
        listOperationalRecords<EnvironmentalRecordPayload>(orgId, 'environmental_records', { siteId: siteOpt }),
        listOperationalRecords<CorrectiveActionPayload>(orgId, 'corrective_actions', { siteId: siteOpt }),
      ]);
      return { observations, incidents, permits, compliance, environmental, capas };
    },
  });

  const filterDept = <T,>(rows: Array<OperationalRecord<T>>): Array<OperationalRecord<T>> =>
    selectedDepartmentId === 'ALL' ? rows : rows.filter((r) => r.departmentId === selectedDepartmentId);

  const observations = filterDept(data?.observations || []);
  const incidents = filterDept(data?.incidents || []);
  const permits = data?.permits || [];
  const compliance = data?.compliance || [];
  const environmental = filterDept(data?.environmental || []);
  const capas = data?.capas || [];

  const openCapas = capas.filter((c) => c.status !== 'closed').length;
  const activePermits = permits.filter((p) => p.status !== 'closed' && p.approvalStatus !== 'rejected').length;
  const expiringOrExpiredCerts = compliance.filter(
    (c) => evaluateExpiryStatus(c.payload.expiryDate, certThresholdDays).status !== 'valid'
  ).length;
  const validCertsCount = compliance.length - expiringOrExpiredCerts;

  const observationsByRisk = React.useMemo(() => {
    const counts = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const o of observations) {
      counts[o.payload.riskLevel] = (counts[o.payload.riskLevel] || 0) + 1;
    }
    return [
      { risk: 'Low', count: counts.low },
      { risk: 'Medium', count: counts.medium },
      { risk: 'High', count: counts.high },
      { risk: 'Critical', count: counts.critical },
    ];
  }, [observations]);

  const environmentalSummary = React.useMemo(() => {
    const grouped = new Map<string, { metric: string; total: number; unit: string }>();
    for (const rec of environmental) {
      const key = `${rec.payload.metricType}__${rec.payload.unit}`;
      const existing = grouped.get(key) || {
        metric: rec.payload.metricType.replace(/_/g, ' '),
        total: 0,
        unit: rec.payload.unit,
      };
      existing.total += Number(rec.payload.value) || 0;
      grouped.set(key, existing);
    }
    return Array.from(grouped.values());
  }, [environmental]);

  const siteName = (id: string) => sites.find((s) => s.id === id)?.code || id;

  const invalidateEnviron = async () => {
    await queryClient.invalidateQueries({ queryKey: ['environ', orgId] });
    await queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const nowLocalStr = new Date().toISOString().slice(0, 16);

  const observationFields: UniversalFieldDef[] = [
    { name: 'observationDate', label: 'Observation Date', type: 'date', required: true, defaultValue: todayStr },
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'departmentId', label: 'Department', type: 'department', required: true },
    { name: 'location', label: 'Exact Area / Location', type: 'text', required: true, placeholder: 'Boiler Bay 2' },
    { name: 'category', label: 'Category', type: 'select', required: true, defaultValue: 'Unsafe Condition', options: [
      { value: 'Unsafe Condition', label: 'Unsafe Condition' },
      { value: 'Unsafe Act', label: 'Unsafe Act' },
      { value: 'PPE Non-Compliance', label: 'PPE Non-Compliance' },
      { value: 'Housekeeping', label: 'Housekeeping' },
      { value: 'Positive Observation', label: 'Positive Observation' },
    ] },
    { name: 'riskLevel', label: 'Risk Level', type: 'select', required: true, defaultValue: 'medium', options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'critical', label: 'Critical' },
    ] },
    { name: 'reportedBy', label: 'Reported By', type: 'user', required: true, defaultValue: actor?.displayName || '' },
    { name: 'assignedPerson', label: 'Assigned Owner', type: 'user' },
    { name: 'supportingImage', label: 'Supporting Image / File', type: 'file' },
    { name: 'description', label: 'Observation Description', type: 'textarea', required: true, colSpan: 2 },
    { name: 'correctiveAction', label: 'Immediate / Corrective Action', type: 'textarea', colSpan: 2 },
  ];

  const incidentFields: UniversalFieldDef[] = [
    { name: 'incidentDateTime', label: 'Incident Date & Time', type: 'datetime', required: true, defaultValue: nowLocalStr },
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'departmentId', label: 'Department', type: 'department', required: true },
    { name: 'location', label: 'Location', type: 'text', required: true },
    { name: 'category', label: 'Incident Category', type: 'select', required: true, defaultValue: 'Near Miss', options: [
      { value: 'Near Miss', label: 'Near Miss' },
      { value: 'First Aid', label: 'First Aid Case' },
      { value: 'Medical Treatment', label: 'Medical Treatment' },
      { value: 'Lost Time Injury', label: 'Lost Time Injury (LTI)' },
      { value: 'Spill / Release', label: 'Chemical / Oil Spill' },
      { value: 'Fire / Electrical', label: 'Fire / Electrical' },
    ] },
    { name: 'severity', label: 'Severity', type: 'select', required: true, defaultValue: 'minor', options: [
      { value: 'minor', label: 'Minor' },
      { value: 'moderate', label: 'Moderate' },
      { value: 'major', label: 'Major' },
      { value: 'critical', label: 'Critical' },
    ] },
    { name: 'peopleInvolved', label: 'People Involved (Authorised Summary)', type: 'text', colSpan: 2 },
    { name: 'description', label: 'Incident Description', type: 'textarea', required: true, colSpan: 2 },
    { name: 'immediateAction', label: 'Immediate Containment Action', type: 'textarea', required: true, colSpan: 2 },
    { name: 'investigationDetails', label: 'Investigation Findings', type: 'textarea', colSpan: 2 },
    { name: 'correctiveActions', label: 'Recommended Corrective Actions', type: 'textarea', colSpan: 2 },
    { name: 'supportingFile', label: 'Evidence Attachment', type: 'file' },
  ];

  const permitFields: UniversalFieldDef[] = [
    { name: 'permitNumber', label: 'Permit Number', type: 'text', required: true, defaultValue: `PTW-${new Date().getFullYear()}-${String(permits.length + 1).padStart(3, '0')}` },
    { name: 'permitType', label: 'Permit Type', type: 'select', required: true, defaultValue: configuredPermitTypes[0], options: configuredPermitTypes.map((t) => ({ value: t, label: t })) },
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'location', label: 'Work Location', type: 'text', required: true },
    { name: 'contractor', label: 'Contractor / Executing Team', type: 'text', required: true },
    { name: 'responsiblePerson', label: 'Responsible Person', type: 'user', required: true, defaultValue: actor?.displayName || '' },
    { name: 'startDateTime', label: 'Valid From', type: 'datetime', required: true, defaultValue: nowLocalStr },
    { name: 'endDateTime', label: 'Valid Until', type: 'datetime', required: true, defaultValue: nowLocalStr },
    { name: 'hazards', label: 'Identified Hazards', type: 'textarea', required: true, colSpan: 2 },
    { name: 'precautions', label: 'Required Safety Precautions & Isolations', type: 'textarea', required: true, colSpan: 2 },
  ];

  const complianceFields: UniversalFieldDef[] = [
    { name: 'requirement', label: 'Regulatory Requirement / Standard', type: 'text', required: true, placeholder: 'ISO 45001 / Factory License' },
    { name: 'certificationName', label: 'Certification Name', type: 'text', required: true },
    { name: 'issuingAuthority', label: 'Issuing Authority', type: 'text', required: true },
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'issueDate', label: 'Issue Date', type: 'date', required: true, defaultValue: todayStr },
    { name: 'expiryDate', label: 'Expiry Date', type: 'date', required: true },
    { name: 'responsiblePerson', label: 'Responsible Owner', type: 'user', required: true, defaultValue: actor?.displayName || '' },
    { name: 'supportingDocument', label: 'Certificate Document', type: 'file' },
  ];

  const environmentalFields: UniversalFieldDef[] = [
    { name: 'metricType', label: 'Environmental Category', type: 'select', required: true, defaultValue: 'electricity_consumption', options: [
      { value: 'water_consumption', label: 'Water Consumption' },
      { value: 'electricity_consumption', label: 'Electricity Consumption' },
      { value: 'fuel_consumption', label: 'Fuel Consumption' },
      { value: 'waste_generation', label: 'Waste Generation' },
      { value: 'emissions_data', label: 'Emissions Data (Metered/Measured)' },
      { value: 'environmental_inspection', label: 'Environmental Inspection' },
    ] },
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'departmentId', label: 'Department', type: 'department' },
    { name: 'reportingPeriod', label: 'Reporting Period', type: 'text', required: true, defaultValue: todayStr.slice(0, 7), placeholder: '2026-11' },
    { name: 'sourceName', label: 'Meter / Utility / Stream Source', type: 'text', required: true, placeholder: 'Main Substation Meter M-01' },
    { name: 'value', label: 'Measured Value', type: 'decimal', required: true },
    { name: 'unit', label: 'Unit', type: 'text', required: true, placeholder: 'kWh / m3 / kg / tonnes' },
    { name: 'methodologyNote', label: 'Configured Methodology / Source Reference', type: 'text', colSpan: 2, placeholder: 'Utility invoice or calibrated flowmeter reading' },
    { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
  ];

  const capaFields: UniversalFieldDef[] = [
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'priority', label: 'Priority', type: 'select', required: true, defaultValue: 'high', options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'critical', label: 'Critical' },
    ] },
    { name: 'assignedOwner', label: 'Assigned Owner', type: 'user', required: true },
    { name: 'dueDate', label: 'Due Date', type: 'date', required: true },
    { name: 'relatedRecordType', label: 'Linked Source Type (Optional)', type: 'text', placeholder: 'incident / observation' },
    { name: 'relatedRecordId', label: 'Linked Record ID (Optional)', type: 'text' },
    { name: 'finding', label: 'Finding / Non-Conformance', type: 'textarea', required: true, colSpan: 2 },
    { name: 'actionPlan', label: 'Corrective & Preventive Action Plan', type: 'textarea', required: true, colSpan: 2 },
    { name: 'evidence', label: 'Evidence Attachment', type: 'file' },
  ];

  const handleClosePermit = async (permit: OperationalRecord<WorkPermitPayload>) => {
    if (!orgId || !actor) return;
    await updateOperationalRecord({
      orgId,
      collectionName: 'work_permits',
      recordId: permit.id,
      siteId: permit.siteId,
      actor,
      status: 'closed',
      approvalStatus: 'closed',
      payload: { ...permit.payload, closureNotes: `Closed by ${actor.displayName}` },
      auditSummary: `Closed Work Permit ${permit.payload.permitNumber}`,
    });
    notify({ tone: 'success', title: `Permit ${permit.payload.permitNumber} Closed` });
    await invalidateEnviron();
  };

  const handleVerifyCapa = async (capa: OperationalRecord<CorrectiveActionPayload>) => {
    if (!orgId || !actor) return;
    await updateOperationalRecord({
      orgId,
      collectionName: 'corrective_actions',
      recordId: capa.id,
      siteId: capa.siteId,
      actor,
      status: 'closed',
      approvalStatus: 'closed',
      payload: { ...capa.payload, verificationNotes: `Verified & closed by ${actor.displayName}` },
      auditSummary: `Verified & closed CAPA ${capa.id}`,
    });
    notify({ tone: 'success', title: 'Corrective Action Verified & Closed' });
    await invalidateEnviron();
  };

  const handleAppendIncidentHistory = async () => {
    if (!orgId || !actor || !selectedIncident || !incidentNote.trim()) return;
    const nextHistory = [
      ...(selectedIncident.payload.history || []),
      { timestamp: new Date().toISOString(), actor: actor.displayName, note: incidentNote.trim() },
    ];
    await updateOperationalRecord({
      orgId,
      collectionName: 'incidents',
      recordId: selectedIncident.id,
      siteId: selectedIncident.siteId,
      actor,
      status: selectedIncident.status,
      approvalStatus: selectedIncident.approvalStatus,
      payload: { ...selectedIncident.payload, history: nextHistory },
      auditSummary: `Added investigation entry on incident ${selectedIncident.id}`,
    });
    setIncidentNote('');
    setSelectedIncident(null);
    notify({ tone: 'success', title: 'Incident History Updated' });
    await invalidateEnviron();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        moduleAccent="environ"
        title="Environ — EHS & Sustainability"
        subtitle="Safety observations, incident investigation, permit-to-work, compliance certifications & environmental telemetry."
        actions={
          canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="environ" size="sm" onClick={() => setModalKind('observations')}>
                <Plus className="h-3.5 w-3.5" /> Safety Observation
              </Button>
              <Button variant="outline" size="sm" onClick={() => setModalKind('incidents')}>
                <Plus className="h-3.5 w-3.5" /> Report Incident
              </Button>
              <Button variant="outline" size="sm" onClick={() => setModalKind('permits')}>
                <Plus className="h-3.5 w-3.5" /> Issue Permit
              </Button>
            </div>
          )
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as EnvironTab)}>
        <TabsList>
          <TabsTrigger value="overview" accent="environ">Dashboard</TabsTrigger>
          <TabsTrigger value="observations" accent="environ">Observations ({observations.length})</TabsTrigger>
          <TabsTrigger value="incidents" accent="environ">Incidents ({incidents.length})</TabsTrigger>
          <TabsTrigger value="permits" accent="environ">Permit-to-Work ({permits.length})</TabsTrigger>
          <TabsTrigger value="compliance" accent="environ">Compliance ({compliance.length})</TabsTrigger>
          <TabsTrigger value="environmental" accent="environ">Environmental ({environmental.length})</TabsTrigger>
          <TabsTrigger value="capa" accent="environ">CAPA ({capas.length})</TabsTrigger>
        </TabsList>

        {/* ENVIRON DASHBOARD */}
        <TabsContent value="overview" className="space-y-5 mt-5">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Safety Observations</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#070e16] mt-1">{observations.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Reported Incidents</p>
                <p className={`text-xl font-semibold font-mono-tabular mt-1 ${incidents.length > 0 ? 'text-[#e60018]' : 'text-[#070e16]'}`}>
                  {incidents.length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Open CAPA</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#070e16] mt-1">{openCapas}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Active Permits</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#007e46] mt-1">{activePermits}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Expiring Certs</p>
                <p className={`text-xl font-semibold font-mono-tabular mt-1 ${expiringOrExpiredCerts > 0 ? 'text-[#d97706]' : 'text-[#070e16]'}`}>
                  {expiringOrExpiredCerts}
                </p>
                <p className="text-[11px] text-[#555f69] mt-0.5">&le; {certThresholdDays}d window</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[11px] text-[#555f69]">Compliance Status</p>
                <p className="text-xl font-semibold font-mono-tabular text-[#007e46] mt-1">
                  {compliance.length > 0 ? `${validCertsCount}/${compliance.length}` : '—'}
                </p>
                <p className="text-[11px] text-[#555f69] mt-0.5">Active valid certs</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Safety Observations by Risk Level</CardTitle>
                  <CardDescription>Distribution across low, medium, high &amp; critical findings</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {observations.length === 0 ? (
                  <EmptyState
                    title="No safety observations recorded"
                    description="Log proactive hazard observations across plant zones."
                    actionLabel={canWrite ? 'Log Observation' : undefined}
                    onAction={canWrite ? () => setModalKind('observations') : undefined}
                  />
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={observationsByRisk} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e9eef4" vertical={false} />
                        <XAxis dataKey="risk" tick={{ fontSize: 11, fill: '#555f69' }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#555f69' }} />
                        <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#d9dfe5', fontSize: '12px' }} />
                        <Bar dataKey="count" name="Observations" fill="#007e46" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Environmental Resource Totals</CardTitle>
                  <CardDescription>Metered &amp; logged values grouped by metric and unit (unadjusted source data)</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {environmentalSummary.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      title="No environmental records"
                      description="Record water, electricity, fuel, waste, or metered emissions data."
                      actionLabel={canWrite ? 'Log Environmental Data' : undefined}
                      onAction={canWrite ? () => setModalKind('environmental') : undefined}
                    />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead className="text-right">Logged Total</TableHead>
                        <TableHead>Unit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {environmentalSummary.map((row) => (
                        <TableRow key={`${row.metric}_${row.unit}`}>
                          <TableCell className="text-xs font-medium capitalize">{row.metric}</TableCell>
                          <TableCell className="text-right text-xs font-mono-tabular font-semibold">
                            {formatNumber(row.total, 2)}
                          </TableCell>
                          <TableCell className="text-xs font-mono-tabular text-[#555f69]">{row.unit}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* A. SAFETY OBSERVATIONS */}
        <TabsContent value="observations" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Safety Observations</CardTitle>
                <CardDescription>Proactive hazard identification and field corrective tracking</CardDescription>
              </div>
              {canWrite && (
                <Button variant="environ" size="sm" onClick={() => setModalKind('observations')}>
                  <Plus className="h-3.5 w-3.5" /> New Observation
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : observations.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No safety observations"
                    description="Record unsafe conditions, acts, or positive safety behaviors."
                    actionLabel={canWrite ? 'New Observation' : undefined}
                    onAction={canWrite ? () => setModalKind('observations') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Site / Location</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {observations.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono-tabular">{r.payload.observationDate}</TableCell>
                        <TableCell className="text-xs">
                          <span className="font-mono-tabular font-medium">{siteName(r.siteId)}</span> · {r.payload.location}
                        </TableCell>
                        <TableCell className="text-xs">{r.payload.category}</TableCell>
                        <TableCell><StatusBadge tone={statusToTone(r.payload.riskLevel)}>{r.payload.riskLevel}</StatusBadge></TableCell>
                        <TableCell className="text-xs max-w-md truncate">{r.payload.description}</TableCell>
                        <TableCell><StatusBadge tone={statusToTone(r.status)}>{r.status}</StatusBadge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* B. INCIDENT REPORTING */}
        <TabsContent value="incidents" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Incident Reports &amp; Investigation History</CardTitle>
                <CardDescription>Traceable EHS incident logs, immediate containment &amp; investigation notes</CardDescription>
              </div>
              {canWrite && (
                <Button variant="environ" size="sm" onClick={() => setModalKind('incidents')}>
                  <Plus className="h-3.5 w-3.5" /> Report Incident
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : incidents.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No incidents reported"
                    description="All safety incidents and near misses with investigation timelines appear here."
                    actionLabel={canWrite ? 'Report Incident' : undefined}
                    onAction={canWrite ? () => setModalKind('incidents') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date / Time</TableHead>
                      <TableHead>Site / Location</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Timeline</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {incidents.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono-tabular">{r.payload.incidentDateTime.replace('T', ' ')}</TableCell>
                        <TableCell className="text-xs">{siteName(r.siteId)} · {r.payload.location}</TableCell>
                        <TableCell className="text-xs font-medium">{r.payload.category}</TableCell>
                        <TableCell><StatusBadge tone={statusToTone(r.payload.severity)}>{r.payload.severity}</StatusBadge></TableCell>
                        <TableCell className="text-xs max-w-xs truncate">{r.payload.description}</TableCell>
                        <TableCell><StatusBadge tone={statusToTone(r.approvalStatus)}>{r.approvalStatus}</StatusBadge></TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setSelectedIncident(r)}>
                            History ({r.payload.history?.length || 1})
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* C. PERMIT TO WORK */}
        <TabsContent value="permits" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Permit-to-Work Register</CardTitle>
                <CardDescription>Controlled hazardous work authorizations with validity windows</CardDescription>
              </div>
              {canWrite && (
                <Button variant="environ" size="sm" onClick={() => setModalKind('permits')}>
                  <Plus className="h-3.5 w-3.5" /> Issue Permit
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : permits.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No work permits issued"
                    description="Issue Hot Work, Confined Space, Electrical, or Height permits."
                    actionLabel={canWrite ? 'Issue Permit' : undefined}
                    onAction={canWrite ? () => setModalKind('permits') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Permit #</TableHead>
                      <TableHead>Type / Location</TableHead>
                      <TableHead>Contractor</TableHead>
                      <TableHead>Validity Window</TableHead>
                      <TableHead>Approval</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {permits.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono-tabular font-semibold">{r.payload.permitNumber}</TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{r.payload.permitType}</div>
                          <div className="text-[#555f69]">{siteName(r.siteId)} · {r.payload.location}</div>
                        </TableCell>
                        <TableCell className="text-xs">{r.payload.contractor}</TableCell>
                        <TableCell className="text-xs font-mono-tabular">
                          {r.payload.startDateTime.replace('T', ' ')} → {r.payload.endDateTime.replace('T', ' ')}
                        </TableCell>
                        <TableCell><StatusBadge tone={statusToTone(r.approvalStatus)}>{r.approvalStatus}</StatusBadge></TableCell>
                        <TableCell className="text-right">
                          {canApprove && r.approvalStatus !== 'closed' && (
                            <Button variant="outline" size="sm" onClick={() => void handleClosePermit(r)}>
                              <Lock className="h-3.5 w-3.5" /> Close Permit
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

        {/* D. COMPLIANCE & CERTIFICATION */}
        <TabsContent value="compliance" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Compliance &amp; Certification Registry</CardTitle>
                <CardDescription>Advance expiry alerts triggered at {certThresholdDays} days prior to expiration</CardDescription>
              </div>
              {canWrite && (
                <Button variant="environ" size="sm" onClick={() => setModalKind('compliance')}>
                  <Plus className="h-3.5 w-3.5" /> Add Certification
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : compliance.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No compliance certificates tracked"
                    description="Add ISO, environmental, or statutory licenses to monitor renewal dates."
                    actionLabel={canWrite ? 'Add Certification' : undefined}
                    onAction={canWrite ? () => setModalKind('compliance') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Certification / Requirement</TableHead>
                      <TableHead>Authority</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Owner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compliance.map((r) => {
                      const evalRes = evaluateExpiryStatus(r.payload.expiryDate, certThresholdDays);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">
                            <div className="font-medium">{r.payload.certificationName}</div>
                            <div className="text-[#555f69]">{r.payload.requirement}</div>
                          </TableCell>
                          <TableCell className="text-xs">{r.payload.issuingAuthority}</TableCell>
                          <TableCell className="text-xs font-mono-tabular">{siteName(r.siteId)}</TableCell>
                          <TableCell className="text-xs font-mono-tabular">
                            {r.payload.expiryDate} ({evalRes.daysRemaining}d)
                          </TableCell>
                          <TableCell>
                            <StatusBadge tone={statusToTone(evalRes.status)}>
                              {evalRes.status === 'valid' ? 'Valid' : evalRes.status === 'expiring_soon' ? 'Expiring Soon' : 'Expired'}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-xs">{r.payload.responsiblePerson}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* E. ENVIRONMENTAL RECORDS */}
        <TabsContent value="environmental" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Environmental Resource &amp; Inspection Logs</CardTitle>
                <CardDescription>Water, electricity, fuel, waste &amp; metered emissions data with explicit units and sources</CardDescription>
              </div>
              {canWrite && (
                <Button variant="environ" size="sm" onClick={() => setModalKind('environmental')}>
                  <Plus className="h-3.5 w-3.5" /> Log Environmental Entry
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : environmental.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No environmental logs"
                    description="Track utility consumption, waste manifests, and inspections."
                    actionLabel={canWrite ? 'Log Environmental Entry' : undefined}
                    onAction={canWrite ? () => setModalKind('environmental') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Source / Meter</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Methodology</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {environmental.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono-tabular">{r.payload.reportingPeriod}</TableCell>
                        <TableCell className="text-xs font-medium capitalize">{r.payload.metricType.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-xs">{r.payload.sourceName}</TableCell>
                        <TableCell className="text-xs font-mono-tabular">{siteName(r.siteId)}</TableCell>
                        <TableCell className="text-right text-xs font-mono-tabular font-semibold">
                          {formatNumber(r.payload.value, 2)} {r.payload.unit}
                        </TableCell>
                        <TableCell className="text-xs text-[#555f69] max-w-xs truncate">
                          {r.payload.methodologyNote || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* F. CORRECTIVE ACTION MANAGEMENT */}
        <TabsContent value="capa" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Corrective &amp; Preventive Actions (CAPA)</CardTitle>
                <CardDescription>Action plans, ownership, due dates &amp; EHS verification</CardDescription>
              </div>
              {canWrite && (
                <Button variant="environ" size="sm" onClick={() => setModalKind('capa')}>
                  <Plus className="h-3.5 w-3.5" /> New CAPA
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : capas.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No corrective actions open"
                    description="Create CAPA records linked to incidents, observations, or audits."
                    actionLabel={canWrite ? 'New CAPA' : undefined}
                    onAction={canWrite ? () => setModalKind('capa') : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Finding</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {capas.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs max-w-md truncate font-medium">{r.payload.finding}</TableCell>
                        <TableCell className="text-xs">{r.payload.assignedOwner}</TableCell>
                        <TableCell className="text-xs font-mono-tabular">{r.payload.dueDate}</TableCell>
                        <TableCell><StatusBadge tone={statusToTone(r.payload.priority)}>{r.payload.priority}</StatusBadge></TableCell>
                        <TableCell><StatusBadge tone={statusToTone(r.status)}>{r.status}</StatusBadge></TableCell>
                        <TableCell className="text-right">
                          {canApprove && r.status !== 'closed' && (
                            <Button variant="outline" size="sm" onClick={() => void handleVerifyCapa(r)}>
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#007e46]" />
                              Verify &amp; Close
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
      </Tabs>

      {/* ENVIRON FORM DIALOGS */}
      <Dialog open={modalKind !== null} onOpenChange={(open) => !open && setModalKind(null)}>
        <DialogContent
          title={
            modalKind === 'observations'
              ? 'Log Safety Observation'
              : modalKind === 'incidents'
                ? 'Report EHS Incident'
                : modalKind === 'permits'
                  ? 'Issue Permit-to-Work'
                  : modalKind === 'compliance'
                    ? 'Register Compliance Certification'
                    : modalKind === 'environmental'
                      ? 'Log Environmental Metric'
                      : 'Create Corrective Action (CAPA)'
          }
          description="Validated against Environ EHS schemas with immutable audit logging."
        >
          {modalKind === 'observations' && orgId && actor && (
            <UniversalForm
              formId="environ_obs"
              orgId={orgId}
              fields={observationFields}
              schema={safetyObservationSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="environ"
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals, mode) => {
                const created = await createOperationalRecord<SafetyObservationPayload>({
                  orgId,
                  collectionName: 'safety_observations',
                  siteId: String(vals.siteId),
                  departmentId: vals.departmentId ? String(vals.departmentId) : undefined,
                  module: 'environ',
                  recordType: 'safety_observation',
                  actor,
                  status: mode === 'draft' ? 'draft' : 'open',
                  approvalStatus: mode === 'draft' ? 'draft' : 'submitted',
                  recordTitle: `${vals.category} (${vals.riskLevel})`,
                  payload: {
                    observationDate: String(vals.observationDate),
                    location: String(vals.location),
                    category: String(vals.category),
                    description: String(vals.description),
                    riskLevel: vals.riskLevel as SafetyObservationPayload['riskLevel'],
                    supportingImage: vals.supportingImage ? String(vals.supportingImage) : undefined,
                    reportedBy: String(vals.reportedBy),
                    assignedPerson: vals.assignedPerson ? String(vals.assignedPerson) : undefined,
                    correctiveAction: vals.correctiveAction ? String(vals.correctiveAction) : undefined,
                  },
                });
                if (vals.riskLevel === 'critical') {
                  await upsertDeduplicatedAlert({
                    orgId,
                    siteId: String(vals.siteId),
                    actor,
                    alert: {
                      severity: 'critical',
                      category: 'critical_observation',
                      title: `Critical Safety Observation: ${vals.category}`,
                      message: `Reported at ${vals.location}: ${String(vals.description).slice(0, 120)}`,
                      targetCollection: 'safety_observations',
                      targetId: created.id,
                    },
                  });
                }
                notify({ tone: 'success', title: 'Safety Observation Saved' });
                setModalKind(null);
                await invalidateEnviron();
              }}
            />
          )}

          {modalKind === 'incidents' && orgId && actor && (
            <UniversalForm
              formId="environ_incident"
              orgId={orgId}
              fields={incidentFields}
              schema={incidentSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="environ"
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals, mode) => {
                const created = await createOperationalRecord<IncidentPayload>({
                  orgId,
                  collectionName: 'incidents',
                  siteId: String(vals.siteId),
                  departmentId: vals.departmentId ? String(vals.departmentId) : undefined,
                  module: 'environ',
                  recordType: 'incident',
                  actor,
                  status: mode === 'draft' ? 'draft' : 'investigating',
                  approvalStatus: mode === 'draft' ? 'draft' : 'pending_approval',
                  requestApproval: mode === 'submit',
                  recordTitle: `${vals.category} (${vals.severity})`,
                  payload: {
                    incidentDateTime: String(vals.incidentDateTime),
                    location: String(vals.location),
                    category: String(vals.category),
                    description: String(vals.description),
                    severity: vals.severity as IncidentPayload['severity'],
                    peopleInvolved: vals.peopleInvolved ? String(vals.peopleInvolved) : undefined,
                    supportingFiles: vals.supportingFile ? [String(vals.supportingFile)] : [],
                    immediateAction: String(vals.immediateAction),
                    investigationDetails: vals.investigationDetails ? String(vals.investigationDetails) : undefined,
                    correctiveActions: vals.correctiveActions ? String(vals.correctiveActions) : undefined,
                    history: [
                      {
                        timestamp: new Date().toISOString(),
                        actor: actor.displayName,
                        note: `Initial incident report logged (${vals.severity})`,
                      },
                    ],
                  },
                });
                if (vals.severity === 'major' || vals.severity === 'critical') {
                  await upsertDeduplicatedAlert({
                    orgId,
                    siteId: String(vals.siteId),
                    actor,
                    alert: {
                      severity: 'critical',
                      category: 'unresolved_incident',
                      title: `Unresolved ${String(vals.severity).toUpperCase()} Incident`,
                      message: `${vals.category} at ${vals.location}`,
                      targetCollection: 'incidents',
                      targetId: created.id,
                    },
                  });
                }
                notify({ tone: 'success', title: 'Incident Reported' });
                setModalKind(null);
                await invalidateEnviron();
              }}
            />
          )}

          {modalKind === 'permits' && orgId && actor && (
            <UniversalForm
              formId="environ_permit"
              orgId={orgId}
              fields={permitFields}
              schema={workPermitSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="environ"
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals, mode) => {
                await createOperationalRecord<WorkPermitPayload>({
                  orgId,
                  collectionName: 'work_permits',
                  siteId: String(vals.siteId),
                  module: 'environ',
                  recordType: 'work_permit',
                  actor,
                  status: mode === 'draft' ? 'draft' : 'pending_approval',
                  approvalStatus: mode === 'draft' ? 'draft' : 'pending_approval',
                  requestApproval: mode === 'submit',
                  recordTitle: `Permit ${vals.permitNumber} (${vals.permitType})`,
                  payload: {
                    permitNumber: String(vals.permitNumber),
                    permitType: String(vals.permitType),
                    location: String(vals.location),
                    contractor: String(vals.contractor),
                    responsiblePerson: String(vals.responsiblePerson),
                    startDateTime: String(vals.startDateTime),
                    endDateTime: String(vals.endDateTime),
                    hazards: String(vals.hazards),
                    precautions: String(vals.precautions),
                  },
                });
                notify({ tone: 'success', title: 'Permit-to-Work Submitted for Approval' });
                setModalKind(null);
                await invalidateEnviron();
              }}
            />
          )}

          {modalKind === 'compliance' && orgId && actor && (
            <UniversalForm
              formId="environ_compliance"
              orgId={orgId}
              fields={complianceFields}
              schema={complianceRecordSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="environ"
              allowDraft={false}
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals) => {
                const evalRes = evaluateExpiryStatus(String(vals.expiryDate), certThresholdDays);
                const created = await createOperationalRecord<ComplianceRecordPayload>({
                  orgId,
                  collectionName: 'compliance_records',
                  siteId: String(vals.siteId),
                  module: 'environ',
                  recordType: 'compliance_record',
                  actor,
                  status: evalRes.status,
                  approvalStatus: 'submitted',
                  payload: {
                    requirement: String(vals.requirement),
                    certificationName: String(vals.certificationName),
                    issuingAuthority: String(vals.issuingAuthority),
                    issueDate: String(vals.issueDate),
                    expiryDate: String(vals.expiryDate),
                    responsiblePerson: String(vals.responsiblePerson),
                    supportingDocument: vals.supportingDocument ? String(vals.supportingDocument) : undefined,
                  },
                });
                if (evalRes.status !== 'valid') {
                  await upsertDeduplicatedAlert({
                    orgId,
                    siteId: String(vals.siteId),
                    actor,
                    alert: {
                      severity: evalRes.status === 'expired' ? 'critical' : 'warning',
                      category: 'certification_expiry',
                      title: `Certification ${evalRes.status === 'expired' ? 'Expired' : 'Expiring'}: ${vals.certificationName}`,
                      message: `Expires ${vals.expiryDate} (${evalRes.daysRemaining} days).`,
                      targetCollection: 'compliance_records',
                      targetId: created.id,
                    },
                  });
                }
                notify({ tone: 'success', title: 'Compliance Certification Saved' });
                setModalKind(null);
                await invalidateEnviron();
              }}
            />
          )}

          {modalKind === 'environmental' && orgId && actor && (
            <UniversalForm
              formId="environ_env"
              orgId={orgId}
              fields={environmentalFields}
              schema={environmentalRecordSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="environ"
              allowDraft={false}
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals) => {
                await createOperationalRecord<EnvironmentalRecordPayload>({
                  orgId,
                  collectionName: 'environmental_records',
                  siteId: String(vals.siteId),
                  departmentId: vals.departmentId ? String(vals.departmentId) : undefined,
                  module: 'environ',
                  recordType: 'environmental_record',
                  actor,
                  status: 'logged',
                  approvalStatus: 'submitted',
                  payload: {
                    metricType: vals.metricType as EnvironmentalRecordPayload['metricType'],
                    reportingPeriod: String(vals.reportingPeriod),
                    sourceName: String(vals.sourceName),
                    value: Number(vals.value),
                    unit: String(vals.unit),
                    methodologyNote: vals.methodologyNote ? String(vals.methodologyNote) : undefined,
                    notes: vals.notes ? String(vals.notes) : undefined,
                  },
                });
                notify({ tone: 'success', title: 'Environmental Record Logged' });
                setModalKind(null);
                await invalidateEnviron();
              }}
            />
          )}

          {modalKind === 'capa' && orgId && actor && (
            <UniversalForm
              formId="environ_capa"
              orgId={orgId}
              fields={capaFields}
              schema={correctiveActionSchema}
              sites={sites}
              departments={departments}
              members={members}
              moduleAccent="environ"
              onCancel={() => setModalKind(null)}
              onSubmit={async (vals, mode) => {
                await createOperationalRecord<CorrectiveActionPayload>({
                  orgId,
                  collectionName: 'corrective_actions',
                  siteId: String(vals.siteId),
                  module: 'environ',
                  recordType: 'corrective_action',
                  actor,
                  status: mode === 'draft' ? 'draft' : 'open',
                  approvalStatus: mode === 'draft' ? 'draft' : 'submitted',
                  payload: {
                    finding: String(vals.finding),
                    relatedRecordType: vals.relatedRecordType ? String(vals.relatedRecordType) : undefined,
                    relatedRecordId: vals.relatedRecordId ? String(vals.relatedRecordId) : undefined,
                    assignedOwner: String(vals.assignedOwner),
                    dueDate: String(vals.dueDate),
                    priority: vals.priority as CorrectiveActionPayload['priority'],
                    actionPlan: String(vals.actionPlan),
                    evidence: vals.evidence ? String(vals.evidence) : undefined,
                  },
                });
                notify({ tone: 'success', title: 'Corrective Action Created' });
                setModalKind(null);
                await invalidateEnviron();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* TRACEABLE INCIDENT HISTORY DIALOG */}
      <Dialog open={selectedIncident !== null} onOpenChange={(open) => !open && setSelectedIncident(null)}>
        <DialogContent
          title="Incident Traceability & Investigation History"
          description={selectedIncident ? `${selectedIncident.payload.category} · ${selectedIncident.payload.location}` : ''}
        >
          {selectedIncident && (
            <div className="space-y-4">
              <div className="rounded-md border border-[#d9dfe5] bg-[#f9fafc] p-3 text-xs space-y-1">
                <p className="font-semibold text-[#070e16]">Immediate Action Taken</p>
                <p className="text-[#555f69]">{selectedIncident.payload.immediateAction}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#070e16]">Chronological Traceability Log</p>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {(selectedIncident.payload.history || []).map((entry, idx) => (
                    <div key={idx} className="rounded border border-[#e9eef4] p-2.5 text-xs bg-white">
                      <div className="flex items-center justify-between text-[#555f69] mb-1">
                        <span className="font-medium text-[#070e16]">{entry.actor}</span>
                        <span className="font-mono-tabular">{entry.timestamp.slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      <p className="text-[#070e16]">{entry.note}</p>
                    </div>
                  ))}
                </div>
              </div>
              {canWrite && selectedIncident.approvalStatus !== 'closed' && (
                <div className="flex gap-2 pt-2 border-t border-[#e9eef4]">
                  <input
                    value={incidentNote}
                    onChange={(e) => setIncidentNote(e.target.value)}
                    placeholder="Add investigation update or corrective note..."
                    className="flex-1 h-9 rounded-md border border-[#d9dfe5] px-3 text-xs"
                  />
                  <Button variant="environ" size="sm" onClick={() => void handleAppendIncidentHistory()}>
                    Add Entry
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
