import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';

/** Right-click target interaction panel */
export class TargetPanel {
  private root!: HTMLDivElement;
  private sessionId = '';
  private submenuOpen = false;

  constructor(private auraPanel: { showTarget: (id: string, name: string) => void; hide: () => void }) {
    this.build();
    document.addEventListener('click', (e) => {
      if (!this.root.contains(e.target as Node)) this.submenuOpen = false;
    });
  }

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'target-panel';
    this.root.style.cssText = `
      display:none;position:fixed;z-index:9500;background:#120818;border:2px solid #4488ff;
      font-family:'Courier New',monospace;color:#cce;padding:12px;min-width:200px;border-radius:4px;
      box-shadow:0 0 20px #4488ff44;
    `;
    document.body.appendChild(this.root);
  }

  show(sessionId: string, displayName: string, x: number, y: number): void {
    this.sessionId = sessionId;
    gameState.selectedTargetId = sessionId;
    this.submenuOpen = false;
    this.root.style.display = 'block';
    this.root.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
    this.root.style.top = `${Math.min(y, window.innerHeight - 280)}px`;

    const friendDbId = gameState.friends.find((f) => f.displayName === displayName)?.playerId;
    const pocketSpells = gameState.progression?.pocketSpells ?? [];

    const pocketSubmenu = pocketSpells.length
      ? pocketSpells.map((p) => {
          const spell = gameState.content?.spells?.find((s) => s.id === p.spellId);
          return `<button type="button" class="tp-pocket" data-id="${p.id}">${spell?.name ?? p.spellId} <span style="color:#88aaff">(${p.storedMe} ME)</span></button>`;
        }).join('')
      : '<div class="tp-pocket-empty">No pocket spells prepared</div>';

    this.root.innerHTML = `
      <div style="color:#8cf;font-size:11px;margin-bottom:8px;">◆ ${displayName}</div>
      <div class="tp-submenu-wrap" id="tp-quickcast-wrap">
        <button type="button" class="tp-submenu-trigger" id="tp-quickcast-trigger">Quick Cast <span aria-hidden="true">▸</span></button>
        <div class="tp-submenu" id="tp-quickcast-menu">
          <div class="tp-submenu-label">Pocket Spells</div>
          ${pocketSubmenu}
        </div>
      </div>
      <button type="button" id="tp-trade" style="display:block;width:100%;margin:4px 0;padding:6px;background:#112244;border:1px solid #448;color:#adf;cursor:pointer;">Trade</button>
      ${friendDbId ? `
        <button type="button" id="tp-invite" style="display:block;width:100%;margin:4px 0;padding:6px;background:#113322;border:1px solid #484;color:#afa;cursor:pointer;">Invite to My Apartment</button>
        <button type="button" id="tp-whisper-friend" style="display:block;width:100%;margin:4px 0;padding:6px;background:#221133;border:1px solid #868;color:#daf;cursor:pointer;">Whisper (Distant OK)</button>
      ` : `
        <button type="button" id="tp-add-friend" style="display:block;width:100%;margin:4px 0;padding:6px;background:#221133;border:1px solid #868;color:#daf;cursor:pointer;">Add Friend (by username)</button>
      `}
      <button type="button" id="tp-whisper" style="display:block;width:100%;margin:4px 0;padding:6px;background:#112244;border:1px solid #448;color:#adf;cursor:pointer;">Whisper</button>
      <button type="button" id="tp-aura" style="display:block;width:100%;margin:4px 0;padding:6px;background:#221133;border:1px solid #868;color:#daf;cursor:pointer;">View Aura</button>
      <button type="button" id="tp-taglock" style="display:block;width:100%;margin:4px 0;padding:6px;background:#331111;border:1px solid #844;color:#faa;cursor:pointer;">Collect Taglock (−0.5 HP)</button>
      <button type="button" id="tp-close" style="display:block;width:100%;margin-top:6px;padding:4px;background:#111;border:1px solid #444;color:#888;cursor:pointer;">Close</button>`;

    const wrap = document.getElementById('tp-quickcast-wrap')!;
    const trigger = document.getElementById('tp-quickcast-trigger')!;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.submenuOpen = !this.submenuOpen;
      wrap.classList.toggle('open', this.submenuOpen);
    });
    wrap.addEventListener('mouseenter', () => wrap.classList.add('open'));
    wrap.addEventListener('mouseleave', () => {
      if (!this.submenuOpen) wrap.classList.remove('open');
    });

    document.getElementById('tp-whisper')!.onclick = () => {
      this.hide();
      window.dispatchEvent(new CustomEvent('game:focus-chat', { detail: { prefix: `/msg "${displayName}" ` } }));
    };
    document.getElementById('tp-aura')!.onclick = () => {
      this.auraPanel.showTarget(sessionId, displayName);
      this.hide();
    };
    document.getElementById('tp-taglock')!.onclick = () => {
      network.send('collect_taglock', { targetPlayerId: sessionId });
      this.hide();
    };
    document.getElementById('tp-trade')!.onclick = () => {
      if (friendDbId) {
        window.dispatchEvent(new CustomEvent('game:trade-request', { detail: { friendDbPlayerId: friendDbId } }));
      } else {
        window.dispatchEvent(new CustomEvent('game:trade-request', { detail: { targetSessionId: sessionId } }));
      }
      this.hide();
    };
    document.getElementById('tp-invite')?.addEventListener('click', () => {
      if (friendDbId) network.send('apartment_invite', { friendDbPlayerId: friendDbId });
      this.hide();
    });
    document.getElementById('tp-whisper-friend')?.addEventListener('click', () => {
      this.hide();
      window.dispatchEvent(new CustomEvent('game:focus-chat', { detail: { prefix: `/msg "${displayName}" ` } }));
    });
    document.getElementById('tp-add-friend')?.addEventListener('click', () => {
      const username = prompt("Friend's username (letters only):");
      if (username) network.send('friend_request', { targetUsername: username });
      this.hide();
    });
    document.getElementById('tp-close')!.onclick = () => this.hide();
    this.root.querySelectorAll('.tp-pocket').forEach((btn) => {
      btn.addEventListener('click', () => {
        network.send('cast_pocket_spell', {
          pocketId: (btn as HTMLElement).dataset.id,
          targetPlayerId: this.sessionId,
        });
        this.hide();
      });
    });
  }

  hide(): void {
    this.root.style.display = 'none';
    this.submenuOpen = false;
    gameState.selectedTargetId = null;
  }
}
