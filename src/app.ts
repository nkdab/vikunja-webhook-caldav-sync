import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config/env';
import { TaskSyncStateRepository } from './repositories/state-repository';
import { registerHealthRoutes } from './routes/health';
import { registerWebhookRoutes } from './routes/webhook';
import { CaldavClient } from './services/caldav-client';
import { SyncService } from './services/sync-service';
import { TaskQueue } from './services/task-queue';

export interface AppDependencies {
  app: FastifyInstance;
  stateRepo: TaskSyncStateRepository;
}

export function buildApp(config: AppConfig): AppDependencies {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
    genReqId: () => randomUUID(),
  });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    done(null, body);
  });

  const stateRepo = new TaskSyncStateRepository(config.SQLITE_PATH);
  const caldavClient = new CaldavClient(config, app.log);
  const syncService = new SyncService(config, stateRepo, caldavClient, app.log);
  const queue = new TaskQueue(syncService, app.log, config.DEBOUNCE_MS);

  if (!config.VIKUNJA_WEBHOOK_SECRET) {
    app.log.warn('VIKUNJA_WEBHOOK_SECRET is not set. Signature validation is disabled.');
  }

  app.register(async (instance) => {
    await registerWebhookRoutes(instance, config, queue);
    await registerHealthRoutes(instance, syncService);
  });

  app.addHook('onClose', async () => {
    stateRepo.close();
  });

  return { app, stateRepo };
}
