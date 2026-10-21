/**
 * Filtro de lecturas repetidas: la cámara entrega el mismo código en muchos
 * fotogramas consecutivos. Un código idéntico se ignora mientras siga a la
 * vista y durante `cooldownMs` después de la última vez que se vio.
 */
export class ScanGate {
  private lastCode: string | null = null;
  private lastSeenAt = 0;
  private busy = false;
  private cooldownMs: number;

  constructor(cooldownMs = 4000) {
    this.cooldownMs = cooldownMs;
  }

  setCooldown(ms: number): void {
    this.cooldownMs = Math.max(0, ms);
  }

  /** Devuelve true solo si la lectura debe procesarse. */
  accept(code: string, now = Date.now()): boolean {
    if (this.busy) return false;
    if (code === this.lastCode && now - this.lastSeenAt < this.cooldownMs) {
      // Se renueva la ventana: mientras el código siga frente a la cámara, no se repite.
      this.lastSeenAt = now;
      return false;
    }
    this.lastCode = code;
    this.lastSeenAt = now;
    this.busy = true;
    return true;
  }

  /** Libera el escáner tras confirmar o cancelar; el mismo código sigue en enfriamiento. */
  release(now = Date.now()): void {
    this.busy = false;
    this.lastSeenAt = now;
  }

  isBusy(): boolean {
    return this.busy;
  }

  reset(): void {
    this.lastCode = null;
    this.lastSeenAt = 0;
    this.busy = false;
  }
}
