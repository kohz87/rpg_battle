# RPG Battle: module contract

How the code is split, and the exact shapes passed between modules. Read with
[DESIGN.md](DESIGN.md). Every module under `src/` except `src/ui/` and `src/suite.js` is
**pure**: no DOM, no globals, no SillyTavern, no `Math.random` (randomness only through
`rng.js`). `index.js` is the only SillyTavern glue. `src/suite.js` is the Story Suite registry on
`globalThis.StorySuite`, shared byte for byte with the other extensions (never edited here alone).

Plain ES modules, no dependencies, Node.js 24. `npm run check` (syntax) and `npm test`
(`node:test`, files `tests/*.test.js`) must pass. UI tests use `tests/ui-fake-dom.js`.
House style: 4-space indent, single quotes, semicolons, a short comment block at the top of each
module saying what it is for, comments that explain why rather than what.

```
src/rules.js      constants and formulas (written)          tests/rules.test.js
src/rng.js        seeded randomness (written)               tests/rng.test.js
src/skills.js     skill library, templates (presets: internal) tests/skills.test.js
src/enemies.js    ranks × roles projection, bestiary, loot  tests/enemies.test.js
src/combat.js     the fight state machine                   tests/combat.test.js, tests/balance.test.js
src/sheet.js      the Party block (and older Character ones) tests/sheet.test.js
src/items.js      inventory: equipment, consumables, money  tests/items.test.js
src/handoff.js    the narration hand-off text               tests/handoff.test.js
src/narrative.js  the State line: HP, MP, conditions in words tests/narrative.test.js
src/story.js      the story's hidden blocks, parsed          tests/story.test.js
src/offers.js     (0.4) the story's offers to the party      tests/offers.test.js
src/builds.js     (0.4) open-ended builds: focus, spreading  tests/builds.test.js
src/growth.js     (0.4) XP awards, auto-spend                tests/growth.test.js
src/kit.js        (0.4) a companion's starting skills        tests/kit.test.js
src/partyfile.js  (0.4) party export / import, cleaned       tests/partyfile.test.js
src/terms.js      display terms: level/XP names, tiers, cap tests/terms.test.js
src/templates.js  creatures made up from their names        tests/templates.test.js, tests/balance.test.js
src/flavour.js    the flavour call's prompt, parse, mapping tests/flavour.test.js
src/suite.js      the Story Suite registry (shared, as is) tests/suite.test.js
src/handshake.js  RPG Battle's side of the Story Suite     tests/handshake.test.js
src/ui/tab.js     the Party and Battle tabs                 tests/ui-tab.test.js
src/ui/settings.js the settings panel                      tests/ui-settings.test.js
src/suite.css     the Story Suite panel look (shared as is)
style.css         RPG Battle's own styles
index.js          SillyTavern + Story Block glue
```

## Shared shapes

```js
Stats = { STR, VIT, AGI, DEX, INT, LUK, CHA }            // integers

Skill = {                                                 // a library entry
  name, tier: 1 | 2 | 3,
  type: 'physical' | 'magic' | 'heal' | 'buff' | 'debuff',
  stat: 'STR' | 'INT' | …,                                // scales power (physical → patk, magic/heal → matk)
  power: number,                                          // × attack (1.0 = a basic attack); for heal × matk
  mp: number, cooldown: number,                           // cooldown in rounds after use (0 = none)
  target: 'one' | 'all' | 'self' | 'ally' | 'allies',
  effect: { [condition]: rounds } | null,                 // conditions applied on hit (see Conditions)
  requires: { [stat]: number } | null,
  description: string,
}

Condition names: poison, burn, bleed, stun, slow, weaken, shield, regen, guard
  ConditionState = { name, rounds, power }               // power: damage/heal per round, shield amount…

Sheet = {                                                 // a Party block section, parsed
  name, level, xp, points,
  hp: { cur, max }, mp: { cur, max },
  stats: Stats,
  skills: [{ name, mastery, aside? }],                    // mastery 1…5; aside: kept, not used in fights (0.4)
  conditions: [{ name, rounds }],                         // rounds null = until rest / removed
  uses: { [skillName]: number },                          // fight uses toward the next mastery (not shown)
}

Member = { id, name, role, control: 'auto' | 'command', sheet: Sheet, gear: [Item] }   // a Party section

Item = {                                                  // an inventory row, parsed
  name, qty, category: 'A > B' | '',
  equipped: boolean, rarity: 'common' | … | 'legendary',
  slot: 'weapon' | 'offhand' | 'armour' | 'worn' | 'accessory' | null,
  stats: { ATK?, MATK?, DEF?, MDEF?, HP?, MP?, STR?, …, crit? },
  tags: [string],                                         // range, fire, two-handed…
  effect: { heal?, mp?, cure?: [names], damage?: { amount, element, target: 'one' | 'all' } } | null,  // consumables
  raw: string,                                            // the row as written
}

Combatant = {
  id, name, side: 'party' | 'enemy', controller: 'player' | 'auto',
  level, rank: null | 'F'…'SSS', role: null | 'brute' | …, boss: boolean,
  stats: Stats, hp: { cur, max }, mp: { cur, max },
  patk, matk, pdef, mdef, crit,                           // from rules.derive (with gear)
  skills: [Skill & { mastery, cooldownLeft }],
  items: [Item],                                          // consumables it may use (party only)
  conditions: [ConditionState],
  morale: number, talks: boolean, fleesBelow: number,     // enemies; party: morale 0, talks false, fleesBelow 0
  xp: number, loot: string | [LootRow] | null,            // enemies: base XP and loot table id (a made-up creature: its rows)
  gone: null | 'down' | 'fled' | 'parleyed',
  memberId: string | null,                                // party: 'pc' or the Party member id
  generated?: true, look?: string, fresh?: true,          // a made-up creature; `fresh`: made for this fight (the "new" tag)
}

Creature = {                                              // a made-up bestiary entry (templates.js)
  name, generated: true, template: 'beast' | 'undead' | 'humanoid' | 'leader' | 'caster' | 'construct'
                                 | 'ooze' | 'insect' | 'drake' | 'spirit' | 'plant' | 'generic',
  level, rank,                                            // the level it was made at; rank at or below it
  role, talks: boolean, temperament, traits: [trait],     // words
  morale, fleesBelow, mods: { hp, attack, defence, agi }, // worked out from the words (finishCreature)
  moves: [Move], skills: [Move],                          // moves as made/flavoured; skills = moves + trait conditions
  loot: [LootRow], look: string, flavoured: boolean,
}
Move = { name, type, stat, target, effect: [condition], cooldown, description }   // built by skills.creatureSkill
LootRow = { name, chance, qty: [lo, hi], kind, rarity?, stats?, effect? }         // as in LOOT_TABLES
```

## `src/rules.js` (written)

`STATS, RARITIES, RANKS, DEFAULT_RULES, makeRules(overrides)`, and formulas:
`maxHp(stats, level, rules, bonus)`, `maxMp(…)`, `derive(stats, gear, rules) → { patk, matk, pdef,
mdef, crit }`, `checkModifier(stat, rules)`, `checkModifiers(stats, rules)`, `xpToNext(level,
rules)`, `hitChance(dex, agi, rules)`, `mitigate(raw, defence)`, `xpFactor(memberLevel,
enemyLevel, rules)`, `suggestRank(level, rules)`, `fleeChance(partyAgi, enemyAgi, { boss }, rules)`,
`parleyChance(cha, morale, hpShare, rules)`, `rarityBudget(rarity, level, rules)`.
`DEFAULT_RULES.narrative = { hpBands: [[share, word], …], mpBands: [[share, word], …], mpQuietBelow }`
holds the State line's bands (best first). `DEFAULT_RULES.wounds = { scratch: 0.1, wound: 0.3,
severe: 0.5, grievous: 0.8 }` is the share of max HP each story-wound word takes or heals.

`DEFAULT_RULES.terms = { levelName: 'Level', xpName: 'XP', tiers: null, cap: null }` (DESIGN §5.7).

`DEFAULT_RULES.threat = { step: 4, offsets: { trivial: -2, weak: -1, even: 0, strong: 1, deadly: 2 } }`
(encounter threat words, in steps; a step is a tier with tier titles on). `DEFAULT_RULES.generated`
holds every number of a made-up creature (DESIGN §7.4): `traits` (multipliers), `modMin`/`modMax`,
`temperaments` ({ morale, fleesBelow }), `moralePerRank`, `leaderMorale`, `leaderFleesBelow`,
`effectRounds`, `skillPower`, `stunCooldown`, `extraSkillLevel`, `materialChance`, `gearChance`,
`potionChance`, `gearBudgetShare`, `gearRarity` (by rank).

## `src/terms.js` (0.3)

The reader's words for levels and XP (`rules.terms`). Pure; words only, no number depends on them.

```js
export const DEFAULT_TERMS = { levelName: 'Level', xpName: 'XP', tiers: null, cap: null }
export function termsOf(rules) → { levelName, xpName, tiers: { size, numerals: 'roman' | 'arabic' } | null, cap, custom }
    // names cleaned (no | : # < > or new lines, ≤ 30 chars; empty → default); cap = terms.cap or
    // character.maxLevel; custom: anything differs from Level / XP / no tiers / the default cap
export function maxLevel(rules) → number          // the cap; sheet.js and party.js clamp to it
export function isCustom(rules) → boolean          // the tab's power picker switches from F–SSS on it
export function numeral(n, 'roman' | 'arabic'), parseRoman(text) → number | null
export function tierOf(level, rules), tierStart(tier, rules)       // tier III of size 10 starts at 21
export function levelLabel(level, rules) → 'Level 4' | 'Soul Power 4' | 'Soul Class III'
export function levelText(level, rules)  → levelLabel, plus '(Lv 24)' when a tier hides the level
export function levelTag(level, rules)   → 'Lv 4' with the plain terms, else levelLabel (list rows)
export function xpLabel(rules) → 'XP' | 'Soul Growth'
export function powerOptions(rules) → [{ level, label }]   // each tier's first level up to the cap, or every level
export function progress(sheet, rules) → { cur, max, text, capped }
    // tiers: share through the tier, '45.20/100' (hundredths floored, never 100); else '310/800';
    // at the cap 'MAX' (cur = max = 100)
export function progressLabel(sheet, rules) → 'Soul Growth 45.20/100'
export function xpFromProgress(value, level, rules) → xp within the level
    // '310/800' → 310; a share (always written with decimals) → XP in the tier (rounded up:
    // stable round trip), or that share of the level with tiers off; 'MAX' → 0
export function xpGainText(gain, level, rules) → '+38' | '+12%' (share of the member's tier; one decimal under 10 %)
export function parseLevelLabel(text, rules, { strict }) → level | null
    // 'Lv 24' / '(Lv 24)' exact; '<levelName> III' tier → its first level; 'Level 25'; 'III' (tiers on);
    // '25'; capped. strict: the level name, 'level' or 'Lv' must be written.
```

## `src/rng.js` (written)

`hashSeed(text)`, `makeRng(seed) → { next, int(lo, hi), chance(pct), between(lo, hi), pick(list),
state() }`.

## `src/skills.js`

```js
export const DEFAULT_SKILLS: Skill[]          // ≥ 12 tier-1 (no requirements), ≥ 10 tier-2/3 with requires
export const PRESETS: [{ id, name, points: { STR: n, … } (sums to rules.character.startPoints), skills: [3 tier-1 names] }]
                                              // fighter, skirmisher, caster, healer, archer; internal
                                              // data since 0.4 (the balance simulation), never offered
export const ELEMENTS = { fire: 'burn', ice: 'slow', lightning: 'stun', poison: 'poison' }   // (0.4)
export function findSkill(library, name) → Skill | null          // case/space-insensitive
export function canLearn(stats, skill) → { ok, missing: { [stat]: needed } }
export function skillFromTemplate({ name, type, stat, target, element? }, level, rules) → Skill
                                              // a story-taught skill: power/mp/cooldown scaled to level and type;
                                              // (0.4) an element on physical/magic adds its condition
                                              // (generated.effectRounds) for templates.elementPower of the power
export function effectivePower(skill, mastery, rules) → number   // power × (1 + (mastery − 1) × masteryPowerPerLevel)
export function resolveSkills(entries, library, level, rules) → [Skill & { mastery }]
                                              // sheet skills → full skills; an unknown name gets a template (physical, STR, one)
```

## `src/enemies.js`

```js
export const DEFAULT_BESTIARY: [{ name, aliases?, rank, role, talks, morale, fleesBelow, skills: [names], loot }]
                                              // ≥ 15 creatures across F…C (goblin, goblin shaman, wolf, dire wolf, bandit,
                                              // bandit captain, skeleton, slime, giant rat, cultist, bear, wraith, ogre…)
export const LOOT_TABLES: { [id]: [{ name, chance (%), qty: [lo, hi], rarity?, kind: 'material' | 'consumable' | 'equipment', stats? }] }
export function findCreature(bestiary, name) → entry | null      // name or alias, case-insensitive; "Goblin 2" → Goblin
export function rankRowForLevel(level, rules) → { level, hp, attack, defence, xp, rank }
    // the rank table linear between the two ranks bracketing `level` (past the top: the last step's
    // slope); rank = the highest rank at or below the level
export function projectEnemy({ name, rank, level, role, boss }, { bestiary, library, rules, rng, id }) → Combatant
    // (0.3) an entry with `level` (a made-up Creature) uses it when the row gives no level or rank;
    // an entry skill that is an object is a Move, built with skills.creatureSkill at the fight's
    // level; an entry `loot` array is copied onto the Combatant; `generated` and `look` go along.
    // `level` (a power in the reader's terms) wins over rank and the bestiary's rank: numbers from
    // rankRowForLevel, Combatant.level = level, rank (loot, money, morale) the one at or below;
    // bestiary entry if found (its rank/role unless the row gives one), else rank × role tables;
    // stats from the rank's numbers (attack → patk/matk by role, defence → pdef/mdef), ±variation from rng;
    // boss multipliers; level from rank; morale default 3 + rank index; talks default false for
    // unknown names unless role is caster/support; fleesBelow default 0.25 (bosses 0).
export function rollLoot(enemy, { rng, luck, rules }) → { items: [Item-like { name, qty, rarity, kind, stats }], money: number }
    // enemy.loot may be the rows themselves (a made-up creature) instead of a table id.
    // money in the smallest currency unit from rules.moneyByRank; LUK nudges rarity and chance.
```

## `src/combat.js`

```js
export function startFight({ id, seed, party: Combatant[], enemies: Combatant[], stakes: 'normal' | 'death', rules, waves? })
    → Fight
export function availableActions(fight, rules) → {
    actor: Combatant | null,                                 // whose turn it is (a player-controlled one), null when over
    targets: { enemies: [ids], allies: [ids] },
    skills: [{ name, usable, reason, target }],              // reason: 'mp' | 'cooldown' | 'stunned' | null
    items: [{ name, qty, target }],
    canParley: boolean, parleyChance: number | null,         // best target's chance
    canFlee: boolean, fleeChance: number,
}
export function act(fight, action, rules) → Fight            // returns a NEW fight; never mutates the argument
    // action: { type: 'attack', target } | { type: 'skill', skill, target } | { type: 'item', item, target }
    //       | { type: 'defend' } | { type: 'parley', target } | { type: 'flee' } | { type: 'auto' }
    // Applies the acting player's action, then runs every auto-controlled turn (enemies and
    // auto companions) until a player-controlled combatant must act or the fight ends.
    // An invalid action throws (not enough MP, cooldown, dead target, not their turn).
export function replay({ setup, actions }, rules) → Fight    // startFight(setup) then act() for each action
export function summarize(fight, rules) → Result
```

```js
Fight = {
  id, seed, stakes, round, status: 'active' | 'victory' | 'defeat' | 'fled',
  order: [ids], turn: index into order,
  combatants: Combatant[],
  log: [{ round, actor, text, kind: 'hit' | 'miss' | 'crit' | 'skill' | 'heal' | 'condition' | 'down' | 'flee' | 'parley' | 'item' | 'defend' | 'info', important: boolean }],
  actions: [action],                                         // player actions so far (for replay)
  rngState: number,                                          // rng.state() after the last step
  setup,                                                     // the startFight argument minus rules (for replay)
  stats: { uses: { [memberId]: { [skill]: n } }, itemsUsed: { [memberId]: { [item]: n } }, damageTaken: { [id]: n } },
}

Result = {
  outcome: 'victory' | 'defeat' | 'fled',
  rounds, seconds,                                           // seconds = rounds × rules.secondsPerRound
  stakes,
  party: [{ memberId, name, level, hp: { cur, max }, mp: { cur, max }, down: boolean, conditions: [{ name, rounds }] }],
  enemies: [{ id, name, gone, xp, level, rank }],
  defeated: [names], fled: [names], parleyed: [names],
  xp: { [memberId]: number },                                // per member (not divided), xpFactor per enemy level
  loot: { items: [...], money: number },                     // victory only; from rollLoot of defeated (not parleyed) enemies
  keyMoments: [string],                                      // ≤ 6: crits, finishing blows, downs, flights, parleys, near-deaths
  uses: { [memberId]: { [skill]: n } }, itemsUsed: { [memberId]: { [item]: n } },
}
```

Rules of the fight (DESIGN §5): initiative each round (AGI × 2 + DEX + d6, party wins ties);
hit/crit/damage/variance; spells (magic, heal) never miss; defend halves damage taken until the
actor's next turn and restores 5 % max MP; conditions tick at the start of the affected actor's
turn (poison/burn/bleed damage, regen heal, stun skips, slow moves to the end of the round,
weaken × 0.75 attack, shield absorbs, guard = defend); flee ends the whole fight (party) or
removes one enemy; parley per DESIGN §5.5 (bosses above half HP refuse). Enemy AI and auto
companions per DESIGN §7.3. A fight with no active enemies is a victory; with every party
member down, a defeat. Party members at 0 HP are `down`, not dead (stakes decide in the story).
Waves (`waves: [{ round, enemies }]`) join at the start of their round (0.1 may ignore waves;
keep the field).

`tests/balance.test.js`: simulate many seeded fights (a level-N sheet with starter points spread
by each preset, auto-controlled, vs three enemies of `suggestRank(N)` across roles) and assert the
median length of fights fought to the end is 4 to 6 rounds and the median HP lost is 35–65 %.
Tune `DEFAULT_RULES.ranks` (in rules.js) if needed and say what changed.

## `src/sheet.js`

(0.4) One kept **Party** block: your section first, `## Ren (you)`, with the lines the
Character block had (below, without `Name:`), then each companion as `formatParty` writes them.
`## (you)` with `No character yet.` is a character being made anew. A `Set aside: A | B` line
follows Skills when a member keeps skills past `rules.character.activeSkills` (6).

```js
export function parsePartyBlock(text, rules) → { pc: Sheet | null, members, you: boolean, errors }
export function formatPartyBlock(pc | null, members, rules) → string
export function readSheets({ party, character, partyIndex, characterIndex }, rules) → { pc, members, legacy }
    // an older chat's Character block for your sheet while the Party block has no "(you)"
    // section (or the Character copy is the newer one); legacy: the next write merges them
export function activeCap(rules) → number, activeWithin(skills, rules) → skills, activeSkills(sheet) → skills in use
export function learnSkill(sheet, name, { rules, setAside }) → Sheet   // at the cap: setAside names who sits out (or the new one); else throws
export function setSkillActive(sheet, name, active, rules) → Sheet     // Use refused at the cap
```

`parseParty` gives the companions only (the "(you)" section left out). The Character block text
(DESIGN §3.1), one field per `Label: value` segment, segments joined with ` | ` on the lines shown:

```
Name: Ren
Level: 4 | XP: 310/400 | Points: 2
HP: 58/62 | MP: 21/30
STR: 9 | VIT: 7 | AGI: 8 | DEX: 8 | INT: 4 | LUK: 5 | CHA: 6
Checks: STR +2 | VIT +1 | AGI +1 | DEX +1 | INT -1 | LUK +0 | CHA +0
State: unhurt
Skills: Rending Strike (Lv 2) | Guard Break | Second Wind
Conditions: none
```

The State line is `narrative.stateWords(sheet, rules).text`; the parsers skip any line starting
`State:` (it is derived, never read back) and do not need it.

The level line follows `rules.terms` (terms.js): `<levelName>: <level> | <xpName>: <progress> |
Points: n`, with tiers `Soul Class: III (Lv 24) | Soul Growth: 28.10/100 | Points: 2`; at the cap
the progress is `MAX`. The parsers take the term labels as Level and XP (never over another
field's label), read the level with `parseLevelLabel` (the exact `(Lv N)` first), the XP with
`xpFromProgress`, accept `Soul Class III (Lv 24)` without the colon, and fall back to the line with
`Points:` (its first two segments are the level and XP) for terms the rules no longer know.

```js
export function newSheet({ name, stats, skills }, rules) → Sheet        // level 1, HP/MP full, validates startPoints spent
export function parseCharacter(text, rules) → { sheet: Sheet | null, errors: [string] }   // lenient (bold labels, order)
export function formatCharacter(sheet, rules) → string                  // the canonical text above (Checks and State computed)
export function parseParty(text, rules) → { members: Member[], errors }
export function memberIds(names) → [id]                                 // the ids parseParty gives: slug, -2, -3…, never 'pc'
export function formatParty(members, rules) → string
    // ## Name — role | control: auto
    // Level / HP / MP / State / stats / Skills lines as the Character block; Equipped: Item (rarity) · stats | …
export function spendPoints(sheet, allocation: { STR: n, … }, rules) → Sheet   // throws when over budget or negative
export function learnSkill(sheet, name) → Sheet                          // adds at mastery 1, no duplicates
export function applyResult(sheet, memberId, result, rules) → { sheet, levelsGained, pointsGained, masteryGained: [names] }
    // HP/MP from result.party; XP added, levels while xp ≥ xpToNext and below terms' cap (XP 0 at the cap; max HP/MP recomputed and
    // HP/MP raised by the same amount); points added; skill uses → mastery (rules.masteryUses);
    // conditions lasting past the fight kept (poison, exhausted).
export function recompute(sheet, gear, rules) → Sheet                    // max HP/MP from stats, level and gear HP/MP
```

## `src/items.js`

Story Block's Inventory block is `rows` format: `[Category > Sub]` headers, then
`Name | Qty | Note` rows. Equipment rows carry `equipped`, a rarity, `slot: x`, and stats in the
note (DESIGN §3.3): `Iron Longsword | 1 | equipped · uncommon · ATK +6, DEX -1`.

```js
export function parseInventory(text) → { items: Item[] }                 // every row; equipment and consumables recognised
export function capItem(item, level, rules) → { stats, capped: boolean, budget, cost }
    // stats scaled down proportionally when their cost exceeds rarityBudget; an item with no
    // stats gets its budget spent on its kind's main stat (weapon → ATK, staff/wand → MATK,
    // armour → DEF, robe → MDEF, accessory → LUK).
export function gearLimits(rules) → { worn, accessory }   // rules.gear: how many count (0–9; 1 and 2 by default)
export function equipped(items, rules) → { weapon, offhand, armour, worn: [], accessory: [], unused: [{ item, why }] }   // first equipped per slot
export function gearSummary(items, level, rules) → { counted: [{ name, slot, stats, capped, from }], unused: [{ name, slot, why }] }   // the Battle tab's Gear list
export function gearBonuses(items, level, rules) → { ATK, MATK, DEF, MDEF, HP, MP, STR…, crit, capped: [{ name, from, to }] }
export function consumables(items) → Item[]                              // rows with an effect (heal 30, mp 20, cure poison, fire 25 all)
export function formatMoney(amount, currency) → string                   // '1 gold, 3 silver, 4 copper' | '134 coins'
export function parseMoney(text, currency) → number                      // the inverse, in the smallest unit
export function addLoot(inventoryText, { items, money }, currency) → string
    // the money added to the currency row (created under [Money] if missing), items added as rows
    // (stacking a same-named row's Qty), equipment with rarity and stats in the note.
export function useItems(inventoryText, used: { [name]: n }) → string     // quantities down, a row at 0 removed
```

## `src/narrative.js`

```js
export function stateWords(sheet, rules) → { hp, mp, conditions: [words], text }
    // (0.4) a sheet with the condition "dead" (a fight lost to the death) → { hp: 'dead', text: 'dead' }
    // hp: 'unhurt' | 'bruised' | 'hurt' | 'badly hurt' | 'barely standing' | 'down' (0 HP)
    // mp: 'fresh' | 'tired' | 'drained'; conditions: poison → poisoned, burn → burned, bleed → bleeding,
    // stun → stunned, slow → slowed, weaken → weakened, others as written (no repeats).
    // text: the HP word with its hint for hurt and worse ("badly hurt (bleeding, slow to move)"),
    // "<mp> of magic" unless fresh (never when max MP < mpQuietBelow or HP is down), the conditions,
    // joined with ' · '. Works on a Sheet or a Result party entry.
```

## `src/story.js` (0.3)

The model's two optional hidden blocks (DESIGN §4.2, §8.6), read leniently (bullets, bold, an
en or em dash or a spaced hyphen, any case); never throws.

```js
export const STORY_INSTRUCTION: string       // the always-on instruction, every hidden block (0.4: ≈ 160 tokens; tests hold it ≤ 170)
export const SEVERITIES = ['scratch', 'wound', 'severe', 'grievous']   // mildest first
export function parseWounds(text) → [{ name, kind: 'harm' | 'heal' | 'condition' | 'cure', severity?, condition?, cause }]
    // `Name — scratch|wound|severe|grievous: cause` harm (the worst severity word in a short
    //   effect counts: "severe wound" → severe); `Name — heal <word>: cause` heal (also healed,
    //   treated; no word → scratch); `Name — cure <condition>: cause` cure; any other effect of
    //   1–3 words a condition as written ("poisoned"); "unhurt", "none"… nothing. The cause may
    //   follow ':', a second dash, a comma or sit in brackets; it may be empty.
export function applyWounds({ pc: Sheet | null, members: Member[] }, wounds, rules) → { pc, members, applied }
    // Pure (copies). harm: cur − round(max × rules.wounds[severity]) (at least 1), floor 0;
    // heal: the same share back, cap max. One harm-or-heal per person (the first; later ones
    // skipped even when the first changed nothing); conditions added once (poisoned = poison),
    // cures remove by stem (cure poison lifts poison and poisoned). Names: full name, then
    // first name, case- and accent-insensitive; the Character before the Party; others ignored.
    // applied: [{ name, memberId: 'pc' | member id, kind, severity | null, hp: signed change,
    //            condition | null, cause, down? }], only lines that changed something.
export function describeWound(entry) → string // "Ren: wound (−29 HP), fell down the ravine."
export function parseEncounter(text, bestiary, rules) → [{ name, count (1–9), rank | null, role | null, boss, level? }]
    // `level` only when brackets name a power in the terms ('(Soul Class II)', '(boss, Lv 24)',
    // '(level 12)'; parseLevelLabel strict; 'rank D' stays a rank)
    // groups by ',', ';', new line, 'and', '&', '+' (not inside brackets); each
    // `[N ×|N x|N |a |two… ]name[ (boss)][ rank X][ role]`, or `name ×N`; brackets may hold
    // boss, rank X and a role. A creature's name is spelt as the bestiary spells it; a plural is
    // made singular when the singular is a creature (or alias); other names are kept as written.
```

Also (0.4): `then:` before a group starts the next engagement; its rows and the later ones carry
`wave` (1…3). The party's blocks, each lenient and never throwing:

```js
export function parseHints(text) → { type?, stat?, target?, element?, focus?, level?, skills?, role? }   // after a bar; known words only
export function parseJoins(text, rules) → [{ name, role, level | null, focus, skills, line }]
export function parseLeaves(text) → [{ name, reason, line }]
export function parseLearned(text) → [{ name, skill, words, hints, line }]
export function guessSkill(words, hints) → { type, stat, target, element }          // hints first, then the words
export function parseXp(text) → [{ kind: 'minor' | 'major' | 'milestone', reason, line }]
export function parseRest(text) → [{ kind: 'short' | 'long', reason, line }]        // the first counts
export function findTarget(targets, name), meansYou(name)
```

Also (0.3): `THREATS = ['trivial', 'weak', 'even', 'strong', 'deadly']`; parseEncounter rows carry
`threat` when a threat word is written (in brackets, any synonym; before the name only trivial,
feeble, puny, weak, easy, matched, strong, tough, dangerous, deadly, lethal, overwhelming, and not
when the whole name is a creature) and no rank or level is; a plural whose last word is a creature
word is made singular (`templates.creatureSingular`).

```js
export function threatLevel(threat, partyLevel, rules) → level | null
    // partyLevel + rules.threat.offsets[threat] × step (tier size with tiers on, else rules.threat.step), within 1…cap
export function resolveThreats(rows, partyLevel, rules) → rows   // `level` added from `threat` (threat kept); rows with rank/level untouched
```

## `src/templates.js` (0.3)

Creatures made up from their names (DESIGN §7.4). Pure.

```js
export const TEMPLATES, TEMPLATE_IDS, TRAITS, STAT_TRAITS, CONDITION_TRAITS, TEMPERAMENTS
export function classify(name) → { template, noun, leader, role | null, traits }
    // keywords: a nature (beast, undead, construct, ooze, insect, drake, spirit, plant; last word
    // wins) beats a profession (caster beats humanoid); leader words → 'leader' for a humanoid (or
    // none), the leader trait on any kind; plurals and compounds (≥ 4-letter keywords) read
export function templateFor(name) → template id
export function creatureSingular(word) → singular | null      // 'wights' → 'wight'; null when already singular
export function generateCreature({ name, level, role?, boss? }, { rules, rng?, seed? }) → Creature
    // deterministic for name + level + seed (or the rng); 2 moves, 3 from generated.extraSkillLevel
    // and for leaders/bosses; the template's role unless `role`; loot of its kind
export function finishCreature(entry, rules) → Creature   // numbers worked out again from the words
export function cleanCreature(raw, rules) → Creature | null   // stored/imported entries: known words, bounded, finished
export function cleanTraits(list) → traits      // known, opposites (swift/slow, frail/hulking) first wins, ≤ 3 + leader
export function traitMods(traits, rules) → { hp, attack, defence, agi }
export function gearRarityFor(rank, rules), gearValue(stat, rarity, level, rules)
export function lookupCreature(name, chatBestiary, defaults) → { entry, source: 'chat' | 'default' } | null
export function combinedBestiary(chatBestiary, defaults) → [...chat, ...defaults]
export function creaturesToMake(rows, { chatBestiary, defaults, rules, seed }) → Creature[]   // one per unknown name, at row.level
export function storeCreatures(chatBestiary, entries, max = 200) → list   // same name replaced, newest last
```

`skills.js` (0.3) adds `HARMFUL_CONDITIONS`, `HELPFUL_CONDITIONS` and
`creatureSkill(move, level, rules) → Skill`: `skillFromTemplate` × `generated.skillPower`, physical
MP 0, known conditions of the type's side (≤ 2) for `generated.effectRounds`, cooldown ≥ the move's
(a stun ≥ `stunCooldown`).

## `src/flavour.js` (0.3)

The words-only model call for a made-up creature (DESIGN §7.4). Pure; index.js makes the call.

```js
export const FLAVOUR_SYSTEM: string             // the six lines and the words code understands
export function flavourPrompt(creature, { power, party, scene }) → [{ role: 'system', content }, { role: 'user', content }]
export function sceneText([{ name, text }], maxWords = 300) → string   // comments and tagged blocks out, last N words
export function parseFlavour(text) → { look, traits, talks: boolean | null, temperament | null,
                                       skills: [{ name, words }], loot: [{ name, rarity | null, stat | null }] }
    // lenient (case, bold, bullets, a value on following lines, ';' and ',' lists); every digit
    // dropped; unknown traits/temperaments ignored; money names are no items; never throws
export function applyFlavour(creature, flavour, { rules }) → Creature
    // look; known traits replace the template's (leader kept); talks; temperament; moves renamed in
    // order with target / type / conditions from their words; loot renamed (a stat → gear valued
    // again; a potion word → the potion), rarity ≤ one above gearRarityFor(rank); finishCreature;
    // flavoured: true. Nothing usable → the same object back.
```

## `src/suite.js` and `src/handshake.js` (0.3)

`suite.js` is the shared contract ([STORY_SUITE.md](STORY_SUITE.md)): `storySuite()` → the
registry (`announce`, `withdraw`, `providers`, `has`, `api`, `owner(area)`, `offering(area)`,
`onChange`), `AREAS` (owners in order), `isSourceOfTruth(myId, area, choice, suite)`.
`handshake.js` is pure, the suite always passed in:

```js
export const SUITE_ID = 'rpg-battle', SUITE_NAME = 'RPG Battle', SHARED_AREAS = ['stats', 'rolls', 'items']
export const TRUTH_CHOICES = ['auto', 'mine', 'theirs'], SETTINGS_ROOT = '#rpg_battle_settings'
export function truthChoices(saved) → { stats, rolls, items }        // 'auto' | 'mine' | 'theirs'; unknown → 'auto'
export function announcement({ version, api, enabled = true }) → { id, name, version, owns: SHARED_AREAS, enabled, settings: SETTINGS_ROOT, api }
    // (0.3.3) switched off: enabled false, still announced, so Story Suite's overlay can switch it back on
export function manageApi({ choices, choose, enabled, enable }) → frozen api.manage (0.3.3):
    { areas: SHARED_AREAS (a copy), sources() → truthChoices(choices()) copy,
      setSource(area, choice) → boolean (false, nothing called, for an unknown area or choice; else choose(area, choice)),
      enabled() → enabled() !== false, setEnabled(on) → enable(Boolean(on)) }
export function suiteOverlay(suite) → (() => openSuite('rpg-battle')) | null
    // (0.3.3) providers().length >= 2 and suite.api('story-block').openSuite is a function: the "Manage all" link
export function partyMembers(pc: Sheet | null, members: Member[], rules) → frozen
    [{ id: 'pc' | member id, name, role: null (the Character) | string, level, levelLabel (levelText), hp: { cur, max }, mp: { cur, max }, state (stateWords text) }]
export function sheetNotice({ suite, choice, storySheetOn }) → boolean
    // Story Block announced (any state): it offers 'stats' and isSourceOfTruth('rpg-battle', 'stats', choice);
    // else storySheetOn (boolean, or a function called only then): the settings check for an older Story Block
export function sources(suite, choices) → { [area]: { mine, name } }   // who the story follows now (settings)
export function suiteSignature(suite) → string                         // ids, enabled, owns (sorted); apis left out
```

## `src/handoff.js`

```js
export function buildHandoff(result, { names, currency, stakes, pcName, rules }) → string   // DESIGN §8.2, exact header line:
// [Battle resolved by RPG Battle: narrate this outcome, do not change it]
```

XP line in the terms: `XP +38 each.`, `Power Growth +38.`, with tiers `Soul Growth +12% each.` (each
member's share of their tier, from `result.party[].level`); a member at the cap is left out.

Status: one line per member, `Ren: HP 34/62, MP 12/30 — hurt (aching, favouring a wound) · tired of
magic.`; a member who is down reads `Astra: down (unconscious or unable to fight).`

Defeat lines: normal stakes → `Defeated: the story decides what follows (captured, robbed, left
for dead).`; death stakes → `Defeated: <pc> is killed. <pc> is dead and does not come back;
narrate the death, not a rescue.` Fled → `Escaped after N rounds.` Loot and
XP lines only on victory.

## `src/builds.js`, `src/growth.js`, `src/offers.js`, `src/kit.js`, `src/partyfile.js` (0.4)

```js
// builds.js: open-ended builds
export const ROLE_FOCUS, FOCUS_WEIGHTS = [3, 2, 1]
export function focusFromRole(text), guessFocus(role, summary), cleanFocus(list) → [stats]
export function spreadByWeights(total, weights) → { STR: n, … }   // largest remainder; none → even
export function focusWeights(focus), buildStats(focus, level, rules) → Stats
export function buildAllocation(sheet, rules) → allocation          // points by the build so far
export function suggestSkills(stats, focus, library, { role, count }) → [names], lockedReason(stats, skill) → string

// growth.js
export function awardShare({ kind } | { difficulty }, rules), xpAward(share, level, rules) → xp (0 at the cap)
export function gainXp(sheet, xp, rules), spendByBuild(sheet, rules), settleCompanions(members, { autoSpend, rules })
export function awardParty({ pc, members }, share, { autoSpend, rules }) → { pc, members, gains }
export function questDifficulty(value) → 'easy' | 'normal' | 'hard' | 'nightmare'

// offers.js
export function storyOffers({ index, texts: { joins, leaves, learned, xp, rest }, pc, members, persona, rules, library, opening, narrating, pending })
    → [{ key: 'index:kind:line', kind, text, accept, note?, data }]   // yours wait while pc is null
export function questOffers({ index, quests, pc, rules }) → [{ key: 'index:quest:id', kind: 'quest', … }]

// kit.js: a companion's starting skills
export const KIT_SYSTEM; export function kitPrompt(who) → messages, parseKit(text) → [{ name, words, type, stat, target, element }]
export function fallbackKit({ focus, level, role }, library, rules), namedKit(names, library), usableKit(specs), kitTemplate(spec)

// partyfile.js
export function exportParty({ pc, members, yourGear, skills }) → { rpgBattleParty: 1, character, companions, gear, skills }
export function cleanParty(data, rules, library) → { pc, members, yourGear, skills }   // throws on a non-party file
```

`rules.js` (0.4): `character.activeSkills` 6, `xpAwards { minor .10, major .25, milestone .50 }`,
`questXp { easy .05, normal .10, hard .15, nightmare .25 }`, `templates.elementPower` 0.85.
`handshake.js` (0.4): `tokenEstimate({ instruction, handoff }) → { input, output, parts }` (≈ 4
characters a token; the hand-off replaces the instruction; `HIDDEN_BLOCKS_ALLOWANCE` 20 output
tokens with the instruction), and `manageApi({ …, tokens })` adds `tokens()` (never throws).

## `src/ui/tab.js`

```js
export function renderBattleTab(pane, view, handlers)
```

(0.4) Two tabs draw with it: **Party** (`create`, `idle`, `spend`, `learn`, `companion`, `items`)
and **Battle** (`offer`, `setup`, `fight`, `result`). A mode drops only the drafts of its own tab's
other modes, and a pane's events redraw that pane (the other tab may have drawn since).

| mode (0.4) | data | handlers |
|---|---|---|
| `create` | `{ persona, importing, rules }`: stats only, no skills | `onCreate({ name, stats })`, `onImportParty(text)`, `onConfirmImport()`, `onCancelImport()` |
| `idle` | `{ chatId, sheet, checks, skills (with aside), party: [Member & { skills, gearSummary, dossier }], gear, giveable, autoSpend, gameOver, importing, pending, offers: [{ key, kind, text, accept, note, confirm }], recovered, story, sheetConflict, bestiary, rules }`: the cards (`details.rpg-battle-member-card`, yours `.is-you` open; open state per chat and member) | `onSpend(id)`, `onSetSkillActive(id, name, active)`, `onGiveItem(id, name)`, `onTakeBack(id, name)`, `onOpenDossier(id)`, `onSetControl`, `onEditCompanion`, `onRemoveCompanion`, `onStartOver({ keepCompanions })`, `onAcceptOffer(key)`, `onDismissOffer(key)`, `onItems()`, `onExportParty()`, `onImportParty(text)`, `onUndoStory()`, `onReturn()`, the Bestiary's |
| `spend` | `{ sheet, memberId, rules }` | `onConfirmSpend(allocation, memberId)`, `onBack()` |
| `learn` | `{ sheet, memberId, library, prefill: { name, words, type, stat, target, element, free } \| null, rules }`: at the cap a select asks who sits out | `onConfirmLearn({ name, fromLibrary?, template?, setAside?, memberId? })`, `onBack()` |
| `companion` | `{ level, maxLevel, prefill: { name, role, level, focus, npcId, summary }, kit: { key, status: 'working' \| 'ready', skills, note }, npcs, rules }` | `onAddCompanion({ name, role, control, level, focus, skills: [spec], gearLines, npcId })`, `onGenerateKit(who)`, `onBack()` |
| `offer` | `{ encounter: { text, label, rows } \| null, pending }` | `onFightEncounter(rows)`, `onDismissEncounter()` |

The 0.3 table below still describes `setup`, `fight`, `result` and `items` (setup rows may carry
`wave`, shown as *then N*).

`view.mode` and its data:

| mode | data | handlers used |
|---|---|---|
| `create` | `{ presets, library (tier 1), persona, rules }`; (0.3.3) `persona` is `ctx.name1` trimmed (`''` without one): the Name box starts with it and follows it until the reader types there, with a hint (`.rpg-battle-name-hint`) while it does | `onCreate({ name, stats, skills })` |
| `idle` | `{ sheet, checks, skills: resolved, party: [Member], rules, pending: handoff text or null, recovered: text, story: { lines: [text], canUndo } \| null, encounter: { text, label, rows } \| null, sheetConflict: boolean, bestiary: [{ name, power, role, template, traits, look, flavoured }] }` (the State words under the HP/MP bars, `.rpg-battle-state`; the Bestiary fold `.is-bestiary`) | `onSpend()` (opens spend), `onLearn()`, `onSetup()`, `onReturn()`, `onRest(kind)`, `onItems()`, `onCompanion()`, `onSetControl(id, control)`, `onEditCompanion(id, { name, role, control })` (the row's **Edit** form), `onRemoveCompanion(id)`, `onUndoStory()`, `onFightEncounter(rows)`, `onDismissEncounter()`, `onDisableStorySheet()`, `onRegenerateCreature(name)`, `onForgetCreature(name)` (asks twice), `onExportBestiary()`, `onImportBestiary(text)` |
| `spend` | `{ sheet, rules }` | `onConfirmSpend(allocation)`, `onBack()` |
| `learn` | `{ sheet, library, rules }` | `onConfirmLearn({ name, fromLibrary? , template? })`, `onBack()` |
| `setup` | `{ bestiary names, known: [names and aliases], suggestedRank, prefill: rows \| null, preparing: [names] \| null, rules }` (a new `prefill` seeds the draft's rows once; the reader's edits survive redraws; a name not in `known` is tagged `.rpg-battle-new`; a prefill `threat` shows as `.rpg-battle-threat`; while `preparing`, Start is disabled and the summary reads *Preparing foes: …*) | `onStart({ rows: [{ name, count, rank, role, boss }], stakes })`; with custom terms the picker lists `powerOptions` and rows carry `level` (number \| null) instead of `rank`; a prefill `level` becomes the rank at or below it with the plain terms. `onBack()` |
| `fight` | `{ fight, actions: availableActions(fight) }` | `onAction(action)`, `onAuto()` |
| `result` | `{ result, handoff, levelsGained, pointsGained, levelsReached? }` (gains in the terms) | `onReturn()`, `onDiscard()`, `onDone()` |

Levels and XP are shown in the terms everywhere: the idle header (`levelText`), the XP bar
(`progress`, named by `xpName`), party rows (`levelTag`), the companion level picker, enemy card
badges (`levelLabel` of the enemy's level with custom terms, else its rank) and the result's gains.

Nothing the model wrote is ever put in the page through `innerHTML`; use `textContent`. Phone
first: the action bar is thumb-sized at the bottom of the fight view; tapping an enemy card picks
the target for the chosen action. Styles in `style.css`, class prefix `rpg-battle-`, colours from
SillyTavern's theme variables (`--SmartThemeBodyColor`, `--SmartThemeBorderColor`,
`--SmartThemeQuoteColor` for accent).

## `src/party.js`

```js
export function combatantFromSheet(sheet, { memberId, controller, gear, items, library, rules }) → Combatant
    // stats + gear (capped by items.gearBonuses), max HP/MP with gear, current HP/MP from the sheet,
    // skills resolved, consumables from `items`, `capped` (the items scaled down).
export function enemiesFromRows(rows, { bestiary, library, rules, rng }) → Combatant[]
    // ids e1, e2…; several of a kind lettered "Goblin A", "Goblin B".
```

## `src/recovery.js` (0.2)

```js
export function rest(sheet, 'short' | 'long', { gear, rules }) → Sheet
export function recoverOverTime(sheet, hours, { gear, rules }) → { sheet, kind: 'long' | 'regen' | null, hp, mp }
export function useItemOutside(sheet, item) → { sheet, used, message }
export function restAfter(sheet, 'short' | 'long', { gear, rules, already: { hp, mp } }) → Sheet
    // (0.4) a <Rest> accepted for a reply story time already healed: a short rest adds only what
    // its share gives beyond `already` (the larger of the two, not their sum); long: rest()
```

`party.js` also has `newCompanion({ name, role, control, level, focus, skills, preset?, gearLines }, { rules, existing, library? }) → Member`
(level capped at `maxLevel(rules)`; 0.4: start and level points spread by the focus weights,
builds.js; up to starterSkills skill names, checked against `library` when given; a `preset` still
builds the old way), `engagements(enemies) → { enemies, waves: [{ round, enemies }] }` (rows'
`wave`, fought once the field is clear), `headingText(value, max)`, and for **Edit companion**:

```js
export function editCompanion(members, memberId, { name, role, control }, { pcName }) → { members, idMap: { oldId: newId } }
    // name/role cleaned for the heading (no | # — or trailing brackets); sheet.name follows; sheet,
    // stats, skills, gear unchanged; ids recomputed with sheet.memberIds (a rename can move another
    // member's id too). Throws: unknown member, empty name, a name another companion or the PC has.
export function remapIds(records, idMap) → records    // { [memberId]: … } moved to the new ids
```

Rows for `enemiesFromRows` may carry `level` (passed to `projectEnemy`).

## `src/ui/settings.js`

(0.4) The panel wears the shared Story Suite look (`src/suite.css`, docs/STORY_SUITE.md): the
Manage line `div.story-suite-manage[data-story-suite-link]`, a `.story-suite-quickbar` of switch
rows (`#rpg_battle_enabled`, `#rpg_battle_recover`), the Character Sheet notice as
`.story-suite-notice`, sections as `details.story-suite-fold[data-fold]` in `.story-suite-folds`
(money, equipment, terms, monsters (titled *Generated words*), party, truth, blocks), each
setting a `label.story-suite-row` (`<b>` label, `<small>` hint and *Now: …*), numbers with units
in `.story-suite-number`. New: `#rpg_battle_active_skills` (3–12) and `#rpg_battle_auto_spend`
(`settings.activeSkills`, `settings.autoSpend`); the Character tag is gone. The older 0.3 notes:

`renderSettings(container, { settings, version, status, sheetConflict, sources, profiles, suiteLink, onOpenSuite, onDisableSheet, onChange })
→ { update(settings), setSheetConflict(on), setSources(sources), setTruth(area, choice), setEnabled(on), setSuiteLink(on) }`:
(0.3.3) **Manage all in Story Suite** (`.rpg-battle-settings-suite[data-story-suite-link]`, which Story Block's overlay hides while the panel is inside it; first in the panel, above the
switches; shown while `suiteLink` / `setSuiteLink(true)`, its button calls `onOpenSuite`);
`setTruth` and `setEnabled` show a choice or the switch changed in Story Suite's overlay (the
select or checkbox and the fold summary; nothing is sent to `onChange`; an unknown area or choice is
ignored). (0.3.2) the sections fold
(`details.rpg-battle-settings-fold[data-fold=money|equipment|terms|monsters|truth|blocks]`, all closed,
open ones remembered in `localStorage['rpg_battle_settings_folds']`), each summary from `foldHints(settings)`.
(0.3) **Source of truth**: a
select per shared area (`#rpg_battle_truth_stats|rolls|items`: Automatic / This extension / The
other one, `settings.sourceOfTruth = { stats, rolls, items }` of `'auto' | 'mine' | 'theirs'`) with
"Now: <name>" from `sources` (`.rpg-battle-settings-source`). (0.3.1) **Equipment**:
`settings.gear = { worn, accessories }` (0–9, `#rpg_battle_gear_worn|accessories`), passed to the rules as
`rules.gear`. **Monsters**: `settings.flavour = { enabled,
model: { source: 'chat' } | { source: 'profile', profileId }, maxTokens (100–2000) }` (`profiles`:
[{ id, name }] or null when Connection Manager is off; a saved profile that is gone shows as
"(missing profile)"); the on/off switch, the currency (mode, tiers as
`name=rate, …`, single coin name, money row), the terms (level name, XP name, tier titles on/off
with levels per tier and numerals, cap; `settings.terms = { levelName, xpName, tiers: { size,
numerals } | null, cap: number | null }`, an empty name saved as the default), the block tags,
and the Story Block Character Sheet notice with **Turn it off** (shown while `sheetConflict`).

## As built (0.1)

- Actions from the tab: `skill` and `item` are names; area skills and items send `target: null`,
  self skills the actor's id. `startFight` already runs the automatic turns up to the first player
  turn. XP for defeated enemies is given on every outcome; loot only on victory.
- Mastery progress (`sheet.uses`) is not in the block text; index.js keeps it in chat metadata.
- The rank table was retuned by the balance simulation (see DESIGN §7.1).

## `index.js` (glue, written last)

Settings, the Character and Party blocks registered with Story Block as kept blocks, the tab,
fights stored in chat metadata, the hand-off through the generate interceptor
(`rpgBattleInterceptor`), sheets and loot written with `StoryBlock.setBlockText`.

As built (0.3):

- **Prompts:** `rpg_battle` is the hand-off (one reply and its swipes); `rpg_battle_rules` is
  `STORY_INSTRUCTION`, in chat at depth 1 as system, set on every generation while RPG Battle is
  on, a Character block exists, no fight is under way and no hand-off goes with this reply;
  cleared on quiet and impersonate generations and on chat change.
- **Blocks:** `Wounds` and `Encounter` registered transport-only (`registerBlock({ id, tag, name })`),
  read with `blockInText(message.mes, tag)`.
- **After each reply** (`onReply` → `afterReply`), skipped while a fight is stored: `planReply`
  takes the Character and Party sheets before the reply (`getBlock(tag, { beforeIndex })`),
  applies story-time recovery, then the reply's wounds (not for the reply the hand-off is
  attached to, nor when undone); `writePlan` writes only what differs into that reply, and
  writes nothing when the reply already holds a sheet the pipeline did not write (its hash is
  not in `story.written`). Chat state `story: { index, signature (hash of the <Wounds> text),
  applied, undone, written: { character, party } }`, `recovered: { index, text }`.
- **Undo** (`onUndoStory`, the toast's button): allowed while that reply is the latest, its
  `<Wounds>` text is the same, and its sheets hash to `story.written`; rewrites them with
  `planReply(…, { withWounds: false })` and sets `undone`.
- **Encounters:** the offer is the latest reply's `<Encounter>`, else the first due or soon entry
  of `StoryDirector.encountersAt(index)` (typeof-guarded, try/catch); none during a fight or with
  a hand-off pending; `dismissed: ['index:text']` (the last 30) holds Not now and fights started
  from an offer. `onFightEncounter(rows)` opens the setup with `prefill`. Toasts with buttons use
  `escapeHtml: false` with every model-written part escaped.
- **Terms:** `settings.terms` (merged like `currency`) goes into `rules()` as `terms`. The
  Character block's Story Block fields are `characterFields(rules)` (the level field under
  `levelName`, text with tiers; the XP meter under `xpName`); when the terms change the kept
  blocks are registered again (Story Block replaces a block re-registered under its id) and the
  Character and Party blocks are rewritten in the new words (not during a fight). The setup's
  rows may carry `level`; `startNewFight` passes it through (no fair rank then). `finishFight`
  stores `levelsReached` (the PC's new level) for the result screen. `<Encounter>` is parsed with
  the rules, so a power in the terms fills the row's level.
- **Edit companion** (`onEditCompanion(id, changes)`): `editCompanion` with the PC's name, the
  Party block rewritten, and the chat's `uses` moved with `remapIds` when an id changed.
- **Made-up creatures (0.3):** chat state `bestiary: [Creature]` (cleaned on store, at most 200);
  `fightBestiary()` = `combinedBestiary(chat, DEFAULT_BESTIARY)` for the setup, encounters
  (`encounterRows`: `parseEncounter` + `resolveThreats` with the Character's level) and fights.
  `onStart` → `prepareAndStart`: `rankedRows` settles each row's power (level, rank, the known
  creature's own, else the fair rank; `makeAt` the level to make it at), `creaturesToMake` makes the
  unknown ones (seed: the chat id), the first 4 are flavoured (`flavourAll`: one deadline,
  `settings.flavour.timeoutSeconds` 30; profile calls in parallel through
  `ConnectionManagerRequestService.sendRequest(profileId, messages, maxTokens)`, chat-model calls in
  turn through `generateRaw({ systemPrompt, prompt, responseLength })`; failures leave the template
  creature with a console note), stored, then `startNewFight(setup, { fresh })` marks their
  Combatants `fresh`. The fight does not start if the reader left the setup meanwhile.
  `screen.preparing` drives the setup's notice, with an info toast. Regenerate: a new seed at the
  same level, flavoured; Export: a JSON download `{ rpgBattleBestiary: 1, creatures }`; Import:
  that or a bare array, through `cleanCreature`.
- **Story Block's Character Sheet:** the blocks with `template: 'character-sheet'` in
  `extensionSettings.storyBlock.blocks` (`listBlocks()` has `enabled` but no template; it is the
  fallback, by id, before Story Block has stored its list). `onDisableStorySheet` sets their
  `enabled` to false, saves settings and refreshes Story Block.
- **Story Suite:** `init` announces (`announcement`, `api: { version, members, manage }`) before the
  UI and subscribes once to `onChange`; the settings' on/off switch announces again (0.3.3: with
  `enabled: false` when off, rather than withdrawing). `applySettings(next)` is the panel's
  `onChange` and what `api.manage` calls: save, announce when the switch changed, re-register the
  kept blocks when the terms did, the notice, the "Now:" lines, Story Block's refresh.
  `manage.setSource` and `setEnabled` then show the change in the panel (`update`, `setTruth` /
  `setEnabled`). The "Manage all in Story Suite" link follows `suiteOverlay(storySuite())` at
  mount and on every suite change (the watcher's key is `suiteSignature` plus whether the overlay
  is offered); it opens the overlay on `'rpg-battle'`.
  `members()` is `partyMembers` of the kept Character and Party blocks (`getBlock(tag)`), memoised
  on their text and the terms and rules, `[]` when off or on any error. `sheetConflict()` is
  `sheetNotice` with `settings.sourceOfTruth.stats`; the settings-based check above is its
  fallback for a Story Block outside the suite. A suite change whose `suiteSignature` differs
  redraws on the next tick (the notice in the settings, the "Now:" lines, Story Block's refresh),
  so Story Block announcing from inside its own refresh is neither re-entered nor looped. Not the
  source of truth for stats changes only the notice: the kept blocks, their prompt notes, the
  story instruction and the Dice modifier stay as they are, since fights need RPG Battle's sheets.

## As built (0.4)

- **One Party block** (`rpg-party`, kept, `tab: false` on Story Block ≥ 0.9.1, a version check).
  `sheetsAt(sb, { beforeIndex })` reads it and an older chat's `<Character>` (registered
  transport-only as `rpg-character`: hidden, not prompted, no tab, never written) through
  `readSheets`; companions get `npcId` from chat state `npcLinks`. Every write is
  `writeSheets(pc, members)` (formatPartyBlock); `migrateLegacy` writes the merged block into the
  latest reply when a chat still has your sheet in the old block (on Story Block's onUpdate and
  when the Party tab draws; once per chat and length). The pipeline (`planReply`, `writePlan`)
  plans one Party target; `story.written = { party }`. The dice modifier points at your section.
- **Tabs:** `rpg-party` (label Party, always while on; badge: the offers) and `rpg-battle` (label
  Battle; `isAvailable: battleOn()`: a fight stored, the setup or the result on screen, or an
  encounter offer). Screens: `screen` (Battle: setup, result) and `partyScreen` (Party: spend,
  learn, companion, items; `memberId`, `prefill`, `offerKey`, `kit`). A toast's Fight? opens the
  setup and presses Story Block's tab button for Battle (`[data-tab-id="ext:rpg-battle"]`, best
  effort). No Start fight, Learn skill, Add companion or rest handlers.
- **Offers:** `currentOffers()` = the latest reply's blocks (`storyOffers`), the opening message's
  (message 0; `opening: true`, put away into chat state `done`, kept apart from `dismissed`, 60
  each), Story Director's `questsDoneAt(latest)` (typeof-guarded), `fallen` companions, a persona
  rename (`watchPersona`: per chat, once per switch) and NPC renames (linked companions whose
  `npcProfiles()` name changed). None during a fight. `acceptOffer(key)`: joins → the companion
  form (with an NPC profile of that name: `npcId`, role, summary), and `generateKit`; learned →
  the learn form (`prefill.free` from the opening message skips stat requirements); leaves and
  fallen → removed (`forgetMember`: uses, npcLinks); xp and quest → `awardParty`; rest →
  `restAfter` with that reply's story-time `recovered.gains`; rename → your sheet or
  `renameCompanion` (ids remapped in `uses` and `npcLinks`). After a reply, its new offers are
  toasted; the opening message's once per chat opened, and yours after creation.
- **Kit:** `generateKit(who)`: a Joins `skills` hint → `namedKit`; else with flavour on one call
  (`kitPrompt`, `sendToModel` with the flavour model and answer length, `withTimeout` of
  `flavour.timeoutSeconds`), `parseKit`, at least two usable; else `fallbackKit` from the shipped
  library. Template specs become chat skills (`skillFromTemplate` at the companion's level) on Add.
- **Fights:** `startNewFight` splits rows by `wave` (`engagements`). `finishFight` writes once,
  settles companions (auto-spend), puts `dead` on your sheet after a defeat to the death, and adds
  companions at 0 HP after a fight to the death to `fallen`. `encounterOffer` and the story
  instruction need a living character.
- **Give / take back:** `useItems` takes one of the row out of the Inventory and the item goes on
  the companion's Equipped line (`parseGearEntry(formatGearEntry(item))`); back with `addLoot` as
  equipment, not equipped. **Party file:** `exportParty` → a JSON download; Import reads and
  cleans (`cleanParty`) into `pendingImport` and writes on confirm (your file gear appended to the
  Inventory unless a row of that name exists; chat skills merged; uses, links and fallen reset).
- **Dossier:** shown for a companion with `npcId` while `api('npc-state-delta').openDossier` is a
  function; `openDossier(npcId) === false` → a toast.
- **Story Suite:** `api.manage.tokens()` → `tokenEstimate` of the hand-off waiting, else the story
  instruction while you have a living character and no fight. The settings panel loads
  `src/suite.css` once (`<link id="story-suite-css">`).
