import * as React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Factory,
  Leaf,
  Database,
  CheckSquare,
  ClipboardCheck,
  FileBarChart2,
  Bell,
  Building2,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermission, ROLE_LABELS } from '../../lib/permissions';
import { logoutUser } from '../../services/authService';
import { cn } from '../../lib/utils';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
  accent?: 'core' | 'nexus' | 'environ';
  group: 'Command' | 'Workflow' | 'Admin';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    user,
    activeOrg,
    activeMember,
    memberships,
    switchOrganisation,
    sites,
    departments,
    selectedSiteId,
    setSelectedSiteId,
    selectedDepartmentId,
    setSelectedDepartmentId,
  } = useAuth();

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const nexusEnabled = Boolean(activeOrg?.activeModules?.nexus) && hasPermission(activeMember, 'nexus.read');
  const environEnabled = Boolean(activeOrg?.activeModules?.environ) && hasPermission(activeMember, 'environ.read');

  const allNavItems: NavItem[] = [
    {
      to: '/overview',
      label: 'Dashboard',
      icon: LayoutDashboard,
      visible: hasPermission(activeMember, 'dashboard.read'),
      accent: 'core',
      group: 'Command',
    },
    {
      to: '/nexus',
      label: 'Nexus',
      icon: Factory,
      visible: nexusEnabled,
      accent: 'nexus',
      group: 'Command',
    },
    {
      to: '/environ',
      label: 'Environ',
      icon: Leaf,
      visible: environEnabled,
      accent: 'environ',
      group: 'Command',
    },
    {
      to: '/records',
      label: 'Documents & Logs',
      icon: Database,
      visible: hasPermission(activeMember, 'records.read'),
      accent: 'core',
      group: 'Workflow',
    },
    {
      to: '/tasks',
      label: 'Action Queue',
      icon: CheckSquare,
      visible: hasPermission(activeMember, 'dashboard.read'),
      accent: 'core',
      group: 'Workflow',
    },
    {
      to: '/approvals',
      label: 'Approvals',
      icon: ClipboardCheck,
      visible: hasPermission(activeMember, 'records.read'),
      accent: 'core',
      group: 'Workflow',
    },
    {
      to: '/reports',
      label: 'Reports',
      icon: FileBarChart2,
      visible: hasPermission(activeMember, 'reports.read'),
      accent: 'core',
      group: 'Workflow',
    },
    {
      to: '/alerts',
      label: 'Alerts',
      icon: Bell,
      visible: hasPermission(activeMember, 'dashboard.read'),
      accent: 'core',
      group: 'Workflow',
    },
    {
      to: '/organisation',
      label: 'Organisation',
      icon: Building2,
      visible: hasPermission(activeMember, 'dashboard.read'),
      accent: 'core',
      group: 'Admin',
    },
    {
      to: '/settings',
      label: 'Settings',
      icon: Settings,
      visible: hasPermission(activeMember, 'settings.manage'),
      accent: 'core',
      group: 'Admin',
    },
  ];
  const navItems = allNavItems.filter((item) => item.visible);

  const accessibleSites = React.useMemo(() => {
    if (!activeMember) return [];
    if (activeMember.role === 'org_admin' || activeMember.role === 'super_admin') {
      return sites.filter((s) => s.status === 'active');
    }
    return sites.filter((s) => s.status === 'active' && activeMember.siteIds.includes(s.id));
  }, [sites, activeMember]);

  const scopedDepartments = React.useMemo(() => {
    const active = departments.filter((d) => d.status === 'active');
    if (selectedSiteId === 'ALL') return active;
    return active.filter((d) => d.siteId === selectedSiteId);
  }, [departments, selectedSiteId]);

  const currentPageLabel = navItems.find((i) => location.pathname.startsWith(i.to))?.label || 'Workspace';

  const handleSignOut = async () => {
    await logoutUser();
    navigate('/auth');
  };

  const groups: Array<NavItem['group']> = ['Command', 'Workflow', 'Admin'];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-[#d9dfe5]">
      <div className="h-14 px-5 flex items-center justify-between border-b border-[#e9eef4] shrink-0">
        <NavLink to="/overview" className="flex items-center gap-2.5 whitespace-nowrap">
          <div className="h-7 w-7 rounded bg-[#070e16] text-white flex items-center justify-center font-display text-xs font-bold">
            M
          </div>
          <span className="font-display text-sm tracking-tight text-[#070e16] font-semibold">
            MUSHAI
          </span>
        </NavLink>
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1 text-[#555f69] hover:text-[#070e16]"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tenant Organisation Switcher */}
      <div className="px-4 py-3 border-b border-[#e9eef4] bg-[#f9fafc]">
        <label className="block text-[11px] font-medium text-[#555f69] mb-1">
          Organisation
        </label>
        {memberships.length > 1 ? (
          <Select
            value={activeOrg?.id || ''}
            onChange={(e) => void switchOrganisation(e.target.value)}
            options={memberships.map((m) => ({
              value: m.organisationId,
              label: m.organisationName,
            }))}
            className="h-8 text-xs font-medium"
          />
        ) : (
          <div className="text-xs font-semibold text-[#070e16] truncate">
            {activeOrg?.name || 'No Organisation'}
          </div>
        )}
        {activeMember && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#555f69]">
            <span>{ROLE_LABELS[activeMember.role]}</span>
            {activeOrg?.activeModules && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {[
                    activeOrg.activeModules.nexus ? 'Nexus' : null,
                    activeOrg.activeModules.environ ? 'Environ' : null,
                  ]
                    .filter(Boolean)
                    .join(' + ') || 'Core'}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Grouped Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {groups.map((grp) => {
          const items = navItems.filter((i) => i.group === grp);
          if (items.length === 0) return null;
          return (
            <div key={grp} className="space-y-0.5">
              <div className="px-3 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase text-[#555f69]">
                {grp}
              </div>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                        isActive
                          ? item.accent === 'nexus'
                            ? 'bg-[#fef2f2] text-[#e60018]'
                            : item.accent === 'environ'
                              ? 'bg-[#ecfdf5] text-[#007e46]'
                              : 'bg-[#edf2f8] text-[#070e16]'
                          : 'text-[#555f69] hover:text-[#070e16] hover:bg-[#f9fafc]'
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Account Footer */}
      <div className="p-3 border-t border-[#e9eef4] bg-white">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#070e16] truncate">
              {activeMember?.displayName || user?.displayName || 'User'}
            </p>
            <p className="text-[11px] text-[#555f69] truncate">
              {user?.email}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleSignOut()}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#f9fafc] text-[#070e16]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full">{sidebarContent}</div>
          <div className="flex-1 bg-[#070e16]/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb on Left, Scope Selectors & Action on Right */}
        <header className="h-14 bg-white border-b border-[#d9dfe5] px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-1.5 rounded-md border border-[#d9dfe5] text-[#070e16]"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5 text-xs text-[#555f69] whitespace-nowrap truncate">
              <span className="font-medium text-[#070e16] truncate max-w-[160px]">
                {activeOrg?.name || 'Mushai'}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              <span className="font-semibold text-[#070e16]">{currentPageLabel}</span>
            </div>
          </div>

          {/* Plant / Site & Department Context Selectors */}
          <div className="flex items-center gap-2 shrink-0">
            <Select
              value={selectedSiteId}
              onChange={(e) => {
                setSelectedSiteId(e.target.value);
                setSelectedDepartmentId('ALL');
              }}
              aria-label="Filter by site"
              className="h-8 w-[140px] sm:w-[175px] text-xs"
            >
              <option value="ALL">All Authorized Sites</option>
              {accessibleSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </Select>

            <Select
              value={selectedDepartmentId}
              onChange={(e) => setSelectedDepartmentId(e.target.value)}
              aria-label="Filter by department"
              className="hidden sm:flex h-8 w-[160px] text-xs"
            >
              <option value="ALL">All Departments</option>
              {scopedDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </Select>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
