import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquarePlus, MessagesSquare, Pencil, X } from 'lucide-react';
import { Button, EmptyState, SkeletonRows, Tooltip } from '@/components/ui';
import { useServiceMutation } from '@/hooks';
import { conversationService } from '@/services';
import { cn, pluralize, timeAgo } from '@/lib/utils';
import { ToolIcon } from './ToolSelector';

function ConversationRow({ conversation: c, selected, onSelect }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  const inputRef = useRef(null);
  const rename = useServiceMutation((t) => conversationService.update(c.id, { title: t }), {
    success: 'Conversation renamed',
    onSuccess: () => setEditing(false),
  });

  useEffect(() => {
    if (editing) {
      setTitle(c.title);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, c.title]);

  const save = () => {
    const t = title.trim();
    if (!t || t === c.title) return setEditing(false);
    rename.mutate(t);
  };

  if (editing) {
    return (
      <li className="flex items-center gap-1 rounded-lg border border-brand/40 bg-surface px-1.5 py-1">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          maxLength={80}
          aria-label="Conversation title"
          className="h-7 min-w-0 flex-1 rounded bg-transparent px-1.5 text-[13px] text-ink outline-none"
        />
        <Button size="icon-xs" variant="ghost" icon={Check} onClick={save} loading={rename.isPending} aria-label="Save title" />
        <Button size="icon-xs" variant="ghost" icon={X} onClick={() => setEditing(false)} aria-label="Cancel rename" />
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onSelect(c)}
        onDoubleClick={() => setEditing(true)}
        aria-current={selected || undefined}
        className={cn('flex w-full items-start gap-2.5 rounded-lg px-2 py-2 pr-9 text-left transition-colors focus-ring', selected ? 'bg-brand-soft/70' : 'hover:bg-canvas')}
      >
        {c.tool ? <ToolIcon tool={c.tool} size="sm" /> : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-canvas text-subtle"><MessagesSquare size={14} aria-hidden /></span>}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13px] font-medium', selected ? 'text-brand' : 'text-ink')}>{c.title}</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-muted">
            {pluralize(c.messageCount || 0, 'message')}
            {c.outputCount ? ` · ${pluralize(c.outputCount, 'output')}` : ''} · {timeAgo(c.updatedAt)}
          </span>
        </span>
      </button>
      <span className="absolute right-1 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Tooltip content="Rename" side="left">
          <Button size="icon-xs" variant="ghost" icon={Pencil} onClick={() => setEditing(true)} aria-label={`Rename ${c.title}`} />
        </Tooltip>
      </span>
    </li>
  );
}

/** Conversations for the task with select, inline rename and "New conversation". */
export function ConversationList({ conversations, loading, selectedId, onSelect, onNew, creating }) {
  return (
    <section aria-labelledby="ws-conv-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="ws-conv-heading" className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          Conversations {conversations?.length ? <span className="text-subtle">({conversations.length})</span> : null}
        </h3>
        <Button size="xs" variant="soft" icon={MessageSquarePlus} onClick={onNew} loading={creating}>
          New
        </Button>
      </div>
      {loading ? (
        <SkeletonRows rows={3} />
      ) : !conversations?.length ? (
        <EmptyState compact icon={MessagesSquare} title="No conversations yet" description="Send your first prompt — a conversation is created automatically." />
      ) : (
        <ul className="space-y-0.5">
          {conversations.map((c) => (
            <ConversationRow key={c.id} conversation={c} selected={c.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  );
}
