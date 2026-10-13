import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { AlertTriangle, Braces, Copy, FileText, ImageIcon, RotateCw, Sparkles } from 'lucide-react';
import { Avatar, Badge, Button, Tooltip } from '@/components/ui';
import { TOOL_BY_ID } from '@/lib/constants';
import { cn, copyToClipboard, formatDateTime, timeAgo } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

export function AiAvatar({ className }) {
  return (
    <span className={cn('ai-gradient inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-glow', className)} aria-hidden>
      <Sparkles size={15} />
    </span>
  );
}

export function TypingIndicator({ tool, label }) {
  const t = TOOL_BY_ID[tool];
  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <AiAvatar />
      <div className="min-w-0">
        <p className="mb-1 text-[12px] font-semibold text-ink">
          StudioFlow AI <span className="font-normal text-muted">· {t?.short || 'AI'}</span>
        </p>
        <div className="inline-flex items-center gap-2.5 rounded-xl rounded-tl-sm border border-line bg-surface px-3.5 py-2.5 shadow-card">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-brand" style={{ animationDelay: `${i * 0.16}s` }} />
            ))}
          </span>
          <span className="text-[12.5px] text-muted">{label || `Generating with ${t?.name || 'AI'}…${isMockMode ? ' (simulated)' : ''}`}</span>
        </div>
      </div>
    </div>
  );
}

function AttachmentChips({ ids, filesById }) {
  if (!ids?.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const f = filesById?.[id];
        const Icon = f?.kind === 'image' ? ImageIcon : FileText;
        return (
          <li key={id} className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11.5px] text-muted">
            <Icon size={12} aria-hidden />
            <span className="truncate">{f?.name || 'Attachment (removed)'}</span>
          </li>
        );
      })}
    </ul>
  );
}

function MessageBubble({ message: m, laterExists, onRetry, retrying, onClarify, clarifying, onViewRequest, filesById, renderOutputs, busy }) {
  const isUser = m.role === 'user';
  const tool = TOOL_BY_ID[m.tool];
  const copy = async () => (await copyToClipboard(m.content)) && toast.success('Message copied');
  const showChips = m.status === 'clarify' && !m.resolved && !laterExists && m.options?.length;

  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="group flex gap-3">
      {isUser ? <Avatar user={m.user} size="md" /> : <AiAvatar />}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[12.5px] font-semibold text-ink">{isUser ? m.user?.name || 'You' : 'StudioFlow AI'}</span>
          {!isUser && tool && <span className="text-[11.5px] font-medium" style={{ color: tool.color }}>{tool.short}</span>}
          {!isUser && isMockMode && <Badge className="h-[18px] px-1 text-[10.5px]">Simulated</Badge>}
          <time className="text-[11.5px] text-subtle" dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
            {timeAgo(m.createdAt)}
          </time>
          <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <Tooltip content="Copy message">
              <Button size="icon-xs" variant="ghost" icon={Copy} onClick={copy} aria-label="Copy message" />
            </Tooltip>
            {!isUser && m.status !== 'clarify' && (
              <Tooltip content="View prepared request" side="left">
                <Button size="icon-xs" variant="ghost" icon={Braces} onClick={() => onViewRequest(m)} aria-label="View prepared request" />
              </Tooltip>
            )}
          </span>
        </div>

        {m.status === 'error' ? (
          <div className="rounded-xl rounded-tl-sm border border-danger/25 bg-danger-soft/60 px-3.5 py-2.5">
            <p className="flex items-start gap-2 text-[13.5px] leading-6 text-ink">
              <AlertTriangle size={16} className="mt-1 shrink-0 text-danger" aria-hidden />
              {m.content}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" icon={RotateCw} loading={retrying} disabled={busy && !retrying} onClick={() => onRetry(m)}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" icon={Braces} onClick={() => onViewRequest(m)}>
                View prepared request
              </Button>
            </div>
          </div>
        ) : (
          <div className={cn('inline-block max-w-full rounded-xl px-3.5 py-2.5', isUser ? 'rounded-tl-sm bg-brand-soft/60 text-ink' : 'rounded-tl-sm border border-line bg-surface shadow-card')}>
            <p className="whitespace-pre-wrap break-words text-[13.5px] leading-6 text-ink">{m.content}</p>
            <AttachmentChips ids={m.attachmentIds} filesById={filesById} />
          </div>
        )}

        {m.status === 'clarify' && (
          <div className="mt-2">
            {showChips ? (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Choose a format">
                {m.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={clarifying || busy}
                    onClick={() => onClarify(m, o.id)}
                    className="inline-flex h-8 items-center rounded-full border border-brand/30 bg-surface px-3.5 text-[12.5px] font-medium text-brand shadow-card transition-colors hover:bg-brand-soft focus-ring disabled:opacity-50"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-muted">Format selected — see the reply below.</p>
            )}
          </div>
        )}

        {!isUser && m.outputIds?.length > 0 && <div className="mt-3">{renderOutputs(m)}</div>}
      </div>
    </motion.li>
  );
}

/**
 * Scrollable conversation transcript. Keeps itself scrolled to the bottom when
 * new messages arrive or while a response is generating.
 */
export function MessageList({ messages = [], pending, pendingTool, pendingPrompt, pendingUser, retryingId, clarifyingId, onRetry, onClarify, onViewRequest, filesById, renderOutputs, empty, className }) {
  const ref = useRef(null);
  const count = messages.length;
  const busy = !!pending || !!retryingId || !!clarifyingId;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: count ? 'smooth' : 'auto' });
  }, [count, busy]);

  return (
    <div ref={ref} className={cn('overflow-y-auto scrollbar-thin', className)}>
      {!count && !pending ? (
        empty
      ) : (
        <ol className="mx-auto w-full max-w-4xl space-y-6 px-3 py-5 sm:px-6" aria-label="Conversation" aria-live="polite">
          {messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              laterExists={i < count - 1}
              onRetry={onRetry}
              retrying={retryingId === m.id}
              onClarify={onClarify}
              clarifying={clarifyingId === m.id}
              onViewRequest={onViewRequest}
              filesById={filesById}
              renderOutputs={renderOutputs}
              busy={busy}
            />
          ))}
          {pending && pendingPrompt != null && (
            <li className="flex gap-3 opacity-80">
              <Avatar user={pendingUser} size="md" />
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[12.5px] font-semibold text-ink">
                  {pendingUser?.name || 'You'} <span className="font-normal text-subtle">· sending…</span>
                </p>
                <div className="inline-block max-w-full rounded-xl rounded-tl-sm bg-brand-soft/60 px-3.5 py-2.5">
                  <p className="whitespace-pre-wrap break-words text-[13.5px] leading-6 text-ink">{pendingPrompt}</p>
                </div>
              </div>
            </li>
          )}
          {(pending || retryingId || clarifyingId) && (
            <li>
              <TypingIndicator tool={pendingTool} />
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
