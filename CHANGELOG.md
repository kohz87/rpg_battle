# Changelog

## 0.3.0

The story and the numbers agree.

- **State line** on the Character block and each Party section: HP, MP and conditions in words the model must portray ("badly hurt (bleeding, slow to move) · drained of magic · poisoned"), worked out by code with bands in `rules.json` (`narrative`) and never read back. The blocks' prompt notes say to portray it exactly and never contradict it, and that the scene's Visible Condition must agree. The hand-off ends each member's line with the same words, and the Battle tab shows them under the HP and MP bars.
- **Story wounds:** a short instruction (about 90 tokens, its own prompt key, while a Character block exists) asks the model for a hidden `<Wounds>` block when the story itself hurts or heals someone on the sheets: `Name — scratch|wound|severe|grievous: cause`, `Name — heal <word>: cause`, `Name — poisoned: cause`, `Name — cure poison: cause`. Code turns the word into a share of max HP (`rules.json` → `wounds`: 10 / 30 / 50 / 80 %); harm can down someone, healing stops at max, one harm-or-heal line per person per reply, names matched by full or first name. Applied after story-time recovery, into that reply, from the sheets before it (swipes recompute, continues do not double), never during or narrating a fight; a reply whose sheets were changed since (a rest, an item, a fight) is left alone.
- **Undo** for story wounds, in a toast and in the Battle tab, while that reply's sheets are still the ones it wrote; undone wounds stay undone for that reply's text.
- **Fights from the story:** the model names a fight that breaks out in a hidden `<Encounter>` block (`3 bandit, bandit captain (boss)`) and stops at the first blow; a toast and the Battle tab offer **Fight?** (the setup opens with the rows filled in, still editable) or **Not now**. With Story Director 0.8, its planned fights that are due or due soon (`StoryDirector.encountersAt`) are offered the same way.
- **Story Block's Character Sheet** block on beside RPG Battle is pointed out in the Battle tab and the settings ("two HP values will disagree"), with a **Turn it off** button; it is never turned off on its own.
- `<Wounds>` and `<Encounter>` are registered as transport-only Story Block blocks, so they never show in the narration.
- **Your world's terms** (Settings → Terms): a level name, an XP name, optional tier titles (`size` levels per tier, Roman or Arabic numerals: levels 1–10 are "Soul Class I"…) and a level cap. The Character block and Party sections write the level line in them (`Soul Class: III (Lv 24) | Soul Growth: 28.10/100 | Points: 2`, or `Soul Power: 24 | Power Growth: 5400/11760 | Points: 2`) and read back the canonical form, any terms form (also without the colon) and older blocks; with tiers, progress is the share through the current tier. The Battle tab, the result screen and the hand-off's XP line (`Soul Growth +12%`, `Power Growth +38`) use them, and the Character block's Story Block fields are registered under them (again when they change, and the sheets are rewritten in the new words).
- **Level cap:** no level past it, XP stops there and shows MAX (also with the plain terms, at 99).
- **Enemy power in your terms:** with terms of your own, the setup's rank picker offers your tiers (or levels) up to the cap instead of F–SSS; a picked level is placed on the tuned rank table by interpolating between the two ranks that bracket it (`rankRowForLevel`, `projectEnemy({ level })`), and enemy cards show it in your terms. `<Encounter>` may name a power in brackets (`3 wolf (Soul Class I)`, `bandit captain (boss, Soul Class II)`, `(level 12)`). F–SSS work as before with the plain terms.
- **Edit companion:** a companion's name, role and control, from their row in the Battle tab; sheet, skills and gear stay, and their mastery progress moves with them when the rename changes their id.

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
