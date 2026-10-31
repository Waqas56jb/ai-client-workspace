import { Archive, Brain, Menu as MenuIcon, Pencil } from 'lucide-react';
import { Menu } from '@/components/ui';
import { ClientDot } from './ClientPicker';

/** Who this chat is for (always visible), the chat's name, and Rename / Archive. */
export function ChatHeader({ client, title, onOpenMenu, onRename, onArchive, onMemory }) {
  return (
    <header className="flex h-[68px] shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-6">
      {onOpenMenu && (
        <button type="button" onClick={onOpenMenu} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-canvas focus-ring" aria-label="Open menu and chat history">
          <MenuIcon size={22} />
        </button>
      )}
      {client ? (
        <span className="inline-flex min-w-0 max-w-[50%] shrink-0 items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1.5" title={`Client: ${client.name}`}>
          <ClientDot client={client} />
          <span className="truncate text-[15px] font-semibold text-ink">{client.name}</span>
        </span>
      ) : (
        <span className="text-[15px] font-medium text-muted">No client chosen</span>
      )}
      <h1 className="min-w-0 flex-1 truncate px-1 text-[16px] font-medium text-muted" title={title}>
        {title || 'New chat'}
      </h1>
      {(onRename || onArchive || onMemory) && (
        <Menu
          size="lg"
          label="Chat options"
          width={260}
          items={[
            onMemory && { label: 'What the AI remembers', icon: Brain, onSelect: onMemory },
            onRename && { label: 'Rename chat', icon: Pencil, onSelect: onRename },
            onArchive && { label: 'Archive chat', icon: Archive, onSelect: onArchive },
          ]}
        />
      )}
    </header>
  );
}
