# Changelog

## 0.1.0

The first release.

- **Character**: no classes; seven stats from 5 with 10 points to spend, three starter skills (five optional presets), a Character block kept by RPG Battle (Story Block 0.7) that the model reads every reply and never writes, with a Checks line the Dice block uses as its modifier.
- **Levels and points** you spend yourself; **skills** learned by hand from the library (with stat requirements) or from a template, with mastery that grows with use; **Rest**.
- **Fights resolved in code**: Start fight with any enemy names (a 20-creature bestiary, ranks F to SSS, five roles, bosses), turn order, hits, criticals, damage, defend, conditions, cooldowns, items, parley and flee; enemies and auto companions by predictable rules; **Auto**; waves in the engine. Seeded, stored as setup and actions, replayed exactly after a reload.
- **Equipment** from the Inventory block, its stats capped by rarity and level; **consumables** used in fights; **loot and money** written back into the inventory, money in copper/silver/gold, one coin, or your own currency.
- **The hand-off**: one short summary injected into the next reply only (its swipes narrate the same result), with *Return to story*.
- **Party** block for companions on auto or command.
- Balance tuned by a simulation in the test suite: an even solo fight lasts about 5 rounds and costs about half your HP.
