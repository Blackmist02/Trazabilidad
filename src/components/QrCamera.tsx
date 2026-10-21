import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkCameraSupport, mapCameraError, type CameraError } from '../lib/camera';

export type CameraState = 'idle' | 'starting' | 'scanning' | 'paused' | 'error';

interface Props {
  /** Se invoca con cada lectura; el filtrado de repeticiones lo hace el componente padre. */
  onDecode: (text: string) => void;
  paused: boolean;
  /** Se incrementa cuando hay una lectura aceptada, para el destello visual. */
  flashKey: number;
}

const DEVICE_KEY = 'trazabilidad.cameraDevice';

export function QrCamera({ onDecode, paused, flashKey }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onDecodeRef = useRef(onDecode);
  const pausedRef = useRef(paused);
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
          if (result && !pausedRef.current) onDecodeRef.current(result.getText());
        });
        controlsRef.current = controls;
        setState('scanning');
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
    [deviceId],
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
