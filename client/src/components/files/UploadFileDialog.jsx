import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, CheckCircle2, UploadCloud, X } from 'lucide-react';
import { Button, Dialog, Field, Select, Textarea } from '@/components/ui';
import { fileIconFor } from '@/components/data-display/Entities';
import { useClients, useJobs, useServiceMutation, useTasks } from '@/hooks';
import { fileService, validateUpload } from '@/services';
import { ACCEPT_ATTR, ACCEPTED_UPLOADS } from '@/lib/constants';
import { config, isMockMode } from '@/lib/config';
import { cn, formatBytes, pluralize } from '@/lib/utils';
import { DemoNote } from './FileWidgets';

const uploadSchema = z.object({
  clientId: z.string().min(1, 'Choose the client this file belongs to.'),
  jobId: z.string().optional(),
  taskId: z.string().optional(),
  description: z.string().max(500, 'Keep the description under 500 characters.').optional(),
});

/**
 * Upload dialog: client (required) → optional job → optional task, description and
 * drag & drop. Files are validated with validateUpload and stored in this browser.
 * @param {{ open, onClose, defaultClientId?, defaultJobId?, defaultTaskId?, onUploaded?: (records) => void }} props
 */
export function UploadFileDialog({ open, onClose, defaultClientId = '', defaultJobId = '', defaultTaskId = '', onUploaded }) {
  const [items, setItems] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState(null);
  const inputRef = useRef(null);
  const { register, handleSubmit, watch, setValue, reset, formState } = useForm({
    resolver: zodResolver(uploadSchema),
    defaultValues: { clientId: '', jobId: '', taskId: '', description: '' },
  });

  useEffect(() => {
    if (open) {
      reset({ clientId: defaultClientId || '', jobId: defaultJobId || '', taskId: defaultTaskId || '', description: '' });
      setItems([]);
      setFileError(null);
    }
  }, [open, defaultClientId, defaultJobId, defaultTaskId, reset]);

  const clientId = watch('clientId');
  const jobId = watch('jobId');
  const taskId = watch('taskId');
  const { data: clients = [] } = useClients({ sort: 'name' });
  const { data: jobs = [] } = useJobs({ clientId, sort: 'name' }, { enabled: !!clientId });
  const { data: tasks = [] } = useTasks({ jobId }, { enabled: !!jobId });

  const addFiles = (list) => {
    const next = Array.from(list || []).map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, error: validateUpload(file) }));
    if (!next.length) return;
    setFileError(null);
    setItems((prev) => [...prev, ...next]);
  };

  const valid = items.filter((i) => !i.error);

  const upload = useServiceMutation(
    async (values) => {
      const records = [];
      for (const item of valid) {
        records.push(
          await fileService.upload({
            file: item.file,
            clientId: values.clientId,
            jobId: values.jobId || null,
            taskId: values.taskId || null,
            category: values.taskId ? 'attachment' : 'reference',
            description: values.description?.trim() || '',
          }),
        );
      }
      return records;
    },
    {
      success: (records) => (records.length === 1 ? `Uploaded “${records[0].name}”` : `Uploaded ${pluralize(records.length, 'file')}`),
      onSuccess: (records) => {
        onClose();
        onUploaded?.(records);
      },
    },
  );

  const submit = handleSubmit((values) => {
    if (!valid.length) {
      setFileError(items.length ? 'None of the selected files can be uploaded. Remove them and choose supported files.' : 'Choose at least one file to upload.');
      return;
    }
    upload.mutate(values);
  });

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <Dialog
      open={open}
      onClose={upload.isPending ? () => {} : onClose}
      size="lg"
      title="Upload files"
      description="Attach reference material to a client, and optionally to a job or task."
      footer={
        <>
          <Button onClick={onClose} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon={UploadCloud} loading={upload.isPending} onClick={submit}>
            {valid.length > 1 ? `Upload ${valid.length} files` : 'Upload'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Client" required error={formState.errors.clientId?.message}>
          <Select
            placeholder="Choose a client…"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            {...register('clientId', {
              onChange: () => {
                setValue('jobId', '');
                setValue('taskId', '');
              },
            })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job" hint={clientId ? 'Optional' : 'Choose a client first'}>
            <Select placeholder="No job" disabled={!clientId} options={jobs.map((j) => ({ value: j.id, label: j.title }))} {...register('jobId', { onChange: () => setValue('taskId', '') })} />
          </Field>
          <Field label="Task" hint={jobId ? (taskId ? 'Saved as a task attachment' : 'Optional') : 'Choose a job first'}>
            <Select placeholder="No task" disabled={!jobId} options={tasks.map((t) => ({ value: t.id, label: t.title }))} {...register('taskId')} />
          </Field>
        </div>
        <Field label="Description" error={formState.errors.description?.message} hint="Optional — helps teammates find this file later.">
          <Textarea rows={2} placeholder="e.g. Sponsor lock-up for Cup 2026 assets" {...register('description')} />
        </Field>

        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputRef.current?.click())}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            aria-label="Choose files to upload, or drop them here"
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors focus-ring',
              dragging ? 'border-brand bg-brand-soft/60' : fileError ? 'border-danger/50 bg-danger-soft/30' : 'border-line-strong bg-canvas/60 hover:border-brand/50 hover:bg-brand-soft/30',
            )}
          >
            <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-brand shadow-card">
              <UploadCloud size={20} aria-hidden />
            </span>
            <p className="text-[13px] font-medium text-ink">
              Drop files here or <span className="text-brand">browse</span>
            </p>
            <p className="mt-1 text-xs text-muted">Images, PDF, Word, Excel, CSV or text · up to {formatBytes(config.maxUploadBytes)} each</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {fileError && (
            <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
              {fileError}
            </p>
          )}
        </div>

        {items.length > 0 && (
          <ul className="space-y-1.5" aria-label="Selected files">
            {items.map((item) => {
              const Icon = fileIconFor({ kind: ACCEPTED_UPLOADS[item.file.type], mimeType: item.file.type });
              return (
                <li key={item.id} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', item.error ? 'border-danger/30 bg-danger-soft/40' : 'border-line bg-surface')}>
                  <Icon size={18} className={item.error ? 'text-danger' : 'text-muted'} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{item.file.name}</p>
                    {item.error ? (
                      <p className="flex items-start gap-1 text-xs text-danger">
                        <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden />
                        {item.error}
                      </p>
                    ) : (
                      <p className="flex items-center gap-1 text-xs text-muted">
                        <CheckCircle2 size={12} className="text-success" aria-hidden />
                        {formatBytes(item.file.size)} · ready
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" size="icon-xs" icon={X} aria-label={`Remove ${item.file.name}`} onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))} disabled={upload.isPending} />
                </li>
              );
            })}
          </ul>
        )}

        {isMockMode ? (
          <DemoNote>Demo uploads are kept in this browser only (IndexedDB) and can be lost if site data is cleared. Permanent storage arrives with the backend and Supabase Storage.</DemoNote>
        ) : (
          <DemoNote>Files are stored privately in Supabase Storage. The server checks each file’s real type before saving it.</DemoNote>
        )}
      </form>
    </Dialog>
  );
}
