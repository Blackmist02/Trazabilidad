import { describe, expect, it } from 'vitest';
import { extractNameCandidates, formatName, nameWords, type OcrLine } from './ocrName';

// Líneas devueltas por tesseract.js (spa, PSM 11) al leer credenciales de prueba.
function line(text: string, confidence: number, top: number, height: number, left = 100, right = 500): OcrLine {
  return { text, confidence, top, bottom: top + height, left, right };
}

describe('extractNameCandidates', () => {
  it('elige el nombre en la línea de letra más grande, descartando evento, empresa y tipo de pase', () => {
    const lines = [
      line('EXPO TECNOLOGÍA 2026', 96, 50, 32),
      line('MARÍA JOSÉ GONZÁLEZ', 95, 170, 40),
      line('Constructora Andes SpA', 96, 240, 25),
      line('Gerente Comercial', 96, 280, 17),
      line('VISITANTE', 96, 360, 23),
      line('As', 17, 400, 63),
      line('._.', 0, 420, 9),
    ];
    expect(extractNameCandidates(lines)[0].name).toBe('María José González');
  });

  it('une nombre y apellidos impresos en líneas consecutivas', () => {
    const lines = [
      line('CUMBRE MINERA', 96, 40, 34),
      line('Juan', 95, 140, 33, 260, 360),
      line('Pérez Soto', 96, 185, 42, 200, 420),
      line('Codelco', 95, 250, 19),
      line('EXPOSITOR', 96, 300, 24),
    ];
    const c = extractNameCandidates(lines, ['Cumbre Minera']).map((x) => x.name);
    expect(c[0]).toBe('Juan Pérez Soto');
    expect(c).toContain('Pérez Soto');
  });

  it('conserva partículas y mayúsculas mixtas correctas', () => {
    const lines = [
      line('FERIA INNOVA', 96, 30, 26),
      line('Ana de la Fuente', 90, 160, 35),
      line('Universid', 58, 240, 16),
      line('General -21-22 octubre', 89, 300, 20),
    ];
    expect(extractNameCandidates(lines)[0].name).toBe('Ana de la Fuente');
  });

  it('descarta líneas con baja confianza, números, correos o URLs', () => {
    const lines = [
      line('Pedro Rojas', 30, 100, 50),
      line('pedro@empresa.cl', 95, 200, 20),
      line('www.evento.cl', 95, 230, 20),
      line('Stand 14', 95, 260, 20),
    ];
    expect(extractNameCandidates(lines)).toEqual([]);
  });

  it('usa el nombre del evento configurado como texto a ignorar', () => {
    const lines = [line('Andes Digital', 96, 30, 40), line('Rosa Díaz', 95, 120, 30)];
    expect(extractNameCandidates(lines, ['Andes Digital 2026'])[0].name).toBe('Rosa Díaz');
  });

  it('sin texto útil devuelve lista vacía', () => {
    expect(extractNameCandidates([])).toEqual([]);
  });
});

describe('nameWords / formatName', () => {
  const stop = new Set<string>();
  it('rechaza ruido típico del OCR', () => {
    expect(nameWords('LLLL', stop)).toBeNull();
    expect(nameWords('pÉrEz', stop)).toBeNull();
    expect(nameWords('a b', stop)).toBeNull();
    expect(nameWords('de la', stop)).toBeNull();
  });

  it('acepta nombres con tildes, guion y apóstrofo', () => {
    expect(nameWords('José Pérez-Cotapos', stop)).toEqual(['José', 'Pérez-Cotapos']);
    expect(nameWords("Liam O'Connor", stop)).toEqual(['Liam', "O'Connor"]);
  });

  it('formatea mayúsculas sostenidas con capitalización española', () => {
    expect(formatName(['MARÍA', 'JOSÉ', 'DE', 'LA', 'FUENTE'])).toBe('María José de la Fuente');
    expect(formatName(['JOSÉ', 'PÉREZ-COTAPOS'])).toBe('José Pérez-Cotapos');
    expect(formatName(['Ana', 'McDonald'])).toBe('Ana McDonald');
  });
});
