# -Witchcraft Sim — Development TODO

## What's next (planned)

### Immediate / polish

- [x] **Full altar ritual VFX** — candle smoke / richer cast effects (flash exists today)
- [x] **User-verify inventory** — confirm no duplicate stacks after grid coalesce + admin give/remove
- [x] **Skill XP pools** — per-technical-stat progression (Aura screen shows values only today)
- [x] **Eating activity** — wire food consumption to `eating` survival state for stamina regen



### HUD follow-ups

- ~~Wire remaining HUD elements from admin layout JSON (nav, resources, moon panel)~~ — discarded
- [x] Store intuition meter offset relative to player-status in layout editor (not absolute canvas coords)
- [x] Pocket spell completion → "Working Complete" toast (spells only today; hexagram/craft use "Notice")



### Phase 1 — Milestone A (foundation)

1. ~~Stats expansion + migration (`stamina`, mental stats)~~ — done (`extendedStats` + load-time backfill)
2. ~~Reputation split (`publicReputation` / `spiritualReputation`) + content files~~ — done
3. ~~XP source registry + central `grantExperience()`~~ — done (`content/progression/xp-sources.json` + shared `grantExperience`)
4. ~~Practitioner Level curve (max 10) + `minLevel` gates~~ — done (`level-curve.json`)

### Phase 1 — Milestone B (next)

5. ~~Recognition tiers + licenses + dialogue/vendor gates~~ — done (`recognition-tiers.json` + `evaluateRecognition`)
6. **Licensure Marks & credentialed practice** — see §1.3b (spell/spirit/NPC/place gates, examiner NPC, vows, council discipline)
7. Character sheet UI (full sheet)
8. Then Milestone C — Grimoire

See **Phase 1** below for the full practitioner framework roadmap.

---



## Recently completed ✅ (sessions after v0.3)



### Map builder & inventory

- [x] Altar as map-builder furniture (`furn_altar`) — legacy `altar_main` removed from canonical map
- [x] Furniture interaction zones (altar/shop/crafting/door/ward) via map editor
- [x] Inventory grid fixes — coalesce stacks, BigInt `slotIndex`, schema serialization
- [x] Admin player manager — grid-based `giveItem` + `removeInventorySlot` (no success pop-up on give)



### Hexagram Enchanting

- [x] Hexagram enchanting system — separate from altar; socket/augment/declaration UI
- [x] `content/hexagram-recipes.json` + server handlers + admin recipe CRUD



### Practitioner HUD

- [x] Modular practitioner HUD (`client/src/ui/hud/`) — player panel, nav, resources, moon, notifications, windows
- [x] HUD auto-fit scaling via `--hud-scale` + collapsed/expanded footprints
- [x] Intuition meter (magical eye) — detection-driven states, particles, reduced-motion
- [x] Morality gauge on nameplate (live `moralityScore` from aura)
- [x] Intuition meter stickied to nameplate (scales with portrait at any window size)
- [x] HUD layout admin editor — shared schema, Prisma models, CRUD/publish/versions, live sync
- [x] Teleport spell sequence — blue magical departure/arrival for HUD teleports only (not door travel)
- [x] Aura & Wards screen — two-column UI, canvas layers, overview, pip bars, ward feed, loading state
- [x] Progression content loader — `stats.json`, `stat-labels.json`, `focus-weights.json`, `books.json` hydrated at server boot
- [x] Spell focus weights — `calculateSpellFocus()` from content; spell-engine uses mental + technical stats
- [x] Bed rest — apartment `bed` interactable, server `sleeping` survival tick (stamina + health + ME bonus)
- [x] `extendedStats` Prisma column — regenerate client (`npm run db:generate`); push with `npm run db:push` if DB is behind

---

- [x] Monorepo structure (client / server / shared)
- [x] Prisma schema for players, stats, inventory, familiars, wards, auras, content
- [x] JSON content registries (ingredients, spells, shops, NPCs, maps, etc.)
- [x] Colyseus GameRoom with movement, interact, spellcast, shop, familiar care
- [x] Modular SpellEngine with Traditional European spells
- [x] Phaser apartment + town scenes with procedural 16-bit tiles
- [x] Altar, inventory, shop, aura, familiar UI prototypes
- [x] Admin content reload + spell CRUD API
- [x] Expansion stubs (Coven, Astral)

---



## v0.2 — Core Gameplay Polish ✅ (prototype complete)



### Persistence

- [x] Save/load player from PostgreSQL on join/leave (`player-service.ts` + `GameRoom`)
- [x] Sync apartment decorations to DB on place
- [x] Spell cast history logging (`SpellCast` table)



### Altar System

- [x] Ritual component placement onto altar slots (inventory click-to-add)
- [x] Intent selection (protection, cleansing, etc.) via spell category + hex intents
- [x] Timing selection (dawn, dusk, moon phases — simplified)
- [x] Altar decoration buff calculation (`altar-buffs.ts`)
- [x] Drag-and-drop ritual UI (5 pentacle circle slots + augments)
- [x] Spell ME cost display (with ingredients vs raw magic)
- [x] Cast VFX flash on successful working
- [x] Visual candle/herb/incense sprites on altar (ambiance row + right-click place)
- [x] **Pocket-Spells** — prepare at Enchanting Table recipes; Quick Cast via target panel



### Taglock System

- [x] Taglock inventory items (hair, written name, personal item in `ingredients.json`)
- [x] Taglock selection + player target UI in altar panel
- [x] Social bond taglock from friend/rival relationships (server validation)



### Multiplayer Interaction

- [x] Visit another player's apartment (friends only — host invite teleports both)
- [x] Friend system (online/offline, level, practitioner type) [P]
- [x] Trade interface (nearby or distant with friends)
- [x] Whisper distant friends
- [x] Detect incoming magic (high Intuition notification on targeted spells)
- [x] Inspect another player's aura (depth gating in `AuraPanel`)



### NPCs & Quests

- [x] Dialogue tree renderer (`DialoguePanel` + `content/dialogues.json`)
- [x] Dialogue stat boosts and item grants from choices
- [x] Admin NPC Builder (JSON editor for NPC + dialogue tree)
- [x] NPC schedules (world hour + hide/show interactables + shopkeeper away messages)
- [x] Relationship level progression (persisted per NPC in `Player.progression`)
- [x] Study circle group events (18:00 notification + active ContentEvent hook)
- [x] First Questline: `quest_first_steps` — cast `healing_charm` at altar



### Wards

- [x] Place wards at apartment ward points (`WardPanel` + `place_ward`)
- [x] Ward decay/maintenance tick on server (30s interval)
- [x] Household Ward spell adds perimeter ward via altar or threshold
- [x] Ward feeding UI on apartment map (`WardMapHud` — bottom-left feed panel)
- [x] Ward feeding UI on Aura screen (ME cost; Everweed bind at cast only)
- [x] Layered ward visualization (perimeter overlay + aura canvas rings + ward point markers)
- [x] Ambient household protection on player aura + familiar while in apartment
- [x] Ward persistence (feed/decay/break syncs to DB)



### Login & Setup

- [x] Login / Register tabs with password auth (`LoginScreen.ts`)
- [x] Display name set at register only (letters only, title case, permanent)
- [x] Username letters only, no numbers
- [x] Docker Compose for PostgreSQL (`docker-compose.yml`)



### Decoration

- [x] Apartment decoration placement mode removed (player-owned place/rotate/remove HUD deleted)



### Familiars

- [x] Familiar chooser with true/faux names
- [x] Feed requires Familiar Food · Bond 6h cooldown · Heal costs 3 ME (+1) · Protect requires Familiar Knot
- [x] **Enchant Familiar Knot** — Enchanting Table recipes; metadata boosts protect strength/duration
- [x] Familiar protection web (personal knot wards on familiar panel + aura view)
- [x] Familiar aura linked to environmental/player ward web (full cross-link)
- [x] Household ambient wards protect all apartment entrants (including familiar)



### Progression

- [x] Book reading mini-interface (stat XP) — right-click book in inventory
- [x] Correspondence discovery journal — [J] key, discoveries from books/craft/experiment
- [x] Specialty selection at affinity threshold (≥25 affinity modal)
- [x] Reputation system with town NPCs (dialogue `relationshipDelta` → reputation)



### Art & Audio

- [x] Replace procedural tiles with sprite sheets — `tiles_atlas` in `SpriteGenerator`, used by `MapBuilder`
- [x] Character walk animations (8-direction) — procedural sprites in `SpriteGenerator`
- [x] Ritual VFX (altar cast flash + candle smoke / incense wisps on successful working)
- [x] Improved 16-bit graphics — unique NPC sprites, procedural item icons + admin 16×16 pixel editor (`iconPixels`)
- [x] Ambient audio (apartment, town, shop) — `AmbientAudio.ts` + scene/shop hooks

---



## v0.3 — Apartment & Crafting (almost complete)

- [x] Furniture placement grid with collision (footprint overlap check on place)
- [x] Wall/floor decoration layers (categories exist; wall-mount placement rules not enforced in HUD)
- [x] Crafting stations (potion shelf, mirror, enchanting table — interact + panels)
- [x] Ingredient experimentation (discover recipes/correspondences via ingredient combos)
- [x] Potion/oil crafting recipes in content registry (`content/recipes.json`)
- [ ] ~~Decoration HUD~~ — removed; apartment layout is map-builder furniture only

---



# Phase 1 — Core Progression & Practitioner Framework

Expand the game into a layered RPG where advancement comes from **knowledge, reputation, specialization, and social standing** — not combat grinding. Every gate (teachers, licenses, vendors, rituals, temples, organizations, story beats) should be driven by **content JSON**, not hardcoded checks.

### Design principles

- **Separate tracks, one character.** XP, level, recognition, and reputations advance independently but interact (e.g. high Spiritual Reputation + low Public Reputation = “known in the circles, feared on the street”).
- **Soft specialization.** Affinities and technical skills bias success; cross-tradition learning stays possible but costs more time/resources.
- **Discovery is progression.** Books, experiments, NPC dialogue, dreams, and failed castings all feed the Grimoire and unlock new content IDs.
- **Everything data-driven.** Stats, thresholds, unlock rules, recognition tiers, and Grimoire entry templates live in `content/` registries validated by `shared/`.



### Current baseline (what v0.2 already has)


| Area             | Today                                                        | Phase 1 target                                                           |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Experience       | `stats.experience` → `playerLevel()` (1–100)                 | Keep; rename UI to “Practitioner Level”; XP sources defined in content   |
| Reputation       | Single `stats.reputation` (−100…100), NPC dialogue deltas    | Split into Public / Spiritual / Coven / per-Spirit tracks                |
| Affinity         | `stats.affinities` per tradition; specialty modal at ≥25     | Affinity XP curve, tradition packs, cross-tradition penalties in content |
| Journal          | `[J]` Correspondence Journal (`discoveredCorrespondences[]`) | Evolve into full Grimoire with typed entries + player notes              |
| Skills           | Partial mental/technical stats on `PlayerStats`              | Complete attribute set; wire all into spell/craft/divination checks      |
| Recognition      | `getPractitionerType()` title string only                    | Formal recognition tiers with unlock tables                              |
| Progression blob | `Player.progression` JSON (quests, recipes, books, NPC rel)  | Extend with grimoire, licenses, spirit relations, recognition            |


---



## 1. Progression tracks (seven independent meters)

Each track has: **current value**, **tier/level label**, **history log** (optional), and **content-defined thresholds** for unlocks.

### 1.1 Experience (technical skill)

- [x] Define `content/progression/xp-sources.json` — actions that grant XP (read book, successful cast, craft, experiment, quest, teach NPC, coven rite, dream journal entry, etc.) with `{ actionId, baseXp, skillTags[], tradition?, cooldown? }`
- [x] Server `progression-handlers.ts`: central `grantExperience(player, sourceId, context)` — no inline XP numbers in handlers
- [x] XP contributes to **Practitioner Level** (`playerLevel`) and optionally to **technical skill** sub-XP pools (see §3)
- [x] UI: HUD shows level + XP bar to next level; character sheet shows recent XP sources



### 1.2 Character level (Practitioner Level)

- [x] Keep formula in `shared/src/balance/index.ts` but expose curve in `content/progression/level-curve.json` for admin tuning (**max Level 10**)
- [x] Level-up hook: fire `onLevelUp` content events (ME cap sync already via `syncLevelDerivedStats`)
- [x] Level gates: `{ minLevel }` on spells, recipes, hexagrams, vendors, quests (validated in content loader; map zones deferred). Familiars are **not** level-gated — any implemented species can be chosen at start.
- [x] Level-up notification + auto-derived protection (no manual stat-point allocation yet)



### 1.3 Practitioner recognition (society standing)

Recognition is **what the magical establishment acknowledges you as** — distinct from fame (public) or spirit favor.

- [x] Add `content/progression/recognition-tiers.json`:
  - Tiers e.g. `initiate`, `registered_practitioner`, `licensed_warder`, `certified_healer`, `recognized_seer`, `tradition_adept`, `temple_associate`, `covenant_holder`
  - Each tier: `{ id, label, requirements: { minLevel?, minSpiritualRep?, questsCompleted[], licenses[], npcRelationships{}, traditionAffinity{} }, unlocks: { vendors[], teachers[], rituals[], organizations[], storyFlags[] } }`
- [x] Persist `progression.recognitionTierId` + `progression.earnedLicenses[]` on player
- [x] Server: `evaluateRecognition(player)` on login and after quest/reputation/affinity changes
- [x] NPCs react to recognition tier (dialogue conditions in `dialogues.json`: `requiresRecognition`, `requiresLicense`)
- [x] Replace/augment `getPractitionerType()` display with tier label + optional specialty subtitle



### 1.3b Licensure Marks & Magical Council credentials (planned)

Formal credentials (Licensed Exorcist, Certified Healer, Certified Seer, Licensed Warder, hex/cursecraft credentials, etc.) are **stronger than recognition tiers**. A license gates content that only credentialed practitioners may use, and binds the holder to a professional vow enforced by Licensure Marks and the Magical Council.

#### Credential issuance (examiner NPC)

- [ ] Content: examiner / Magical Council clerk NPC(s) who **scan the player holistically** (level, recognition, spiritual rep, relevant skills, morality, prior vows)
- [ ] Exam flow: charge **money**, require a **vow** that binds the player’s reputation to that skill set (stored on progression)
- [ ] On pass: grant license id + initialize that license’s **Licensure Marks** pool; unlock credential story flags
- [ ] Content file e.g. `content/progression/licenses.json` — per license: `{ id, label, examNpcId, fee, vowId, requirements{}, markCapacity, warnAtMarks, revokeAtMarks, forbids[], allows[], unlocks: { spellIds[], spiritIds[], npcIds[], placeIds[] } }`

#### Content gates (credential-only)

- [ ] Spells: `{ requiresLicense: "certified_healer" }` (and/or `requiresAnyLicense[]`) — cast blocked without credential; altar UI treats like level-gate (visible, not selectable, tip explains license)
- [ ] Spirits: license-specific spirit contacts / offerings only for that credential
- [ ] NPCs: teachers, temple staff, council clerks gated by license
- [ ] Places / map zones: healer **office or temple**, seer **psychic tent**, warder **seal yard**, etc. (`requiresLicense` on interactables / map zones)

#### Professional vows & practice limits

- [ ] Each license defines practice rules, e.g.:
  - **Healers** must not harm (baneful / high malevolent moralDelta forbidden or heavily punished)
  - **Hex / curse workers** have **weak or blocked heals**
  - Seers / exorcists / warders: content-defined allow/forbid spell categories and effect tags
- [ ] Server enforces vow on cast / craft / spirit work (not only UI)

#### Licensure Marks & Magical Council discipline

- [ ] Persist `progression.licensureMarks: Record<licenseId, { marks, markCapacity, status: 'good'|'warned'|'revoked' }>`
- [ ] Going against your license **consumes Licensure Marks** (content-defined cost per violation)
- [ ] At `warnAtMarks`: Magical Council **warning** (notification + dialogue / letter)
- [ ] At `revokeAtMarks` (or marks exhausted): **license revoked** — lose credential gates until re-examination; spiritual / public reputation hit
- [ ] Optional: marks slowly recover with clean practice or council restitution quests

#### UI / admin (when built)

- [ ] Character sheet: licenses held, marks remaining, vow text, council standing
- [ ] Admin: license editor + examiner quest wiring



### 1.4 Public reputation (mundane world)

How townspeople, shopkeepers, and authorities perceive you.

- [x] Split `stats.reputation` → `stats.publicReputation` (migrate existing value on load)
- [x] Sources: helping/harming NPCs, visible magic in town, quest outcomes, morality extremes, gossip events
- [x] Content: `content/progression/reputation-public.json` — per-NPC faction weights, decay rules, rumor events
- [x] Effects: shop prices, refuse-trade at low public rep; access to mundane jobs / police/curfew hooks (future)
- [x] High public rep ≠ trusted in occult circles (intentional tension)



### 1.5 Spiritual reputation (occult community)

Standing among practitioners, lodges, study circles, and temple networks.

- [x] Add `stats.spiritualReputation` (−100…100 — documented in shared types; stored in `extendedStats`)
- [x] Sources: study circle / occult NPC dialogue, successful public workings, quest spiritual rewards, content sources for teaching/coven/library/cleanse
- [x] Gates: `rareVendorAbove` gates Everweed; mentor/temple/advancedRitual thresholds in content (wired via `meetsSpiritualGate`)
- [x] Rowan / study circle questline IDs award spiritual reputation on complete (heuristic + `rewards.spiritualReputation`)



### 1.6 Coven reputation (per-coven, post–Expansion 1)

- [ ] Design now, implement when CovenRoom exists: `progression.covenReputation: Record<covenId, number>`
- [ ] Shared types + content stub `content/progression/reputation-coven.json`
- [ ] Coven rep unlocks: grove upgrades, shared grimoire shelves, coven-only rituals, officer roles



### 1.7 Individual spirit reputation (per-entity)

Relationships with named spirits — separate from NPC human relationships.

- [ ] Add `content/spirits.json` — `{ id, name, tradition, domains[], defaultDisposition, offerings[] }`
- [ ] Persist `progression.spiritReputation: Record<spiritId, { trust, fear, debt, lastContact }>`
- [ ] Spirit work spells and offerings modify per-spirit rep; gates for possession, pact, information, curse reversal
- [ ] Grimoire auto-logs first contact, pact terms, and broken oaths
- [ ] Astral expansion hooks: spirits met in dream/astral planes use same rep table

---



## 2. Character attributes

Extend `PlayerStats` (and Prisma `PlayerStats` columns or JSON extension) in three groups. All caps, defaults, and level scaling in `content/progression/stats.json`.

### 2.1 Core (survival & casting fuel)


| Attribute      | Status               | Phase 1 work                                                                              |
| -------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Health         | ✅ exists             | Tick damage from hexes/parasites; food/rest recovery                                      |
| Hunger         | ✅ exists (underused) | Meal items, familiars-style decay tick, low-hunger debuffs to ME regen                    |
| Stamina        | ❌ new                | Physical actions: travel speed cap, ritual length before fumble, carrying heavy offerings |
| Magical Energy | ✅ exists             | Already level-scaled; tie max ME display to stamina for long rituals                      |


- [x] Add `stamina` to `PlayerStats`, `DEFAULT_STATS`, admin panel, Colyseus schema sync
- [x] Server tick: hunger ↓, stamina regen when idle/eating/sleeping (apartment bed interact)
- [x] Content debuffs: `{ belowHunger: 20, meRegenMultiplier: 0.5 }` etc.



### 2.2 Mental (perception, will, social magical presence)


| Attribute  | Status     | Maps from / notes                                                   |
| ---------- | ---------- | ------------------------------------------------------------------- |
| Intuition  | ✅          | Incoming magic detection (already)                                  |
| Awareness  | 🔄 rename? | Today: `spiritualAwareness` — rename or alias in content            |
| Willpower  | ❌          | Resist bindings, maintain focus under hex, long ritual stability    |
| Memory     | ❌          | Grimoire recall, re-cast without notes, exam quests                 |
| Presence   | ❌          | NPC first impressions, spirit attention, group ritual leadership    |
| Authority  | ❌          | Command spirits, enforce ward terms, coven officer actions          |
| Mediumship | ❌          | Spirit communication quality, astral perception, channeled dialogue |


- [x] Add missing stats to schema; migration preserves old saves via `normalizePlayerStats`
- [x] Spell focus formula in `spell-engine.ts`: pull weights from `content/progression/focus-weights.json` per spell category
- [x] Books grant mental stat XP in `BOOK_CONTENT` → move to `content/books.json`



### 2.3 Technical (craft & tradition skills)


| Attribute          | Status | Notes                                          |
| ------------------ | ------ | ---------------------------------------------- |
| Ritual Skill       | ✅      | Altar focus rolls                              |
| Protection         | ✅      | Level-derived + warding skill                  |
| Hex Work           | 🔄     | Today: `cursecraft` — content alias `hexWork`  |
| Healing            | ✅      |                                                |
| Herbalism          | ✅      |                                                |
| Divination         | 🔄     | Today: `divinationSkill`                       |
| Potion Making      | ❌      | Separate from herbalism — potion shelf success |
| Spirit Negotiation | ❌      | Pacts, offerings, banishment terms             |


- [ ] Optional: display names in UI differ from internal keys via `content/progression/stat-labels.json`
- [ ] Craft/cast success uses relevant technical stat + affinity bonus + recognition tier bonus
- [ ] Skill-specific XP sub-pools (optional): `{ ritualSkillXp }` that auto-increase skill on threshold

---



## 3. Affinity & tradition specialization

Players **naturally specialize** through play; other traditions remain learnable at higher cost.

### 3.1 Tradition packs (pluggable)

- [ ] Formalize tradition pack schema: `content/traditions/{id}.json` — spells, ingredients, recipes, spirits, recognition path, Grimoire section template
- [ ] Migrate existing `MagicTradition` union; loader merges packs at boot (admin reload)
- [ ] **Traditional European** — baseline (current default content)
- [ ] **Chaos** — sigil / paradigm shift mechanics, low ritual formality, high Willpower
- [ ] **Seidr** (`nordic_seidr`) — spirit journey, seething, oracle mechanics
- [ ] **Greek Mageia** — planetary hours, statue offerings, temple geometry
- [ ] **Vodou-inspired** — lwa relationships map to Individual Spirit Reputation; service + offering loops
- [ ] **Future traditions** — schema supports `content/traditions/_template.json`



### 3.2 Affinity rules (data-driven)

- [ ] `content/progression/affinity-rules.json`:
  - XP gain per tradition when casting/crafting/reading tagged content
  - **Cross-tradition penalty**: e.g. casting outside specialty costs +ME or −stability unless `recognitionTier` unlocks ecumenicism
  - **Soft cap**: affinities above 80 require recognition quest for that tradition
- [ ] Keep specialty modal at threshold (≥25); add “declared path” quest per tradition
- [ ] Affinity affects teacher NPC availability (`dialogues.json`: `minAffinity.traditional_european: 15`)

---



## 4. Recognition unlocks (what tiers open)

All unlocks reference **content IDs** — never hardcode vendor names in TypeScript.

- [ ] **Teachers** — NPC `role: mentor` + `{ teachesTradition, requiresRecognition, requiresSpiritRep }`
- [ ] **Licenses / certifications** — items or progression flags (`license_warder`, `license_healer`); exam quests in `quests.json`
- [ ] **Rare vendors** — shop entries gated by `{ recognitionTier, spiritualReputation, questFlag }` in `shops.json`
- [ ] **Advanced rituals** — `spells.json` / `rituals.json` `{ minRecognition, minSkills, consumedLicenses? }`
- [ ] **Temples & organizations** — map interactables + instanced zones unlocked by tier
- [ ] **Story progression** — quest graph nodes with `requires: { recognition, reputations, grimoireEntry }`

---



## 5. Grimoire system (evolve Correspondence Journal)

The Grimoire is the player’s **persistent magical knowledge base** — eventually one of their most valuable assets (trade restrictions, theft in PvP hexes, coven library backup).

### 5.1 Entry types (auto + manual)


| Section                  | Auto-populated when                    | Entry shape                                                 |
| ------------------------ | -------------------------------------- | ----------------------------------------------------------- |
| Spirits                  | First contact, pact, offering accepted | `{ spiritId, notes, rep snapshot, firstMetAt }`             |
| Rituals                  | First successful cast / recipe craft   | `{ spellId or recipeId, components used, timing, outcome }` |
| Correspondences          | Book read, experiment, ingredient use  | `{ itemId, tags[], source }` (extends today’s journal)      |
| Ingredients              | First inventory pickup / shop buy      | `{ itemId, properties from content }`                       |
| Ward designs             | Ward placed / fed / broken             | `{ wardType, layers, maintenance log }`                     |
| Curse analyses           | Hex received or dispelled              | `{ hexId, layers stripped, cleanser used }`                 |
| Observations             | Scrying, town events, NPC tells        | `{ text, location, gameDay }`                               |
| Dreams                   | Sleep interact / astral stub           | `{ text, symbols[], interpreted? }`                         |
| NPC biographies          | Relationship thresholds                | `{ npcId, facts[], relationshipLevel }`                     |
| Practitioner biographies | Meet player, inspect aura, trade       | `{ playerId, displayName, notes, metAt }`                   |
| Magical history          | World/lore books, museum               | `{ loreId, pages[] }`                                       |
| Discoveries              | Experiment success, new recipe         | `{ discoveryId, method }`                                   |
| Player notes             | User-authored                          | `{ id, title, body, tags[], linkedEntries[] }`              |


- [ ] Replace `discoveredCorrespondences[]` with `progression.grimoire: GrimoireState` (migrate on load: correspondences → entries)
- [ ] `content/grimoire/templates.json` — entry templates, section order, unlock requirements for sections
- [ ] Server: `grimoireService.record(player, entryType, payload)` called from cast, craft, read, interact, dream handlers
- [ ] Client: upgrade `[J]` panel → **Grimoire UI** — sidebar sections, search, cross-links, player note editor
- [ ] Optional: Grimoire export (JSON) for backup; coven shared shelf (read-only copies of selected entries)



### 5.2 Grimoire-driven gameplay

- [ ] Spells optionally `{ requiresGrimoireEntry: "ritual/healing_charm" }` — must have documented success once
- [ ] Divination: Memory + Grimoire completeness improves reading accuracy (data-driven table)
- [ ] Quests: “Document three ward failures in your Grimoire” / “Bring your notes on X spirit”

---



## 6. Data layer & admin (no hardcoded progression)



### 6.1 New content files

- [x] `content/progression/xp-sources.json`
- [x] `content/progression/level-curve.json` (max Level 10)
- [x] `content/progression/recognition-tiers.json`
- [x] `content/progression/reputation-public.json` (+ `reputation-spiritual.json`)
- [x] `content/progression/reputation-spiritual.json`
- [ ] `content/progression/reputation-coven.json` (stub)
- [ ] `content/progression/affinity-rules.json`
- [ ] `content/progression/stats.json`
- [ ] `content/progression/focus-weights.json`
- [ ] `content/books.json` (move from hardcoded `BOOK_CONTENT`)
- [ ] `content/spirits.json`
- [ ] `content/grimoire/templates.json`
- [ ] `content/traditions/*.json`



### 6.2 Shared & server

- [ ] `shared/src/progression/` — types for all tracks, `evaluateRecognition()`, `grantXp()`, `recordGrimoireEntry()`
- [ ] Extend `PlayerProgression` interface + `parseProgression()` migration
- [ ] Prisma: add columns or JSON fields for new stats; `db push` migration notes in README
- [ ] Content validator: JSON Schema or zod in `shared/src/validation/progression.ts`
- [ ] Admin panel: Recognition tier editor, XP source editor, Grimoire template viewer, spirit registry CRUD



### 6.3 UI surfaces

- [ ] Character sheet (stats, affinities, recognition, reputations)
- [ ] Grimoire panel (replaces journal)
- [ ] Recognition / license notification toasts → chatbox (match hexagram message style)
- [ ] Target inspect shows public vs spiritual reputation (gated by Intuition/Awareness)

---



## 7. Phase 1 implementation order (recommended)

**Milestone A — Foundation (data model)**  

1. ~~Stats expansion + migration~~
2. ~~Reputation split (public / spiritual) + content files~~
3. ~~XP source registry + central grant function~~

**Milestone B — Recognition & gates**  
4. ~~Recognition tiers + license flags~~  
5. ~~Wire gates into shops, dialogues, quests (vendor unlocks + dialogue requiresRecognition/requiresLicense)~~  
6. **Licensure Marks & Magical Council** (§1.3b) — examiner NPC, vows, spell/spirit/NPC/place gates, marks → warn → revoke  
7. Character sheet UI (full sheet still open; HUD shows recognition + specialty)  

**Milestone C — Grimoire**  
8. Grimoire state + auto-record hooks  
9. Grimoire UI + player notes  
10. Gameplay requirements tied to Grimoire entries  

**Milestone D — Traditions & spirits**  
11. Tradition pack loader  
12. Affinity rules + cross-tradition costs  
13. Spirit registry + per-spirit reputation (+ license-specific spirits from §1.3b)  

**Milestone E — Living world loops**  
14. Hunger / stamina ticks  
15. Dream + observation entry sources  
16. Teacher NPCs + certification / re-examination questlines  

---



## 8. Acceptance criteria (Phase 1 done when…)

- [ ] A new player can progress from initiate → first recognition tier using only content-defined quests and XP sources
- [ ] Public and spiritual reputation diverge measurably from the same play session choices
- [ ] Choosing a specialty tradition changes affinity gains and unlocks tradition-specific teachers via JSON gates
- [ ] Every cast, craft, book read, and spirit contact creates or updates a Grimoire entry
- [ ] Admin can add a new recognition tier, XP source, or spirit without TypeScript changes (reload only)
- [ ] No progression numbers remain hardcoded in `GameRoom.ts` / `progression-handlers.ts` except clamps defined in shared constants

---



## Expansion 1: Covens (designed, not implemented)

See: `server/src/systems/expansion-coven.ts`, `content/rituals.json`

---



## Expansion 2: The Astral (designed, not implemented)

See: `server/src/systems/expansion-astral.ts`

---



## Additional Magic Traditions (pluggable packs)

See **Phase 1 §3 — Affinity & tradition specialization** for the full tradition pack roadmap. Quick checklist:

- [ ] Chaos magic — tradition pack + affinity rules
- [ ] Nordic seidr — tradition pack + spirit journey hooks
- [ ] Greek mageia — tradition pack + planetary/temple content
- [ ] Vodou-inspired — tradition pack + lwa spirit reputation map
- [ ] Blood magic — optional future pack (morality + public rep consequences)

---



## Infrastructure

- [x] Docker Compose for PostgreSQL
- [x] Monorepo build pipeline (`npm run build`)
- [x] CI pipeline (build + lint) — `.github/workflows/ci.yml`
- [x] Password JWT authentication (`player-auth.ts`)
- [x] Rate limiting on spell cast endpoints (`GameRoom.handleCastSpell`, 12/min per session)
- [x] Admin web panel (`admin-client/` on port 5174)
- [x] Admin player manager (stats, rename, delete, give items — 40-slot grid)
- [x] Admin spell/item/NPC editors (JSON CRUD + links)
- [x] Visual node-based spell/NPC editors (`admin-client/src/editors/`, `components/node-graph.ts`)
- [x] Structured item editor (form fields + correspondences/traditions)
- [x] Ward manager (filter, deactivate)
- [x] Event manager (create/edit/toggle/delete)



## After pulling these changes

1. `npx prisma db push` — adds `Player.progression` JSON column
2. `npm run build -w shared` — rebuild shared types
3. Restart server + refresh client

