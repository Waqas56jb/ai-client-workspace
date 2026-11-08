import { DeleteObjectsCommand, GetObjectCommand, GetPublicAccessBlockCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

/**
 * Private S3 bucket behind the same interface storage.service.js uses with
 * Supabase Storage (`storage.from(bucket).upload/download/remove/createSignedUrl`,
 * `storage.getBucket`). Credentials come from the EC2 instance role — no keys in
 * the environment.
 */
let client = null;
const s3 = () => (client ||= new S3Client({ region: env.AWS_REGION }));

const fail = (e) => ({ data: null, error: { message: e?.message || 'S3 error', statusCode: e?.$metadata?.httpStatusCode } });

const contentDisposition = (name) => `attachment; filename="${name.replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

function bucketApi(Bucket) {
  return {
    async upload(Key, body, { contentType, upsert = false, cacheControl } = {}) {
      try {
        // IfNoneMatch: '*' → never overwrite an existing object (versions are immutable)
        await s3().send(new PutObjectCommand({ Bucket, Key, Body: body, ContentType: contentType, CacheControl: cacheControl ? `max-age=${cacheControl}` : undefined, ...(upsert ? {} : { IfNoneMatch: '*' }) }));
        return { data: { path: Key }, error: null };
      } catch (e) {
        return fail(e);
      }
    },
    async download(Key) {
      try {
        const out = await s3().send(new GetObjectCommand({ Bucket, Key }));
        const bytes = await out.Body.transformToByteArray();
        return { data: new Blob([bytes], { type: out.ContentType || 'application/octet-stream' }), error: null };
      } catch (e) {
        return fail(e);
      }
    },
    async remove(keys) {
      try {
        if (keys.length) await s3().send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
        return { data: [], error: null };
      } catch (e) {
        return fail(e);
      }
    },
    /** One "folder" level, like Supabase: files have an id, sub-folders do not. */
    async list(dir, { limit = 1000 } = {}) {
      try {
        const out = await s3().send(new ListObjectsV2Command({ Bucket, Prefix: `${dir.replace(/\/$/, '')}/`, Delimiter: '/', MaxKeys: limit }));
        const folders = (out.CommonPrefixes || []).map((p) => ({ name: p.Prefix.slice(dir.length + 1).replace(/\/$/, ''), id: null }));
        const files = (out.Contents || []).map((o) => ({ name: o.Key.slice(dir.length + 1), id: o.Key }));
        return { data: [...folders, ...files], error: null };
      } catch (e) {
        return fail(e);
      }
    },
    async createSignedUrl(Key, expiresIn, opts) {
      try {
        const cmd = new GetObjectCommand({ Bucket, Key, ...(opts?.download ? { ResponseContentDisposition: contentDisposition(opts.download) } : {}) });
        return { data: { signedUrl: await getSignedUrl(s3(), cmd, { expiresIn }) }, error: null };
      } catch (e) {
        return fail(e);
      }
    },
  };
}

export const s3Storage = {
  storage: {
    from: (bucket) => bucketApi(bucket),
    /** { public: false } only when the bucket exists AND blocks every kind of public access. */
    async getBucket(Bucket) {
      try {
        await s3().send(new HeadBucketCommand({ Bucket }));
        const pab = await s3().send(new GetPublicAccessBlockCommand({ Bucket }));
        const c = pab.PublicAccessBlockConfiguration || {};
        const locked = !!(c.BlockPublicAcls && c.IgnorePublicAcls && c.BlockPublicPolicy && c.RestrictPublicBuckets);
        return { data: { id: Bucket, public: !locked }, error: null };
      } catch (e) {
        return fail(e);
      }
    },
  },
};
