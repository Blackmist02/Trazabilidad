let audioCtx: AudioContext | null = null;

/** Vibración corta (Android; iOS Safari no la admite). */
export function vibrate(pattern: number | number[] = 80): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Sin soporte.
  }
}

/** Pitido breve con Web Audio; no requiere archivos externos. */
export function beep(frequency = 880, durationMs = 90): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = frequency;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch {
    // Audio no disponible.
  }
}
