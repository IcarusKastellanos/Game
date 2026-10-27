/** Replace whole filtered words with a fixed mask. Matching is case-insensitive. */
export function censorWords(message: string, words: readonly string[]): string {
  const terms = [...words]
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .sort((a, b) => b.length - a.length);
  if (!terms.length || !message) return message;

  let out = message;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    out = out.replace(pattern, (_match, lead: string) => `${lead}****`);
  }
  return out;
}
