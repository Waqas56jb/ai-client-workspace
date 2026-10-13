import { NavLink, Outlet } from 'react-router-dom';
import { Page, PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTIONS } from './sections';
import { isMockMode } from '@/lib/config';

export default function SettingsLayout() {
  return (
    <Page>
      <PageHeader title="Settings" description={isMockMode ? 'Your profile, workspace preferences, demo storage and session security.' : 'Your profile, workspace preferences, storage and session security.'} className="mb-5" />
      <nav aria-label="Settings sections" className="mb-7 flex max-w-full items-center gap-5 overflow-x-auto border-b border-line scrollbar-thin">
        {SETTINGS_SECTIONS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            end={s.end}
            className={({ isActive }) =>
              cn(
                '-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40',
                isActive ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink',
              )
            }
          >
            <s.icon size={15} aria-hidden />
            {s.label}
          </NavLink>
        ))}
      </nav>
      <div className="max-w-4xl">
        <Outlet />
      </div>
    </Page>
  );
}
