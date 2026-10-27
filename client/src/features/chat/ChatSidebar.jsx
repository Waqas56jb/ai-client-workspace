import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  BadgeCheck,
  Files,
  Frame,
  History,
  ImageIcon,
  LogOut,
  Mail,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { Avatar, Dialog, Menu, Skeleton } from '@/components/ui';
import { BrandMark } from '@/components/layout/Sidebar';
import { useChatHistory, useDebounce } from '@/hooks';
import { groupByRecency } from '@/lib/chatDates';
import { archiveChat, renameChat } from '@/services/chatApi';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { cn } from '@/lib/utils';
import { ClientPicker } from './ClientPicker';
import { DateFilter, dateFilterRange } from './DateFilter';

const MORE_LINKS = [
  { to: '/history', label: 'All chat history', icon: History },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/files', label: 'Files', icon: Files },
  { to: '/approved', label: 'Approved work', icon: BadgeCheck },
  { to: '/image-presets', label: 'Image sizes', icon: Frame },
  { to: '/ai-instructions', label: 'AI instructions', icon: SlidersHorizontal },
  { to: '/team', label: 'Team', icon: UsersRound },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function RenameDialog({ chat, onClose }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(chat?.title || '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await renameChat(chat.id, title.trim());
      await qc.invalidateQueries({ queryKey: ['chat-history'] });
      await qc.invalidateQueries({ queryKey: ['conversation', chat.id] });
      toast.success('Chat renamed.');
      onClose();
    } catch (e) {
      toast.error(e?.message || 'Could not rename the chat. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={!!chat} onClose={onClose} title="Rename chat" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1.5 block text-[15px] font-semibold text-ink">Chat name</span>
          <input autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-xl px-4 text-[15px] font-medium text-muted hover:bg-canvas focus-ring">
            Cancel
          </button>
          <button type="submit" disabled={saving || !title.trim()} className="h-11 rounded-xl bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60 focus-ring">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function useArchiveChat(onArchived) {
  const qc = useQueryClient();
  return async (chat) => {
    try {
      await archiveChat(chat.id);
      await qc.invalidateQueries({ queryKey: ['chat-history'] });
      toast.success('Chat archived. Its approved work is still in Approved work.');
      onArchived?.(chat);
    } catch (e) {
      toast.error(e?.message || 'Could not archive the chat. Please try again.');
    }
  };
}

/**
 * Left side of the chat: New chat, the client, search + date, the chats grouped
 * by day, and a "More" menu for everything else.
 */
export function ChatSidebar({ activeId, clients, clientsQ, clientId, onClientChange, onNewChat, onNavigate, onClose }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const theme = useChatStore((s) => s.theme);
  const setTheme = useChatStore((s) => s.setTheme);
  const [search, setSearch] = useState('');
  const [dateF, setDateF] = useState({});
  const [renaming, setRenaming] = useState(null);
  const q = useDebounce(search.trim(), 300);
  const params = useMemo(() => ({ search: q || undefined, clientId: clientId || undefined, ...dateFilterRange(dateF), limit: 100 }), [q, clientId, dateF]);
  const historyQ = useChatHistory(params);
  const groups = useMemo(() => groupByRecency(historyQ.data?.items || []), [historyQ.data]);
  const filtered = !!q || !!dateF.day || !!dateF.year;
  const archive = useArchiveChat((chat) => chat.id === activeId && onNewChat());
  const clientName = clients.find((c) => c.id === clientId)?.name;

  const go = (to) => {
    onNavigate?.();
    navigate(to);
  };
  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-full w-full flex-col bg-sidebar-chat">
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <BrandMark size={30} />
        <span className="font-display text-[17px] font-bold tracking-tight text-ink">StudioFlow AI</span>
        {onClose && (
          <button type="button" onClick={onClose} className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface hover:text-ink focus-ring" aria-label="Close menu">
            <X size={20} />
          </button>
        )}
      </div>

      <div className="space-y-3 px-3 pb-3 pt-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[16px] font-semibold text-white shadow-[0_1px_2px_rgba(81,69,208,0.35)] transition-colors hover:bg-brand-hover focus-ring"
        >
          <Plus size={20} aria-hidden /> New chat
        </button>
        <ClientPicker clients={clients} loading={clientsQ.isLoading} error={clientsQ.isError} onRetry={() => clientsQ.refetch()} value={clientId} onChange={onClientChange} />
        <label className="relative block">
          <span className="sr-only">Search chats</span>
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats"
            className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-[15.5px] text-ink outline-none placeholder:text-subtle focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
        </label>
        <DateFilter value={dateF} onChange={setDateF} />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin" aria-label="Chat history">
        {historyQ.isLoading ? (
          <div className="space-y-2 px-2 pt-1" role="status" aria-label="Loading chats">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-full rounded-xl" />
            ))}
          </div>
        ) : historyQ.isError ? (
          <p className="px-3 py-6 text-center text-[15px] leading-6 text-muted">
            Chats could not be loaded.{' '}
            <button type="button" onClick={() => historyQ.refetch()} className="font-semibold text-brand underline focus-ring">
              Try again
            </button>
          </p>
        ) : !groups.length ? (
          <p className="px-3 py-6 text-center text-[15px] leading-6 text-muted">
            {filtered ? 'No chats match. Try another word or date.' : clientName ? `No chats for ${clientName} yet.` : 'Your chats will appear here.'}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-3">
              <h3 className="px-3 pb-1 pt-2 text-[13.5px] font-semibold text-muted">{g.label}</h3>
              <ul>
                {g.items.map((c) => (
                  <li key={c.id} className="group relative">
                    <Link
                      to={`/chat/${c.id}`}
                      onClick={onNavigate}
                      aria-current={c.id === activeId ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center gap-2.5 rounded-xl py-2 pl-3 pr-12 text-[15px] transition-colors focus-ring',
                        c.id === activeId ? 'bg-surface font-semibold text-ink shadow-card' : 'text-ink hover:bg-surface/70',
                      )}
                    >
                      {c.tool === 'image' ? <ImageIcon size={17} className="shrink-0 text-muted" aria-label="Image chat" /> : <Mail size={17} className="shrink-0 text-muted" aria-label="Writing chat" />}
                      <span className="min-w-0 flex-1 truncate" title={c.title}>
                        {c.title}
                      </span>
                    </Link>
                    <span className="absolute right-1 top-1/2 -translate-y-1/2">
                      <Menu
                        width={220}
                        size="lg"
                        items={[
                          { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(c) },
                          { label: 'Archive', icon: Archive, onSelect: () => archive(c) },
                        ]}
                        trigger={
                          <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink focus-ring" aria-label={`Options for ${c.title}`}>
                            <MoreHorizontal size={18} />
                          </button>
                        }
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>

      <div className="flex items-center gap-2 border-t border-line p-3">
        <Avatar user={user} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">{user?.name}</span>
        </span>
        <Menu
          width={270}
          size="lg"
          align="end"
          items={[
            ...MORE_LINKS.map((l) => ({ label: l.label, icon: l.icon, onSelect: () => go(l.to) })),
            { separator: true },
            { label: 'Light theme', icon: Sun, hint: theme === 'light' ? 'On' : '', onSelect: () => setTheme('light') },
            { label: 'Dark theme', icon: Moon, hint: theme === 'dark' ? 'On' : '', onSelect: () => setTheme('dark') },
            { label: 'Same as my device', icon: Monitor, hint: theme === 'system' ? 'On' : '', onSelect: () => setTheme('system') },
            { separator: true },
            { label: 'Sign out', icon: LogOut, danger: true, onSelect: signOut },
          ]}
          trigger={
            <button type="button" className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold text-ink hover:bg-canvas focus-ring">
              <MoreHorizontal size={18} aria-hidden /> More
            </button>
          }
        />
      </div>
      <RenameDialog key={renaming?.id || 'none'} chat={renaming} onClose={() => setRenaming(null)} />
    </div>
  );
}
