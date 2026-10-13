import { Link, useLocation } from 'react-router-dom';
import { Compass, LayoutDashboard, Search } from 'lucide-react';
import { Button, Page } from '@/components/ui';
import { useBreadcrumbs, usePageTitle } from '@/hooks';

export default function NotFoundPage() {
  usePageTitle('Page not found');
  useBreadcrumbs([{ label: 'Not found' }]);
  const { pathname } = useLocation();

  return (
    <Page narrow>
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-gradient-to-b from-white to-canvas text-brand shadow-card">
          <Compass size={26} aria-hidden />
        </span>
        <p className="font-display text-[13px] font-bold uppercase tracking-[0.14em] text-brand">404</p>
        <h1 className="mt-2 font-display text-[26px] font-bold tracking-[-0.01em] text-ink">We couldn’t find that page</h1>
        <p className="mt-2 max-w-md text-[14px] leading-6 text-muted">
          {pathname && pathname !== '/not-found' ? (
            <>
              Nothing lives at <code className="rounded bg-[#F1F2F7] px-1 py-px font-mono text-[12.5px] text-ink">{pathname}</code>. It may have been moved or deleted.
            </>
          ) : (
            'The item you were looking for may have been moved or deleted.'
          )}{' '}
          Try search, or head back to your dashboard.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Button as={Link} to="/dashboard" variant="primary" icon={LayoutDashboard}>
            Go to dashboard
          </Button>
          <Button as={Link} to="/search" icon={Search}>
            Search the workspace
          </Button>
        </div>
      </div>
    </Page>
  );
}
