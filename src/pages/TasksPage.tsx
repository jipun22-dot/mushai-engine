import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MessageSquare, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../lib/permissions';
import {
  createOperationalRecord,
  listOperationalRecords,
  updateOperationalRecord,
} from '../services/firestoreService';
import { taskSchema } from '../lib/validation';
import { createId } from '../lib/utils';
import type { OperationalRecord, TaskPayload } from '../types/domain';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { FilterBar } from '../components/ui/FilterBar';
import { Select } from '../components/ui/Select';
import { EmptyState, TableSkeleton } from '../components/ui/EmptyState';
import { StatusBadge, statusToTone } from '../components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { UniversalForm, type UniversalFieldDef } from '../components/forms/UniversalForm';
import { useToast } from '../components/ui/ToastProvider';

export function TasksPage() {
  const { activeOrg, activeMember, sites, departments, members, selectedSiteId, actor } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const orgId = activeOrg?.id;
  const canCreate = hasPermission(activeMember, 'tasks.create');

  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedTask, setSelectedTask] = React.useState<OperationalRecord<TaskPayload> | null>(null);
  const [commentText, setCommentText] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', orgId, selectedSiteId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) return [];
      return listOperationalRecords<TaskPayload>(orgId, 'tasks', {
        siteId: selectedSiteId === 'ALL' ? undefined : selectedSiteId,
      });
    },
  });

  const filteredTasks = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.payload.title.toLowerCase().includes(q) ||
        t.payload.assignedToName.toLowerCase().includes(q)
      );
    });
  }, [tasks, search, statusFilter]);

  const taskFields: UniversalFieldDef[] = [
    { name: 'title', label: 'Task Title', type: 'text', required: true, colSpan: 2 },
    { name: 'siteId', label: 'Site', type: 'site', required: true, defaultValue: selectedSiteId !== 'ALL' ? selectedSiteId : sites[0]?.id || '' },
    { name: 'departmentId', label: 'Department', type: 'department' },
    { name: 'sourceModule', label: 'Module', type: 'select', required: true, defaultValue: 'core', options: [
      { value: 'core', label: 'Mushai Core' },
      { value: 'nexus', label: 'Nexus Manufacturing' },
      { value: 'environ', label: 'Environ EHS' },
    ] },
    { name: 'priority', label: 'Priority', type: 'select', required: true, defaultValue: 'medium', options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'critical', label: 'Critical' },
    ] },
    { name: 'assignedTo', label: 'Assign To', type: 'user', required: true, defaultValue: actor?.displayName || '' },
    { name: 'dueDate', label: 'Due Date', type: 'date', required: true, defaultValue: new Date().toISOString().slice(0, 10) },
    { name: 'description', label: 'Instructions / Details', type: 'textarea', colSpan: 2 },
  ];

  const handleStatusChange = async (task: OperationalRecord<TaskPayload>, nextStatus: string) => {
    if (!orgId || !actor) return;
    await updateOperationalRecord({
      orgId,
      collectionName: 'tasks',
      recordId: task.id,
      siteId: task.siteId,
      actor,
      status: nextStatus,
      approvalStatus: nextStatus === 'completed' ? 'closed' : 'submitted',
      auditSummary: `Updated task "${task.payload.title}" to ${nextStatus}`,
    });
    notify({ tone: 'success', title: `Task marked ${nextStatus}` });
    await queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
    await queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
  };

  const handleAddComment = async () => {
    if (!orgId || !actor || !selectedTask || !commentText.trim()) return;
    const nextComments = [
      ...(selectedTask.payload.comments || []),
      {
        id: createId('cmt'),
        authorId: actor.uid,
        authorName: actor.displayName,
        text: commentText.trim(),
        createdAt: new Date().toISOString(),
      },
    ];
    await updateOperationalRecord({
      orgId,
      collectionName: 'tasks',
      recordId: selectedTask.id,
      siteId: selectedTask.siteId,
      actor,
      payload: { ...selectedTask.payload, comments: nextComments },
      auditSummary: `Commented on task "${selectedTask.payload.title}"`,
    });
    setCommentText('');
    setSelectedTask({ ...selectedTask, payload: { ...selectedTask.payload, comments: nextComments } });
    await queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operational Tasks"
        subtitle="Cross-module task assignment, due-date tracking, and comment history."
        actions={
          canCreate && (
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Assign Task
            </Button>
          )
        }
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search tasks by title or assignee..."
        onReset={() => {
          setSearch('');
          setStatusFilter('all');
        }}
      >
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40 h-9 text-xs">
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </Select>
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton />
          ) : filteredTasks.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No operational tasks"
                description="Assign tasks from operational findings, permits, or manual follow-ups."
                actionLabel={canCreate ? 'Assign Task' : undefined}
                onAction={canCreate ? () => setCreateOpen(true) : undefined}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs font-medium max-w-xs truncate">{t.payload.title}</TableCell>
                    <TableCell>
                      <StatusBadge tone={t.payload.sourceModule === 'nexus' ? 'nexus' : t.payload.sourceModule === 'environ' ? 'environ' : 'neutral'}>
                        {t.payload.sourceModule}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-xs">{t.payload.assignedToName}</TableCell>
                    <TableCell><StatusBadge tone={statusToTone(t.payload.priority)}>{t.payload.priority}</StatusBadge></TableCell>
                    <TableCell className="text-xs font-mono-tabular">{t.payload.dueDate}</TableCell>
                    <TableCell><StatusBadge tone={statusToTone(t.status)}>{t.status}</StatusBadge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedTask(t)}>
                          <MessageSquare className="h-3.5 w-3.5" /> ({t.payload.comments?.length || 0})
                        </Button>
                        {t.status !== 'completed' && (
                          <Button variant="outline" size="sm" onClick={() => void handleStatusChange(t, 'completed')}>
                            <CheckCircle2 className="h-3.5 w-3.5 text-[#007e46]" /> Complete
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent title="Assign Operational Task" description="Create a tracked task linked to a site and assignee.">
          {orgId && actor && (
            <UniversalForm
              formId="core_task"
              orgId={orgId}
              fields={taskFields}
              schema={taskSchema}
              sites={sites}
              departments={departments}
              members={members}
              allowDraft={false}
              onCancel={() => setCreateOpen(false)}
              onSubmit={async (vals) => {
                await createOperationalRecord<TaskPayload>({
                  orgId,
                  collectionName: 'tasks',
                  siteId: String(vals.siteId),
                  departmentId: vals.departmentId ? String(vals.departmentId) : undefined,
                  module: 'core',
                  recordType: 'task',
                  actor,
                  status: 'open',
                  approvalStatus: 'submitted',
                  payload: {
                    title: String(vals.title),
                    description: String(vals.description || ''),
                    sourceModule: vals.sourceModule as TaskPayload['sourceModule'],
                    assignedTo: String(vals.assignedTo),
                    assignedToName: String(vals.assignedTo),
                    priority: vals.priority as TaskPayload['priority'],
                    dueDate: String(vals.dueDate),
                    comments: [],
                  },
                });
                notify({ tone: 'success', title: 'Task Assigned' });
                setCreateOpen(false);
                await queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
                await queryClient.invalidateQueries({ queryKey: ['overview', orgId] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={selectedTask !== null} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent title={selectedTask?.payload.title || 'Task Details'} description="Task instructions and activity comments">
          {selectedTask && (
            <div className="space-y-4">
              <p className="text-xs text-[#555f69]">{selectedTask.payload.description || 'No additional description.'}</p>
              <div className="space-y-2 max-h-56 overflow-y-auto border-t border-[#e9eef4] pt-3">
                {(selectedTask.payload.comments || []).length === 0 ? (
                  <p className="text-xs text-[#555f69]">No comments yet.</p>
                ) : (
                  selectedTask.payload.comments.map((c) => (
                    <div key={c.id} className="rounded border border-[#e9eef4] p-2.5 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-[#070e16]">{c.authorName}</span>
                        <span className="font-mono-tabular text-[#555f69]">{c.createdAt.slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      <p>{c.text}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a status comment..."
                  className="flex-1 h-9 rounded-md border border-[#d9dfe5] px-3 text-xs"
                />
                <Button variant="primary" size="sm" onClick={() => void handleAddComment()}>
                  Post
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
