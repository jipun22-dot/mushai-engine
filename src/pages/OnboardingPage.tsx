import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Factory, Leaf, CheckCircle2, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { acceptInvitation, logoutUser } from '../services/authService';
import { createOrganisationWithAdmin, listDepartments, listSites } from '../services/firestoreService';
import { populateMockDataForOrganisation } from '../services/demoSeedService';
import { ROLE_LABELS } from '../lib/permissions';
import type { Invitation } from '../types/domain';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Input, Label } from '../components/ui/Input';
import { useToast } from '../components/ui/ToastProvider';

export function OnboardingPage() {
  const { user, pendingInvitations, refreshContext } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [orgName, setOrgName] = React.useState('');
  const [industry, setIndustry] = React.useState('Discrete & Process Manufacturing');
  const [country, setCountry] = React.useState('');
  const [siteName, setSiteName] = React.useState('Primary Manufacturing Plant');
  const [siteCode, setSiteCode] = React.useState('PLT-01');
  const [deptName, setDeptName] = React.useState('Production & EHS');
  const [nexusEnabled, setNexusEnabled] = React.useState(true);
  const [environEnabled, setEnvironEnabled] = React.useState(true);
  const [seedSampleData, setSeedSampleData] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const handleAcceptInvite = async (inv: Invitation) => {
    if (!user) return;
    setBusy(true);
    try {
      await acceptInvitation(user, inv);
      await refreshContext();
      notify({
        tone: 'success',
        title: `Joined ${inv.organisationName}`,
        description: `Role assigned: ${ROLE_LABELS[inv.role]}`,
      });
      navigate('/overview');
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Unable to accept invitation',
        description: err instanceof Error ? err.message : 'Unexpected error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateOrganisation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!nexusEnabled && !environEnabled) {
      notify({
        tone: 'warning',
        title: 'Select at least one module',
        description: 'Activate Nexus, Environ, or both modules for your organisation.',
      });
      return;
    }

    setBusy(true);
    try {
      const newOrgId = await createOrganisationWithAdmin({
        user: {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || user.email?.split('@')[0] || 'Admin',
        },
        name: orgName,
        industry,
        country,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        activeModules: {
          nexus: nexusEnabled,
          environ: environEnabled,
        },
        initialSiteName: siteName,
        initialSiteCode: siteCode,
        initialDeptName: deptName,
      });

      if (seedSampleData) {
        const [createdSites, createdDepts] = await Promise.all([
          listSites(newOrgId),
          listDepartments(newOrgId),
        ]);
        await populateMockDataForOrganisation({
          orgId: newOrgId,
          actor: {
            uid: user.uid,
            displayName: user.displayName || user.email?.split('@')[0] || 'Admin',
            role: 'org_admin',
          },
          siteIds: createdSites.map((s) => s.id),
          departmentIds: createdDepts.map((d) => d.id),
          includeNexus: nexusEnabled,
          includeEnviron: environEnabled,
        });
      }

      await refreshContext();
      notify({
        tone: 'success',
        title: 'Organisation Provisioned',
        description: `${orgName} is active with ${siteName}.`,
      });
      navigate('/overview');
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Organisation creation failed',
        description: err instanceof Error ? err.message : 'Unexpected error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f9fafc] py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded bg-[#070e16] text-white flex items-center justify-center font-display text-xs font-bold">
              M
            </div>
            <span className="font-display text-sm tracking-tight text-[#070e16] font-semibold">
              MUSHAI SYSTEMS
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void logoutUser()}>
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>

        {pendingInvitations.length > 0 && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Pending Team Invitations</CardTitle>
                <CardDescription>
                  Accept an invitation sent to {user?.email} to join an existing organisation.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingInvitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-md border border-[#d9dfe5] bg-[#f9fafc]"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#070e16]">{inv.organisationName}</p>
                    <p className="text-xs text-[#555f69]">
                      Assigned Role: {ROLE_LABELS[inv.role]} · Sites: {inv.siteIds.length}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleAcceptInvite(inv)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Accept Invitation
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <Building2 className="h-4 w-4 text-[#070e16]" />
              <div>
                <CardTitle>Register New Organisation</CardTitle>
                <CardDescription>
                  Establish your isolated tenant, select licensed modules, and configure your initial plant site.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleCreateOrganisation(e)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label htmlFor="org_name">Organisation Legal / Operating Name *</Label>
                  <Input
                    id="org_name"
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Apex Precision Manufacturing Ltd."
                  />
                </div>

                <div>
                  <Label htmlFor="org_industry">Industry Sector</Label>
                  <Input
                    id="org_industry"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="Automotive, Chemical, Packaging..."
                  />
                </div>

                <div>
                  <Label htmlFor="org_country">Country / Region</Label>
                  <Input
                    id="org_country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="India / Germany / United States"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-[#e9eef4]">
                <Label>Licensed Operational Modules</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setNexusEnabled((v) => !v)}
                    className={`text-left p-4 rounded-md border transition-colors cursor-pointer ${
                      nexusEnabled
                        ? 'border-[#e60018] bg-[#fef2f2]'
                        : 'border-[#d9dfe5] bg-white hover:bg-[#f9fafc]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#070e16]">
                        <Factory className="h-4 w-4 text-[#e60018]" />
                        Nexus
                      </span>
                      <span className="text-xs font-medium text-[#e60018]">
                        {nexusEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <p className="text-xs text-[#555f69] mt-1.5">
                      Production logs, shift handovers, downtime, workforce, visitors &amp; quality lab.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEnvironEnabled((v) => !v)}
                    className={`text-left p-4 rounded-md border transition-colors cursor-pointer ${
                      environEnabled
                        ? 'border-[#007e46] bg-[#ecfdf5]'
                        : 'border-[#d9dfe5] bg-white hover:bg-[#f9fafc]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#070e16]">
                        <Leaf className="h-4 w-4 text-[#007e46]" />
                        Environ
                      </span>
                      <span className="text-xs font-medium text-[#007e46]">
                        {environEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <p className="text-xs text-[#555f69] mt-1.5">
                      Safety observations, incidents, permit-to-work, compliance, environment &amp; CAPA.
                    </p>
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-[#e9eef4] grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="site_name">Initial Plant / Site Name *</Label>
                  <Input
                    id="site_name"
                    required
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="site_code">Site Code *</Label>
                  <Input
                    id="site_code"
                    required
                    value={siteCode}
                    onChange={(e) => setSiteCode(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="dept_name">Initial Department *</Label>
                  <Input
                    id="dept_name"
                    required
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-[#e9eef4]">
                <label className="inline-flex items-center gap-2 text-xs text-[#070e16] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={seedSampleData}
                    onChange={(e) => setSeedSampleData(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d9dfe5] accent-[#070e16]"
                  />
                  <span>Populate sample Nexus &amp; Environ mock data for immediate dashboard evaluation</span>
                </label>

                <Button type="submit" variant="primary" size="lg" disabled={busy}>
                  {busy ? 'Provisioning Tenant...' : 'Create Organisation & Launch Workspace'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
