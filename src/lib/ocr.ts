import type { Worker } from 'tesseract.js';
import { analyzeBadge, belowQrCrop, mergeBlockReading, QR_CROP_PIXELS, readBelowQr, type BadgeReading, type Box, type OcrLine, type QrLocation } from './ocrName';

/** Fotograma copiado de la cámara y, si se conoce, la posición del QR en él. */
export interface CapturedFrame {
  canvas: HTMLCanvasElement;
  qr: QrLocation | null;
}

/**
 * OCR en el propio dispositivo con tesseract.js (WebAssembly).
 * Los archivos se sirven desde la app (public/ocr): la imagen nunca sale del teléfono
 * y no se usa ningún servicio externo. Tampoco se guarda la imagen.
 */

let workerPromise: Promise<Worker> | null = null;
// Las lecturas se ejecutan de una en una: cada una cambia parámetros del worker.
let queue: Promise<unknown> = Promise.resolve();

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}ocr/${path}`, window.location.href).href;
}

async function createOcrWorker(): Promise<Worker> {
  const { createWorker, OEM } = await import('tesseract.js');
  return createWorker('spa', OEM.LSTM_ONLY, {
    workerPath: assetUrl('worker.min.js'),
    corePath: assetUrl(''),
    langPath: assetUrl('').replace(/\/$/, ''),
    workerBlobURL: false,
    gzip: true,
    // Guarda el modelo de idioma en IndexedDB para no descargarlo de nuevo.
    cacheMethod: 'write',
  });
}

/** Inicia (una sola vez) la carga del motor OCR. */
export function prewarmOcr(): Promise<Worker> {
  workerPromise ??= createOcrWorker().catch((err: unknown) => {
    workerPromise = null; // permite reintentar más tarde
    throw err;
  });
  return workerPromise;
}

export function ocrSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker !== 'undefined';
}

async function recognize(worker: Worker, image: HTMLCanvasElement, psm: string): Promise<OcrLine[]> {
  // user_defined_dpi evita que tesseract estime la resolución en cada imagen (y lo anote en la consola).
  await worker.setParameters({ tessedit_pageseg_mode: psm as never, user_defined_dpi: '300' });
  const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const text = line.text.trim();
        if (!text) continue;
        lines.push({ text, confidence: line.confidence, top: line.bbox.y0, bottom: line.bbox.y1, left: line.bbox.x0, right: line.bbox.x1 });
      }
    }
  }
  return lines;
}

/** Recorta la zona indicada (con margen) y la amplía para que el nombre mida ~56 px de alto. */
function cropBlock(frame: HTMLCanvasElement, block: Box, nameHeight: number): HTMLCanvasElement | null {
  const m = nameHeight * 0.6;
  const left = Math.max(0, block.left - 2 * m);
  const top = Math.max(0, block.top - m);
  const right = Math.min(frame.width, block.right + 2 * m);
  const bottom = Math.min(frame.height, block.bottom + m);
  const scale = Math.min(3, Math.max(1, 56 / Math.max(1, nameHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((right - left) * scale);
  canvas.height = Math.round((bottom - top) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, left, top, right - left, bottom - top, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Franja bajo el QR, enderezada y ampliada. */
function cropBelowQr(frame: HTMLCanvasElement, qr: QrLocation): HTMLCanvasElement | null {
  const crop = belowQrCrop(qr);
  if (!crop) return null;
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(...crop.matrix);
  ctx.drawImage(frame, 0, 0);
  return canvas;
}

/**
 * Lee la credencial:
 * 0. Si se sabe dónde está el QR, la franja justo debajo (formato con el QR sobre el nombre).
 * 1. Si no, texto disperso en todo el fotograma para ubicar el bloque nombre / institución / cargo.
 * 2. Relectura del bloque recortado y ampliado, línea a línea, para mayor precisión.
 */
export interface BadgeResult extends BadgeReading {
  /**
   * Miniatura de la zona leída, para que el operador vea qué leyó el OCR.
   * Solo se muestra en la confirmación: no se guarda ni se envía.
   */
  preview: string | null;
}

function preview(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

export function readBadge({ canvas: frame, qr }: CapturedFrame, extraStopwords: string[]): Promise<BadgeResult> {
  const job = queue.then(async (): Promise<BadgeResult> => {
    const worker = await prewarmOcr();
    const below = qr ? cropBelowQr(frame, qr) : null;
    if (below) {
      // El nombre debe empezar a menos de un lado de QR del borde superior de la franja.
      const reading = readBelowQr(await recognize(worker, below, '6'), extraStopwords, QR_CROP_PIXELS);
      if (reading.names.length) return { ...reading, preview: preview(below) };
    }
    const first = analyzeBadge(await recognize(worker, frame, '11'), extraStopwords);
    const crop = first.block ? cropBlock(frame, first.block, first.nameHeight) : null;
    if (!crop) return { ...first, preview: preview(below ?? frame) };
    return { ...mergeBlockReading(first, await recognize(worker, crop, '6'), extraStopwords), preview: preview(crop) };
  });
  queue = job.catch(() => undefined);
  return job;
}

/**
 * Copia el fotograma actual del vídeo a un canvas en escala de grises.
 * Se limita el tamaño para que el OCR sea rápido en teléfonos.
 */
export function captureVideoFrame(video: HTMLVideoElement, maxSide = 1600): HTMLCanvasElement | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.filter = 'grayscale(1) contrast(1.25)';
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}
