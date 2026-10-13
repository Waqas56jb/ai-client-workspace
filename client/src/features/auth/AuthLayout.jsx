import { CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react';
import { BrandMark } from '@/components/layout/Sidebar';
import { isMockMode } from '@/lib/config';

const POINTS = [
  'Every client’s brand, voice and reference files in one place',
  'AI writing, images, ad copy and vehicle listings — on brand by default',
  'Version history and approvals for everything you produce',
];

/** Full-page split layout used by the sign-in and password reset screens. */
export function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="relative hidden w-[46%] max-w-[640px] overflow-hidden bg-sidebar text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#6257E8] opacity-40 blur-[110px]" />
          <div className="absolute -bottom-32 right-[-80px] h-[460px] w-[460px] rounded-full bg-[#A78BFA] opacity-25 blur-[120px]" />
          <svg className="absolute inset-0 h-full w-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M32 0H0V32" fill="none" stroke="#fff" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#auth-grid)" />
          </svg>
        </div>

        <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-12">
          <div className="flex items-center gap-2.5">
            <BrandMark size={34} />
            <span className="font-display text-[17px] font-bold tracking-tight">StudioFlow AI</span>
          </div>

          <div className="max-w-md">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11.5px] font-medium text-[#C9C2FF]">
              <Sparkles size={13} aria-hidden /> AI client workspace
            </span>
            <h2 className="mt-5 font-display text-[34px] font-bold leading-[1.15] tracking-[-0.02em] text-white">
              Client work, organised.
              <br />
              <span className="bg-gradient-to-r from-[#C9C2FF] to-[#8B7CFF] bg-clip-text text-transparent">Creative output, accelerated.</span>
            </h2>
            <ul className="mt-7 space-y-3.5">
              {POINTS.map((p) => (
                <li key={p} className="flex gap-3 text-[14px] leading-6 text-sidebar-muted">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-brand-accent" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>

            <PreviewCard />
          </div>

          <p className="text-xs text-sidebar-muted/80">© {new Date().getFullYear()} StudioFlow AI{isMockMode ? ' · Frontend demo' : ''}</p>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark size={30} />
            <span className="font-display text-[16px] font-bold tracking-tight text-ink">StudioFlow AI</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function PreviewCard() {
  return (
    <div className="mt-9 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm" aria-hidden>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0B3D91] text-[11px] font-bold">Aa</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">Campaign · Ad copy</div>
          <div className="text-[11.5px] text-sidebar-muted">Version 3 approved</div>
        </div>
        <span className="rounded-md bg-[#16865C]/25 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#7BE0B5]">Approved</span>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="h-2 w-[88%] rounded-full bg-white/15" />
        <div className="h-2 w-[72%] rounded-full bg-white/10" />
        <div className="h-2 w-[54%] rounded-full bg-white/10" />
      </div>
    </div>
  );
}

/** Honest notice that demo auth is not real security. */
export function DemoAuthNotice({ children }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-3 text-[12.5px] leading-5 text-[#7A5313]">
      <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
      <p>{children}</p>
    </div>
  );
}
