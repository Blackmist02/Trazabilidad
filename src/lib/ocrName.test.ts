import { describe, expect, it } from 'vitest';
import {
  analyzeBadge,
  belowQrCrop,
  cleanAffiliation,
  fixOcrCase,
  formatName,
  groupRows,
  lineRows,
  mergeBlockReading,
  nameWords,
  readBelowQr,
  type OcrLine,
  type Point,
  type QrCrop,
} from './ocrName';

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

// Credencial real (Edifica 2026): el QR va justo encima del nombre y la «g» del nombre baja
// hasta la línea de la institución. Líneas devueltas por tesseract.js al leer la franja bajo el QR.
const REAL_BELOW_QR = [
  line('Ignacio Mella', 95, 17, 93, 230, 640),
  line('Institúto Profesional Duoc UC', 90, 74, 33, 185, 680),
  line('Estudiante', 96, 125, 27, 360, 520),
  line('PRESENTA AUSPICIA SOCIO ESTRATÉGICO', 93, 268, 14, 120, 860),
];

describe('readBelowQr (franja bajo el QR)', () => {
  it('lee nombre, institución y cargo aunque el nombre se solape con la línea siguiente', () => {
    const r = readBelowQr(REAL_BELOW_QR, ['Edifica 2026'], 150);
    expect(r.names.map((n) => n.name)).toEqual(['Ignacio Mella']);
    expect(r.institution).toBe('Institúto Profesional Duoc UC');
    expect(r.role).toBe('Estudiante');
  });

  it('tolera una fila de ruido del borde del QR antes del nombre', () => {
    const r = readBelowQr([line('Ll ji', 60, 0, 12), ...REAL_BELOW_QR], [], 150);
    expect(r.names[0].name).toBe('Ignacio Mella');
  });

  it('no toma una fila lejana del QR (auspiciadores) como nombre', () => {
    const r = readBelowQr([line('Mutual Seguridad', 95, 200, 30)], [], 150);
    expect(r.names).toEqual([]);
    expect(readBelowQr([line('www.evento.cl', 95, 10, 20)], [], 150).names).toEqual([]);
  });

  it('lineRows no une líneas que se solapan en vertical', () => {
    expect(lineRows(REAL_BELOW_QR).map((r) => r.text)).toEqual(REAL_BELOW_QR.map((l) => l.text));
    expect(groupRows(REAL_BELOW_QR)[0].text).toContain('Institúto'); // groupRows sí las uniría
  });
});

describe('belowQrCrop (geometría)', () => {
  // Inversa de la matriz: punto del recorte → punto del fotograma.
  function toFrame(crop: QrCrop, [x, y]: Point): Point {
    const [a, b, c, d, e, f] = crop.matrix;
    const det = a * d - b * c;
    const X = x - e, Y = y - f;
    return [(d * X - c * Y) / det, (-b * X + a * Y) / det];
  }
  const close = (p: Point, q: Point) => {
    expect(p[0]).toBeCloseTo(q[0], 6);
    expect(p[1]).toBeCloseTo(q[1], 6);
  };

  it('QR derecho: el recorte empieza justo bajo el código, centrado', () => {
    // Centros de los patrones a 100 px: lado del QR ≈ 140 px, centro en (150, 150).
    const crop = belowQrCrop({ topLeft: [100, 100], topRight: [200, 100], bottomLeft: [100, 200] })!;
    expect(crop).toMatchObject({ width: 900, height: 308 });
    close(toFrame(crop, [450, 0]), [150, 150 + 0.45 * 140]); // centro superior
    close(toFrame(crop, [0, 0]), [150 - 3 * 140, 150 + 0.45 * 140]);
  });

  it('QR girado 90°: «abajo» sigue el eje del código', () => {
    // El borde superior del QR apunta hacia abajo en la imagen: el texto queda a la izquierda.
    const crop = belowQrCrop({ topLeft: [200, 100], topRight: [200, 200], bottomLeft: [100, 100] })!;
    close(toFrame(crop, [450, 0]), [150 - 0.45 * 140, 150]);
  });

  it('descarta posiciones degeneradas', () => {
    expect(belowQrCrop({ topLeft: [0, 0], topRight: [3, 0], bottomLeft: [0, 3] })).toBeNull();
    expect(belowQrCrop({ topLeft: [0, 0], topRight: [100, 0], bottomLeft: [0, 300] })).toBeNull();
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
