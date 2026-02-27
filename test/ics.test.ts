import { describe, expect, it } from 'vitest';
import { buildVEventIcs, hasCalendaringSignal } from '../src/utils/ics';

describe('buildVEventIcs', () => {
  it('builds timed event with default duration when end date is absent', () => {
    const ics = buildVEventIcs({
      uid: 'vikunja-task-100@example.local',
      now: new Date('2026-02-27T12:00:00Z'),
      defaultDurationMinutes: 30,
      vikunjaBaseUrl: 'https://vikunja.example.com',
      cancel: false,
      task: {
        id: 100,
        title: 'Timed task',
        start_date: '2026-03-10T09:00:00Z',
      },
    });

    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:vikunja-task-100@example.local');
    expect(ics).toContain('DTSTART:20260310T090000Z');
    expect(ics).toContain('DTEND:20260310T093000Z');
  });

  it('builds all-day event from date-only due_date', () => {
    const ics = buildVEventIcs({
      uid: 'vikunja-task-101@example.local',
      now: new Date('2026-02-27T12:00:00Z'),
      defaultDurationMinutes: 30,
      vikunjaBaseUrl: 'https://vikunja.example.com',
      cancel: false,
      task: {
        id: 101,
        title: 'All day task',
        due_date: '2026-04-01',
      },
    });

    expect(ics).toContain('DTSTART;VALUE=DATE:20260401');
    expect(ics).toContain('DTEND;VALUE=DATE:20260402');
  });

  it('ignores zero-like end_date and falls back to default duration', () => {
    const ics = buildVEventIcs({
      uid: 'vikunja-task-102@example.local',
      now: new Date('2026-02-27T12:00:00Z'),
      defaultDurationMinutes: 30,
      vikunjaBaseUrl: 'https://vikunja.example.com',
      cancel: false,
      task: {
        id: 102,
        title: 'Timed task',
        start_date: '2026-03-10T09:00:00Z',
        end_date: '0001-01-01T00:00:00Z',
      },
    });

    expect(ics).toContain('DTSTART:20260310T090000Z');
    expect(ics).toContain('DTEND:20260310T093000Z');
  });

  it('treats zero-like calendaring dates as missing signal', () => {
    expect(
      hasCalendaringSignal({
        id: 103,
        due_date: '0001-01-01T00:00:00Z',
      }),
    ).toBe(false);
  });
});
