import { describe, expect, it } from 'vitest';
import { analyzeBadge, cleanAffiliation, fixOcrCase, formatName, groupRows, mergeBlockReading, nameWords, type OcrLine } from './ocrName';

// Líneas reales devueltas por tesseract.js (spa) al leer credenciales de prueba con el formato
// 1.ª línea nombre y apellido · 2.ª institución · 3.ª cargo.
function line(text: string, confidence: number, top: number, height: number, left = 100, right = 500): OcrLine {
  return { text, confidence, top, bottom: top + height, left, right };
}

describe('analyzeBadge (primera pasada, texto disperso)', () => {
  it('nombre, institución y cargo con cabecera del evento', () => {
    const r = analyzeBadge([
      line('EXPO TECNOLOGÍA 2026', 96, 40, 36),
      line('Camila Herrera', 96, 140, 35),
      line('Universidad de Santiago', 96, 190, 29),
      line('Directora de Vinculación', 96, 232, 27),
      line('".', 30, 300, 8),
    ]);
    expect(r.names[0].name).toBe('Camila Herrera');
    expect(r.institution).toBe('Universidad de Santiago');
    expect(r.role).toBe('Directora de Vinculación');
    expect(r.block).toMatchObject({ top: 140, bottom: 259 });
  });

  it('con las tres líneas del mismo tamaño no confunde la institución con el apellido', () => {
    const r = analyzeBadge([
      line('JUAN PÉREZ SOTO', 96, 180, 30),
      line('CODELCO', 96, 225, 24),
      line('JEFE DE PROYECTOS', 96, 262, 31),
      line('[a]!', 37, 330, 41),
      line('Cb', 38, 380, 43),
    ]);
    expect(r.names.map((n) => n.name)).toEqual(['Juan Pérez Soto']);
    expect(r.institution).toBe('CODELCO');
    expect(r.role).toBe('JEFE DE PROYECTOS');
  });

  it('una cabecera con aspecto de nombre pierde frente a la línea con institución y cargo debajo', () => {
    const r = analyzeBadge([
      line('FERIA INNOVA', 96, 30, 16),
      line('Ana de la Fuente', 96, 120, 20),
      line('Clínica Alemana', 96, 150, 14),
      line('Enfermera Jefa', 90, 175, 13),
    ]);
    expect(r.names[0].name).toBe('Ana de la Fuente');
  });

  it('ubica el bloque aunque el OCR corte la última palabra del nombre', () => {
    const r = analyzeBadge([
      line('CUMBRE MINERA', 96, 30, 24),
      line('Francisco Javier M', 91, 120, 23),
      line('Ministerio de Energía', 96, 152, 30),
      line('Analista', 96, 190, 16),
    ]);
    expect(r.names[0].name).toBe('Francisco Javier');
    expect(r.block).not.toBeNull();
    expect(r.institution).toBe('Ministerio de Energía');
  });

  it('sin texto útil no propone nada', () => {
    const r = analyzeBadge([line('www.evento.cl', 95, 10, 20), line('Stand 14', 95, 40, 20), line('Pedro Rojas', 30, 80, 40)]);
    expect(r.names).toEqual([]);
    expect(r.block).toBeNull();
  });
});

describe('mergeBlockReading (segunda pasada, bloque ampliado)', () => {
  const first = analyzeBadge([
    line('CUMBRE MINERA', 96, 30, 24),
    line('Francisco Javier M', 91, 120, 23),
    line('Ministerio de Energía', 96, 152, 30),
    line('Analista', 96, 190, 16),
  ]);

  it('recupera el nombre completo y descarta la versión cortada', () => {
    const r = mergeBlockReading(first, [
      line('Francisco Javier Muñoz', 95, 20, 50),
      line('Ministerio de Energía', 96, 90, 60),
      line('Analista', 96, 170, 34),
    ]);
    expect(r.names.map((n) => n.name)).toEqual(['Francisco Javier Muñoz']);
    expect(r.institution).toBe('Ministerio de Energía');
    expect(r.role).toBe('Analista');
  });

  it('corrige minúsculas sueltas del OCR en nombres en mayúsculas ("PÉREZ soTO")', () => {
    const base = analyzeBadge([line('JUAN PÉREZ SOTO', 96, 180, 30), line('CODELCO', 96, 225, 24), line('JEFE DE PROYECTOS', 96, 262, 31)]);
    const r = mergeBlockReading(base, [
      line('JUAN PÉREZ soTO', 78, 20, 60),
      line('CODELCO', 96, 100, 48),
      line('JEFE DE PROYECTOS', 96, 170, 60),
    ]);
    expect(r.names[0].name).toBe('Juan Pérez Soto');
    expect(r.institution).toBe('CODELCO');
  });

  it('mejora el cargo mal leído en la primera pasada', () => {
    const base = analyzeBadge([
      line('Ana de la Fuente', 96, 120, 20),
      line('Clínica Alemana', 96, 150, 14),
      line('Enfe mera fa', 60, 175, 13),
    ]);
    const r = mergeBlockReading(base, [line('Ana de la Fuente', 96, 10, 56), line('Clínica Alemana', 96, 80, 40), line('Enfermera Jefa', 96, 130, 38)]);
    expect(r.role).toBe('Enfermera Jefa');
  });

  it('prefiere la versión bien capitalizada si solo difieren en mayúsculas', () => {
    const base = analyzeBadge([line('Ana de la Fuente', 90, 160, 35), line('Universidad de Chile', 88, 205, 23), line('Académica', 80, 240, 20)]);
    const r = mergeBlockReading(base, [line('Ana de la fuente', 94, 10, 50), line('Universidad de Chile', 80, 70, 40)]);
    expect(r.names[0].name).toBe('Ana de la Fuente');
  });

  it('ignora ruido sobre el bloque y conserva la primera lectura si la relectura no sirve', () => {
    const base = analyzeBadge([line('Camila Herrera', 96, 140, 35), line('USACH', 96, 190, 29), line('Académica', 96, 232, 27)]);
    expect(mergeBlockReading(base, [line('> “ai', 42, 0, 20), line('Camila Herrera', 96, 30, 50)]).names[0].name).toBe('Camila Herrera');
    expect(mergeBlockReading(base, [line('#### 123', 90, 0, 40)])).toBe(base);
  });
});

describe('utilidades', () => {
  it('groupRows une fragmentos de una misma fila', () => {
    const rows = groupRows([line('Juan', 95, 100, 30, 100, 180), line('Pérez', 94, 102, 30, 260, 360), line('Codelco', 96, 150, 24)]);
    expect(rows.map((r) => r.text)).toEqual(['Juan Pérez', 'Codelco']);
  });

  it('nameWords rechaza ruido típico y acepta nombres compuestos', () => {
    const stop = new Set<string>();
    expect(nameWords('LLLL', stop)).toBeNull();
    expect(nameWords('pÉrEz', stop)).toBeNull();
    expect(nameWords('de la', stop)).toBeNull();
    expect(nameWords('José Pérez-Cotapos', stop)).toEqual(['José', 'Pérez-Cotapos']);
    expect(nameWords("Liam O'Connor", stop)).toEqual(['Liam', "O'Connor"]);
  });

  it('fixOcrCase solo actúa en textos casi todo en mayúsculas', () => {
    expect(fixOcrCase('JUAN PÉREZ soTO')).toBe('JUAN PÉREZ SOTO');
    expect(fixOcrCase('María José')).toBe('María José');
  });

  it('formatName aplica capitalización española', () => {
    expect(formatName(['MARÍA', 'JOSÉ', 'DE', 'LA', 'FUENTE'])).toBe('María José de la Fuente');
    expect(formatName(['JOSÉ', 'PÉREZ-COTAPOS'])).toBe('José Pérez-Cotapos');
    expect(formatName(['Ana', 'McDonald'])).toBe('Ana McDonald');
  });

  it('cleanAffiliation limpia la línea y descarta ruido', () => {
    expect(cleanAffiliation('  Universidad   de Chile | ')).toBe('Universidad de Chile');
    expect(cleanAffiliation('> “ai')).toBeNull();
    expect(cleanAffiliation('S.A.')).toBe('S.A.');
    expect(cleanAffiliation('')).toBeNull();
  });
});
