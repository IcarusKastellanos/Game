import { gameState } from '../data/game-state';
import { formatDisplayName, normalizeUsername, validateDisplayName, validateUsername } from '@witchcraft/shared';
import { clearIconVerifySession } from '../assets/ItemIconAssetStore';
import { bindDomInputs } from './input-focus';

const STORAGE_USER = 'witchcraft_username';
const STORAGE_DISPLAY = 'witchcraft_display_name';
const STORAGE_TOKEN = 'witchcraft_auth_token';

const API = import.meta.env.VITE_SERVER_URL?.replace('ws://', 'http://').replace('wss://', 'https://') ?? 'http://localhost:2567';

async function apiAuth(path: string, body: Record<string, string>): Promise<{ token: string; username: string; displayName: string }> {
  const res = await fetch(`${API}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Auth failed');
  return data;
}

/** Resume saved session or show login overlay */
export function initLogin(onComplete: (username: string, displayName: string) => void): void {
  const savedUser = localStorage.getItem(STORAGE_USER)?.trim();
  const savedDisplay = localStorage.getItem(STORAGE_DISPLAY)?.trim();
  const savedToken = localStorage.getItem(STORAGE_TOKEN)?.trim();

  if (savedUser && savedToken) {
    void (async () => {
      try {
        const res = await fetch(`${API}/api/auth/session`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        if (!res.ok) throw new Error('session invalid');
        clearIconVerifySession();
        gameState.username = savedUser;
        gameState.displayName = savedDisplay || savedUser;
        gameState.authToken = savedToken;
        onComplete(savedUser, gameState.displayName);
      } catch {
        clearSavedLogin();
        showLoginScreen(onComplete);
      }
    })();
    return;
  }

  showLoginScreen(onComplete);
}

export function showLoginScreen(onComplete: (username: string, displayName: string) => void): void {
  document.getElementById('login-overlay')?.remove();

  let mode: 'login' | 'register' = 'login';

  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:#1a1025ee;z-index:9999;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:'Courier New',monospace;color:#ffcc88;
  `;

  const render = (): void => {
    overlay.innerHTML = `
      <h1 style="font-size:18px;margin-bottom:8px;">Witchcraft Sim</h1>
      <div style="display:flex;gap:4px;margin-bottom:12px;">
        <button id="tab-login" style="padding:6px 16px;cursor:pointer;border:1px solid #8866aa;background:${mode === 'login' ? '#442200' : '#221133'};color:${mode === 'login' ? '#fc8' : '#aaa'};">Sign In</button>
        <button id="tab-register" style="padding:6px 16px;cursor:pointer;border:1px solid #8866aa;background:${mode === 'register' ? '#113322' : '#221133'};color:${mode === 'register' ? '#8c8' : '#aaa'};">Register</button>
      </div>
      <p style="font-size:11px;color:#aaa;margin-bottom:12px;max-width:280px;text-align:center;">
        ${mode === 'login'
          ? 'Sign in with your username and password.'
          : 'Choose a permanent display name (letters only). It cannot be changed later.'}
      </p>
      <input id="login-username" placeholder="Username (letters only)" style="padding:8px;margin:4px;width:240px;background:#221133;border:1px solid #8866aa;color:#fff;" />
      ${mode === 'register' ? `
        <input id="login-display" placeholder="Display name (letters only)" style="padding:8px;margin:4px;width:240px;background:#221133;border:1px solid #8866aa;color:#fff;" />
      ` : ''}
      <input id="login-password" type="password" placeholder="Password (min 6 chars)" style="padding:8px;margin:4px;width:240px;background:#221133;border:1px solid #8866aa;color:#fff;" />
      <div id="login-err" style="color:#f88;font-size:10px;min-height:16px;margin-top:8px;max-width:240px;text-align:center;"></div>
      <button id="login-submit" style="padding:8px 20px;margin-top:8px;background:${mode === 'login' ? '#442200' : '#113322'};border:1px solid ${mode === 'login' ? '#fc8' : '#8c8'};color:${mode === 'login' ? '#fc8' : '#8c8'};cursor:pointer;">
        ${mode === 'login' ? 'Sign In' : 'Create Account'}
      </button>`;

    bindDomInputs(overlay);

    document.getElementById('tab-login')!.onclick = () => { mode = 'login'; render(); };
    document.getElementById('tab-register')!.onclick = () => { mode = 'register'; render(); };

    const displayInput = document.getElementById('login-display') as HTMLInputElement | null;
    if (displayInput) {
      displayInput.addEventListener('input', () => {
        const formatted = formatDisplayName(displayInput.value);
        if (displayInput.value !== formatted) displayInput.value = formatted;
      });
    }

    const userInput = document.getElementById('login-username') as HTMLInputElement;
    userInput.addEventListener('input', () => {
      const normalized = normalizeUsername(userInput.value);
      if (userInput.value !== normalized) userInput.value = normalized;
    });

    document.getElementById('login-submit')!.onclick = () => void submit();
  };

  const finish = (username: string, displayName: string, token: string): void => {
    clearIconVerifySession();
    localStorage.setItem(STORAGE_USER, username);
    localStorage.setItem(STORAGE_DISPLAY, displayName);
    localStorage.setItem(STORAGE_TOKEN, token);
    gameState.username = username;
    gameState.displayName = displayName;
    gameState.authToken = token;
    overlay.remove();
    onComplete(username, displayName);
  };

  const submit = async (): Promise<void> => {
    const errEl = document.getElementById('login-err')!;
    const username = normalizeUsername((document.getElementById('login-username') as HTMLInputElement).value);
    const password = (document.getElementById('login-password') as HTMLInputElement).value;

    const userErr = validateUsername(username);
    if (userErr) { errEl.textContent = userErr; return; }
    if (!password || password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

    if (mode === 'login') {
      try {
        const r = await apiAuth('login', { username, password });
        finish(r.username, r.displayName, r.token);
      } catch (e) {
        errEl.textContent = String(e);
      }
      return;
    }

    const displayName = formatDisplayName((document.getElementById('login-display') as HTMLInputElement)?.value ?? '');
    const displayErr = validateDisplayName(displayName);
    if (displayErr) { errEl.textContent = displayErr; return; }

    try {
      const r = await apiAuth('register', { username, password, displayName });
      finish(r.username, r.displayName, r.token);
    } catch (e) {
      errEl.textContent = String(e);
    }
  };

  document.body.appendChild(overlay);
  render();
}

export function clearSavedLogin(): void {
  localStorage.removeItem(STORAGE_USER);
  localStorage.removeItem(STORAGE_DISPLAY);
  localStorage.removeItem(STORAGE_TOKEN);
}
