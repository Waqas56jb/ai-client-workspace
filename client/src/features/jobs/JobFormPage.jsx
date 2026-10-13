import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRightLeft, UserPlus } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Page, PageHeader, Select, Skeleton, Textarea, UnsavedChangesDialog } from '@/components/ui';
import { ClientLogo, ClientStatusBadge } from '@/components/data-display';
import { useBreadcrumbs, useClients, useJob, usePageTitle, useServiceMutation, useUnsavedChanges } from '@/hooks';
import { jobService } from '@/services';
import { jobSchema } from '@/lib/validation';
import { JOB_STATUSES } from '@/lib/constants';
import { pluralize } from '@/lib/utils';

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

export default function JobFormPage() {
  const { jobId } = useParams();
  const isEdit = !!jobId;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [savedTo, setSavedTo] = useState(null);
  const [pending, setPending] = useState(null);

  const { data: job, isLoading: jobLoading, error: jobError, refetch } = useJob(jobId);
  const { data: clients = [], isLoading: clientsLoading } = useClients({ includeArchived: true, sort: 'name' });
  const qClientId = params.get('clientId') || '';

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(jobSchema),
    defaultValues: { title: '', clientId: qClientId, description: '', deadline: '', status: 'active', notes: '' },
  });

  useEffect(() => {
    if (job) {
      reset({
        title: job.title,
        clientId: job.clientId,
        description: job.description || '',
        deadline: job.deadline ? job.deadline.slice(0, 10) : '',
        status: job.status,
        notes: job.notes || '',
      });
    }
  }, [job, reset]);

  const clientId = watch('clientId');
  const client = clients.find((c) => c.id === clientId);
  const clientChanged = isEdit && job && clientId && clientId !== job.clientId;

  const blocker = useUnsavedChanges(isDirty && !savedTo);
  useEffect(() => {
    if (savedTo) navigate(savedTo);
  }, [savedTo, navigate]);

  // Archiving/restoring are separate actions; the form never sends status "archived" (the API rejects it).
  const isArchived = job?.status === 'archived';
  const statusOptions = (isArchived ? JOB_STATUSES : JOB_STATUSES.filter((s) => s.id !== 'archived')).map((s) => ({ value: s.id, label: s.label }));
  const mutation = useServiceMutation((input) => {
    const { status, ...rest } = input;
    const values = status === 'archived' ? rest : input;
    return isEdit ? jobService.update(jobId, values) : jobService.create(values);
  }, {
    success: (d) => (isEdit ? (clientChanged ? `Moved “${d.title}” to ${d.client?.name}` : `Saved “${d.title}”`) : `Created “${d.title}”`),
    onSuccess: (d) => {
      setPending(null);
      setSavedTo(`/jobs/${d.id}`);
    },
  });

  const save = (values) => mutation.mutateAsync(values).catch(() => {});
  const onSubmit = (values) => {
    if (clientChanged) {
      setPending(values);
      return undefined;
    }
    return save(values);
  };

  const title = isEdit ? 'Edit job' : 'New job';
  useBreadcrumbs(
    isEdit && job
      ? [
          { label: 'Clients', to: '/clients' },
          ...(job.client ? [{ label: job.client.name, to: `/clients/${job.clientId}` }] : []),
          { label: 'Jobs', to: `/clients/${job.clientId}/jobs` },
          { label: job.title, to: `/jobs/${job.id}` },
          { label: 'Edit' },
        ]
      : [{ label: 'Jobs', to: '/jobs' }, { label: title }],
  );
  usePageTitle(isEdit && job ? `Edit ${job.title}` : title);

  const backTo = isEdit ? `/jobs/${jobId}` : qClientId ? `/clients/${qClientId}` : '/jobs';

  if (isEdit && jobError) {
    return (
      <Page narrow>
        <div className="card pb-8">
          <ErrorState error={jobError} onRetry={refetch} />
          <div className="text-center">
            <Button as={Link} to="/jobs" icon={ArrowLeft}>
              Back to jobs
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  const loading = (isEdit && jobLoading) || clientsLoading;
  const selectable = clients.filter((c) => c.status !== 'archived' || c.id === job?.clientId || c.id === qClientId);

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title={title}
        description={isEdit ? 'Update this job. Tasks, outputs and files stay attached.' : 'A job groups the tasks for one client campaign or project.'}
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
      ) : !clients.length ? (
        <Card>
          <EmptyState
            icon={UserPlus}
            title="Add a client first"
            description="Every job belongs to a client. Create a client, then come back to add its jobs."
            action={
              <Button as={Link} to="/clients/new" variant="primary" icon={UserPlus}>
                New client
              </Button>
            }
          />
        </Card>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <Card>
            <Section title="Client" description="The client this job is for. Brand settings from the client apply to every task.">
              <Field label="Client" required error={errors.clientId?.message}>
                <Select {...register('clientId')} placeholder="Select a client" options={selectable.map((c) => ({ value: c.id, label: c.status === 'archived' ? `${c.name} (archived)` : c.name }))} />
              </Field>
              {client && (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas/60 px-3.5 py-3">
                  <ClientLogo client={client} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ink">{client.name}</p>
                    <p className="truncate text-xs text-muted">
                      {client.industry} · {pluralize(client.jobCount, 'job')} · {pluralize(client.taskCount, 'task')}
                    </p>
                  </div>
                  <ClientStatusBadge status={client.status} />
                </div>
              )}
              {clientChanged && (
                <div className="flex gap-2.5 rounded-lg border border-[#F7E4B5] bg-warning-soft px-3 py-2.5 text-[13px] text-warning" role="status">
                  <ArrowRightLeft size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <p>
                    Moving this job from <strong>{job.client?.name}</strong> to <strong>{client?.name}</strong> also moves its {pluralize(job.taskCount, 'task')}, {pluralize(job.outputCount || 0, 'output')} and{' '}
                    {pluralize(job.fileCount || 0, 'file')}. Future AI requests will use the new client’s brand settings.
                  </p>
                </div>
              )}
            </Section>

            <Section title="Job details" description="Name and describe the campaign or project.">
              <Field label="Job title" required error={errors.title?.message}>
                <Input {...register('title')} placeholder="e.g. Cup 2026" autoFocus={!isEdit} />
              </Field>
              <Field label="Description" error={errors.description?.message}>
                <Textarea {...register('description')} rows={3} placeholder="What is this job about? Channels, goals, key dates…" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Deadline" hint="Optional" error={errors.deadline?.message}>
                  <Input type="date" {...register('deadline')} />
                </Field>
                <Field label="Status" required error={errors.status?.message} hint={isArchived ? 'Restore the job to change its status.' : undefined}>
                  <Select {...register('status')} options={statusOptions} />
                </Field>
              </div>
            </Section>

            <Section title="Internal notes" description="Only visible to your team.">
              <Field label="Notes" error={errors.notes?.message}>
                <Textarea {...register('notes')} rows={4} placeholder="e.g. Sponsor logo bottom-right on every asset" />
              </Field>
            </Section>

            <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-line bg-canvas/60 px-5 py-3">
              <Button as={Link} to={backTo}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={mutation.isPending}>
                {isEdit ? 'Save changes' : 'Create job'}
              </Button>
            </div>
          </Card>
        </form>
      )}

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => save(pending)}
        loading={mutation.isPending}
        icon={ArrowRightLeft}
        title={`Move job to ${client?.name || 'another client'}?`}
        description={`All ${pluralize(job?.taskCount || 0, 'task')}, outputs, versions and files in “${job?.title}” will move with it. Nothing is deleted.`}
        confirmLabel="Move job"
      />
      <UnsavedChangesDialog blocker={blocker} />
    </Page>
  );
}
