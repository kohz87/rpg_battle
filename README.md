# RPG Battle v2.0.0-alpha.1

> **Story Suite v2 is being built on the `v2` branch.** On `v2`, RPG Battle is a module of Story Block v2 (it needs Story Block 2 and shows one line in the drawer without it): the party, creation, checks, items, combat, battle board, return-in-time, trade and screens parts are merged into one module (`src/v2/module.js`, loaded by `index.js`), with Story Block's screens for Party, Trade, Crafting, Fight, the HUD, the card under each reply and the character creation wizard (the party's things are in Story Block's Inventory, with RPG Battle's details in each row); the v1 glue is kept in `v1.js` but not loaded. Progress for the whole suite: [Story Block docs/v2/STATUS.md](https://github.com/kohz87/Story_block/blob/v2/docs/v2/STATUS.md). The rest of this README describes v1 until v2 is released.


Turn-based fights for SillyTavern, resolved in code, and a party that grows with the story.
When the story starts a fight, RPG Battle offers it: **Fight?** shows the foes and the stakes as
the story gave them, **Start** begins it, you fight with buttons (**Attack, Skill, Item, Defend,
Parley, Flee, Auto**), and the story gets one short summary to narrate. No model calls during the fight, no arithmetic for the model, and a lost
fight cannot be rerolled by swiping.

The story drives, you decide: fights, rests, new skills, companions joining or leaving and XP
for what the party achieves all come from the story as **offers** you accept or put away. There
is no free fight, rest or skill on demand; code sets every number. A fight is the story's too:
you choose whether to fight it, not who you fight or what is at stake.

Needs [Story Block](https://github.com/kohz87/Story_block) **0.7** or newer. With
[Story Director](https://github.com/kohz87/Story_director) **0.7.2** or newer, HP and MP also come
back as story time passes; with **0.8**, the fights it plans are offered when the story reaches
them.

## On the `v2` branch: gear, crafting and screens

These are RPG Battle 2 (Story Suite v2 beta, needs Story Block 2). The player guide,
[Story Block docs/v2/GUIDE.md](https://github.com/kohz87/Story_block/blob/v2/docs/v2/GUIDE.md), tells
each in full. Every one can be switched off in Story Suite settings → **Features**.

**Gear: wear, repair and refinement** (features *Gear wear and repair*, *Gear refinement*)
- A piece is good, worn (85% of its stats), tattered (60%) or broken (none, but it stays on).
- Armour wears with the damage taken in a fight, a weapon a little each fight. The story can say a piece
  suffered (`~ item Coat — torn | wear: scuff|tear|ruin`), and code decides how much.
- Repair kits patch a piece in the field (`! use Repair Kit | on: Coat`). Each patch takes a little off
  how good it can get until a proper repair.
- A smith or tailor repairs a piece to full for a fee (`! repair Chain Shirt | at: smith`, or on the
  Trade screen).
- A smith refines a piece to +1, +2 or +3 for materials and a fee (+8% stats a level, shown in the
  name). The +3 attempt can fail and leave it at +2.
- Repairing or refining and then selling never brings in more than selling the piece as it was.

**Crafting** (feature *Crafting*)
- Crafting is told by the story and refereed by code: `! craft Healing Salve | with: Bluecap Moss x2`.
  Companions craft too, with their own stats.
- The craft takes the reply's own dice. Code adds the stats for that craft, the craft skill, tools and
  material quality against the recipe's difficulty. The result is fail (half the materials lost), made,
  fine, masterwork, or botched on a natural 1.
- Stations come from the place (a smith's forge, an apothecary's alchemy table, `at: campfire` in the
  wild).
- Recipes come from the pack or are learned in the story (`+ recipe Name | from: Hollis`).
- **The carry limit is respected:** if the party couldn't carry what a craft makes, the whole craft is
  refused and nothing is used up.
- A made thing is worth what went into it. Key items count as worth nothing.
- With Story Director, the clock moves on by the recipe's time.

**Screens**
- **One bag.** RPG Battle has no Items screen any more. Each row of Story Block's Inventory shows RPG
  Battle's details: slot and stats, who wears it, condition and refinement, and for a potion what it
  does and whom it would help now. **Equip on…**, **Take off** and **Give…** are there too.
- **Party cards.** Each card shows the member's stats, what they wear (with condition and refinement),
  active effects, carry load and when they are encumbered.
- **Companion switches** on each companion's card: **In fights** (*On their own* / *You lead*) and
  **Stat points** (*By build* / *By hand*).
- **Crafting screen.** It is read-only: each character's craft skills and recipes, with materials had
  and needed, the station, the difficulty and the chances. You craft in the story.
- **Character creation.** In a new chat you make your character before the story goes on. The
  wizard opens from **Create your character** on the Party tab, **Create** on the status strip (and on
  the card under a reply), **Create your character** on Home's *Before you start* card (Story Block),
  or by itself when you send a message without a character. A pack's ready-made character (the Ersveil
  pack's *Wessel (kit)*) fills in race, talents and points on the first step; the name, background and
  portrait are your persona's. **Random** appears on the Talents step only (with **Keep it**), and
  "Points left" is said once per step.
- **Character file.** **Save character file** on your own Party card exports your character. **Import
  character** on the wizard's first step brings one into a new chat. Its things are held to that
  chat's rules.
- The status strip shows points to spend and effects under way.

The screenshots below are from RPG Battle 1. There are no v2 screenshots here yet, because the current
ones were taken before the encumbered line was added to the Party cards.

## Screenshots

A three-stage plan from a demo session with [Story Block](https://github.com/kohz87/Story_block), [Story Director](https://github.com/kohz87/Story_director) and [NPC State Delta](https://github.com/kohz87/npc_state_delta). The story wrote `<Encounter>at the reed bank: 3 young wolf (weak); then at the den mouth: 2 wolf (weak); then inside the den: old dog wolf (boss, even)</Encounter>`.

| The plan, as the story gave it | A fight | Between stages | The result |
| --- | --- | --- | --- |
| <img src="docs/images/plan.png" alt="The plan in three stages with its foes and stakes, and only Not now and Start" width="200"> | <img src="docs/images/fight.png" alt="Round 3: three young wolves, Ren and Lyra, the log and the action buttons" width="200"> | <img src="docs/images/between.png" alt="Stage 1 of 3 cleared: the party now, the next stage, Fall back and Go on" width="200"> | <img src="docs/images/result.png" alt="Victory in three stages: per-stage lines, the party after the plan, XP, a level, loot and key moments" width="200"> |

| The party (Ren and Lyra) | The offer in the Battle tab |
| --- | --- |
| <img src="docs/images/party.png" alt="Ren's card: level, HP and MP, stats with checks, unspent points, skills, gear; the waiting hand-off notice above" width="200"> | <img src="docs/images/offer.png" alt="A plan in 3 stages offered: Fight? or Not now" width="200"> |

| Monster families: the Bestiary | Levels, threat and XP per foe |
| --- | --- |
| <img src="docs/images/bestiary.png" alt="The Bestiary grouped under Canines: wolves, a Razor Dog made up as kin of the Old Dog Wolf, a Feral Ditch-Dog as kin of the Razor Dog" width="220"> | <img src="docs/images/setup-xp.png" alt="Setup: 2 Ditch-Dog, Lv 1, weak, about 5 XP each; then a Razor Dog, Lv 5, strong, about 20 XP" width="220"> |

A new kind in a family the story already knows (a razor dog after the wolves) is made up as **kin** of its relative: same behaviour, moves and kind of loot, its own level and XP.

<img src="docs/images/next-moves.png" alt="After a victory, What next?: skin the wolves, follow the wolf that got away, look around, press on; Just continue and Done" width="220">

**What next?** after a fight: a click puts a move in the message box, Shift-click sends it. Optional, with its own model (Settings → **After a fight**, since 0.5.17).

## Install

1. Install Story Block 0.7+ and enable it.
2. **Extensions → Install extension**, paste `https://github.com/kohz87/rpg_battle`, reload.
3. Story Block's sidebar gets a **Party** tab (always, while RPG Battle is on) and a **Battle** tab
   (only while there is a battle). Settings are under **Extensions → RPG Battle**.

## Your character

The first time you open the **Party** tab, you make your character: a name (your SillyTavern
persona's to start with; it follows a persona switch until you type another) and **10 points**
to spread over seven stats that all start at 5. That is all: there are no classes, and a new
character has **no skills**. Skills come from the story (see *The story's offers* and *For card
authors* below); without any, a character still attacks, defends, uses items, parleys and flees.

| Stat | Does |
|---|---|
| **STR** | Physical attack, some stamina |
| **VIT** | Max HP, defence and stamina |
| **AGI** | Speed (how often you act), dodging, fleeing, a little stamina |
| **DEX** | Accuracy and critical hits |
| **INT** | Max MP, magic attack and resistance |
| **LUK** | Critical hits and loot |
| **CHA** | Parley in a fight; the social stat outside one |

Your sheet is the first section of the **Party** block, kept by RPG Battle: the model reads it
every reply (so it knows you are hurt, how strong you are and what you can do) and never writes
it. Your companions follow in the same block.

```
## Ren (you)
Level: 1 | XP: 72/100 | Points: 0
HP: 61/98 | MP: 15/32 | SP: 31/40
STR: 9 | VIT: 8 | AGI: 6 | DEX: 7 | INT: 5 | LUK: 5 | CHA: 5
Checks: STR +2 | VIT +1 | AGI +0 | DEX +1 | INT +0 | LUK +0 | CHA +0
State: hurt (aching, favouring a wound) · tired of magic
Skills: Power Strike (Lv 2, 3/12) | Sweep (Lv 1, 4/5) | Shadow Step (Lv 1, 0/5)
Conditions: none

## Lyra — healer | control: auto
Level: 3 | XP: 0/100 | Points: 0
HP: 138/138 | MP: 80/80 | SP: 48/48
State: unhurt
STR: 5 | VIT: 12 | AGI: 5 | DEX: 5 | INT: 16 | LUK: 5 | CHA: 5
Skills: Frost Lance (Lv 1, 2/5) | Mend (Lv 3, 9/22)
```

- **The Party tab** shows the party as cards: yours first and open, each companion folded to its
  name, level, HP and MP and State. Open, a card has the stats (with checks for you), the
  skills in use and set aside, the gear, and its controls. Which cards are open is kept while
  you play.
- **Combat numbers** (since 0.5.13), under the stats with the gear counted: *Attack 16 · Magic
  10 · Defence 8 · M.Def 6 · Hit 78% · Dodge 34% · Crit 12.5%*. Attack is STR × 2 and magic
  INT × 2, plus gear; defence is VIT plus armour; magic defence (INT + VIT) ÷ 2 plus gear. A
  physical attack hits 75% of the time, +3% per point of the attacker's DEX over the target's
  AGI (5% to 95%); spells never miss. Hit and Dodge are against a typical foe of the member's
  level, since the real chance depends on who they face. Hover a number for where it comes from.
- **Levels:** XP from fights and from the story (*XP and levels* below); each level gives **4
  points** you spend yourself (**Spend** on your card; Settings → Party → *Points per level*
  changes the 4, 1 to 20, since 0.5.14).
- **Stamina (SP)** (since 0.5.29) is what **physical skills** cost; magic, heals, buffs and
  debuffs cost **MP**. Max SP is 10 + VIT × 2 + STR + AGI ÷ 2 + level × 2 (`derived.sp…` in `rules.json`; AGI since 0.5.30),
  so a fighter's skills no longer depend on INT. In a fight a little comes back at the start of
  each of your turns (5 % of max, at least 1) and Defend gives back 15 % more; out of one, any rest
  fills it and story time brings it back fast (all of it in an hour). Running low shows in the
  State line as *breathing hard*, then *winded*. A sheet from before 0.5.29 has no SP line and
  starts fresh; foes have no stamina (their physical skills cost nothing, as before).
- **Skills:** learned from the story (a `<Learned>` offer opens the learn form, prefilled; a
  library skill keeps its stat requirements, like INT 9 for Fireball). Each skill runs on one
  stat, shown on its card (*physical · AGI · 4 SP · cooldown 1 · one enemy*). Using a skill in fights
  raises its mastery (Lv 1 to 5): 5 uses take it to Lv 2, 12 more to Lv 3, then 22 and 35
  (`masteryUses` in `rules.json`).
- **On the card**, each skill shows its mastery and fight uses toward the next level, `Lv 2 ·
  3/12` (`Lv 5 · max` at the top; hover for it in words). The result screen's **Gains** names the
  skills that reached a new level in that fight: `Mastery: Sidestep Cut Lv 2 · Lyra's Mend Lv 3`.
- **The Skills line** writes each skill's mastery and its uses toward the next level:
  `Power Strike (Lv 2, 3/12)` is mastery 2, 3 of the 12 uses to Lv 3; `(Lv 5, max)` at the top.
  The progress is in the block like everything else, so deleting, swiping or editing the reply
  that wrote a fight's result takes it back with the HP and XP. Lines from older chats
  (`Power Strike (Lv 2)`) read as no progress yet; a chat from before 0.4.1, which kept the
  progress out of the block, has it written into the block the first time it is open.
- **Skills in use:** a member fights with at most **6** skills (*Settings → Party*, 3 to 12).
  More are kept, **set aside** (a `Set aside:` line in the block), in a **Set aside** fold on the
  card, closed until you open it. **Set aside** moves a skill there; **Use** brings one back
  while there is room, and at the cap **Swap in** asks which skill in use it takes the place of,
  in one click. Learning one past the cap asks which sits out. An older sheet over the cap keeps
  its first six in use.
- **Forget** (the eraser on a set-aside skill, asks twice) drops a skill for good, its mastery
  and progress with it; learning it again starts at Lv 1. Skills in use are set aside first. Like
  every sheet change, it is written into the latest reply, so deleting or swiping that reply
  brings the skill back.
- **State:** your HP, MP and conditions in words (*unhurt*, *bruised*, *hurt*, *badly hurt*,
  *barely standing*, *down*; *tired* or *drained of magic*; *poisoned*…), worked out by RPG
  Battle. The model is told to portray you exactly as it says, so a character at a fifth of
  their HP is written bleeding and slow, not fighting on unbothered. Companions get one too.
- **Checks outside fights:** the **Checks** line in your section is your bonus per stat. With
  Story Block's Dice block on, the dice use it as the modifier (a CHA check is d20 + your CHA
  bonus).
- **Start over** (on your card, it asks twice): your sheet is cleared, and the companions too
  unless *Keep companions* is ticked; creation opens. Nothing is carried over; there is no
  respec.
- **Death:** losing a fight *to the death* ends your character's story. The sheet reads `State:
  dead`, the hand-off tells the model plainly, and the Party tab shows *Ren has died.* with
  **Start over**. Delete or swipe the reply that wrote it and it is undone, like any sheet change.
- **Party file:** *Party file → Export party* saves your character and companions (sheets, skills,
  gear) as JSON; **Import party** (there, and on the creation screen) loads one into this chat
  after you confirm. It is cleaned on the way in (names, bounds, max HP and MP worked out again,
  story-taught skills built again); your equipped gear in the file goes into the Inventory, not
  equipped, unless a row of that name is already there.
- **Persona rename:** switch your SillyTavern persona to another name while your character still
  has the old one, and the Party tab offers *Rename Ren to Kael?*, once.

Older chats kept your sheet in a separate **Character** block. RPG Battle still reads it, and
writes it into the Party block as your section the first time the chat is open; the old block is
no longer kept, shown to the model or given a tab.

## XP and levels

Every number is code's: the story only says what happened (a fight, how big an achievement was,
how hard a quest), never how much XP. **Every level needs 100 XP** (since 0.5.2; `xpBase` 100 and
`xpExponent` 0 in `rules.json`'s `character`, so a curve can be set again: before 0.5.2 it was
100 × level^1.5), and every gain is a share of **each member's own next level**, so with a curve
it would still mean the same at level 2 and level 40. Each 100 is one level, 4 points, the rest
carried over; companions level the same way.

**Fights (0.5.2).** Each defeated foe is worth, to each member:

- **a tenth** of the XP that member needs for their next level for an **even** foe (its level
  is theirs);
- **× the band of the level gap** (foe − member, in plain levels, also with tier titles; 0.5.3):

  | Gap | Threat | Factor | XP |
  | --- | --- | --- | --- |
  | +8 or more | deadly | ×4 | 40 |
  | +4 to +7 | strong | ×2 | 20 |
  | −3 to +3 | even | ×1 | 10 |
  | −4 to −7 | weak | ×½ | 5 |
  | −8 or less | trivial | ×¼ | 3 |

  (`xp` in `rules.json`: `even`, `bands`, `below`). A foe with a level of its own shows the
  threat its gap is ("Lv 9 · deadly");
- **×3** for a boss; **half** for a foe won over by **Parley** instead of beaten;
- **× your XP rate** (below); rounded, at least 1.

Every member gets the full amount for every foe: XP is **not split** across the party, and a
companion at another level counts it against their own. With 100 to a level that is, at any
level, **10** for an even foe, **5** for a weak one, **3** for a trivial one, **20** strong, **40**
deadly, **30** for an even boss and **5** for an even foe talked down. Fleeing gives nothing for
the foes left standing. The setup shows each line's worth for your character (*~10 XP each*).

**The story and quests.** An `<XP>` award is a share of each member's next level: **minor** 10 %,
**major** 25 %, **milestone** 50 % (10, 25 and 50 XP); a quest Story Director closes **easy** 5 %,
**normal** 10 %, **hard** 15 %, **nightmare** 25 % (5 to 25 XP) (*The story's offers*, below).

**XP rate** (*Settings → Party*, 1 by default, 0.25 to 5 in steps of 0.05) multiplies all XP:
fights, parleys, story awards and quests. The offer, the result screen and the hand-off show the
multiplied amount. A fight already under way when you change it counts at the new rate.

**Progress** is XP within your level against what the next one needs, `30/100`, also with tier
titles (*Soul Class I (Lv 1)* beside `Soul Growth 30/100`), and gains read `+30` everywhere. At
the level cap it shows **MAX**. Progress is written as whole numbers; an odd value in a block
(`45.20/100`, `140/280`) is read as its first number, rounded and kept below the level's 100, so
nothing levels up just from being read.

## Your world's terms

Your lorebook may not say "Level" and "XP". Under **Extensions → RPG Battle → Terms** you name
them, and the sheets, the Party and Battle tabs and the fight summaries use your words (the numbers stay
the same):

- **Level name** (`Level` by default): *Rank*, *Circle*, *Soul Power*, *Soul Class*…
- **XP name** (`XP` by default): *Experience*, *Power Growth*, *Soul Growth*…
- **Tier titles** (off by default): levels 1–10 are *Soul Class I*, 11–20 *Soul Class II*… (the
  tier size and Roman or Arabic numerals are yours). Progress is still XP within the level
  (since 0.5.2; it was the share through the tier before).
- **Level cap** (99 by default): no level past it; XP stops there and shows **MAX**.

With tier titles on, the level line of your section reads

```
Soul Class: III (Lv 24) | Soul Growth: 54/100 | Points: 2
```

and with names of your own but no tiers `Soul Power: 24 | Power Growth: 54/100 | Points: 2`.
The exact level always stays in the block, so changing or turning off the terms never loses a
sheet. With your own terms, the fight setup and the fight cards show an enemy's power as one of
your tiers (or levels) instead of F to SSS, a story's `<Encounter>` may name one (`3 wolf (Soul
Class I)`), and a won fight says `Soul Growth +38` (or `Power Growth +38`).

**Story Block's own Character Sheet block** (a template with an HP meter the model writes) does
the same job by guesswork. With both on, the story reads two HP values that disagree, so the
Party tab and RPG Battle's settings say so, with a **Turn it off** button. It is never turned
off for you. If you keep both on purpose, choose **The other one** for *Stats* under **Source of
truth** (below) and the notice goes away.

## Recovery

HP and MP come back the way the story says; there is no rest button, since a free heal on demand
would be a cheat:

- **As story time passes** (with Story Director): after each reply, the time it moved on from
  the reply before heals the party, **5 % of max HP and MP per hour**; **6 hours or more** is a
  full rest (fight conditions like poison end). A note in the Party tab says what happened
  ("8 hours passed: Ren is fully rested."). It is written into that reply, so a swipe or an edit
  recomputes it instead of adding it twice. Switch: *Recover HP and MP as story time passes*.
- **A rest in the story:** when the party rests, the model adds `<Rest>short: an hour by the
  fire</Rest>` or `<Rest>long: slept at the inn</Rest>`, offered as *Rest (long): slept at the inn.
  Recover?* **Recover** gives your character and every companion a **short rest** (a quarter of
  max HP and MP, and all stamina) or a **long rest** (full; fight conditions end). Not offered during a fight, while
  a fight result waits to be narrated, or for the reply that narrates one.
- **No double counting:** a rest and story time in the same reply are one stretch of time. A short
  rest adds only what its quarter gives beyond what the clock already gave that reply (the result
  is the larger of the two, not their sum; wounds taken in the reply stay taken); a long rest
  fills everything, which makes the clock's part moot.
- **Use item:** a consumable used outside a fight (`heal 30`, `mp 20`, `cure poison`) on you or a
  companion; it comes off the inventory. Damage items stay for fights.

A character at 0 HP cannot start a fight until they recover.

## Story wounds

The story hurts people between fights too: a fall, a poisoned cup, a healer's poultice. While
you have a character, the model is told (in one instruction of about 185 tokens with every hidden
block below) to add a hidden **Wounds** block when that happens to someone on the Party sheet, one
line each, in words, never numbers:

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
- **Conditions the party carries are named to the story** (since 0.5.27). While anyone has one,
  the story instruction adds *Lasting conditions: Astra poisoned. When the story ends one:
  <Wounds>Astra — cure poisoned: how</Wounds>.*, so an antidote, a healer or a nettle broth in the
  story lifts it from the sheet. Without that line a model told the cure and the sheet stayed
  poisoned.
- **One blow per person per reply:** the first harm or heal line for someone counts, the rest are
  ignored; conditions may come alongside.
- **Names** are yours or a companion's, in any case, also by first name ("Ren" is Ren Aldane).
  Anyone else (an NPC) is left to the story.
- **Applied after the reply, into that reply**, after story-time recovery, from the sheets before
  it: a swipe recomputes it and a continue does not add it twice. Not during a fight, and not in
  the reply that narrates one (the fight already dealt its wounds).
- **The reply that narrates a fight** (since 0.5.9) is asked for no `<Wounds>`, but if the story
  goes on into a new fight it is still told to write `<Encounter>` and stop at the first blow,
  never narrating the fight itself; that fight is then offered like any other. Every other reply
  is told the same: *then stop at the first blow, never narrating it*.
- **Undo:** a toast says what happened ("Ren: wound (−29 HP), fell down the ravine.") with an
  **Undo** button, and the Party tab shows the same line with **Undo** while that reply's sheets
  are still the ones it wrote (after a rest, an item or a fight, they have moved on). Undo keeps
  the recovery and the wounds stay undone for that reply.

The Wounds block never shows in the story: Story Block hides it with its other blocks.

## The story's offers

Besides `<Wounds>` and `<Encounter>`, the model is asked for these hidden blocks, each only when
the story makes it true (Story Block hides them with its other blocks):

| Block | Offer | Accept |
|---|---|---|
| `<Joins>Lyra — healer, level 6</Joins>` | *Lyra joined. Add as companion?* | Opens **Add companion**, filled in (see *Companions*) |
| `<Leaves>Lyra: returned to her village</Leaves>` | *Lyra left the party. Remove?* | Removes her |
| `<Learned>Lyra — Frost Lance: ice magic, hits all</Learned>` | *Lyra learned Frost Lance. Add it?* | Opens the learn form, filled in |
| `<XP>major: rescued the caravan</XP>` | none: awarded at once (0.5.21), toasted *Story XP awarded: XP +25 (rescued the caravan)* | XP for the whole party |
| `<Rest>long: slept at the inn</Rest>` | none: applied at once (0.5.24), toasted *Rested (long): slept at the inn. Ren HP +40, MP +12.* | A rest (see *Recovery*) |
| `<Crafted>Bone Charm from Skull, 2 Fang</Crafted>` | none: made at once in that reply's Inventory (0.5.34) | The materials taken, the piece added with code-set numbers (see *Crafting*) |
| A quest Story Director 0.8.2 closes in the reply | none: awarded at once (0.5.7), toasted *Quest done: The Lost Caravan (hard) · XP +15* | XP for the whole party |

- **A story rest is applied, not offered** (since 0.5.24): the story says the party rested and
  code sets what it brings back, so the rest goes straight onto the sheets with a toast naming what
  each member got back. Story-time recovery already given for that reply counts against it.
  It is written into the latest reply, so deleting or swiping that reply undoes it. A reply that
  tells a fight's result, or one while a result still waits to be told, rests nobody.
- **Story XP is awarded, not offered** (since 0.5.21): the story says what was earned and code
  sets the amount, just as for quests. It is written into the latest reply, so deleting or swiping
  that reply takes it back. A reply that tells a fight's result gives none, since the fight
  already did. The opening message's XP still waits for a click.
- **Quest XP is awarded, not offered** (since 0.5.7): the story closed the quest (Story Director
  reports it only then, never for a failed or abandoned one) and code sets the XP by its
  difficulty, so a click would add nothing. It is written into the latest reply, so deleting or
  swiping that reply takes it back with the quest's closing. A quest the story closes a moment
  later (Story Director's capture call) is awarded on the next refresh. Should writing it fail,
  it shows as an offer instead.
- **Offers, never applied on their own:** each shows as a toast with its button and at the top of
  the Party tab with **Accept** and **Not now**. They belong to their moment: a reply's offers
  (and a quest it finished) last only while it is the latest reply and no fight has started since
  it, so a rest from before a fight can never heal after it. A swipe recomputes them, and one put
  away stays away for that reply's text. The opening message's skills and companions are the
  exception: they wait until taken or put away.
- **Names** match by full or first name, as story wounds do; `You` (or your character's or
  persona's name) is you. A name nobody in the party has is ignored, except in `<Joins>`.
- **Learned:** the story is asked to name the skill's stat (`| stat: INT`, since 0.5.29); the
  type, a stat it left out, the target and the effect (fire, ice, lightning, poison) are guessed
  from the words, and all can be changed in the form. The guess: hands and aim are DEX (*shot*,
  *throw*, *dagger*, *quick draw*), footwork is AGI (*sidestep*, *lunge*, *dash*, *tumble*, *dodge*),
  the rest STR; magic and heals INT. Code sets power, cost and cooldown for the learner's level. A
  library skill's name is the library skill, with its stat requirements (the form says why one is
  out of reach). At the cap of skills in use, it asks which to set aside.
- **XP awards** are a share of the XP the member needs for their next level, each at their own
  level, so they mean the same at level 2 and level 40: **minor** 10 %, **major** 25 %,
  **milestone** 50 %; a quest **easy** 5 %, **normal** 10 %, **hard** 15 %, **nightmare** 25 % (by
  Story Director's quest difficulty; none given is normal), times your XP rate; the offer shows
  that amount. Nothing at the level cap. They level up exactly as fight XP does. `xpAwards` and
  `questXp` in `rules.json`.
- **Not from the reply that narrates a fight** (XP and rests: the fight gave its own), and no rest
  while a result waits to be narrated. Nothing at all during a fight.
- **Also offered:** a companion who fell in a fight to the death (*Lyra fell. Remove from the
  party?*, it asks twice) and your persona's new name. A companion's NPC renamed in NPC State
  Delta is followed on its own (below).

## For card authors: starting skills and companions

A new character has no skills; the story's **opening message** (the character card's greeting,
whichever greeting or swipe is shown) gives them, and can bring companions along. Its hidden
blocks are read like a reply's and offered the same way. Lines for your character wait until it
is made (or imported), then appear in the Party tab; a `<Joins>` can be accepted before or after.

```
The caravan master waves you over. "Lyra here patches up my drivers. Mind your blade."
<Learned>
You — Shadow Step: dash behind a foe | type: physical, stat: AGI, target: one, effect: stun
You — Power Strike: a heavy blow
</Learned>
<Joins>Lyra — healer, level 3 | focus: INT, VIT | skills: Frost Lance, Mend</Joins>
```

- **Hints** after a bar make it exact: `type` (physical, magic, heal, buff, debuff), `stat`
  (STR…CHA), `target` (one, all, self, ally, allies), `effect` (fire, ice, lightning, poison);
  for `<Joins>`, `level`, `focus` (up to three stats, first weighs most) and `skills`. Unknown
  words are ignored, and code still sets every number.
- A skill from the opening message comes **without stat requirements** (the card says the
  character starts with it); it still counts toward the skills in use.
- Story Block hides the blocks when it normalizes a message (on receive, render, swipe and
  edit); if a greeting shows them raw, Story Block's **Rescan** tidies it.

## Trade: buying, selling, making, ordering (0.5.37, 0.5.38)

**Party · Trade** at the top of the Party tab switches to trading (since 0.5.38 it is a page of
the Party tab, not a tab of its own). You choose; RPG Battle sets every number and the story
tells it.

- **Only where there is a market** (0.5.46): a place whose *Loc* names a settlement or somewhere
  goods change hands (*hamlet, village, town, city, port, docks, inn, guild, market, trading
  post…*), a place you priced in the settings, or anywhere a trader is present (a *peddler*,
  *merchant*, *smith*, *apothecary*… in their name or trade, so a trader met on the road counts).
  Anywhere else (the wilds, a cellar, a boat's deck) the page says *No market here (Granary
  cellar). Trade in a settlement, or with a trader on the road.* and has no Buy, Sell or
  Commission; your orders still show with their ready time, to collect in a market. The words are
  `trade.markets` and `trade.traders` in `rules.json`.

- **Trading with:** a kind of trader at this place — *General store, Apothecary, Smith, Crafter
  (bone-carver, tanner…), Fence, Guild buyer* — with the story's name for them if you like
  (*Mother Greta*); or someone present (*Elke (here)*, from the World State, else NPC State
  Delta's present NPCs, else known NPCs the latest reply names); or anyone you name. Nobody needs
  to be in the scene: the place has its traders. A person's trade is guessed from the name and
  can be changed. A fence pays least for everything; an apothecary pays well for potions and
  parts, a smith for gear, a crafter for materials. Your own party is never listed.
- **Prices fit the place:** read from the World State's *Loc*, the settlement's own name first
  (*Bluewatch Village | Market Square* is a village): a hamlet or outpost pays and charges least,
  a village a little less than a town, a city or capital more. The page says which (*village
  prices: goods ×0.9, offers ×0.85*); it is not a choice there (since 0.5.46). Your own word for
  a place (cheap, fair, dear) is set in **Settings → RPG Battle → Trade**: a list of places, each
  with its prices, added and removed there. A place matches by its name or one part of it
  (*Bluewatch Village*). A chat's choices from the old **Prices here** move to that list when it
  is opened.
- **Buy** (0.5.38): each trader kind has stock at this place, the same all day (by place, kind and
  story day) and different from what it had on the days before; what you buy is gone from it.
  Gear's rarity follows the place (a city's smith has better pieces). The stock is never put in
  the prompt: only what you bought is told.
- **Sell:** every row but your purse, what you wear and what is on order.
- **One line per thing** (0.5.43): in Buy, Sell and On order each thing is a single line: its
  name in its rarity's colour, its note quiet in the middle (cut short; a tap shows it whole), a
  stack's **− n +** count, and a small price button on the right (*💰 6 c*), so the prices line
  up. The short price is written in your own coins (*1 g 3 s*, or *5 m 8 b* for bits, marks and
  crowns; see **Money**); the button's full words (*Sell 3 · 6 copper (2 copper each)*) are its
  tooltip and what a screen reader reads. A trade is made the moment you press its button. On a
  wide pane (a tablet held sideways) the lines sit in two columns.
- **Commission** (0.5.44): trade with a smith, a crafter (bone-carver, tanner…) or an
  apothecary, name the piece, and pick its materials with **Use** (a stack's **− n +** once
  picked). Only materials are offered (since 0.5.45): rows noted `material`, rows under a loot,
  trophy or material section, and creature parts by their name (a *Wolf Fang* or *Wolf Core*
  kept under [Gear]); rope, a waterskin or a whetstone are not. You see what it will be, the fee, and how long the crafter says it takes, then
  **Commission it**. A piece is always made to order, and how long it takes is the crafter's
  word, not yours: by its rarity (a few hours for common, about a day for uncommon, two or three
  days for rare, a week for epic), faster when it is their own line (a smith's sword, a
  carver's ring), slower outside it and in a small place. The same day, place, crafter and
  piece always give the same time. With Story Director's calendar the order says when
  (*ready Goldwane 13, 11:00 am*); without one, how long (*ready in about a day*). The order
  waits under **[On Order]** with its numbers set and the materials gone.
- **On order:** each order says when it is ready, and **Collect** appears once the story's clock
  reaches that time (straight away when there is no clock to read). Your purse stays in view at
  the top.

Each trade is written into the latest reply's Inventory, so deleting or swiping that reply takes
it back. All the trades between two replies, with however many traders, are told to the next
reply as one errand run, grouped by trader, in a short note at the end of its prompt (depth 0):

```
[Trade] Since the last reply, Astra went round Bluewatch Village: at the apothecary, sold the Brood-Mother Carcass for 3 silver; at the general store, sold 64 Rat Tail for 2 silver, 2 copper; at the bone-carver, commissioned Skull Ring, made from Brood-Mother Skull, for 8 silver; they say two days, ready Goldwane 14, 03:00 pm.
Tell it briefly as part of the scene, in the story's own voice. No menus or game terms; keep the amounts and what was made exactly as they are (the Inventory already shows them).
```

It is told once (again to a swipe of that reply), replaced or cleared on every reply, and never
sent otherwise. The numbers are in `trade` in the rules.

**Undo** (0.5.43): each trade under **Told in your next reply** has its own Undo, which takes
exactly that one back: the Inventory and purse are made again from how they were before the first
of these trades, with every other trade done again and that one left out (a thing bought goes back
on the trader's shelf). It is offered while nothing else has changed the Inventory since; after
that, delete or swipe the latest reply to take the trades back.

## Using an item outside a fight (0.5.47)

**Use item → Use** applies the item at once: the HP (or MP, or the cure) goes onto the sheet and
the item comes off the Inventory, both written into the latest reply, so deleting or swiping that
reply takes it back. The Items page stays open, so each click is one more dose; it stops when the
stack is gone or the HP is full. Your next reply is told what happened, with the code's numbers
(*[Item] Ren uses the Minor Healing Draught: +20 HP (now 50/62 HP). This already happened; mention
it briefly if it fits, and keep these numbers.*, at depth 0); you write nothing in your message.
(0.5.38 to 0.5.46 put a marker in your message box instead and applied the item with the reply.)

## What's sent (0.5.38)

The Party card's **What's sent** fold shows, part by part, what RPG Battle would add to the next
reply, with each part's size. Story Suite's overlay lists the same parts (`api.manage.preview()`,
`[{ label, text }]`; `api.preview()` is the same list with each part's key and place).

**Laid out for prompt caching (0.5.41).** Many providers reuse the part of a prompt that is the
same as the last request's, from the start, and charge less for it. So RPG Battle sends two things:

- **The story instruction**, early (right after the main prompt), and the same text every reply:
  nothing in it changes, so it is part of the prefix that is reused.
- **One note at the very end** (depth 0) with everything that changes: a fight's hand-off and the
  narrating line, the trade and item notes, *a fight is under way*, the foes the story has met,
  lasting conditions and the purse. It is rebuilt every reply and emptied when there is nothing
  to tell, so nothing spent is told twice.

They use Story Suite's shared keys (`story_suite_static_rpg_battle`, `story_suite_tail_3_rpg_battle`);
the keys of older versions are emptied on load.

SillyTavern places the story instruction next to the Main Prompt; a preset without a Main Prompt in its prompt order would drop it. Since 0.5.42 RPG Battle then puts it back itself, once, after the leading system messages, in the reply's own prompt only (never another extension's scan or summary). Text completion keeps it in the story string as before.

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
  **Gear** list on your card shows what the fight uses and names the rest as *not counted* (and
  why). **Settings → Equipment** changes how many worn pieces and accessories count (0 to 9).
  The slot comes from the item's kind, its category (`[Equipment > Boots]`) or `slot: worn` /
  `slot: accessory` in its note.
- **Stats are limited by rarity and your level** (common < uncommon < rare < epic < legendary),
  so an item the model makes up cannot carry "ATK +50": in a fight it is scaled down to what its
  rarity allows, and the Gear list on your card shows it as capped ("STR +2 · capped from STR +20"). An item without stats gets them from its
  rarity and kind.
- **Elements work in a fight** (0.5.33). *fire*, *ice*, *poison* or *holy* in the note of your
  weapon, off-hand or an accessory (`rare · ATK +12, STR +2, fire`): on each physical hit fire has
  a 25 % chance to burn the foe for 2 rounds, poison to poison it for 3, ice to slow it for 2,
  each as strong as the hit; holy deals ×1.25 damage to the undead and spirits. The word works on
  gear the story gives you and on gear you wrote earlier, too; on armour or a worn piece it is
  only a word. The numbers are in `combat.gearEffects`.
- **Notes the story retells keep working** (0.5.35). The model rewrites the Inventory each
  reply, and a `heal 20` can come back as *weak restorative fluid*, a sword's `ATK +4` as *a
  notched blade*. Each reply, a note that lost what RPG Battle reads (an effect, gear's rarity
  and stats, a material's line) gets it back in front of the story's words:
  `heal 20 · Weak restorative fluid`. New numbers the story writes are its own, and a row it
  drops stays dropped. A potion whose note says nothing still works by its name (*Minor
  Healing Draught* heal 20, *Healing Draught* 30, *Greater* 60, *Elixir* 120, *Grand Elixir*
  250, *Mana Tonic* mp 20, *Antidote* cures poison, and one the story names the same way).
- **Crafting** (0.5.34). A material's note says what it would lend a crafted piece: its rarity
  and an affinity, `uncommon material · MDEF, poison`. The stat comes from what part it is (fang,
  claw, tusk ATK; pelt, hide, scale DEF; skull, bone MDEF; essence, crystal MATK; feather, wing,
  silk, tail AGI; eye DEX; heart, blood HP; sac, gland, jelly MP; ear LUK). The element comes from
  what it is made of or what dropped it (venom, spider, rat → poison; ember, drake → fire; frost,
  ghost → ice; relic, blessed → holy). A material from before 0.5.34 is read by its name, and a
  hint you write in its note wins. When someone makes something in the story, the reply writes
  `<Crafted>Bone Charm from Skull, 2 Fang</Crafted>` and RPG Battle sets the numbers:
  - **rarity**: the best material's, one step up when three or more are of it;
  - **stats**: from the affinities (two at most), sized to that rarity and your level;
  - **element**: the first material's that has one;
  - **slot**: from the piece's kind, or `| slot: worn` on the line.

  The materials come off the Inventory and the piece goes in, in that reply, so a swipe or a
  deleted reply takes the craft back. Since 0.5.36 a piece can be **ordered**: `| ready: Goldwane
  14` on the line takes the materials now and puts the piece under `[On Order]` with its numbers
  already set (`Skull Ring | 1 | uncommon · MDEF +4 · on order, ready Goldwane 14`). It cannot
  be worn or used until collected, a reply that retells or drops its row gets it back, and
  `<Crafted>Skull Ring — collected</Crafted>` (or the name alone) makes it the gear it is. A material you do not hold counts as common and is not
  taken. Who crafts and what it costs are the story's.
- **Consumables** with an effect (`heal 30`, `mp 20`, `cure poison`, `fire 25, all enemies`) can
  be used in a fight; what you use comes off the inventory afterwards.
- **Loot** from a won fight is written into the inventory, money into your money row. Gear carries its rarity and stats (`uncommon · LUK +2`); since 0.5.32 a rarer material or potion says so too (`uncommon material`, `rare · heal 40`). Since 0.5.33 uncommon or rarer gear rolls **one more stat** (+1 uncommon, +2 rare, +3 epic, +4 legendary, still capped by its rarity), and rare or better gear that strikes or is worn as an accessory or off-hand also rolls an **element** (fire, ice, poison or holy). The reply that tells the fight's end rewrites the Inventory; when it leaves a dropped row out or retells its note (*a yellowed fang on a cord*), RPG Battle puts back what the fight wrote. It touches only that fight's loot rows, and only in that reply: later replies are the story's. Only foes
  that would carry coin drop money: people (bandits, cultists, goblins, orcs…), their leaders and
  casters, and a drake or wyvern that is a boss, on its hoard. Beasts, insects, oozes, plants,
  constructs, spirits and the dead leave something of themselves instead (a *Wolf Pelt*, a
  *Fang*, *Spider Silk*, *Slime Jelly*, *Old Bone*), and more often than a coin carrier leaves
  its materials. The shipped bestiary marks each creature (`coins: true`, `false` or `'boss'`); a
  made-up one goes by its kind. A boss rolls for gear and consumables more than once, but its
  body parts only once, and a part a creature has one of (a pelt, hide, head, heart, tail, skull,
  horn…) is never more than one per creature: one wolf, one pelt. Fangs, claws and scales may
  come several at a time.
- **A companion's own items** (0.5.40) are the Inventory sections named for them: `[Lyra]`, and
  sub-sections like `[Lyra > Herbs]` (matched by their name or first name, as the Party sections
  are). Rows marked `equipped` there are their gear in a fight (the same slot limits and rarity
  caps, at their level); their consumables are theirs to use in a fight and come off their
  section afterwards. Everything else is yours, and loot stays the party's: it goes into your
  sections, never a companion's, until you move it. Moving a thing is a plain Inventory edit
  (move the row under their header), or:
- **Give item** (on a companion's card) moves one equipment row from your Inventory into their
  section, worn; **Take back** puts it back into yours, not worn. A companion's older
  `Equipped:` line on their Party section is still read while they have no section; the first
  Give moves its pieces into the new section, and the line is not written again after that.
- **Trade** sells a companion's things too: **Whose items** under Sell picks you or them (the
  coin goes to your purse).

## A fight

Fights start from the story only: a reply's `<Encounter>`, or a fight Story Director planned
(see below). There is no Start fight button. The **Battle** tab exists only while there is a
battle: the offer, the setup, the fight, and its result until it goes back to the story.

1. **The offer:** *A fight is starting: 3 bandit, bandit captain (boss)*, **Fight?** or **Not now**
   (also as a toast). **Fight?** opens the setup.
2. **Setup**: the engagement as the story gave it, to fight or not, never to change. Each line
   shows how many, the name (tagged **new** when nobody knows it: it is made up when the fight
   starts, see *Monsters on the fly*), **Boss**, its level in your terms (the bestiary's own, the
   story's threat word turned into a level, or a fair one for your level), the threat word, its
   role and what one is worth to you (*2 × Feral Ditch-Dog · Lv 1 · weak · skirmisher · ~5 XP
   each*); later engagements are listed in order. The stakes are said, not chosen: *Stakes: Normal* (defeat
   means the story decides: captured, robbed, left for dead) or *Stakes: To the death* (defeat
   is death: game over), as the story marked it. **Start** or **Not now**.
3. **Fight**: each foe's card shows its level, the story's threat word and its role (*Lv 1 · weak
   · skirmisher*), and how it stacks up against whoever's turn it is (since 0.5.14): *Atk 9 · Def
   4 · AGI 4 · DEX 5 · You hit 87% · You dodge 40%*, your chance to land a physical attack on
   it and to dodge one of its (hover for the sums). On your turn pick an action and tap a target:
   while you aim, each target shows what that attack or skill would do to it (since 0.5.15),
   *Hit 63% · 8–10 dmg · Crit 12%*, by the same sums the fight rolls (spells: Hit 100%). Enemies (and companions on *auto*)
   act on their own, by simple predictable rules. **Auto** plays the rest of the fight for you.
   **Turns** (since 0.5.14) run on a **timeline**: each fighter's next turn comes 100 ÷ speed
   after their last, speed being **AGI + 10** (halved while slowed), and whoever's turn comes up
   first acts. Twice the speed is twice the turns, with no limit: AGI 30 against AGI 10 acts
   twice as often (speed 40 against 20), AGI 90 five times (100 against 20). The **Next turns** strip shows
   the coming eight, a fast fighter more than once. A *round* is still counted (the wait of a
   fighter at the starting 5), for reinforcements, the log and the summary's length. Settings →
   **Combat** switches back to **Rounds** (everyone once a round, by AGI × 2 + DEX + a d6) or
   changes the 10. A fight keeps the turn order, speed and hit chance it began with.
4. **The result**: outcome, HP and MP left, XP, loot and the key moments are applied to the
   sheets and inventory (companions on auto spend new points by their build), and a short
   summary waits for the next reply:

```
[Battle resolved by RPG Battle: narrate this outcome, do not change it]
Victory in 5 rounds (about 30 seconds).
Ren: HP 61/98, MP 15/32.
Key moments: Ren finishes the Goblin A; Critical! Ren's Power Strike hits the Goblin Shaman for 34.
Foes defeated: Goblin ×3, Goblin Shaman.
Loot: 1 silver, 3 copper, a goblin ear, a shaman's charm. XP +35.
```

The **Foes defeated** line (since 0.5.8) says how many fell of each kind, without the letters
that tell them apart in the fight, so the story does not count them from the key moments,
which name only some.

**What next?** (since 0.5.4) Under the result, a few things your character could do next: *Skin
the wolves and take what is worth keeping*, *Tend to Lyra's wounds before moving on*, *Follow the
ones that got away*. With model calls on (Generated words), one short call writes them from the
hand-off and the scene (a 15-second limit, on the same model as new creatures); off, offline or when
the call fails, they are written from the result itself (loot, someone hurt, foes that fled, a lost
or abandoned fight, stages not reached). A click puts one in the message box to edit and send,
Shift-click sends it at once; the reply then tells the fight and your move. **Just continue** sends
the usual message. Never after your character's death. Off under **Blocks → Next moves after a
fight**.

**Return to story** sends a short message for you so the narration comes straight away. The
summary is given to that one reply only; its swipes narrate the same result. **Done** closes the
Battle tab; while the summary waits, the Party tab shows it with **Return to story**. Once the
reply that narrates it is in, the notice goes (and the story's next fight can be offered); delete
that reply and the result waits again. There is no Discard: a fight's result always reaches the
story, so the sheets and the narration agree. A fight belongs to the reply it started from (since
0.4.3): delete back past that reply, or swipe it, and the fight and its result are gone with it,
so replaying the scene can offer a new fight. Since 0.5 that holds even when the very same reply
comes back in its place: the fight is offered again, and a Not now said to the deleted reply does
not hide it. The reply that narrated a fight never offers XP or a rest for it, however the story
moves on afterwards.

A plan (fights in stages, below) has one result too: the result screen lists each stage (*Stage 1,
the gate: victory in 3 rounds*, *Stage 3, the tower: not reached*) above the totals, and the
hand-off has a line per stage reached and says plainly what never happened:

```
[Battle resolved by RPG Battle: narrate this outcome, do not change it]
Stage 1, the gate: victory in 3 rounds.
Stage 2, the yard: defeated — the story decides what follows (captured, robbed, left for dead).
Not reached: the tower. Do not narrate it.
Ren: down (unconscious or unable to fight).
Key moments: Ren finishes the Guard A; …
Foes defeated: Guard ×3.
Loot: 1 silver, 2 copper. XP +30.
```

After **Fall back** the line is *Fell back after the gate; the yard and the tower were not
attempted.* The member lines are the end state; the loot and XP are what the cleared stages
gave.

## Fights from the story

When a fight breaks out in the story, the model adds a hidden **Encounter** block naming the
foes and stops at the first blow, so the fight itself is yours to play:

```
<Encounter>3 bandit, bandit captain (boss)</Encounter>
```

A toast and the Battle tab (which appears for it) offer it: *A fight is starting: 3 bandit,
bandit captain (boss)*, **Fight?** or **Not now**. **Fight?** shows it as it will be fought (three
Bandits, one Bandit Captain as a boss, normal stakes), read-only; **Start** fights it. Nothing on
the page can change the fight: RPG Battle builds it from the block it read. **Not now** puts the
offer away for that reply. Groups are separated by commas, `and` or new lines; each is a count
(`3`, `3 x`, `two`, `a`), the name, and optionally `(boss)`, `rank D` and a role. A plural is made
singular when the bestiary knows the creature ("3 bandits" → Bandit) or its last word is a
creature word ("3 bog wights" → Bog Wight); any other name is kept. With no number, a plural
name is several (*Bandits*: 3) and so is a group (*a pack of wolves*: 3 Wolf; *a pack of 5
wolves*: 5). A **swarm** is one foe made of many, fought and told as one swarm (since 0.5.31):
*a swarm of granary rats*, *Rat swarm* or *Cellar Rats (swarm)* is a *Granary Rat Swarm* or
*Rat Swarm* (a number inside, *a swarm of 30 rats*, is its size), and it drops what its
creatures drop (*Rat Tail*). At most 9 of one foe join a fight.

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

A step is **4 levels**, also when your terms have tier titles (0.5.3: a strong foe is a few
levels up, not a tier up; `threat` in `rules.json`). No foe goes below level 1: where the word
would put it there (*weak* up to level 4, *trivial* up to level 8), it stays at level 1 and is
**made smaller** instead, its HP and attack ×0.88 for each level it falls short, never below
×0.35, its defence as it is; its XP counts from the level the word meant (so *weak* is still
half an even foe's XP and *trivial* a quarter). At level 1 a *weak* wolf has 10 HP to an even
one's 16 and is worth 5 XP to 10; a *trivial* one has 6 HP and is worth 3. Only a level that
came from the word is treated so. The word goes in brackets, or before the name for the
unmistakable ones
(`3 weak marsh wolves`; "Lesser Demon" and "High Priest" stay names), or (since 0.5.46) after a
comma or a spaced dash (`2 cellar rats, even`, `Brood-Mother — boss, deadly`): a note on its own
is the row before it, never a foe called *Even* (which dropped an *Even Trophy* before). A power written outright
(`rank D`, `level 12`, `Soul Class II`) wins over it; with neither, the fight is even.

**Engagements back to back:** `then:` starts the next engagement, fought once the one before is
done, with no rest between:

```
<Encounter>3 bandit; then: bandit captain (boss)</Encounter>
```

It is one battle: HP, MP and conditions carry over, and there is one result and one hand-off at
the end. The setup lists each engagement in order; up to three after the first.

**Plans: fights in stages (0.5).** When the party's plan, or the story, takes it from one fight
to the next somewhere else, a place after `then` starts a new **stage**:

```
<Encounter>at the gate: 2 guard (weak); then at the yard: 3 guard (even); then at the tower: guard captain (boss, strong) | to the death</Encounter>
```

`at the gate:` before the first group names the first stage (optional: without it the stage is
just *Stage 1*); `then at the yard:` starts the next one (also `then, at the yard:` and `and then
at the yard:`, any case). Any short place works the same way: `then inside the den:`, `then
across the ford:`, `then the tower:` (one to six words before the colon, no digits); a leading
*at* is left out of the place's name, other words stay. A plain `then:` is still more foes
joining the same fight, so a stage may have its own waves. Up to five stages. The offer reads *A plan in 3 stages: the gate, the
yard, the tower* (*— to the death* when it is marked: the stakes are the whole plan's). The setup
lists each stage in order, *Stage 1 of 3: the gate*, with its foes as for any fight, read-only:
**Start** or **Not now**.

Each stage is its own fight: new foes, the rounds counted from one. The party goes in as the last
stage left it: HP, MP, cooldowns, conditions and the items left carry over, nothing heals, and
whoever is down stays down. After a stage is won the Battle tab says *The gate is cleared (3
rounds). Next: the yard — 3 guard (even)*, with the party as it stands and the next stage's foes,
and two buttons only: **Go on** (the next stage) or **Fall back** (the plan ends there, a
withdrawal). The plan ends with victory when the last stage is won, with defeat at the stage lost,
fled at the stage you escaped from, or withdrawn on Fall back; the stages after it never happen.
It is kept with the chat (a reload finds it where you left it, between stages too) and belongs to
the reply it started from: delete or swipe that reply and the plan and its result are gone.

What every cleared stage gave is kept, even when a later one goes wrong: XP for the foes beaten in
each stage (also in the one lost, as after any lost fight) and the loot of each stage won, by the
same rules as one fight (levels, companions' auto-spend, items used, the Inventory). Losing any
stage of a plan to the death is losing a fight to the death. Nothing is written until the plan
ends; then everything is written once, into the latest reply.

**The stakes:** a fight to the death is marked after a bar, at the end of the block:

```
<Encounter>3 bandit; then: bandit captain (boss) | to the death</Encounter>
```

Defeat is then death (game over, and the hand-off says so). `| death` and `| stakes: death` work
too, in any case; without a mark the stakes are normal (defeat means the story decides). What
follows a bar is never read as a foe.

With Story Director 0.8, a fight it has planned (a beat with foes) is offered the same way, with
its name and place; its text may use `then:`, `then at <place>:` and `| to the death` too. Since
0.5.18 (with Story Director 0.9.18) only once the story **reaches** it: the reply fires the beat
(`! Key — …`), so the scene is where the fight is. A planned fight that comes due while your
character is elsewhere is never offered; the story tells it as news. With an older Story
Director, a due or due-soon fight is offered as before.

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
A name worded differently still finds its creature (since 0.5.1): describing words (young, old,
mangy, feral, grey, alpha, matriarch…) are left out, so "mangy young wolf" is the story's Young
Wolf and "wolf matriarch" its Grey Wolf Matriarch, while a word that names a kind keeps it apart
("Dire Wolf", "Bog Wight", "quill-dog"). The story's wording is what the fight shows. The story
instruction also lists the last eight creatures this story has met, so the model writes the same
creature by the same name.

**Kin (0.5.2).** A new kind in a family the story already has is made as **kin** of its closest
relative rather than from the bare template: with a *Feral Ditch-Dog* in the story, a *razor
dog*, a *wolf dog* or a *hellhound* is its kin. A creature's family comes from its creature noun
(dog, hound, wolf…; also as a plural or the end of a compound, *ditch-dog*, *hellhound*):
**canines** (dog, hound, wolf, cur, mutt, jackal, fox, coyote, warg), **felines** (cat, lynx,
panther, leopard, lion, tiger), **ursines** (bear), **rodents** (rat, mouse), **arachnids**
(spider, scorpion), **serpents** (snake, serpent, viper, adder, wyrm), **avians** (bird, crow,
raven, hawk, eagle, vulture), **insects** (beetle, wasp, ant, centipede), **oozes** (slime, ooze,
jelly); any other noun is a family of its own. The closest relative shares the noun if one does
(a *wolf dog* is a dog's kin before a wolf's), else the family; the story's own creatures before
the shipped ones, the newest first. Kin takes the relative's template, role (unless its own name
says one, *dog archer*), temperament and traits, whether it talks and carries coin, its moves to
start from (the template may add one), and its loot with the body parts renamed (*Razor Dog
Pelt*, *Razor Dog Fang*; one pelt per creature as always). Its level, numbers and XP are its
own row's. A flavour call is told it is a relative of the Feral Ditch-Dog, so its look fits. A
name that already finds its creature (exactly, or differently worded) is that creature, never
kin. With no relative, a new kind is made from its template as before.

- **Setup:** a name nobody knows is tagged **new** (made up when you press **Start**; its tooltip
  says *made up as kin of Feral Ditch-Dog* when it will be); in the fight, its card is too (its look is
  the card's tooltip).
- **Bestiary** (a fold at the bottom of the Party tab): this story's creatures, grouped by family
  (*Canines*, *Wights*…), with their power in your terms, role, traits and look, and *kin of
  Feral Ditch-Dog* on a kin; **Regenerate** makes one again (and flavours it again),
  **Forget** drops it (the name is made up anew next time). **Export** saves the list as JSON,
  **Import** adds one (cleaned like anything stored: known words only, every number worked out
  again).
- **Settings → Generated words:** model calls on or off (for new creatures and a new companion's
  skills), the model (the chat's own, or a connection profile, as in Story Director; a small fast
  one is enough), and the answer length (400 tokens).

## Money

Your lorebook names the money, so the currency is a setting: **copper / silver / gold** (rates
editable), **one coin** named as you like, or **your own** names and rates (for example
`bits=1, marks=12, crowns=20`). The Trade page's prices are written short in these coins
(since 0.5.43): each coin by its own short form when you give one after a slash
(`copper/cp=1, silver/sp=10`), else by the fewest letters that tell your coins apart (*c, s, g*;
*b, m, c*; *cr* and *co* for crowns and copper); one coin by its **Short form** setting, else its
first letter. Loot is added to the inventory row named in the setting
(`Coins` by default), or (since 0.5.25) to a purse the story keeps under its own name, such as
`Coin Pouch | 1 | 1 Gold, 35 Silver, 14 Copper`, so there is never a second money row.
Since 0.5.46 a row named for one coin counts too (`Silver | 4`, `Copper Coins | 36`, `Gold
Pieces | 2`; a *Silver Ring* does not), and so do amounts written out (*eight silver*). Paying
from such rows takes the smallest coins first, whole coins, with the change put back. Trade's
purse is the whole Inventory's, the same one a trade pays from; with no money row at all it says
so (*Purse: none in the Inventory…*) rather than *0 copper*.

**The purse in one sum** (since 0.5.25). Before each reply the story is told what the party can
spend in all, every purse row added up. With Story Block 0.9.12 or later keeping the items (its
default), Story Block writes that line beside the Inventory, counted in RPG Battle's currency, and
RPG Battle leaves its own out (0.5.26), so there is only ever one: *Purse: 4 gold, 6 silver, 4 copper in all; nothing dearer
can be paid for (the seller refuses, haggles or takes goods in trade).* A purse written in three
coins is hard to add up mid-scene, and without the sum a model would let a shopkeeper take six gold
from a purse that held four.

## Companions

Companions join from the story. A `<Joins>Lyra — healer, level 6</Joins>` is offered as *Lyra
joined. Add as companion?*; **Add as companion** opens the form, filled in:

- **Name, role** (free words), **level** (the story's, fixed; with none given, at most yours) and
  who controls them (*Acts on its own* or *I command it*).
- **Focus:** up to three stats in order; every point they have (the starting 10 and 4 per level
  after the first) is spread over them by weight, 3, 2 and 1 (none: evenly). Role words fill it
  in, from a small table of generic words, and you can change it: *healer, cleric, priest* → INT,
  VIT, CHA; *mage, wizard, sorcerer, caster* → INT, DEX; *warrior, knight, fighter, guard* → STR,
  VIT; *tank, defender* → VIT, STR; *rogue, thief, assassin, scout* → AGI, DEX, LUK; *archer,
  ranger, hunter* → DEX, AGI; *bard, diplomat, merchant* → CHA, LUK; *monk, brawler* → STR, AGI.
- **Skills:** worked out from who they are by one short model call, in words only (name, a few
  words, type, stat, target, effect from fixed lists), as a made-up creature is flavoured (the
  *Generated words* settings, 30 seconds at most). Code builds each one for their level and sets
  every number. With the calls off, no model, a failure or too little in the answer: two or
  three library skills that fit the focus and role. The form shows them with **Generate again**
  and a remove button per skill; a `| skills: Frost Lance, Mend` hint names them instead. Later
  skills come from `<Learned>`, like yours.
- **Equipment** is never typed in: once they join, **Give item** on their card moves gear from
  your Inventory (slot limits and rarity caps as for yours).
- **From the story's NPCs** (with NPC State Delta 1.2.2): pick one of the chat's NPCs to fill in
  name, role and focus (from its role and summary; the skills are generated again for them). The
  companion stays linked: **Dossier** on their card opens the NPC's dossier, and when the NPC's
  name changes there, the companion takes it (*Lyra is now Lyra Vance (from NPC State Delta).*),
  once per change, written into the latest reply like any sheet change (delete that reply and
  they are Lyra again, and stay so). A `<Joins>` naming a known NPC is linked and refined the
  same way.

They live in the **Party** block after your section, fight beside you (on their own, or on your
command: tap to switch), level from fights and XP awards like you (each at their own level),
rest and recover with you. A companion on *auto* spends the points a level gives in proportion to
their build so far (*Settings → Party → Spend companions' points automatically*, on by default);
one you command, or everyone with the setting off, keeps them for **Spend** on their card.
**Edit** changes a companion's name, role and control (sheet, skills, mastery progress and gear
stay); **Remove** asks twice; a `<Leaves>` offers it. A companion at 0 HP when
a fight *to the death* ends **fell**: the Party tab offers to remove them (it asks twice). At
normal stakes they are only down, as before.

## With the other extensions

RPG Battle works alone (with Story Block). Beside Story Block, Story Director and NPC State Delta,
the extensions find each other through the **Story Suite** handshake and agree on who is the
source of truth for each area, so the model is not told the same thing twice; see
[docs/STORY_SUITE.md](docs/STORY_SUITE.md).

- RPG Battle offers **stats** (HP, MP, stats, skills, fights) and **rolls** (the Checks line as
  the Dice modifier), and **items** after Story Block's Inventory (it reads gear from it and
  writes loot into it either way).
- It shares its party with the others: your character and each companion with their level (in
  your terms), HP, MP and State words, as the sheets say.
- **Story Block 0.9.1** keeps the Party block without a sidebar tab of its own (`tab: false`), so
  RPG Battle's Party tab is the one party tab. With an older Story Block the block keeps its tab
  as before.
- **Story Director 0.8.2:** a quest it closes in a reply earns XP by its difficulty
  (`questsDoneAt`), awarded at once since 0.5.7. Without it, nothing.
- **NPC State Delta 1.2.2:** its NPC profiles fill in a new companion (`npcProfiles`), and a linked
  companion's **Dossier** opens it (`openDossier`). Without it, the form has no NPC picker.
- **Story Suite's overlay** can show what RPG Battle adds to the next reply (`api.manage.tokens()`,
  an estimate: the story instruction or a waiting fight hand-off; the Party block is Story Block's
  to count).
- **Settings → Source of truth:** for *Stats*, *Roll modifiers* and *Items*, **Automatic** (the
  specialist for the area), **This extension** or **The other one**, with who the story follows
  now. For *Stats*, it decides whether Story Block's Character Sheet is pointed out as a second
  HP: with **The other one** the notice stays away, and RPG Battle still keeps its own sheets for
  its fights. With RPG Battle alone, every choice works like Automatic.
- **Story Suite overlay:** with two or more installed, Story Block's *Story Suite* overlay sets
  the source of truth for all of them in one table and switches RPG Battle on or off; *Manage all
  in Story Suite* at the top of RPG Battle's settings opens it
  ([docs/STORY_SUITE.md](docs/STORY_SUITE.md#one-place-to-manage-them-all)).

## Settings

Under **Extensions → RPG Battle**: the on/off switch and *Recover HP and MP as story time passes*
on top, then folds: **Money**, **Equipment** (worn pieces and accessories that count), **Terms**,
**Generated words** (model calls for new creatures and a new companion's skills), **Combat**
(since 0.5.14: turn order, *Timeline* or *Rounds*; speed, AGI + 10 by default; the **stat
cap**, 99 by default, the highest a stat goes with points, 0 for none, gear adding on top; the
hit chance, 75% between equal DEX and AGI and 3% per point of difference; these win over a
`rules.json`), **Party** (*Points per level*, 4 by default, 1 to 20; skills in use per member, 3 to 12; companions' points spent automatically; the **XP rate**, 0.25
to 5, multiplying all XP), **Source of truth**
**After a fight** (since 0.5.17: *What next?* choices on or off, and who writes them: the
Generated words model, the chat's model, a connection profile of their own, or no model, from
the result), **Diagnostics** and **Blocks** (the Party and Inventory tags, the Return to story
message).

**Diagnostics** (since 0.5.9) is a plain report of what RPG Battle sees in this chat and what it
sent with the last reply, with **Refresh** and **Copy** (for a bug report):

```
RPG Battle v0.5.9 · on
Story Block: yes (v0.9.6) · Story Director: yes (v0.9.6) · NPC State Delta: yes
Character: Ren, Level 2, HP 67/86
Latest reply #12: none of RPG Battle's blocks · Party block yes · tells a fight's result
Last reply sent (2:31 PM, normal): fight hand-off + narrating instruction (a new fight → <Encounter>, no <Wounds>) · about 188 tokens
Hand-off: narrated (given to reply #12)
Fight: none
Fight offer: none (the latest reply has no <Encounter> and nothing is planned)
Story offers: none
```

Below that (since 0.5.10): **Blocks in the latest reply**, each with what came of it (*offered*,
*taken or put away*, *applied*, *XP awarded*) or why not (*this reply tells a fight's result: XP
and rest came from the fight*, *no character yet*, *already in the party*, *a fight started since
this reply*), Story Director's quests finished there; **Last fight**, with its outcome, foes
defeated and fled, XP, loot, levels and mastery, and the hand-off exactly as it was sent; and
**Activity this session** (awards, offers taken or put away, fights started and ended, story
wounds), with times.

Since 0.5.11 it also quotes **what was injected** with the last reply, word for word: since
0.5.41 the story instruction after the main prompt (`story_suite_static_rpg_battle`) and the note
at the end of the prompt (`story_suite_tail_3_rpg_battle`), each a system message. Under the report, **Raw data (JSON)** holds what the lines are made from:
this chat's stored state (the hand-off waiting, the last result, what was put away, the replies
that narrated a fight), what the last reply was sent, the sheets, the offers, the quests Story
Director finished in the latest reply, that reply's RPG Battle blocks as written, and the
activity. Long lists are cut. **Copy**, **Copy JSON** and **Copy both** put it on the clipboard.

**Next reply will get** (since 0.5.12) is worked out from the saved chat the way the next reply
would be: the hand-off waiting and the instruction, both quoted. It shows right after a restart,
while *Last reply sent* and *Activity* are this session's only. After a fight, before your next
message, it reads *fight hand-off + narrating instruction*; once a reply has told the fight, the
hand-off is spent (*only a swipe of that reply gets it again*).

It answers *why was this fight not offered* (no `<Encounter>` written, a result still to be told,
a fight under way, no character, put away) and *was the model told to hand fights over* (the
story instruction, the narrating one, or none and why).

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
