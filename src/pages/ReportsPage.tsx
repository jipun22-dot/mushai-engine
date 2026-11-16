import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { FileDown, FileSpreadsheet, Play, Eye } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../lib/permissions';
import { createOperationalRecord, listOperationalRecords } from '../services/firestoreService';
import { uploadOrganisationFile } from '../services/storageService';
import { formatTimestamp } from '../lib/utils';
import type { GeneratedReportPayload, OperationalRecord } from '../types/domain';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { EmptyState, TableSkeleton } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { useToast } from '../components/ui/ToastProvider';

interface ReportDefinition {
  id: string;
  label: string;
  module: 'nexus' | 'environ';
  collection: string;
  columns: string[];
  mapRow: (rec: OperationalRecord<Record<string, unknown>>, siteCode: string) => Record<string, string | number>;
}

const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: 'daily_production',
    label: 'Nexus · Daily Production Report',
    module: 'nexus',
    collection: 'production_logs',
    columns: ['Date', 'Site', 'Line', 'Machine', 'Shift', 'Product', 'Target', 'Actual', 'Rejected', 'Achievement %', 'Status'],
    mapRow: (r, siteCode) => ({
      Date: String(r.payload.productionDate || ''),
      Site: siteCode,
      Line: String(r.payload.productionLine || ''),
      Machine: String(r.payload.machine || ''),
      Shift: String(r.payload.shift || ''),
      Product: String(r.payload.product || ''),
      Target: Number(r.payload.targetQuantity || 0),
      Actual: Number(r.payload.actualQuantity || 0),
      Rejected: Number(r.payload.rejectedQuantity || 0),
      'Achievement %': Number(r.payload.achievementPercent || 0),
      Status: r.approvalStatus,
    }),
  },
  {
    id: 'shift_performance',
    label: 'Nexus · Shift Performance Report',
    module: 'nexus',
    collection: 'shift_reports',
    columns: ['Date', 'Shift', 'Site', 'Supervisor', 'Summary', 'Status'],
    mapRow: (r, siteCode) => ({
      Date: String(r.payload.date || ''),
      Shift: String(r.payload.shift || ''),
      Site: siteCode,
      Supervisor: String(r.payload.supervisor || ''),
      Summary: String(r.payload.productionSummary || ''),
      Status: r.approvalStatus,
    }),
  },
  {
    id: 'downtime_report',
    label: 'Nexus · Equipment Downtime Report',
    module: 'nexus',
    collection: 'downtime_logs',
    columns: ['Site', 'Machine', 'Line', 'Start', 'End', 'Minutes', 'Reason', 'Resolution'],
    mapRow: (r, siteCode) => ({
      Site: siteCode,
      Machine: String(r.payload.machine || ''),
      Line: String(r.payload.productionLine || ''),
      Start: String(r.payload.startTime || ''),
      End: String(r.payload.endTime || ''),
      Minutes: Number(r.payload.totalDowntimeMinutes || 0),
      Reason: String(r.payload.reason || ''),
      Resolution: String(r.payload.resolutionStatus || ''),
    }),
  },
  {
    id: 'quality_report',
    label: 'Nexus · Quality Inspection Report',
    module: 'nexus',
    collection: 'quality_logs',
    columns: ['Date', 'Site', 'Batch', 'Parameter', 'Measured', 'Unit', 'Min', 'Max', 'Result', 'Inspector'],
    mapRow: (r, siteCode) => ({
      Date: String(r.payload.inspectionDate || ''),
      Site: siteCode,
      Batch: String(r.payload.batchOrProduct || ''),
      Parameter: String(r.payload.parameter || ''),
      Measured: Number(r.payload.measuredValue || 0),
      Unit: String(r.payload.unit || ''),
      Min: Number(r.payload.minLimit || 0),
      Max: Number(r.payload.maxLimit || 0),
      Result: String(r.payload.result || '').toUpperCase(),
      Inspector: String(r.payload.inspector || ''),
    }),
  },
  {
    id: 'workforce_report',
    label: 'Nexus · Workforce Attendance Report',
    module: 'nexus',
    collection: 'workforce_records',
    columns: ['Date', 'Site', 'Shift', 'Employee', 'Status', 'Notes'],
    mapRow: (r, siteCode) => ({
      Date: String(r.payload.date || ''),
      Site: siteCode,
      Shift: String(r.payload.shift || ''),
      Employee: String(r.payload.employeeName || ''),
      Status: String(r.payload.attendanceStatus || ''),
      Notes: String(r.payload.notes || ''),
    }),
  },
  {
    id: 'safety_observations_report',
    label: 'Environ · Safety Observation Report',
    module: 'environ',
    collection: 'safety_observations',
    columns: ['Date', 'Site', 'Location', 'Category', 'Risk', 'Reported By', 'Status'],
    mapRow: (r, siteCode) => ({
      Date: String(r.payload.observationDate || ''),
      Site: siteCode,
      Location: String(r.payload.location || ''),
      Category: String(r.payload.category || ''),
      Risk: String(r.payload.riskLevel || ''),
      'Reported By': String(r.payload.reportedBy || ''),
      Status: r.status,
    }),
  },
  {
    id: 'incident_report',
    label: 'Environ · EHS Incident Report',
    module: 'environ',
    collection: 'incidents',
    columns: ['DateTime', 'Site', 'Location', 'Category', 'Severity', 'Immediate Action', 'Status'],
    mapRow: (r, siteCode) => ({
      DateTime: String(r.payload.incidentDateTime || ''),
      Site: siteCode,
      Location: String(r.payload.location || ''),
      Category: String(r.payload.category || ''),
      Severity: String(r.payload.severity || ''),
      'Immediate Action': String(r.payload.immediateAction || ''),
      Status: r.approvalStatus,
    }),
  },
  {
    id: 'permit_register',
    label: 'Environ · Permit-to-Work Register',
    module: 'environ',
    collection: 'work_permits',
    columns: ['Permit #', 'Type', 'Site', 'Location', 'Contractor', 'Start', 'End', 'Approval'],
    mapRow: (r, siteCode) => ({
      'Permit #': String(r.payload.permitNumber || ''),
      Type: String(r.payload.permitType || ''),
      Site: siteCode,
      Location: String(r.payload.location || ''),
      Contractor: String(r.payload.contractor || ''),
      Start: String(r.payload.startDateTime || ''),
      End: String(r.payload.endDateTime || ''),
      Approval: r.approvalStatus,
    }),
  },
  {
    id: 'certification_expiry',
    label: 'Environ · Certification Expiry Report',
    module: 'environ',
    collection: 'compliance_records',
    columns: ['Certification', 'Requirement', 'Authority', 'Site', 'Issue Date', 'Expiry Date', 'Owner'],
    mapRow: (r, siteCode) => ({
      Certification: String(r.payload.certificationName || ''),
      Requirement: String(r.payload.requirement || ''),
      Authority: String(r.payload.issuingAuthority || ''),
      Site: siteCode,
      'Issue Date': String(r.payload.issueDate || ''),
      'Expiry Date': String(r.payload.expiryDate || ''),
      Owner: String(r.payload.responsiblePerson || ''),
    }),
  },
  {
    id: 'capa_report',
    label: 'Environ · Corrective Action (CAPA) Report',
    module: 'environ',
    collection: 'corrective_actions',
    columns: ['Site', 'Finding', 'Owner', 'Due Date', 'Priority', 'Status'],
    mapRow: (r, siteCode) => ({
      Site: siteCode,
      Finding: String(r.payload.finding || ''),
      Owner: String(r.payload.assignedOwner || ''),
      'Due Date': String(r.payload.dueDate || ''),
      Priority: String(r.payload.priority || ''),
      Status: r.status,
    }),
  },
  {
    id: 'environmental_consumption',
    label: 'Environ · Environmental Consumption Report',
    module: 'environ',
    collection: 'environmental_records',
    columns: ['Period', 'Category', 'Source', 'Site', 'Value', 'Unit', 'Methodology'],
    mapRow: (r, siteCode) => ({
      Period: String(r.payload.reportingPeriod || ''),
      Category: String(r.payload.metricType || ''),
      Source: String(r.payload.sourceName || ''),
      Site: siteCode,
      Value: Number(r.payload.value || 0),
      Unit: String(r.payload.unit || ''),
      Methodology: String(r.payload.methodologyNote || ''),
    }),
  },
];

export function ReportsPage() {
  const { activeOrg, activeMember, sites, departments, members, selectedSiteId, actor } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const orgId = activeOrg?.id;
  const canExport = hasPermission(activeMember, 'reports.export');
  const nexusOn = Boolean(activeOrg?.activeModules?.nexus);
  const environOn = Boolean(activeOrg?.activeModules?.environ);

  const availableDefs = React.useMemo(
    () => REPORT_DEFINITIONS.filter((d) => (d.module === 'nexus' ? nexusOn : environOn)),
    [nexusOn, environOn]
  );

  const [reportTypeId, setReportTypeId] = React.useState<string>(availableDefs[0]?.id || '');
  const [filterSite, setFilterSite] = React.useState<string>(selectedSiteId);
  const [filterDept, setFilterDept] = React.useState<string>('ALL');
  const [filterShift, setFilterShift] = React.useState<string>('ALL');
  const [filterStatus, setFilterStatus] = React.useState<string>('ALL');
  const [filterOwner, setFilterOwner] = React.useState<string>('ALL');
  const [periodStart, setPeriodStart] = React.useState<string>(
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  );
  const [periodEnd, setPeriodEnd] = React.useState<string>(new Date().toISOString().slice(0, 10));
  const [generating, setGenerating] = React.useState(false);
  const [previewReport, setPreviewReport] = React.useState<OperationalRecord<GeneratedReportPayload> | null>(null);

  React.useEffect(() => {
    if (!reportTypeId && availableDefs[0]) {
      setReportTypeId(availableDefs[0].id);
    }
  }, [availableDefs, reportTypeId]);

  const { data: reportHistory = [], isLoading } = useQuery({
    queryKey: ['generated_reports', orgId, selectedSiteId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) return [];
      return listOperationalRecords<GeneratedReportPayload>(orgId, 'generated_reports', {
        siteId: selectedSiteId === 'ALL' ? undefined : selectedSiteId,
      });
    },
  });

  const buildPdfBlob = (report: OperationalRecord<GeneratedReportPayload>): Blob => {
    const docPdf = new jsPDF({ orientation: 'landscape' });
    docPdf.setFontSize(14);
    docPdf.text(`MUSHAI SYSTEMS — ${report.payload.title}`, 14, 16);
    docPdf.setFontSize(9);
    docPdf.text(
      `Report ID: ${report.id} | Org: ${activeOrg?.name || orgId} | Period: ${report.payload.periodStart} to ${report.payload.periodEnd} | Generated by: ${report.createdByName}`,
      14,
      23
    );

    const cols = report.payload.columns;
    const rows = report.payload.snapshotRows.map((row) => cols.map((c) => String(row[c] ?? '')));

    autoTable(docPdf, {
      startY: 28,
      head: [cols],
      body: rows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [7, 14, 22] },
    });

    return docPdf.output('blob');
  };

  const downloadPdf = (report: OperationalRecord<GeneratedReportPayload>) => {
    const blob = buildPdfBlob(report);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.payload.reportType}_${report.id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadExcel = (report: OperationalRecord<GeneratedReportPayload>) => {
    const ws = XLSX.utils.json_to_sheet(report.payload.snapshotRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Snapshot');
    XLSX.writeFile(wb, `${report.payload.reportType}_${report.id}.xlsx`);
  };

  const handleGenerateReport = async () => {
    if (!orgId || !actor) return;
    const def = availableDefs.find((d) => d.id === reportTypeId);
    if (!def) return;

    setGenerating(true);
    try {
      const records = await listOperationalRecords<Record<string, unknown>>(orgId, def.collection, {
        siteId: filterSite === 'ALL' ? undefined : filterSite,
        pageSize: 500,
      });

      const filtered = records.filter((r) => {
        if (filterDept !== 'ALL' && r.departmentId !== filterDept) return false;
        if (filterStatus !== 'ALL' && r.approvalStatus !== filterStatus) return false;
        if (filterShift !== 'ALL' && String(r.payload.shift || '') !== filterShift) return false;
        if (filterOwner !== 'ALL' && r.createdBy !== filterOwner) return false;
        return true;
      });

      const snapshotRows = filtered.slice(0, 500).map((r) => {
        const sCode = sites.find((s) => s.id === r.siteId)?.code || r.siteId;
        return def.mapRow(r, sCode);
      });

      const savedReport = await createOperationalRecord<GeneratedReportPayload>({
        orgId,
        collectionName: 'generated_reports',
        siteId: filterSite,
        module: 'core',
        recordType: 'generated_report',
        actor,
        source: 'system',
        status: 'generated',
        approvalStatus: 'closed',
        payload: {
          reportType: def.id,
          title: def.label,
          targetModule: def.module,
          periodStart,
          periodEnd,
          filters: {
            siteId: filterSite,
            departmentId: filterDept,
            shift: filterShift,
            status: filterStatus,
            responsibleUser: filterOwner,
          },
          summaryMetrics: {
            totalRows: snapshotRows.length,
          },
          rowCount: snapshotRows.length,
          columns: def.columns,
          snapshotRows,
          fileFormat: 'both',
        },
      });

      // Optionally archive PDF blob to Firebase Storage
      try {
        const pdfBlob = buildPdfBlob(savedReport);
        await uploadOrganisationFile(orgId, 'reports', pdfBlob, `${def.id}_${savedReport.id}.pdf`);
      } catch {
        // Snapshot remains immutably stored in Firestore even if Storage bucket CORS isn't configured
      }

      notify({
        tone: 'success',
        title: 'Immutable Report Snapshot Generated',
        description: `${snapshotRows.length} row(s) captured in ${def.label}.`,
      });
      setPreviewReport(savedReport);
      await queryClient.invalidateQueries({ queryKey: ['generated_reports', orgId] });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Report Generation Failed',
        description: err instanceof Error ? err.message : 'Unable to generate report',
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reporting & Export Engine"
        subtitle="Generate immutable point-in-time operational snapshots and export to PDF or Excel."
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Generate New Snapshot Report</CardTitle>
            <CardDescription>
              Snapshots freeze data as of generation time so historical reports remain auditable.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <Label>Report Template</Label>
              <Select
                value={reportTypeId}
                onChange={(e) => setReportTypeId(e.target.value)}
                options={availableDefs.map((d) => ({ value: d.id, label: d.label }))}
              />
            </div>
            <div>
              <Label>Site Filter</Label>
              <Select value={filterSite} onChange={(e) => setFilterSite(e.target.value)}>
                <option value="ALL">All Sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                <option value="ALL">All Departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Shift (Optional)</Label>
              <Select value={filterShift} onChange={(e) => setFilterShift(e.target.value)}>
                <option value="ALL">All Shifts</option>
                <option value="Shift A">Shift A</option>
                <option value="Shift B">Shift B</option>
                <option value="Shift C">Shift C</option>
              </Select>
            </div>
            <div>
              <Label>Record Approval Status</Label>
              <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="ALL">All States</option>
                <option value="submitted">Submitted</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="approved">Approved</option>
                <option value="closed">Closed</option>
              </Select>
            </div>
            <div>
              <Label>Period Start</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="font-mono-tabular" />
            </div>
            <div>
              <Label>Period End</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="font-mono-tabular" />
            </div>
            <div>
              <Label>Responsible User</Label>
              <Select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)}>
                <option value="ALL">All Users</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.displayName}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              variant="primary"
              disabled={!canExport || generating || availableDefs.length === 0}
              onClick={() => void handleGenerateReport()}
            >
              <Play className="h-3.5 w-3.5" />
              {generating ? 'Capturing Snapshot...' : 'Generate Report Snapshot'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Report Snapshot History</CardTitle>
            <CardDescription>Retrieve historical snapshots and export to PDF or Excel (.xlsx)</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton />
          ) : reportHistory.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No reports generated yet"
                description="Generate your first operational snapshot above to export PDF and Excel files."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Generated By</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead className="text-right">Exports</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportHistory.map((rep) => (
                  <TableRow key={rep.id}>
                    <TableCell className="text-xs font-medium">{rep.payload.title}</TableCell>
                    <TableCell>
                      <StatusBadge tone={rep.payload.targetModule === 'nexus' ? 'nexus' : 'environ'}>
                        {rep.payload.targetModule.toUpperCase()}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-xs font-mono-tabular">
                      {rep.payload.periodStart} → {rep.payload.periodEnd}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono-tabular">{rep.payload.rowCount}</TableCell>
                    <TableCell className="text-xs">{rep.createdByName}</TableCell>
                    <TableCell className="text-xs font-mono-tabular text-[#555f69]">{formatTimestamp(rep.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => setPreviewReport(rep)}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </Button>
                        {canExport && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => downloadPdf(rep)}>
                              <FileDown className="h-3.5 w-3.5" /> PDF
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => downloadExcel(rep)}>
                              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={previewReport !== null} onOpenChange={(open) => !open && setPreviewReport(null)}>
        <DialogContent
          className="max-w-4xl"
          title={previewReport?.payload.title || 'Report Snapshot'}
          description={previewReport ? `Report ID: ${previewReport.id} · Frozen ${previewReport.payload.rowCount} rows` : ''}
        >
          {previewReport && (
            <div className="space-y-4">
              {previewReport.payload.snapshotRows.length === 0 ? (
                <EmptyState
                  title="Zero records matched filters"
                  description="Try expanding your date range or clearing site/status filters."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {previewReport.payload.columns.map((c) => (
                        <TableHead key={c}>{c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewReport.payload.snapshotRows.slice(0, 50).map((row, idx) => (
                      <TableRow key={idx}>
                        {previewReport.payload.columns.map((c) => (
                          <TableCell key={c} className="text-xs font-mono-tabular">
                            {String(row[c] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {canExport && (
                <div className="flex justify-end gap-2 pt-2 border-t border-[#e9eef4]">
                  <Button variant="outline" size="sm" onClick={() => downloadPdf(previewReport)}>
                    <FileDown className="h-3.5 w-3.5" /> Download PDF
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => downloadExcel(previewReport)}>
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Download Excel (.xlsx)
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
