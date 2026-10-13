import { Router } from 'express';
import * as c from '../controllers/jobs.controller.js';
import { validate } from '../middleware/validate.js';
import { clientActivityQuery as activityQuery } from '../validators/clients.validators.js';
import { createJobSchema, jobChildrenQuery, jobIdParams, listJobsQuery, updateJobSchema } from '../validators/jobs.validators.js';

const router = Router();
const params = jobIdParams;

router.get('/jobs', validate({ query: listJobsQuery }), c.list);
router.post('/jobs', validate({ body: createJobSchema }), c.create);
router.get('/jobs/:jobId', validate({ params }), c.get);
router.patch('/jobs/:jobId', validate({ params, body: updateJobSchema }), c.update);
router.delete('/jobs/:jobId', validate({ params }), c.remove);
router.post('/jobs/:jobId/archive', validate({ params }), c.archive);
router.get('/jobs/:jobId/tasks', validate({ params, query: jobChildrenQuery }), c.tasks);
router.get('/jobs/:jobId/files', validate({ params, query: jobChildrenQuery }), c.files);
router.get('/jobs/:jobId/activity', validate({ params, query: activityQuery }), c.activity);

export default router;
