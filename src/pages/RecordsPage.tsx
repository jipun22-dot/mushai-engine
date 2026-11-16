import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../lib/permissions';
import {
  createOperationalRecord,
  listOperationalRecords,
  updateOperationalRecord,
} from '../services/firestoreService';
import { uploadOrganisationFile } from '../services/storageService';
import {
  calculateProductionMetrics,
  complianceRecordSchema,
  environmentalRecordSchema,
  evaluateQualityMeasurement,
  incidentSchema,
  productionLogSchema,
  qualityLogSchema,
  workPermitSchema,
} from '../lib/validation';
import { formatTimestamp } from '../lib/utils';
import type {
  AIExtractionJobPayload,
  ComplianceRecordPayload,
  EnvironmentalRecordPayload,
  IncidentPayload,
  OperationalRecord,
  ProductionLogPayload,
  QualityLogPayload,
  WorkPermitPayload,
} from '../types/domain';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { FilterBar } from '../components/ui/FilterBar';
import { EmptyState, TableSkeleton } from '../components/ui/EmptyState';
import { StatusBadge, statusToTone } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { useToast } from '../components/ui/ToastProvider';

type AITargetType =
  | 'production_logs'
  | 'quality_logs'
  | 'work_permits'
  | 'incidents'
  | 'compliance_records'
  | 'environmental_records';

const AI_TARGET_OPTIONS: Array<{ value: AITargetType; label: string; module: 'nexus' | 'environ' }> = [
  { value: 'production_logs', label: 'Nexus · Production Log Sheet', module: 'nexus' },
  { value: 'quality_logs', label: 'Nexus · Quality / Lab Certificate', module: 'nexus' },
  { value: 'work_permits', label: 'Environ · Permit-to-Work Form', module: 'environ' },
  { value: 'incidents', label: 'Environ · Safety Incident Report', module: 'environ' },
  { value: 'compliance_records', label: 'Environ · Compliance Certification', module: 'environ' },
  { value: 'environmental_records', label: 'Environ · Utility / Environmental Bill', module: 'environ' },
];

export function RecordsPage() {
  const { activeOrg, activeMember, sites, selectedSiteId, actor } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const orgId = activeOrg?.id;
  const nexusOn = Boolean(activeOrg?.activeModules?.nexus) && hasPermission(activeMember, 'nexus.read');
  const environOn = Boolean(activeOrg?.activeModules?.environ) && hasPermission(activeMember, 'environ.read');
  const canCreate = hasPermission(activeMember, 'records.create');

  const [tab, setTab] = React.useState<'ledger' | 'ai'>('ledger');
  const [search, setSearch] = React.useState('');
  const [moduleFilter, setModuleFilter] = React.useState<'all' | 'nexus' | 'environ'>('all');
  const [statusFilter, setStatusFilter] = React.useState('all');

  // AI Document Extraction state
  const [targetType, setTargetType] = React.useState<AITargetType>(
    nexusOn ? 'production_logs' : 'work_permits'
  );
  const [aiSiteId, setAiSiteId] = React.useState<string>(
    selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || ''
  );
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [extracting, setExtracting] = React.useState(false);
  const [savingAi, setSavingAi] = React.useState(false);
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null);
  const [draftFields, setDraftFields] = React.useState<Record<string, unknown> | null>(null);
  const [uncertainFields, setUncertainFields] = React.useState<string[]>([]);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!aiSiteId && sites[0]?.id) setAiSiteId(sites[0].id);
  }, [aiSiteId, sites]);

  const { data, isLoading } = useQuery({
    queryKey: ['records_ledger', orgId, selectedSiteId, nexusOn, environOn],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) throw new Error('No org');
      const siteOpt = selectedSiteId === 'ALL' ? undefined : selectedSiteId;
      const collections: Array<{ col: string; enabled: boolean }> = [
        { col: 'production_logs', enabled: nexusOn },
        { col: 'shift_reports', enabled: nexusOn },
        { col: 'downtime_logs', enabled: nexusOn },
        { col: 'workforce_records', enabled: nexusOn },
        { col: 'visitor_records', enabled: nexusOn },
        { col: 'quality_logs', enabled: nexusOn },
        { col: 'safety_observations', enabled: environOn },
        { col: 'incidents', enabled: environOn },
        { col: 'work_permits', enabled: environOn },
        { col: 'compliance_records', enabled: environOn },
        { col: 'environmental_records', enabled: environOn },
        { col: 'corrective_actions', enabled: environOn },
      ];

      const results = await Promise.all(
        collections.map((c) =>
          c.enabled ? listOperationalRecords(orgId, c.col, { siteId: siteOpt, pageSize: 50 }) : Promise.resolve([])
        )
      );

      const jobs = await listOperationalRecords<AIExtractionJobPayload>(orgId, 'ai_extraction_jobs', {
        siteId: siteOpt,
        pageSize: 25,
      });

      const merged = results.flat().sort((a, b) => {
        const ta = typeof (a.createdAt as { toMillis?: () => number })?.toMillis === 'function'
          ? (a.createdAt as { toMillis: () => number }).toMillis()
          : 0;
        const tb = typeof (b.createdAt as { toMillis?: () => number })?.toMillis === 'function'
          ? (b.createdAt as { toMillis: () => number }).toMillis()
          : 0;
        return tb - ta;
      });

      return { records: merged, jobs };
    },
  });

  const filteredRecords = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.records || []).filter((r) => {
      if (moduleFilter !== 'all' && r.module !== moduleFilter) return false;
      if (statusFilter !== 'all' && r.approvalStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.recordType.toLowerCase().includes(q) ||
        r.createdByName.toLowerCase().includes(q) ||
        JSON.stringify(r.payload).toLowerCase().includes(q)
      );
    });
  }, [data?.records, moduleFilter, statusFilter, search]);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || '');
        const idx = res.indexOf(',');
        resolve(idx >= 0 ? res.slice(idx + 1) : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleRunExtraction = async () => {
    if (!orgId || !actor || !selectedFile || !aiSiteId) return;
    setExtracting(true);
    setValidationErrors([]);
    try {
      let fileUrl = `local://${selectedFile.name}`;
      try {
        const uploaded = await uploadOrganisationFile(orgId, 'ai_documents', selectedFile, selectedFile.name);
        fileUrl = uploaded.url;
      } catch {
        // Continue with extraction even if Cloud Storage bucket CORS isn't configured
      }

      const targetMeta = AI_TARGET_OPTIONS.find((o) => o.value === targetType)!;
      const job = await createOperationalRecord<AIExtractionJobPayload>({
        orgId,
        collectionName: 'ai_extraction_jobs',
        siteId: aiSiteId,
        module: 'core',
        recordType: 'ai_extraction_job',
        actor,
        source: 'ai_document',
        status: 'pending',
        approvalStatus: 'submitted',
        payload: {
          targetModule: targetMeta.module,
          targetRecordType: targetType,
          fileName: selectedFile.name,
          mimeType: selectedFile.type || 'application/pdf',
          fileUrl,
          uncertainFields: [],
        },
      });
      setActiveJobId(job.id);

      const base64Data = await fileToBase64(selectedFile);
      const response = await fetch('/api/ai/extract-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Data,
          mimeType: selectedFile.type || 'image/png',
          targetModule: targetMeta.module,
          targetRecordType: targetType,
          fileName: selectedFile.name,
        }),
      });

      const body = (await response.json()) as {
        extractedData?: Record<string, unknown>;
        uncertainFields?: string[];
        error?: string;
      };

      if (!response.ok) {
        await updateOperationalRecord({
          orgId,
          collectionName: 'ai_extraction_jobs',
          recordId: job.id,
          siteId: aiSiteId,
          actor,
          status: 'failed',
          payload: {
            targetModule: targetMeta.module,
            targetRecordType: targetType,
            fileName: selectedFile.name,
            mimeType: selectedFile.type || 'application/pdf',
            fileUrl,
            uncertainFields: [],
            errorMessage: body.error || 'Extraction failed',
          },
        });
        throw new Error(body.error || 'AI extraction failed');
      }

      const extracted = body.extractedData || {};
      const uncertain = Array.isArray(body.uncertainFields) ? body.uncertainFields : [];

      await updateOperationalRecord({
        orgId,
        collectionName: 'ai_extraction_jobs',
        recordId: job.id,
        siteId: aiSiteId,
        actor,
        status: 'extracted',
        payload: {
          targetModule: targetMeta.module,
          targetRecordType: targetType,
          fileName: selectedFile.name,
          mimeType: selectedFile.type || 'application/pdf',
          fileUrl,
          extractedData: extracted,
          uncertainFields: uncertain,
        },
      });

      setDraftFields({ ...extracted, siteId: aiSiteId });
      setUncertainFields(uncertain);
      notify({
        tone: 'info',
        title: 'AI Extraction Complete',
        description: 'Review and verify all extracted fields before saving to Firestore.',
      });
      await queryClient.invalidateQueries({ queryKey: ['records_ledger', orgId] });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Document Extraction Error',
        description: err instanceof Error ? err.message : 'Unable to process document',
      });
    } finally {
      setExtracting(false);
    }
  };

  const handleApproveAndSaveExtracted = async () => {
    if (!orgId || !actor || !draftFields) return;
    setValidationErrors([]);

    const withSite: Record<string, unknown> = { ...draftFields, siteId: aiSiteId };
    let schemaToUse;
    if (targetType === 'production_logs') schemaToUse = productionLogSchema;
    else if (targetType === 'quality_logs') schemaToUse = qualityLogSchema;
    else if (targetType === 'work_permits') schemaToUse = workPermitSchema;
    else if (targetType === 'incidents') schemaToUse = incidentSchema;
    else if (targetType === 'compliance_records') schemaToUse = complianceRecordSchema;
    else schemaToUse = environmentalRecordSchema;

    // Provide safe required defaults for departmentId where needed in review
    if ((targetType === 'incidents') && !withSite.departmentId) {
      withSite.departmentId = 'OPS-DEFAULT';
    }

    const parsed = schemaToUse.safeParse(withSite);
    if (!parsed.success) {
      setValidationErrors(parsed.error.issues.map((i) => `${String(i.path.join('.'))}: ${i.message}`));
      return;
    }

    setSavingAi(true);
    try {
      const validData = parsed.data as Record<string, unknown>;
      const targetMeta = AI_TARGET_OPTIONS.find((o) => o.value === targetType)!;
      let finalPayload: Record<string, unknown> = validData;
      let status = 'submitted';

      if (targetType === 'production_logs') {
        const metrics = calculateProductionMetrics(
          Number(validData.targetQuantity),
          Number(validData.actualQuantity),
          Number(validData.rejectedQuantity)
        );
        finalPayload = { ...validData, ...metrics } satisfies Partial<ProductionLogPayload>;
      } else if (targetType === 'quality_logs') {
        const evalRes = evaluateQualityMeasurement(
          Number(validData.measuredValue),
          Number(validData.minLimit),
          Number(validData.maxLimit)
        );
        finalPayload = { ...validData, ...evalRes } satisfies Partial<QualityLogPayload>;
        status = evalRes.result;
      } else if (targetType === 'work_permits') {
        finalPayload = validData as Partial<WorkPermitPayload>;
        status = 'pending_approval';
      } else if (targetType === 'incidents') {
        finalPayload = {
          ...validData,
          history: [{ timestamp: new Date().toISOString(), actor: actor.displayName, note: 'Created from verified AI document intake' }],
        } satisfies Partial<IncidentPayload>;
      } else if (targetType === 'compliance_records') {
        finalPayload = validData as Partial<ComplianceRecordPayload>;
      } else if (targetType === 'environmental_records') {
        finalPayload = validData as Partial<EnvironmentalRecordPayload>;
      }

      const saved = await createOperationalRecord({
        orgId,
        collectionName: targetType,
        siteId: aiSiteId,
        module: targetMeta.module,
        recordType: targetType.slice(0, -1),
        actor,
        source: 'ai_document',
        status,
        approvalStatus: 'pending_approval',
        requestApproval: true,
        recordTitle: `AI Verified ${targetMeta.label}`,
        payload: finalPayload,
      });

      if (activeJobId) {
        await updateOperationalRecord({
          orgId,
          collectionName: 'ai_extraction_jobs',
          recordId: activeJobId,
          siteId: aiSiteId,
          actor,
          status: 'saved',
          approvalStatus: 'approved',
          payload: {
            targetModule: targetMeta.module,
            targetRecordType: targetType,
            fileName: selectedFile?.name || 'document',
            mimeType: selectedFile?.type || 'application/pdf',
            extractedData: finalPayload,
            uncertainFields,
            savedRecordId: saved.id,
          } satisfies AIExtractionJobPayload,
        });
      }

      notify({
        tone: 'success',
        title: 'Verified Record Saved',
        description: `Saved to ${targetType} and queued for approval.`,
      });
      setDraftFields(null);
      setSelectedFile(null);
      setActiveJobId(null);
      setUncertainFields([]);
      await queryClient.invalidateQueries({ queryKey: ['records_ledger', orgId] });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Save Failed',
        description: err instanceof Error ? err.message : 'Unable to save verified record',
      });
    } finally {
      setSavingAi(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operational Records & AI Document Intake"
        subtitle="Unified structured records across Nexus & Environ, plus Gemini-assisted document extraction with mandatory human verification."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'ledger' | 'ai')}>
        <TabsList>
          <TabsTrigger value="ledger">Structured Records Ledger ({filteredRecords.length})</TabsTrigger>
          {canCreate && <TabsTrigger value="ai">AI Document Processing</TabsTrigger>}
        </TabsList>

        <TabsContent value="ledger" className="space-y-4 mt-5">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by ID, type, creator, or field content..."
            onReset={() => {
              setSearch('');
              setModuleFilter('all');
              setStatusFilter('all');
            }}
          >
            <Select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value as 'all' | 'nexus' | 'environ')}
              className="w-36 h-9 text-xs"
            >
              <option value="all">All Modules</option>
              {nexusOn && <option value="nexus">Nexus</option>}
              {environOn && <option value="environ">Environ</option>}
            </Select>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-40 h-9 text-xs"
            >
              <option value="all">All Approval States</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="closed">Closed</option>
            </Select>
          </FilterBar>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton rows={6} />
              ) : filteredRecords.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No matching operational records"
                    description="Submit records in Nexus or Environ, or adjust your active filters."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Module</TableHead>
                      <TableHead>Record Type</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Created By</TableHead>
                      <TableHead>Approval State</TableHead>
                      <TableHead>Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRecords.map((rec: OperationalRecord) => (
                      <TableRow key={rec.id}>
                        <TableCell>
                          <StatusBadge tone={rec.module === 'nexus' ? 'nexus' : rec.module === 'environ' ? 'environ' : 'neutral'}>
                            {rec.module.toUpperCase()}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-xs font-medium capitalize">
                          {rec.recordType.replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell className="text-xs font-mono-tabular">
                          {sites.find((s) => s.id === rec.siteId)?.code || rec.siteId}
                        </TableCell>
                        <TableCell className="text-xs text-[#555f69]">{rec.source}</TableCell>
                        <TableCell className="text-xs">{rec.createdByName}</TableCell>
                        <TableCell>
                          <StatusBadge tone={statusToTone(rec.approvalStatus)}>{rec.approvalStatus}</StatusBadge>
                        </TableCell>
                        <TableCell className="text-xs text-[#555f69] font-mono-tabular whitespace-nowrap">
                          {formatTimestamp(rec.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canCreate && (
          <TabsContent value="ai" className="space-y-5 mt-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Step 1: Upload & Extract */}
              <Card className="lg:col-span-5">
                <CardHeader>
                  <div>
                    <CardTitle>1. Upload &amp; Extract Document</CardTitle>
                    <CardDescription>
                      Upload an image or PDF log sheet. Gemini extracts structured JSON; deterministic validation enforces schemas.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Target Workflow Collection</Label>
                    <Select
                      value={targetType}
                      onChange={(e) => {
                        setTargetType(e.target.value as AITargetType);
                        setDraftFields(null);
                      }}
                      options={AI_TARGET_OPTIONS.filter((o) => (o.module === 'nexus' ? nexusOn : environOn)).map((o) => ({
                        value: o.value,
                        label: o.label,
                      }))}
                    />
                  </div>

                  <div>
                    <Label>Plant / Site</Label>
                    <Select
                      value={aiSiteId}
                      onChange={(e) => setAiSiteId(e.target.value)}
                      options={sites.filter((s) => s.status === 'active').map((s) => ({
                        value: s.id,
                        label: `${s.code} — ${s.name}`,
                      }))}
                    />
                  </div>

                  <div>
                    <Label>Document File (PNG, JPG, WebP, or PDF)</Label>
                    <label className="mt-1 flex flex-col items-center justify-center rounded-md border border-dashed border-[#d9dfe5] bg-[#f9fafc] p-5 text-center cursor-pointer hover:bg-[#edf2f8] transition-colors">
                      <FileUp className="h-5 w-5 text-[#555f69] mb-2" />
                      <span className="text-xs font-medium text-[#070e16]">
                        {selectedFile ? selectedFile.name : 'Choose document image or PDF'}
                      </span>
                      <span className="text-[11px] text-[#555f69] mt-0.5">
                        Uploaded to Firebase Storage &amp; processed server-side
                      </span>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>

                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={!selectedFile || !aiSiteId || extracting}
                    onClick={() => void handleRunExtraction()}
                  >
                    <Sparkles className="h-4 w-4" />
                    {extracting ? 'Extracting Structured Fields...' : 'Extract with Gemini AI'}
                  </Button>
                </CardContent>
              </Card>

              {/* Step 2: Human Review & Verification */}
              <Card className="lg:col-span-7">
                <CardHeader>
                  <div>
                    <CardTitle>2. Human Review &amp; Deterministic Verification</CardTitle>
                    <CardDescription>
                      Uncertain or critical fields are flagged. Correct values before committing to Firestore.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  {!draftFields ? (
                    <EmptyState
                      title="No extracted payload ready for review"
                      description="Upload a document and run extraction on the left to inspect and verify structured fields."
                    />
                  ) : (
                    <div className="space-y-4">
                      {uncertainFields.length > 0 && (
                        <div className="rounded-md border border-[#fde68a] bg-[#fffbeb] p-3 text-xs text-[#b45309] flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold">Flagged for Human Verification:</span>{' '}
                            {uncertainFields.join(', ')}
                          </div>
                        </div>
                      )}

                      {validationErrors.length > 0 && (
                        <div className="rounded-md border border-[#fecaca] bg-[#fef2f2] p-3 text-xs text-[#b91c1c] space-y-1">
                          <p className="font-semibold">Schema Validation Errors:</p>
                          {validationErrors.map((err, i) => (
                            <p key={i}>• {err}</p>
                          ))}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Object.entries(draftFields)
                          .filter(([key]) => key !== 'siteId')
                          .map(([key, val]) => {
                            const isFlagged = uncertainFields.includes(key);
                            return (
                              <div key={key}>
                                <Label className="flex items-center justify-between">
                                  <span>{key}</span>
                                  {isFlagged && (
                                    <span className="text-[10px] font-semibold text-[#b45309]">Verify</span>
                                  )}
                                </Label>
                                <Input
                                  value={val === undefined || val === null ? '' : String(val)}
                                  onChange={(e) =>
                                    setDraftFields((prev) => ({
                                      ...(prev || {}),
                                      [key]: e.target.value,
                                    }))
                                  }
                                  className={isFlagged ? 'border-[#d97706] bg-[#fffbeb]/40' : ''}
                                />
                              </div>
                            );
                          })}
                      </div>

                      <div className="flex justify-end gap-2.5 pt-3 border-t border-[#e9eef4]">
                        <Button variant="outline" onClick={() => setDraftFields(null)}>
                          Discard
                        </Button>
                        <Button variant="environ" disabled={savingAi} onClick={() => void handleApproveAndSaveExtracted()}>
                          <CheckCircle2 className="h-4 w-4" />
                          {savingAi ? 'Validating & Saving...' : 'Verify & Save Record'}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Extraction Jobs History */}
            <Card>
              <CardHeader>
                <CardTitle>AI Document Processing Jobs</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {(data?.jobs || []).length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      title="No extraction jobs yet"
                      description="Document intake jobs and their verification status appear here."
                    />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead>Target Collection</TableHead>
                        <TableHead>Flagged Fields</TableHead>
                        <TableHead>Job Status</TableHead>
                        <TableHead>Timestamp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.jobs || []).map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="text-xs font-medium">{job.payload.fileName}</TableCell>
                          <TableCell className="text-xs font-mono-tabular">{job.payload.targetRecordType}</TableCell>
                          <TableCell className="text-xs text-[#555f69]">
                            {job.payload.uncertainFields?.length ? job.payload.uncertainFields.join(', ') : 'None'}
                          </TableCell>
                          <TableCell><StatusBadge tone={statusToTone(job.status)}>{job.status}</StatusBadge></TableCell>
                          <TableCell className="text-xs font-mono-tabular text-[#555f69]">{formatTimestamp(job.createdAt)}</TableCell>
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
    </div>
  );
}
