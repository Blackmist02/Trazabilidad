import { describe, expect, it } from 'vitest';
import { AlignmentStreak, checkAlignment, GUIDE, videoToViewport } from './guide';
import type { Point, QrLocation } from './ocrName';
import { ScanGate } from './scanGate';

const VIEW = { width: 400, height: 400 };
// Vídeo vertical 720×1280 en un visor cuadrado: se recorta arriba y abajo (object-fit: cover).
const VIDEO = { width: 720, height: 1280 };

/** QR derecho de lado `side` (fracción del visor) centrado en `center` (fracciones), en píxeles del vídeo. */
function qrAt(center: Point, side: number, angleDeg = 0): QrLocation {
  const scale = 400 / 720;
  const oy = (400 - 1280 * scale) / 2;
  const toVideo = ([x, y]: Point): Point => [(x * 400) / scale, (y * 400 - oy) / scale];
  const d = side / 1.4 / 2; // media distancia entre centros de los patrones
  const r = (angleDeg * Math.PI) / 180;
  const rot = ([x, y]: Point): Point => [center[0] + x * Math.cos(r) - y * Math.sin(r), center[1] + x * Math.sin(r) + y * Math.cos(r)];
  return { topLeft: toVideo(rot([-d, -d])), topRight: toVideo(rot([d, -d])), bottomLeft: toVideo(rot([-d, d])) };
}

describe('guía de encuadre', () => {
  it('convierte coordenadas del vídeo con object-fit: cover', () => {
    const [x, y] = videoToViewport([360, 640], VIDEO, VIEW);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0.5);
  });

  it('acepta el QR dentro del cuadro naranja', () => {
    expect(checkAlignment(qrAt(GUIDE.qrCenter, GUIDE.qrSide), VIDEO, VIEW).hint).toBe('ok');
    expect(checkAlignment(qrAt([0.52, 0.23], GUIDE.qrSide * 1.1, 4), VIDEO, VIEW).hint).toBe('ok');
  });

  it('pide acercar, alejar, centrar o enderezar', () => {
    // Credencial como en la foto real: QR pequeño y más abajo que el cuadro.
    expect(checkAlignment(qrAt([0.6, 0.37], 0.16), VIDEO, VIEW).hint).toBe('closer');
    expect(checkAlignment(qrAt(GUIDE.qrCenter, 0.34), VIDEO, VIEW).hint).toBe('farther');
    expect(checkAlignment(qrAt([0.5, 0.4], GUIDE.qrSide), VIDEO, VIEW).hint).toBe('center');
    expect(checkAlignment(qrAt(GUIDE.qrCenter, GUIDE.qrSide, 15), VIDEO, VIEW).hint).toBe('straighten');
  });

  it('exige varias lecturas alineadas seguidas', () => {
    const s = new AlignmentStreak(3, 900);
    expect(s.push(true, 0)).toBe(false);
    expect(s.push(true, 200)).toBe(false);
    expect(s.push(false, 400)).toBe(false); // se movió: vuelve a empezar
    expect(s.push(true, 600)).toBe(false);
    expect(s.push(true, 800)).toBe(false);
    expect(s.push(true, 1000)).toBe(true);
    expect(s.push(true, 3000)).toBe(false); // tras una pausa larga, empieza de nuevo
  });
});

describe('ScanGate.seen', () => {
  it('un código ya registrado y aún a la vista sigue bloqueado sin procesarse', () => {
    const gate = new ScanGate(1000);
    expect(gate.seen('A1', 0)).toBe(false);
    gate.accept('A1', 0);
    expect(gate.seen('B2', 10)).toBe(true); // confirmación abierta
    gate.release(100);
    for (let t = 500; t <= 3000; t += 500) expect(gate.seen('A1', t)).toBe(true);
    expect(gate.seen('B2', 3000)).toBe(false);
    expect(gate.accept('A1', 5000)).toBe(true);
  });
});
