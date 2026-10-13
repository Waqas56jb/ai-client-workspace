import { useEffect, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, RotateCcw, Save, Trash2, Wand2, MessagesSquare } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Switch, Textarea } from '@/components/ui';
import { useServiceMutation } from '@/hooks';
import { instructionService } from '@/services';
import { parseDirectives } from '@/lib/promptHeuristics';
import { instructionSchema } from '@/lib/validation';
import { TOOL_BY_ID } from '@/lib/constants';
import { createId, formatDateTime, timeAgo } from '@/lib/utils';
import { isMockMode } from '@/lib/config';

const KEYS = ['name', 'description', 'systemInstruction', 'outputRules', 'formatting', 'constraints', 'active', 'examples'];

function toValues(i) {
  const v = Object.fromEntries(KEYS.map((k) => [k, i[k] ?? '']));
  v.active = i.active !== false;
  v.examples = (i.examples || []).map((e) => ({ id: e.id, input: e.input, output: e.output }));
  return v;
}

export function InstructionForm({ instruction, onDirtyChange }) {
  const tool = TOOL_BY_ID[instruction.toolId];
  const [confirmReset, setConfirmReset] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({ resolver: zodResolver(instructionSchema), defaultValues: toValues(instruction) });
  const { fields, append, remove } = useFieldArray({ control, name: 'examples', keyName: '_key' });

  const active = useWatch({ control, name: 'active' });
  const watched = useWatch({ control, name: ['systemInstruction', 'outputRules', 'formatting', 'constraints'] });
  const directives = parseDirectives({ systemInstruction: watched[0], outputRules: watched[1], formatting: watched[2], constraints: watched[3] });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const save = useServiceMutation((values) => instructionService.update(instruction.toolId, values), {
    success: (i) => `${i.name} instructions saved (v${i.version})`,
  });
  const resetDefaults = useServiceMutation(() => instructionService.resetToDefaults(instruction.toolId), {
    success: (i) => `${i.name} reset to ${isMockMode ? 'demo ' : ''}defaults`,
    onSuccess: () => setConfirmReset(false),
  });

  const onSubmit = async (values) => {
    try {
      await save.mutateAsync(values);
      reset(values);
    } catch {
      /* toast shown by useServiceMutation */
    }
  };

  const hasDirectives = directives.prefix || directives.append || directives.signOff;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="flex flex-col gap-4 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                {tool && (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: tool.soft, color: tool.color }}>
                    <tool.icon size={19} aria-hidden />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[16px] font-semibold text-ink">{instruction.name}</h2>
                    <Badge tone="brand">v{instruction.version}</Badge>
                    {isDirty && (
                      <Badge tone="warning" dot>
                        Unsaved changes
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span>Last updated</span>
                    <time dateTime={instruction.updatedAt} title={formatDateTime(instruction.updatedAt)}>
                      {timeAgo(instruction.updatedAt)}
                    </time>
                    {instruction.updatedByUser && (
                      <>
                        <span>by</span>
                        <Avatar user={instruction.updatedByUser} size="xs" />
                        <span className="font-medium text-ink">{instruction.updatedByUser.name}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <Switch
                  checked={active}
                  onChange={(v) => setValue('active', v, { shouldDirty: true })}
                  label={active ? 'Active' : 'Inactive'}
                  description={active ? 'Included in requests' : 'Not included in requests'}
                />
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tool name" error={errors.name?.message} required>
                  <Input {...register('name')} />
                </Field>
                <Field label="Description" error={errors.description?.message} required>
                  <Input {...register('description')} />
                </Field>
              </div>
              <Field label="System instruction" error={errors.systemInstruction?.message} required hint="The core role and behaviour for this tool.">
                <Textarea rows={6} {...register('systemInstruction')} />
              </Field>
              <Field label="Output rules" error={errors.outputRules?.message} hint="Format-specific rules, one per line.">
                <Textarea rows={4} {...register('outputRules')} />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Formatting preferences" error={errors.formatting?.message}>
                  <Textarea rows={3} {...register('formatting')} />
                </Field>
                <Field label="Additional constraints" error={errors.constraints?.message}>
                  <Textarea rows={3} {...register('constraints')} />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Examples"
              description="Input / output pairs that show the model what good looks like"
              icon={MessagesSquare}
              action={
                <Button size="sm" icon={Plus} onClick={() => append({ id: createId('ex'), input: '', output: '' })}>
                  Add example
                </Button>
              }
            />
            {fields.length === 0 ? (
              <EmptyState compact icon={MessagesSquare} title="No examples yet" description="Examples are optional, but one or two strong pairs noticeably improve consistency." />
            ) : (
              <ol className="divide-y divide-line">
                {fields.map((f, idx) => (
                  <li key={f._key} className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-ink">Example {idx + 1}</span>
                      <Button variant="danger-ghost" size="xs" icon={Trash2} onClick={() => remove(idx)} aria-label={`Remove example ${idx + 1}`}>
                        Remove
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Input" error={errors.examples?.[idx]?.input?.message} required>
                        <Textarea rows={3} {...register(`examples.${idx}.input`)} />
                      </Field>
                      <Field label="Expected output" error={errors.examples?.[idx]?.output?.message} required>
                        <Textarea rows={3} {...register(`examples.${idx}.output`)} />
                      </Field>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card className="p-4">
            <div className="flex flex-col gap-2">
              <Button type="submit" variant="primary" icon={Save} loading={isSubmitting} disabled={!isDirty}>
                Save changes
              </Button>
              <Button variant="ghost" icon={RotateCcw} disabled={!isDirty || isSubmitting} onClick={() => reset()}>
                Discard changes
              </Button>
              <div className="my-1 h-px bg-line" />
              <Button variant="danger-ghost" icon={RotateCcw} onClick={() => setConfirmReset(true)}>
                {isMockMode ? 'Reset to demo defaults' : 'Reset to defaults'}
              </Button>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">Saving creates version {instruction.version + 1}. Changes apply to the next {isMockMode ? 'simulated ' : ''}request.</p>
          </Card>

          {isMockMode && <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Wand2 size={15} className="text-brand" aria-hidden /> Demo directives
            </div>
            <p className="text-xs leading-5 text-muted">
              Add a line anywhere in the instructions to visibly change simulated output (real models follow the full instruction text):
            </p>
            <ul className="mt-2.5 space-y-1.5 font-mono text-[11.5px] text-ink">
              <li className="rounded-md bg-canvas px-2 py-1">Prefix: …</li>
              <li className="rounded-md bg-canvas px-2 py-1">Append: …</li>
              <li className="rounded-md bg-canvas px-2 py-1">Sign-off: …</li>
            </ul>
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Detected in this draft</div>
              {hasDirectives ? (
                <dl className="space-y-1 text-xs">
                  {[
                    ['Prefix', directives.prefix],
                    ['Append', directives.append],
                    ['Sign-off', directives.signOff],
                  ]
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="shrink-0 font-medium text-brand">{k}:</dt>
                        <dd className="min-w-0 break-words text-ink">{v}</dd>
                      </div>
                    ))}
                </dl>
              ) : (
                <p className="text-xs text-subtle">None — output uses the default template.</p>
              )}
              <p className="mt-2 text-[11.5px] text-subtle">{directives.ruleCount} instruction lines will be included in the request.</p>
            </div>
          </Card>}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => resetDefaults.mutate()}
        loading={resetDefaults.isPending}
        tone="danger"
        icon={RotateCcw}
        title={`Reset ${instruction.name} to ${isMockMode ? 'demo ' : ''}defaults?`}
        description={`This replaces the current instructions and examples with the original ${isMockMode ? 'demo' : 'default'} set (and discards any unsaved edits). The reset is saved as a new version.`}
        confirmLabel="Reset instructions"
      />
    </form>
  );
}
