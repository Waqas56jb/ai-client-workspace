import { useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { FolderOpen, SearchX, Upload } from 'lucide-react';
import { Button, EmptyState, ErrorState, FilterSelect, Page, PageHeader, ResultCount, SearchInput, Select, SkeletonCards, SkeletonRows, Toolbar, ViewToggle } from '@/components/ui';
import { ContextFilters, DemoNote, FILE_STATUS_OPTIONS, UploadFileDialog, useUrlFilters, useViewPreference } from '@/components/files';
import { useBreadcrumbs, useDebounce, useFiles, usePageTitle } from '@/hooks';
import { DATE_RANGES, FILE_KINDS } from '@/lib/constants';
import { FileGrid, FileTable } from './components/FileViews';
import { isMockMode } from '@/lib/config';

const DEFAULTS = { q: '', kind: 'all', status: 'all', clientId: 'all', jobId: 'all', taskId: 'all', dateRange: 'all', sort: 'updated' };

const SORTS = [
  { value: 'updated', label: 'Sort: Last updated' },
  { value: 'created', label: 'Sort: Newest' },
  { value: 'name', label: 'Sort: Name (A–Z)' },
  { value: 'size', label: 'Sort: Largest' },
];

export default function FilesPage() {
  useBreadcrumbs([{ label: 'Files' }]);
  usePageTitle('Files');
  const { values, set, reset, isFiltered } = useUrlFilters(DEFAULTS);
  const [view, setView] = useViewPreference('files');
  const [uploadOpen, setUploadOpen] = useState(false);
  const search = useDebounce(values.q.trim(), 200);

  const params = {
    search: search || undefined,
    kind: values.kind,
    status: values.status,
    clientId: values.clientId,
    jobId: values.jobId,
    taskId: values.taskId,
    dateRange: values.dateRange,
    sort: values.sort,
  };
  const { data: files = [], isLoading, error, refetch, isPlaceholderData } = useFiles(params, { placeholderData: keepPreviousData });
  const filtered = isFiltered(['sort']);

  return (
    <Page wide>
      <PageHeader
        title="Files"
        description="Every reference file, task attachment and generated output across your clients — with draft and approval status at a glance."
        actions={
          <Button variant="primary" icon={Upload} onClick={() => setUploadOpen(true)}>
            Upload
          </Button>
        }
      />

      <Toolbar>
        <SearchInput value={values.q} onChange={(q) => set({ q })} placeholder="Search files, descriptions, clients…" className="w-full sm:w-72" ariaLabel="Search files" />
        <FilterSelect label="Type" value={values.kind} onChange={(kind) => set({ kind })} options={FILE_KINDS.map((k) => ({ value: k.id, label: k.label }))} />
        <FilterSelect label="Status" value={values.status} onChange={(status) => set({ status })} options={FILE_STATUS_OPTIONS} />
        <ContextFilters clientId={values.clientId} jobId={values.jobId} taskId={values.taskId} onChange={set} />
        <FilterSelect label="Created" allLabel="Any time" value={values.dateRange} onChange={(dateRange) => set({ dateRange })} options={DATE_RANGES.filter((d) => d.id !== 'all').map((d) => ({ value: d.id, label: d.label }))} />
        <div className="ml-auto flex items-center gap-2">
          <Select size="sm" aria-label="Sort files" value={values.sort} onChange={(e) => set({ sort: e.target.value })} options={SORTS} className="min-w-[170px]" />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </Toolbar>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ResultCount count={files.length} noun="file" showClear={filtered} onClear={() => reset(['sort'])} />
        {isMockMode && <DemoNote className="sm:max-w-xl">Demo files live in this browser. Permanent storage arrives with the backend and Supabase Storage.</DemoNote>}
      </div>

      <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {isLoading ? (
          view === 'grid' ? (
            <SkeletonCards count={8} className="lg:grid-cols-3 2xl:grid-cols-4" />
          ) : (
            <div className="card p-5">
              <SkeletonRows rows={6} />
            </div>
          )
        ) : error ? (
          <div className="card">
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : files.length === 0 ? (
          <div className="card">
            {filtered ? (
              <EmptyState
                icon={SearchX}
                title="No files match these filters"
                description="Try a different search term or clear the filters to see the whole library."
                action={<Button onClick={() => reset(['sort'])}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={FolderOpen}
                title="No files yet"
                description="Upload brand guidelines, logos and reference material, or generate outputs in the AI workspace."
                action={
                  <Button variant="primary" icon={Upload} onClick={() => setUploadOpen(true)}>
                    Upload files
                  </Button>
                }
              />
            )}
          </div>
        ) : view === 'grid' ? (
          <FileGrid files={files} />
        ) : (
          <FileTable files={files} />
        )}
      </div>

      <UploadFileDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        defaultClientId={values.clientId !== 'all' ? values.clientId : ''}
        defaultJobId={values.jobId !== 'all' ? values.jobId : ''}
        defaultTaskId={values.taskId !== 'all' ? values.taskId : ''}
      />
    </Page>
  );
}
