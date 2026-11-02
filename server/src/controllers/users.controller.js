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
export const create = handler(async (req, res) => ok(res, await svc.createMember(req.user, req.body), { status: 201, message: 'Account created.' }));
export const setPassword = handler(async (req, res) =>
  ok(res, await svc.setMemberPassword(req.user, req.params.userId, req.body.password), { message: 'Password changed.' }),
);
export const remove = handler(async (req, res) => ok(res, await svc.removeMember(req.user, req.params.userId), { message: 'Member removed.' }));
