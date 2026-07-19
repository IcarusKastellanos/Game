/** Persisted chat box size (width matches player notices). */

const STORAGE_KEY = 'witchcraft-chat-prefs-v1';

export interface ChatPreferences {
  /** Outer chat panel width in CSS pixels. */
  width: number;
  /** Message log height in CSS pixels. */
  logHeight: number;
}

const DEFAULTS: ChatPreferences = {
  width: 420,
  logHeight: 160,
};

export function defaultChatWidth(): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  return Math.round(clamp(Math.max(DEFAULTS.width, vw * 0.28), 320, Math.min(720, vw - 24)));
}

export function defaultChatLogHeight(): number {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  return Math.round(clamp(Math.max(DEFAULTS.logHeight, vh * 0.16), 110, Math.min(360, vh * 0.4)));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function loadChatPrefs(): ChatPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { width: defaultChatWidth(), logHeight: defaultChatLogHeight() };
    }
    const parsed = JSON.parse(raw) as Partial<ChatPreferences>;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      width: clamp(Number(parsed.width) || defaultChatWidth(), 280, Math.max(320, vw - 24)),
      logHeight: clamp(Number(parsed.logHeight) || defaultChatLogHeight(), 80, Math.max(120, vh * 0.5)),
    };
  } catch {
    return { width: defaultChatWidth(), logHeight: defaultChatLogHeight() };
  }
}

export function saveChatPrefs(prefs: ChatPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function publishChatLayout(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent('game:chat-layout', {
      detail: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        bottom: window.innerHeight - rect.bottom,
      },
    })
  );
}
