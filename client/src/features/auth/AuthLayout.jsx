import { FileText, ImageIcon, Mail, ShieldAlert, ShieldCheck } from 'lucide-react';
import { BrandMark } from '@/components/layout/Sidebar';
import { isMockMode } from '@/lib/config';

const POINTS = [
  { icon: Mail, title: 'Emails, SMS & replies', text: 'Professional drafts in your client’s voice, ready to copy.' },
  { icon: ImageIcon, title: 'Images & ad creative', text: 'Create and edit pictures in every size you need.' },
  { icon: FileText, title: 'Documents', text: 'Read PDFs, Word files and spreadsheets — and export to Word.' },
];

/** Full-page layout used by the sign-in and password reset screens. Stacks on phones, splits on desktops. */
export function AuthLayout({ children }) {
  return (
    <div className="relative flex min-h-dvh bg-canvas">
      <aside className="relative hidden w-[46%] max-w-[620px] overflow-hidden bg-sidebar text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#6257E8] opacity-45 blur-[110px]" />
          <div className="absolute -bottom-32 right-[-80px] h-[460px] w-[460px] rounded-full bg-[#A78BFA] opacity-25 blur-[120px]" />
          <svg className="absolute inset-0 h-full w-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M32 0H0V32" fill="none" stroke="#fff" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#auth-grid)" />
          </svg>
        </div>

        <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-14">
          <div className="flex items-center gap-2.5">
            <BrandMark size={36} />
            <span className="font-display text-[18px] font-bold tracking-tight">StudioFlow AI</span>
          </div>

          <div className="max-w-md">
            <h2 className="font-display text-[38px] font-bold leading-[1.1] tracking-[-0.02em] text-white">
              Your clients’ work,
              <br />
              <span className="bg-gradient-to-r from-[#C9C2FF] to-[#8B7CFF] bg-clip-text text-transparent">written in seconds.</span>
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-sidebar-muted">Ask in plain words. StudioFlow remembers each client and answers like your best writer.</p>

            <ul className="mt-8 space-y-4">
              {POINTS.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-[#C9C2FF]">
                    <Icon size={18} aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[14.5px] font-semibold text-white">{title}</span>
                    <span className="block text-[13.5px] leading-6 text-sidebar-muted">{text}</span>
                  </span>
                </li>
              ))}
            </ul>

            <ChatPreview />
          </div>

          <p className="flex items-center gap-1.5 text-xs text-sidebar-muted/80">
            <ShieldCheck size={14} aria-hidden /> Private workspace · accounts are created by your administrator
          </p>
        </div>
      </aside>

      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        {/* soft brand glow on phones and tablets, where the side panel is hidden */}
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[360px] w-[560px] -translate-x-1/2 rounded-full bg-brand opacity-[0.12] blur-[100px] lg:hidden" aria-hidden />
        <div className="relative w-full max-w-[440px]">
          <div className="mb-8 flex items-center justify-center gap-2.5 lg:hidden">
            <BrandMark size={34} />
            <span className="font-display text-[18px] font-bold tracking-tight text-ink">StudioFlow AI</span>
          </div>
          <div className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-9">{children}</div>
          <p className="mt-6 text-center text-xs text-subtle">© {new Date().getFullYear()} StudioFlow AI{isMockMode ? ' · Frontend demo' : ''}</p>
        </div>
      </main>
    </div>
  );
}

function ChatPreview() {
  return (
    <div className="mt-9 space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm" aria-hidden>
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#6257E8] px-3.5 py-2 text-[13px] leading-5 text-white">
        Write a soft email about the rescheduled event
      </div>
      <div className="w-[92%] rounded-2xl rounded-bl-md bg-white/[0.08] px-3.5 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#C9C2FF]">
          <Mail size={12} /> Email draft
        </div>
        <div className="space-y-1.5">
          <div className="h-2 w-[90%] rounded-full bg-white/20" />
          <div className="h-2 w-[76%] rounded-full bg-white/12" />
          <div className="h-2 w-[58%] rounded-full bg-white/12" />
        </div>
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
