/** Cross-room chat registry — global channel + /msg by display name */

export type ChatChannel = 'global' | 'local' | 'whisper' | 'system';

export interface ChatPayload {
  from: string;
  message: string;
  channel: ChatChannel;
  fromSessionId?: string;
  targetDisplayName?: string;
  scene?: string;
  timestamp: number;
}

export interface ChatPlayerRef {
  sessionId: string;
  displayName: string;
  roomId: string;
  scene: string;
  send: (type: string, data: ChatPayload) => void;
}

class ChatService {
  private players = new Map<string, ChatPlayerRef>();

  register(ref: ChatPlayerRef): void {
    this.players.set(ref.sessionId, ref);
  }

  unregister(sessionId: string): void {
    this.players.delete(sessionId);
  }

  updateRoom(sessionId: string, roomId: string, scene: string): void {
    const p = this.players.get(sessionId);
    if (p) {
      p.roomId = roomId;
      p.scene = scene;
    }
  }

  getAll(): ChatPlayerRef[] {
    return [...this.players.values()];
  }

  findByDisplayName(name: string): ChatPlayerRef | undefined {
    const lower = name.trim().toLowerCase();
    return this.getAll().find((p) => p.displayName.toLowerCase() === lower);
  }

  /** Match longest online display name prefix (supports multi-word names) */
  parseMsgTarget(text: string): { target: ChatPlayerRef; message: string } | null {
    const trimmed = text.trim();
    const quoted = trimmed.match(/^"([^"]+)"\s+([\s\S]+)$/);
    if (quoted) {
      const target = this.findByDisplayName(quoted[1]);
      if (target) return { target, message: quoted[2].trim() };
      return null;
    }

    const sorted = this.getAll().sort((a, b) => b.displayName.length - a.displayName.length);
    for (const p of sorted) {
      const prefix = p.displayName.toLowerCase();
      if (trimmed.toLowerCase().startsWith(prefix + ' ')) {
        return { target: p, message: trimmed.slice(p.displayName.length).trim() };
      }
    }

    const space = trimmed.indexOf(' ');
    if (space <= 0) return null;
    const target = this.findByDisplayName(trimmed.slice(0, space));
    if (!target) return null;
    return { target, message: trimmed.slice(space + 1).trim() };
  }

  broadcastGlobal(payload: ChatPayload): void {
    for (const p of this.players.values()) {
      p.send('chat', payload);
    }
  }

  sendTo(sessionId: string, payload: ChatPayload): void {
    this.players.get(sessionId)?.send('chat', payload);
  }

  getPlayersInRoom(roomId: string): ChatPlayerRef[] {
    return this.getAll().filter((p) => p.roomId === roomId);
  }
}

export const chatService = new ChatService();

export function parseMsgCommand(raw: string): { targetName: string; message: string } | null {
  if (!raw.toLowerCase().startsWith('/msg ')) return null;
  const rest = raw.slice(5).trim();
  const quoted = rest.match(/^"([^"]+)"\s+([\s\S]+)$/);
  if (quoted) return { targetName: quoted[1], message: quoted[2].trim() };
  const space = rest.indexOf(' ');
  if (space <= 0) return null;
  return { targetName: rest.slice(0, space), message: rest.slice(space + 1).trim() };
}
