import { ImageIcon, Mail, MessageSquareText, Wand2 } from 'lucide-react';

export const STARTERS = [
  {
    id: 'email',
    title: 'Improve an email I wrote',
    text: 'Paste your draft and get a clear, professional version.',
    icon: Mail,
    mode: 'writing',
    format: 'email',
    prompt: 'Please improve this email so it is clear and professional:\n\n',
  },
  {
    id: 'sms',
    title: 'Write an SMS reminder',
    text: 'A short, friendly reminder for a customer.',
    icon: MessageSquareText,
    mode: 'writing',
    format: 'sms',
    prompt: 'Write a friendly SMS reminding our customer about ',
  },
  {
    id: 'social',
    title: 'Create a social media image',
    text: 'Describe it and get a picture in the right size.',
    icon: ImageIcon,
    mode: 'image',
    prompt: 'A bright, eye-catching social media image of ',
  },
  {
    id: 'photo',
    title: 'Change my photo',
    text: 'Add your photo, then say what to change.',
    icon: Wand2,
    mode: 'image',
    prompt: 'Use my photo and ',
    pickPhoto: true,
  },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Calm start screen: what to do, the client, and four big example cards (nothing is sent until the user presses Send). */
export function ChatEmptyState({ firstName, clientPicker, onStarter }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex w-full max-w-[860px] flex-col items-center px-4 pb-8 pt-10 sm:px-8 sm:pt-[8vh]">
        <p className="text-[17px] font-medium text-muted">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </p>
        <h1 className="mt-2 text-center font-display text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[32px]">What would you like to create?</h1>
        <p className="mt-3 max-w-xl text-center text-[17px] leading-7 text-muted">Choose a client, write a message, or add a photo to get started.</p>
        {clientPicker && <div className="mt-7 w-full max-w-[420px]">{clientPicker}</div>}
        <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
          {STARTERS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onStarter(s)}
              className="flex min-h-[92px] items-start gap-4 rounded-2xl border border-line bg-surface p-5 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft/40 focus-ring"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand" aria-hidden>
                <s.icon size={21} />
              </span>
              <span className="min-w-0">
                <span className="block text-[17px] font-semibold leading-6 text-ink">{s.title}</span>
                <span className="mt-1 block text-[15px] leading-6 text-muted">{s.text}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
