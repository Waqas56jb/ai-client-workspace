import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Building2, Contact, Link2, NotebookPen, Save } from 'lucide-react';
import { Button, Card, CardHeader, ErrorState, Field, Input, Page, PageHeader, Select, Skeleton, Textarea, UnsavedChangesDialog } from '@/components/ui';
import { useBreadcrumbs, useClient, usePageTitle, useServiceMutation, useUnsavedChanges } from '@/hooks';
import { clientService } from '@/services';
import { clientSchema } from '@/lib/validation';
import { CLIENT_STATUSES } from '@/lib/constants';
import { slugify } from '@/lib/utils';

const EMPTY = {
  name: '',
  slug: '',
  industry: '',
  status: 'active',
  description: '',
  address: '',
  contactName: '',
  email: '',
  phone: '',
  website: '',
  notes: '',
};

const INDUSTRY_SUGGESTIONS = [
  'Automotive',
  'Construction & Trades',
  'Education',
  'Finance & Insurance',
  'Food & Hospitality',
  'Health & Wellness',
  'Professional Services',
  'Real Estate',
  'Retail & E-commerce',
  'Sports & Events',
  'Technology',
  'Travel & Tourism',
];

function toValues(client) {
  return Object.fromEntries(Object.keys(EMPTY).map((k) => [k, client?.[k] ?? EMPTY[k]]));
}

function FormSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      {[0, 1].map((i) => (
        <div key={i} className="card space-y-4 p-5">
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ClientFormPage() {
  const { clientId } = useParams();
  const isEdit = !!clientId;
  const { data: client, isLoading, error, refetch } = useClient(clientId);

  useBreadcrumbs(
    isEdit
      ? [{ label: 'Clients', to: '/clients' }, { label: client?.name || 'Client', to: `/clients/${clientId}` }, { label: 'Edit' }]
      : [{ label: 'Clients', to: '/clients' }, { label: 'New client' }],
  );
  usePageTitle(isEdit ? `Edit ${client?.name || 'client'}` : 'New client');

  if (isEdit && isLoading) {
    return (
      <Page narrow>
        <PageHeader title="Edit client" description="Loading client details…" />
        <FormSkeleton />
      </Page>
    );
  }
  if (isEdit && error) {
    return (
      <Page narrow>
        <div className="card">
          <ErrorState
            error={error.status === 404 ? { ...error, status: 404, message: 'This client doesn’t exist or has been deleted.' } : error}
            onRetry={refetch}
          />
          <div className="-mt-8 flex justify-center pb-10">
            <Button as={Link} to="/clients" icon={ArrowLeft}>
              Back to clients
            </Button>
          </div>
        </div>
      </Page>
    );
  }
  return <ClientForm key={clientId || 'new'} client={isEdit ? client : null} />;
}

function ClientForm({ client }) {
  const navigate = useNavigate();
  const isEdit = !!client;
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [leaveTo, setLeaveTo] = useState(null);
  const initial = useRef(toValues(client));

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({ resolver: zodResolver(clientSchema), defaultValues: initial.current, mode: 'onTouched' });

  const blocker = useUnsavedChanges(isDirty && !leaveTo);

  useEffect(() => {
    if (leaveTo) navigate(leaveTo, { replace: !isEdit });
  }, [leaveTo, navigate, isEdit]);

  const name = watch('name');
  useEffect(() => {
    if (!slugTouched) setValue('slug', slugify(name || ''), { shouldValidate: !!name && !!errors.slug, shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, slugTouched, setValue]);

  // Archiving/restoring are separate actions; the form never sends status "archived" (the API rejects it).
  const isArchived = client?.status === 'archived';
  const statusOptions = (isArchived ? CLIENT_STATUSES : CLIENT_STATUSES.filter((s) => s.id !== 'archived')).map((s) => ({ value: s.id, label: s.label }));
  const save = useServiceMutation(
    (input) => {
      const { status, ...rest } = input;
      const values = status === 'archived' ? rest : input;
      return isEdit ? clientService.update(client.id, values) : clientService.create(values);
    },
    {
    success: (data) => (isEdit ? `“${data.name}” updated` : `“${data.name}” created`),
    onSuccess: (data) => setLeaveTo(`/clients/${data.id}`),
    onError: (err) => {
      const slugClash = err?.code === 'duplicate_slug' || (err?.status === 409 && err?.details?.some?.((d) => d.path === 'slug'));
      if (slugClash) setError('slug', { message: err.message });
    },
  },
  );

  const onSubmit = async (values) => {
    try {
      await save.mutateAsync(values);
    } catch {
      /* toast + field error handled by the mutation */
    }
  };

  const slugField = register('slug');

  return (
    <Page narrow>
      <PageHeader
        title={isEdit ? `Edit ${client.name}` : 'New client'}
        description={
          isEdit
            ? 'Update this client’s details. Brand colours, fonts and writing rules live in the Brand Profile tab.'
            : 'Create a client workspace. You can add their brand profile, reference files and jobs next.'
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <Card>
          <CardHeader icon={Building2} title="Client identity" description="How this client appears across the workspace." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Client name" required error={errors.name?.message} className="sm:col-span-2">
              <Input placeholder="e.g. Harbourside Motors" autoFocus={!isEdit} {...register('name')} />
            </Field>
            <Field
              label="Internal identifier"
              required
              error={errors.slug?.message}
              hint={slugTouched ? 'Lowercase letters, numbers and hyphens. Must be unique.' : 'Generated from the client name — edit it to set your own.'}
            >
              <Input
                placeholder="harbourside-motors"
                className="font-mono text-[13px]"
                {...slugField}
                onChange={(e) => {
                  setSlugTouched(true);
                  slugField.onChange(e);
                }}
              />
            </Field>
            <Field label="Status" required error={errors.status?.message} hint={isArchived ? 'Restore the client to change its status.' : undefined}>
              <Select options={statusOptions} {...register('status')} />
            </Field>
            <Field label="Industry" required error={errors.industry?.message} className="sm:col-span-2" hint="Pick a suggestion or type your own.">
              <Input list="client-industries" placeholder="e.g. Automotive" {...register('industry')} />
            </Field>
            <datalist id="client-industries">
              {INDUSTRY_SUGGESTIONS.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
            <Field label="Business description" error={errors.description?.message} className="sm:col-span-2">
              <Textarea rows={3} placeholder="What the business does, who it serves, what makes it different." {...register('description')} />
            </Field>
            <Field label="Business address" error={errors.address?.message} className="sm:col-span-2">
              <Input placeholder="Street, suburb, postcode" {...register('address')} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Contact} title="Primary contact" description="Who you work with at this client." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Contact name" error={errors.contactName?.message}>
              <Input placeholder="Full name" autoComplete="off" {...register('contactName')} />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" placeholder="name@company.com" autoComplete="off" {...register('email')} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input type="tel" placeholder="+61 3 9555 0100" autoComplete="off" {...register('phone')} />
            </Field>
            <Field label="Website" error={errors.website?.message}>
              <Input icon={Link2} placeholder="company.com" autoComplete="off" {...register('website')} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader icon={NotebookPen} title="Internal notes" description="Only visible to your team — not sent to AI requests." />
          <div className="p-5">
            <Field label="Notes" error={errors.notes?.message}>
              <Textarea rows={4} placeholder="Approval process, key dates, preferences…" {...register('notes')} />
            </Field>
          </div>
        </Card>

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" onClick={() => navigate(isEdit ? `/clients/${client.id}` : '/clients')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={Save} loading={isSubmitting || save.isPending}>
            {isEdit ? 'Save changes' : 'Create client'}
          </Button>
        </div>
      </form>

      <UnsavedChangesDialog blocker={blocker} />
    </Page>
  );
}
