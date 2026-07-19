import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { bindDomInputs } from './input-focus';

/** In-game apartment invite — browser confirm() auto-declines when not user-initiated */
class ApartmentInvitePanel {
  private root!: HTMLDivElement;
  private visible = false;
  private activeInviteId: string | null = null;

  constructor() {
    this.build();
    this.hide();
  }

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'apartment-invite-panel';
    this.root.style.cssText = `
      display:none;position:fixed;inset:0;z-index:9800;background:#060410cc;
      align-items:center;justify-content:center;font-family:'Courier New',monospace;
    `;
    document.body.appendChild(this.root);
  }

  show(inviteId: string, hostName: string): void {
    if (this.visible && this.activeInviteId === inviteId) return;
    this.activeInviteId = inviteId;
    this.visible = true;
    this.root.style.display = 'flex';
    gameState.pendingApartmentInvite = { inviteId, hostName };

    this.root.innerHTML = `
      <div style="background:#120818;border:2px solid #8866aa;padding:20px;max-width:360px;text-align:center;color:#ddccff;">
        <div style="color:#fc8;font-size:14px;margin-bottom:10px;">Apartment Invitation</div>
        <p style="font-size:11px;line-height:1.6;color:#ccc;margin:0 0 16px;">
          <span style="color:#aaf;">${hostName.replace(/</g, '&lt;')}</span> invites you to their apartment.
        </p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button id="apt-invite-decline" style="padding:8px 16px;background:#221111;border:1px solid #844;color:#faa;cursor:pointer;font-family:inherit;">Decline</button>
          <button id="apt-invite-accept" style="padding:8px 16px;background:#113322;border:1px solid #484;color:#afa;cursor:pointer;font-family:inherit;">Accept</button>
        </div>
      </div>`;

    bindDomInputs(this.root);
    document.getElementById('apt-invite-accept')!.onclick = () => this.respond(true);
    document.getElementById('apt-invite-decline')!.onclick = () => this.respond(false);
  }

  private respond(accept: boolean): void {
    if (!this.activeInviteId) return;
    const inviteId = this.activeInviteId;
    this.hide();
    network.send('apartment_invite_response', { inviteId, accept });
  }

  hide(): void {
    this.visible = false;
    this.activeInviteId = null;
    gameState.pendingApartmentInvite = null;
    this.root.style.display = 'none';
  }
}

export const apartmentInvitePanel = new ApartmentInvitePanel();
