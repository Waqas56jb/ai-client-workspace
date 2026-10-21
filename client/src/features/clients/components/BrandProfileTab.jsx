import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { Briefcase, ImageUp, Info, Loader2, Lock, NotebookPen, Palette, PenLine, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, ColorInput, Field, Input, Select, Textarea, UnsavedChangesDialog } from '@/components/ui';
import { useFile, useFileSource, useServiceMutation, useUnsavedChanges } from '@/hooks';
import { clientService, fileService, validateUpload } from '@/services';
import { brandSchema } from '@/lib/validation';
import { ACCEPTED_UPLOADS, FORMALITY_LEVELS, IMAGE_ACCEPT_ATTR, SPELLING_CONVENTIONS, TONES } from '@/lib/constants';
import { EMPTY_BRAND } from '@/lib/brandDefaults';
import { cn } from '@/lib/utils';
import { Section } from './helpers';
import { isMockMode } from '@/lib/config';

const FORM_KEYS = Object.keys(EMPTY_BRAND).filter((k) => k !== 'logoFileId');

function toValues(brand) {
  return Object.fromEntries(FORM_KEYS.map((k) => [k, brand?.[k] ?? EMPTY_BRAND[k] ?? '']));
}

const COLORS = [
  { name: 'primaryColor', label: 'Primary colour' },
  { name: 'secondaryColor', label: 'Secondary colour' },
  { name: 'accentColor', label: 'Accent colour' },
  { name: 'backgroundColor', label: 'Background colour' },
];

const WRITING_TEXT = [
  { name: 'useWords', label: 'Words & phrases to use', placeholder: 'e.g. community, family-owned, hassle-free', rows: 2 },
  { name: 'avoidWords', label: 'Words & phrases to avoid', placeholder: 'e.g. cheap, guaranteed, best in the world', rows: 2 },
  { name: 'formatting', label: 'Formatting preferences', placeholder: 'Headings, bullet points, sentence case, emoji use…', rows: 3 },
  { name: 'writingInstructions', label: 'General writing instructions', placeholder: 'Anything the AI should always keep in mind when writing for this client.', rows: 3 },
];

const TERMS_TEXT = [
  { name: 'warranty', label: 'Warranty wording', placeholder: 'Exact warranty wording supplied by the client.' },
  { name: 'disclaimers', label: 'Standard disclaimers', placeholder: 'Disclaimers to include where relevant.' },
  { name: 'terms', label: 'Standard terms & conditions', placeholder: 'Short T&Cs used in promotions or offers.' },
  { name: 'legal', label: 'Legal wording supplied by the client', placeholder: 'Licence numbers, regulatory statements…' },
];

const ADDITIONAL_TEXT = [
  { name: 'referenceNotes', label: 'Reference notes', placeholder: 'Key facts, history, or notes from briefing calls.' },
  { name: 'productInfo', label: 'Product information', placeholder: 'Products, services, pricing notes.' },
  { name: 'targetAudience', label: 'Target audience', placeholder: 'Who the client is trying to reach.' },
  { name: 'imageStyle', label: 'Preferred image style', placeholder: 'Photography, illustration, mood, lighting, things to avoid.' },
  { name: 'otherInstructions', label: 'Other client-specific instructions', placeholder: 'Anything else that applies to this client only.' },
];

function LogoPreview({ fileId, alt }) {
  const { data: file, isLoading, error } = useFile(fileId);
  const { src, loading, unavailable } = useFileSource(file);
  if (isLoading || loading) return <Loader2 size={18} className="animate-spin text-subtle" aria-label="Loading logo" />;
  if (error) return <span className="px-2 text-center text-[11px] leading-4 text-muted">Logo file was removed</span>;
  if (!src) return <span className="px-2 text-center text-[11px] leading-4 text-muted" title={unavailable || undefined}>Preview unavailable</span>;
  return <img src={src} alt={alt} className="h-full w-full object-contain p-1.5" />;
}

function LivePreview({ values, logoId }) {
  const heading = values.headingFont || values.fontFamily || 'inherit';
  const body = values.bodyFont || values.fontFamily || 'inherit';
  const safe = (c, fallback) => (/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(c || '') ? c : fallback);
  const primary = safe(values.primaryColor, '#6257E8');
  const secondary = safe(values.secondaryColor, '#8B7CFF');
  const accent = safe(values.accentColor, '#FFC531');
  const bg = safe(values.backgroundColor, '#FFFFFF');
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="text-[13px] font-semibold text-ink">Live preview</p>
        <span className="text-[11px] text-muted">Updates as you type</span>
      </div>
      {/* Renders in the client's own brand colours on purpose (excluded from contrast checks). */}
      <div className="p-4" style={{ backgroundColor: bg }} data-brand-preview>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white" style={{ boxShadow: `inset 0 0 0 1px ${primary}22` }}>
            {logoId ? (
              <LogoPreview fileId={logoId} alt="" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: primary }}>
                {(values.businessName || 'B').slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
          <span className="min-w-0 truncate text-[12px] font-semibold" style={{ color: primary, fontFamily: heading }}>
            {values.businessName || 'Business name'}
          </span>
        </div>
        <span className="mt-4 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ backgroundColor: accent, color: '#17182B' }}>
          {values.tone || 'Brand'} tone
        </span>
        <h3 className="mt-2 text-[19px] font-bold leading-tight" style={{ color: primary, fontFamily: heading }}>
          A headline in your brand
        </h3>
        <p className="mt-1.5 text-[12.5px] leading-5" style={{ color: '#3B3D52', fontFamily: body }}>
          Body copy uses {values.bodyFont || values.fontFamily || 'the default font'}, with{' '}
          <span data-brand-preview style={{ color: secondary, fontWeight: 600 }}>secondary highlights</span> where they help.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <span className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: primary, fontFamily: body }}>
            Primary action
          </span>
          <span className="rounded-md border px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: secondary, color: secondary, fontFamily: body }}>
            Secondary
          </span>
        </div>
      </div>
      <div className="flex h-2" aria-hidden>
        {[primary, secondary, accent, bg].map((c, i) => (
          <span key={i} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>
    </div>
  );
}

export function BrandProfileTab({ client }) {
  const [saved, setSaved] = useState(() => ({ values: toValues(client.brand), logoId: client.brand?.logoFileId || null }));
  const [logoId, setLogoId] = useState(saved.logoId);
  const [logoError, setLogoError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({ resolver: zodResolver(brandSchema), defaultValues: saved.values, mode: 'onTouched' });

  const values = watch();
  const dirty = isDirty || logoId !== saved.logoId;
  const blocker = useUnsavedChanges(dirty);

  const save = useServiceMutation((brand) => clientService.updateBrand(client.id, brand), {
    success: 'Brand profile saved — new AI requests for this client will use it',
    onSuccess: (data) => {
      const next = { values: toValues(data.brand), logoId: data.brand?.logoFileId || null };
      setSaved(next);
      setLogoId(next.logoId);
      reset(next.values);
    },
  });

  const upload = useServiceMutation((file) => fileService.upload({ file, clientId: client.id, category: 'reference', description: 'Client logo' }), {
    success: 'Logo uploaded — save changes to apply it',
    onSuccess: (rec) => setLogoId(rec.id),
    onError: (err) => setLogoError(err?.message || 'The logo could not be uploaded.'),
  });

  const pickLogo = (file) => {
    setLogoError('');
    if (!file) return;
    if (ACCEPTED_UPLOADS[file.type] !== 'image') {
      setLogoError(`“${file.name}” isn’t an image. Use PNG, JPG, WebP, GIF or SVG.`);
      return;
    }
    const problem = validateUpload(file);
    if (problem) {
      setLogoError(problem);
      return;
    }
    upload.mutate(file);
  };

  const onSubmit = async (v) => {
    try {
      await save.mutateAsync({ ...v, logoFileId: logoId });
    } catch {
      /* error toast shown by the mutation */
    }
  };

  const resetAll = () => {
    reset(saved.values);
    setLogoId(saved.logoId);
    setLogoError('');
  };

  const textFields = (list) =>
    list.map((f) => (
      <Field key={f.name} label={f.label} error={errors[f.name]?.message} className="sm:col-span-2">
        <Textarea rows={f.rows || 3} placeholder={f.placeholder} {...register(f.name)} />
      </Field>
    ));

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Section icon={Palette} title="Brand identity" description="Logo, colours and typography used in image and design requests.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-[13px] font-medium text-ink">Logo</p>
                <div
                  className={cn(
                    'flex flex-col gap-4 rounded-xl border border-dashed p-4 transition-colors sm:flex-row sm:items-center',
                    dragOver ? 'border-brand bg-brand-soft/50' : 'border-line-strong bg-canvas/50',
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    pickLogo(e.dataTransfer.files?.[0]);
                  }}
                >
                  <div className="checkerboard flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
                    {upload.isPending ? (
                      <Loader2 size={18} className="animate-spin text-subtle" aria-label="Uploading" />
                    ) : logoId ? (
                      <LogoPreview fileId={logoId} alt={`${client.name} logo`} />
                    ) : (
                      <ImageUp size={22} className="text-subtle" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink">{logoId ? 'Logo selected' : 'No logo uploaded'}</p>
                    <p className="mt-0.5 text-xs text-muted">PNG, JPG, WebP, GIF or SVG. Drop an image here or choose a file.{isMockMode ? ' Stored temporarily in this browser in demo mode.' : ''}</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button size="sm" icon={ImageUp} onClick={() => fileInput.current?.click()} loading={upload.isPending}>
                        {logoId ? 'Replace logo' : 'Upload logo'}
                      </Button>
                      {logoId && (
                        <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={() => setLogoId(null)}>
                          Remove logo
                        </Button>
                      )}
                    </div>
                    {logoError && (
                      <p className="mt-2 text-xs font-medium text-danger" role="alert">
                        {logoError}
                      </p>
                    )}
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept={IMAGE_ACCEPT_ATTR}
                    className="sr-only"
                    tabIndex={-1}
                    aria-label="Upload logo"
                    onChange={(e) => {
                      pickLogo(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              {COLORS.map((c) => (
                <Controller
                  key={c.name}
                  control={control}
                  name={c.name}
                  render={({ field }) => (
                    <Field label={c.label} required error={errors[c.name]?.message}>
                      <ColorInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
                    </Field>
                  )}
                />
              ))}

              <Field label="Font family" error={errors.fontFamily?.message} hint="The main brand typeface.">
                <Input placeholder="e.g. Montserrat" {...register('fontFamily')} />
              </Field>
              <Field label="Heading font" error={errors.headingFont?.message}>
                <Input placeholder="e.g. Montserrat ExtraBold" {...register('headingFont')} />
              </Field>
              <Field label="Body font" error={errors.bodyFont?.message}>
                <Input placeholder="e.g. Open Sans" {...register('bodyFont')} />
              </Field>
              <div className="hidden sm:block" aria-hidden />
              <Field label="Brand guidelines" error={errors.guidelines?.message} className="sm:col-span-2">
                <Textarea rows={4} placeholder="Logo usage, clear space, colour rules, photography style…" {...register('guidelines')} />
              </Field>
            </div>
          </Section>

          <Section icon={Briefcase} title="Business information" description="Details the AI can quote in copy, signatures and ads.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" required error={errors.businessName?.message} className="sm:col-span-2">
                <Input placeholder="Registered or trading name" {...register('businessName')} />
              </Field>
              <Field label="Address" error={errors.address?.message} className="sm:col-span-2">
                <Input placeholder="Street, suburb, postcode" {...register('address')} />
              </Field>
              <Field label="Phone" error={errors.phone?.message}>
                <Input type="tel" {...register('phone')} />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <Input type="email" {...register('email')} />
              </Field>
              <Field label="Website" error={errors.website?.message} className="sm:col-span-2">
                <Input placeholder="company.com" {...register('website')} />
              </Field>
            </div>
          </Section>

          <Section icon={PenLine} title="Writing preferences" description="Voice and style for every writing, advertising and vehicle request.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Preferred tone" error={errors.tone?.message}>
                <Select placeholder="Not set" options={TONES} {...register('tone')} />
              </Field>
              <Field label="Formality" error={errors.formality?.message}>
                <Select placeholder="Not set" options={FORMALITY_LEVELS} {...register('formality')} />
              </Field>
              <Field label="Spelling" error={errors.spelling?.message}>
                <Select placeholder="Not set" options={SPELLING_CONVENTIONS} {...register('spelling')} />
              </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">{textFields(WRITING_TEXT)}</div>
          </Section>

          <Section icon={ShieldCheck} title="Approved business terms" description="Exact wording the AI should reuse word-for-word, never rewrite.">
            <div className="grid gap-4 sm:grid-cols-2">{textFields(TERMS_TEXT)}</div>
          </Section>

          <Section icon={NotebookPen} title="Additional information" description="Background that helps the AI produce on-brief work.">
            <div className="grid gap-4 sm:grid-cols-2">{textFields(ADDITIONAL_TEXT)}</div>
          </Section>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <LivePreview values={values} logoId={logoId} />
          <div className="card flex gap-3 p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Lock size={15} aria-hidden />
            </span>
            <div className="text-[12.5px] leading-5 text-muted">
              <p className="font-semibold text-ink">Used for {client.name} only</p>
              <p className="mt-0.5">This profile is attached to AI requests for this client&apos;s tasks. It is never shared with, or applied to, any other client.</p>
            </div>
          </div>
          <div className="flex gap-2 rounded-xl border border-line bg-canvas/70 p-3 text-xs leading-5 text-muted">
            <Info size={14} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
            Fonts preview with installed system fonts; the AI receives the font names as written.
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.16 }}
            className="sticky bottom-4 z-20 mt-5"
          >
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-[13px] text-ink">
                <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
                You have unsaved brand profile changes.
                {Object.keys(errors).length > 0 && <span className="text-danger">Fix {Object.keys(errors).length} highlighted {Object.keys(errors).length === 1 ? 'field' : 'fields'}.</span>}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" icon={RotateCcw} onClick={resetAll} disabled={save.isPending}>
                  Reset changes
                </Button>
                <Button type="submit" variant="primary" icon={Save} loading={isSubmitting || save.isPending}>
                  Save changes
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!dirty && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 text-xs text-muted">
          All changes saved
          <Button variant="secondary" icon={Save} disabled>
            Save changes
          </Button>
        </div>
      )}

      <UnsavedChangesDialog blocker={blocker} />
    </form>
  );
}
