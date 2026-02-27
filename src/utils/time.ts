export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function isZeroLikeDate(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith('0001-01-01') || normalized.startsWith('0000-00-00');
}

export function toIcsUtcDateTime(value: Date): string {
  const year = value.getUTCFullYear();
  const month = pad(value.getUTCMonth() + 1);
  const day = pad(value.getUTCDate());
  const hour = pad(value.getUTCHours());
  const minute = pad(value.getUTCMinutes());
  const second = pad(value.getUTCSeconds());
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

export function toIcsDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = pad(value.getUTCMonth() + 1);
  const day = pad(value.getUTCDate());
  return `${year}${month}${day}`;
}

export function parseIsoDateOrNull(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (isZeroLikeDate(value)) {
    return null;
  }

  if (isDateOnly(value)) {
    const [year, month, day] = value.split('-').map((part) => Number(part));
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
