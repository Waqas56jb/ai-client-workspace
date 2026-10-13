/**
 * Domain vocabularies. The database stores the spec's canonical values; the
 * API speaks the frontend's short ids. Mapping happens only here.
 */
export const TOOL_TO_DB = {
  writing: 'writing_editing',
  image: 'image_creation',
  advertising: 'advertising_copy',
  vehicle: 'vehicle_description',
};
export const TASK_TYPE_TO_DB = { ...TOOL_TO_DB, general: 'general' };
export const DB_TO_TOOL = Object.fromEntries(Object.entries(TASK_TYPE_TO_DB).map(([k, v]) => [v, k]));

export const TOOL_IDS = ['writing', 'image', 'advertising', 'vehicle'];
export const TASK_TYPES = ['writing', 'image', 'advertising', 'vehicle', 'general'];
export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'];
export const JOB_STATUSES = ['active', 'on_hold', 'completed', 'archived'];
export const CLIENT_STATUSES = ['active', 'prospect', 'archived'];
export const WRITING_FORMATS = ['email', 'sms', 'whatsapp', 'other'];

export const ACTIVITY = {
  CLIENT_CREATED: 'client_created',
  CLIENT_UPDATED: 'client_updated',
  CLIENT_ARCHIVED: 'client_archived',
  BRAND_UPDATED: 'brand_updated',
  JOB_CREATED: 'job_created',
  JOB_UPDATED: 'job_updated',
  JOB_DELETED: 'job_deleted',
  TASK_CREATED: 'task_created',
  TASK_UPDATED: 'task_updated',
  TASK_DELETED: 'task_deleted',
  AI_REQUEST: 'ai_request',
  FILE_UPLOADED: 'file_uploaded',
  FILE_RENAMED: 'file_renamed',
  FILE_DELETED: 'file_deleted',
  OUTPUT_REVISED: 'output_revised',
  OUTPUT_APPROVED: 'output_approved',
  INSTRUCTIONS_UPDATED: 'instructions_updated',
  PRESET_UPDATED: 'preset_updated',
  TEAM_UPDATED: 'team_updated',
};
