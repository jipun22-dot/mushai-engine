import * as React from 'react';
import { Database, Factory, Leaf, Plus, Save, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { evaluateOrganisationAlerts, updateOrganisationConfig } from '../services/firestoreService';
import { populateMockDataForOrganisation } from '../services/demoSeedService';
import { createId } from '../lib/utils';
import type { QualityParameterConfig } from '../types/domain';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Input';
import { useToast } from '../components/ui/ToastProvider';

export function SettingsPage() {
  const { activeOrg, activeMember, sites, departments, actor, refreshContext } = useAuth();
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const [name, setName] = React.useState(activeOrg?.name || '');
  const [industry, setIndustry] = React.useState(activeOrg?.industry || '');
  const [country, setCountry] = React.useState(activeOrg?.country || '');
  const [nexusEnabled, setNexusEnabled] = React.useState(Boolean(activeOrg?.activeModules?.nexus));
  const [environEnabled, setEnvironEnabled] = React.useState(Boolean(activeOrg?.activeModules?.environ));
  const [permitExpiryHours, setPermitExpiryHours] = React.useState(
    activeOrg?.alertThresholds?.permitExpiryHours ?? 24
  );
  const [certificationExpiryDays, setCertificationExpiryDays] = React.useState(
    activeOrg?.alertThresholds?.certificationExpiryDays ?? 30
  );
  const [permitTypesText, setPermitTypesText] = React.useState(
    (activeOrg?.alertThresholds?.permitTypes || ['Hot Work', 'Confined Space', 'Electrical Work', 'Work at Height']).join(', ')
  );
  const [qualityParams, setQualityParams] = React.useState<QualityParameterConfig[]>(
    activeOrg?.alertThresholds?.qualityParameters || []
  );
  const [saving, setSaving] = React.useState(false);
  const [populatingMock, setPopulatingMock] = React.useState(false);

  React.useEffect(() => {
    if (!activeOrg) return;
    setName(activeOrg.name);
    setIndustry(activeOrg.industry || '');
    setCountry(activeOrg.country || '');
    setNexusEnabled(activeOrg.activeModules.nexus);
    setEnvironEnabled(activeOrg.activeModules.environ);
    setPermitExpiryHours(activeOrg.alertThresholds?.permitExpiryHours ?? 24);
    setCertificationExpiryDays(activeOrg.alertThresholds?.certificationExpiryDays ?? 30);
    setPermitTypesText(
      (activeOrg.alertThresholds?.permitTypes || ['Hot Work', 'Confined Space', 'Electrical Work', 'Work at Height']).join(', ')
    );
    setQualityParams(activeOrg.alertThresholds?.qualityParameters || []);
  }, [activeOrg]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg || !actor) return;
    if (!nexusEnabled && !environEnabled) {
      notify({
        tone: 'warning',
        title: 'Module Required',
        description: 'At least one operational module (Nexus or Environ) must remain enabled.',
      });
      return;
    }

    setSaving(true);
    try {
      const permitTypes = permitTypesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await updateOrganisationConfig(activeOrg.id, actor, {
        name: name.trim(),
        industry: industry.trim(),
        country: country.trim(),
        activeModules: {
          nexus: nexusEnabled,
          environ: environEnabled,
        },
        alertThresholds: {
          permitExpiryHours: Number(permitExpiryHours) || 24,
          certificationExpiryDays: Number(certificationExpiryDays) || 30,
          permitTypes,
          qualityParameters: qualityParams,
        },
      });
      await refreshContext();
      notify({ tone: 'success', title: 'Organisation Settings Saved' });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Save Failed',
        description: err instanceof Error ? err.message : 'Unable to update settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePopulateSampleData = async () => {
    if (!activeOrg || !activeMember || !actor) return;
    setPopulatingMock(true);
    try {
      const targetSiteIds = sites.filter((s) => s.status === 'active').map((s) => s.id);
      const safeSiteIds = targetSiteIds.length > 0 ? targetSiteIds : ['site_plt_01'];
      const targetDeptIds = departments
        .filter((d) => d.status === 'active' && safeSiteIds.includes(d.siteId))
        .map((d) => d.id);

      const res = await populateMockDataForOrganisation({
        orgId: activeOrg.id,
        actor: {
          uid: actor.uid,
          displayName: actor.displayName,
          role: activeMember.role,
        },
        siteIds: safeSiteIds,
        departmentIds: targetDeptIds,
        includeNexus: Boolean(activeOrg.activeModules.nexus),
        includeEnviron: Boolean(activeOrg.activeModules.environ),
      });

      await evaluateOrganisationAlerts(activeOrg, actor);
      await queryClient.invalidateQueries();
      notify({
        tone: 'success',
        title: 'Sample mock data populated',
        description: `Created ${res.recordsCreated} operational records in ${activeOrg.name}.`,
      });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Population Failed',
        description: err instanceof Error ? err.message : 'Unable to populate mock data',
      });
    } finally {
      setPopulatingMock(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSaveSettings(e)} className="space-y-6">
      <PageHeader
        title="Platform Settings & Module Licensing"
        subtitle="Configure organisation profile, independently activate Nexus or Environ, and tune compliance thresholds."
        actions={
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Organisation Profile</CardTitle>
              <CardDescription>Tenant metadata and operating region</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Organisation Name</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Industry</Label>
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} />
            </div>
            <div>
              <Label>Country</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Independent Module Activation</CardTitle>
              <CardDescription>Enable Nexus, Environ, or both for this organisation</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <button
              type="button"
              onClick={() => setNexusEnabled((v) => !v)}
              className={`w-full text-left p-4 rounded-md border transition-colors cursor-pointer ${
                nexusEnabled ? 'border-[#e60018] bg-[#fef2f2]' : 'border-[#d9dfe5] bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#070e16]">
                  <Factory className="h-4 w-4 text-[#e60018]" /> Nexus — Manufacturing Operations
                </span>
                <span className="text-xs font-semibold text-[#e60018]">
                  {nexusEnabled ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setEnvironEnabled((v) => !v)}
              className={`w-full text-left p-4 rounded-md border transition-colors cursor-pointer ${
                environEnabled ? 'border-[#007e46] bg-[#ecfdf5]' : 'border-[#d9dfe5] bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#070e16]">
                  <Leaf className="h-4 w-4 text-[#007e46]" /> Environ — EHS &amp; Sustainability
                </span>
                <span className="text-xs font-semibold text-[#007e46]">
                  {environEnabled ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Alert &amp; Permit Thresholds</CardTitle>
              <CardDescription>Advance warning windows and configurable Permit-to-Work categories</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Permit Expiry Warning (Hours)</Label>
                <Input
                  type="number"
                  min={1}
                  value={permitExpiryHours}
                  onChange={(e) => setPermitExpiryHours(Number(e.target.value))}
                  className="font-mono-tabular"
                />
              </div>
              <div>
                <Label>Certification Expiry Warning (Days)</Label>
                <Input
                  type="number"
                  min={1}
                  value={certificationExpiryDays}
                  onChange={(e) => setCertificationExpiryDays(Number(e.target.value))}
                  className="font-mono-tabular"
                />
              </div>
            </div>
            <div>
              <Label>Configurable Permit-to-Work Types (comma separated)</Label>
              <Input value={permitTypesText} onChange={(e) => setPermitTypesText(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Configurable Quality Acceptance Parameters</CardTitle>
              <CardDescription>Default parameter templates for Nexus Quality &amp; Lab logs</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setQualityParams((prev) => [
                  ...prev,
                  { id: createId('qp'), parameter: 'New Parameter', unit: 'mm', minLimit: 0, maxLimit: 10 },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add Parameter
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {qualityParams.map((qp, idx) => (
              <div key={qp.id} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-4 h-8 text-xs"
                  value={qp.parameter}
                  onChange={(e) =>
                    setQualityParams((prev) => prev.map((p, i) => (i === idx ? { ...p, parameter: e.target.value } : p)))
                  }
                />
                <Input
                  className="col-span-2 h-8 text-xs"
                  value={qp.unit}
                  onChange={(e) =>
                    setQualityParams((prev) => prev.map((p, i) => (i === idx ? { ...p, unit: e.target.value } : p)))
                  }
                />
                <Input
                  type="number"
                  step="0.01"
                  className="col-span-2 h-8 text-xs font-mono-tabular"
                  value={qp.minLimit}
                  onChange={(e) =>
                    setQualityParams((prev) => prev.map((p, i) => (i === idx ? { ...p, minLimit: Number(e.target.value) } : p)))
                  }
                />
                <Input
                  type="number"
                  step="0.01"
                  className="col-span-3 h-8 text-xs font-mono-tabular"
                  value={qp.maxLimit}
                  onChange={(e) =>
                    setQualityParams((prev) => prev.map((p, i) => (i === idx ? { ...p, maxLimit: Number(e.target.value) } : p)))
                  }
                />
                <button
                  type="button"
                  onClick={() => setQualityParams((prev) => prev.filter((_, i) => i !== idx))}
                  className="col-span-1 text-[#555f69] hover:text-[#e60018] flex justify-center cursor-pointer"
                  aria-label="Remove parameter"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Sample Operational Mock Data</CardTitle>
            <CardDescription>
              Populate realistic Nexus production runs, downtime/quality checks, Environ permits, safety observations, compliance certifications, emissions baselines, tasks, and approvals into this organisation.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={populatingMock}
            onClick={() => void handlePopulateSampleData()}
          >
            <Database className="h-3.5 w-3.5" />
            {populatingMock ? 'Populating...' : 'Populate Mock Data'}
          </Button>
        </CardHeader>
      </Card>
    </form>
  );
}
