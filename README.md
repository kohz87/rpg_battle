# RPG Battle v0.3.3

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
The name starts as your SillyTavern persona's (and follows it if you switch persona before
typing); type another if your character goes by a different name.

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

## Your world's terms

Your lorebook may not say "Level" and "XP". Under **Extensions → RPG Battle → Terms** you name
them, and the sheets, the Battle tab and the fight summaries use your words (the numbers stay
the same):

- **Level name** (`Level` by default): *Rank*, *Circle*, *Soul Power*, *Soul Class*…
- **XP name** (`XP` by default): *Experience*, *Power Growth*, *Soul Growth*…
- **Tier titles** (off by default): levels 1–10 are *Soul Class I*, 11–20 *Soul Class II*… (the
  tier size and Roman or Arabic numerals are yours). Progress is then shown as how far you are
  through the tier, out of 100.
- **Level cap** (99 by default): no level past it; XP stops there and shows **MAX**.

With tier titles on, the Character block's level line reads

```
Soul Class: III (Lv 24) | Soul Growth: 28.10/100 | Points: 2
```

and with names of your own but no tiers `Soul Power: 24 | Power Growth: 5400/11760 | Points: 2`.
The exact level always stays in the block, so changing or turning off the terms never loses a
sheet. With your own terms, **Start fight** picks an enemy's power as one of your tiers (or
levels) instead of F to SSS, a story's `<Encounter>` may name one (`3 wolf (Soul Class I)`), and
a won fight says `Soul Growth +12%` (or `Power Growth +38`).

**Story Block's own Character Sheet block** (a template with an HP meter the model writes) does
the same job by guesswork. With both on, the story reads two HP values that disagree, so the
Battle tab and RPG Battle's settings say so, with a **Turn it off** button. It is never turned
off for you. If you keep both on purpose, choose **The other one** for *Stats* under **Source of
truth** (below) and the notice goes away.

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
you have a Character block, the model is told (in about 100 tokens, with the encounter and
threat words below) to add a hidden **Wounds** block when that happens to someone on your
Character or Party sheet, one line each, in words, never numbers:

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

- **What counts in a fight:** one weapon, one off-hand (none with a two-handed weapon), one
  armour, **one worn piece** (helm, gloves, boots, belt…) and **two accessories** (rings,
  amulets, charms…). Equip more and only the first of each, in inventory order, counts; the
  Battle tab's **Gear** list shows what the fight uses and names the rest as *not counted* (and
  why). **Settings → Equipment** changes how many worn pieces and accessories count (0 to 9).
  The slot comes from the item's kind, its category (`[Equipment > Boots]`) or `slot: worn` /
  `slot: accessory` in its note.
- **Stats are limited by rarity and your level** (common < uncommon < rare < epic < legendary),
  so an item the model makes up cannot carry "ATK +50": in a fight it is scaled down to what its
  rarity allows, and the Battle tab's Gear list shows it as capped ("STR +2 · capped from STR +20"). An item without stats gets them from its
  rarity and kind.
- **Consumables** with an effect (`heal 30`, `mp 20`, `cure poison`, `fire 25, all enemies`) can
  be used in a fight; what you use comes off the inventory afterwards.
- **Loot** from a won fight is written into the inventory, money into your money row.

## A fight

1. **Start fight**: name the enemies (the bestiary autocompletes; any name works, and one it
   does not know is made up, see *Monsters on the fly*), how many, and
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
singular when the bestiary knows the creature ("3 bandits" → Bandit) or its last word is a
creature word ("3 bog wights" → Bog Wight); any other name is kept.

The model may also say **how dangerous** a foe is, relative to the party, in one word:

```
<Encounter>3 marsh wolf (weak), wolf matriarch (boss, strong)</Encounter>
```

| Word (and its synonyms) | Power |
|---|---|
| **trivial** (feeble, puny) | 2 steps below the party's level |
| **weak** (minor, easy, low, lesser) | 1 step below |
| **even** (fair, matched, equal) | the party's level |
| **strong** (tough, dangerous, high) | 1 step above |
| **deadly** (lethal, overwhelming, elite, calamity) | 2 steps above |

A step is **4 levels**, or **one tier** when your terms have tier titles (`threat` in
`rules.json`). The word goes in brackets, or before the name for the unmistakable ones
(`3 weak marsh wolves`; "Lesser Demon" and "High Priest" stay names). A power written outright
(`rank D`, `level 12`, `Soul Class II`) wins over it; with neither, the fight is even.

With Story Director 0.8, a fight it has planned (a beat with foes, now due or due soon) is
offered the same way, with its name and place.

## Monsters on the fly

The bestiary knows twenty creatures; the story knows many more. A name it does not know is
**made up when its fight starts**, automatically:

1. **From a template** (free, instant). The name's words pick one: *beast* (wolf, hound, boar,
   bear…), *undead* (ghoul, wight, skeleton, lich…), *humanoid* (bandit, thug, soldier, knight…),
   *leader* (a captain, chief, warlord or lord of them), *caster* (shaman, witch, mage, priest…),
   *construct* (golem, sentinel, automaton…), *ooze* (slime, jelly), *insect* (spider, scorpion,
   wasp…), *drake* (drake, wyvern, dragon, lizard…), *spirit* (ghost, wisp, elemental…), *plant*
   (treant, vine, shambler…), or a plain fallback. What it is beats what it does (a *skeleton
   mage* is undead that casts), and a leader word on any kind makes it a leader of its kind (a
   *wolf matriarch* is a beast with a leader's nerve). The template gives it a role, **traits**
   (*armoured*, *swift*, *slow*, *frail*, *hulking*, *fierce*, *venomous*, *fiery*, *savage*,
   *chilling*, *regenerating*), whether it **talks** (people and casters do; beasts, the dead,
   constructs and oozes do not), a **temperament** (*relentless*, *mindless*, *disciplined*,
   *proud*, *cunning*, *wild*, *cowardly*: its morale in a parley and when it flees), **two or
   three skills** of its kind (*Bite*, *Pounce*, *Howl*; *Bone Claw*, *Grave Chill*…), built
   by the skill machinery at the power it is fought at, and a **loot table** of its kind
   (*Marsh Wolf Pelt*, *Wolf Fang*, now and then a *Wolf-fang Charm*) whose gear rarity follows
   its power.
2. **Flavoured by the model** (on by default, one short call per new creature, at most four per
   fight). The model gets the name, its power in your terms, the template and the last few
   hundred words of the story, and answers in **words only**:

   ```
   look: a drowned knight in rusted mail, marsh-light swinging from its ribs
   traits: armoured, slow
   talks: no
   temperament: relentless
   skills: Drowning Grip — grab, weaken; Marsh Stench — all foes, poison
   loot: bog-iron shard (common), wight's lantern (rare, MATK)
   ```

   Code maps the words onto the template's knobs (known traits, conditions, targets and stat
   names only), renames the skills and the loot, and works every number out again from the
   rules. A number the model writes is ignored, so is a word it does not know, and a rarity is
   at most one step above what the creature's power drops. If the call fails, times out (30
   seconds for all of a fight's creatures) or there is no model, the creature stays the
   template one, silently (a note in the console). The setup says *Preparing foes…* meanwhile.

The creature is then **kept in the chat** (its metadata), so the same name is the same creature
for the rest of the story, with its own level when a later fight names no power. Names are
looked up in this story's creatures first, then the shipped bestiary, and only then made up.

- **Setup:** a name nobody knows is tagged **new**; in the fight, its card is too (its look is
  the card's tooltip).
- **Bestiary** (a fold on the Battle tab): this story's creatures with their power in your
  terms, role, traits and look; **Regenerate** makes one again (and flavours it again),
  **Forget** drops it (the name is made up anew next time). **Export** saves the list as JSON,
  **Import** adds one (cleaned like anything stored: known words only, every number worked out
  again).
- **Settings → Monsters:** flavour on or off, the model (the chat's own, or a connection
  profile, as in Story Director; a small fast one is enough), and the answer length (400 tokens).

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
you, and can be **Removed** (it asks twice) when they leave the story. **Edit** changes a
companion's name, role and who controls them; their sheet, skills and gear stay as they are
(their skill mastery progress follows them through a rename).

## With the other extensions

RPG Battle works alone (with Story Block). Beside Story Block, Story Director and NPC State Delta,
the extensions find each other through the **Story Suite** handshake and agree on who is the
source of truth for each area, so the model is not told the same thing twice; see
[docs/STORY_SUITE.md](docs/STORY_SUITE.md).

- RPG Battle offers **stats** (HP, MP, stats, skills, fights) and **rolls** (the Checks line as
  the Dice modifier), and **items** after Story Block's Inventory (it reads gear from it and
  writes loot into it either way).
- It shares its party with the others: the Character and each companion with their level (in
  your terms), HP, MP and State words, as the sheets say.
- **Settings → Source of truth:** for *Stats*, *Roll modifiers* and *Items*, **Automatic** (the
  specialist for the area), **This extension** or **The other one**, with who the story follows
  now. For *Stats*, it decides whether Story Block's Character Sheet is pointed out as a second
  HP: with **The other one** the notice stays away, and RPG Battle still keeps its own sheets for
  its fights. With RPG Battle alone, every choice works like Automatic.
- **Story Suite overlay:** with two or more installed, Story Block's *Story Suite* overlay sets
  the source of truth for all of them in one table and switches RPG Battle on or off; *Manage all
  in Story Suite* at the top of RPG Battle's settings opens it
  ([docs/STORY_SUITE.md](docs/STORY_SUITE.md#one-place-to-manage-them-all)).

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
