import * as React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { hasPermission } from './lib/permissions';
import { ToastProvider } from './components/ui/ToastProvider';
import { AppShell } from './components/layout/AppShell';
import { AuthPage } from './pages/AuthPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OverviewDashboard } from './pages/OverviewDashboard';
import { NexusPage } from './pages/NexusPage';
import { EnvironPage } from './pages/EnvironPage';
import { RecordsPage } from './pages/RecordsPage';
import { TasksPage } from './pages/TasksPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ReportsPage } from './pages/ReportsPage';
import { AlertsPage } from './pages/AlertsPage';
import { OrganisationPage } from './pages/OrganisationPage';
import { SettingsPage } from './pages/SettingsPage';
import { EmptyState } from './components/ui/EmptyState';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#f9fafc] flex items-center justify-center p-6">
          <div className="max-w-lg w-full">
            <EmptyState
              title="Application Error"
              description={this.state.message}
              actionLabel="Reload Application"
              onAction={() => window.location.reload()}
            />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, authReady, loadingContext, activeOrg, activeMember } = useAuth();

  if (!authReady || loadingContext) {
    return (
      <div className="min-h-screen bg-[#f9fafc] flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 rounded bg-[#070e16] text-white flex items-center justify-center font-display text-xs font-bold mx-auto">
            M
          </div>
          <p className="text-xs text-[#555f69]">Loading Mushai Systems workspace...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!activeOrg || !activeMember) {
    return <Navigate to="/onboarding" replace />;
  }

  return <AppShell>{children}</AppShell>;
}

function ModuleRoute({
  moduleKey,
  children,
}: {
  moduleKey: 'nexus' | 'environ';
  children: React.ReactNode;
}) {
  const { activeOrg, activeMember } = useAuth();
  const isEnabled =
    moduleKey === 'nexus'
      ? Boolean(activeOrg?.activeModules?.nexus) && hasPermission(activeMember, 'nexus.read')
      : Boolean(activeOrg?.activeModules?.environ) && hasPermission(activeMember, 'environ.read');

  if (!isEnabled) {
    return (
      <EmptyState
        title={`${moduleKey === 'nexus' ? 'Nexus' : 'Environ'} Module Not Active`}
        description="This module is either not enabled for your organisation or your role lacks read permissions."
      />
    );
  }
  return <>{children}</>;
}

function SettingsRoute() {
  const { activeMember } = useAuth();
  if (!hasPermission(activeMember, 'settings.manage')) {
    return (
      <EmptyState
        title="Access Restricted"
        description="Only Organisation Admins can modify tenant settings and module licensing."
      />
    );
  }
  return <SettingsPage />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/auth" element={<AuthPage />} />
                <Route
                  path="/onboarding"
                  element={
                    <OnboardingGate />
                  }
                />
                <Route
                  path="/overview"
                  element={
                    <ProtectedLayout>
                      <OverviewDashboard />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/nexus"
                  element={
                    <ProtectedLayout>
                      <ModuleRoute moduleKey="nexus">
                        <NexusPage />
                      </ModuleRoute>
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/environ"
                  element={
                    <ProtectedLayout>
                      <ModuleRoute moduleKey="environ">
                        <EnvironPage />
                      </ModuleRoute>
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/records"
                  element={
                    <ProtectedLayout>
                      <RecordsPage />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/tasks"
                  element={
                    <ProtectedLayout>
                      <TasksPage />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/approvals"
                  element={
                    <ProtectedLayout>
                      <ApprovalsPage />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <ProtectedLayout>
                      <ReportsPage />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/alerts"
                  element={
                    <ProtectedLayout>
                      <AlertsPage />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/organisation"
                  element={
                    <ProtectedLayout>
                      <OrganisationPage />
                    </ProtectedLayout>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedLayout>
                      <SettingsRoute />
                    </ProtectedLayout>
                  }
                />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function OnboardingGate() {
  const { user, authReady, loadingContext, activeOrg } = useAuth();
  if (!authReady || loadingContext) {
    return (
      <div className="min-h-screen bg-[#f9fafc] flex items-center justify-center text-xs text-[#555f69]">
        Loading session...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/auth" replace />;
  }
  if (activeOrg) {
    return <Navigate to="/overview" replace />;
  }
  return <OnboardingPage />;
}
