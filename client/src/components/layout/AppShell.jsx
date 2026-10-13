import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { Sheet } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';

export function AppShell() {
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNav = useUiStore((s) => s.setMobileNav);
  const location = useLocation();

  useEffect(() => {
    setMobileNav(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname, setMobileNav]);

  return (
    <div className="flex min-h-screen bg-canvas">
      <a href="#main" className="sr-only z-[100] rounded-lg bg-brand px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <div className="sticky top-0 hidden h-screen shrink-0 lg:block">
        <Sidebar />
      </div>
      <Sheet open={mobileNavOpen} onClose={() => setMobileNav(false)} side="left" title="Navigation" width="max-w-[270px]">
        <Sidebar mobile onNavigate={() => setMobileNav(false)} />
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="min-w-0 flex-1" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
