import { localHour, localDateKey } from './time';
import type { Visit } from './visits';

export interface TimelinePoint {
  label: string;
  date: string;
  hour: number;
  count: number;
  cumulative: number;
}

export interface Metrics {
  totalVisits: number;
  /** Códigos distintos con identificador fiable: estimación de visitantes únicos. */
  uniqueCodes: number;
  /** Visitas cuyo código ya se había registrado antes (mismo identificador). */
  repeatVisits: number;
  /** Visitas sin identificador fiable: no se puede saber si son repetidas. */
  withoutIdentifier: number;
  /** Visitas con nombre confirmado. */
  identifiedVisits: number;
  /** Visitas pendientes de completar el nombre. */
  pendingName: number;
  /** Nombres distintos (normalizados). No equivale necesariamente a personas distintas. */
  distinctNames: number;
  /** 24 posiciones, hora local. */
  byHour: number[];
  byDay: { date: string; count: number }[];
  lastVisit: Visit | null;
  /** Visitas por hora local, con acumulado, para ver la evolución de la afluencia. */
  timeline: TimelinePoint[];
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeMetrics(visits: Visit[], timeZone: string): Metrics {
  const sorted = [...visits].sort((a, b) => a.visited_at.localeCompare(b.visited_at));
  const codes = new Set<string>();
  const names = new Set<string>();
  const byHour = new Array<number>(24).fill(0);
  const byDay = new Map<string, number>();
  const buckets = new Map<string, { date: string; hour: number; count: number }>();
  let repeatVisits = 0;
  let withoutIdentifier = 0;
  let identifiedVisits = 0;

  for (const v of sorted) {
    if (v.qr_identifier) {
      if (codes.has(v.qr_identifier)) repeatVisits++;
      else codes.add(v.qr_identifier);
    } else {
      withoutIdentifier++;
    }
    if (v.attendee_name) {
      identifiedVisits++;
      names.add(normalizeName(v.attendee_name));
    }
    const hour = localHour(v.visited_at, timeZone);
    const date = localDateKey(v.visited_at, timeZone);
    byHour[hour]++;
    byDay.set(date, (byDay.get(date) ?? 0) + 1);
    const key = `${date}T${String(hour).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.count++;
    else buckets.set(key, { date, hour, count: 1 });
  }

  let cumulative = 0;
  const timeline = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, b]) => {
      cumulative += b.count;
      const label = `${b.date.slice(8, 10)}/${b.date.slice(5, 7)} ${String(b.hour).padStart(2, '0')}h`;
      return { ...b, label, cumulative };
    });

  return {
    totalVisits: sorted.length,
    uniqueCodes: codes.size,
    repeatVisits,
    withoutIdentifier,
    identifiedVisits,
    pendingName: sorted.length - identifiedVisits,
    distinctNames: names.size,
    byHour,
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    lastVisit: sorted.length ? sorted[sorted.length - 1] : null,
    timeline,
  };
}
