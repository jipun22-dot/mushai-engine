import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, Eye } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  evaluateOrganisationAlerts,
  listOperationalRecords,
  updateOperationalRecord,
} from '../services/firestoreService';
import { formatTimestamp } from '../lib/utils';
import type { AlertPayload, NotificationPayload, OperationalRecord } from '../types/domain';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { EmptyState, TableSkeleton } from '../components/ui/EmptyState';
import { StatusBadge, statusToTone } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { useToast } from '../components/ui/ToastProvider';

export function AlertsPage() {
  const { activeOrg, selectedSiteId, actor } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const orgId = activeOrg?.id;
  const [scanning, setScanning] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['alerts_and_notifs', orgId, selectedSiteId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) return { alerts: [], notifications: [] };
      const siteOpt = selectedSiteId === 'ALL' ? undefined : selectedSiteId;
      const [alerts, notifications] = await Promise.all([
        listOperationalRecords<AlertPayload>(orgId, 'alerts', { siteId: siteOpt }),
        listOperationalRecords<NotificationPayload>(orgId, 'notifications', { siteId: siteOpt }),
      ]);
      return { alerts, notifications };
    },
  });

  const alerts = data?.alerts || [];
  const notifications = data?.notifications || [];

  const handleRunThresholdScan = async () => {
    if (!activeOrg || !actor) return;
    setScanning(true);
    try {
      const created = await evaluateOrganisationAlerts(activeOrg, actor);
      notify({
        tone: 'info',
        title: 'Threshold Scan Complete',
        description: created > 0 ? `Generated ${created} new deduplicated alert(s).` : 'No new unresolved conditions detected.',
      });
      await queryClient.invalidateQueries({ queryKey: ['alerts_and_notifs', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
    } finally {
      setScanning(false);
    }
  };

  const handleAlertStatus = async (alert: OperationalRecord<AlertPayload>, nextStatus: 'acknowledged' | 'resolved') => {
    if (!orgId || !actor) return;
    await updateOperationalRecord({
      orgId,
      collectionName: 'alerts',
      recordId: alert.id,
      siteId: alert.siteId,
      actor,
      status: nextStatus,
      approvalStatus: nextStatus === 'resolved' ? 'closed' : 'submitted',
      payload: {
        ...alert.payload,
        ...(nextStatus === 'acknowledged' ? { acknowledgedBy: actor.displayName } : { resolvedAt: new Date().toISOString() }),
      },
      auditSummary: `Marked alert ${alert.payload.title} as ${nextStatus}`,
    });
    notify({ tone: 'success', title: `Alert ${nextStatus}` });
    await queryClient.invalidateQueries({ queryKey: ['alerts_and_notifs', orgId] });
    await queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
  };

  const handleMarkNotificationRead = async (ntf: OperationalRecord<NotificationPayload>) => {
    if (!orgId || !actor) return;
    await updateOperationalRecord({
      orgId,
      collectionName: 'notifications',
      recordId: ntf.id,
      siteId: ntf.siteId,
      actor,
      status: 'read',
      payload: { ...ntf.payload, read: true },
    });
    await queryClient.invalidateQueries({ queryKey: ['alerts_and_notifs', orgId] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts & Notifications"
        subtitle="Deduplicated operational threshold alerts and user notifications."
        actions={
          <Button variant="primary" size="sm" disabled={scanning} onClick={() => void handleRunThresholdScan()}>
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning Thresholds...' : 'Run Threshold Scan'}
          </Button>
        }
      />

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Active &amp; Historical Alerts ({alerts.length})</TabsTrigger>
          <TabsTrigger value="notifications">In-App Notifications ({notifications.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Deduplicated System Alerts</CardTitle>
                <CardDescription>
                  Each unresolved condition creates at most one active alert per target record.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <TableSkeleton />
              ) : alerts.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No alerts triggered"
                    description="Permits near expiry, expiring certifications, overdue tasks, critical incidents, and out-of-range quality logs surface here."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Severity</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Alert</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Detected</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <StatusBadge tone={statusToTone(a.payload.severity)}>{a.payload.severity}</StatusBadge>
                        </TableCell>
                        <TableCell className="text-xs font-mono-tabular">{a.payload.category}</TableCell>
                        <TableCell className="text-xs max-w-md">
                          <div className="font-semibold text-[#070e16]">{a.payload.title}</div>
                          <div className="text-[#555f69]">{a.payload.message}</div>
                        </TableCell>
                        <TableCell><StatusBadge tone={statusToTone(a.status)}>{a.status}</StatusBadge></TableCell>
                        <TableCell className="text-xs font-mono-tabular text-[#555f69]">{formatTimestamp(a.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {a.status === 'open' && (
                              <Button variant="outline" size="sm" onClick={() => void handleAlertStatus(a, 'acknowledged')}>
                                <Eye className="h-3.5 w-3.5" /> Acknowledge
                              </Button>
                            )}
                            {a.status !== 'resolved' && (
                              <Button variant="environ" size="sm" onClick={() => void handleAlertStatus(a, 'resolved')}>
                                <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                              </Button>
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
        </TabsContent>

        <TabsContent value="notifications" className="mt-5">
          <Card>
            <CardContent className="p-0">
              {notifications.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No notifications"
                    description="Approval updates and system notifications will appear here."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notifications.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="text-xs font-semibold">{n.payload.title}</TableCell>
                        <TableCell className="text-xs text-[#555f69]">{n.payload.message}</TableCell>
                        <TableCell><StatusBadge tone={n.payload.read ? 'neutral' : 'warning'}>{n.payload.read ? 'Read' : 'Unread'}</StatusBadge></TableCell>
                        <TableCell className="text-xs font-mono-tabular text-[#555f69]">{formatTimestamp(n.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          {!n.payload.read && (
                            <Button variant="outline" size="sm" onClick={() => void handleMarkNotificationRead(n)}>
                              Mark Read
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
    </div>
  );
}
