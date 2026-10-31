#!/usr/bin/env node
/**
 * Keeps the private storage bucket's allowed file types in step with the API's
 * upload allowlist (src/constants/files.js). It only ADDS missing types to the
 * StudioFlow bucket; it never removes a type, never touches other buckets and
 * keeps the bucket private with its size limit.
 *
 *   node scripts/sync-storage-types.js           # dry run: shows what would change
 *   node scripts/sync-storage-types.js --apply   # updates the bucket
 *
 * Needed when a new upload type is added (e.g. PowerPoint): the bucket created
 * by migration 0003 refuses types it does not list, and uploads then fail with
 * STORAGE_ERROR.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { UPLOAD_TYPES } from '../src/constants/files.js';

const APPLY = process.argv.includes('--apply');
const BUCKET = process.env.STORAGE_BUCKET || 'ai-workspace-files';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: bucket, error } = await admin.storage.getBucket(BUCKET);
if (error || !bucket) {
  console.error(`Bucket “${BUCKET}” could not be read: ${error?.message || 'not found'}`);
  process.exit(1);
}
if (bucket.public) {
  console.error(`Bucket “${BUCKET}” is PUBLIC — refusing to change it. It must be private.`);
  process.exit(1);
}
const current = bucket.allowed_mime_types || [];
const missing = Object.keys(UPLOAD_TYPES).filter((t) => !current.includes(t));
console.log(`Bucket ${BUCKET}: private, ${current.length} allowed types, size limit ${bucket.file_size_limit}`);
if (!missing.length) {
  console.log('Nothing to add — the bucket already allows every upload type.');
  process.exit(0);
}
console.log(`Types to add:\n${missing.map((t) => `  + ${t}`).join('\n')}`);
if (!APPLY) {
  console.log('\nDRY RUN — nothing was changed. Re-run with --apply.');
  process.exit(0);
}
const { error: upErr } = await admin.storage.updateBucket(BUCKET, {
  public: false,
  fileSizeLimit: bucket.file_size_limit ?? undefined,
  allowedMimeTypes: [...current, ...missing],
});
if (upErr) {
  console.error(`Update failed: ${upErr.message}`);
  process.exit(1);
}
const { data: after } = await admin.storage.getBucket(BUCKET);
console.log(`Updated. Bucket is ${after.public ? 'PUBLIC (unexpected!)' : 'private'} and allows ${after.allowed_mime_types.length} types.`);
