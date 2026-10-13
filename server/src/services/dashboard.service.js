import { getDatabase } from '../config/db.js';
import { listActivity } from '../repositories/activityQuery.repository.js';
import { dailyVersionChart, listFiles, metricCounts } from '../repositories/dashboard.repository.js';
import { listJobs } from '../repositories/jobs.repository.js';
import { signedUrl } from './storage.service.js';

const RECENT = { jobs: 5, files: 6, activity: 10 };
const PREVIEW_TTL_SECONDS = 3600;

/**
 * Adds a short-lived signed `previewUrl` to image files (null otherwise or when
 * the object cannot be signed). Call after the DB transaction has finished.
 * @param {{ items: object[], previewPaths: Map<string,string> }} listing result of listFiles
 */
export async function withPreviews({ items, previewPaths }) {
  await Promise.all(
    items.map(async (file) => {
      const path = previewPaths.get(file.id);
      file.previewUrl = path ? await signedUrl(path, { ttl: PREVIEW_TTL_SECONDS }).then((r) => r.url, () => null) : null;
    }),
  );
  return items;
}

const metric = (value, hint) => ({ value, hint });

function buildMetrics(c) {
  return {
    clients: metric(c.clients, `${c.clients_30d} added in 30 days`),
    activeJobs: metric(c.active_jobs, `${c.on_hold_jobs} on hold`),
    openTasks: metric(c.open_tasks, `${c.review_tasks} in review`),
    files: metric(c.files, `${c.generated_7d} generated this week`),
    drafts: metric(c.drafts, `${c.draft_revisions} revisions of approved work`),
    approved: metric(c.approved, `${c.approved_7d} approved this week`),
  };
}

const recentJobs = async (tx, limit = RECENT.jobs) => (await listJobs(tx, { sort: 'updated', limit, offset: 0 })).items;
const recentFiles = (tx, limit = RECENT.files) => listFiles(tx, { sort: 'updated', limit });

/** Dashboard summary: metric cards, 14-day chart, recent jobs and files. */
export async function summary(userId) {
  const data = await getDatabase().withUser(userId, async (tx) => ({
    metrics: buildMetrics(await metricCounts(tx)),
    chart: await dailyVersionChart(tx, 14),
    recentJobs: await recentJobs(tx),
    recentFiles: await recentFiles(tx),
  }));
  return { ...data, recentFiles: await withPreviews(data.recentFiles) };
}

/** Most recent activity entries. */
export function recentActivity(userId, { limit = RECENT.activity } = {}) {
  return getDatabase().withUser(userId, (tx) => listActivity(tx, { limit }));
}

/** Most recently updated non-archived jobs. */
export function recentJobList(userId, { limit } = {}) {
  return getDatabase().withUser(userId, (tx) => recentJobs(tx, limit));
}

/** Most recently updated files. */
export async function recentFileList(userId, { limit } = {}) {
  return withPreviews(await getDatabase().withUser(userId, (tx) => recentFiles(tx, limit)));
}
