import { describe, expect, it } from 'vitest';
import { bytesToDataUrl, dataUrlToBytes, dataUrlType } from './imageData';

describe('imágenes como data URL', () => {
  it('ida y vuelta entre bytes y data URL', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    const url = bytesToDataUrl(bytes, 'image/webp');
    expect(url.startsWith('data:image/webp;base64,')).toBe(true);
    const back = dataUrlToBytes(url)!;
    expect(back.type).toBe('image/webp');
    expect([...back.data]).toEqual([...bytes]);
  });

  it('solo acepta WebP y JPEG (Safari entrega PNG si no sabe generar WebP)', () => {
    expect(dataUrlType('data:image/webp;base64,AAAA')).toBe('image/webp');
    expect(dataUrlType('data:image/jpeg;base64,AAAA')).toBe('image/jpeg');
    expect(dataUrlType('data:image/png;base64,AAAA')).toBeNull();
    expect(dataUrlType('data:,')).toBeNull();
    expect(dataUrlToBytes('data:image/png;base64,AAAA')).toBeNull();
  });
});
