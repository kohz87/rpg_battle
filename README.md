# RPG Battle v0.3.0

Turn-based fights for SillyTavern, resolved in code. Press **Start fight**, choose the enemies,
fight with buttons (**Attack, Skill, Item, Defend, Parley, Flee, Auto**), and the story gets one
short summary to narrate. No model calls during the fight, no arithmetic for the model, and a
lost fight cannot be rerolled by swiping.

Needs [Story Block](https://github.com/kohz87/Story_block) **0.7** or newer. With
[Story Director](https://github.com/kohz87/Story_director) **0.7.2** or newer, HP and MP also come
back as story time passes; with **0.8**, the fights it plans are offered when the story reaches
them.

## Install

1. Install Story Block 0.7+ and enable it.
2. **Extensions → Install extension**, paste `https://github.com/kohz87/rpg_battle`, reload.
3. Story Block's sidebar gets a **Battle** tab. Settings are under **Extensions → RPG Battle**.

## Your character

The first time you open the Battle tab, you make your character: a name, **10 points** to spread
over seven stats that all start at 5, and **three starter skills**. There are no classes; the
presets (fighter, skirmisher, caster, healer, archer) only fill in the points and suggest skills.

| Stat | Does |
|---|---|
| **STR** | Physical attack |
| **VIT** | Max HP and defence |
| **AGI** | Turn order, dodging, fleeing |
| **DEX** | Accuracy and critical hits |
| **INT** | Max MP, magic attack and resistance |
| **LUK** | Critical hits and loot |
| **CHA** | Parley in a fight; the social stat outside one |

Your sheet is the **Character** block, kept by RPG Battle: the model reads it every reply (so it
knows you are hurt, how strong you are and what you can do) and never writes it.

```
Name: Ren
Level: 1 | XP: 72/100 | Points: 0
HP: 61/98 | MP: 15/32
STR: 9 | VIT: 8 | AGI: 6 | DEX: 7 | INT: 5 | LUK: 5 | CHA: 5
Checks: STR +2 | VIT +1 | AGI +0 | DEX +1 | INT +0 | LUK +0 | CHA +0
State: hurt (aching, favouring a wound) · tired of magic
Skills: Power Strike | Sweep | Second Wind
Conditions: none
```

- **Levels:** XP from fights; each level gives **4 points** you spend yourself (**Spend** in the
  Battle tab).
- **Skills:** learned from the story, added by hand (**Learn skill**): one from the library (some
  need a stat, like INT 8 for Fireball) or a new one built from a template for your level. Using
  a skill in fights raises its mastery (Lv 1 to 5).
- **Recovery:** see below.
- **State:** your HP, MP and conditions in words (*unhurt*, *bruised*, *hurt*, *badly hurt*,
  *barely standing*, *down*; *tired* or *drained of magic*; *poisoned*…), worked out by RPG
  Battle. The model is told to portray you exactly as it says, so a character at a fifth of
  their HP is written bleeding and slow, not fighting on unbothered. Companions get one too.
- **Checks outside fights:** the **Checks** line is your bonus per stat. With Story Block's Dice
  block on, the dice use it as the modifier (a CHA check is d20 + your CHA bonus).

**Story Block's own Character Sheet block** (a template with an HP meter the model writes) does
the same job by guesswork. With both on, the story reads two HP values that disagree, so the
Battle tab and RPG Battle's settings say so, with a **Turn it off** button. It is never turned
off for you.

## Recovery

HP and MP come back the way the story says:

- **As story time passes** (with Story Director): after each reply, the time it moved on from
  the reply before heals the party, **5 % of max HP and MP per hour**; **6 hours or more** is a
  full rest (fight conditions like poison end). A note in the Battle tab says what happened
  ("8 hours passed: Ren is fully rested."). It is written into that reply, so a swipe or an edit
  recomputes it instead of adding it twice. Switch: *Recover HP and MP as story time passes*.
- **Short rest:** a quarter of max HP and MP back (an hour's breather).
- **Long rest:** full HP and MP; fight conditions end. For what the clock cannot see, or without
  Story Director.
- **Use item:** a consumable used at camp (`heal 30`, `mp 20`, `cure poison`) on you or a
  companion; it comes off the inventory. Damage items stay for fights.

A character at 0 HP cannot start a fight until they recover.

## Story wounds

The story hurts people between fights too: a fall, a poisoned cup, a healer's poultice. While
you have a Character block, the model is told (in about 90 tokens) to add a hidden **Wounds**
block when that happens to someone on your Character or Party sheet, one line each, in words,
never numbers:

```
<Wounds>
Ren — wound: fell down the ravine
Astra — poisoned: a dart in the dark
Ren — heal scratch: a poultice
Astra — cure poison: an antidote
</Wounds>
```

| Word | Share of max HP |
|---|---|
| **scratch** | 10 % |
| **wound** | 30 % |
| **severe** | 50 % |
| **grievous** | 80 % |

- **Harm** can take someone to 0 HP (down); **heal** (or *healed*, *treated*) gives the same share
  back, never above max. Any other word (*poisoned*, *exhausted*, *bleeding*) adds a condition;
  **cure** removes one. The shares are `wounds` in `rules.json`.
- **One blow per person per reply:** the first harm or heal line for someone counts, the rest are
  ignored; conditions may come alongside.
- **Names** are your Character's or a companion's, in any case, also by first name ("Ren" is
  Ren Aldane). Anyone else (an NPC) is left to the story.
- **Applied after the reply, into that reply**, after story-time recovery, from the sheets before
  it: a swipe recomputes it and a continue does not add it twice. Not during a fight, and not in
  the reply that narrates one (the fight already dealt its wounds).
- **Undo:** a toast says what happened ("Ren: wound (−29 HP), fell down the ravine.") with an
  **Undo** button, and the Battle tab shows the same line with **Undo** while that reply's sheets
  are still the ones it wrote (after a rest, an item or a fight, they have moved on). Undo keeps
  the recovery and the wounds stay undone for that reply.

The Wounds block never shows in the story: Story Block hides it with its other blocks.

## Equipment and loot: your Inventory block

RPG Battle reads equipment from Story Block's **Inventory** block. Mark what you wear as
`equipped` and give it a rarity and stats:

```
[Equipment > Weapons]
Iron Longsword | 1 | equipped · uncommon · ATK +6, DEX -1
[Equipment > Armour]
Studded Jerkin | 1 | equipped · common · DEF +4
[Consumables]
Healing Draught | 2 | heal 30
```

- **Stats are limited by rarity and your level** (common < uncommon < rare < epic < legendary),
  so an item the model makes up cannot carry "ATK +50": in a fight it is scaled down to what its
  rarity allows, and the Battle tab shows it as capped. An item without stats gets them from its
  rarity and kind.
- **Consumables** with an effect (`heal 30`, `mp 20`, `cure poison`, `fire 25, all enemies`) can
  be used in a fight; what you use comes off the inventory afterwards.
- **Loot** from a won fight is written into the inventory, money into your money row.

## A fight

1. **Start fight**: name the enemies (the bestiary autocompletes; any name works), how many, and
   optionally a rank (F to SSS), a role (brute, skirmisher, caster, tank, support) and **Boss**.
   Leave the rank on *auto* for the bestiary's rank or a fair one for your level. Choose the
   stakes: *Normal* (defeat means the story decides: captured, robbed, left for dead) or *To the
   death* (defeat is death: game over).
2. **Fight**: on your turn pick an action and tap a target. Enemies (and companions on *auto*)
   act on their own, by simple predictable rules. **Auto** plays the rest of the fight for you.
3. **The result**: outcome, HP and MP left, XP, loot and the key moments are applied to your
   sheet and inventory, and a short summary waits for the next reply:

```
[Battle resolved by RPG Battle: narrate this outcome, do not change it]
Victory in 5 rounds (about 30 seconds).
Ren: HP 61/98, MP 15/32.
Key moments: Ren finishes the Goblin A; Critical! Ren's Power Strike hits the Goblin Shaman for 34.
Loot: 1 silver, 3 copper, a goblin ear, a shaman's charm. XP +72.
```

**Return to story** sends a short message for you so the narration comes straight away. The
summary is given to that one reply only; its swipes narrate the same result.

## Fights from the story

When a fight breaks out in the story, the model adds a hidden **Encounter** block naming the
foes and stops at the first blow, so the fight itself is yours to play:

```
<Encounter>3 bandit, bandit captain (boss)</Encounter>
```

A toast and the Battle tab offer it: *A fight is starting: 3 bandit, bandit captain (boss)*,
**Fight?** or **Not now**. **Fight?** opens the setup with the rows filled in (three Bandits, one
Bandit Captain as a boss, normal stakes); change anything before **Start**. **Not now** puts the
offer away for that reply. Groups are separated by commas, `and` or new lines; each is a count
(`3`, `3 x`, `two`, `a`), the name, and optionally `(boss)`, `rank D` and a role. A plural is made
singular when the bestiary knows the creature ("3 bandits" → Bandit); any other name is kept.

With Story Director 0.8, a fight it has planned (a beat with foes, now due or due soon) is
offered the same way, with its name and place.

## Money

Your lorebook names the money, so the currency is a setting: **copper / silver / gold** (rates
editable), **one coin** named as you like, or **your own** names and rates (for example
`bits=1, marks=12, crowns=20`). Loot is added to the inventory row named in the setting
(`Coins` by default).

## Companions

**Add companion** in the Battle tab brings someone the story introduced into the party: a name,
a role, the level they join at (yours by default), a build (the presets spread their points and
give three starter skills), who controls them, and optionally their equipment, one item per line
(`Ashwood Staff (rare) · MATK +7, INT +1`, capped by rarity like yours).

They live in the **Party** block, kept by RPG Battle like the Character block, fight beside you
(acting on their own, or on your command: tap to switch), get the same XP, rest and recover with
you, and can be **Removed** (it asks twice) when they leave the story.

## Development

Plain ES modules, no dependencies, Node.js 24:

```sh
npm run check   # syntax check
npm test        # node:test suites, including a balance simulation
```

The design is in [docs/DESIGN.md](docs/DESIGN.md), the module contract in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

To be decided (Story Block and Story Director are GPL-3.0). Mirage RPG Suite, whose rank tables
and hand-off idea it borrows, is MIT, which fits either.
