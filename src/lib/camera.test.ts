import { describe, expect, it } from 'vitest';
import { checkCameraSupport, mapCameraError } from './camera';

describe('errores de cámara', () => {
  it('permiso denegado', () => {
    expect(mapCameraError(new DOMException('denied', 'NotAllowedError')).code).toBe('permission-denied');
  });

  it('sin cámara, cámara ocupada y restricciones', () => {
    expect(mapCameraError({ name: 'NotFoundError' }).code).toBe('not-found');
    expect(mapCameraError({ name: 'NotReadableError' }).code).toBe('in-use');
    expect(mapCameraError({ name: 'OverconstrainedError' }).code).toBe('overconstrained');
  });

  it('errores desconocidos tienen mensaje genérico con alternativa manual', () => {
    const e = mapCameraError(new Error('x'));
    expect(e.code).toBe('unknown');
    expect(e.hint).toMatch(/manualmente/);
  });

  it('exige HTTPS y soporte de getUserMedia', () => {
    expect(checkCameraSupport({ isSecureContext: false, mediaDevices: {} })?.code).toBe('insecure-context');
    expect(checkCameraSupport({ isSecureContext: true })?.code).toBe('unsupported');
    expect(checkCameraSupport({ isSecureContext: true, mediaDevices: { getUserMedia: () => null } })).toBeNull();
  });
});
