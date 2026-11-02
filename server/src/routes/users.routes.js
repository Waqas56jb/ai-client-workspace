import { Router } from 'express';
import * as c from '../controllers/users.controller.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, listUsersQuery, setPasswordSchema, updateProfileSchema, userIdParams } from '../validators/users.validators.js';

const router = Router();

router.get('/users', validate({ query: listUsersQuery }), c.list);
router.get('/users/me', c.me);
router.patch('/users/me', validate({ body: updateProfileSchema }), c.updateMe);
router.get('/users/:userId', validate({ params: userIdParams }), c.get);
router.patch('/users/:userId', validate({ params: userIdParams, body: updateProfileSchema }), c.update);
// Administrators only (checked in the service): add, set password, remove.
router.post('/users', validate({ body: createUserSchema }), c.create);
router.put('/users/:userId/password', validate({ params: userIdParams, body: setPasswordSchema }), c.setPassword);
router.delete('/users/:userId', validate({ params: userIdParams }), c.remove);

export default router;
