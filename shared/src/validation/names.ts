/** Letters-only username (lowercase, min 3) */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z]/g, '');
}

export function validateUsername(username: string): string | null {
  if (username.length < 3) return 'Username must be at least 3 letters.';
  if (!/^[a-z]+$/.test(username)) return 'Username may only contain letters (no numbers).';
  return null;
}

/** Title-case each word; letters and spaces only */
export function formatDisplayName(raw: string): string {
  return raw
    .replace(/[^a-zA-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function validateDisplayName(name: string): string | null {
  if (name.length < 2) return 'Display name must be at least 2 characters.';
  if (!/^[A-Za-z]+(\s[A-Za-z]+)*$/.test(name)) {
    return 'Display name may only contain letters and spaces (no numbers).';
  }
  return null;
}
