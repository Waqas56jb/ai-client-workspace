import { handler, ok } from '../utils/response.js';
import * as service from '../services/search.service.js';

/** GET /search */
export const search = handler(async (req, res) => ok(res, await service.search(req.user.id, req.validatedQuery)));

/** GET /search/suggestions */
export const suggestions = handler(async (req, res) => ok(res, await service.suggestions(req.user.id, req.validatedQuery.q)));
