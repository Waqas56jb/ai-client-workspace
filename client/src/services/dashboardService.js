import { apiClient, call } from './apiClient';
import { getDb } from './mock/db';
import { enrichOutput } from './versionService';
import { pickClient, pickUser } from './mock/relations';
import { sortBy } from '@/lib/utils';

const DAY = 86400000;

export const dashboardService = {
  /** Aggregates computed live from the current workspace. */
  summary: () =>
    call({
      mock: () => {
        const db = getDb();
        const since = (days) => (x) => Date.now() - new Date(x.createdAt).getTime() <= days * DAY;
        const activeClients = db.clients.filter((c) => c.status !== 'archived');
        const openTasks = db.tasks.filter((t) => t.status !== 'done');
        const drafts = db.outputs.filter((o) => o.currentVersionId !== o.approvedVersionId);
        const approved = db.outputs.filter((o) => o.approvedVersionId);
        const generatedFiles = db.files.filter((f) => f.category === 'output');

        // 14-day activity chart: generated outputs vs approvals per day
        const chart = Array.from({ length: 14 }, (_, i) => {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          start.setDate(start.getDate() - (13 - i));
          const end = start.getTime() + DAY;
          const inDay = (iso) => {
            const t = new Date(iso).getTime();
            return t >= start.getTime() && t < end;
          };
          return {
            date: start.toISOString(),
            generated: db.versions.filter((v) => inDay(v.createdAt)).length,
            approved: db.versions.filter((v) => v.approvedAt && inDay(v.approvedAt)).length,
          };
        });

        const recentJobs = sortBy(db.jobs.filter((j) => j.status !== 'archived'), 'updatedAt', 'desc')
          .slice(0, 5)
          .map((j) => {
            const outs = db.outputs.filter((o) => o.jobId === j.id);
            return {
              ...j,
              client: pickClient(db, j.clientId),
              taskCount: db.tasks.filter((t) => t.jobId === j.id).length,
              draftCount: outs.filter((o) => o.currentVersionId !== o.approvedVersionId).length,
              approvedCount: outs.filter((o) => o.approvedVersionId).length,
            };
          });

        const recentFiles = sortBy(db.files, 'updatedAt', 'desc')
          .slice(0, 6)
          .map((f) => {
            const o = f.outputId ? db.outputs.find((x) => x.id === f.outputId) : null;
            return {
              ...f,
              client: pickClient(db, f.clientId),
              createdByUser: pickUser(db, f.createdBy),
              output: o ? enrichOutput(db, o) : null,
              status: o ? (o.approvedVersionId ? 'approved' : 'draft') : null,
            };
          });

        return {
          metrics: {
            clients: { value: activeClients.length, hint: `${db.clients.filter(since(30)).length} added in 30 days` },
            activeJobs: { value: db.jobs.filter((j) => j.status === 'active').length, hint: `${db.jobs.filter((j) => j.status === 'on_hold').length} on hold` },
            openTasks: { value: openTasks.length, hint: `${db.tasks.filter((t) => t.status === 'review').length} in review` },
            files: { value: db.files.length, hint: `${generatedFiles.filter(since(7)).length} generated this week` },
            drafts: { value: drafts.length, hint: `${drafts.filter((o) => o.approvedVersionId).length} revisions of approved work` },
            approved: { value: approved.length, hint: `${db.versions.filter((v) => v.approvedAt && Date.now() - new Date(v.approvedAt).getTime() <= 7 * DAY).length} approved this week` },
          },
          chart,
          recentJobs,
          recentFiles,
        };
      },
      api: () => apiClient.get('/dashboard/summary'),
    }),
};
