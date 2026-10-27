import { Router } from 'express';
import { adminAuthMiddleware, requirePerm, auditContext, type AdminRequest } from '../middleware.js';
import { writeAuditLog } from '../audit.js';
import { getChatFilterWords, saveChatFilterWords } from '../../systems/chat-filter.js';

export const moderationRouter = Router();
moderationRouter.use(adminAuthMiddleware);

moderationRouter.get('/chat-filter', requirePerm('player.moderate'), (_req, res) => {
  res.json({ words: getChatFilterWords() });
});

moderationRouter.put('/chat-filter', requirePerm('player.moderate'), async (req: AdminRequest, res) => {
  const before = getChatFilterWords();
  const words = saveChatFilterWords(req.body?.words);
  await writeAuditLog(auditContext(req), {
    action: 'moderation.chat_filter.update',
    objectType: 'chat_filter',
    objectId: 'words',
    previousValue: before,
    newValue: words,
  });
  res.json({ words });
});
