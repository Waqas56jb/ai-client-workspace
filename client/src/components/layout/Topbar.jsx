import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, FolderPlus, Menu as MenuIcon, Plus, Search, Sparkles, UserPlus, FilePlus2 } from 'lucide-react';
import { Avatar, Button, Kbd, Menu } from '@/components/ui';
import { ActivityFeed } from '@/components/data-display';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { useActivity } from '@/hooks';
import { cn } from '@/lib/utils';

function Breadcrumbs() {
  const items = useUiStore((s) => s.breadcrumbs);
  if (!items?.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[13px]">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className={cn('flex min-w-0 items-center gap-1', !last && 'hidden sm:flex', i < items.length - 2 && 'hidden md:flex')}>
              {i > 0 && <ChevronRight size={14} className="shrink-0 text-subtle" aria-hidden />}
              {item.to && !last ? (
                <Link to={item.to} className="truncate rounded text-muted transition-colors hover:text-ink focus-ring">
                  {item.label}
                </Link>
              ) : (
                <span className={cn('truncate', last ? 'font-semibold text-ink' : 'text-muted')} aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const SEEN_KEY = 'studioflow.activity.seen';

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { data } = useActivity({ limit: 1 });
  const latest = data?.[0]?.createdAt;
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) || '';
    } catch {
      return '';
    }
  });
  const unread = latest && latest > seen;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    if (latest) {
      setSeen(latest);
      try {
        localStorage.setItem(SEEN_KEY, latest);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="icon" icon={Bell} onClick={toggle} aria-label={unread ? 'Recent activity (new)' : 'Recent activity'} aria-expanded={open} />
      {unread && <span className="pointer-events-none absolute right-2 top-2 h-2 w-2 rounded-full bg-brand ring-2 ring-surface" aria-hidden />}
      {open && (
        <div className="absolute right-0 top-11 z-[60] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-[13px] font-semibold">Recent activity</p>
            <span className="text-xs text-muted">Shared workspace</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto py-1 scrollbar-thin" onClick={() => setOpen(false)}>
            <ActivityFeed limit={8} compact />
          </div>
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const setMobileNav = useUiStore((s) => s.setMobileNav);
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur-md sm:px-6">
      <Button variant="ghost" size="icon" icon={MenuIcon} className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation" />
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="hidden h-9 w-[260px] items-center gap-2 rounded-lg border border-line bg-canvas px-3 text-[13px] text-subtle transition-colors hover:border-line-strong hover:text-muted focus-ring md:flex xl:w-[320px]"
        aria-label="Search workspace"
      >
        <Search size={15} aria-hidden />
        <span className="flex-1 text-left">Search clients, jobs, files…</span>
        <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
        <Kbd>K</Kbd>
      </button>
      <Button variant="ghost" size="icon" icon={Search} className="md:hidden" onClick={() => setCommandOpen(true)} aria-label="Search workspace" />

      <Notifications />

      <Menu
        width={210}
        items={[
          { label: 'New client', icon: UserPlus, onSelect: () => navigate('/clients/new') },
          { label: 'New job', icon: FolderPlus, onSelect: () => navigate('/jobs/new') },
          { label: 'New task', icon: FilePlus2, onSelect: () => navigate('/tasks/new') },
          { separator: true },
          { label: 'Start AI task', icon: Sparkles, onSelect: () => navigate('/ai-workspace') },
        ]}
        trigger={
          <Button variant="primary" size="md" icon={Plus} aria-label="Create new">
            <span className="hidden sm:inline">New</span>
          </Button>
        }
      />

      <Link to="/settings/profile" className="hidden rounded-full focus-ring sm:block" aria-label="Your profile">
        <Avatar user={user} size="md" />
      </Link>
    </header>
  );
}
