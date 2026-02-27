import { createHash } from 'node:crypto';
import type { VikunjaTask } from '../types/vikunja';

export interface TaskHashPayload {
  title: string;
  due_date: string | null;
  start_date: string | null;
  end_date: string | null;
  done: boolean;
}

export function buildTaskHashPayload(task: VikunjaTask): TaskHashPayload {
  return {
    title: (task.title ?? '').trim(),
    due_date: normalizeNullable(task.due_date),
    start_date: normalizeNullable(task.start_date),
    end_date: normalizeNullable(task.end_date),
    done: Boolean(task.done),
  };
}

export function computeTaskHash(payload: TaskHashPayload): string {
  const canonical = JSON.stringify(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
