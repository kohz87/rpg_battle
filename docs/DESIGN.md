# RPG Battle: design

Status: **draft for review**, nothing built yet.

RPG Battle is a SillyTavern extension that turns a fight into a game: you press **Start fight**,
choose the enemies, and fight with buttons. Code resolves every attack, skill, item, parley and
escape. The model is not asked anything during the fight; when it ends, it gets one short summary
it must narrate and cannot change.

It is the third piece of a set:

| Extension | Owns |
|---|---|
| **Story Block** | The blocks: the scene, the inventory, and now the Character and Party sheets |
| **Story Director** | The story behind the scenes: agendas, clocks, quests, arcs, places |
| **RPG Battle** | Fights, and the numbers on the Character and Party sheets |

## 1. Principles

1. **Code owns the numbers.** HP, MP, stats, damage, XP and loot are computed, never written by
   the model. The model never sees a formula and never has to do arithmetic.
2. **The model describes, code decides.** An enemy the story invents ("a bog wight") gets its
   numbers from its rank and role; an item the model names gets its stats limited by its rarity.
3. **Combat only.** No buying, renting, eating or quest bookkeeping. Those stay story (and
   Story Director tracks what matters). Mirage RPG tried to make every action mechanical through a
   JSON block on every reply and spent its releases policing the model's wording; RPG Battle asks
   for no block on every reply. The two it may get (§4.2, §8.6) are optional, a line or two of
   fixed words, and code decides what they mean.
4. **A fight starts with a button** and ends with one hand-off. Nothing is inferred from prose:
   the story may offer a fight (§4.2), and the reader presses the button.
5. **Narrated once.** The result is injected into the next reply only; its swipes narrate the
   same result. A lost fight cannot be rerolled by swiping.
6. **Swipe- and delete-safe.** Sheet changes are written into a message, like every Story Block
   block, so deleting messages rolls them back.

What we keep from Mirage RPG (MIT): rank tables (F to SSS), monsters projected from a role and a
rank, seeded rolls, the "pending narration" hand-off with the fight's duration, editable data
files. What we leave behind: the per-reply semantic block, prose evidence matching, commerce,
Guild and quest mechanics, and owning the whole turn.

## 2. What Story Block needs first: blocks kept by an extension

Today a stateful block is rewritten by the model every reply. A sheet the model can rewrite is a
sheet the model can quietly change, so Story Block gets a fourth kind:

| Kind | Model sees it | Model writes it | Who changes it |
|---|---|---|---|
| Stateful | yes | every reply | the model |
| Per-turn / First | no (earlier copies are history) | when prompted | the model |
| **Kept by an extension** (new) | **yes, as current state** | **never** | **the extension that owns it** |

Behaviour:

- The prompt lists it under the current state with "kept by RPG Battle; read it, never write it".
- A copy the model writes anyway is stripped from the reply and ignored (with a status note).
- The owning extension writes it with `StoryBlock.setBlockText(index, tag, text)` (exists since
  0.6), into the latest assistant message, so delete and swipe behave as for any block.
- The block's definition records its owner (`owner: 'rpg-battle'`); RPG Battle creates its two
  blocks from templates when first enabled, and the editor shows them as kept by RPG Battle.
- The display is Story Block's Fields display (meters for HP, MP and XP; numbers for stats).

This is a Story Block release (0.7) that RPG Battle requires.

## 3. The blocks

### 3.1 Character (new, kept by RPG Battle)

Since 0.4 this is the first section of the Party block (§3.2), `## Ren (you)`, with the same
lines (no `Name:`): one kept block for the whole party, one prompt note, the Dice modifier from
your section's Checks line. Older chats' separate Character block is read until the next write
merges it.

```
<Character>
Name: Ren
Level: 4 | XP: 310/400 | Points: 2
HP: 58/62 | MP: 21/30
STR: 9 | VIT: 7 | AGI: 8 | DEX: 8 | INT: 4 | LUK: 5 | CHA: 6
Checks: STR +2 | VIT +1 | AGI +1 | DEX +1 | INT -1 | LUK +0 | CHA +0
State: unhurt
Skills: Rending Strike (Lv 2) | Guard Break | Second Wind
Conditions: none
</Character>
```

- **Checks** are the stat bonuses for rolls outside combat, worked out by code
  (`(stat − 5) ÷ 2`, rounded down, between −3 and +10; in `rules.json`). Story Block's Dice block
  uses them as its modifier (section 12), so a CHA check is `d20 + 0` here, and the model only
  adds one number it can read.
- **Points** are unspent stat points. You spend them in the Battle tab (section 9); the model
  never does.
- **Skills** lists names with their mastery level and, since 0.4.1, the uses toward the next
  one (`Power Strike (Lv 2, 3/12)`, so the progress rolls back with the reply); each skill's numbers live in the skill library
  (section 6), so the block stays short and the model cannot inflate a skill by renaming it.
- **Conditions** that outlast a fight (poisoned, exhausted) are listed until they wear off.
- **State** is HP, MP and conditions in words the model must portray, worked out by code
  (`rules.json` → `narrative`): HP at or above 90 % of max is *unhurt*, 70 % *bruised*, 45 %
  *hurt (aching, favouring a wound)*, 20 % *badly hurt (bleeding, slow to move)*, above 0
  *barely standing (staggering, could fall at any moment)*, 0 *down (unconscious or unable to
  fight)*; MP under 60 % adds *tired of magic*, under 25 % *drained of magic* (never for a max
  MP under 10); then the conditions as words (poison → poisoned, bleed → bleeding). For example
  `State: badly hurt (bleeding, slow to move) · drained of magic · poisoned`. A number does not
  say how to play someone at a fifth of their HP; these words do, and the block's prompt note
  says to portray them exactly and never contradict them (nor let the scene's Visible Condition
  disagree). It is derived, so it is never read back: editing it changes nothing.
- The model sees this every reply, so it knows Ren is hurt, what Ren can do, and how strong Ren is.

### 3.2 Party (new, kept by RPG Battle; since 0.4 it holds your character too)

```
<Party>
## Astra — companion | control: auto
Level: 4 | HP: 44/44 | MP: 38/38
State: unhurt
STR: 4 | VIT: 5 | AGI: 7 | DEX: 6 | INT: 10 | LUK: 4 | CHA: 7
Skills: Ember Lance | Mend | Ward
Equipped: Ashwood Staff (rare) · MATK +7, INT +1 | Traveller's Robe (common) · DEF +2, MDEF +3

## Merrit — hireling | control: command
...
</Party>
```

- One section per companion, with the same stats and State line as the Character block.
- **control: auto** (the companion acts on its own) or **control: command** (you pick its action
  each turn). Switchable per companion in the Battle tab; the default is auto.
- A companion's gear is listed on its section, because the Inventory block is yours.
- Joining and leaving follows the story (0.4): a `<Joins>` or `<Leaves>` is offered, and Add
  companion opens only from a Joins, filled in (§8.7); **Edit** (name, role, control; the sheet
  stays) and **Remove** stay on the card. Companions level with the party (they get the same XP).

### 3.3 Inventory (existing, written by the model; RPG Battle reads equipment and adds loot)

Equipment rows carry their rarity and stats in the note column, and an `equipped` mark:

```
[Equipment > Weapons]
Iron Longsword | 1 | equipped · uncommon · ATK +6, DEX -1
Hunter's Bow | 1 | rare · ATK +5, DEX +2, range
[Equipment > Armour]
Studded Jerkin | 1 | equipped · common · DEF +4
[Consumables]
Healing Draught | 3 | heal 30
Ember Flask | 1 | fire 25, all enemies
```

- **Slots:** weapon, off-hand, armour, worn ×1 (head, hands, feet, waist), accessory ×2; the worn
  and accessory counts are settings (`rules.gear`, 0–9). The first equipped items of each slot
  count, the rest are listed as not counted; the slot comes from the item's kind, the category
  path, or `slot: …` in the note.
- **Stats an item may carry:** `ATK`, `MATK`, `DEF`, `MDEF`, `HP`, `MP`, any of the seven stats,
  `crit`, and tags (`range`, `fire`, `ice`, `holy`, `poison`, `two-handed`).
- **Limits by rarity** (section 5.4): an item's stats are capped by a budget for its rarity and
  the wearer's level. Over-budget stats are scaled down for combat (the Battle tab shows "capped:
  ATK +50 → +9"); the inventory text is not rewritten. An item without stats gets them from its
  rarity and kind. No rarity means common.
- **Consumables** are used in a fight by their note (`heal 30`, `mp 20`, `cure poison`,
  `fire 25`); the quantity goes down by code after the fight.
- **Loot** is written into the Inventory block by RPG Battle, already valid.

## 4. Fights: single, waves and chains

| Shape | Example | How it runs |
|---|---|---|
| **Single** | 3 goblins and a goblin shaman | One fight |
| **Waves** | 3 goblins; 2 more join on round 3 | One continuous fight with reinforcements |
| **Chain** | Rats in the cellar, then the bandits upstairs | Separate fights in sequence; HP, MP, cooldowns reset, conditions carry over. Between fights: Continue, Use item, or Retreat (ends the chain) |
| **Plan** (0.5, as built) | At the gate, then the yard, then the tower | Separate fights in stages, each somewhere else; HP, MP, cooldowns, conditions and items left carry over, nothing heals, the fallen stay down. Between stages: **Go on** or **Fall back** (ends the plan, a withdrawal), nothing else |

The hand-off covers the whole shape, once. (Narrating after every fight of a chain can be an
option; it costs one reply per fight.) The chain was built in 0.5 as the plan (§4.2): the story
writes it, the reader only goes on or falls back, and there is no Use item between stages.

### 4.1 Starting a fight

Since 0.4 a fight starts only from the story (§4.2): its offer opens the setup. Since 0.4.2 the
setup is the story's engagement and stakes as it gave them, read-only, with **Start** and **Not
now**: the story drives, the reader decides whether to fight, not what the fight is. Each line
shows the count, the name (tagged *new* when it will be made up), its power in the reader's
terms, its role, *Boss*, and the story's threat word; engagements after the first are listed in
order; the stakes are said, not chosen. The glue builds the fight from the offer it parsed, never
from what the tab sends, so a changed page changes nothing. The pre-0.4.2 setup, kept for the
record:

- Rows of enemies: **name** (bestiary names autocomplete; any name works), **count**, **rank**
  (F to SSS, suggested from your level), **role** (brute, skirmisher, caster, tank, support).
- **Boss** toggle on a row (×3 HP, a signature skill, cannot be parleyed below half HP).
- **Shape:** single; waves (add a wave and the round it arrives); chain (add the next fight).
- **Stakes:** *Normal* (defeat means the story decides: captured, robbed, left for dead…) or
  *To the death* (defeat is death, and the hand-off says so).
- **Suggest from scene** (optional): one cheap model call reads the last reply and fills the rows
  ("3 goblins, rank E, skirmisher; 1 goblin shaman, rank E, caster"). You confirm or change it.
  Only when pressed. (The other model call RPG Battle makes is the flavour of a made-up
  creature, §7.4, before its first fight; never during a fight.)

### 4.2 Fights from the story

When a fight breaks out in the story, the model is told (in the always-on instruction of §8.6)
to add a hidden `<Encounter>` block naming the foes, `3 bandit, bandit captain (boss)`, and to
stop at the first blow, so the prose does not resolve what the buttons are about to.

- **Grammar:** groups separated by commas, semicolons, new lines or `and`; each is
  `[N ×|N x|N ]name[ (boss)][ rank X][ role]` (also *a*, *two*… and `name ×3`). A plural is made
  singular when the singular is a bestiary creature (*3 bandits* → Bandit) or the last word is
  the plural of a creature word the templates know (*3 bog wights* → Bog Wight); rank and role
  are set only when written. `story.parseEncounter` makes setup rows of it.
- **Threat:** a word for how dangerous a foe is next to the party, in brackets or (for the
  unmistakable ones) before the name: `3 marsh wolf (weak), wolf matriarch (boss, strong)`.
  *trivial* (feeble, puny), *weak* (minor, easy, low, lesser), *even* (fair, matched, equal),
  *strong* (tough, dangerous, high), *deadly* (lethal, overwhelming, elite, calamity). The model
  judges the danger; code sets the level: the Character's level plus `threat.offsets` steps
  (−2, −1, 0, +1, +2), a step being one tier with tier titles on (§5.7) and `threat.step` (4)
  levels otherwise, within 1 and the cap (`story.threatLevel`). A rank or level written outright
  wins; with neither, the fight is even (the fair rank, as before).
- **Sources:** the latest reply's `<Encounter>`, else a fight Story Director planned that the story
  has reached (`StoryDirector.encountersAt(index)`, due first, then due soon), when it is there.
- **Offered, never started:** a toast with **Fight** on the reply, and a notice in the Battle tab,
  *A fight is starting: …*, with **Fight?** (the setup opens with the rows filled in; the reader
  can change anything, stakes default to normal) and **Not now** (that offer, by reply and text,
  is put away). Nothing is offered during a fight or while a result waits to be narrated (0.4.2:
  once its reply is in, the next fight is offered again).
- **Stakes (0.4.2):** a fight to the death is marked after a bar, `<Encounter>3 bandit; then:
  bandit captain (boss) | to the death</Encounter>` (also `| death`, `| stakes: death`, any case);
  without it the stakes are normal. A planned fight's text may carry the same mark. What follows a
  bar is the fight's, never a foe. The instruction says so in nine tokens (§8.6).
- **Plans (0.5):** a place after `then` starts a new stage, a separate fight somewhere else:
  `<Encounter>at the gate: 2 guard (weak); then at the yard: 3 guard (even); then at the tower:
  guard captain (boss, strong) | to the death</Encounter>`. `at <place>:` before the first group
  names stage 1 (optional); `then, at` and `and then at` are read too, any case; a plain `then:`
  is still a wave of the same stage (waves: the same fight, foes arriving one after another;
  stages: the next fight, when the party's plan or the story moves it on). At most five stages;
  the stakes are the whole plan's; Story Director's planned text is read the same way. The offer
  reads *A plan in 3 stages: the gate, the yard, the tower*; the setup lists *Stage 1 of 3: the
  gate* and so on, read-only. Each stage is its own fight (new foes, a fresh round count) with
  the party as the last left it; between stages only **Go on** or **Fall back**. The plan ends in
  victory (every stage won), defeat or flight at a stage, or a withdrawal (Fall back); the stages
  after it never happen. Every cleared stage's XP and loot is kept (the stage lost gives what a
  lost fight gives; to the death, a lost stage is death), written once when the plan ends; the
  hand-off has a line per stage reached and says which were not reached (*Do not narrate it*) or
  not attempted. The plan, between stages too, belongs to the reply it started from (§1, 0.4.3).
- **Read-only (0.4.2):** the setup shows the engagement as code resolved it (bestiary or made-up
  creature, threat words to levels, boss, roles, `then:` engagements); **Fight?** sends nothing
  back, **Start** sends nothing, and without a stored offer there is no fight.

## 5. Numbers

All constants below live in `rules.json` and can be edited.

### 5.1 Stats

| Stat | Does |
|---|---|
| **HP** | Max HP = 30 + VIT × 8 + Level × 4 |
| **MP** | Max MP = 10 + INT × 4 + Level × 2 |
| **STR** | Physical attack = STR × 2 + weapon ATK |
| **VIT** | Max HP; physical defence = VIT + armour DEF |
| **AGI** | Turn order; dodging; fleeing |
| **DEX** | Accuracy; critical chance |
| **INT** | Max MP; magic attack = INT × 2 + MATK; magic defence = (INT + VIT) / 2 + MDEF |
| **LUK** | Critical chance; loot rarity |
| **CHA** | Parley in combat; outside combat it is the social stat the story can use (Story Director's note can mention it) |

**No classes.** A character is its stats and its skills. A new character starts with every stat
at 5 and **10 points** to spend, and (0.4) **no skills**: they come from the story (§8.7); each
level gives **4 points**. XP to next level = 100 × level^1.5 (rounded to 10). There are no presets
for the reader any more; the old spreads stay as internal data for the balance simulation.
A companion is built from up to three **focus stats** in order, weighted 3, 2, 1 (none: evenly),
over every point they have, largest remainder; generic role words suggest the focus.

### 5.2 One attack

1. **Hit:** chance = 75 + (attacker DEX − target AGI) × 3, between 5 and 95 %. Spells never miss
   but can be resisted (see damage).
2. **Critical:** chance = 3 + DEX × 0.5 + LUK, at most 50 %; a critical deals × 1.5.
3. **Damage:** raw = attack × skill power (a basic attack is power 1.0);
   damage = raw² / (raw + defence), × a roll between 0.9 and 1.1, at least 1.
   This keeps defence meaningful at every level without ever making a hit worthless.
4. **Defend** (the action): damage taken × 0.5 until your next turn, and 5 % of max MP back.

### 5.3 Turn order

Initiative = AGI × 2 + DEX + a d6, rolled at the start of each round. Ties go to the party.

### 5.4 Equipment budgets by rarity

| Rarity | Budget (stat points) | Example at level 5 |
|---|---|---|
| Common | 2 + level × 0.5 | 4 |
| Uncommon | 4 + level × 0.8 | 8 |
| Rare | 6 + level × 1.2 | 12 |
| Epic | 9 + level × 1.6 | 17 |
| Legendary | 12 + level × 2 | 22 |

Cost of a stat: ATK, MATK, DEF, MDEF 1 per point; HP 1 per 5; MP 1 per 4; STR to CHA 2 per point;
`crit` 1 per 2 %. Negatives refund half. An item over budget is scaled down proportionally for
combat. An item with no stats gets its budget spent on its kind's main stat (a sword's ATK, a
robe's MDEF…).

### 5.5 Fleeing and parley

- **Flee:** chance = 50 + (party's average AGI − enemies' average AGI) × 4, between 10 and 90 %;
  −30 against a boss. A failed attempt spends the turn. A success ends the fight (the chain too).
- **Parley:** only enemies that talk (people, most monsters with a language; beasts do not).
  Chance = 30 + (CHA − enemy morale) × 5 + 20 if the enemy is below half HP, between 5 and 85 %.
  Success: that enemy (or the whole group, if its leader) surrenders or withdraws; it counts as
  won, for half XP and no loot from it. A failed parley spends the turn and makes it angry
  (+1 morale).

### 5.6 Conditions

A small fixed set, each with a duration in rounds: poison and burn (damage each round), bleed,
stun (lose a turn), slow (acts last), weaken (attack × 0.75), shield (absorbs damage), regen
(heals each round). Poison and exhaustion can outlast a fight and go on the Character block.

### 5.7 Display terms

A lorebook names its own progression ("Soul Class", "Rank", "Circle"; "Soul Growth",
"Experience"), so the words are settings, `terms` in RPG Battle's settings, merged into rules as
`rules.terms` (`src/terms.js`); nothing in the code knows any one world's words:

- `levelName` (default `Level`) and `xpName` (default `XP`).
- `tiers: { size: 10, numerals: 'roman' | 'arabic' }` (off by default): levels 1–10 are
  "<levelName> I", 11–20 "<levelName> II"… With tiers, progress is the share through the
  current tier, 0.00–99.99 of 100 (the XP from the tier's first level to the next tier),
  floored to hundredths and read back rounding up, which is stable and loses at most a
  ten-thousandth of the tier's XP once.
- `cap` (default `character.maxLevel`, 99): no level past it; XP stops there, shown MAX.

Only words change: the numbers, formulas and the balance are the same. The blocks keep the exact
level where a tier would hide it (`Soul Class: III (Lv 24) | Soul Growth: 28.10/100 | Points: 2`;
with names but no tiers `Soul Power: 24 | Power Growth: 5400/11760 | Points: 2`), and the
parsers read the canonical form, any terms form (with or without the colon) and older blocks,
so changing the terms never loses a sheet. The tab, the result screen and the hand-off's XP line
("Soul Growth +12%": the share of the member's tier; "Power Growth +38") use them.

With terms of their own the reader picks an enemy's power as a tier (its first level) or a level,
up to the cap, instead of F–SSS. A level is placed on the tuned rank table (§7.1) by interpolating
linearly between the two ranks whose levels bracket it (past SSS the last step's slope goes on);
the rank at or below it still picks the loot table, money and morale. For a brute without the
±10 % variation: Soul Class II (level 11, a fifth of the way from C to B) has HP 72, attack 37,
defence 11 and 168 XP; Soul Class V (level 41, between S and SS) HP 206, attack 100, defence 29
and 1862 XP. *Auto* is still the fair rank for your level. With the plain terms nothing changes.

## 6. Skills

A skill is a library entry; the Character and Party blocks list only names.

```json
{ "name": "Rending Strike", "type": "physical", "stat": "STR", "power": 1.6, "mp": 6,
  "cooldown": 2, "target": "one", "effect": { "bleed": 2 }, "masteryMax": 5 }
```

- `type`: physical, magic, heal, buff, debuff. `target`: one, all, self, ally, allies.
- **Open, not by class:** a skill may ask for a stat instead (`"requires": { "INT": 8 }`), so
  anyone who builds INT can learn Fireball. Tier 1 skills ask for nothing.
- **Starting skills (0.4):** none at creation; the story's opening message offers them
  (`<Learned>`, with optional hints, without stat requirements). A companion's are generated from
  who they are by one words-only call (library fallback).
- **New skills come from the story.** A mentor teaches a technique, a scroll holds a spell: a
  `<Learned>` offer opens the learn form, filled in, for a library skill or a new one built from
  a template (type, stat, target, element) scaled to the learner's level, which the reader can
  edit. Nothing is learned automatically on level-up, and the model never sets a skill's numbers.
- **Skills in use (0.4):** at most `character.activeSkills` (6) per member; more are kept, set
  aside, and swapped on the card.
- **Mastery:** using a skill in fights raises it (Lv 1 to 5, +10 % power per level); the uses
  toward the next level are written on the Skills line (0.4.1).

## 7. Enemies

### 7.1 Ranks and roles

| Rank | Level | HP | Attack | Defence | XP |
|---|---|---|---|---|---|
| F | 1 | 20 | 14.5 | 4 | 15 |
| E | 3 | 34 | 19 | 5 | 35 |
| D | 6 | 41 | 22 | 7 | 70 |
| C | 10 | 52 | 29.5 | 10 | 140 |
| B | 15 | 70 | 38 | 13 | 280 |
| A | 22 | 94 | 50 | 17 | 560 |
| S | 32 | 128 | 68 | 23 | 1100 |
| SS | 45 | 172 | 90 | 31 | 2200 |
| SSS | 60 | 224 | 116 | 40 | 4500 |

(Tuned in 0.1 by the balance simulation: 300 seeded solo fights per level against three enemies
of the fair rank give a median of 5 rounds and 40–49 % HP lost at levels 1, 5 and 10.)

Roles weight those numbers: **brute** (HP × 1.3, attack × 1.2, AGI low), **skirmisher** (AGI and
DEX high, HP × 0.8), **caster** (magic attack, MP, HP × 0.7), **tank** (defence × 1.6, attack ×
0.7), **support** (heals and buffs allies). Each individual varies by up to ±10 %, from the seed.

These numbers are a starting point. Version 0.1 tunes them with a simulation (thousands of
seeded fights in the test suite) towards a target: an even fight (same level, party of one,
three enemies of the matching rank), fought to the end, lasts 4 to 6 rounds and costs about half
your HP. A parley or an escape can of course end it sooner.

### 7.2 The bestiary

`bestiary.json`: named creatures with their rank, role, overrides, skills, morale, whether they
talk, when they flee, and their loot. A name not in the bestiary is projected from the row's rank
and role; its name is kept, so the story's bog wight stays a bog wight. Since 0.3 the
projection gets a template first: the name is made up as its kind (§7.4) and kept in the chat.

```json
{ "name": "Goblin Shaman", "rank": "E", "role": "caster", "talks": true, "morale": 4,
  "fleesBelow": 0.3, "skills": ["Hex", "Spark"], "loot": "goblin-caster" }
```

### 7.3 Enemy behaviour

Simple and predictable: attack the target with the lowest HP share; casters use their best skill
when they have the MP; supports heal an ally below 40 %; anyone at `fleesBelow` tries to flee.
Companions on *auto* use the same rules from the party's side (heal first, then the strongest
affordable skill, then attack).

### 7.4 Generated creatures

A name neither the chat's bestiary nor the shipped one knows is **made up when its fight
starts**, without asking: the story keeps inventing foes, and a projection from rank × role
alone makes every one of them fight alike.

- **Template by keyword** (`templates.js`): the name's words pick one of *beast, undead,
  humanoid, leader, caster, construct, ooze, insect, drake, spirit, plant* or *generic*. What a
  creature is beats what it does (a *skeleton mage* is undead and casts; a *goblin shaman* is a
  caster); among natures the last word wins, since a name ends on its head noun (*bone golem*:
  construct). Leader words (captain, chief, boss, warlord, lord, king, matriarch, alpha…) make a
  humanoid a **leader** and give any other kind the `leader` trait. Plurals and compounds are
  read too (*wolves*, *hellhound*).
- **What a template gives:** a role; traits (`armoured` +DEF −AGI, `swift` +AGI −HP, `slow`,
  `frail`, `hulking` +HP −AGI, `fierce`, `leader`: multipliers in `generated.traits`, their
  product within `modMin`–`modMax`, 0.6–1.5; `venomous`, `fiery`, `savage`, `chilling` put
  poison, burn, bleed or slow on the first harmful skill; `regenerating` adds a self-heal over
  time); whether it talks (people and casters yes; beasts, undead, constructs, oozes no); a
  temperament (`generated.temperaments`: morale and the flee threshold; + `moralePerRank` per rank
  index; a leader + `leaderMorale` and fleeing no sooner than `leaderFleesBelow`); two skills from
  its kind's four (the first, its signature, always; the rest by the seed), three from
  `extraSkillLevel` (8) and for leaders and bosses; a loot table: its kind's materials named for
  it (*Marsh Wolf Pelt*, *Wolf Fang*), at most one piece of gear whose rarity follows its rank
  (`generated.gearRarity`) and whose stat is `gearBudgetShare` of that rarity's budget at its
  level, and its rank's potion.
- **Skills** are stored as specs (name, type, stat, target, conditions, cooldown) and built at
  the level the creature is fought at by `skills.creatureSkill`: `skillFromTemplate`'s numbers
  × `generated.skillPower` (0.65, since a made-up creature has two or three in rotation), no MP
  for a physical one, conditions for `generated.effectRounds` rounds, a stun waiting at least
  `stunCooldown` rounds. Tuned by the balance simulation: an even solo fight against three
  made-up foes takes a median of 6 rounds and costs 44–55 % HP at levels 1, 5 and 10 (against
  projected ones 5 rounds and 36–50 %).
- **Deterministic:** the same name, level and seed (the chat's id) give the same creature.
- **Flavour** (`flavour.js`, on by default): one call per new creature, at most four per fight,
  before the fight starts (*Preparing foes…*), within one deadline for all (30 s); on a
  connection profile the calls go out together, on the chat's own model one after another.
  The prompt gives the name, its power and the party's in the reader's terms, the template
  (kind, role, traits, temperament, talks, its skills with their words, its loot) and the last
  ~300 words of the story, and asks for six lines of words: `look`, `traits`, `talks`,
  `temperament`, `skills` (one per template skill, `Name — words`), `loot`
  (`name (rarity[, stat])`). Code reads them leniently and maps them: known traits replace the
  template's (a leader stays one); skills are renamed in order, their words set the target
  (*all foes*, *self*, *ally*…), a type when clear (*heal*, a shield or guard with nothing
  harmful, *magic*, a *curse*) and the conditions (*grab* is slow, *drain* weaken…); loot is
  renamed (a stat makes it gear, valued again from the budget; a potion's name renames the
  potion), rarity at most one step above the creature's. Every number in the answer is dropped,
  money ("300 gold") is no item, and the numbers are worked out again from the words. A failed,
  slow or empty answer leaves the template creature, with a console note.
- **The chat's bestiary:** made-up creatures are kept in the chat's metadata
  (`rpgBattle.bestiary`, at most 200, cleaned with `templates.cleanCreature` whenever stored), so
  a name is the same creature for the rest of the story, at its own level when a row names no
  power. Lookup order: the chat's bestiary, the shipped bestiary, then make it up. The Battle
  tab's Bestiary fold lists them with Regenerate (a new seed, flavoured again), Forget, Export
  and Import (JSON; cleaned on the way in, so a hand-edited file cannot carry numbers its words
  do not give, except gear stats, which equipping caps by rarity anyway).

## 8. The end of a fight

### 8.1 Results, applied by code

- **Outcome:** victory, defeat, fled, or parleyed (per enemy).
- **XP:** each defeated enemy's XP × a level factor (×1.5 when it outranks you, down to ×0.1 when
  far below); half for parleyed enemies; split evenly across the party, not divided.
- **Level-ups:** HP and MP maxima rise; points are added to spend.
- **Loot:** from the bestiary's tables or the rank's defaults; rarity rolled with LUK; money (8.3).
  Written into the Inventory block. Since 0.4.2 only foes that would carry coin drop money:
  people, their leaders and casters (and a drake boss on its hoard); a wolf leaves a pelt or a
  fang instead, its first material made likelier (`loot.coinlessMaterial`, 85 %). The shipped
  bestiary says so per creature (`coins`), a made-up one by its template.
- **Sheets:** HP, MP, conditions, skill mastery, consumables used.

### 8.2 The hand-off (narrated once)

Injected into the next reply as a system note at depth 1, exactly once:

```
[Battle resolved by RPG Battle: narrate this outcome, do not change it]
Victory in 4 rounds (about 30 seconds).
Ren: HP 34/62, MP 12/30 — hurt (aching, favouring a wound) · tired of magic.
Astra: HP 44/44, MP 20/38 — unhurt · tired of magic.
Key moments: the shaman's hex missed Ren; Ren's Rending Strike crit the second goblin;
Astra's Ember Lance finished the shaman; one goblin fled toward the weir.
Loot: 14 copper, a bone fetish. XP +38 each.
```

- One line per member, ending in the same words as the sheets' State line (someone down gets
  only the words), so the narration and the next reply's sheets agree on how hurt everyone is.
- The key moments are the few that matter (crits, finishing blows, flights, parleys, near-deaths),
  chosen by code, at most six lines.
- A defeat at normal stakes ends "Defeated: the story decides what follows (captured, robbed, left
  for dead)". At *to the death*, "Defeated: Ren is killed." Death is game over.
- The hand-off is attached to the next reply that is generated; that reply's swipes reuse it, and
  it is not injected again after that. **Return to story** in the Battle tab can also send a short
  message for you ("*(the fight ends)*") so the narration comes straight away.

### 8.3 Money

Your lorebook already names the money, so the currency is a setting:

| Setting | Loot reads | Inventory line |
|---|---|---|
| **Copper / silver / gold** (default) | 1 gold = 10 silver = 100 copper (rates editable) | `Coins \| 1 gold, 3 silver, 4 copper` |
| **One coin** | a single unit, named as you like ("coins", "credits") | `Coins \| 134` |
| **Your own** | names and rates from your world, e.g. bits, marks (= 12 bits), crowns (= 20 marks) | `Purse \| 2 crowns, 5 marks` |

Loot is counted in the smallest unit and written out in the largest ones. The line it adds to is
the inventory row named in the setting (`Coins` by default); the model keeps spending from it in
the story as it does now.

### 8.4 With Story Director

- The model writes Story Director change lines for what the fight leaves behind (a goblin that
  fled becomes an agenda, the fetish becomes a hook), as it does for any reply.
- The fight's duration is in the hand-off, so the scene clock moves on correctly.

### 8.5 Recovery

HP and MP come back as the story says, never by the model's hand:

- **Story time** (Story Director's clock, `StoryDirector.timeAt`): after each reply, the hours it
  moved on from the reply before give back `recovery.perHour` (5 %) of max HP and MP per hour; a
  gap of `recovery.longRestHours` (6) or more is a full rest. Written into that reply from the
  sheets before it, so a swipe or an edit recomputes rather than adds.
- **Short rest** (`recovery.shortRestShare`, a quarter) and **Long rest** (full; fight conditions
  end, story conditions stay) in the Battle tab.
- **Items at camp:** heal, MP and cure effects from the Inventory block; damage items are for fights.

A character at 0 HP cannot start a fight until they recover.

### 8.6 Story wounds

The story also hurts and heals between fights. Left to the numbers alone, the sheet says
*unhurt* while the prose says bleeding, and the State line (§3.1) then makes the model portray
the wrong thing. So while a Character block exists, one short instruction (about 105 tokens
with §4.2's encounter and threat words, its own prompt key at depth 1, not on quiet or
impersonate generations, not while a fight is under way or narrated) asks for a hidden `<Wounds>` block, one line per person on the sheets:

```
<Wounds>
Ren — wound: fell down the ravine
Astra — poisoned: a dart in the dark
</Wounds>
```

- **Words, not numbers:** `scratch`, `wound`, `severe`, `grievous` take 10, 30, 50 and 80 % of max
  HP (`rules.json` → `wounds`); `heal <word>` (also *healed*, *treated*) gives that share back,
  never above max; any other short word adds a condition; `cure <condition>` removes one. Harm
  can take someone to 0 HP. The instruction says to pick the mildest word that fits.
- **One blow per person per reply:** the first harm or heal line counts. Names are matched to
  the Character sheet or a Party member, case-insensitively, also by first name; others are
  ignored.
- **One pipeline after each reply:** the sheets before the reply, then story-time recovery
  (§8.5), then the wounds, written once into that reply. A swipe recomputes it, a continue does
  not double it, and a reply whose sheets something else has written since (a rest, an item, a
  fight) is left alone.
- **Undo:** a toast and the Battle tab say what happened ("Ren: wound (−29 HP), fell down the
  ravine.") with **Undo**, while that reply's sheets are still the ones the pipeline wrote. Undo
  rewrites them without the wounds (recovery kept) and remembers the reply's `<Wounds>` text as
  undone, so the pipeline does not bring it back.
- **Story Block's Character Sheet** (its own block, an HP the model writes) disagrees with this
  one; while both are on, the Battle tab and the settings say so and offer **Turn it off**.

### 8.7 The party's story (0.4)

The same instruction (§8.6, about 185 tokens since 0.5) asks for `<Joins>`, `<Leaves>`, `<Learned>`,
`<XP>minor|major|milestone: why</XP>` and `<Rest>short|long: why</Rest>`, each only when the
story makes it true; Story Director 0.8.2 adds quests closed in a reply. Every one is an
**offer** (Accept / Not now, per reply text, from the latest reply and the opening message),
never applied on its own. XP is a share of the member's next level (10/25/50 %, quests 5–25 % by
difficulty), each at their own level, through the fight's level-up path; companions on auto spend
new points by their build. A rest and story time in one reply count once (the larger, not the
sum). A fight lost to the death leaves `dead` on your sheet: game over until Start over.

## 9. The Party and Battle tabs

Since 0.4: a **Party** tab, always there while RPG Battle is on (the party as cards, yours first
and open; what the story offers; the wounds line with Undo; the Bestiary), and a **Battle** tab
only while there is a battle (the story's offer, the setup, the fight, the result until it goes
back to the story). The kept Party block has no tab of its own (Story Block 0.9.1). No free
fight, rest, skill or companion: the story brings them. What follows is the 0.3 layout.

- **Idle:** your sheet at a glance (HP and MP bars with the State words under them, level, unspent points with **Spend**), the
  party with their control mode, skills, **Start fight**; a fight the story offers (**Fight?** /
  **Not now**, §4.2), the latest story wounds with **Undo** (§8.6), and a quiet note when Story
  Block's Character Sheet is also on.
- **Spend points:** + and − per stat, the effect on HP, MP and attacks shown live, **Confirm**.
- **Setup:** section 4.1.
- **Fight:** enemy cards with HP bars and conditions; your party's bars; the turn-order strip;
  the log (last lines, scrollable); the action bar: **Attack · Skill · Item · Defend · Parley ·
  Flee** and **Auto** (the rest of the fight on auto). Target picking by tapping a card. On a
  phone the action bar sits at the bottom, thumb-sized.
- **Result:** the outcome, what changed, the hand-off text, **Return to story** and **Done** (0.4.2:
  no Discard; the result always reaches the story, so numbers and narrative agree). The hand-off
  waits until a reply narrates it; once that reply is in, the waiting notice goes (its swipes
  still narrate it), a newer reply spends it, and deleting the narrating reply makes it wait again.

## 10. Storage, swipes and the seed

- A fight is stored in the chat's metadata under its id: setup, seed, every action, the log and
  the result. Replaying the actions with the seed gives the same fight, so a reload mid-fight
  resumes exactly.
- The sheets are written into the latest assistant message when the fight ends; deleting that
  message rolls the sheets back (and the fight is marked undone).
- The hand-off is tied to the next generated reply (section 8.2).

## 11. Data files

All editable JSON, exported and imported from the settings:

| File | Holds |
|---|---|
| `rules.json` | Every constant in section 5: formulas, budgets, XP curve, flee and parley numbers |
| `bestiary.json` | Named creatures, rank and role tables, loot tables |
| `skills.json` | The skill library (tiers, requirements) and the optional presets |
| `items.json` | Rarity budgets, slot names, stat costs, default stats per item kind |

Defaults ship with the extension; your edits are kept across updates.

## 12. Roadmap

| Version | Adds |
|---|---|
| Story Block 0.7 | Blocks kept by an extension; the Dice block reads its modifier from the Character block's Checks line |
| 0.1 | Character block, starter skills and presets, spending points, Learn skill, Start fight (single), the fight with Attack / Skill / Defend / Flee, results and XP, the hand-off |
| 0.2 | Equipment from the Inventory block with rarity budgets, consumables, loot and money into the inventory, Parley, conditions |
| 0.3 | Party block, companions on auto or command, waves and chains, Suggest from scene |
| 0.4 | Bestiary, rules, skills and items as editable files; mastery; bosses |

## 13. Rolls outside combat: the Dice block

Checks outside a fight (persuading a guard, climbing a wall) stay with Story Block's **Dice**
block, which already rolls the die in code before the reply and hands the model the numbers.
With RPG Battle on, its modifier comes from the Character block's **Checks** line instead of the
model's judgement of "competence on the page": a CHA check is `d20 + CHA bonus` against the
difficulty. The Dice block's instruction says so when a Character block exists (a small Story
Block change, listed in the roadmap). RPG Battle adds no check command of its own.

## 14. Decisions so far

| Question | Decision |
|---|---|
| Classes | None: open stats and skills; no presets (0.4); companions by focus stats |
| Levelling | XP gives levels; you spend the points yourself |
| Losing | The story decides (captured, robbed, left for dead); at *to the death* stakes, death is game over |
| Skills | Three starter skills; new ones from the story, added by hand; skills may require a stat |
| Equipment | From the Inventory block, capped by rarity and level |
| Companions | Included; one Party block with your character (0.4); auto or command per companion; joining from the story |
| Starting a fight | From the story only (0.4), offered; narrated once at the end |
| Fight shapes | Single, waves and chains |
| Money | A setting: copper/silver/gold, one coin, or your world's own names and rates |
| Checks outside combat | Story Block's Dice block, with modifiers from the Character block |
| Wounds outside combat | Words in a hidden `<Wounds>` block (scratch, wound, severe, grievous); code sets the HP, one blow per person per reply, with Undo |
| Fights the story starts | Named in a hidden `<Encounter>` block (or planned by Story Director) and offered; the reader presses Fight |
| Threat in an encounter | A word relative to the party (trivial…deadly); code turns it into a level in steps of 4 levels or one tier |
| Foes nobody wrote up | Made up from a keyword template when the fight starts, flavoured by one words-only model call, kept per chat |
| Balance | An even fight fought to the end lasts 4 to 6 rounds |
| Mirage RPG | Retired; its tables and hand-off idea borrowed |

## 15. Still open

1. **Licence:** GPL-3.0 like the other two, or MIT like Mirage? Either works with what we borrow.
2. ~~Presets to ship~~: none (0.4); the spreads stay internal for the balance simulation.
