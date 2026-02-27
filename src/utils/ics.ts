import {
  addDays,
  addMinutes,
  isDateOnly,
  parseIsoDateOrNull,
  toIcsDate,
  toIcsUtcDateTime,
} from './time';
import type { VikunjaTask } from '../types/vikunja';

export interface BuildEventInput {
  uid: string;
  now: Date;
  defaultDurationMinutes: number;
  vikunjaBaseUrl: string;
  task: VikunjaTask;
  cancel: boolean;
}

interface EventDateResolution {
  allDay: boolean;
  dtStart: string;
  dtEnd: string;
}

export function buildTaskUid(taskId: string, uidDomain: string): string {
  return `vikunja-task-${taskId}@${uidDomain}`;
}

export function buildVEventIcs(input: BuildEventInput): string {
  const summary = escapeText((input.task.title ?? '').trim() || `Task ${input.task.id}`);
  const description = escapeText(buildDescription(input.task, input.vikunjaBaseUrl));
  const dtStamp = toIcsUtcDateTime(input.now);
  const dates = resolveEventDates(input.task, input.defaultDurationMinutes);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//vikunja-webhook-caldav-sync//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${dtStamp}`,
    `SUMMARY:${summary}`,
    dates.allDay ? `DTSTART;VALUE=DATE:${dates.dtStart}` : `DTSTART:${dates.dtStart}`,
    dates.allDay ? `DTEND;VALUE=DATE:${dates.dtEnd}` : `DTEND:${dates.dtEnd}`,
    `DESCRIPTION:${description}`,
  ];

  if (input.cancel) {
    lines.push('STATUS:CANCELLED');
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function hasCalendaringSignal(task: VikunjaTask): boolean {
  return parseIsoDateOrNull(task.start_date) !== null || parseIsoDateOrNull(task.due_date) !== null;
}

function resolveEventDates(task: VikunjaTask, defaultDurationMinutes: number): EventDateResolution {
  const startRaw =
    parseIsoDateOrNull(task.start_date) !== null
      ? task.start_date
      : parseIsoDateOrNull(task.due_date) !== null
        ? task.due_date
        : null;
  if (!startRaw) {
    throw new Error('Task has no calendaring signal');
  }

  const startIsDateOnly = isDateOnly(startRaw);
  const startDate = parseIsoDateOrNull(startRaw);
  if (!startDate) {
    throw new Error(`Invalid start date: ${startRaw}`);
  }

  if (startIsDateOnly) {
    const endRaw = task.end_date;
    let endDate: Date;

    if (endRaw && isDateOnly(endRaw)) {
      const parsedEnd = parseIsoDateOrNull(endRaw);
      if (!parsedEnd) {
        throw new Error(`Invalid end date: ${endRaw}`);
      }

      endDate = parsedEnd.getTime() <= startDate.getTime() ? addDays(startDate, 1) : parsedEnd;
    } else {
      endDate = addDays(startDate, 1);
    }

    return {
      allDay: true,
      dtStart: toIcsDate(startDate),
      dtEnd: toIcsDate(endDate),
    };
  }

  const endDate = task.end_date ? parseIsoDateOrNull(task.end_date) : null;
  const resolvedEnd =
    endDate && endDate.getTime() > startDate.getTime()
      ? endDate
      : addMinutes(startDate, defaultDurationMinutes);

  return {
    allDay: false,
    dtStart: toIcsUtcDateTime(startDate),
    dtEnd: toIcsUtcDateTime(resolvedEnd),
  };
}

function buildDescription(task: VikunjaTask, vikunjaBaseUrl: string): string {
  const lines: string[] = [];
  const normalizedDescription = task.description?.trim();
  if (normalizedDescription) {
    lines.push(normalizedDescription);
    lines.push('');
  }

  const base = vikunjaBaseUrl.endsWith('/') ? vikunjaBaseUrl.slice(0, -1) : vikunjaBaseUrl;
  lines.push(`Vikunja task: ${base}/tasks/${task.id}`);

  if (task.project_id != null) {
    lines.push(`Project ID: ${task.project_id}`);
  } else if (task.project?.id != null) {
    lines.push(`Project ID: ${task.project.id}`);
  }

  if (typeof task.priority === 'number') {
    lines.push(`Priority: ${task.priority}`);
  }

  const labels = (task.labels ?? [])
    .map((label) => label.title ?? label.name)
    .filter((label): label is string => Boolean(label));

  if (labels.length > 0) {
    lines.push(`Labels: ${labels.join(', ')}`);
  }

  return lines.join('\n');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < line.length) {
    const end = Math.min(start + 75, line.length);
    const chunk = line.slice(start, end);
    chunks.push(start === 0 ? chunk : ` ${chunk}`);
    start = end;
  }

  return chunks.join('\r\n');
}
