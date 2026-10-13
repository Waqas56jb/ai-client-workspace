import { apiClient, call, notFound, ServiceError } from './apiClient';
import { isMockMode } from '@/lib/config';
import { getDb, mutate } from './mock/db';
import { hasPendingRevision, logActivity, outputStatus, pickClient, pickJob, pickTask, pickUser, touchTask } from './mock/relations';
import { createId, matches, nowIso, sortBy } from '@/lib/utils';

/**
 * Output + version model.
 *
 * output  { id, taskId, jobId, clientId, conversationId, tool, kind, title, format,
 *           currentVersionId, approvedVersionId, fileId, ... }
 * version { id, outputId, versionNumber, kind, content, sections, image, missing,
 *           note, status: 'draft'|'approved', approvedAt, approvedBy,
 *           sourceVersionId, createdAt, createdBy }
 *
 * Business rule: versions are immutable once approved. Revising always creates a
 * new draft version; the approved reference only moves on explicit approval.
 */
export function enrichOutput(db, o, { withVersions = false } = {}) {
  const versions = db.versions.filter((v) => v.outputId === o.id).sort((a, b) => a.versionNumber - b.versionNumber);
  const current = versions.find((v) => v.id === o.currentVersionId) || versions[versions.length - 1] || null;
  const approved = versions.find((v) => v.id === o.approvedVersionId) || null;
  const decorate = (v) => (v ? { ...v, createdByUser: pickUser(db, v.createdBy), approvedByUser: pickUser(db, v.approvedBy) } : null);
  return {
    ...o,
    status: outputStatus(o),
    pendingRevision: hasPendingRevision(o),
    versionCount: versions.length,
    client: pickClient(db, o.clientId),
    job: pickJob(db, o.jobId),
    task: pickTask(db, o.taskId),
    createdByUser: pickUser(db, o.createdBy),
    currentVersion: decorate(current),
    approvedVersion: decorate(approved),
    versions: withVersions ? versions.map(decorate) : undefined,
  };
}

/** Plain-text representation of a version (used for copy, download and search). */
export function versionText(version) {
  if (!version) return '';
  if (version.sections?.length) return version.sections.map((s) => `${s.label}\n${s.text}`).join('\n\n');
  if (version.kind === 'image') return version.image?.prompt || '';
  return version.content || '';
}

function syncOutputFile(db, output, version) {
  const f = db.files.find((x) => x.id === output.fileId);
  if (!f) return;
  f.updatedAt = version.createdAt;
  if (output.kind !== 'image') f.size = new Blob([versionText(version)]).size;
}

export const outputService = {
  /** @param {{ taskId?, conversationId?, clientId?, jobId?, status?, search? }} params */
  list: (params = {}) =>
    call({
      mock: () => {
        const db = getDb();
        let list = db.outputs;
        ['taskId', 'conversationId', 'clientId', 'jobId', 'tool', 'kind'].forEach((k) => {
          if (params[k] && params[k] !== 'all') list = list.filter((o) => o[k] === params[k]);
        });
        let res = list.map((o) => enrichOutput(db, o));
        if (params.status && params.status !== 'all') res = res.filter((o) => o.status === params.status);
        if (params.search) res = res.filter((o) => matches(`${o.title} ${versionText(o.currentVersion)}`, params.search));
        return sortBy(res, 'updatedAt', 'desc');
      },
      api: () => apiClient.getAll('/outputs', { params }),
    }),

  get: (id) =>
    call({
      mock: () => {
        const db = getDb();
        const o = db.outputs.find((x) => x.id === id);
        if (!o) throw notFound('Output');
        return enrichOutput(db, o, { withVersions: true });
      },
      api: () => apiClient.get(`/outputs/${id}`),
    }),

  rename: (id, title) =>
    call({
      mock: () =>
        mutate((db) => {
          const o = db.outputs.find((x) => x.id === id);
          if (!o) throw notFound('Output');
          o.title = title;
          const f = db.files.find((x) => x.id === o.fileId);
          if (f) f.name = `${title}.${o.kind === 'image' ? 'png' : 'txt'}`;
          return enrichOutput(db, o);
        }),
      api: () => apiClient.patch(`/outputs/${id}`, { title }),
    }),
};

export const versionService = {
  listByOutput: (outputId) =>
    call({
      mock: () => {
        const db = getDb();
        const o = db.outputs.find((x) => x.id === outputId);
        if (!o) throw notFound('Output');
        return enrichOutput(db, o, { withVersions: true }).versions;
      },
      api: () => apiClient.get(`/outputs/${outputId}/versions`),
    }),

  /**
   * Creates a new DRAFT version. Never mutates an existing version.
   * @param {string} outputId
   * @param {{ content?, sections?, image?, missing?, note?, sourceVersionId? }} payload
   */
  createRevision: (outputId, payload) =>
    call({
      mock: () =>
        mutate((db) => {
          const o = db.outputs.find((x) => x.id === outputId);
          if (!o) throw notFound('Output');
          const existing = db.versions.filter((v) => v.outputId === outputId);
          const source = db.versions.find((v) => v.id === (payload.sourceVersionId || o.currentVersionId));
          const version = {
            id: createId('ver'),
            outputId,
            versionNumber: Math.max(0, ...existing.map((v) => v.versionNumber)) + 1,
            kind: o.kind,
            content: payload.content ?? source?.content ?? '',
            sections: payload.sections ?? source?.sections ?? null,
            image: payload.image ?? source?.image ?? null,
            missing: payload.missing ?? source?.missing ?? null,
            note: payload.note?.trim() || 'Revision',
            status: 'draft',
            approvedAt: null,
            approvedBy: null,
            sourceVersionId: source?.id || null,
            createdAt: nowIso(),
            createdBy: null,
          };
          const act = logActivity(db, {
            type: 'output_revised',
            resourceType: 'output',
            resourceId: o.id,
            clientId: o.clientId,
            jobId: o.jobId,
            taskId: o.taskId,
            description: `Created v${version.versionNumber} of “${o.title}”${o.approvedVersionId ? ' — approved version preserved' : ''}`,
          });
          version.createdBy = act.userId;
          db.versions.push(version);
          o.currentVersionId = version.id;
          o.updatedAt = version.createdAt;
          syncOutputFile(db, o, version);
          touchTask(db, o.taskId);
          return enrichOutput(db, o, { withVersions: true });
        }),
      api: () => apiClient.post(`/outputs/${outputId}/revisions`, payload),
    }),

  /** Makes an older version the working version by copying it into a NEW draft. */
  restoreAsDraft: (outputId, versionId) =>
    isMockMode
      ? versionService.createRevision(outputId, { sourceVersionId: versionId, note: 'Restored from an earlier version' })
      : call({ api: () => apiClient.post(`/outputs/${outputId}/versions/${versionId}/restore`, { note: 'Restored from an earlier version' }) }),
};

export const approvalService = {
  /** Approves a specific version and moves the output's approved reference to it. */
  approve: (outputId, versionId) =>
    call({
      mock: () =>
        mutate((db) => {
          const o = db.outputs.find((x) => x.id === outputId);
          if (!o) throw notFound('Output');
          const v = db.versions.find((x) => x.id === (versionId || o.currentVersionId) && x.outputId === outputId);
          if (!v) throw notFound('Version');
          if (o.approvedVersionId === v.id) throw new ServiceError('This version is already the approved version.');
          const act = logActivity(db, {
            type: 'output_approved',
            resourceType: 'output',
            resourceId: o.id,
            clientId: o.clientId,
            jobId: o.jobId,
            taskId: o.taskId,
            description: `Approved v${v.versionNumber} of “${o.title}”`,
          });
          v.status = 'approved';
          v.approvedAt = act.createdAt;
          v.approvedBy = act.userId;
          o.approvedVersionId = v.id;
          o.updatedAt = act.createdAt;
          touchTask(db, o.taskId);
          return enrichOutput(db, o, { withVersions: true });
        }),
      api: async () => {
        let vid = versionId;
        if (!vid) vid = (await apiClient.get(`/outputs/${outputId}`)).data?.currentVersionId;
        if (!vid) throw notFound('Version');
        return apiClient.post(`/outputs/${outputId}/versions/${vid}/approve`, {});
      },
    }),

  /** Approval events for an output, newest first. */
  history: (outputId) =>
    call({
      mock: () => {
        const db = getDb();
        return sortBy(
          db.versions
            .filter((v) => v.outputId === outputId && v.approvedAt)
            .map((v) => ({ versionId: v.id, versionNumber: v.versionNumber, approvedAt: v.approvedAt, approvedBy: pickUser(db, v.approvedBy), isCurrent: db.outputs.find((o) => o.id === outputId)?.approvedVersionId === v.id })),
          'approvedAt',
          'desc',
        );
      },
      api: () => apiClient.get(`/outputs/${outputId}/approvals`),
    }),

  /**
   * Currently approved versions only. A newer draft revision never removes the
   * previously approved version from this list.
   * @param {{ search?, clientId?, jobId?, taskId?, kind?, approvedBy?, dateRange?, sort? }} params
   */
  listApproved: (params = {}) =>
    call({
      mock: () => {
        const db = getDb();
        let list = db.outputs.filter((o) => o.approvedVersionId).map((o) => enrichOutput(db, o));
        ['clientId', 'jobId', 'taskId', 'kind', 'tool'].forEach((k) => {
          if (params[k] && params[k] !== 'all') list = list.filter((o) => o[k] === params[k]);
        });
        if (params.approvedBy && params.approvedBy !== 'all') list = list.filter((o) => o.approvedVersion?.approvedBy === params.approvedBy);
        if (params.dateRange && params.dateRange !== 'all') {
          const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }[params.dateRange];
          list = list.filter((o) => Date.now() - new Date(o.approvedVersion.approvedAt).getTime() <= days * 86400000);
        }
        if (params.search) {
          list = list.filter((o) => matches(`${o.title} ${o.client?.name} ${o.job?.title} ${o.task?.title} ${versionText(o.approvedVersion)}`, params.search));
        }
        const sorts = {
          approved: (l) => sortBy(l, (o) => o.approvedVersion.approvedAt, 'desc'),
          title: (l) => sortBy(l, (o) => o.title.toLowerCase(), 'asc'),
          client: (l) => sortBy(l, (o) => o.client?.name || '', 'asc'),
        };
        return (sorts[params.sort] || sorts.approved)(list);
      },
      api: () => apiClient.getAll('/approved', { params }),
    }),
};
