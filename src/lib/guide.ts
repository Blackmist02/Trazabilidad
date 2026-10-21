import type { Point, QrLocation } from './ocrName';

/**
 * Guía de encuadre de la credencial (formato Edifica 2026: QR arriba y debajo nombre, institución y cargo).
 *
 * Todas las medidas están en fracciones del ancho del visor. Las bandas se calcularon con credenciales
 * reales, en lados de QR desde su centro: nombre +0,52…+0,85, institución +0,87…+1,13, cargo +1,15…+1,40.
 */
export const GUIDE = {
  /** Lado del cuadro del QR. */
  qrSide: 0.24,
  /** Centro del cuadro del QR. */
  qrCenter: [0.5, 0.22] as Point,
  /** Ancho de las bandas de texto, en lados de QR. */
  bandWidth: 3.5,
  bands: [
    { key: 'name', label: 'Nombre y apellido', from: 0.5, to: 0.86 },
    { key: 'institution', label: 'Institución', from: 0.86, to: 1.12 },
    { key: 'role', label: 'Cargo', from: 1.14, to: 1.4 },
  ],
} as const;

/** Tolerancias para dar por buena la postura. */
const CENTER_TOLERANCE = 0.3; // en lados de QR
const SIZE_TOLERANCE = 0.2; // ±20 %
const ANGLE_TOLERANCE_DEG = 8;

export type AlignmentHint = 'ok' | 'closer' | 'farther' | 'center' | 'straighten';

export const HINT_TEXT: Record<AlignmentHint, string> = {
  ok: 'Bien. Mantén la cámara quieta…',
  closer: 'Acerca la cámara: el QR debe llenar el cuadro naranja.',
  farther: 'Aleja un poco la cámara: el QR debe caber en el cuadro naranja.',
  center: 'Centra el QR dentro del cuadro naranja.',
  straighten: 'Endereza la credencial: las líneas de texto deben quedar horizontales.',
};

export interface Size {
  width: number;
  height: number;
}

/** Píxeles del vídeo → fracciones del ancho del visor, con `object-fit: cover`. */
export function videoToViewport([x, y]: Point, video: Size, viewport: Size): Point {
  const scale = Math.max(viewport.width / video.width, viewport.height / video.height);
  const ox = (viewport.width - video.width * scale) / 2;
  const oy = (viewport.height - video.height * scale) / 2;
  return [(x * scale + ox) / viewport.width, (y * scale + oy) / viewport.width];
}

export interface Alignment {
  hint: AlignmentHint;
  /** Lado del QR en fracciones del ancho del visor. */
  side: number;
  /** Giro del QR en grados (0 = derecho). */
  angle: number;
  center: Point;
}

/** ¿Coincide el QR detectado con el cuadro naranja de la guía? */
export function checkAlignment(qr: QrLocation, video: Size, viewport: Size): Alignment {
  const tl = videoToViewport(qr.topLeft, video, viewport);
  const tr = videoToViewport(qr.topRight, video, viewport);
  const bl = videoToViewport(qr.bottomLeft, video, viewport);
  // Igual que en belowQrCrop: el lado completo es ~1,4 veces la distancia entre centros de los patrones.
  const side = ((Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(bl[0] - tl[0], bl[1] - tl[1])) / 2) * 1.4;
  const angle = (Math.atan2(tr[1] - tl[1], tr[0] - tl[0]) * 180) / Math.PI;
  const center: Point = [(tr[0] + bl[0]) / 2, (tr[1] + bl[1]) / 2];
  const result = (hint: AlignmentHint): Alignment => ({ hint, side, angle, center });

  if (Math.abs(angle) > ANGLE_TOLERANCE_DEG) return result('straighten');
  if (side < GUIDE.qrSide * (1 - SIZE_TOLERANCE)) return result('closer');
  if (side > GUIDE.qrSide * (1 + SIZE_TOLERANCE)) return result('farther');
  const offset = Math.hypot(center[0] - GUIDE.qrCenter[0], center[1] - GUIDE.qrCenter[1]);
  if (offset > CENTER_TOLERANCE * GUIDE.qrSide) return result('center');
  return result('ok');
}

/**
 * Exige varias lecturas alineadas seguidas antes de capturar, para que la imagen no salga movida.
 */
export class AlignmentStreak {
  private count = 0;
  private last = 0;

  constructor(
    private readonly needed = 3,
    private readonly maxGapMs = 900,
  ) {}

  /** Devuelve true cuando se completa la racha (y la reinicia). */
  push(aligned: boolean, now = Date.now()): boolean {
    if (!aligned || now - this.last > this.maxGapMs) this.count = 0;
    this.last = now;
    if (!aligned) return false;
    this.count++;
    if (this.count < this.needed) return false;
    this.count = 0;
    return true;
  }

  reset(): void {
    this.count = 0;
  }
}
