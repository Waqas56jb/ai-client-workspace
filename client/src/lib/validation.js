import { z } from 'zod';

const optionalUrl = z
  .string()
  .trim()
  .refine((v) => !v || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(v), 'Enter a valid website, e.g. example.com')
  .optional()
  .or(z.literal(''));

const optionalEmail = z.string().trim().email('Enter a valid email address').optional().or(z.literal(''));

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
});

export const clientSchema = z.object({
  name: z.string().trim().min(2, 'Client name must be at least 2 characters').max(80),
  slug: z
    .string()
    .trim()
    .min(2, 'Identifier is required')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only'),
  industry: z.string().trim().min(1, 'Industry is required'),
  status: z.enum(['active', 'prospect', 'archived']),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  address: z.string().trim().max(240).optional().or(z.literal('')),
  contactName: z.string().trim().max(80).optional().or(z.literal('')),
  email: optionalEmail,
  phone: z
    .string()
    .trim()
    .refine((v) => !v || /^[+()\d\s-]{6,20}$/.test(v), 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  website: optionalUrl,
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export const jobSchema = z.object({
  title: z.string().trim().min(2, 'Job title must be at least 2 characters').max(100),
  clientId: z.string().min(1, 'Select a client'),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  deadline: z.string().optional().or(z.literal('')),
  status: z.enum(['active', 'on_hold', 'completed', 'archived']),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export const taskSchema = z.object({
  title: z.string().trim().min(2, 'Task title must be at least 2 characters').max(100),
  clientId: z.string().min(1, 'Select a client'),
  jobId: z.string().min(1, 'Select a job'),
  type: z.enum(['writing', 'image', 'advertising', 'vehicle', 'general'], { message: 'Select a task type' }),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  status: z.enum(['todo', 'in_progress', 'review', 'done']),
  assigneeId: z.string().optional().or(z.literal('')),
});

const hex = z.string().regex(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i, 'Use a hex colour, e.g. #6257E8');

export const brandSchema = z.object({
  primaryColor: hex,
  secondaryColor: hex,
  accentColor: hex,
  backgroundColor: hex,
  fontFamily: z.string().trim().max(80).optional().or(z.literal('')),
  headingFont: z.string().trim().max(80).optional().or(z.literal('')),
  bodyFont: z.string().trim().max(80).optional().or(z.literal('')),
  guidelines: z.string().trim().max(4000).optional().or(z.literal('')),
  businessName: z.string().trim().min(1, 'Business name is required'),
  address: z.string().trim().optional().or(z.literal('')),
  phone: z.string().trim().optional().or(z.literal('')),
  email: optionalEmail,
  website: optionalUrl,
  tone: z.string().optional().or(z.literal('')),
  formality: z.string().optional().or(z.literal('')),
  spelling: z.string().optional().or(z.literal('')),
  useWords: z.string().optional().or(z.literal('')),
  avoidWords: z.string().optional().or(z.literal('')),
  formatting: z.string().optional().or(z.literal('')),
  writingInstructions: z.string().optional().or(z.literal('')),
  warranty: z.string().optional().or(z.literal('')),
  disclaimers: z.string().optional().or(z.literal('')),
  terms: z.string().optional().or(z.literal('')),
  legal: z.string().optional().or(z.literal('')),
  referenceNotes: z.string().optional().or(z.literal('')),
  productInfo: z.string().optional().or(z.literal('')),
  targetAudience: z.string().optional().or(z.literal('')),
  imageStyle: z.string().optional().or(z.literal('')),
  otherInstructions: z.string().optional().or(z.literal('')),
});

const dimension = z.coerce
  .number({ message: 'Enter a number' })
  .int('Whole pixels only')
  .min(64, 'Minimum 64px')
  .max(8192, 'Maximum 8192px');

export const presetSchema = z
  .object({
    name: z.string().trim().min(2, 'Preset name is required').max(60),
    description: z.string().trim().max(300).optional().or(z.literal('')),
    width: dimension,
    height: dimension,
    scope: z.enum(['global', 'client']),
    clientId: z.string().optional().or(z.literal('')),
    background: z.string().trim().max(200).optional().or(z.literal('')),
    layout: z.string().trim().max(2000).optional().or(z.literal('')),
    typography: z.string().trim().max(2000).optional().or(z.literal('')),
    brandColors: z.string().trim().max(1000).optional().or(z.literal('')),
    logoPlacement: z.string().trim().max(500).optional().or(z.literal('')),
    safeArea: z.string().trim().max(500).optional().or(z.literal('')),
  })
  .refine((v) => v.scope === 'global' || !!v.clientId, {
    path: ['clientId'],
    message: 'Select a client for a client-specific preset',
  });

export const instructionSchema = z.object({
  name: z.string().trim().min(2, 'Tool name is required'),
  description: z.string().trim().min(1, 'Description is required'),
  systemInstruction: z.string().trim().min(20, 'System instruction should be at least 20 characters'),
  outputRules: z.string().trim().optional().or(z.literal('')),
  formatting: z.string().trim().optional().or(z.literal('')),
  constraints: z.string().trim().optional().or(z.literal('')),
  active: z.boolean(),
  examples: z.array(
    z.object({
      id: z.string(),
      input: z.string().trim().min(1, 'Example input is required'),
      output: z.string().trim().min(1, 'Example output is required'),
    }),
  ),
});

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email: z.string().trim().email('Enter a valid email address'),
  role: z.string().trim().min(1, 'Role is required'),
  avatarColor: z.string().optional(),
});
