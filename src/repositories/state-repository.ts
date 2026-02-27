import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export interface TaskSyncState {
  taskId: string;
  hash: string;
  href: string | null;
  etag: string | null;
  updatedAt: number;
}

interface RawState {
  task_id: string;
  hash: string;
  href: string | null;
  etag: string | null;
  updated_at: number;
}

export class TaskSyncStateRepository {
  private readonly db: Database.Database;

  constructor(sqlitePath: string) {
    mkdirSync(dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.createSchema();
  }

  get(taskId: string): TaskSyncState | null {
    const row = this.db
      .prepare(
        'SELECT task_id, hash, href, etag, updated_at FROM task_sync_state WHERE task_id = ?',
      )
      .get(taskId) as RawState | undefined;

    if (!row) {
      return null;
    }

    return {
      taskId: row.task_id,
      hash: row.hash,
      href: row.href,
      etag: row.etag,
      updatedAt: row.updated_at,
    };
  }

  upsert(state: TaskSyncState): void {
    this.db
      .prepare(
        `
        INSERT INTO task_sync_state (task_id, hash, href, etag, updated_at)
        VALUES (@taskId, @hash, @href, @etag, @updatedAt)
        ON CONFLICT(task_id)
        DO UPDATE SET
          hash = excluded.hash,
          href = excluded.href,
          etag = excluded.etag,
          updated_at = excluded.updated_at
      `,
      )
      .run(state);
  }

  ping(): boolean {
    const row = this.db.prepare('SELECT 1 AS ok').get() as { ok: number };
    return row.ok === 1;
  }

  close(): void {
    this.db.close();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_sync_state (
        task_id TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        href TEXT,
        etag TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
  }
}
