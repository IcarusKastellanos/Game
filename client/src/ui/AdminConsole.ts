import Phaser from 'phaser';
import { network } from '../net/NetworkManager';
import { gameState } from '../data/game-state';
import { bindDomInput, shouldBlockGameHotkeys } from './input-focus';

/** In-game admin text console — backtick (`) key */
export class AdminConsole {
  private container!: Phaser.GameObjects.Container;
  private inputEl!: HTMLInputElement;
  private outputEl!: HTMLDivElement;
  private visible = false;
  private commands: string[] = [];
  private debugFlags = new Set<string>();

  constructor(private scene: Phaser.Scene) {
    this.buildDom();
    this.hide();

    scene.input.keyboard?.on('keydown-BACK_QUOTE', () => {
      if (shouldBlockGameHotkeys()) return;
      this.toggle();
    });

    window.addEventListener('game:player-loaded', this.onLoaded as EventListener);
    network.room?.onMessage('admin_result', (data: { success: boolean; message: string }) => {
      this.log(data.success ? `[OK] ${data.message}` : `[ERR] ${data.message}`);
    });
  }

  private onLoaded = (e: CustomEvent<{ isAdmin?: boolean; adminCommands?: string[] }>): void => {
    if (e.detail.isAdmin) {
      this.commands = e.detail.adminCommands ?? [];
      gameState.isAdmin = true;
    }
  };

  bindRoom(): void {
    network.room?.onMessage('admin_result', (data: { success: boolean; message: string }) => {
      this.log(data.success ? `[OK] ${data.message}` : `[ERR] ${data.message}`);
    });
    network.room?.onMessage('admin_tp', (data: { x: number; y: number }) => {
      window.dispatchEvent(new CustomEvent('game:admin-tp', { detail: data }));
    });
    network.room?.onMessage('admin_heal', () => {
      window.dispatchEvent(new CustomEvent('game:admin-heal'));
    });
    network.room?.onMessage('admin_inventory', () => {
      /* synced via state */
    });
    network.room?.onMessage('admin_setstat', () => {
      /* synced via state */
    });
  }

  private buildDom(): void {
    const wrap = document.createElement('div');
    wrap.id = 'admin-console';
    wrap.style.cssText = `
      position:fixed;bottom:0;left:0;right:0;height:220px;background:#0a0812ee;
      border-top:2px solid #c9a227;font-family:monospace;font-size:12px;z-index:10000;
      display:none;flex-direction:column;
    `;
    this.outputEl = document.createElement('div');
    this.outputEl.style.cssText = 'flex:1;overflow-y:auto;padding:8px;color:#aaffaa;';
    this.inputEl = document.createElement('input');
    this.inputEl.style.cssText = `
      background:#1a1025;border:none;border-top:1px solid #443;color:#ffcc88;
      padding:8px;font-family:monospace;font-size:13px;outline:none;
    `;
    this.inputEl.placeholder = 'Admin command (/help)...';
    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submit();
      if (e.key === 'Escape') this.hide();
      if (e.key === 'Tab') {
        e.preventDefault();
        this.autocomplete();
      }
    });
    bindDomInput(this.inputEl);
    wrap.appendChild(this.outputEl);
    wrap.appendChild(this.inputEl);
    document.body.appendChild(wrap);
    this.container = this.scene.add.container(0, 0); // phaser ref only
  }

  toggle(): void {
    if (!gameState.isAdmin) return;
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    this.visible = true;
    const el = document.getElementById('admin-console');
    if (el) el.style.display = 'flex';
    this.inputEl.focus();
    this.log('Admin console — /help for commands, F1 to close');
  }

  hide(): void {
    this.visible = false;
    const el = document.getElementById('admin-console');
    if (el) el.style.display = 'none';
  }

  private log(msg: string): void {
    this.outputEl.innerHTML += `<div>${msg.replace(/</g, '&lt;')}</div>`;
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  private submit(): void {
    const cmd = this.inputEl.value.trim();
    this.inputEl.value = '';
    if (!cmd) return;
    this.log(`> ${cmd}`);

    if (cmd.startsWith('/debug ')) {
      const flag = cmd.split(' ')[1];
      if (this.debugFlags.has(flag)) this.debugFlags.delete(flag);
      else this.debugFlags.add(flag);
      this.log(`Debug ${flag}: ${this.debugFlags.has(flag) ? 'ON' : 'OFF'}`);
      window.dispatchEvent(new CustomEvent('game:debug-toggle', { detail: { flag, on: this.debugFlags.has(flag) } }));
      return;
    }

    network.send('admin_command', { command: cmd });
  }

  private autocomplete(): void {
    const partial = this.inputEl.value.replace(/^\//, '').split(' ')[0].toLowerCase();
    const match = this.commands.find((c) => c.startsWith(partial));
    if (match) this.inputEl.value = `/${match} `;
  }
}
