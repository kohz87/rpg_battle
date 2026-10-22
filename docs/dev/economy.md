# Economy: trade, money, carry, crafting

How coin and goods move. Detail: Story Block SPEC §7 (inventory, wallets, counters, the story budget,
`inventory.economy`), MODULES.md §B2 items, §B4 trade and §F (F36 shortages, F39 carry, F102 crafting, the
money-scale and story-money decisions); PACKS.md (goods, markets, crafts, value guide); README "Trade",
"Money", "Equipment and loot".

## Rules

- **Code sets every number.** Prices come from v1's pricing (`src/trade.js`, `itemWorth`) and the place;
  money and goods move only through Story Block's commands (`wallet.pay`, `wallet.receive`,
  `inventory.grant`, `inventory.consume`), all called from `src/v2/trade/calls.js`.
- **Story money is budgeted per reply** by Story Block's inventory (one budget per reply, clicks included;
  `inventory.storyBudget` tells what is left). A module's `wallet.receive` with `story: true` counts against it.
  Story-made goods resell for no more than one reply's story money; the sell factor for story-valued items
  is held to ≤ 1.
- Story words cap: an item's effect from a story note is held to `STORY_EFFECT_MAX` (heal 250, MP 40,
  damage 250); a story rarity is never legendary (`src/v2/limits.js`). Imported character files: worth held
  to twice the purse cap, excess dropped with a note.
- **Money scale:** a pack's `economy.scale` (read settled through `inventory.economy`, reader override
  wins) scales loot, coin and prices; stored writes are never rescaled.
- **Carry (F39):** goods bought, collected or looted are weighed first (`items/carry.js`); too heavy → nothing
  paid or taken (loot left behind and told).
- `trade` domain keeps only what cannot be worked out again: orders waiting with a crafter and what was bought
  per shop per story day (`MAX_SHOP_WRITES`, `MAX_PAID`); stock and prices are derived on read.
- **Shortages:** the `market` change line marks or lifts a shortage at a place (`MAX_SHORTAGES`), kept keyed.
- **Crafting** (feature `rpg-battle.crafting`): recipes from packs and the story; story-taught outputs worth
  ≤ 1.5× their inputs; a qty-N recipe divides its value.
- Wear and refine (features `rpg-battle.wear`, `rpg-battle.refine`) through `trade/repair.js`.
- Bookkeeping per reply is keyed by `ctx.carrier.sid` and pruned with key removes (Story Block SPEC §2.2).

## Key files and functions

- `src/v2/trade/index.js` (commands `trade.sell|buy`, `craft.commission|collect`, queries `trade.*`),
  `core.js` (`planSell`, `planBuy`, `planCollect`, `planCommission`, `stockOf`, `marketOf`, `currentShortages`,
  `gearResale`, `storyMade`), `calls.js` (`pay`, `receive`, `grant`, `consume`, `tooHeavy`), `markets.js`,
  `repair.js`, `craft-plan.js`, `page.js`.
- `src/v2/craft/` (`rules.js`, `make.js`, `book.js`, `commands.js`), `src/v2/items/carry.js`, `src/v2/limits.js`.
- v1 maths: `src/trade.js`, `src/items.js`, `src/craft.js`.

## Tests that guard it

- `tests/v2/trade/`, `tests/v2/craft/` (incl. `fuzz-delete.test.js`), `tests/v2/items/carry.test.js`.
- `tests/v2/qa/conservation.test.js` (no money from nowhere), `qa/currency.test.js`, `qa/fuzz.test.js`.
- Break findings: `tests/v2/break/b3-*` (commission resale, claim collision, item worth, import file),
  `a2-story-named-pack-goods-capital`, `a2-prices-ignore-money-scale`, `a2-carry-*`.

## When you change it

- Prove conservation: a sell/buy/craft loop must not create coin; add the new command to the fuzz.
- A price or cap change: README "Trade"/"Money" and CHANGELOG in the same PR.
