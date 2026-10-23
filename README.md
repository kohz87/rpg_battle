# RPG Battle 2.0.0-beta.1

> This is the **`v2` branch**: Story Suite v2, first beta. It is for test play, not for your real campaigns yet.
> RPG Battle 1 (the offer-based extension) is on the [`main` branch](https://github.com/kohz87/rpg_battle/tree/main).

## What it is

RPG Battle gives your story a character, a party and rules that code runs: dice checks, fights on a battle
board, items and gear, trade, crafting and a way back after a death. The story tells what happens; code sets
every number, so a swipe cannot reroll a lost fight and the model never makes up your stats.

It is a module of [Story Block](https://github.com/kohz87/Story_block), the host of Story Suite v2. It works
with Story Block alone, and does more beside [Story Director](https://github.com/kohz87/Story_director) (a story
clock, quests) and [NPC State Delta](https://github.com/kohz87/npc_state_delta) (how people feel about you).

## Install

1. SillyTavern **1.19 or newer**; try the beta in a separate profile.
2. Install **Story Block first** from `https://github.com/kohz87/Story_block`, branch **`v2`**.
3. **Extensions → Install extension**, paste `https://github.com/kohz87/rpg_battle`, choose the branch **`v2`**,
   reload.

Needs (`requires`): Story Block **2.0.0-beta.1 or later**. Without Story Block 2 RPG Battle shows one line in the extensions drawer and does nothing else; an older
Story Block 2 shows a red notice and RPG Battle waits. Works with, but does not need: Story Director, NPC State Delta. Update Story Block before
RPG Battle. Install help: [guide, Installing](https://github.com/kohz87/Story_block/blob/v2/docs/v2/GUIDE.md#installing).

## What you get

Switches are in **Settings → Features** (the **Find a feature** box helps). "No switch" means it is always on.

- **Your character and party** (Party tab; **Create your character** on Home's *Before you start* card, on Party and
  on the status strip): pick a pack's ready-made character or build one, race, talents, stat points; companions
  join through the story. No switch. The story waits until your character exists.
- **Dice checks, the check table** (the default, no switch): before each reply code rolls two d20s for each party
  member and tells the story, for each stat and skill, the hardest difficulty that roll reaches. The story picks the
  row and tells the outcome; code works it out again from the same dice. At most two checks a reply; a swipe brings
  fresh dice. No Roll button.
- **Visible dice:** each check is a line on Story Block's **Changed this reply** card (`story-block.cards`, on):
  the die, each bonus, the total against the difficulty. If the story told a different outcome than the dice
  gave, the card says so and the **next reply is told** what really happened.
- **Social modifiers from Delta:** with NPC State Delta, a persuade, charm, intimidate or deceive check against
  someone gets a small bonus or penalty ("Elula trusts you (+2)"). Other modules' modifiers together stay within
  ±5; the setting **Checks → Other modules' check modifiers, at most (±)** (0 turns it off). Delta's switch is
  `npc-state-delta.social`.
- **Strict mode:** with Story Block's pre-roll on (`story-block.preroll`, off by default), one cheap call fixes the
  stat and difficulty of a risky action before the reply and that check takes the 1st die.
- **Use on…** (Inventory tab, on a consumable's row): choose who a dose would help now. No switch; not while a
  fight has the party (use it from the Fight screen).
- **Fights** (Fight tab; an offer appears when the story starts one; no switch): you play Attack, Skill, Item,
  Defend, Parley or Flee on the battle board. Every foe the story writes is fought, in waves when there are many;
  quest fights bring enough foes for real progress. A fight that is over **settles before the next reply** even if
  you never pressed Finish, and the last fight then folds under "Last fight".
- **Conditions by story time** (Party card; `rpg-battle.effects` *Timed buffs and debuffs*, on): blessings, curses
  and what a fight left on you count down by the story clock, 10 story minutes a round. Needs Story Director's
  clock; without one they wait.
- **Skills** (Party card): each skill is a tile with its level; its hint and its line under *Use or set aside* show the uses toward the next level, "Lv 1 · 2/5 uses to Lv 2".
- **HP and MP come back with story time** (`rpg-battle.recovery`, on; needs Story Director's clock) and **story
  XP awards** (`+ xp minor|major|milestone`, no switch; code sets the amount).
- **Trade** (Trade tab, no switch): prices by place, shortages, commissions. **Gear wear and repair**
  (`rpg-battle.wear`, on) and **Gear refinement** (`rpg-battle.refine`, on).
- **Crafting** (Crafting tab; `rpg-battle.crafting`, on): you craft in the story, code rolls it with the reply's dice.
- **Return in time:** if your character dies you are offered **Return**, a new branch just before that fight
  (card on the Fight and Party screens). No switch.
- **Your world's words:** Settings → RPG Battle → **Character → Terms**: XP word, Level word, Rank ladder, Levels per rank.

## How a turn works

The model writes the story and ends it with a hidden `<Changes>` list. RPG Battle's lines look like this:

```
<Changes>
? check Persuasion — talk the guard round | dc: normal | result: success | vs: Elula
! encounter 3 Weir Rat — the cellar pack | tier: weak
! use Healing Salve | on: Wessel
+ xp minor — talked the guard round
</Changes>
```

Code rolls and decides: dice come from code, a fight is played by you, an item's effect comes from the item's own
numbers. Anything that does not fit is skipped and listed under **Problems**. Swipe, delete, Re-read and reload
stay correct because the state is kept with each reply. Details: Story Block's
[GUIDE](https://github.com/kohz87/Story_block/blob/v2/docs/v2/GUIDE.md) (Checks and modifiers, Fights, Trade)
and [SPEC](https://github.com/kohz87/Story_block/blob/v2/docs/v2/SPEC.md).

## Settings

Story Suite settings (the **Settings** button on the Story Suite bar) → the **RPG Battle** fold, in small
groups. The ones that matter:

| Setting | Group | What it does |
|---|---|---|
| XP word, Level word, Rank ladder, Levels per rank | Character → Terms | your world's names and ranks |
| Points a new character spends, Level cap | Character | creation and growth |
| Other modules' check modifiers, at most (±) | Checks | holds Delta's and others' modifiers; 0 off |
| Fights: foes on the field per party member / at most | Combat | the rest come in waves |
| Carry limit, Items that add carry capacity | Items | what the party can carry |
| Prices during a shortage (%), Prices by place | Trade | |

## With the other extensions

- **Story Block alone:** everything above works except what needs a clock (recovery and conditions by story time)
  and quest-sized fights.
- **With Story Director:** recovery and conditions follow the story clock, quests count your fights, and quest ranks
  follow your Terms ladder.
- **With NPC State Delta:** social checks read how someone feels about you; companions can use Delta's portraits.
- RPG Battle never needs a model call during a fight: the board is played by code.

## Known issues in this beta

- **Fighter balance.** The fighter is the weakest ready-made build in even fights from level 5; even and strong
  fights land on their target in about 30-36% of test cases. Tuning per build comes after the beta.
- Conditions and recovery by time need Story Director's clock; RPG Battle alone has no story time.
- Quest-sized fights (enough foes for a quest's real progress) need Story Director; without it a fight is as the story wrote it.
- The look of the settings screen is still to be redesigned.

The full list is in Story Block's [RELEASES](https://github.com/kohz87/Story_block/blob/v2/docs/v2/RELEASES.md).

## Links

- [Player guide](https://github.com/kohz87/Story_block/blob/v2/docs/v2/GUIDE.md), [Changelog](CHANGELOG.md),
  [Releases and known issues](https://github.com/kohz87/Story_block/blob/v2/docs/v2/RELEASES.md)
- Developers: [docs/dev](docs/dev/), [DESIGN](docs/DESIGN.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [CLAUDE.md](CLAUDE.md)
- History, decisions and the after-beta list: `suite-notes/` in
  [kohz87/inventory-block](https://github.com/kohz87/inventory-block/tree/claude/hopeful-babbage-tipaw8/suite-notes)
