import { describe, expect, it } from 'vitest';
import { buildTaskHashPayload, computeTaskHash } from '../src/utils/hash';

describe('task hash', () => {
  it('produces deterministic hash for relevant task fields', () => {
    const payloadA = buildTaskHashPayload({
      id: 1,
      title: 'Test task',
      start_date: '2026-03-01T10:00:00Z',
      due_date: null,
      end_date: '2026-03-01T10:30:00Z',
      done: false,
      description: 'Ignored by hash',
    });

    const payloadB = buildTaskHashPayload({
      id: 1,
      title: 'Test task',
      start_date: '2026-03-01T10:00:00Z',
      due_date: null,
      end_date: '2026-03-01T10:30:00Z',
      done: false,
      description: 'Different description should not affect hash',
    });

    expect(computeTaskHash(payloadA)).toEqual(computeTaskHash(payloadB));
  });

  it('changes hash when done status changes', () => {
    const payloadA = buildTaskHashPayload({
      id: 2,
      title: 'Task',
      due_date: '2026-03-01',
      done: false,
    });

    const payloadB = buildTaskHashPayload({
      id: 2,
      title: 'Task',
      due_date: '2026-03-01',
      done: true,
    });

    expect(computeTaskHash(payloadA)).not.toEqual(computeTaskHash(payloadB));
  });
});
