import './config/env.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { contentRegistry } from './content/registry.js';
import { mergeIngredientIconsFromDb } from './content/ingredient-icons.js';
import { mergeNpcSpritesFromDb } from './content/npc-sprites.js';
import { contentRouter, adminRouter } from './routes/content-admin.js';
import { playerAuthRouter } from './routes/player-auth.js';
import { GameRoom } from './rooms/GameRoom.js';
import { adminApiRouter } from './admin/index.js';
import { disconnectDb } from './services/db.js';

const PORT = Number(process.env.PORT ?? 2567);

async function main() {
  contentRegistry.load();
  await mergeIngredientIconsFromDb();
  await mergeNpcSpritesFromDb();
  const mergedMaps = await contentRegistry.mergePublishedMaps();
  if (mergedMaps > 0) {
    console.log(`[ContentRegistry] Merged ${mergedMaps} published map(s) from database`);
  }
  const { ensureCanonicalMapProjects } = await import('./content/canonical-maps.js');
  await ensureCanonicalMapProjects();

  const { syncAdminRbacFromCatalog } = await import('./admin/rbac-sync.js');
  await syncAdminRbacFromCatalog();
  console.log('[Admin] RBAC permissions synced from catalog');

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  app.use('/api/content', contentRouter);
  app.use('/api/auth', playerAuthRouter);
  app.use('/api/admin', adminRouter); // legacy content reload
  app.use('/admin/api/v1', adminApiRouter);

  // Public: active published HUD layout for the live game engine
  app.get('/api/game/hud/active', async (_req, res) => {
    try {
      const { getActiveHudLayout } = await import('./admin/services/hud-builder/index.js');
      const layout = await getActiveHudLayout();
      if (!layout) {
        res.status(204).end();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(layout);
    } catch (err) {
      console.error('[HUD] active layout fetch failed:', err);
      res.status(500).json({ error: 'Failed to load HUD layout' });
    }
  });

  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });

  gameServer
    .define('game', GameRoom, { shard: 'hollow-creek' })
    .filterBy(['shard'])
    .enableRealtimeListing();

  httpServer.listen(PORT, () => {
    console.log(`[server] HTTP + Colyseus listening on http://localhost:${PORT}`);
    console.log(`[server] Content API: http://localhost:${PORT}/api/content/all`);
    console.log(`[server] Admin API: http://localhost:${PORT}/admin/api/v1`);
  });

  process.on('SIGINT', async () => {
    await disconnectDb();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[server] Fatal:', err);
  process.exit(1);
});
