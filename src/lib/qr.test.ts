import { describe, expect, it } from 'vitest';
import { cleanName, parseQr } from './qr';

describe('parseQr', () => {
  it('lee un identificador alfanumérico real sin inventar un nombre', () => {
    const r = parseQr('BDFFE48F81E448617430250Enp');
    expect(r.kind).toBe('identifier');
    expect(r.identifier).toBe('BDFFE48F81E448617430250Enp'); // conserva mayúsculas/minúsculas
    expect(r.suggestedName).toBeNull();
    expect(r.nameSource).toBeNull();
  });

  it('recorta espacios y saltos de línea de los extremos', () => {
    expect(parseQr('  BDFFE48F81E448617430250Enp\n').identifier).toBe('BDFFE48F81E448617430250Enp');
  });

  it('interpreta una URL sin visitarla y usa la URL normalizada como identificador', () => {
    const r = parseQr('HTTPS://Acreditacion.Example.com/badge/ABC123?x=1#frag');
    expect(r.kind).toBe('url');
    expect(r.urlHost).toBe('acreditacion.example.com');
    expect(r.identifier).toBe('https://acreditacion.example.com/badge/ABC123?x=1');
    expect(r.suggestedName).toBeNull();
  });

  it('propone el nombre solo si la URL lo trae explícitamente', () => {
    const r = parseQr('https://ex.com/b?id=77&nombre=Mar%C3%ADa%20Pérez');
    expect(r.suggestedName).toBe('María Pérez');
    expect(r.nameSource).toBe('url-param');
  });

  it('no toma como nombre un parámetro que parece un código', () => {
    expect(parseQr('https://ex.com/b?name=AB12CD34').suggestedName).toBeNull();
  });

  it('extrae el nombre de una vCard (FN) y su UID', () => {
    const r = parseQr('BEGIN:VCARD\nVERSION:3.0\nN:Pérez;Ana;;;\nFN:Ana Pérez\nUID:att-991\nEND:VCARD');
    expect(r.kind).toBe('vcard');
    expect(r.suggestedName).toBe('Ana Pérez');
    expect(r.identifier).toBe('att-991');
  });

  it('una vCard sin UID no tiene identificador fiable', () => {
    const r = parseQr('BEGIN:VCARD\nFN:Ana Pérez\nEND:VCARD');
    expect(r.identifier).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('lee MECARD con formato Apellido,Nombre', () => {
    const r = parseQr('MECARD:N:Soto,Luis;TEL:123;;');
    expect(r.kind).toBe('mecard');
    expect(r.suggestedName).toBe('Luis Soto');
  });

  it('lee JSON con nombre e identificador', () => {
    const r = parseQr('{"id":"A-1","nombre":"Pía Rojas"}');
    expect(r.kind).toBe('json');
    expect(r.identifier).toBe('A-1');
    expect(r.suggestedName).toBe('Pía Rojas');
  });

  it('texto libre multilínea no tiene identificador fiable', () => {
    const r = parseQr('Hola\nmundo');
    expect(r.kind).toBe('text');
    expect(r.identifier).toBeNull();
  });

  it('texto corto de una línea se usa como identificador', () => {
    const r = parseQr('Entrada general 15');
    expect(r.kind).toBe('text');
    expect(r.identifier).toBe('Entrada general 15');
    expect(r.suggestedName).toBeNull();
  });

  it('código vacío', () => {
    const r = parseQr('   ');
    expect(r.identifier).toBeNull();
    expect(r.warnings).toContain('El código está vacío.');
  });

  it('elimina caracteres de control', () => {
    expect(parseQr('ABC\u0000123').identifier).toBe('ABC123');
  });

  it('trunca contenidos excesivamente largos', () => {
    const r = parseQr('A'.repeat(5000));
    expect(r.raw.length).toBe(2048);
  });
});

describe('cleanName', () => {
  it('normaliza espacios y descarta vacíos', () => {
    expect(cleanName('  Ana   María  ')).toBe('Ana María');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(null)).toBeNull();
  });
});
