export const DEFAULT_TIMEZONE = 'America/Santiago';

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

export function localParts(date: Date | string, timeZone = DEFAULT_TIMEZONE): LocalParts {
  const d = typeof date === 'string' ? new Date(date) : date;
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(d)) out[p.type] = p.value;
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === '24' ? '00' : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Fecha local en formato ISO (YYYY-MM-DD) en la zona horaria indicada. */
export function localDateKey(date: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hora local HH:mm:ss. */
export function formatLocalTime(date: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  const p = localParts(date, timeZone);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** Hora local HH:mm. */
export function formatLocalTimeShort(date: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  const p = localParts(date, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** Fecha local DD-MM-YYYY (formato chileno). */
export function formatLocalDate(date: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  const p = localParts(date, timeZone);
  return `${p.day}-${p.month}-${p.year}`;
}

export function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-');
  return `${d}-${m}-${y}`;
}

export function formatLocalDateTime(date: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  return `${formatLocalDate(date, timeZone)} ${formatLocalTime(date, timeZone)}`;
}

export function localHour(date: Date | string, timeZone = DEFAULT_TIMEZONE): number {
  return Number(localParts(date, timeZone).hour);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
