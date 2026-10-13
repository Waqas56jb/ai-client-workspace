import { GitBranch, ShieldCheck } from 'lucide-react';
import { ApprovalBadge, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

/** Draft / Approved badge plus the current version number. */
export function OutputStatusBadges({ output, className }) {
  if (!output) return null;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      <ApprovalBadge status={output.status} pending={output.pendingRevision} />
      {output.currentVersion && <Badge>v{output.currentVersion.versionNumber}</Badge>}
    </span>
  );
}

/**
 * Explicit notice that revising an approved output never changes the approved
 * version: "Approved v1 preserved — v2 is a draft".
 */
export function PreservedNotice({ output, className }) {
  if (!output?.pendingRevision || !output.approvedVersion) return null;
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border border-[#CDEEDD] bg-success-soft/70 px-3 py-2 text-[12.5px] leading-5', className)} role="status">
      <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
      <p className="text-ink">
        <span className="font-semibold text-success">Approved v{output.approvedVersion.versionNumber} preserved</span>
        <span className="text-muted"> — </span>
        <span className="inline-flex items-center gap-1 font-semibold text-warning">
          <GitBranch size={12} aria-hidden />v{output.currentVersion?.versionNumber} is a draft
        </span>
        <span className="text-muted">. Approved Work keeps showing v{output.approvedVersion.versionNumber} until you approve the new version.</span>
      </p>
    </div>
  );
}
