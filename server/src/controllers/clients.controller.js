import * as svc from '../services/clients.service.js';
import { created, handler, ok } from '../utils/response.js';

/** HTTP adapters for /clients. */
export const list = handler(async (req, res) => {
  const { items, meta } = await svc.listClients(req.user.id, req.validatedQuery);
  ok(res, items, { meta });
});
export const get = handler(async (req, res) => ok(res, await svc.getClient(req.user.id, req.params.clientId)));
export const create = handler(async (req, res) => created(res, await svc.createClient(req.user.id, req.body), { message: 'Client created.' }));
export const update = handler(async (req, res) => ok(res, await svc.updateClient(req.user.id, req.params.clientId, req.body), { message: 'Client updated.' }));
export const getBrand = handler(async (req, res) => ok(res, await svc.getBrand(req.user.id, req.params.clientId)));
export const updateBrand = handler(async (req, res) =>
  ok(res, await svc.updateBrand(req.user.id, req.params.clientId, req.body), { message: 'Brand profile saved.' }),
);
export const archive = handler(async (req, res) => ok(res, await svc.archiveClient(req.user.id, req.params.clientId), { message: 'Client archived.' }));
export const restore = handler(async (req, res) => ok(res, await svc.restoreClient(req.user.id, req.params.clientId), { message: 'Client restored.' }));
export const remove = handler(async (req, res) =>
  ok(res, await svc.removeClient(req.user.id, req.params.clientId), { message: 'Client archived. Existing work has been kept.' }),
);
export const deletionImpact = handler(async (req, res) => ok(res, await svc.deletionImpact(req.user.id, req.params.clientId)));
export const referenceFiles = handler(async (req, res) => {
  const { items, meta } = await svc.referenceFiles(req.user.id, req.params.clientId, req.validatedQuery);
  ok(res, items, { meta });
});
export const activity = handler(async (req, res) => ok(res, await svc.clientActivity(req.user.id, req.params.clientId, req.validatedQuery)));
