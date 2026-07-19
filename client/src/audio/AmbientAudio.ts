/** Procedural ambient audio layers per scene (Web Audio API) */

type AmbienceId = 'apartment' | 'town' | 'shop' | 'none';

class AmbientAudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private current: AmbienceId = 'none';
  private nodes: AudioNode[] = [];

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.08;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  getScene(): AmbienceId {
    return this.current;
  }

  /** Re-start layers after browser unlocks AudioContext */
  resume(): void {
    if (this.current === 'none') {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    const scene = this.current;
    this.current = 'none';
    this.setScene(scene);
  }

  setScene(scene: AmbienceId): void {
    if (scene === this.current && this.nodes.length > 0) return;
    this.stopLayers();
    this.current = scene;
    if (scene === 'none' || !this.ensure() || !this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();

    if (scene === 'apartment') this.startApartment();
    else if (scene === 'town') this.startTown();
    else if (scene === 'shop') this.startShop();
  }

  stop(): void {
    this.stopLayers();
    this.current = 'none';
  }

  private stopLayers(): void {
    for (const n of this.nodes) {
      try {
        if ('stop' in n && typeof (n as OscillatorNode).stop === 'function') {
          (n as OscillatorNode).stop();
        }
        n.disconnect();
      } catch { /* ignore */ }
    }
    this.nodes = [];
  }

  private tone(freq: number, type: OscillatorType, gain: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    this.nodes.push(osc, g);
  }

  private noise(gain: number): void {
    if (!this.ctx || !this.master) return;
    const bufferSize = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.35;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start();
    this.nodes.push(src, g);
  }

  private startApartment(): void {
    this.tone(110, 'sine', 0.015);
    this.tone(164.81, 'triangle', 0.008);
    this.noise(0.004);
  }

  private startTown(): void {
    this.tone(98, 'sine', 0.012);
    this.tone(123.47, 'triangle', 0.01);
    this.noise(0.008);
  }

  private startShop(): void {
    this.tone(130.81, 'sine', 0.01);
    this.tone(196, 'sine', 0.006);
    this.tone(261.63, 'triangle', 0.004);
    this.noise(0.003);
  }

  /** One-shot pitch-sweeping tone with a soft attack/decay envelope. */
  private sweep(
    freqStart: number,
    freqEnd: number,
    duration: number,
    peakGain: number,
    type: OscillatorType = 'sine'
  ): void {
    if (!this.ensure() || !this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), now + duration);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peakGain, now + Math.min(0.12, duration * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  /** Soft magical hum + rising crystalline tone as the spell activates. */
  playTeleportDepart(reduced = false): void {
    this.sweep(160, 520, reduced ? 0.4 : 1.1, 0.14, 'sine');
    if (reduced) return;
    this.sweep(320, 880, 1.2, 0.06, 'triangle');
    this.sweep(90, 70, 0.9, 0.05, 'sine');
  }

  /** Reverse gathering sweep as the player rematerializes. */
  playTeleportArrive(reduced = false): void {
    this.sweep(560, 220, reduced ? 0.4 : 1.0, 0.12, 'sine');
    if (reduced) return;
    this.sweep(900, 360, 1.1, 0.05, 'triangle');
  }

  /** Soft chime once rematerialization completes. */
  playTeleportComplete(reduced = false): void {
    this.sweep(660, 660, reduced ? 0.25 : 0.5, 0.1, 'sine');
    if (reduced) return;
    this.sweep(990, 990, 0.6, 0.05, 'sine');
  }
}

export const ambientAudio = new AmbientAudioManager();

/** Resume audio after first user gesture (browser policy) */
export function bindAmbientAudioUnlock(): void {
  const unlock = (): void => {
    ambientAudio.resume();
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}
