const API = '/admin/api/v1';

let token = localStorage.getItem('admin_token') ?? '';

export function setToken(t: string): void {
  token = t;
  localStorage.setItem('admin_token', t);
}

export function clearToken(): void {
  token = '';
  localStorage.removeItem('admin_token');
}

export function getToken(): string {
  return token;
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers as Record<string, string>),
    },
  });
  if (res.status === 401) {
    clearToken();
    location.reload();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Request failed');
  }
  return res.json();
}

export async function login(username: string, password: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error ?? 'Invalid username or password');
  return data as { token: string; session: unknown };
}

export async function getMe() {
  return api<{ session: { username: string; displayName: string; permissions: string[]; roles: string[] } }>('/auth/me');
}
