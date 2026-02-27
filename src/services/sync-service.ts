import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/env';
import { TaskSyncStateRepository } from '../repositories/state-repository';
import type { VikunjaEventName, VikunjaTask } from '../types/vikunja';
import { buildTaskHashPayload, computeTaskHash } from '../utils/hash';
import { buildTaskUid, buildVEventIcs, hasCalendaringSignal } from '../utils/ics';
import { CaldavClient } from './caldav-client';

export interface WebhookWorkItem {
  eventName: VikunjaEventName;
  task: VikunjaTask;
  requestId: string;
  receivedAt: number;
}

export class SyncService {
  constructor(
    private readonly config: AppConfig,
    private readonly stateRepo: TaskSyncStateRepository,
    private readonly caldavClient: CaldavClient,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async process(item: WebhookWorkItem): Promise<void> {
    const startedAt = Date.now();
    const taskId = String(item.task.id);
    const uid = buildTaskUid(taskId, this.config.UID_DOMAIN);

    const state = this.stateRepo.get(taskId);
    const hashPayload = buildTaskHashPayload(item.task);
    const nextHash = computeTaskHash(hashPayload);

    if (state?.hash === nextHash) {
      const debounced =
        this.config.DEBOUNCE_MS > 0 && Date.now() - state.updatedAt < this.config.DEBOUNCE_MS;
      this.logger.info(
        {
          request_id: item.requestId,
          event_name: item.eventName,
          task_id: taskId,
          action: 'skip',
          reason: debounced ? 'debounced' : 'hash_unchanged',
          duration_ms: Date.now() - startedAt,
        },
        'Task already in sync state',
      );
      return;
    }

    if (item.eventName === 'task.deleted') {
      await this.caldavClient.deleteEvent(uid, state?.href);
      this.persistState(taskId, nextHash, null, null);
      this.logger.info(
        {
          request_id: item.requestId,
          event_name: item.eventName,
          task_id: taskId,
          action: 'delete',
          duration_ms: Date.now() - startedAt,
        },
        'Deleted calendar event due to task deletion',
      );
      return;
    }

    if (!hasCalendaringSignal(item.task)) {
      await this.caldavClient.deleteEvent(uid, state?.href);
      this.persistState(taskId, nextHash, null, null);
      this.logger.info(
        {
          request_id: item.requestId,
          event_name: item.eventName,
          task_id: taskId,
          action: 'delete',
          reason: 'missing_dates',
          duration_ms: Date.now() - startedAt,
        },
        'Deleted calendar event due to missing date signal',
      );
      return;
    }

    if (item.task.done && this.config.DONE_BEHAVIOR === 'delete') {
      await this.caldavClient.deleteEvent(uid, state?.href);
      this.persistState(taskId, nextHash, null, null);
      this.logger.info(
        {
          request_id: item.requestId,
          event_name: item.eventName,
          task_id: taskId,
          action: 'delete',
          reason: 'done_behavior_delete',
          duration_ms: Date.now() - startedAt,
        },
        'Deleted calendar event due to done behavior',
      );
      return;
    }

    const ics = buildVEventIcs({
      uid,
      now: new Date(),
      defaultDurationMinutes: this.config.DEFAULT_DURATION_MINUTES,
      vikunjaBaseUrl: this.config.VIKUNJA_BASE_URL,
      task: item.task,
      cancel: Boolean(item.task.done) && this.config.DONE_BEHAVIOR === 'cancel',
    });

    const upsertResult = await this.caldavClient.upsertEvent({
      uid,
      iCal: ics,
      href: state?.href,
      etag: state?.etag,
    });

    this.persistState(taskId, nextHash, upsertResult.href, upsertResult.etag);

    this.logger.info(
      {
        request_id: item.requestId,
        event_name: item.eventName,
        task_id: taskId,
        action: 'upsert',
        href: upsertResult.href,
        duration_ms: Date.now() - startedAt,
      },
      'Upserted calendar event',
    );
  }

  async health(): Promise<{ ok: boolean; reason?: string }> {
    const dbOk = this.stateRepo.ping();
    if (!dbOk) {
      return { ok: false, reason: 'db_unavailable' };
    }

    try {
      await this.caldavClient.discoverCalendar();
    } catch (error) {
      return {
        ok: false,
        reason: `calendar_discovery_failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return { ok: true };
  }

  async ready(): Promise<{ ok: boolean; reason?: string }> {
    const dbOk = this.stateRepo.ping();
    if (!dbOk) {
      return { ok: false, reason: 'db_unavailable' };
    }

    if (!this.caldavClient.isAuthHealthy()) {
      return { ok: false, reason: 'caldav_auth_unhealthy' };
    }

    try {
      await this.caldavClient.pingCalendar();
    } catch (error) {
      return {
        ok: false,
        reason: `calendar_ping_failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return { ok: true };
  }

  private persistState(
    taskId: string,
    hash: string,
    href: string | null,
    etag: string | null,
  ): void {
    this.stateRepo.upsert({
      taskId,
      hash,
      href,
      etag,
      updatedAt: Date.now(),
    });
  }
}
