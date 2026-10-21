import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import type { Result } from '@zxing/library';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkCameraSupport, mapCameraError, type CameraError } from '../lib/camera';
import { AlignmentStreak, checkAlignment, GUIDE, HINT_TEXT, type AlignmentHint } from '../lib/guide';
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
  /** Guía de encuadre: solo se entrega la lectura cuando el QR coincide con el cuadro naranja. */
  guide?: boolean;
  /** ¿Este código está bloqueado (ya registrado y aún a la vista)? Entonces no se muestran indicaciones. */
  isBlocked?: (text: string) => boolean;
}

const DEVICE_KEY = 'trazabilidad.cameraDevice';
/** La posición del QR se usa solo si es reciente: la credencial puede haberse movido. */
const QR_POSITION_MAX_AGE_MS = 1500;
/** Sin ver el QR durante este tiempo se ocultan las indicaciones de encuadre. */
const QR_LOST_MS = 800;

/** Posición del QR en píxeles del vídeo (zxing: inferior izquierdo, superior izquierdo, superior derecho). */
function qrLocation(result: Result): QrLocation | null {
  const p = result.getResultPoints();
  if (!p || p.length < 3) return null;
  const pt = (i: number): Point => [p[i].getX(), p[i].getY()];
  return { bottomLeft: pt(0), topLeft: pt(1), topRight: pt(2) };
}

export function QrCamera({ onDecode, paused, flashKey, frameRef, onStarted, guide = false, isBlocked }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef(guide);
  guideRef.current = guide;
  const isBlockedRef = useRef(isBlocked);
  isBlockedRef.current = isBlocked;
  const streakRef = useRef(new AlignmentStreak());
  const lastTextRef = useRef<{ text: string; at: number } | null>(null);
  const [hint, setHint] = useState<AlignmentHint | null>(null);
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
    setHint(null);
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
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      };
      try {
        const controls = await reader.decodeFromConstraints(constraints, video, (result) => {
          const now = Date.now();
          if (!result) {
            if (lastTextRef.current && now - lastTextRef.current.at > QR_LOST_MS) {
              lastTextRef.current = null;
              streakRef.current.reset();
              setHint(null);
            }
            return;
          }
          const text = result.getText();
          lastTextRef.current = { text, at: now };
          // Se sigue anotando la posición con la confirmación abierta, para «Volver a leer».
          const location = qrLocation(result);
          lastQrRef.current = location ? { at: now, location } : null;
          if (!guideRef.current) {
            if (!pausedRef.current) onDecodeRef.current(text);
            return;
          }
          if (pausedRef.current || isBlockedRef.current?.(text)) {
            streakRef.current.reset();
            setHint(null);
            return;
          }
          const rect = viewportRef.current?.getBoundingClientRect();
          const next =
            location && rect?.width && video.videoWidth
              ? checkAlignment(location, { width: video.videoWidth, height: video.videoHeight }, rect).hint
              : 'center';
          setHint(next);
          // Varias lecturas alineadas seguidas: la cámara está quieta y la imagen saldrá nítida.
          if (streakRef.current.push(next === 'ok', now)) {
            setHint(null);
            onDecodeRef.current(text);
          }
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
  const showGuide = active && guide && !paused;

  /** Registra el código a la vista aunque la credencial no esté alineada. */
  const acceptUnaligned = () => {
    const last = lastTextRef.current;
    if (!last) return;
    streakRef.current.reset();
    setHint(null);
    onDecodeRef.current(last.text);
  };

  return (
    <div className="camera">
      <div ref={viewportRef} className={`viewport ${active ? 'is-active' : ''}`}>
        <video ref={videoRef} className="viewport-video" muted playsInline aria-label="Vista de la cámara" />
        {active && !guide && <div className="reticle" aria-hidden="true" />}
        {showGuide && <GuideOverlay aligned={hint === 'ok'} />}
        {showGuide && hint && <div className={`guide-hint ${hint === 'ok' ? 'is-ok' : ''}`}>{HINT_TEXT[hint]}</div>}
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
        {state === 'scanning' &&
          (paused
            ? 'Lectura en pausa.'
            : guide
              ? 'Pon el QR en el cuadro naranja y el nombre en la banda verde.'
              : 'Apunta al código QR de la credencial.')}
        {state === 'error' && 'La cámara no está disponible.'}
      </div>

      {showGuide && (
        <ul className="guide-legend" aria-label="Guía de encuadre">
          <li><span className="swatch swatch-qr" /> QR</li>
          <li><span className="swatch swatch-name" /> Nombre</li>
          <li><span className="swatch swatch-institution" /> Institución</li>
          <li><span className="swatch swatch-role" /> Cargo</li>
        </ul>
      )}

      {showGuide && hint && hint !== 'ok' && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={acceptUnaligned}>
          Registrar sin alinear
        </button>
      )}

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

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/**
 * Cuadro del QR y bandas de las tres líneas, en la posición que tendrían en una credencial
 * alineada. Las medidas son fracciones del ancho del visor (el contenedor es cuadrado).
 */
function GuideOverlay({ aligned }: { aligned: boolean }) {
  const { qrSide: q, qrCenter: [cx, cy], bandWidth, bands } = GUIDE;
  return (
    <div className={`guide ${aligned ? 'is-aligned' : ''}`} aria-hidden="true">
      <div className="guide-box guide-qr" style={{ left: pct(cx - q / 2), top: pct(cy - q / 2), width: pct(q), height: pct(q) }} />
      {bands.map((b) => (
        <div
          key={b.key}
          className={`guide-box guide-${b.key}`}
          style={{ left: pct(cx - (bandWidth * q) / 2), width: pct(bandWidth * q), top: pct(cy + b.from * q), height: pct((b.to - b.from) * q) }}
        />
      ))}
    </div>
  );
}
