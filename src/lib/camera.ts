export type CameraErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'not-found'
  | 'in-use'
  | 'overconstrained'
  | 'aborted'
  | 'unknown';

export interface CameraError {
  code: CameraErrorCode;
  message: string;
  hint: string;
}

const MESSAGES: Record<CameraErrorCode, { message: string; hint: string }> = {
  'insecure-context': {
    message: 'La cámara solo funciona en una conexión segura (HTTPS).',
    hint: 'Abre la aplicación desde su dirección https://.',
  },
  unsupported: {
    message: 'Este navegador no permite usar la cámara.',
    hint: 'Usa Safari (iPhone) o Chrome (Android) actualizados, o introduce el código manualmente.',
  },
  'permission-denied': {
    message: 'Se denegó el permiso de cámara.',
    hint: 'Habilita la cámara para este sitio en los ajustes del navegador y vuelve a intentarlo. Mientras tanto puedes introducir el código manualmente.',
  },
  'not-found': {
    message: 'No se encontró ninguna cámara.',
    hint: 'Comprueba que el dispositivo tenga cámara o introduce el código manualmente.',
  },
  'in-use': {
    message: 'La cámara está siendo usada por otra aplicación.',
    hint: 'Cierra otras apps o pestañas que usen la cámara y vuelve a intentarlo.',
  },
  overconstrained: {
    message: 'La cámara seleccionada no está disponible.',
    hint: 'Elige otra cámara o vuelve a la selección automática.',
  },
  aborted: {
    message: 'Se interrumpió el acceso a la cámara.',
    hint: 'Vuelve a pulsar «Iniciar cámara».',
  },
  unknown: {
    message: 'No se pudo iniciar la cámara.',
    hint: 'Vuelve a intentarlo o introduce el código manualmente.',
  },
};

export function cameraError(code: CameraErrorCode): CameraError {
  return { code, ...MESSAGES[code] };
}

/** Comprueba los requisitos antes de pedir la cámara. */
export function checkCameraSupport(env: { isSecureContext: boolean; mediaDevices?: unknown }): CameraError | null {
  if (!env.isSecureContext) return cameraError('insecure-context');
  const md = env.mediaDevices as { getUserMedia?: unknown } | undefined;
  if (!md || typeof md.getUserMedia !== 'function') return cameraError('unsupported');
  return null;
}

/** Traduce los errores de getUserMedia a mensajes comprensibles para el operador. */
export function mapCameraError(err: unknown): CameraError {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return cameraError('permission-denied');
    case 'SecurityError':
      return cameraError('insecure-context');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return cameraError('not-found');
    case 'NotReadableError':
    case 'TrackStartError':
      return cameraError('in-use');
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return cameraError('overconstrained');
    case 'AbortError':
      return cameraError('aborted');
    case 'TypeError':
      return cameraError('unsupported');
    default:
      return cameraError('unknown');
  }
}
