import { Router } from 'express';
import { adminAuthMiddleware, requirePerm, auditContext, type AdminRequest } from '../middleware.js';
import { writeAuditLog } from '../audit.js';
import { getChatFilterWords, saveChatFilterWords } from '../../systems/chat-filter.js';
import {
  archiveManuscriptEverywhere,
  editManuscriptEverywhere,
  listManuscriptsForAdmin,
} from '../services/manuscript-moderation.js';
import { param } from '../util.js';

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

moderationRouter.get('/manuscripts', requirePerm('player.moderate'), async (req: AdminRequest, res) => {
  const includeArchived = String(req.query.includeArchived ?? '') === '1' || req.query.includeArchived === 'true';
  try {
    const manuscripts = await listManuscriptsForAdmin(includeArchived);
    res.json({ manuscripts });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

moderationRouter.put('/manuscripts/:pageId', requirePerm('player.moderate'), async (req: AdminRequest, res) => {
  try {
    const pageId = param(req, 'pageId');
    const manuscript = await editManuscriptEverywhere(
      auditContext(req),
      pageId,
      String(req.body?.title ?? ''),
      String(req.body?.body ?? '')
    );
    res.json({ manuscript });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});

moderationRouter.delete('/manuscripts/:pageId', requirePerm('player.moderate'), async (req: AdminRequest, res) => {
  try {
    const pageId = param(req, 'pageId');
    const manuscript = await archiveManuscriptEverywhere(auditContext(req), pageId);
    res.json({ manuscript });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
  }
});
