import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Dialog, Field, Input } from '@/components/ui';
import { useServiceMutation } from '@/hooks';
import { fileService } from '@/services';

const renameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a file name.')
    .max(140, 'Keep the name under 140 characters.')
    .refine((v) => !/[\\/:*?"<>|]/.test(v), 'File names can’t contain \\ / : * ? " < > |'),
});

export function RenameFileDialog({ open, onClose, file }) {
  const { register, handleSubmit, reset, formState } = useForm({ resolver: zodResolver(renameSchema), defaultValues: { name: file?.name || '' } });
  useEffect(() => {
    if (open) reset({ name: file?.name || '' });
  }, [open, file?.name, reset]);

  const mutation = useServiceMutation(({ name }) => fileService.update(file.id, { name }), {
    success: (data) => `Renamed to “${data.name}”`,
    onSuccess: onClose,
  });

  const submit = handleSubmit((values) => {
    if (values.name === file.name) return onClose();
    return mutation.mutate(values);
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Rename file"
      description={file?.category === 'output' ? 'Renaming a generated output also updates its title in the task and Approved Work.' : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={mutation.isPending}>
            Save name
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <Field label="File name" required error={formState.errors.name?.message}>
          <Input data-autofocus autoComplete="off" {...register('name')} />
        </Field>
      </form>
    </Dialog>
  );
}
