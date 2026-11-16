import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Lock, History } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { canApproveModule } from '../lib/permissions';
import { listOperationalRecords, transitionApproval } from '../services/firestoreService';
import { formatTimestamp } from '../lib/utils';
import type { ApprovalPayload, ApprovalStatus, OperationalRecord } from '../types/domain';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { Input, Label } from '../components/ui/Input';
import { EmptyState, TableSkeleton } from '../components/ui/EmptyState';
import { StatusBadge, statusToTone } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { useToast } from '../components/ui/ToastProvider';

export function ApprovalsPage() {
  const { activeOrg, activeMember, selectedSiteId, actor } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const orgId = activeOrg?.id;
  const [stateFilter, setStateFilter] = React.useState<'all' | 'pending' | 'resolved'>('pending');
  const [activeApproval, setActiveApproval] = React.useState<OperationalRecord<ApprovalPayload> | null>(null);
  const [comment, setComment] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const { data: approvals = [], isLoading } = useQuery({
    queryKey: ['approvals', orgId, selectedSiteId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) return [];
      return listOperationalRecords<ApprovalPayload>(orgId, 'approvals', {
        siteId: selectedSiteId === 'ALL' ? undefined : selectedSiteId,
      });
    },
  });

  const filtered = React.useMemo(() => {
    return approvals.filter((a) => {
      if (stateFilter === 'pending') {
        return a.approvalStatus === 'pending_approval' || a.approvalStatus === 'submitted';
      }
      if (stateFilter === 'resolved') {
        return a.approvalStatus === 'approved' || a.approvalStatus === 'rejected' || a.approvalStatus === 'closed';
      }
      return true;
    });
  }, [approvals, stateFilter]);

  const executeDecision = async (nextState: ApprovalStatus) => {
    if (!orgId || !actor || !activeApproval) return;
    setBusy(true);
    try {
      await transitionApproval({
        orgId,
        approvalRecord: activeApproval,
        nextState,
        comment,
        actor,
      });
      notify({
        tone: 'success',
        title: `Record ${nextState.toUpperCase()}`,
        description: activeApproval.payload.recordTitle,
      });
      setActiveApproval(null);
      setComment('');
      await queryClient.invalidateQueries({ queryKey: ['approvals', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Approval Action Failed',
        description: err instanceof Error ? err.message : 'Unable to update approval state',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals & Sign-Off Queue"
        subtitle="Multi-stage operational approvals with complete decision history and audit logging."
        actions={
          <div className="flex items-center gap-1 p-1 bg-[#edf2f8] rounded-md border border-[#d9dfe5]">
            {(['pending', 'resolved', 'all'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setStateFilter(key)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer capitalize ${
                  stateFilter === key ? 'bg-white text-[#070e16] shadow-xs' : 'text-[#555f69] hover:text-[#070e16]'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        }
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton />
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No approvals in this view"
                description="Submitted production logs, shift reports, incidents, and work permits appear here for sign-off."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs font-medium">{a.payload.recordTitle}</TableCell>
                    <TableCell>
                      <StatusBadge tone={a.payload.targetModule === 'nexus' ? 'nexus' : a.payload.targetModule === 'environ' ? 'environ' : 'neutral'}>
                        {a.payload.targetModule.toUpperCase()}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-xs">{a.payload.requestedByName}</TableCell>
                    <TableCell><StatusBadge tone={statusToTone(a.approvalStatus)}>{a.approvalStatus}</StatusBadge></TableCell>
                    <TableCell className="text-xs font-mono-tabular text-[#555f69]">{formatTimestamp(a.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setActiveApproval(a)}>
                        <History className="h-3.5 w-3.5" /> Inspect &amp; Decide
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={activeApproval !== null} onOpenChange={(open) => !open && setActiveApproval(null)}>
        <DialogContent
          title={activeApproval?.payload.recordTitle || 'Approval Review'}
          description={`Collection: ${activeApproval?.payload.recordCollection || ''} · Current State: ${activeApproval?.approvalStatus || ''}`}
        >
          {activeApproval && (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#070e16]">Approval History</p>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {(activeApproval.payload.history || []).map((h, i) => (
                    <div key={i} className="rounded border border-[#e9eef4] p-2.5 text-xs bg-[#f9fafc]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-[#070e16]">
                          {h.actorName} · <span className="uppercase">{h.state}</span>
                        </span>
                        <span className="font-mono-tabular text-[#555f69]">{h.timestamp.slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      <p className="text-[#555f69]">{h.comment}</p>
                    </div>
                  ))}
                </div>
              </div>

              {canApproveModule(activeMember, activeApproval.payload.targetModule) &&
                activeApproval.approvalStatus !== 'closed' && (
                  <div className="space-y-3 pt-3 border-t border-[#e9eef4]">
                    <div>
                      <Label htmlFor="apr_comment">Decision Comment</Label>
                      <Input
                        id="apr_comment"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Add verification notes or rejection reason..."
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => void executeDecision('rejected')}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button
                        variant="environ"
                        size="sm"
                        disabled={busy}
                        onClick={() => void executeDecision('approved')}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void executeDecision('closed')}
                      >
                        <Lock className="h-3.5 w-3.5" /> Approve &amp; Close
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
