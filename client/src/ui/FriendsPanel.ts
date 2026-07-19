import type { FriendPresence, FriendRequest } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { bindDomInputs } from './input-focus';

/** Friends list — sealed letters & practitioner circle */
export class FriendsPanel {
  private root!: HTMLDivElement;
  private visible = false;

  constructor() {
    this.build();
    this.hide();
    window.addEventListener('game:player-loaded', this.onUpdate as EventListener);
    window.addEventListener('game:friends-update', this.onUpdate as EventListener);
  }

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'friends-panel';
    document.body.appendChild(this.root);
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
    network.refreshFriends();
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  private onUpdate = (): void => {
    if (this.visible) this.render();
  };

  private render(): void {
    const friends = gameState.friendPresence ?? [];
    const requests = gameState.friendRequests ?? [];

    this.root.innerHTML = `
      <div class="friends-panel-inner">
        <header class="friends-panel-header">
          <h2>Social Circle</h2>
          <div class="wb-toolbar">
            <button type="button" id="friends-refresh" class="wb-btn wb-btn--sm" title="Refresh online status">↻ Refresh</button>
            <button type="button" id="friends-close" class="wb-close" aria-label="Close">✕</button>
          </div>
        </header>
        <div class="friends-panel-body">
          ${requests.length ? this.requestsBlock(requests) : ''}
          <div class="wb-section-label">Add Practitioner</div>
          <div class="friends-add-row">
            <input id="friend-username" class="wb-input" type="text" placeholder="Username" />
            <button type="button" id="friend-add" class="wb-btn">Send Letter</button>
          </div>
          <div class="wb-section-label">Circle of Friends</div>
          ${friends.length ? friends.map((f) => this.friendRow(f)).join('') : '<p class="wb-muted">No friends yet — meet practitioners in town.</p>'}
        </div>
      </div>`;

    document.getElementById('friends-close')!.onclick = () => this.hide();
    document.getElementById('friends-refresh')!.onclick = () => network.refreshFriends();
    document.getElementById('friend-add')!.onclick = () => {
      const name = (document.getElementById('friend-username') as HTMLInputElement).value.trim();
      if (name) network.send('friend_request', { targetUsername: name });
    };
    this.root.querySelectorAll('.fr-accept').forEach((btn) => {
      btn.addEventListener('click', () => {
        network.send('friend_respond', { fromPlayerId: (btn as HTMLElement).dataset.id!, accept: true });
      });
    });
    this.root.querySelectorAll('.fr-decline').forEach((btn) => {
      btn.addEventListener('click', () => {
        network.send('friend_respond', { fromPlayerId: (btn as HTMLElement).dataset.id!, accept: false });
      });
    });
    this.root.querySelectorAll('.friend-invite').forEach((btn) => {
      btn.addEventListener('click', () => {
        network.send('apartment_invite', { friendDbPlayerId: (btn as HTMLElement).dataset.id! });
      });
    });
    this.root.querySelectorAll('.friend-trade').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('game:trade-request', {
          detail: { friendDbPlayerId: (btn as HTMLElement).dataset.id! },
        }));
      });
    });
    this.root.querySelectorAll('.friend-whisper').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = (btn as HTMLElement).dataset.name!;
        window.dispatchEvent(new CustomEvent('game:focus-chat', { detail: { prefix: `/msg "${name}" ` } }));
        this.hide();
      });
    });
    this.root.querySelectorAll('.friend-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        network.send('friend_remove', { friendPlayerId: (btn as HTMLElement).dataset.id! });
      });
    });
    bindDomInputs(this.root);
  }

  private requestsBlock(requests: FriendRequest[]): string {
    return `
      <div class="friends-requests">
        <div class="wb-section-label" style="margin-top:0;">Pending Letters</div>
        ${requests.map((r) => `
          <div class="friends-request-row">
            <span>${r.fromDisplayName}</span>
            <span class="friends-request-row__actions">
              <button type="button" class="wb-btn wb-btn--sm fr-accept" data-id="${r.fromPlayerId}">Accept</button>
              <button type="button" class="wb-btn wb-btn--sm wb-btn--danger fr-decline" data-id="${r.fromPlayerId}">Decline</button>
            </span>
          </div>`).join('')}
      </div>`;
  }

  private friendRow(f: FriendPresence): string {
    const status = f.online
      ? `<span class="wb-status--online">● Online</span>${f.scene ? ` · ${f.scene}` : ''}`
      : '<span class="wb-status--offline">○ Offline</span>';
    return `<article class="friend-row">
      <div class="friend-row__head">
        <span class="friend-row__name">${f.displayName}</span>
        <span class="friend-row__status">${status}</span>
      </div>
      <div class="friend-row__meta">Level ${f.level} · ${f.practitionerType}</div>
      <div class="friend-row__actions">
        ${f.online ? `<button type="button" class="wb-btn wb-btn--sm friend-invite" data-id="${f.playerId}">Invite Home</button>` : ''}
        ${f.online ? `<button type="button" class="wb-btn wb-btn--sm friend-trade" data-id="${f.playerId}">Trade</button>` : ''}
        <button type="button" class="wb-btn wb-btn--sm friend-whisper" data-name="${f.displayName}">Whisper</button>
        <button type="button" class="wb-btn wb-btn--sm wb-btn--danger friend-remove" data-id="${f.playerId}">Remove</button>
      </div>
    </article>`;
  }
}

export const friendsPanel = new FriendsPanel();
