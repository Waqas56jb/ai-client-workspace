import { CornerDownLeft } from 'lucide-react';
import { TOOL_BY_ID } from '@/lib/constants';
import { examplePrompts } from './toolMeta';
import { ToolIcon } from './ToolSelector';

const HINTS = {
  writing: 'Describe what you need — choose a format below, or the assistant will ask.',
  image: 'Describe the image, pick a preset or custom size, then generate.',
  advertising: 'Fill in the campaign brief below, add any extra direction, then generate.',
  vehicle: 'Enter the vehicle details below (make, model and year are required), then generate.',
};

/** Empty conversation state with tool-specific example prompts. */
export function EmptyConversation({ tool, client, job, onPick }) {
  const t = TOOL_BY_ID[tool];
  const examples = examplePrompts(tool, { client, job });
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-10 text-center">
      <ToolIcon tool={tool} size="lg" />
      <h2 className="mt-3 font-display text-lg font-bold text-ink">{t?.name}</h2>
      <p className="mt-1 max-w-md text-[13px] text-muted">{t?.description}</p>
      <p className="mt-1 max-w-md text-[12.5px] text-subtle">{HINTS[tool]}</p>
      {examples.length > 0 && (
        <div className="mt-6 w-full">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{tool === 'advertising' || tool === 'vehicle' ? 'Example instructions' : 'Try an example'}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {examples.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => onPick(ex)}
                  className="group flex h-full w-full items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-[13px] leading-5 text-ink shadow-card transition-all hover:-translate-y-px hover:border-line-strong focus-ring"
                >
                  <span className="flex-1">{ex}</span>
                  <CornerDownLeft size={14} className="mt-0.5 shrink-0 text-subtle group-hover:text-brand" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
