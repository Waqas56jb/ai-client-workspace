import { create } from 'zustand';
import { toast } from 'sonner';
import { useServiceMutation } from '@/hooks';
import { aiService, versionText } from '@/services';
import { downloadVersion } from '@/lib/media';
import { copyToClipboard } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

/** Session-only record of verified PNG export sizes, keyed by version id. */
export const useVerifiedDims = create((set) => ({
  dims: {},
  record: (versionId, d) => set((s) => ({ dims: { ...s.dims, [versionId]: d } })),
}));

export function preservedMessage(output) {
  if (!output?.approvedVersionId || !output.approvedVersion) return '';
  return ` — approved v${output.approvedVersion.versionNumber} preserved`;
}

/** Common actions for an output card: copy, download, regenerate. */
export function useOutputActions(output, { onRegenerated } = {}) {
  const record = useVerifiedDims((s) => s.record);

  const regenerate = useServiceMutation(() => aiService.regenerate(output.id), {
    success: (d) => `Regenerated as draft v${d.currentVersion.versionNumber}${preservedMessage(d)}${isMockMode ? ' (simulated)' : ''}`,
    onSuccess: (d) => onRegenerated?.(d),
  });

  const copy = async (text) => {
    const ok = await copyToClipboard(text ?? versionText(output.currentVersion));
    if (ok) toast.success('Copied to clipboard');
    else toast.error('Could not copy — your browser blocked clipboard access.');
  };

  const download = async (version = output.currentVersion) => {
    try {
      const dims = await downloadVersion(output, version);
      if (dims) {
        record(version.id, dims);
        const exact = dims.width === version.image.requestedWidth && dims.height === version.image.requestedHeight;
        toast.success(`Downloaded PNG at ${dims.width} × ${dims.height}px`, {
          description: exact ? 'Verified: matches the requested generation size exactly.' : `Requested ${version.image.requestedWidth} × ${version.image.requestedHeight}px.`,
        });
      } else {
        toast.success('Downloaded as .txt');
      }
    } catch (e) {
      toast.error(e?.message || 'Download failed');
    }
  };

  return { regenerate, copy, download };
}
