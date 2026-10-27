import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { AssistantMessage, GenerationStatus, isEditable, SendingMessage, UserMessage } from './ChatMessages';

const NEAR_BOTTOM_PX = 160;

/**
 * The conversation. Follows new messages while the reader is at the bottom;
 * if they scrolled up to read, it stays put and offers "Jump to latest".
 */
export function ChatThread({ thread, sending, busy, handlers }) {
  const { messages, outputsById, filesById, versionsByMessage, images, pending } = thread;
  const ref = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const stick = useRef(true);

  const toBottom = useCallback((smooth) => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const onScroll = () => {
    const el = ref.current;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stick.current = near;
    setAtBottom(near);
  };

  // first paint of a chat: start at the latest message
  useLayoutEffect(() => toBottom(false), [toBottom, thread.conversation?.id]);
  const size = `${messages.length}:${pending?.status || ''}:${sending ? 1 : 0}:${Object.keys(outputsById).length}`;
  useEffect(() => {
    if (stick.current) toBottom(true);
  }, [size, toBottom]);
  // sending always brings the reader to their own message
  useEffect(() => {
    if (sending) {
      stick.current = true;
      toBottom(true);
    }
  }, [sending, toBottom]);

  let lastText = null;
  for (let i = messages.length - 1; i >= 0 && !lastText; i -= 1) {
    const m = messages[i];
    if (m.role === 'assistant') lastText = (m.outputIds || []).find((id) => outputsById[id]?.kind === 'text') || null;
  }
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto scrollbar-thin">
        <ol className="mx-auto flex w-full max-w-[920px] flex-col gap-7 px-4 pb-10 pt-6 sm:px-8" aria-label="Messages">
          {messages.map((m) =>
            m.role === 'user' ? (
              <UserMessage
                key={m.id}
                message={m}
                filesById={filesById}
                images={images}
                canEdit={!busy && !pending && isEditable(m)}
                onSaveEdit={handlers.onSaveEdit}
                onUseImage={handlers.onUseImage}
              />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                isLast={m.id === lastAssistant?.id && !pending}
                busy={busy || !!pending}
                outputsById={outputsById}
                versions={versionsByMessage.get(m.id)}
                images={images}
                latestTextOutputId={lastText}
                onClarify={handlers.onClarify}
                onRetry={handlers.onRetry}
                onQuickChange={handlers.onQuickChange}
                onEditImage={handlers.onUseImage}
                onRegenerate={handlers.onRegenerate}
                onImagesExpired={handlers.onImagesExpired}
              />
            ),
          )}
          {sending?.text && <SendingMessage text={sending.text} attachmentCount={sending.attachmentCount} />}
          {pending && !sending?.text && <GenerationStatus pending={pending} />}
        </ol>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => toBottom(true)}
          className="absolute bottom-4 left-1/2 inline-flex h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[15px] font-semibold text-ink shadow-pop hover:bg-canvas focus-ring"
        >
          <ArrowDown size={17} aria-hidden /> Jump to latest
        </button>
      )}
    </div>
  );
}
