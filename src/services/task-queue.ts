import type { FastifyBaseLogger } from 'fastify';
import type { WebhookWorkItem } from './sync-service';
import { SyncService } from './sync-service';

export class TaskQueue {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly latestByTask = new Map<string, WebhookWorkItem>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly syncService: SyncService,
    private readonly logger: FastifyBaseLogger,
    private readonly debounceMs: number,
  ) {}

  enqueue(item: WebhookWorkItem): void {
    const taskId = String(item.task.id);
    if (item.eventName === 'task.deleted' || this.debounceMs === 0) {
      this.schedule(taskId, item);
      return;
    }

    this.latestByTask.set(taskId, item);
    const existingTimer = this.debounceTimers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(taskId);
      const latest = this.latestByTask.get(taskId);
      if (!latest) {
        return;
      }
      this.latestByTask.delete(taskId);
      this.schedule(taskId, latest);
    }, this.debounceMs);

    this.debounceTimers.set(taskId, timer);
  }

  private schedule(taskId: string, item: WebhookWorkItem): void {
    const prev = this.chains.get(taskId) ?? Promise.resolve();

    const next = prev
      .catch((error) => {
        this.logger.error(
          {
            err: error instanceof Error ? error.message : String(error),
            task_id: taskId,
            request_id: item.requestId,
          },
          'Previous queued task failed',
        );
      })
      .then(async () => {
        try {
          await this.syncService.process(item);
        } catch (error) {
          this.logger.error(
            {
              err: error instanceof Error ? error.message : String(error),
              task_id: taskId,
              event_name: item.eventName,
              request_id: item.requestId,
            },
            'Failed to process webhook event',
          );
        }
      })
      .finally(() => {
        const current = this.chains.get(taskId);
        if (current === next) {
          this.chains.delete(taskId);
        }
      });

    this.chains.set(taskId, next);
  }
}
