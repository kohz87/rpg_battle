# Track A equipment (P07): eight slots, one planner

The frozen contract governs (§3 rules.equipPlan, §4 Slot, §5 Equipment/Carry, §9 adapters).

## What runs

- `src/v2/items/slots.js`: the eight IDs, labels, the compatibility counts `{accessory:2, worn:4}`, the §9
  read adapters (`mainhand`/`main-hand` -> weapon, `off-hand` -> offhand, `armour`/`armor` -> body) and
  `slotsForLegacy(word) -> {slot} | {choose:[...], auto} | null`, the one pure mapping for legacy words:
  `weapon`, `offhand`, `armour` are one slot; a bare `accessory` is `accessory-1|2` with `auto:true` (first empty,
  else the explicit target); `worn` is head|body|legs|feet, `hands` weapon|offhand, `waist` accessory-1|2, all
  `auto:false` (the reader names the slot with `targetSlot`; without it the plan is refused with the list); anything
  else (`worn-1`, `accessory-3`, unknown words) is null. The rules never pick among kinds of slot.
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
  `two-handed`), no requirement, its carry weight. A generic word has no slot but a choice (`env.choices`, from
  `slotsForLegacy`); a word that names nothing gets no slot and says so;
- sheet: the party domain's base stats and a life of alive/downed/dead.

## Where the planner is registered

Story Block takes a module that answers `rules.equipPlan` as a ready rules module: it then plans, checks and applies
every equip through it, and checks the plan against the wearer's `rules.sheet` (which only the rules parts answer).
So the items part lists `rules.equipPlan` in `pinnedQueries`, and `module.js` registers it only behind the host's
pinned preflight, beside the rules parts that give it `rules.sheet`, `rules.identity` and `rules.item` (the frozen path
of `equipEnv`). A chat that pins no rules has no planner and no `rules.sheet`, and
Story Block keeps storing its equipment as it always did (contract §9); `item.equip` there is `inventory.equipOn`'s
own placement. The read-only `items.slots` and `items.canWear` answer either way (without the seams, from the interim
binding above), and `creation.import` asks the same pure planner in place when no module answers it, so a file's worn
pieces are still put on. Tests of the planner on a plain module pass `tests/v2/items/helpers/equip-parts.js`
(`createModule({ parts })`): the planner as a part of its own and a stand-in `rules.sheet` (`interimSheetQuery`, only equipment's inputs, not
a SheetView). Delete the stand-in and `INTERIM_*` with B3's frozen rules.

## Old saves and packs

Reading never writes. A save's `armour` key reads as body; `accessory-1/2`, `weapon`, `offhand` are canonical. A
`worn-1` or bare `accessory` record is listed as unplaced in `items.gear` (not counted, told why), kept exactly as
stored, never displaced, and it blocks nothing. Its def carries a generic word, so the reader re-equips it by choosing
a slot (`items.canWear` answers `{ok:false, why, choose:[...]}` so a screen can ask). Fixtures:
`tests/v2/items/fixtures/old-six-slot-save.json` (written untouched by the six-slot runtime) and the Ersveil Bluewatch pack.

## Limits that went away

`gear.worn` and `gear.accessories` are no longer settings: `gearLimits()` is `{worn:3, accessory:2}` (head, legs, feet;
accessory-1/2), one piece to a slot. Carry weights keep their old numbers per slot (body = armour, legs = a worn piece).

## Open

- B3's frozen ItemRules/hash/sheet replace the interim binding (and give a piece two slots or a requirement).
- Generated gear (craft, trade, loot) still writes the old slot words; they are wearable through `slotsForLegacy`'s
  choice. `rules.registerItem` (B3) should call `slotsForLegacy` for story-line equipment.
- Story Block's apply-side plan check should also require that a move comes from the stack's durable owner (today only
  this planner refuses another member's piece).
- The six-slot paperdoll (track C, `screens/paperdoll.js`, `view.js`) reads `items.slots` counts the old way; draft #139
  replaces it with the eight-slot tiles.
- `party/sheets.js gearOf` (the fallback when `items.gear` does not answer) still reads the old words.
