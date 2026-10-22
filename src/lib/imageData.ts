/**
 * Imágenes como data URL (texto). Es el formato que mejor funciona en Safari de iOS:
 * `canvas.toDataURL` es fiable y un texto se guarda sin problemas en IndexedDB.
 */

export interface ImageData64 {
  /** data:image/webp;base64,… o data:image/jpeg;base64,… */
  dataUrl: string;
  type: string;
}

const DATA_URL = /^data:(image\/(?:webp|jpeg));base64,([A-Za-z0-9+/=]+)$/;

/** Tipo MIME de un data URL de imagen admitido (WebP o JPEG), o null. */
export function dataUrlType(dataUrl: string): string | null {
  return DATA_URL.exec(dataUrl)?.[1] ?? null;
}

export function dataUrlToBytes(dataUrl: string): { data: Uint8Array<ArrayBuffer>; type: string } | null {
  const m = DATA_URL.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const data = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { data, type: m[1] };
}

export function bytesToDataUrl(data: ArrayBuffer | Uint8Array, type: string): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${type};base64,${btoa(bin)}`;
}
