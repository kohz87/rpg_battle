# Changelog

## 0.3.3

- **Story Suite overlay support** ([docs/STORY_SUITE.md](docs/STORY_SUITE.md#one-place-to-manage-them-all)): the announcement names the settings panel (`settings: '#rpg_battle_settings'`), which Story Block's overlay shows in RPG Battle's tab, and `api.manage` lets the overlay set the Source of truth (`areas`, `sources()`, `setSource(area, choice)`, unknown areas and choices ignored) and the on/off switch (`enabled()`, `setEnabled(on)`), saved and applied exactly as the panel's own controls, which show the change.
- **Switched off, RPG Battle is announced with `enabled: false`** instead of withdrawn, so the overlay can switch it back on; the suite skips it for ownership, `has` and `api` as before.
- **Manage all in Story Suite** at the top of the settings, while two or more extensions are announced and Story Block offers the overlay; it opens on RPG Battle's tab (marked `data-story-suite-link`, so the overlay hides it while the panel is inside it). Alone, nothing changes.
- **A new character takes your persona's name:** the Name box starts with the SillyTavern persona's name (`name1`, trimmed), with a hint saying so, and follows a persona switch until you type in it; a name you type stays yours. Companions and Edit companion are unchanged.

## 0.3.2

- **Settings in sections:** Money, Equipment, Terms, Monsters, Source of truth and Blocks fold, each one line with a summary until opened ("copper / silver / gold", "1 worn · 2 accessories", "Soul Class · Soul Growth · tiers", "Flavour on", "Automatic", "Character · Party · Inventory"); the on/off switches and the Character Sheet notice stay on top. All start closed; which are open is remembered in this browser.

## 0.3.1

Equipment limits you can see.

- **Worn pieces:** helms, hoods, gloves, gauntlets, bracers, boots, greaves and belts are a slot of their own (`worn`; from the name, a category like `[Equipment > Boots]`, or `slot: worn`), so they no longer take the two accessory places from rings and amulets. A helm or boots in `[Equipment > Armour]` is a worn piece, not the body armour. Singular names count too ("Leather Gauntlet").
- **How many count:** one worn piece and two accessories by default; **Settings → Equipment** sets each from 0 to 9 (`rules.gear`). Weapon, off-hand and armour stay one each.
- **Gear in the Battle tab:** what the fight uses, with its stats as capped by rarity ("STR +2 · capped from STR +20"), and a *Not counted* line for anything else marked equipped, with why ("only 2 accessories count", "one weapon counts", "Greatsword is two-handed").

## 0.3.0

The story and the numbers agree.

- **State line** on the Character block and each Party section: HP, MP and conditions in words the model must portray ("badly hurt (bleeding, slow to move) · drained of magic · poisoned"), worked out by code with bands in `rules.json` (`narrative`) and never read back. The blocks' prompt notes say to portray it exactly and never contradict it, and that the scene's Visible Condition must agree. The hand-off ends each member's line with the same words, and the Battle tab shows them under the HP and MP bars.
- **Story wounds:** a short instruction (about 90 tokens, its own prompt key, while a Character block exists) asks the model for a hidden `<Wounds>` block when the story itself hurts or heals someone on the sheets: `Name — scratch|wound|severe|grievous: cause`, `Name — heal <word>: cause`, `Name — poisoned: cause`, `Name — cure poison: cause`. Code turns the word into a share of max HP (`rules.json` → `wounds`: 10 / 30 / 50 / 80 %); harm can down someone, healing stops at max, one harm-or-heal line per person per reply, names matched by full or first name. Applied after story-time recovery, into that reply, from the sheets before it (swipes recompute, continues do not double), never during or narrating a fight; a reply whose sheets were changed since (a rest, an item, a fight) is left alone.
- **Undo** for story wounds, in a toast and in the Battle tab, while that reply's sheets are still the ones it wrote; undone wounds stay undone for that reply's text.
- **Fights from the story:** the model names a fight that breaks out in a hidden `<Encounter>` block (`3 bandit, bandit captain (boss)`) and stops at the first blow; a toast and the Battle tab offer **Fight?** (the setup opens with the rows filled in, still editable) or **Not now**. With Story Director 0.8, its planned fights that are due or due soon (`StoryDirector.encountersAt`) are offered the same way.
- **Story Block's Character Sheet** block on beside RPG Battle is pointed out in the Battle tab and the settings ("two HP values will disagree"), with a **Turn it off** button; it is never turned off on its own.
- **Story Suite handshake** ([docs/STORY_SUITE.md](docs/STORY_SUITE.md); `src/suite.js`, the same file in Story Block, Story Director and NPC State Delta): while it is on, RPG Battle announces itself as `rpg-battle` owning `stats` and `rolls`, and `items` after Story Block's Inventory, and is withdrawn when switched off. `api.members()` shares the party: the Character and each companion as frozen copies `{ id, name, role, level, levelLabel, hp: { cur, max }, mp: { cur, max }, state }` from the kept sheets (`[]` without one). The Character Sheet notice now follows the suite: shown while Story Block offers `stats` and RPG Battle is the source of truth for them; a Story Block that does not join the suite is read from its settings as before. **Settings → Source of truth**: Automatic, This extension or The other one for stats, roll modifiers and items (`sourceOfTruth`, default Automatic), with who the story follows now; alone, nothing changes.
- `<Wounds>` and `<Encounter>` are registered as transport-only Story Block blocks, so they never show in the narration.
- **Your world's terms** (Settings → Terms): a level name, an XP name, optional tier titles (`size` levels per tier, Roman or Arabic numerals: levels 1–10 are "Soul Class I"…) and a level cap. The Character block and Party sections write the level line in them (`Soul Class: III (Lv 24) | Soul Growth: 28.10/100 | Points: 2`, or `Soul Power: 24 | Power Growth: 5400/11760 | Points: 2`) and read back the canonical form, any terms form (also without the colon) and older blocks; with tiers, progress is the share through the current tier. The Battle tab, the result screen and the hand-off's XP line (`Soul Growth +12%`, `Power Growth +38`) use them, and the Character block's Story Block fields are registered under them (again when they change, and the sheets are rewritten in the new words).
- **Level cap:** no level past it, XP stops there and shows MAX (also with the plain terms, at 99).
- **Enemy power in your terms:** with terms of your own, the setup's rank picker offers your tiers (or levels) up to the cap instead of F–SSS; a picked level is placed on the tuned rank table by interpolating between the two ranks that bracket it (`rankRowForLevel`, `projectEnemy({ level })`), and enemy cards show it in your terms. `<Encounter>` may name a power in brackets (`3 wolf (Soul Class I)`, `bandit captain (boss, Soul Class II)`, `(level 12)`). F–SSS work as before with the plain terms.
- **Edit companion:** a companion's name, role and control, from their row in the Battle tab; sheet, skills and gear stay, and their mastery progress moves with them when the rename changes their id.
- **Threat words in an encounter:** `<Encounter>3 marsh wolf (weak), wolf matriarch (boss, strong)</Encounter>`: trivial, weak, even, strong, deadly (and synonyms: minor, lesser, tough, dangerous, lethal, elite…), in brackets or, for the unmistakable ones, before the name. They are relative to the party: the Character's level plus `rules.json` → `threat.offsets` steps (−2, −1, 0, +1, +2), a step being one tier with tier titles on, else `threat.step` (4) levels, within 1 and the cap. A rank or level written outright wins. The setup shows the word beside the power it became. The story instruction mentions them (about 108 tokens at four characters a token, from 92; the test bound moved from 95 to 110).
- **Plurals of creature words** are made singular in an encounter ("3 bog wights" → three Bog Wights), so a made-up creature is not named as a plural.
- **Monsters on the fly:** a foe neither bestiary knows is made up when its fight starts, from a template its name's words pick (beast, undead, humanoid, leader, caster, construct, ooze, insect, drake, spirit, plant, or a fallback): a role, traits that move its numbers within bounds (`rules.json` → `generated.traits`, product within 0.6–1.5), whether it talks, a temperament (morale, when it flees), two or three skills of its kind built by the skill machinery at the level it is fought at, and a loot table of its kind with gear rarity from its power. Deterministic per name, level and chat. A balance test holds an even fight against made-up foes near one against projected ones.
- **Flavour** (on by default): one model call per new creature (at most four per fight, 30 seconds for all), on the chat's model or a connection profile, asks for words only (look, traits, talks, temperament, skill names with a few words, loot names with a rarity and a stat); code maps the words onto the template's knobs, renames skills and loot, drops every number and every unknown word, and caps rarity one step above the creature's. Failure, timeout or no model: the template creature, with a console note. *Preparing foes…* in the setup meanwhile. Settings → Monsters: on/off, model, answer length.
- **The chat's bestiary:** made-up creatures are kept in the chat metadata (`rpgBattle.bestiary`, cleaned on every store), so a name is the same creature for the rest of the story; names are looked up there first, then in the shipped bestiary, then made up. The setup tags unknown names **new**, so do the cards of creatures made for this fight; a **Bestiary** fold on the Battle tab lists this story's creatures (power in the terms, role, traits, look) with **Regenerate**, **Forget**, **Export** and **Import** (JSON, cleaned on the way in).

## 0.2.0

Recovery and companions.

- **Recovery as story time passes** (with Story Director 0.7.2+): after each reply, 5 % of max HP and MP per story hour since the reply before, and a full rest after 6 hours or more; written into that reply (swipes and edits recompute it), with a note in the Battle tab. Switchable in the settings.
- **Short rest** (a quarter back) and **Long rest** (full, fight conditions end) replace Rest.
- **Use item** out of a fight: heals, MP and cures from the Inventory block, on you or a companion, taken off the inventory; damage items stay for fights.
- **Add companion**: name, role, level, build (preset), control and optional equipment; companions join the Party block, fight beside you, and can be switched between auto and command or removed (two clicks).

## 0.1.0

The first release.

- **Character**: no classes; seven stats from 5 with 10 points to spend, three starter skills (five optional presets), a Character block kept by RPG Battle (Story Block 0.7) that the model reads every reply and never writes, with a Checks line the Dice block uses as its modifier.
- **Levels and points** you spend yourself; **skills** learned by hand from the library (with stat requirements) or from a template, with mastery that grows with use; **Rest**.
- **Fights resolved in code**: Start fight with any enemy names (a 20-creature bestiary, ranks F to SSS, five roles, bosses), turn order, hits, criticals, damage, defend, conditions, cooldowns, items, parley and flee; enemies and auto companions by predictable rules; **Auto**; waves in the engine. Seeded, stored as setup and actions, replayed exactly after a reload.
- **Equipment** from the Inventory block, its stats capped by rarity and level; **consumables** used in fights; **loot and money** written back into the inventory, money in copper/silver/gold, one coin, or your own currency.
- **The hand-off**: one short summary injected into the next reply only (its swipes narrate the same result), with *Return to story*.
- **Party** block for companions on auto or command.
- Balance tuned by a simulation in the test suite: an even solo fight lasts about 5 rounds and costs about half your HP.
