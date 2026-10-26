import Phaser from 'phaser';
import type { MagicTradition, PlayerStats, StatDisplayKey } from '@witchcraft/shared';
import {
  MAGIC_SYSTEMS,
  STAT_DESCRIPTIONS,
  STAT_GROUPS,
  STAT_LABELS,
  STAT_VALUE_BADGES,
  defaultProgression,
  getLevelProfile,
  getLevelRankLabel,
  getLevelTitle,
  getLicense,
  getMaxPlayerLevel,
  getPractitionerType,
  getRecognitionTierLabel,
  getVow,
  holdsActiveLicense,
  isTechnicalSkillKey,
  magicalEnergyCap,
  playerLevel,
  practitionerXpProgress,
  resolveStatMax,
  resolveStatValue,
  skillXpProgress,
  spiritRangeForLevel,
  type PlayerProgression,
} from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { parseStats } from './aura/AuraViewModel';

const ART = '/assets/ui/aura-screen';

const ICONS: Record<StatDisplayKey, string> = {
  health: 'health',
  hunger: 'hunger',
  stamina: 'stamina',
  magicalEnergy: 'magical-energy',
  intuition: 'intuition',
  awareness: 'awareness',
  willpower: 'willpower',
  memory: 'memory',
  presence: 'presence',
  authority: 'authority',
  mediumship: 'mediumship',
  ritualSkill: 'ritual-skill',
  protection: 'protection',
  hexWork: 'hex-work',
  healing: 'healing',
  herbalism: 'herbalism',
  divination: 'divination',
  potionMaking: 'potion-making',
  spiritNegotiation: 'spirit-negotiation',
};

const GROUP_COPY: Record<'core' | 'mental' | 'technical', { title: string; lead: string }> = {
  core: {
    title: 'The body',
    lead: 'What keeps you standing through a working — vitality, hunger, stamina, and the reserve you spend.',
  },
  mental: {
    title: 'The mind',
    lead: 'How you notice, remember, and hold a room. These shape the Intuition Meter and spirit conversation.',
  },
  technical: {
    title: 'The craft',
    lead: 'Practiced skills. Each point is earned; the thin bar beneath is skill practice toward the next.',
  },
};

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function signed(n: number): string {
  const v = Math.round(n);
  return v > 0 ? `+${v}` : String(v);
}

function tone(n: number): string {
  if (n > 8) return 'good';
  if (n < -8) return 'bad';
  return '';
}

function publicStanding(n: number): string {
  if (n >= 40) return 'The town speaks of you kindly. Doors and counters open more easily.';
  if (n >= 12) return 'You are a familiar face. Most shopkeepers will still take your coin.';
  if (n > -12) return 'Most people have not decided what to make of you yet.';
  if (n > -40) return 'Rumors travel ahead of you. A few merchants grow cold when you enter.';
  return 'The street treats you as trouble. Some will refuse to trade at all.';
}

function spiritualStanding(n: number): string {
  if (n >= 40) return 'Circles and temples know your name. Rare doors consider you.';
  if (n >= 12) return 'You are taken seriously among practitioners, if not yet trusted with secrets.';
  if (n > -12) return 'The occult community has barely marked you. Study and clean work will change that.';
  if (n > -40) return 'Word in the circles is uneasy. Mentors may hesitate.';
  return 'You are spoken of as a risk. Spiritual doors stay shut until you repair this.';
}

function moralityLine(score: number): { label: string; text: string } {
  if (score >= 25) return { label: 'Benevolent', text: 'Your workings lean toward mending and protection.' };
  if (score <= -25) return { label: 'Malevolent', text: 'Your workings lean toward harm. Vows notice this.' };
  return { label: 'Neutral', text: 'Your moral weight has not settled firmly to either hand.' };
}

function statusWord(status: string | undefined): { word: string; cls: string } {
  if (status === 'warned') return { word: 'Council warning', cls: 'warn' };
  if (status === 'revoked') return { word: 'Revoked', cls: 'bad' };
  return { word: 'Good standing', cls: 'good' };
}

/** Practitioner ledger — identity, standing, credentials, and attributes. Separate from Aura [Y]. */
export class CharacterSheet {
  private root: HTMLDivElement;
  private visible = false;
  private lastFocused: HTMLElement | null = null;

  constructor(_scene: Phaser.Scene) {
    this.root = document.createElement('div');
    this.root.id = 'character-sheet';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Practitioner ledger');
    document.body.appendChild(this.root);
    this.hide();
    window.addEventListener('game:player-sync', this.onRefresh);
    window.addEventListener('game:player-loaded', this.onRefresh);
    window.addEventListener('game:progression-update', this.onRefresh);
  }

  private onRefresh = (): void => {
    if (this.visible) this.render();
  };

  show(): void {
    this.lastFocused = document.activeElement as HTMLElement | null;
    this.visible = true;
    this.root.classList.add('is-open');
    window.addEventListener('keydown', this.onKeyDown);
    this.render();
    this.root.querySelector<HTMLElement>('.ledger-scroll')?.focus();
  }

  hide(): void {
    this.visible = false;
    this.root.classList.remove('is-open');
    this.root.innerHTML = '';
    window.removeEventListener('keydown', this.onKeyDown);
    if (gameState.activeUI === 'ledger') gameState.activeUI = 'none';
    if (this.lastFocused && document.contains(this.lastFocused)) this.lastFocused.focus();
    this.lastFocused = null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
    }
  };

  private render(): void {
    const stats = parseStats(gameState.localPlayer?.statsJson);
    const progression = (gameState.progression ?? defaultProgression()) as PlayerProgression;
    const name = gameState.displayName ?? 'Practitioner';
    const xp = stats.experience ?? 0;
    const level = playerLevel(xp);
    const progress = practitionerXpProgress(xp);
    const max = getMaxPlayerLevel();
    const profile = getLevelProfile(level);
    const spirits = spiritRangeForLevel(level);
    const tier = progression.recognitionTierLabel || getRecognitionTierLabel(progression.recognitionTierId);
    const typeLine = getPractitionerType(stats, tier);
    const pub = Math.round(stats.publicReputation ?? stats.reputation ?? 0);
    const spi = Math.round(stats.spiritualReputation ?? 0);
    const morality = this.moralityScore(stats);
    const moral = moralityLine(morality);
    const xpFill = Math.round(progress.ratio * 100);
    const xpCaption = progress.isMaxLevel
      ? `Practitioner Level ${level} of ${max} — the present curve ends here.`
      : `${progress.xpIntoLevel} of ${progress.xpToNext} experience toward Level ${level + 1}.`;

    this.root.innerHTML = `
      <div class="ledger-veil" data-close="1"></div>
      <article class="ledger-frame">
        <img class="ledger-circle" src="${ART}/occult-circle-background.png" alt="" draggable="false" />
        <img class="ledger-filigree ledger-filigree--tl" src="${ART}/corner-filigree.png" alt="" draggable="false" />
        <img class="ledger-filigree ledger-filigree--tr" src="${ART}/corner-filigree.png" alt="" draggable="false" />
        <header class="ledger-head">
          <img class="ledger-head__ornament" src="${ART}/aura-header-decoration.png" alt="" draggable="false" />
          <p class="ledger-kicker">Practitioner ledger</p>
          <h1>${esc(name)}</h1>
          <p class="ledger-rank">${esc(getLevelRankLabel(level))} · ${esc(getLevelTitle(level))}</p>
          <p class="ledger-type">${esc(typeLine)}</p>
          <button type="button" class="ledger-close" id="ledger-close" aria-label="Close ledger" title="Close (Esc)">
            <img src="${ART}/aura-close-frame.png" alt="" draggable="false" />
          </button>
        </header>
        <div class="ledger-scroll" tabindex="-1">
          ${this.identityHtml(level, max, xpFill, xpCaption, profile?.unlockMessage, spirits)}
          ${this.standingHtml(pub, spi, moral, morality)}
          ${this.credentialsHtml(progression)}
          ${this.attributesHtml(stats, progression)}
          ${this.affinitiesHtml(stats)}
          ${this.recordHtml(progression)}
        </div>
        <footer class="ledger-foot">
          <img src="${ART}/bottom-moon-ornament.png" alt="" draggable="false" />
          <p>Click your name or press <kbd>Y</kbd> to open this ledger. Aura &amp; Wards stays on <kbd>X</kbd>. Esc closes.</p>
        </footer>
      </article>`;

    this.root.querySelector('#ledger-close')?.addEventListener('click', () => this.hide());
    this.root.querySelector('.ledger-veil')?.addEventListener('click', () => this.hide());
  }

  private moralityScore(stats: PlayerStats): number {
    try {
      const raw = gameState.localPlayer?.auraJson;
      if (raw) {
        const aura = JSON.parse(raw) as { moralityScore?: number };
        if (Number.isFinite(aura.moralityScore)) return Math.round(aura.moralityScore as number);
      }
    } catch {
      /* stats fallback */
    }
    return Math.round(stats.morality ?? 0);
  }

  private identityHtml(
    level: number,
    max: number,
    xpFill: number,
    caption: string,
    unlockMessage: string | undefined,
    spirits: { label: string; minPower: number; maxPower: number; notes?: string }
  ): string {
    const note = unlockMessage?.trim();
    return `
      <section class="ledger-section">
        <h2><span class="mark">◆</span> Where you stand</h2>
        <img class="ledger-rule" src="${ART}/panel-divider.png" alt="" />
        <p class="ledger-lead">Level is practice, not a job title. Recognition is what the establishment will call you. They move separately.</p>
        <div class="ledger-level">
          <div class="ledger-level__meta">
            <span>Practitioner Level</span>
            <strong>${level} <em>/ ${max}</em></strong>
          </div>
          <div class="ledger-bar" role="meter" aria-valuenow="${xpFill}" aria-valuemin="0" aria-valuemax="100">
            <span style="width:${xpFill}%"></span>
          </div>
          <p>${esc(caption)}</p>
        </div>
        ${note ? `<p class="ledger-whisper">${esc(note)}</p>` : ''}
        <p class="ledger-aside"><span class="k">Spirits who answer</span> ${esc(spirits.label || '—')}
          ${spirits.label ? `<span class="dim">· power ${spirits.minPower}–${spirits.maxPower}</span>` : ''}
          ${spirits.notes ? `<br/><span class="dim">${esc(spirits.notes)}</span>` : ''}
        </p>
      </section>`;
  }

  private standingHtml(
    pub: number,
    spi: number,
    moral: { label: string; text: string },
    morality: number
  ): string {
    return `
      <section class="ledger-section">
        <h2><span class="mark">◆</span> How you are known</h2>
        <img class="ledger-rule" src="${ART}/panel-divider.png" alt="" />
        <p class="ledger-lead">Public reputation is the street. Spiritual reputation is the circles. A high score in one does not buy the other.</p>
        <div class="ledger-pair">
          <article>
            <header><span class="k">Public</span><strong class="${tone(pub)}">${signed(pub)}</strong></header>
            <p>${esc(publicStanding(pub))}</p>
          </article>
          <article>
            <header><span class="k">Spiritual</span><strong class="${tone(spi)}">${signed(spi)}</strong></header>
            <p>${esc(spiritualStanding(spi))}</p>
          </article>
        </div>
        <article class="ledger-moral">
          <img src="${ART}/protection-node.png" alt="" />
          <div>
            <p class="k">Moral weight · ${esc(moral.label)} (${signed(morality)})</p>
            <p>${esc(moral.text)}</p>
          </div>
        </article>
      </section>`;
  }

  private credentialsHtml(progression: PlayerProgression): string {
    const ids = [
      ...new Set([
        ...(progression.earnedLicenses ?? []),
        ...Object.keys(progression.licensureMarks ?? {}),
      ]),
    ];
    if (!ids.length) {
      return `
        <section class="ledger-section">
          <h2><span class="mark">◆</span> Magical Council</h2>
          <img class="ledger-rule" src="${ART}/panel-divider.png" alt="" />
          <p class="ledger-lead">No seal is affixed to your name.</p>
          <p>Clerk Maris Vale keeps the ledger near the study circle. An exam costs coin, reads your level, recognition, skills, and morality, and binds a vow. Until then, credential workings and rooms stay closed.</p>
        </section>`;
    }

    const cards = ids
      .map((id) => {
        const def = getLicense(id);
        const marks = progression.licensureMarks?.[id];
        const active = holdsActiveLicense(progression, id);
        const status = statusWord(active ? marks?.status : 'revoked');
        const cap = marks?.markCapacity ?? def?.markCapacity ?? 10;
        const left = marks?.marks ?? 0;
        const pct = cap > 0 ? Math.round((left / cap) * 100) : 0;
        const vow = getVow(progression.activeVows?.[id]?.vowId ?? def?.vowId);
        const label = def?.label ?? id.replace(/_/g, ' ');
        return `
          <article class="ledger-seal ${status.cls}">
            <header>
              <h3>${esc(label)}</h3>
              <span class="pill">${esc(status.word)}</span>
            </header>
            <p class="ledger-marks"><span class="k">Licensure Marks</span> <strong>${left}</strong> of ${cap}</p>
            <div class="ledger-bar ledger-bar--marks" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
              <span style="width:${pct}%"></span>
            </div>
            ${
              vow
                ? `<blockquote><span class="k">${esc(vow.label)}</span>${esc(vow.text)}</blockquote>`
                : '<p class="dim">No vow is currently bound to this seal.</p>'
            }
            ${
              !active
                ? '<p class="dim">This credential is revoked. The clerk will hear a re-examination when you qualify again.</p>'
                : ''
            }
          </article>`;
      })
      .join('');

    return `
      <section class="ledger-section">
        <h2><span class="mark">◆</span> Magical Council</h2>
        <img class="ledger-rule" src="${ART}/panel-divider.png" alt="" />
        <p class="ledger-lead">A license is stronger than a title. The vow is the price. Marks fall when you work against it, and return when you practice inside it.</p>
        <div class="ledger-seals">${cards}</div>
      </section>`;
  }

  private attributesHtml(stats: PlayerStats, progression: PlayerProgression): string {
    const groups = (['core', 'mental', 'technical'] as const)
      .map((group) => {
        const copy = GROUP_COPY[group];
        const rows = STAT_GROUPS[group]
          .map((key) => this.statRow(key, stats, progression))
          .join('');
        return `
          <div class="ledger-group">
            <h3>${esc(copy.title)}</h3>
            <p class="ledger-lead">${esc(copy.lead)}</p>
            <div class="ledger-stats">${rows}</div>
          </div>`;
      })
      .join('');
    return `
      <section class="ledger-section">
        <h2><span class="mark">◆</span> Attributes</h2>
        <img class="ledger-rule" src="${ART}/panel-divider.png" alt="" />
        ${groups}
      </section>`;
  }

  private statRow(key: StatDisplayKey, stats: PlayerStats, progression: PlayerProgression): string {
    const value = Math.round(resolveStatValue(stats, key));
    const max = resolveStatMax(stats, key);
    const badge = STAT_VALUE_BADGES[key];
    const shown = max != null ? `${value} / ${Math.round(max)}` : String(value);
    const meCap = key === 'magicalEnergy' ? magicalEnergyCap(stats.experience ?? 0) : null;
    const valueText = meCap != null ? `${Math.round(stats.magicalEnergy)} / ${meCap}` : shown;
    let practice = '';
    if (isTechnicalSkillKey(key)) {
      const prog = skillXpProgress(progression, stats, key);
      const pct = Math.round(prog.ratio * 100);
      practice = `
        <div class="ledger-bar ledger-bar--skill" role="meter" aria-label="Skill practice" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${pct}%"></span>
        </div>
        <p class="dim">Practice ${prog.xp} / ${prog.xpToNext}</p>`;
    }
    return `
      <article class="ledger-stat">
        <img src="${ART}/icons/${ICONS[key]}.png" alt="" />
        <div>
          <header>
            <h4>${esc(STAT_LABELS[key])}</h4>
            <strong>${badge ? `<span class="badge">${esc(badge)}</span>` : ''}${esc(valueText)}</strong>
          </header>
          <p>${esc(STAT_DESCRIPTIONS[key])}</p>
          ${practice}
        </div>
      </article>`;
  }

  private affinitiesHtml(stats: PlayerStats): string {
    const entries = (Object.keys(MAGIC_SYSTEMS) as MagicTradition[]).map((id) => {
      const sys = MAGIC_SYSTEMS[id];
      const value = Math.round(stats.affinities?.[id] ?? 0);
      const specialty = stats.specialty === id;
      const width = Math.max(0, Math.min(100, value));
      return `
        <article class="ledger-affinity ${specialty ? 'is-specialty' : ''} ${sys.enabled ? '' : 'is-closed'}">
          <header>
            <h3>${esc(sys.label)}${specialty ? ' <span class="pill">Specialty</span>' : ''}</h3>
            <strong>${value}</strong>
          </header>
          <div class="ledger-bar" role="meter" aria-valuenow="${width}" aria-valuemin="0" aria-valuemax="100"><span style="width:${width}%"></span></div>
          <p>${esc(sys.description)}${sys.enabled ? '' : ' This tradition is not yet open in the world.'}</p>
        </article>`;
    });
    const specialtyNote = stats.specialty
      ? `Your specialty is ${MAGIC_SYSTEMS[stats.specialty].label}. Affinity in that path rises a little faster.`
      : 'You have not chosen a specialty. When an affinity climbs high enough, the world will offer the choice.';
    return `
      <section class="ledger-section">
        <h2><span class="mark">◆</span> Traditions</h2>
        <img class="ledger-rule" src="${ART}/panel-divider.png" alt="" />
        <p class="ledger-lead">${esc(specialtyNote)}</p>
        <div class="ledger-affinities">${entries.join('')}</div>
      </section>`;
  }

  private recordHtml(progression: PlayerProgression): string {
    const quests = Object.values(progression.questProgress ?? {}).filter((q) => q.completedAt).length;
    const books = progression.readBooks?.length ?? 0;
    const notes = progression.discoveredCorrespondences?.length ?? 0;
    const recent = [...(progression.recentXp ?? [])].slice(-6).reverse();
    const recentHtml = recent.length
      ? `<ul class="ledger-recent">${recent
          .map(
            (row) =>
              `<li><span class="gain">+${row.amount}</span> ${esc(row.label)}${
                row.levelAfter > row.levelBefore ? ' <span class="pill">level</span>' : ''
              }</li>`
          )
          .join('')}</ul>`
      : '<p class="dim">No recent workings are written here yet.</p>';
    const familiar = gameState.familiar?.chosen
      ? gameState.familiar.publicName || gameState.familiar.species || 'A familiar walks with you.'
      : 'No familiar is linked.';

    return `
      <section class="ledger-section">
        <h2><span class="mark">◆</span> What you have done</h2>
        <img class="ledger-rule" src="${ART}/panel-divider.png" alt="" />
        <ul class="ledger-facts">
          <li><span class="k">Quests finished</span><strong>${quests}</strong></li>
          <li><span class="k">Books read</span><strong>${books}</strong></li>
          <li><span class="k">Correspondences noted</span><strong>${notes}</strong></li>
          <li><span class="k">Familiar</span><strong>${esc(familiar)}</strong></li>
        </ul>
        <h3>Recent practice</h3>
        ${recentHtml}
      </section>`;
  }
}
