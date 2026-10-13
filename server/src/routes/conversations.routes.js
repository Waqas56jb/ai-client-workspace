import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import * as v from '../validators/conversations.validators.js';
import * as ctrl from '../controllers/conversations.controller.js';

const router = Router();

router.get('/tasks/:taskId/conversations', validate({ params: v.taskParams, query: v.listConversationsQuery }), ctrl.listForTask);
router.post('/tasks/:taskId/conversations', validate({ params: v.taskParams, body: v.createConversationBody }), ctrl.create);
router.get('/conversations/:id', validate({ params: v.conversationParams }), ctrl.get);
router.patch('/conversations/:id', validate({ params: v.conversationParams, body: v.updateConversationBody }), ctrl.update);
router.get('/conversations/:id/messages', validate({ params: v.conversationParams, query: v.listMessagesQuery }), ctrl.listMessages);
router.post('/conversations/:id/messages', validate({ params: v.conversationParams, body: v.createMessageBody }), ctrl.addMessage);

export default router;
