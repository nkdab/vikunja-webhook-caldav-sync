export type VikunjaEventName = 'task.created' | 'task.updated' | 'task.deleted';

export interface VikunjaLabel {
  id?: number | string;
  title?: string;
  name?: string;
}

export interface VikunjaProject {
  id?: number | string;
  title?: string;
  name?: string;
}

export interface VikunjaTask {
  id: number | string;
  title?: string;
  description?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  done?: boolean;
  priority?: number | null;
  project_id?: number | string | null;
  project?: VikunjaProject | null;
  labels?: VikunjaLabel[] | null;
}

export interface VikunjaWebhookPayload {
  event_name?: string;
  eventName?: string;
  event?: string;
  data?: {
    task?: VikunjaTask;
    task_id?: number | string;
  };
}
