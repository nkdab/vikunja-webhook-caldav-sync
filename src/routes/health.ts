import type { FastifyInstance } from 'fastify';
import { SyncService } from '../services/sync-service';

export async function registerHealthRoutes(
  app: FastifyInstance,
  syncService: SyncService,
): Promise<void> {
  app.get('/healthz', async (request, reply) => {
    const result = await syncService.health();
    if (!result.ok) {
      request.log.error({ reason: result.reason }, 'Health check failed');
      return reply.code(503).send({ status: 'unhealthy', reason: result.reason });
    }

    return reply.send({ status: 'ok' });
  });

  app.get('/readyz', async (request, reply) => {
    const result = await syncService.ready();
    if (!result.ok) {
      request.log.error({ reason: result.reason }, 'Readiness check failed');
      return reply.code(503).send({ status: 'not_ready', reason: result.reason });
    }

    return reply.send({ status: 'ready' });
  });
}
