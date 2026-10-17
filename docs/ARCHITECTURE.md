# RPG Battle: module contract

How the code is split, and the exact shapes passed between modules. Read with
[DESIGN.md](DESIGN.md). Every module under `src/` except `src/ui/` is **pure**: no DOM, no
globals, no SillyTavern, no `Math.random` (randomness only through `rng.js`). `index.js` is the
only SillyTavern glue.

Plain ES modules, no dependencies, Node.js 24. `npm run check` (syntax) and `npm test`
(`node:test`, files `tests/*.test.js`) must pass. UI tests use `tests/ui-fake-dom.js`.
House style: 4-space indent, single quotes, semicolons, a short comment block at the top of each
module saying what it is for, comments that explain why rather than what.

```
src/rules.js      constants and formulas (written)          tests/rules.test.js
src/rng.js        seeded randomness (written)               tests/rng.test.js
src/skills.js     skill library, presets, templates         tests/skills.test.js
src/enemies.js    ranks × roles projection, bestiary, loot  tests/enemies.test.js
src/combat.js     the fight state machine                   tests/combat.test.js, tests/balance.test.js
src/sheet.js      Character and Party blocks                tests/sheet.test.js
src/items.js      inventory: equipment, consumables, money  tests/items.test.js
src/handoff.js    the narration hand-off text               tests/handoff.test.js
src/ui/tab.js     the Battle tab                            tests/ui-tab.test.js
style.css         all styles
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

Sheet = {                                                 // the Character block, parsed
  name, level, xp, points,
  hp: { cur, max }, mp: { cur, max },
  stats: Stats,
  skills: [{ name, mastery }],                            // mastery 1…5
  conditions: [{ name, rounds }],                         // rounds null = until rest / removed
  uses: { [skillName]: number },                          // fight uses toward the next mastery (not shown)
}

Member = { id, name, role, control: 'auto' | 'command', sheet: Sheet, gear: [Item] }   // a Party section

Item = {                                                  // an inventory row, parsed
  name, qty, category: 'A > B' | '',
  equipped: boolean, rarity: 'common' | … | 'legendary',
  slot: 'weapon' | 'offhand' | 'armour' | 'accessory' | null,
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
  xp: number, loot: string | null,                        // enemies: base XP and loot table id
  gone: null | 'down' | 'fled' | 'parleyed',
  memberId: string | null,                                // party: 'pc' or the Party member id
}
```

## `src/rules.js` (written)

`STATS, RARITIES, RANKS, DEFAULT_RULES, makeRules(overrides)`, and formulas:
`maxHp(stats, level, rules, bonus)`, `maxMp(…)`, `derive(stats, gear, rules) → { patk, matk, pdef,
mdef, crit }`, `checkModifier(stat, rules)`, `checkModifiers(stats, rules)`, `xpToNext(level,
rules)`, `hitChance(dex, agi, rules)`, `mitigate(raw, defence)`, `xpFactor(memberLevel,
enemyLevel, rules)`, `suggestRank(level, rules)`, `fleeChance(partyAgi, enemyAgi, { boss }, rules)`,
`parleyChance(cha, morale, hpShare, rules)`, `rarityBudget(rarity, level, rules)`.

## `src/rng.js` (written)

`hashSeed(text)`, `makeRng(seed) → { next, int(lo, hi), chance(pct), between(lo, hi), pick(list),
state() }`.

## `src/skills.js`

```js
export const DEFAULT_SKILLS: Skill[]          // ≥ 12 tier-1 (no requirements), ≥ 10 tier-2/3 with requires
export const PRESETS: [{ id, name, points: { STR: n, … } (sums to rules.character.startPoints), skills: [3 tier-1 names] }]
                                              // fighter, skirmisher, caster, healer, archer
export function findSkill(library, name) → Skill | null          // case/space-insensitive
export function canLearn(stats, skill) → { ok, missing: { [stat]: needed } }
export function skillFromTemplate({ name, type, stat, target }, level, rules) → Skill
                                              // a story-taught skill: power/mp/cooldown scaled to level and type
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
export function projectEnemy({ name, rank, role, boss }, { bestiary, library, rules, rng, id }) → Combatant
    // bestiary entry if found (its rank/role unless the row gives one), else rank × role tables;
    // stats from the rank's numbers (attack → patk/matk by role, defence → pdef/mdef), ±variation from rng;
    // boss multipliers; level from rank; morale default 3 + rank index; talks default false for
    // unknown names unless role is caster/support; fleesBelow default 0.25 (bosses 0).
export function rollLoot(enemy, { rng, luck, rules }) → { items: [Item-like { name, qty, rarity, kind, stats }], money: number }
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
  party: [{ memberId, name, hp: { cur, max }, mp: { cur, max }, down: boolean, conditions: [{ name, rounds }] }],
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

The Character block text (DESIGN §3.1), one field per `Label: value` segment, segments joined
with ` | ` on the lines shown:

```
Name: Ren
Level: 4 | XP: 310/400 | Points: 2
HP: 58/62 | MP: 21/30
STR: 9 | VIT: 7 | AGI: 8 | DEX: 8 | INT: 4 | LUK: 5 | CHA: 6
Checks: STR +2 | VIT +1 | AGI +1 | DEX +1 | INT -1 | LUK +0 | CHA +0
Skills: Rending Strike (Lv 2) | Guard Break | Second Wind
Conditions: none
```

```js
export function newSheet({ name, stats, skills }, rules) → Sheet        // level 1, HP/MP full, validates startPoints spent
export function parseCharacter(text, rules) → { sheet: Sheet | null, errors: [string] }   // lenient (bold labels, order)
export function formatCharacter(sheet, rules) → string                  // the canonical text above (Checks computed)
export function parseParty(text, rules) → { members: Member[], errors }
export function formatParty(members, rules) → string
    // ## Name — role | control: auto
    // Level / HP / MP / stats / Skills lines as the Character block; Equipped: Item (rarity) · stats | …
export function spendPoints(sheet, allocation: { STR: n, … }, rules) → Sheet   // throws when over budget or negative
export function learnSkill(sheet, name) → Sheet                          // adds at mastery 1, no duplicates
export function applyResult(sheet, memberId, result, rules) → { sheet, levelsGained, pointsGained, masteryGained: [names] }
    // HP/MP from result.party; XP added, levels while xp ≥ xpToNext (max HP/MP recomputed and
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
export function equipped(items) → { weapon, offhand, armour, accessory: [two] }   // first equipped per slot
export function gearBonuses(items, level, rules) → { ATK, MATK, DEF, MDEF, HP, MP, STR…, crit, capped: [{ name, from, to }] }
export function consumables(items) → Item[]                              // rows with an effect (heal 30, mp 20, cure poison, fire 25 all)
export function formatMoney(amount, currency) → string                   // '1 gold, 3 silver, 4 copper' | '134 coins'
export function parseMoney(text, currency) → number                      // the inverse, in the smallest unit
export function addLoot(inventoryText, { items, money }, currency) → string
    // the money added to the currency row (created under [Money] if missing), items added as rows
    // (stacking a same-named row's Qty), equipment with rarity and stats in the note.
export function useItems(inventoryText, used: { [name]: n }) → string     // quantities down, a row at 0 removed
```

## `src/handoff.js`

```js
export function buildHandoff(result, { names, currency, stakes, pcName }) → string   // DESIGN §8.2, exact header line:
// [Battle resolved by RPG Battle: narrate this outcome, do not change it]
```

Defeat lines: normal stakes → `Defeated: the story decides what follows (captured, robbed, left
for dead).`; death stakes → `Defeated: <pc> is killed.` Fled → `Escaped after N rounds.` Loot and
XP lines only on victory.

## `src/ui/tab.js`

```js
export function renderBattleTab(pane, view, handlers)
```

`view.mode` and its data:

| mode | data | handlers used |
|---|---|---|
| `create` | `{ presets, library (tier 1), rules }` | `onCreate({ name, stats, skills })` |
| `idle` | `{ sheet, checks, skills: resolved, party: [Member], rules, pending: handoff text or null }` | `onSpend()` (opens spend), `onLearn()`, `onSetup()`, `onReturn()` |
| `spend` | `{ sheet, rules }` | `onConfirmSpend(allocation)`, `onBack()` |
| `learn` | `{ sheet, library, rules }` | `onConfirmLearn({ name, fromLibrary? , template? })`, `onBack()` |
| `setup` | `{ bestiary names, suggestedRank, rules }` | `onStart({ rows: [{ name, count, rank, role, boss }], stakes })`, `onBack()` |
| `fight` | `{ fight, actions: availableActions(fight) }` | `onAction(action)`, `onAuto()` |
| `result` | `{ result, handoff, levelsGained, pointsGained }` | `onReturn()`, `onDiscard()`, `onDone()` |

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

## `src/ui/settings.js`

`renderSettings(container, { settings, version, status, onChange })`: the on/off switch, the
currency (mode, tiers as `name=rate, …`, single coin name, money row) and the block tags.

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
