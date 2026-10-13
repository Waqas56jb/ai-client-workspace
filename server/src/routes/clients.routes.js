import { Router } from 'express';
import * as c from '../controllers/clients.controller.js';
import { validate } from '../middleware/validate.js';
import {
  clientActivityQuery,
  clientFilesQuery,
  clientIdParams,
  createClientSchema,
  listClientsQuery,
  updateBrandSchema,
  updateClientSchema,
} from '../validators/clients.validators.js';

const router = Router();
const params = clientIdParams;

router.get('/clients', validate({ query: listClientsQuery }), c.list);
router.post('/clients', validate({ body: createClientSchema }), c.create);
router.get('/clients/:clientId', validate({ params }), c.get);
router.patch('/clients/:clientId', validate({ params, body: updateClientSchema }), c.update);
router.delete('/clients/:clientId', validate({ params }), c.remove);
router.get('/clients/:clientId/brand', validate({ params }), c.getBrand);
router.patch('/clients/:clientId/brand', validate({ params, body: updateBrandSchema }), c.updateBrand);
router.put('/clients/:clientId/brand', validate({ params, body: updateBrandSchema }), c.updateBrand);
router.post('/clients/:clientId/archive', validate({ params }), c.archive);
router.post('/clients/:clientId/restore', validate({ params }), c.restore);
router.get('/clients/:clientId/deletion-impact', validate({ params }), c.deletionImpact);
router.get('/clients/:clientId/reference-files', validate({ params, query: clientFilesQuery }), c.referenceFiles);
router.get('/clients/:clientId/activity', validate({ params, query: clientActivityQuery }), c.activity);

export default router;
