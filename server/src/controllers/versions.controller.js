import { created, handler, ok } from '../utils/response.js';
import * as versions from '../services/versions.service.js';
import { sendText } from './files.controller.js';

/** GET /outputs */
export const list = handler(async (req, res) => {
  const { data, meta } = await versions.listOutputs(req.user, req.validatedQuery);
  return ok(res, data, { meta });
});

/** GET /outputs/:id */
export const get = handler(async (req, res) => ok(res, await versions.getOutput(req.user, req.params.id)));

/** PATCH /outputs/:id */
export const rename = handler(async (req, res) => ok(res, await versions.renameOutput(req.user, req.params.id, req.body.title), { message: 'Output renamed.' }));

/** GET /outputs/:id/versions */
export const listVersions = handler(async (req, res) => ok(res, await versions.listVersions(req.user, req.params.id)));

/** GET /outputs/:id/versions/:versionId */
export const getVersion = handler(async (req, res) => ok(res, await versions.getVersion(req.user, req.params.id, req.params.versionId)));

/** POST /outputs/:id/revisions */
export const createRevision = handler(async (req, res) =>
  created(res, await versions.createRevision(req.user, req.params.id, req.body), { message: 'New draft version created.' }),
);

/** POST /outputs/:id/versions/:versionId/restore */
export const restore = handler(async (req, res) =>
  created(res, await versions.restore(req.user, req.params.id, req.params.versionId, req.body.note), { message: 'Version restored as a new draft.' }),
);

/** GET /outputs/:id/versions/:versionId/download */
export const download = handler(async (req, res) => {
  const result = await versions.downloadVersion(req.user, req.params.id, req.params.versionId);
  if (result.kind === 'text') return sendText(res, result);
  return ok(res, { url: result.url, expiresAt: result.expiresAt, fileName: result.fileName });
});
