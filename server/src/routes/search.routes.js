import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/search.validators.js';
import * as ctrl from '../controllers/search.controller.js';

const router = Router();

router.get('/search', validate({ query: v.searchQuery }), ctrl.search);
router.get('/search/suggestions', validate({ query: v.suggestionsQuery }), ctrl.suggestions);

export default router;
