import { describe, expect, it } from 'vitest';
import { computeMetrics } from './metrics';
import { parseQr } from './qr';
import { createVisit, type Visit } from './visits';

const TZ = 'America/Santiago';

function v(code: string | null, at: string, name: string | null): Visit {
  return createVisit({
    parsed: code ? parseQr(code) : null,
    attendeeName: name,
    notes: null,
    scannedAt: new Date(at),
    standId: 's',
    timeZone: TZ,
    storePayload: false,
    syncMode: false,
  });
}

describe('computeMetrics', () => {
  // Chile en octubre 2026: UTC-3.
  const visits = [
    v('AAA111', '2026-10-21T13:05:00Z', 'Ana'), // 10:05
    v('AAA111', '2026-10-21T13:40:00Z', 'Ana'), // repetida
    v('AAA111', '2026-10-21T17:00:00Z', 'Ana'), // repetida
    v('BBB222', '2026-10-21T13:10:00Z', null), // sin nombre
    v('CCC333', '2026-10-22T14:00:00Z', 'ana'), // otro código, mismo nombre normalizado
    v(null, '2026-10-22T14:30:00Z', 'Pedro'), // sin identificador
  ];
  const m = computeMetrics(visits, TZ);

  it('cuenta visitas, códigos únicos y repetidas sin inflar visitantes únicos', () => {
    expect(m.totalVisits).toBe(6);
    expect(m.uniqueCodes).toBe(3);
    expect(m.repeatVisits).toBe(2);
    expect(m.withoutIdentifier).toBe(1);
    // Invariante: cada visita es nueva, repetida o sin identificador.
    expect(m.uniqueCodes + m.repeatVisits + m.withoutIdentifier).toBe(m.totalVisits);
  });

  it('distingue visitas con nombre, pendientes y nombres distintos', () => {
    expect(m.identifiedVisits).toBe(5);
    expect(m.pendingName).toBe(1);
    expect(m.distinctNames).toBe(2); // "Ana" y "ana" se normalizan; Pedro
  });

  it('agrupa por hora local y por día', () => {
    expect(m.byHour[10]).toBe(3);
    expect(m.byHour[14]).toBe(1);
    expect(m.byHour[11]).toBe(2);
    expect(m.byHour.reduce((a, b) => a + b, 0)).toBe(6);
    expect(m.byDay).toEqual([
      { date: '2026-10-21', count: 4 },
      { date: '2026-10-22', count: 2 },
    ]);
  });

  it('última visita y evolución acumulada', () => {
    expect(m.lastVisit?.attendee_name).toBe('Pedro');
    expect(m.timeline.at(-1)?.cumulative).toBe(6);
    expect(m.timeline[0]).toMatchObject({ date: '2026-10-21', hour: 10, count: 3, cumulative: 3 });
  });

  it('sin registros', () => {
    const empty = computeMetrics([], TZ);
    expect(empty.totalVisits).toBe(0);
    expect(empty.lastVisit).toBeNull();
    expect(empty.timeline).toEqual([]);
  });
});
