# Track A equipment (P07): eight slots, one planner

The frozen contract governs (§3 rules.equipPlan, §4 Slot, §5 Equipment/Carry, §9 adapters).

## What runs

- `src/v2/items/slots.js`: the eight IDs, labels, the compatibility counts `{accessory:2, worn:4}`, the §9
  read adapters (`mainhand`/`main-hand` -> weapon, `off-hand` -> offhand, `armour`/`armor` -> body).
  `worn`, `hands`, `waist`, a bare `accessory` and the numbered old keys (`worn-1`, `accessory-3`) name no single
  slot and are never guessed.
- `src/v2/items/equip-plan.js`: the pure planner. Candidates are the rule's slots that are LEGAL (an offhand is not
  while a two-hander is worn); the first empty one, else an explicit swap of the first. A stack moves only from its
  durable owner (the actor, or the party bag; the bag's worn piece is the main character's). Only a living member
  changes gear (refused in words; taking off needs no plan). Base stats only qualify; gear never qualifies itself.
- `src/v2/items/equip-query.js`: the registered pure queries `rules.equipPlan`, `items.slots`, `items.canWear`.
- `item.equip {stack, to?, actor?, targetSlot?}` only calls `inventory.equipOn` (Story Block asks the plan, checks it
  against its records and applies it in one step). Nothing in this part writes equipment, and no payload field can carry
  a plan, token or bypass.

## The binding (interim until B3)

`rules.equipPlan` reads `rules.identity` (hash), `rules.sheet` (base stats, life, kind) and `rules.item` (ItemRule).
When `rules.identity` answers, all three are used and none is guessed (a missing sheet is DEPENDENCY_UNAVAILABLE, a
missing rule RULES_MISMATCH). Until then `INTERIM_BINDING` ('rb-items-interim-1') supplies them:

- hash: a fixed hash of the binding's name;
- rule: from the def alone: one allowed slot from its slot word (adapters applied), hands 1 for weapon/offhand (2 with
  `two-handed`), no requirement, its carry weight. A def whose slot is generic has no slot and says so;
- sheet: the party domain's base stats and a life of alive/downed/dead.

Story Block checks every plan against `rules.sheet`, so `module.js` carries a lead-owned interim `rules.sheet`
(`interimSheetQuery`, only equipment's inputs, not a SheetView). It steps aside as soon as a part registers the
real query; delete it and `INTERIM_*` with B3's frozen rules.

## Old saves and packs

Reading never writes. A save's `armour` key reads as body; `accessory-1/2`, `weapon`, `offhand` are canonical. A
`worn-1` or bare `accessory` record is listed as unplaced in `items.gear` (not counted, told why), kept exactly as
stored, never displaced, and it blocks nothing. Its def is generic too, so it cannot be worn again until the pack or
the story names one of the eight slots (`slot: head`). Fixtures: `tests/v2/items/fixtures/old-six-slot-save.json`
(written untouched by the six-slot runtime) and the Ersveil Bluewatch pack.

## Limits that went away

`gear.worn` and `gear.accessories` are no longer settings: `gearLimits()` is `{worn:3, accessory:2}` (head, legs, feet;
accessory-1/2), one piece to a slot. Carry weights keep their old numbers per slot (body = armour, legs = a worn piece).

## Open

- B3's frozen ItemRules/hash/sheet replace the interim binding (and give a piece two slots or a requirement).
- Generated gear (craft, trade, loot) still writes the old slot words; `rules.registerItem` (B3) must write canonical
  slots, or such pieces (worn, bare accessory) stay unwearable.
- The six-slot paperdoll (track C, `screens/paperdoll.js`, `view.js`) reads `items.slots` counts the old way; draft #139
  replaces it with the eight-slot tiles.
- `party/sheets.js gearOf` (the fallback when `items.gear` does not answer) still reads the old words.
