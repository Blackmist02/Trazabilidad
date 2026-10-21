import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import type { Result } from '@zxing/library';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkCameraSupport, mapCameraError, type CameraError } from '../lib/camera';
import { captureVideoFrame, type CapturedFrame } from '../lib/ocr';
import type { Point, QrLocation } from '../lib/ocrName';

export type CameraState = 'idle' | 'starting' | 'scanning' | 'paused' | 'error';

interface Props {
  /** Se invoca con cada lectura; el filtrado de repeticiones lo hace el componente padre. */
  onDecode: (text: string) => void;
  paused: boolean;
  /** Se incrementa cuando hay una lectura aceptada, para el destello visual. */
  flashKey: number;
  /** Recibe una función que copia el fotograma actual (null si la cámara no está activa). */
  frameRef?: { current: (() => CapturedFrame | null) | null };
  /** Se invoca cuando la cámara empieza a mostrar imagen. */
  onStarted?: () => void;
}

const DEVICE_KEY = 'trazabilidad.cameraDevice';
/** La posición del QR se usa solo si es reciente: la credencial puede haberse movido. */
const QR_POSITION_MAX_AGE_MS = 1500;

/** Posición del QR en píxeles del vídeo (zxing: inferior izquierdo, superior izquierdo, superior derecho). */
function qrLocation(result: Result): QrLocation | null {
  const p = result.getResultPoints();
  if (!p || p.length < 3) return null;
  const pt = (i: number): Point => [p[i].getX(), p[i].getY()];
  return { bottomLeft: pt(0), topLeft: pt(1), topRight: pt(2) };
}

export function QrCamera({ onDecode, paused, flashKey, frameRef, onStarted }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onDecodeRef = useRef(onDecode);
  const pausedRef = useRef(paused);
  const lastQrRef = useRef<{ at: number; location: QrLocation } | null>(null);
  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem(DEVICE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  onDecodeRef.current = onDecode;
  pausedRef.current = paused;

  useEffect(() => {
    if (!frameRef) return;
    // Se comprueba el vídeo y no los controles: la primera lectura puede llegar antes de que zxing los devuelva.
    frameRef.current = () => {
      const video = videoRef.current;
      if (!video || !video.srcObject || video.readyState < 2) return null;
      const canvas = captureVideoFrame(video);
      if (!canvas) return null;
      const last = lastQrRef.current;
      const k = canvas.width / video.videoWidth;
      const scale = ([x, y]: Point): Point => [x * k, y * k];
      const qr =
        last && Date.now() - last.at < QR_POSITION_MAX_AGE_MS
          ? { bottomLeft: scale(last.location.bottomLeft), topLeft: scale(last.location.topLeft), topRight: scale(last.location.topRight) }
          : null;
      return { canvas, qr };
    };
    return () => {
      frameRef.current = null;
    };
  }, [frameRef]);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setState((s) => (s === 'error' ? s : 'idle'));
  }, []);

  const start = useCallback(
    async (preferredDevice = deviceId) => {
      const unsupported = checkCameraSupport({ isSecureContext: window.isSecureContext, mediaDevices: navigator.mediaDevices });
      if (unsupported) {
        setError(unsupported);
        setState('error');
        return;
      }
      controlsRef.current?.stop();
      setError(null);
      setState('starting');
      const video = videoRef.current;
      if (!video) return;
      // iOS Safari necesita reproducción en línea y sin audio.
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 300 });
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: preferredDevice
          ? { deviceId: { exact: preferredDevice } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      };
      try {
        const controls = await reader.decodeFromConstraints(constraints, video, (result) => {
          if (!result) return;
          // Se sigue anotando la posición con la confirmación abierta, para «Volver a leer».
          const location = qrLocation(result);
          lastQrRef.current = location ? { at: Date.now(), location } : null;
          if (!pausedRef.current) onDecodeRef.current(result.getText());
        });
        controlsRef.current = controls;
        setState('scanning');
        onStarted?.();
        // Con el permiso concedido ya se pueden listar las cámaras con su nombre.
        BrowserQRCodeReader.listVideoInputDevices()
          .then(setDevices)
          .catch(() => setDevices([]));
      } catch (err) {
        const mapped = mapCameraError(err);
        if (mapped.code === 'overconstrained' && preferredDevice) {
          // La cámara guardada ya no existe: se vuelve a la trasera automática.
          setDeviceId('');
          void start('');
          return;
        }
        setError(mapped);
        setState('error');
      }
    },
    [deviceId, onStarted],
  );

  useEffect(() => () => controlsRef.current?.stop(), []);

  // Detiene la cámara al ocultar la pestaña para ahorrar batería y liberar el dispositivo.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && controlsRef.current) stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stop]);

  const chooseDevice = (id: string) => {
    setDeviceId(id);
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      // Sin almacenamiento: la elección dura solo esta sesión.
    }
    if (controlsRef.current) void start(id);
  };

  const active = state === 'scanning' || state === 'starting';

  return (
    <div className="camera">
      <div className={`viewport ${active ? 'is-active' : ''}`}>
        <video ref={videoRef} className="viewport-video" muted playsInline aria-label="Vista de la cámara" />
        {active && <div className="reticle" aria-hidden="true" />}
        {flashKey > 0 && <div key={flashKey} className="flash" aria-hidden="true" />}
        {!active && (
          <div className="viewport-overlay">
            {state === 'error' && error ? (
              <div className="camera-error" role="alert">
                <strong>{error.message}</strong>
                <span>{error.hint}</span>
              </div>
            ) : (
              <span className="muted">Cámara detenida</span>
            )}
          </div>
        )}
        {state === 'scanning' && paused && <div className="viewport-paused">En pausa mientras confirmas</div>}
      </div>

      <div className="camera-status" aria-live="polite">
        <span className={`dot dot-${state}`} />
        {state === 'idle' && 'Pulsa «Iniciar cámara» para escanear.'}
        {state === 'starting' && 'Solicitando acceso a la cámara…'}
        {state === 'scanning' && (paused ? 'Lectura en pausa.' : 'Apunta al código QR de la credencial.')}
        {state === 'error' && 'La cámara no está disponible.'}
      </div>

      <div className="row">
        {active ? (
          <button type="button" className="btn btn-secondary btn-lg grow" onClick={stop}>
            Detener cámara
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-lg grow" onClick={() => void start()}>
            {state === 'error' ? 'Reintentar cámara' : 'Iniciar cámara'}
          </button>
        )}
      </div>

      {devices.length > 1 && (
        <label className="field compact">
          <span>Cámara</span>
          <select value={deviceId} onChange={(e) => chooseDevice(e.target.value)}>
            <option value="">Automática (trasera)</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Cámara ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
