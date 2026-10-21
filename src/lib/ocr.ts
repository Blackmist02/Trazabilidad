import type { Worker } from 'tesseract.js';
import type { OcrLine } from './ocrName';

/**
 * OCR en el propio dispositivo con tesseract.js (WebAssembly).
 * Los archivos se sirven desde la app (public/ocr): la imagen nunca sale del teléfono
 * y no se usa ningún servicio externo. Tampoco se guarda la imagen.
 */

let workerPromise: Promise<Worker> | null = null;

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}ocr/${path}`, window.location.href).href;
}

async function createOcrWorker(): Promise<Worker> {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const worker = await createWorker('spa', OEM.LSTM_ONLY, {
    workerPath: assetUrl('worker.min.js'),
    corePath: assetUrl(''),
    langPath: assetUrl('').replace(/\/$/, ''),
    workerBlobURL: false,
    gzip: true,
    // Guarda el modelo de idioma en IndexedDB para no descargarlo de nuevo.
    cacheMethod: 'write',
  });
  // Texto disperso: las credenciales tienen bloques sueltos de distinto tamaño.
  // user_defined_dpi evita que tesseract estime la resolución en cada imagen (y lo anote en la consola).
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
  return worker;
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

export async function recognizeLines(image: HTMLCanvasElement): Promise<OcrLine[]> {
  const worker = await prewarmOcr();
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
