import { Router } from 'express';
import * as c from '../controllers/tasks.controller.js';
import { validate } from '../middleware/validate.js';
import { clientActivityQuery as activityQuery } from '../validators/clients.validators.js';
import { createTaskSchema, listTasksQuery, taskChildrenQuery, taskIdParams, updateTaskSchema } from '../validators/tasks.validators.js';

const router = Router();
const params = taskIdParams;

router.get('/tasks', validate({ query: listTasksQuery }), c.list);
router.post('/tasks', validate({ body: createTaskSchema }), c.create);
router.get('/tasks/:taskId', validate({ params }), c.get);
router.patch('/tasks/:taskId', validate({ params, body: updateTaskSchema }), c.update);
router.delete('/tasks/:taskId', validate({ params }), c.remove);
router.post('/tasks/:taskId/archive', validate({ params }), c.archive);
router.get('/tasks/:taskId/files', validate({ params, query: taskChildrenQuery }), c.files);
router.get('/tasks/:taskId/activity', validate({ params, query: activityQuery }), c.activity);

export default router;
