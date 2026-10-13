import * as svc from '../services/users.service.js';
import { handler, ok } from '../utils/response.js';

/** HTTP adapters for /users. */
export const list = handler(async (req, res) => ok(res, await svc.listUsers(req.user.id, req.validatedQuery)));
export const me = handler(async (req, res) => ok(res, await svc.getUser(req.user.id, req.user.id)));
export const get = handler(async (req, res) => ok(res, await svc.getUser(req.user.id, req.params.userId)));
export const updateMe = handler(async (req, res) => ok(res, await svc.updateProfile(req.user.id, req.user.id, req.body), { message: 'Profile updated.' }));
export const update = handler(async (req, res) =>
  ok(res, await svc.updateProfile(req.user.id, req.params.userId, req.body), { message: 'Profile updated.' }),
);
