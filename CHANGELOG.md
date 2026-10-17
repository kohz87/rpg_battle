# Changelog

## 0.3.0

The story and the numbers agree.

- **State line** on the Character block and each Party section: HP, MP and conditions in words the model must portray ("badly hurt (bleeding, slow to move) · drained of magic · poisoned"), worked out by code with bands in `rules.json` (`narrative`) and never read back. The blocks' prompt notes say to portray it exactly and never contradict it, and that the scene's Visible Condition must agree. The hand-off ends each member's line with the same words, and the Battle tab shows them under the HP and MP bars.

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
