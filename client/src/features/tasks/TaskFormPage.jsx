import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRightLeft, Check, FolderPlus, Info, Sparkles } from 'lucide-react';
import { Button, Card, ErrorState, Field, Input, Page, PageHeader, Select, Skeleton, Textarea, UnsavedChangesDialog } from '@/components/ui';
import { ClientLogo } from '@/components/data-display';
import { useBreadcrumbs, useClients, useJobs, usePageTitle, useServiceMutation, useTask, useUnsavedChanges, useUsers } from '@/hooks';
import { taskService } from '@/services';
import { taskSchema } from '@/lib/validation';
import { TASK_STATUSES, TASK_TYPES, TOOL_BY_ID } from '@/lib/constants';
import { cn } from '@/lib/utils';

const TYPE_HINTS = {
  writing: 'Emails, SMS, WhatsApp and general copy',
  image: 'On-brand visuals at exact dimensions',
  advertising: 'Headlines, social & search ads, CTAs',
  vehicle: 'Dealership listings from supplied details',
  general: 'Any other work — all AI tools available',
};

function TypePicker({ value, onChange, error }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-[13px] font-medium text-ink">
        Task type<span className="ml-0.5 text-danger" aria-hidden>*</span>
      </legend>
      <div role="radiogroup" aria-label="Task type" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {TASK_TYPES.map((t) => {
          const active = value === t.id;
          const tool = TOOL_BY_ID[t.id];
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(t.id)}
              className={cn(
                'relative flex items-start gap-3 rounded-xl border p-3 text-left transition-[border,box-shadow,background] focus-ring',
                active ? 'border-brand bg-brand-soft/50 shadow-[0_0_0_3px_rgba(98,87,232,0.12)]' : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: tool?.soft || '#F1F2F7', color: tool?.color || '#4E5168' }}>
                <Icon size={17} aria-hidden />
              </span>
              <span className="min-w-0 pr-4">
                <span className="block text-[13px] font-semibold text-ink">{t.label}</span>
                <span className="mt-0.5 block text-xs leading-4 text-muted">{TYPE_HINTS[t.id]}</span>
              </span>
              {active && (
                <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-white">
                  <Check size={11} strokeWidth={3} aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function Section({ title, description, children }) {
  return (
    <div className="grid gap-4 border-b border-line px-5 py-5 last:border-b-0 md:grid-cols-[200px_1fr] md:gap-8">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-muted">{description}</p>}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}

export default function TaskFormPage() {
  const { taskId } = useParams();
  const isEdit = !!taskId;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [savedTo, setSavedTo] = useState(null);

  const { data: task, isLoading: taskLoading, error: taskError, refetch } = useTask(taskId);
  const { data: clients = [], isLoading: clientsLoading } = useClients({ includeArchived: true, sort: 'name' });
  const { data: allJobs = [], isLoading: jobsLoading } = useJobs({ sort: 'name' });
  const { data: users = [] } = useUsers();

  const qClientId = params.get('clientId') || '';
  const qJobId = params.get('jobId') || '';
  const qType = ['writing', 'image', 'advertising', 'vehicle', 'general'].includes(params.get('type')) ? params.get('type') : undefined;

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: '', clientId: qClientId, jobId: qJobId, type: qType, description: '', notes: '', status: 'todo', assigneeId: '' },
  });

  // Load the task into the form when editing.
  useEffect(() => {
    if (task) {
      reset({
        title: task.title,
        clientId: task.clientId,
        jobId: task.jobId,
        type: task.type,
        description: task.description || '',
        notes: task.notes || '',
        status: task.status,
        assigneeId: task.assigneeId || '',
      });
    }
  }, [task, reset]);

  // Deep link with only ?jobId= — derive the client from the job.
  const clientId = watch('clientId');
  const jobId = watch('jobId');
  useEffect(() => {
    if (isEdit || !qJobId || clientId) return;
    const j = allJobs.find((x) => x.id === qJobId);
    if (j) setValue('clientId', j.clientId);
  }, [isEdit, qJobId, clientId, allJobs, setValue]);

  const clientJobs = useMemo(() => allJobs.filter((j) => j.clientId === clientId), [allJobs, clientId]);
  const selectedClient = clients.find((c) => c.id === clientId);
  const jobMoved = isEdit && task && jobId && jobId !== task.jobId;

  const blocker = useUnsavedChanges(isDirty && !savedTo);
  useEffect(() => {
    if (savedTo) navigate(savedTo);
  }, [savedTo, navigate]);

  const mutation = useServiceMutation((values) => (isEdit ? taskService.update(taskId, values) : taskService.create(values)), {
    success: (d) => (isEdit ? `Saved “${d.title}”` : `Created “${d.title}” — opening its AI workspace`),
    onSuccess: (d) => setSavedTo(isEdit ? `/tasks/${d.id}` : `/ai-workspace/${d.id}`),
  });

  const onSubmit = (values) => mutation.mutateAsync({ ...values, assigneeId: values.assigneeId || null }).catch(() => {});

  const backTo = isEdit ? `/tasks/${taskId}` : qJobId ? `/jobs/${qJobId}` : '/tasks';
  const title = isEdit ? 'Edit task' : 'New task';
  useBreadcrumbs(
    isEdit && task
      ? [
          { label: 'Tasks', to: '/tasks' },
          { label: task.title, to: `/tasks/${task.id}` },
          { label: 'Edit' },
        ]
      : [{ label: 'Tasks', to: '/tasks' }, { label: title }],
  );
  usePageTitle(isEdit && task ? `Edit ${task.title}` : title);

  if (isEdit && taskError) {
    return (
      <Page narrow>
        <div className="card">
          <ErrorState error={taskError} onRetry={refetch} />
          <div className="-mt-8 pb-8 text-center">
            <Button as={Link} to="/tasks" icon={ArrowLeft} variant="ghost">
              Back to tasks
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  const loading = (isEdit && taskLoading) || clientsLoading || jobsLoading;

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title={title}
        description={isEdit ? 'Update the task details. Conversations, outputs and approvals are kept.' : 'Tasks hold the AI conversations, outputs and files for one piece of work.'}
        actions={
          <Button as={Link} to={backTo} variant="ghost" icon={ArrowLeft}>
            Back
          </Button>
        }
      />

      {loading ? (
        <Card className="space-y-4 p-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Card>
            <Section title="Basics" description="Name the work and pick the client and job it belongs to.">
              <Field label="Task title" required error={errors.title?.message}>
                <Input {...register('title')} placeholder="e.g. Advertising Images" autoFocus={!isEdit} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  name="clientId"
                  control={control}
                  render={({ field }) => (
                    <Field label="Client" required error={errors.clientId?.message}>
                      <Select
                        name={field.name}
                        ref={field.ref}
                        value={field.value || ''}
                        onBlur={field.onBlur}
                        onChange={(e) => {
                          field.onChange(e.target.value);
                          setValue('jobId', '', { shouldDirty: true });
                        }}
                        placeholder="Select a client"
                        options={clients.map((c) => ({ value: c.id, label: c.status === 'archived' ? `${c.name} (archived)` : c.name }))}
                      />
                    </Field>
                  )}
                />
                <Controller
                  name="jobId"
                  control={control}
                  render={({ field }) => (
                    <Field label="Job" required error={errors.jobId?.message} hint={!clientId ? 'Select a client first — only that client’s jobs are listed.' : undefined}>
                      <Select
                        name={field.name}
                        ref={field.ref}
                        value={field.value || ''}
                        onBlur={field.onBlur}
                        onChange={(e) => field.onChange(e.target.value)}
                        disabled={!clientId || !clientJobs.length}
                        placeholder={!clientId ? 'Select a client first' : clientJobs.length ? 'Select a job' : 'No jobs for this client'}
                        options={clientJobs.map((j) => ({ value: j.id, label: j.status === 'archived' ? `${j.title} (archived)` : j.title }))}
                      />
                    </Field>
                  )}
                />
              </div>
              {selectedClient && (
                <div className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas/60 px-3 py-2">
                  <ClientLogo client={selectedClient} size="sm" />
                  <div className="min-w-0 text-[13px]">
                    <p className="truncate font-medium text-ink">{selectedClient.name}</p>
                    <p className="truncate text-xs text-muted">
                      {selectedClient.industry} · {clientJobs.length} {clientJobs.length === 1 ? 'job' : 'jobs'}
                    </p>
                  </div>
                </div>
              )}
              {clientId && !clientJobs.length && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong bg-canvas/60 px-4 py-3">
                  <p className="text-[13px] text-muted">{selectedClient?.name || 'This client'} has no jobs yet. Tasks must belong to a job.</p>
                  <Button as={Link} to={`/jobs/new?clientId=${clientId}`} size="sm" icon={FolderPlus}>
                    Create a job
                  </Button>
                </div>
              )}
              {jobMoved && (
                <div className="flex gap-2.5 rounded-lg border border-[#F7E4B5] bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
                  <ArrowRightLeft size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <p>
                    This task will move to “{clientJobs.find((j) => j.id === jobId)?.title}”. Its conversations, outputs, versions and files move with it
                    {task.clientId !== clientId ? ` — including to ${selectedClient?.name}` : ''}.
                  </p>
                </div>
              )}
            </Section>

            <Section title="Type" description="Determines the default AI tool in the workspace. General tasks can use every tool.">
              <Controller name="type" control={control} render={({ field }) => <TypePicker value={field.value} onChange={(v) => field.onChange(v)} error={errors.type?.message} />} />
            </Section>

            <Section title="Details" description="Context for the team. The description is also shown in the AI workspace.">
              <Field label="Description" error={errors.description?.message}>
                <Textarea {...register('description')} rows={3} placeholder="What needs to be produced, for which channel, any key messages…" />
              </Field>
              <Field label="Internal notes" hint="Optional. Visible to the team only." error={errors.notes?.message}>
                <Textarea {...register('notes')} rows={3} placeholder="e.g. Sponsor logo must appear bottom-right" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Status" required error={errors.status?.message}>
                  <Select {...register('status')} options={TASK_STATUSES.map((s) => ({ value: s.id, label: s.label }))} />
                </Field>
                <Field label="Responsible" hint={isEdit ? undefined : 'Leave empty to assign it to yourself.'} error={errors.assigneeId?.message}>
                  <Select {...register('assigneeId')} placeholder={isEdit ? 'Unassigned' : 'Me (default)'} options={users.map((u) => ({ value: u.id, label: `${u.name}${u.role ? ` — ${u.role}` : ''}` }))} />
                </Field>
              </div>
            </Section>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-line bg-canvas/60 px-5 py-3">
              <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Info size={13} aria-hidden />
                {isEdit ? 'Saving returns you to the task.' : 'After creating, the task’s AI workspace opens.'}
              </p>
              <div className="flex gap-2">
                <Button as={Link} to={backTo}>
                  Cancel
                </Button>
                {isEdit ? (
                  <Button type="submit" variant="primary" loading={mutation.isPending}>
                    Save changes
                  </Button>
                ) : (
                  <Button type="submit" variant="primary" icon={Sparkles} loading={mutation.isPending}>
                    Create &amp; open workspace
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </form>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </Page>
  );
}
