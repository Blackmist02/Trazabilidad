import { describe, expect, it } from 'vitest';
import { parseQr } from './qr';
import { ScanGate } from './scanGate';
import { applyEdit, createVisit, findPreviousVisits, isIdentified, knownNameFor, type Visit } from './visits';

const TZ = 'America/Santiago';

function visit(code: string | null, at: string, name: string | null = null, syncMode = false): Visit {
  return createVisit({
    parsed: code ? parseQr(code) : null,
    attendeeName: name,
    notes: null,
    scannedAt: new Date(at),
    standId: 'stand-1',
    timeZone: TZ,
    storePayload: true,
    syncMode,
  });
}

describe('createVisit', () => {
  it('registra una visita con timestamp UTC y fecha local de Chile', () => {
    // 02:30 UTC del 22 de octubre = 23:30 del 21 de octubre en Chile (UTC-3).
    const v = visit('BDFFE48F81E448617430250Enp', '2026-10-22T02:30:00Z', 'Ana Pérez');
    expect(v.visited_at).toBe('2026-10-22T02:30:00.000Z');
    expect(v.event_date).toBe('2026-10-21');
    expect(v.attendee_name).toBe('Ana Pérez');
    expect(v.qr_identifier).toBe('BDFFE48F81E448617430250Enp');
    expect(v.qr_payload).toBeNull(); // no se duplica si coincide con el identificador
    expect(v.stand_id).toBe('stand-1');
    expect(v.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(v.sync_state).toBe('local');
  });

  it('conserva el contenido original de una URL', () => {
    const v = visit('https://ex.com/b/1#x', '2026-10-21T15:00:00Z');
    expect(v.qr_payload).toBe('https://ex.com/b/1#x');
    expect(v.qr_identifier).toBe('https://ex.com/b/1');
  });

  it('guarda el origen del nombre (OCR) y lo pasa a manual al corregirlo', () => {
    const v = createVisit({
      parsed: parseQr('BDFFE48F81E448617430250Enp'),
      attendeeName: 'María José González',
      nameSource: 'ocr',
      notes: null,
      scannedAt: new Date('2026-10-21T15:00:00Z'),
      standId: 'stand-1',
      timeZone: TZ,
      storePayload: true,
      syncMode: false,
    });
    expect(v.name_source).toBe('ocr');
    expect(applyEdit(v, { attendee_name: 'María José González Soto' }).name_source).toBe('manual');
    expect(visit('ABC12345', '2026-10-21T15:00:00Z', null).name_source).toBeNull();
    expect(visit('ABC12345', '2026-10-21T15:00:00Z', 'Ana').name_source).toBe('manual');
  });

  it('guarda institución y cargo, y audita su corrección', () => {
    const v = createVisit({
      parsed: parseQr('ABC12345'),
      attendeeName: 'Juan Pérez Soto',
      nameSource: 'ocr',
      institution: '  CODELCO ',
      role: 'Jefe de proyectos',
      notes: null,
      scannedAt: new Date('2026-10-21T15:00:00Z'),
      standId: 'stand-1',
      timeZone: TZ,
      storePayload: true,
      syncMode: false,
    });
    expect(v.attendee_institution).toBe('CODELCO');
    expect(v.attendee_role).toBe('Jefe de proyectos');
    const e = applyEdit(v, { attendee_institution: 'Codelco Chile', attendee_role: 'Jefe de proyectos' });
    expect(e.attendee_institution).toBe('Codelco Chile');
    expect(e.edits).toHaveLength(1);
    expect(e.edits[0]).toMatchObject({ field: 'attendee_institution', old_value: 'CODELCO', new_value: 'Codelco Chile' });
    expect(e.name_source).toBe('ocr'); // corregir la institución no cambia el origen del nombre
  });

  it('permite registrar sin nombre como pendiente', () => {
    const v = visit('ABC12345', '2026-10-21T15:00:00Z', '   ');
    expect(v.attendee_name).toBeNull();
    expect(isIdentified(v)).toBe(false);
  });

  it('acepta un identificador introducido manualmente', () => {
    const v = createVisit({
      parsed: parseQr('  bdffe48f81e448617430250enp '),
      attendeeName: 'Luis',
      notes: ' ',
      scannedAt: new Date('2026-10-21T15:00:00Z'),
      standId: 'stand-1',
      timeZone: TZ,
      storePayload: true,
      syncMode: false,
    });
    expect(v.qr_identifier).toBe('bdffe48f81e448617430250enp');
    expect(v.notes).toBeNull();
  });

  it('registro sin código', () => {
    const v = visit(null, '2026-10-21T15:00:00Z', 'Pedro');
    expect(v.qr_identifier).toBeNull();
    expect(v.qr_kind).toBe('manual');
  });

  it('en modo sincronizado queda pendiente de envío', () => {
    expect(visit('X1234', '2026-10-21T15:00:00Z', null, true).sync_state).toBe('pending');
  });
});

describe('applyEdit', () => {
  it('corrige el nombre conservando el valor anterior', () => {
    const v = visit('ABC12345', '2026-10-21T15:00:00Z', 'Ana Peres');
    const e = applyEdit(v, { attendee_name: 'Ana Pérez' }, new Date('2026-10-21T16:00:00Z'));
    expect(e.attendee_name).toBe('Ana Pérez');
    expect(e.edits).toEqual([
      { at: '2026-10-21T16:00:00.000Z', field: 'attendee_name', old_value: 'Ana Peres', new_value: 'Ana Pérez' },
    ]);
    expect(e.visited_at).toBe(v.visited_at); // la hora de la visita nunca cambia
  });

  it('sin cambios devuelve el mismo objeto', () => {
    const v = visit('ABC12345', '2026-10-21T15:00:00Z', 'Ana');
    expect(applyEdit(v, { attendee_name: ' Ana ' })).toBe(v);
  });

  it('en modo sincronizado marca el cambio como pendiente', () => {
    const v = { ...visit('ABC12345', '2026-10-21T15:00:00Z', null, true), sync_state: 'synced' as const };
    const e = applyEdit(v, { attendee_name: 'Ana' });
    expect(e.sync_state).toBe('pending');
    expect(e.dirty).toBe(true);
  });
});

describe('findPreviousVisits', () => {
  const list = [
    visit('CODE-A1', '2026-10-21T13:00:00Z', 'Ana'),
    visit('CODE-A1', '2026-10-21T15:00:00Z', null),
    visit('CODE-A1', '2026-10-20T15:00:00Z', 'Ana'),
    visit('CODE-B2', '2026-10-21T15:00:00Z', 'Beto'),
  ];

  it('detecta visitas anteriores del mismo código en el día', () => {
    const p = findPreviousVisits(list, 'CODE-A1', '2026-10-21');
    expect(p.sameDay).toHaveLength(2);
    expect(p.all).toHaveLength(3);
    expect(p.last?.visited_at).toBe('2026-10-21T15:00:00.000Z');
    expect(knownNameFor(p)).toBe('Ana');
  });

  it('sin identificador no afirma que haya visitas previas', () => {
    const p = findPreviousVisits(list, null, '2026-10-21');
    expect(p.all).toHaveLength(0);
  });
});

describe('ScanGate (lecturas repetidas de la cámara)', () => {
  it('procesa un código una sola vez aunque llegue en muchos fotogramas', () => {
    const gate = new ScanGate(4000);
    let t = 1000;
    const accepted = [];
    for (let i = 0; i < 30; i++) {
      if (gate.accept('BDFFE48F81E448617430250Enp', t)) accepted.push(t);
      t += 100;
    }
    expect(accepted).toHaveLength(1);
  });

  it('bloquea mientras la confirmación está abierta y respeta el enfriamiento tras liberar', () => {
    const gate = new ScanGate(4000);
    expect(gate.accept('A1', 0)).toBe(true);
    expect(gate.accept('B2', 100)).toBe(false); // ocupado
    gate.release(1000);
    expect(gate.accept('A1', 2000)).toBe(false); // mismo código, aún en enfriamiento
    expect(gate.accept('A1', 2000 + 4000)).toBe(true); // vuelve a pasar más tarde: se permite
  });

  it('el código sigue bloqueado mientras permanezca frente a la cámara', () => {
    const gate = new ScanGate(1000);
    gate.accept('A1', 0);
    gate.release(0);
    for (let t = 500; t <= 5000; t += 500) expect(gate.accept('A1', t)).toBe(false);
    expect(gate.accept('A1', 7000)).toBe(true);
  });

  it('un código distinto se acepta inmediatamente tras liberar', () => {
    const gate = new ScanGate(4000);
    gate.accept('A1', 0);
    gate.release(10);
    expect(gate.accept('B2', 20)).toBe(true);
  });
});
