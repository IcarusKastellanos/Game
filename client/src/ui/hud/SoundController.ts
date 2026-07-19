/** Subtle UI sounds — hooks for future audio assets */
export class SoundController {
  private enabled = true;

  playHover(): void {
    if (!this.enabled) return;
    // Placeholder: wire to AmbientAudio or WebAudio chime assets
  }

  playClick(): void {
    if (!this.enabled) return;
  }

  playSuccess(): void {
    if (!this.enabled) return;
  }

  playError(): void {
    if (!this.enabled) return;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }
}

export const soundController = new SoundController();
