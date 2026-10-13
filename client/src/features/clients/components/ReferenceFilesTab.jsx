import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowUpRight, Check, FileUp, FolderOpen, HardDrive, Pencil, SearchX, Trash2, Upload, X, Library, NotebookPen } from 'lucide-react';
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, Menu, ResultCount, SearchInput, SkeletonRows, Table, Td, Textarea, Th, Toolbar } from '@/components/ui';
import { ContextPath, FileThumb } from '@/components/data-display';
import { useFiles, useServiceMutation } from '@/hooks';
import { fileService, validateUpload } from '@/services';
import { ACCEPT_ATTR } from '@/lib/constants';
import { cn, formatBytes, formatDate, matches } from '@/lib/utils';
import { STORAGE_INFO, StorageBadge, fileTypeLabel } from './helpers';
import { isMockMode } from '@/lib/config';

function StorageNote() {
  return (
    <div className="card mb-5 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning">
          <HardDrive size={15} aria-hidden />
        </span>
        <div className="min-w-0 text-[13px] leading-5 text-muted">
          <p className="font-semibold text-ink">Demo storage — not permanent yet</p>
          <p className="mt-0.5">
            Files you upload here stay in this browser only (IndexedDB) and may disappear if browser data is cleared. Permanent, shared storage arrives with the backend (Supabase Storage).
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2">
            {['bundled', 'browser', 'record-only'].map((k) => (
              <li key={k} className="flex items-center gap-2 text-xs">
                <StorageBadge storage={k} />
                <span className="max-w-[260px]">{STORAGE_INFO[k].help}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Dropzone({ onFiles, uploading }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!uploading) onFiles(Array.from(e.dataTransfer.files || []));
      }}
      className={cn(
        'mb-5 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors',
        over ? 'border-brand bg-brand-soft/60' : 'border-line-strong bg-surface',
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <FileUp size={20} aria-hidden />
      </span>
      <div>
        <p className="text-[14px] font-medium text-ink">{over ? 'Drop to upload' : 'Drag reference files here'}</p>
        <p className="mt-0.5 text-xs text-muted">Images (PNG, JPG, WebP, GIF, SVG), PDF, Word, Excel, CSV or text · up to 8 MB each</p>
      </div>
      <Button variant="primary" size="sm" icon={Upload} loading={uploading} onClick={() => input.current?.click()}>
        {uploading ? 'Uploading…' : 'Choose files'}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose reference files to upload"
        onChange={(e) => {
          onFiles(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
    </div>
  );
}

function NameCell({ file, editing, onDone }) {
  const [name, setName] = useState(file.name);
  const rename = useServiceMutation((v) => fileService.update(file.id, { name: v }), { success: 'File renamed', onSuccess: onDone });
  if (!editing) {
    return (
      <Link to={`/files/${file.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-ink hover:text-brand focus-ring rounded">
        {file.name}
      </Link>
    );
  }
  const submit = () => {
    const v = name.trim();
    if (!v) return;
    if (v === file.name) return onDone();
    rename.mutate(v);
  };
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
        aria-label="File name"
        invalid={!name.trim()}
        className="h-8 min-w-[160px] text-[13px]"
      />
      <Button type="submit" size="icon-xs" variant="soft" icon={Check} aria-label="Save name" loading={rename.isPending} disabled={!name.trim()} />
      <Button size="icon-xs" variant="ghost" icon={X} aria-label="Cancel rename" onClick={onDone} />
    </form>
  );
}

function DescriptionDialog({ file, onClose }) {
  const [text, setText] = useState(file?.description || '');
  const save = useServiceMutation((v) => fileService.update(file.id, { description: v }), { success: 'Description updated', onSuccess: onClose });
  return (
    <Dialog
      open={!!file}
      onClose={onClose}
      title="Edit description"
      description={file?.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(text.trim())}>
            Save description
          </Button>
        </>
      }
    >
      <Field label="Description" hint="Tell the team (and the AI) what this file is and when to use it.">
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </Dialog>
  );
}

export function ReferenceFilesTab({ client }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useFiles({ clientId: client.id, sort: 'created' });
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState([]);
  const [renamingId, setRenamingId] = useState(null);
  const [describing, setDescribing] = useState(null);
  const [removing, setRemoving] = useState(null);

  const files = useMemo(() => (data || []).filter((f) => f.category !== 'output'), [data]);
  const outputCount = (data || []).length - files.length;
  const shown = useMemo(() => (search.trim() ? files.filter((f) => matches(`${f.name} ${f.description}`, search.trim())) : files), [files, search]);

  const remove = useServiceMutation((f) => fileService.remove(f.id), {
    success: (_, f) => `“${f.name}” removed`,
    onSuccess: () => setRemoving(null),
  });

  const onFiles = async (list) => {
    if (!list.length) return;
    const problems = [];
    const valid = [];
    list.forEach((f) => {
      const p = validateUpload(f);
      if (p) problems.push(p);
      else valid.push(f);
    });
    setUploadErrors(problems);
    if (!valid.length) return;
    setUploading(true);
    let ok = 0;
    for (const file of valid) {
      try {
        await fileService.upload({ file, clientId: client.id, category: 'reference' });
        ok += 1;
      } catch (err) {
        problems.push(err?.message || `“${file.name}” could not be uploaded.`);
      }
    }
    setUploadErrors([...problems]);
    await qc.invalidateQueries();
    setUploading(false);
    if (ok) toast.success(ok === 1 ? `Uploaded “${valid[0].name}”` : `Uploaded ${ok} files`, isMockMode ? { description: 'Held temporarily in this browser for the demo.' } : undefined);
    if (problems.length && !ok) toast.error('Nothing was uploaded');
  };

  let body;
  if (isLoading) body = <SkeletonRows rows={4} className="card p-5" />;
  else if (error)
    body = (
      <div className="card">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  else if (!shown.length)
    body = (
      <div className="card">
        {search.trim() ? (
          <EmptyState icon={SearchX} title="No files match" description={`Nothing matches “${search.trim()}”.`} action={<Button onClick={() => setSearch('')}>Clear search</Button>} />
        ) : (
          <EmptyState icon={FolderOpen} title="No reference files yet" description={`Upload logos, brochures, price lists or past work for ${client.name}. They stay with this client only.`} />
        )}
      </div>
    );
  else
    body = (
      <Table>
        <thead>
          <tr>
            <Th>File</Th>
            <Th>Type</Th>
            <Th>Size</Th>
            <Th>Uploaded</Th>
            <Th>Storage</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((f) => (
            <tr key={f.id} className="align-top transition-colors hover:bg-canvas/60">
              <Td className="max-w-[380px]">
                <div className="flex items-start gap-3">
                  <FileThumb file={f} className="h-10 w-10 shrink-0 rounded-lg border border-line" />
                  <div className="min-w-0 flex-1">
                    <NameCell key={renamingId === f.id ? 'edit' : 'view'} file={f} editing={renamingId === f.id} onDone={() => setRenamingId(null)} />
                    <button
                      type="button"
                      onClick={() => setDescribing(f)}
                      className="mt-0.5 block max-w-full truncate text-left text-xs text-muted hover:text-brand focus-ring rounded"
                      title="Edit description"
                    >
                      {f.description || <span className="italic text-subtle">Add a description…</span>}
                    </button>
                    <ContextPath client={f.client} job={f.job} task={f.task} className="mt-1" />
                  </div>
                </div>
              </Td>
              <Td className="whitespace-nowrap text-muted">{fileTypeLabel(f)}</Td>
              <Td className="whitespace-nowrap tabular-nums text-muted">{formatBytes(f.size)}</Td>
              <Td className="whitespace-nowrap">
                <span className="block text-ink">{formatDate(f.createdAt)}</span>
                <span className="block text-xs text-muted">{f.createdByUser?.name || '—'}</span>
              </Td>
              <Td>
                <StorageBadge storage={f.storage} />
              </Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button as={Link} to={`/files/${f.id}`} size="xs" variant="ghost" iconRight={ArrowUpRight}>
                    Open
                  </Button>
                  <Menu
                    label={`Actions for ${f.name}`}
                    items={[
                      { label: 'Open preview', icon: ArrowUpRight, onSelect: () => navigate(`/files/${f.id}`) },
                      { label: 'Rename', icon: Pencil, onSelect: () => setRenamingId(f.id) },
                      { label: 'Edit description', icon: NotebookPen, onSelect: () => setDescribing(f) },
                      { separator: true },
                      { label: 'Remove', icon: Trash2, danger: true, onSelect: () => setRemoving(f) },
                    ]}
                  />
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    );

  return (
    <div>
      {isMockMode && <StorageNote />}
      <Dropzone onFiles={onFiles} uploading={uploading} />

      {uploadErrors.length > 0 && (
        <div className="mb-5 rounded-xl border border-[#F7D2D2] bg-danger-soft px-4 py-3" role="alert">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-2.5">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0 text-[13px]">
                <p className="font-semibold text-danger">{uploadErrors.length === 1 ? 'One file wasn’t uploaded' : `${uploadErrors.length} files weren’t uploaded`}</p>
                <ul className="mt-1 space-y-0.5 text-ink">
                  {uploadErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
            <Button size="icon-xs" variant="ghost" icon={X} aria-label="Dismiss upload errors" onClick={() => setUploadErrors([])} />
          </div>
        </div>
      )}

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search reference files…" className="w-full sm:w-72" />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {!isLoading && !error && <ResultCount count={shown.length} noun="file" />}
          <Button as={Link} to={`/files?clientId=${client.id}`} size="sm" variant="ghost" icon={Library}>
            Generated outputs{outputCount ? ` (${outputCount})` : ''} in Files library
          </Button>
        </div>
      </Toolbar>

      {body}

      {describing && <DescriptionDialog key={describing.id} file={describing} onClose={() => setDescribing(null)} />}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        loading={remove.isPending}
        tone="danger"
        title={`Remove “${removing?.name || ''}”?`}
        description={
          removing?.storage === 'browser'
            ? 'The file and its copy in this browser’s storage will be deleted. This cannot be undone.'
            : isMockMode
              ? 'The file record will be removed from this client. This cannot be undone.'
              : 'The file will be archived and removed from this client. The stored copy is retained for audit purposes.'
        }
        confirmLabel="Remove file"
      >
        {client.brand?.logoFileId === removing?.id && <p className="text-xs text-warning">This file is the client’s current logo — the brand profile will fall back to initials.</p>}
      </ConfirmDialog>
    </div>
  );
}
