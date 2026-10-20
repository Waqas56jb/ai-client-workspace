import { PenLine, ImageIcon, Megaphone, CarFront, ClipboardList } from 'lucide-react';
import { isMockMode } from './config';

/** The four AI tools. `id` doubles as the task-type id for tool-specific tasks. */
export const AI_TOOLS = [
  {
    id: 'writing',
    name: 'Writing & Editing',
    short: 'Writing',
    description: 'Emails, SMS, WhatsApp messages and general copy in the client’s voice.',
    icon: PenLine,
    color: '#6257E8',
    soft: '#F0EEFF',
    placeholder: 'Describe what you need written, or paste text to edit…',
  },
  {
    id: 'image',
    name: 'Image Creation & Editing',
    short: 'Images',
    description: 'On-brand visuals at preset or custom dimensions.',
    icon: ImageIcon,
    color: '#C2410C',
    soft: '#FFF1E8',
    placeholder: 'Describe the image: subject, composition, mood, text to include…',
  },
  {
    id: 'advertising',
    name: 'Advertising Copy',
    short: 'Ad Copy',
    description: 'Headlines, social ads, search ads and CTAs for campaigns.',
    icon: Megaphone,
    color: '#0E7490',
    soft: '#E6F6FA',
    placeholder: 'Anything else the copy should emphasise?',
  },
  {
    id: 'vehicle',
    name: 'Vehicle Descriptions',
    short: 'Vehicles',
    description: 'Accurate dealership listings built only from supplied details.',
    icon: CarFront,
    color: '#15803D',
    soft: '#E9F8EE',
    placeholder: 'Additional instructions for this listing (optional)…',
  },
];

export const TOOL_BY_ID = Object.fromEntries(AI_TOOLS.map((t) => [t.id, t]));

export const TASK_TYPES = [
  { id: 'writing', label: 'Writing & Editing', icon: PenLine },
  { id: 'image', label: 'Image Creation & Editing', icon: ImageIcon },
  { id: 'advertising', label: 'Advertising Copy', icon: Megaphone },
  { id: 'vehicle', label: 'Vehicle Description', icon: CarFront },
  { id: 'general', label: 'General Task', icon: ClipboardList },
];
export const TASK_TYPE_BY_ID = Object.fromEntries(TASK_TYPES.map((t) => [t.id, t]));

export const TASK_STATUSES = [
  { id: 'todo', label: 'To do', tone: 'neutral' },
  { id: 'in_progress', label: 'In progress', tone: 'info' },
  { id: 'review', label: 'In review', tone: 'warning' },
  { id: 'done', label: 'Done', tone: 'success' },
];
export const TASK_STATUS_BY_ID = Object.fromEntries(TASK_STATUSES.map((s) => [s.id, s]));

export const JOB_STATUSES = [
  { id: 'active', label: 'Active', tone: 'brand' },
  { id: 'on_hold', label: 'On hold', tone: 'warning' },
  { id: 'completed', label: 'Completed', tone: 'success' },
  { id: 'archived', label: 'Archived', tone: 'neutral' },
];
export const JOB_STATUS_BY_ID = Object.fromEntries(JOB_STATUSES.map((s) => [s.id, s]));

export const CLIENT_STATUSES = [
  { id: 'active', label: 'Active', tone: 'success' },
  { id: 'prospect', label: 'Prospect', tone: 'info' },
  { id: 'archived', label: 'Archived', tone: 'neutral' },
];
export const CLIENT_STATUS_BY_ID = Object.fromEntries(CLIENT_STATUSES.map((s) => [s.id, s]));

export const APPROVAL_STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'approved', label: 'Approved' },
];

export const WRITING_FORMATS = [
  { id: 'email', label: 'Email' },
  { id: 'sms', label: 'SMS' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'other', label: 'Other text' },
];

export const TONES = ['Professional', 'Persuasive', 'Formal', 'Casual', 'Friendly', 'Warm', 'Confident', 'Playful', 'Urgent', 'Premium', 'Informative'];
export const LENGTHS = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
];
export const SPELLING_CONVENTIONS = ['British English', 'American English', 'Australian English', 'New Zealand English', 'Canadian English'];
export const FORMALITY_LEVELS = ['Casual', 'Balanced', 'Formal'];

export const AD_PLATFORMS = ['Facebook & Instagram', 'Google Search', 'LinkedIn', 'TikTok', 'Email campaign', 'Print / Radio', 'Other'];
export const AD_OBJECTIVES = ['Awareness', 'Traffic', 'Lead generation', 'Sales / Conversions', 'Event attendance', 'Engagement'];
export const AD_OUTPUT_TYPES = [
  { id: 'social', label: 'Social media ads' },
  { id: 'search', label: 'Search ad copy' },
  { id: 'promo', label: 'Promotional campaign' },
  { id: 'headlines', label: 'Headlines' },
  { id: 'short', label: 'Short descriptions' },
  { id: 'cta', label: 'Calls to action' },
];

export const FUEL_TYPES = ['Petrol', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Electric', 'LPG'];
export const TRANSMISSIONS = ['Automatic', 'Manual', 'CVT', 'Dual-clutch'];
export const VEHICLE_CONDITIONS = ['New', 'Demonstrator', 'Used — excellent', 'Used — good', 'Used — fair'];

export const FILE_KINDS = [
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Documents' },
  { id: 'text', label: 'Text outputs' },
  { id: 'other', label: 'Other' },
];

export const DATE_RANGES = [
  { id: 'all', label: 'Any time' },
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
];

export const ACCEPTED_UPLOADS = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'image',
  'application/pdf': 'document',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
};
export const ACCEPT_ATTR = Object.keys(ACCEPTED_UPLOADS).join(',');
export const IMAGE_ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

export const ACTIVITY_TYPES = {
  client_created: { label: 'Client created', tone: 'brand' },
  client_updated: { label: 'Client updated', tone: 'neutral' },
  client_archived: { label: 'Client archived', tone: 'neutral' },
  brand_updated: { label: 'Brand profile updated', tone: 'brand' },
  job_created: { label: 'Job created', tone: 'brand' },
  job_updated: { label: 'Job updated', tone: 'neutral' },
  job_deleted: { label: 'Job deleted', tone: 'danger' },
  task_created: { label: 'Task created', tone: 'brand' },
  task_updated: { label: 'Task updated', tone: 'neutral' },
  task_deleted: { label: 'Task deleted', tone: 'danger' },
  ai_request: { label: isMockMode ? 'AI request simulated' : 'AI request', tone: 'info' },
  file_uploaded: { label: 'File uploaded', tone: 'neutral' },
  file_renamed: { label: 'File renamed', tone: 'neutral' },
  file_deleted: { label: 'File removed', tone: 'danger' },
  output_revised: { label: 'Output revised', tone: 'warning' },
  output_approved: { label: 'Output approved', tone: 'success' },
  instructions_updated: { label: 'AI instructions updated', tone: 'brand' },
  preset_updated: { label: 'Image preset updated', tone: 'neutral' },
  team_updated: { label: 'Team profile updated', tone: 'neutral' },
};
