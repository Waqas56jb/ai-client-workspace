import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Copy, Download, GitBranch, History, PanelRight, Pencil, RefreshCw, Save, X } from 'lucide-react';
import { Badge, Button, Input, Textarea, Tooltip } from '@/components/ui';
import { ApproveButton, OutputHistoryDialog, RevisionDialog } from '@/components/approvals';
import { useServiceMutation } from '@/hooks';
import { versionService } from '@/services';
import { TOOL_BY_ID, WRITING_FORMATS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { OutputStatusBadges, PreservedNotice } from './OutputStatus';
import { preservedMessage, useOutputActions } from './useOutputActions';

export function MissingInfoCallout({ missing }) {
  if (!missing?.length) return null;
  return (
    <div className="rounded-lg border border-[#F7E4B5] bg-warning-soft/70 px-3 py-2.5" role="note">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-warning">
        <AlertTriangle size={14} aria-hidden /> Missing information — not included in the listing
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {missing.map((m) => (
          <li key={m} className="rounded-md border border-[#F7E4B5] bg-surface px-1.5 py-0.5 text-[11.5px] text-ink">
            {m}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11.5px] text-muted">Nothing was invented for these fields. Add the details to the form and regenerate, or edit the text.</p>
    </div>
  );
}

function SectionBlock({ section, onCopy }) {
  return (
    <div className="group rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{section.label}</p>
        <Tooltip content="Copy section" side="left">
          <Button size="icon-xs" variant="ghost" icon={Copy} onClick={() => onCopy(section.text)} aria-label={`Copy ${section.label}`} className="opacity-60 group-hover:opacity-100" />
        </Tooltip>
      </div>
      <p className="prose-output mt-0.5">{section.text}</p>
      {/^search — headline/i.test(section.label) && <p className="mt-1 text-[11px] text-subtle">{section.text.length}/30 characters</p>}
      {/^search — description/i.test(section.label) && <p className="mt-1 text-[11px] text-subtle">{section.text.length}/90 characters</p>}
    </div>
  );
}

/**
 * Rich text output card: content or structured sections, inline editing that
 * saves a new draft revision, regenerate, approve, TXT export and history.
 */
/** One-click follow-ups for a written result (sent as a new message in the same chat). */
export const QUICK_ACTIONS = [
  { id: 'shorter', label: 'Shorter', prompt: 'Make the message above shorter. Keep every key fact.' },
  { id: 'persuasive', label: 'More persuasive', prompt: 'Rewrite the message above to be more persuasive and sales-focused, without being pushy.' },
  { id: 'formal', label: 'More formal', prompt: 'Rewrite the message above in a more formal tone.' },
  { id: 'casual', label: 'Casual', prompt: 'Rewrite the message above in a casual tone, in plain English that is very easy to understand.' },
  { id: 'assertive', label: 'More assertive', prompt: 'Make the message above more assertive.' },
  { id: 'diplomatic', label: 'More diplomatic', prompt: 'Make the message above more diplomatic.' },
  { id: 'alternatives', label: '2 other versions', prompt: 'Give me 2 alternative versions of the message above.' },
  { id: 'explain', label: 'Explain changes', prompt: 'Briefly explain why the changes in the message above were made.' },
  { id: 'sms', label: 'As SMS', prompt: 'Shorten the message above so it works as an SMS.', format: 'sms' },
  { id: 'whatsapp', label: 'As WhatsApp', prompt: 'Rewrite the message above as a WhatsApp message.', format: 'whatsapp' },
];

export function TextOutputPanel({ output, selected, onSelect, onShowDetails, onQuickAction }) {
  const v = output.currentVersion;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftSections, setDraftSections] = useState(null);
  const [note, setNote] = useState('');
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { regenerate, copy, download } = useOutputActions(output, { onRegenerated: () => onSelect?.(output.id) });

  const startEdit = () => {
    setDraft(v?.content || '');
    setDraftSections(v?.sections ? v.sections.map((s) => ({ ...s })) : null);
    setNote('');
    setEditing(true);
    onSelect?.(output.id);
  };

  const save = useServiceMutation(
    () =>
      versionService.createRevision(output.id, {
        sourceVersionId: v.id,
        note: note || 'Edited in AI workspace',
        ...(draftSections ? { sections: draftSections } : { content: draft }),
      }),
    {
      success: (d) => `Saved as draft v${d.currentVersion.versionNumber}${preservedMessage(d)}`,
      onSuccess: () => setEditing(false),
    },
  );

  const unchanged = draftSections ? JSON.stringify(draftSections) === JSON.stringify(v?.sections) : draft === (v?.content || '');
  const tool = TOOL_BY_ID[output.tool];
  const format = WRITING_FORMATS.find((f) => f.id === output.format);

  return (
    <article
      className={cn('card overflow-hidden transition-shadow', selected ? 'border-brand/45 ring-2 ring-brand/15' : 'hover:border-line-strong')}
      onClick={() => !editing && onSelect?.(output.id)}
      aria-label={`Output: ${output.title}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-canvas/50 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-ink">{output.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <OutputStatusBadges output={output} />
            {format && <Badge tone="brand">{format.label}</Badge>}
            {v?.sections && <Badge>{v.sections.length} sections</Badge>}
            {tool && <span className="text-[11px] text-muted">· {tool.short}</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" variant="ghost" icon={Copy} onClick={() => copy()} aria-label="Copy all text">
            Copy
          </Button>
          <Button size="xs" variant="ghost" icon={Download} onClick={() => download()} aria-label="Download as TXT">
            Download
          </Button>
          <Button size="xs" variant="ghost" icon={History} onClick={() => setHistoryOpen(true)} aria-label="View previous versions">
            History
          </Button>
          {onShowDetails && (
            <Tooltip content="Details">
              <Button size="icon-sm" variant="ghost" icon={PanelRight} onClick={() => onShowDetails(output.id)} aria-label="Show output details" />
            </Tooltip>
          )}
        </div>
      </header>

      <div className={cn('space-y-3 px-3.5 py-3', regenerate.isPending && 'animate-pulse')}>
        <PreservedNotice output={output} />
        {editing ? (
          <div className="space-y-2.5" onClick={(e) => e.stopPropagation()}>
            {draftSections ? (
              draftSections.map((s, i) => (
                <label key={s.id} className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{s.label}</span>
                  <Textarea rows={2} value={s.text} onChange={(e) => setDraftSections((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                </label>
              ))
            ) : (
              <Textarea rows={Math.min(18, Math.max(6, (draft.match(/\n/g) || []).length + 2))} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit output text" autoFocus />
            )}
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Revision note (optional) — e.g. Tightened the opening line" aria-label="Revision note" />
            <p className="text-[11.5px] text-muted">
              Saving creates <strong className="font-semibold text-ink">v{(output.versionCount || v?.versionNumber || 1) + 1} as a draft</strong>.
              {output.approvedVersionId ? ` Approved v${output.approvedVersion?.versionNumber} is never modified.` : ''}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" icon={X} onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" icon={Save} loading={save.isPending} disabled={unchanged} onClick={() => save.mutate()}>
                Save as revision
              </Button>
            </div>
          </div>
        ) : v?.sections ? (
          <div className="grid gap-2">
            {v.sections.map((s) => (
              <SectionBlock key={s.id} section={s} onCopy={copy} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-surface">
            <p className="prose-output">{v?.content}</p>
          </div>
        )}
        {!editing && <MissingInfoCallout missing={v?.missing} />}
        {!editing && onQuickAction && output.tool === 'writing' && (
          <div onClick={(e) => e.stopPropagation()}>
            <p className="mb-1.5 text-[12px] font-semibold text-muted">Quick changes</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onQuickAction(output, a)}
                  className="h-8 rounded-full border border-line bg-surface px-3 text-[12.5px] font-medium text-ink transition-colors hover:border-brand/50 hover:bg-brand-soft hover:text-brand focus-ring"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!editing && (
        <footer className="flex flex-wrap items-center gap-1.5 border-t border-line px-3.5 py-2.5" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" icon={Pencil} onClick={startEdit}>
            Edit
          </Button>
          <Button size="sm" icon={RefreshCw} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
            Regenerate
          </Button>
          <Button size="sm" variant="ghost" icon={GitBranch} onClick={() => setRevisionOpen(true)}>
            Save revision
          </Button>
          <span className="flex-1" />
          <ApproveButton output={output} label={`Approve v${v?.versionNumber}`} />
        </footer>
      )}

      <RevisionDialog open={revisionOpen} onClose={() => setRevisionOpen(false)} output={output} sourceVersion={v} />
      <OutputHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} outputId={output.id} initialVersionId={v?.id} />
    </article>
  );
}

/** Compact reference to an output that is shown in full in a later message. */
export function OutputReference({ output, onSelect }) {
  const v = output.currentVersion;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(output.id)}
      className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-left text-[12.5px] transition-colors hover:border-line-strong hover:bg-canvas focus-ring"
    >
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{output.title}</span>
      <OutputStatusBadges output={output} />
      <span className="hidden shrink-0 text-[11.5px] text-muted sm:inline">updated below · {v ? `now v${v.versionNumber}` : ''}</span>
    </button>
  );
}

