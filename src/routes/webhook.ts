import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env';
import { TaskQueue } from '../services/task-queue';
import type { VikunjaEventName, VikunjaTask, VikunjaWebhookPayload } from '../types/vikunja';
import { verifyVikunjaSignature } from '../utils/signature';

const SUPPORTED_EVENTS = new Set<VikunjaEventName>([
  'task.created',
  'task.updated',
  'task.deleted',
]);

export async function registerWebhookRoutes(
  app: FastifyInstance,
  config: AppConfig,
  queue: TaskQueue,
): Promise<void> {
  app.post('/webhook/vikunja', async (request, reply) => {
    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) {
      return reply.code(400).send({ error: 'Invalid payload body' });
    }

    if (config.VIKUNJA_WEBHOOK_SECRET) {
      const signatureHeader = request.headers['x-vikunja-signature'];
      if (typeof signatureHeader !== 'string') {
        return reply.code(401).send({ error: 'Missing signature header' });
      }

      const valid = verifyVikunjaSignature(rawBody, signatureHeader, config.VIKUNJA_WEBHOOK_SECRET);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid webhook signature' });
      }
    }

    let payload: VikunjaWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as VikunjaWebhookPayload;
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON payload' });
    }

    const eventName = normalizeEventName(payload);
    if (!eventName) {
      return reply.code(400).send({ error: 'Invalid event name' });
    }

    if (!SUPPORTED_EVENTS.has(eventName)) {
      request.log.info({ event_name: eventName }, 'Ignoring unsupported event');
      return reply.code(200).send({ status: 'ignored', event_name: eventName });
    }

    const task = extractTask(payload);
    if (!task) {
      return reply.code(400).send({ error: 'Missing data.task in payload' });
    }

    queue.enqueue({
      eventName,
      task,
      requestId: request.id,
      receivedAt: Date.now(),
    });

    request.log.info(
      {
        request_id: request.id,
        event_name: eventName,
        task_id: String(task.id),
        action: 'accepted',
      },
      'Webhook event accepted',
    );

    return reply.code(200).send({ status: 'accepted' });
  });
}

function normalizeEventName(payload: VikunjaWebhookPayload): VikunjaEventName | null {
  const rawEvent = payload.event_name ?? payload.eventName ?? payload.event;
  if (rawEvent === 'task.created' || rawEvent === 'task.updated' || rawEvent === 'task.deleted') {
    return rawEvent;
  }
  return null;
}

function extractTask(payload: VikunjaWebhookPayload): VikunjaTask | null {
  const task = payload.data?.task;
  if (task?.id != null) {
    return task;
  }

  if (payload.data?.task_id != null) {
    return { id: payload.data.task_id };
  }

  return null;
}
