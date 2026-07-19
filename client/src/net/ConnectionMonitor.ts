const SERVER_HTTP =
  import.meta.env.VITE_SERVER_URL?.replace('ws://', 'http://').replace('wss://', 'https://') ??
  'http://localhost:2567';

const HEALTH_CHECK_INTERVAL_MS = 30_000;
/** Retry reconnect at 5s, 10s, 15s, and 30s after disconnect; kick if still down at 30s */
const RETRY_AT_MS = [5_000, 10_000, 15_000, 30_000] as const;

export interface ConnectionMonitorConfig {
  healthCheck: () => boolean;
  onReconnect: () => Promise<boolean>;
  onKicked: () => void;
}

/** Periodic server checks, reconnect retries, and on-screen warning banner */
class ConnectionMonitor {
  private config: ConnectionMonitorConfig | null = null;
  private banner: HTMLDivElement | null = null;
  private kickOverlay: HTMLDivElement | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimers: ReturnType<typeof setTimeout>[] = [];
  private recovering = false;
  private paused = false;
  private reconnectInFlight = false;

  configure(config: ConnectionMonitorConfig): void {
    this.config = config;
  }

  start(): void {
    this.stopHealthPolling();
    this.healthTimer = setInterval(() => void this.pollHealth(), HEALTH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    this.stopHealthPolling();
    this.clearRetries();
    this.recovering = false;
    this.reconnectInFlight = false;
    this.hideBanner();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  notifyConnected(): void {
    this.recovering = false;
    this.reconnectInFlight = false;
    this.clearRetries();
    this.hideBanner();
  }

  notifyDisconnected(): void {
    if (this.paused || this.recovering || !this.config) return;
    this.recovering = true;
    this.showBanner('Connection lost — trying to find it...');
    this.clearRetries();

    for (const delay of RETRY_AT_MS) {
      const timer = setTimeout(() => void this.runRetry(delay), delay);
      this.retryTimers.push(timer);
    }
  }

  private async pollHealth(): Promise<void> {
    if (this.paused || this.recovering || !this.config) return;

    let serverReachable = false;
    try {
      const res = await fetch(`${SERVER_HTTP}/health`, {
        signal: AbortSignal.timeout(8_000),
      });
      serverReachable = res.ok;
    } catch {
      serverReachable = false;
    }

    const roomOk = this.config.healthCheck();
    if (!serverReachable || !roomOk) {
      this.notifyDisconnected();
    }
  }

  private async runRetry(delayMs: number): Promise<void> {
    if (!this.recovering || !this.config) return;
    if (this.reconnectInFlight) return;

    this.reconnectInFlight = true;
    let ok = false;
    try {
      ok = await this.config.onReconnect();
    } catch {
      ok = false;
    } finally {
      this.reconnectInFlight = false;
    }

    if (ok) {
      this.notifyConnected();
      return;
    }

    if (delayMs === RETRY_AT_MS[RETRY_AT_MS.length - 1]) {
      this.recovering = false;
      this.clearRetries();
      this.hideBanner();
      this.config.onKicked();
    }
  }

  showKickScreen(): void {
    if (this.kickOverlay) return;

    this.kickOverlay = document.createElement('div');
    this.kickOverlay.id = 'connection-kick-overlay';
    this.kickOverlay.style.cssText = `
      position:fixed;inset:0;z-index:25000;background:#1a1025ee;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'Courier New',monospace;color:#ffcc88;text-align:center;padding:24px;
    `;
    this.kickOverlay.innerHTML = `
      <div style="font-size:18px;color:#faa;margin-bottom:12px;">Connection Lost</div>
      <p style="font-size:11px;color:#aaa;max-width:320px;line-height:1.6;">
        The server could not be reached after 30 seconds. You have been disconnected.
      </p>
      <button id="connection-reload" style="margin-top:20px;padding:10px 20px;background:#442200;border:2px solid #fc8;color:#fc8;cursor:pointer;font-family:inherit;font-size:11px;">
        Return to Login
      </button>`;
    document.body.appendChild(this.kickOverlay);
    document.getElementById('connection-reload')!.onclick = () => window.location.reload();
  }

  private showBanner(message: string): void {
    if (!this.banner) {
      this.banner = document.createElement('div');
      this.banner.id = 'connection-warning';
      this.banner.style.cssText = `
        position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:20000;background:#332200;border:2px solid #ccaa00;
        color:#ffee88;padding:14px 22px;font-family:'Courier New',monospace;font-size:12px;
        text-align:center;box-shadow:0 0 28px #ccaa0055;border-radius:6px;max-width:min(90vw,420px);
        pointer-events:none;
      `;
      document.body.appendChild(this.banner);
    }
    this.banner.textContent = `⚠ ${message}`;
    this.banner.style.display = 'block';
  }

  private hideBanner(): void {
    if (this.banner) this.banner.style.display = 'none';
  }

  private clearRetries(): void {
    for (const t of this.retryTimers) clearTimeout(t);
    this.retryTimers = [];
  }

  private stopHealthPolling(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }
}

export const connectionMonitor = new ConnectionMonitor();
