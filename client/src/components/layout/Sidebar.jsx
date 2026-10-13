import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronsLeft, ChevronsRight, ChevronsUpDown, LogOut, Settings, SlidersHorizontal, UserRound, Check } from 'lucide-react';
import { Avatar, Menu, Tooltip } from '@/components/ui';
import { NAV_SECTIONS } from './navigation';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { isMockMode } from '@/lib/config';

export function BrandMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="sf-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B7CFF" />
          <stop offset="1" stopColor="#5145D0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#sf-g)" />
      <path d="M10 20.5c1.4 1.3 3.4 2 5.6 2 3 0 5-1.4 5-3.6 0-4.6-9.8-2.6-9.8-7.3 0-2 1.9-3.4 4.6-3.4 1.9 0 3.6.6 4.8 1.6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function NavItem({ item, collapsed, onNavigate }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent/60',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-accent" aria-hidden />}
          <Icon size={17} className={cn('shrink-0', item.highlight && !isActive && 'text-brand-accent')} aria-hidden />
          {!collapsed && <span className="truncate">{item.label}</span>}
          {!collapsed && item.highlight && <span className="ml-auto rounded-md bg-brand/25 px-1.5 py-px text-[10px] font-semibold text-[#C9C2FF]">AI</span>}
        </>
      )}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right" className="w-full">
      <div className="w-full">{link}</div>
    </Tooltip>
  ) : (
    link
  );
}

/**
 * Dark premium sidebar. `mobile` renders the drawer variant (always expanded).
 */
export function Sidebar({ mobile = false, onNavigate }) {
  const collapsedPref = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const collapsed = !mobile && collapsedPref;
  const [closedSections, setClosedSections] = useState({});
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const doLogout = async () => {
    await logout();
    toast.success(isMockMode ? 'Signed out of the demo session' : 'Signed out');
    navigate('/login', { replace: true });
  };

  return (
    <aside
      className={cn('flex h-full flex-col bg-sidebar text-white', mobile ? 'w-[270px]' : collapsed ? 'w-[72px]' : 'w-[250px]', 'transition-[width] duration-200')}
      aria-label="Main navigation"
    >
      {/* Brand */}
      <div className={cn('flex h-16 shrink-0 items-center gap-2.5 border-b border-white/[0.06]', collapsed ? 'justify-center px-0' : 'px-5')}>
        <BrandMark />
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold leading-none tracking-tight">StudioFlow AI</p>
            <p className="mt-1 text-[11px] text-sidebar-muted">Client workspace</p>
          </div>
        )}
      </div>

      {/* Workspace switcher (single workspace in v1) */}
      <div className={cn('pt-4', collapsed ? 'px-3' : 'px-4')}>
        <Menu
          width={232}
          align="start"
          items={[
            { label: 'Main Workspace', icon: Check, onSelect: () => {} },
            { separator: true },
            { label: 'Additional workspaces arrive with the backend', disabled: true },
          ]}
          trigger={
            <button
              type="button"
              className={cn('flex w-full items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.04] text-left transition-colors hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-brand-accent/60 outline-none', collapsed ? 'h-10 justify-center' : 'h-11 px-2.5')}
              aria-label="Workspace: Main Workspace"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#2A2850] to-[#3B3770] text-[11px] font-bold text-[#C9C2FF]">M</span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">Main Workspace</span>
                    <span className="block text-[11px] text-sidebar-muted">{isMockMode ? '3 members · Demo' : 'Shared workspace'}</span>
                  </span>
                  <ChevronsUpDown size={14} className="text-sidebar-muted" aria-hidden />
                </>
              )}
            </button>
          }
        />
      </div>

      {/* Navigation */}
      <nav className={cn('sidebar-scroll mt-3 flex-1 overflow-y-auto pb-4', collapsed ? 'px-3' : 'px-4')}>
        {NAV_SECTIONS.map((section) => {
          const closed = !collapsed && closedSections[section.id];
          return (
            <div key={section.id} className="mt-3 first:mt-1">
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => setClosedSections((s) => ({ ...s, [section.id]: !s[section.id] }))}
                  className="mb-1 flex w-full items-center justify-between rounded px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#6E6F8E] hover:text-sidebar-muted focus-visible:ring-2 focus-visible:ring-brand-accent/60 outline-none"
                  aria-expanded={!closed}
                >
                  {section.label}
                  <ChevronDown size={12} className={cn('transition-transform', closed && '-rotate-90')} aria-hidden />
                </button>
              ) : (
                <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden />
              )}
              {!closed && (
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.to}>
                      <NavItem item={item} collapsed={collapsed} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      {!mobile && (
        <div className={cn('border-t border-white/[0.06] py-2', collapsed ? 'px-3' : 'px-4')}>
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn('flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-xs text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white focus-visible:ring-2 focus-visible:ring-brand-accent/60 outline-none', collapsed && 'justify-center px-0')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      )}

      {/* Profile */}
      <div className={cn('border-t border-white/[0.06] p-3', collapsed && 'px-2')}>
        <Menu
          width={220}
          align="start"
          items={[
            { label: 'Profile', icon: UserRound, onSelect: () => { onNavigate?.(); navigate('/settings/profile'); } },
            { label: 'Preferences', icon: SlidersHorizontal, onSelect: () => { onNavigate?.(); navigate('/settings/preferences'); } },
            { label: 'Settings', icon: Settings, onSelect: () => { onNavigate?.(); navigate('/settings'); } },
            { separator: true },
            { label: 'Log out', icon: LogOut, danger: true, onSelect: doLogout },
          ]}
          trigger={
            <button
              type="button"
              className={cn('flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-brand-accent/60 outline-none', collapsed && 'justify-center')}
              aria-label={`Account menu for ${user?.name || 'user'}`}
            >
              <Avatar user={user} size="md" />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{user?.name}</span>
                    <span className="block truncate text-[11.5px] text-sidebar-muted">{user?.role}</span>
                  </span>
                  <ChevronsUpDown size={14} className="text-sidebar-muted" aria-hidden />
                </>
              )}
            </button>
          }
        />
      </div>
    </aside>
  );
}
