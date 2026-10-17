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
   JSON block on every reply and spent its releases policing the model's wording; RPG Battle has
   no per-reply protocol at all.
4. **A fight starts with a button** and ends with one hand-off. Nothing is inferred from prose.
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

```
<Character>
Name: Ren
Level: 4 | XP: 310/400 | Points: 2
HP: 58/62 | MP: 21/30
STR: 9 | VIT: 7 | AGI: 8 | DEX: 8 | INT: 4 | LUK: 5 | CHA: 6
Checks: STR +2 | VIT +1 | AGI +1 | DEX +1 | INT -1 | LUK +0 | CHA +0
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
- **Skills** lists names (and mastery level); each skill's numbers live in the skill library
  (section 6), so the block stays short and the model cannot inflate a skill by renaming it.
- **Conditions** that outlast a fight (poisoned, exhausted) are listed until they wear off.
- The model sees this every reply, so it knows Ren is hurt, what Ren can do, and how strong Ren is.

### 3.2 Party (new, kept by RPG Battle, separate so solo stories can switch it off)

```
<Party>
## Astra — companion | control: auto
Level: 4 | HP: 44/44 | MP: 38/38
STR: 4 | VIT: 5 | AGI: 7 | DEX: 6 | INT: 10 | LUK: 4 | CHA: 7
Skills: Ember Lance | Mend | Ward
Equipped: Ashwood Staff (rare) · MATK +7, INT +1 | Traveller's Robe (common) · DEF +2, MDEF +3

## Merrit — hireling | control: command
...
</Party>
```

- One section per companion, with the same stats as the Character block.
- **control: auto** (the companion acts on its own) or **control: command** (you pick its action
  each turn). Switchable per companion in the Battle tab; the default is auto.
- A companion's gear is listed on its section, because the Inventory block is yours.
- Joining and leaving follows the story: the Battle tab offers **Add companion** (from a name in
  the scene, with a starter template) and **Remove**. Companions level with the party (they get
  the same XP).

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

- **Slots:** weapon, off-hand, armour, accessory ×2. The first equipped item of each slot counts;
  the slot comes from the category path, or `slot: …` in the note.
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

The hand-off covers the whole shape, once. (Narrating after every fight of a chain can be an
option; it costs one reply per fight.)

### 4.1 Starting a fight

**Start fight** in the Battle tab (and a ⚔ button by the message box) opens the setup:

- Rows of enemies: **name** (bestiary names autocomplete; any name works), **count**, **rank**
  (F to SSS, suggested from your level), **role** (brute, skirmisher, caster, tank, support).
- **Boss** toggle on a row (×3 HP, a signature skill, cannot be parleyed below half HP).
- **Shape:** single; waves (add a wave and the round it arrives); chain (add the next fight).
- **Stakes:** *Normal* (defeat means the story decides: captured, robbed, left for dead…) or
  *To the death* (defeat is death, and the hand-off says so).
- **Suggest from scene** (optional): one cheap model call reads the last reply and fills the rows
  ("3 goblins, rank E, skirmisher; 1 goblin shaman, rank E, caster"). You confirm or change it.
  This is the only model call RPG Battle ever makes, and only when pressed.

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
at 5, **10 points** to spend and **three starter skills** picked from the library's first tier
(section 6); each level gives **4 points**. XP to next level = 100 × level^1.5 (rounded to 10).
Optional presets (a "fighter" spread, a "caster" spread…) only fill in the points and suggest
skills, as a shortcut; they are not a class and change nothing afterwards.

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

## 6. Skills

A skill is a library entry; the Character and Party blocks list only names.

```json
{ "name": "Rending Strike", "type": "physical", "stat": "STR", "power": 1.6, "mp": 6,
  "cooldown": 2, "target": "one", "effect": { "bleed": 2 }, "masteryMax": 5 }
```

- `type`: physical, magic, heal, buff, debuff. `target`: one, all, self, ally, allies.
- **Open, not by class:** a skill may ask for a stat instead (`"requires": { "INT": 8 }`), so
  anyone who builds INT can learn Fireball. Tier 1 skills ask for nothing.
- **Starter skills:** three from tier 1, picked when the character is made.
- **New skills come from the story, added by hand.** A mentor teaches a technique, a scroll holds
  a spell: in the Battle tab, **Learn skill** takes a name and either a library skill or a new
  one built from a template (type, stat, target) scaled to your level, which you can edit.
  Nothing is learned automatically on level-up, and the model never sets a skill's numbers.
- **Mastery:** using a skill in fights raises it (Lv 1 to 5, +10 % power per level).

## 7. Enemies

### 7.1 Ranks and roles

| Rank | Level | HP | Attack | Defence | XP |
|---|---|---|---|---|---|
| F | 1 | 30 | 8 | 3 | 15 |
| E | 3 | 55 | 12 | 5 | 35 |
| D | 6 | 95 | 18 | 8 | 70 |
| C | 10 | 160 | 26 | 12 | 140 |
| B | 15 | 260 | 36 | 17 | 280 |
| A | 22 | 420 | 50 | 24 | 560 |
| S | 32 | 700 | 68 | 33 | 1100 |
| SS | 45 | 1150 | 92 | 45 | 2200 |
| SSS | 60 | 1900 | 125 | 60 | 4500 |

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
and role; its name is kept, so the story's bog wight stays a bog wight.

```json
{ "name": "Goblin Shaman", "rank": "E", "role": "caster", "talks": true, "morale": 4,
  "fleesBelow": 0.3, "skills": ["Hex", "Spark"], "loot": "goblin-caster" }
```

### 7.3 Enemy behaviour

Simple and predictable: attack the target with the lowest HP share; casters use their best skill
when they have the MP; supports heal an ally below 40 %; anyone at `fleesBelow` tries to flee.
Companions on *auto* use the same rules from the party's side (heal first, then the strongest
affordable skill, then attack).

## 8. The end of a fight

### 8.1 Results, applied by code

- **Outcome:** victory, defeat, fled, or parleyed (per enemy).
- **XP:** each defeated enemy's XP × a level factor (×1.5 when it outranks you, down to ×0.1 when
  far below); half for parleyed enemies; split evenly across the party, not divided.
- **Level-ups:** HP and MP maxima rise; points are added to spend.
- **Loot:** from the bestiary's tables or the rank's defaults; rarity rolled with LUK; money (8.3).
  Written into the Inventory block.
- **Sheets:** HP, MP, conditions, skill mastery, consumables used.

### 8.2 The hand-off (narrated once)

Injected into the next reply as a system note at depth 1, exactly once:

```
[Battle resolved by RPG Battle: narrate this outcome, do not change it]
Victory in 4 rounds (about 30 seconds).
Ren: HP 34/62, MP 12/30. Astra: HP 44/44, MP 20/38.
Key moments: the shaman's hex missed Ren; Ren's Rending Strike crit the second goblin;
Astra's Ember Lance finished the shaman; one goblin fled toward the weir.
Loot: 14 copper, a bone fetish. XP +38 each.
```

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

## 9. The Battle tab

A Story Block tab, always visible while RPG Battle is on.

- **Idle:** your sheet at a glance (HP and MP bars, level, unspent points with **Spend**), the
  party with their control mode, skills, **Start fight**.
- **Spend points:** + and − per stat, the effect on HP, MP and attacks shown live, **Confirm**.
- **Setup:** section 4.1.
- **Fight:** enemy cards with HP bars and conditions; your party's bars; the turn-order strip;
  the log (last lines, scrollable); the action bar: **Attack · Skill · Item · Defend · Parley ·
  Flee** and **Auto** (the rest of the fight on auto). Target picking by tapping a card. On a
  phone the action bar sits at the bottom, thumb-sized.
- **Result:** the outcome, what changed, the hand-off text, **Return to story**.

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
| Classes | None: open stats and skills; presets are only shortcuts |
| Levelling | XP gives levels; you spend the points yourself |
| Losing | The story decides (captured, robbed, left for dead); at *to the death* stakes, death is game over |
| Skills | Three starter skills; new ones from the story, added by hand; skills may require a stat |
| Equipment | From the Inventory block, capped by rarity and level |
| Companions | Included; a separate Party block; auto or command per companion |
| Starting a fight | A button; narrated once at the end |
| Fight shapes | Single, waves and chains |
| Money | A setting: copper/silver/gold, one coin, or your world's own names and rates |
| Checks outside combat | Story Block's Dice block, with modifiers from the Character block |
| Balance | An even fight fought to the end lasts 4 to 6 rounds |
| Mirage RPG | Retired; its tables and hand-off idea borrowed |

## 15. Still open

1. **Licence:** GPL-3.0 like the other two, or MIT like Mirage? Either works with what we borrow.
2. **Presets to ship:** fighter, skirmisher, caster, healer, archer spreads, or none at all?
