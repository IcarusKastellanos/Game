/** Shared ledger imagery. Visual rules live in character-sheet.css and ledger-overlay.css. */
export const LEDGER_ART = '/assets/ui/aura-screen';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function ledgerOrnaments(): string {
  return `
    <img class="ledger-circle" src="${LEDGER_ART}/occult-circle-background.png" alt="" />
    <img class="ledger-filigree ledger-filigree--tl" src="${LEDGER_ART}/corner-filigree.png" alt="" />
    <img class="ledger-filigree ledger-filigree--tr" src="${LEDGER_ART}/corner-filigree.png" alt="" />`;
}

/** Full-screen reading page used by conversation and shop counters. */
export function ledgerOverlayShell(opts: { kicker: string; title: string; subtitle?: string; foot: string }): string {
  const subtitle = opts.subtitle
    ? `<p class="ledger-type">${escapeHtml(opts.subtitle)}</p>`
    : '<p class="ledger-type"></p>';
  return `
    <div class="ledger-veil" data-ledger-close></div>
    <div class="ledger-frame" role="dialog" aria-modal="true" aria-label="${escapeHtml(opts.title)}">
      ${ledgerOrnaments()}
      <header class="ledger-head">
        <img class="ledger-head__ornament" src="${LEDGER_ART}/aura-header-decoration.png" alt="" />
        <p class="ledger-kicker">${escapeHtml(opts.kicker)}</p>
        <h1>${escapeHtml(opts.title)}</h1>
        ${subtitle}
        <button type="button" class="ledger-close" data-ledger-close aria-label="Close">
          <img src="${LEDGER_ART}/aura-close-frame.png" alt="" />
        </button>
      </header>
      <div class="ledger-scroll"></div>
      <footer class="ledger-foot">
        <img src="${LEDGER_ART}/bottom-moon-ornament.png" alt="" />
        <p>${escapeHtml(opts.foot)}</p>
      </footer>
    </div>`;
}
