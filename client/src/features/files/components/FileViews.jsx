import { Link, useNavigate } from 'react-router-dom';
import { ApprovalBadge, Avatar, Badge, Card, Table, Td, Th, Tooltip } from '@/components/ui';
import { ClientLogo, ContextPath, FileThumb } from '@/components/data-display/Entities';
import { fileTypeLabel, STORAGE_INFO } from '@/components/files';
import { cn, formatBytes, formatDate, formatDateTime, timeAgo } from '@/lib/utils';

function StorageDot({ storage }) {
  if (storage !== 'browser' && storage !== 'record-only') return null;
  const info = STORAGE_INFO[storage];
  return (
    <Tooltip content={info.label}>
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', storage === 'browser' ? 'bg-warning' : 'bg-subtle')} aria-label={info.label} role="img" />
    </Tooltip>
  );
}

export function FileCard({ file }) {
  return (
    <Card interactive className="group relative flex flex-col overflow-hidden">
      <div className="relative">
        <FileThumb file={file} className="aspect-[4/3] w-full border-b border-line" />
        <div className="absolute left-2.5 top-2.5">
          <ApprovalBadge status={file.status || 'reference'} pending={file.pendingRevision} className="shadow-card" />
        </div>
        {file.versionCount > 1 && (
          <span className="absolute right-2.5 top-2.5">
            <Badge className="bg-surface/95">v{file.output?.currentVersion?.versionNumber ?? file.versionCount}</Badge>
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="min-w-0">
          <Link to={`/files/${file.id}`} className="block truncate text-[13.5px] font-semibold text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand focus-ring rounded" title={file.name}>
            {file.name}
          </Link>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            {fileTypeLabel(file)} · {formatBytes(file.size)} <StorageDot storage={file.storage} />
          </p>
        </div>
        <div className="relative z-10 flex min-w-0 items-center gap-1.5">
          <ClientLogo client={file.client} size="xs" />
          <ContextPath client={file.client} job={file.job} task={file.task} className="min-w-0" />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2.5 text-xs text-muted">
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar user={file.createdByUser} size="xs" />
            <span className="truncate">{file.createdByUser?.name || 'Unknown'}</span>
          </span>
          <span className="shrink-0 text-right leading-4" title={`Created ${formatDateTime(file.createdAt)} · Last revision ${formatDateTime(file.lastRevisionAt)}`}>
            <span className="block">Created {formatDate(file.createdAt, 'd MMM')}</span>
            <span className="block text-subtle">Revised {timeAgo(file.lastRevisionAt)}</span>
          </span>
        </div>
      </div>
    </Card>
  );
}

export function FileGrid({ files }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {files.map((f) => (
        <FileCard key={f.id} file={f} />
      ))}
    </div>
  );
}

export function FileTable({ files }) {
  const navigate = useNavigate();
  return (
    <Table className="[&_table]:min-w-[980px]">
      <thead>
        <tr>
          <Th>File</Th>
          <Th>Client / Job / Task</Th>
          <Th>Status</Th>
          <Th className="text-right">Size</Th>
          <Th>Created</Th>
          <Th>Last revision</Th>
          <Th>Created by</Th>
        </tr>
      </thead>
      <tbody>
        {files.map((f) => (
          <tr key={f.id} onClick={() => navigate(`/files/${f.id}`)} className="cursor-pointer transition-colors hover:bg-canvas/70">
            <Td>
              <div className="flex min-w-0 items-center gap-3">
                <FileThumb file={f} className="h-10 w-10 shrink-0 rounded-lg border border-line [&_svg]:h-[18px] [&_svg]:w-[18px]" />
                <div className="min-w-0">
                  <Link to={`/files/${f.id}`} onClick={(e) => e.stopPropagation()} className="block max-w-[260px] truncate font-medium text-ink hover:text-brand focus-ring rounded" title={f.name}>
                    {f.name}
                  </Link>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    {fileTypeLabel(f)} <StorageDot storage={f.storage} />
                  </p>
                </div>
              </div>
            </Td>
            <Td>
              <ContextPath client={f.client} job={f.job} task={f.task} className="max-w-[300px]" />
            </Td>
            <Td>
              <ApprovalBadge status={f.status || 'reference'} pending={f.pendingRevision} />
            </Td>
            <Td className="whitespace-nowrap text-right tabular-nums text-muted">{formatBytes(f.size)}</Td>
            <Td className="whitespace-nowrap text-muted">
              <time dateTime={f.createdAt} title={formatDateTime(f.createdAt)}>
                {formatDate(f.createdAt)}
              </time>
            </Td>
            <Td className="whitespace-nowrap text-muted">
              <time dateTime={f.lastRevisionAt} title={formatDateTime(f.lastRevisionAt)}>
                {timeAgo(f.lastRevisionAt)}
              </time>
            </Td>
            <Td>
              <span className="flex items-center gap-1.5 whitespace-nowrap text-muted">
                <Avatar user={f.createdByUser} size="xs" />
                {f.createdByUser?.name || 'Unknown'}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
