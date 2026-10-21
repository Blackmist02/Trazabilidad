import { describe, expect, it } from 'vitest';
import { csvCell, csvFileName, protectFormula, visitsToCsv } from './csv';
import { parseQr } from './qr';
import { createVisit } from './visits';

const TZ = 'America/Santiago';

describe('exportación CSV', () => {
  const a = createVisit({
    parsed: parseQr('BDFFE48F81E448617430250Enp'),
    attendeeName: 'José "Pepe" Muñoz',
    notes: 'Interesado; pidió catálogo',
    scannedAt: new Date('2026-10-21T18:05:09Z'),
    standId: 'stand-1',
    timeZone: TZ,
    storePayload: true,
    syncMode: false,
  });
  const b = createVisit({
    parsed: parseQr('XYZ987654'),
    attendeeName: null,
    notes: '=HYPERLINK("http://malo")',
    scannedAt: new Date('2026-10-21T17:00:00Z'),
    standId: 'stand-1',
    timeZone: TZ,
    storePayload: true,
    syncMode: false,
  });

  it('incluye BOM UTF-8, encabezados y filas en orden cronológico', () => {
    const csv = visitsToCsv([a, b], TZ, ',');
    expect(csv.startsWith('﻿"Nombre","Institución","Cargo","Estado","Identificador QR"')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Pendiente de nombre"'); // b es anterior
    expect(lines[2]).toContain('"José ""Pepe"" Muñoz"');
    expect(lines[2]).toContain('"21-10-2026","15:05:09","America/Santiago","2026-10-21T18:05:09.000Z","stand-1"');
  });

  it('neutraliza fórmulas maliciosas', () => {
    const csv = visitsToCsv([b], TZ, ';');
    expect(csv).toContain(`"'=HYPERLINK(""http://malo"")"`);
    for (const p of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) expect(protectFormula(p).startsWith("'")).toBe(true);
    expect(protectFormula('Ana')).toBe('Ana');
  });

  it('usa el separador elegido', () => {
    const csv = visitsToCsv([a], TZ, ';');
    expect(csv.split('\r\n')[0]).toContain('"Nombre";"Institución";"Cargo";"Estado"');
  });

  it('escapa comillas y valores nulos', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it('genera un nombre de archivo seguro', () => {
    expect(csvFileName('Stand A/../1', '2026-10-21')).toBe('visitas-Stand-A-1-2026-10-21.csv');
  });
});
