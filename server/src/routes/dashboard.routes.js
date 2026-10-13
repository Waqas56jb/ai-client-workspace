import { Router } from 'express';
import * as c from '../controllers/dashboard.controller.js';
import { validate } from '../middleware/validate.js';
import { recentQuery } from '../validators/dashboard.validators.js';

const router = Router();

router.get('/dashboard/summary', c.summary);
router.get('/dashboard/recent-activity', validate({ query: recentQuery }), c.recentActivity);
router.get('/dashboard/recent-files', validate({ query: recentQuery }), c.recentFiles);
router.get('/dashboard/recent-jobs', validate({ query: recentQuery }), c.recentJobs);

export default router;
