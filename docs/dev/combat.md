# Combat

Fights the story starts, played on the Fight screen, settled through the owners of party and inventory.
Detail: Story Block MODULES.md §B3 (combat, bestiary) and §F (decisions on tiers, waves, ranks, return in
time F17); this repo's README "A fight", "Fights from the story", "Monsters on the fly"; docs/DESIGN.md.

## Rules

- The story writes `! encounter <count> <Foe> — <note> | tier: … | stakes: normal|death` and **stops at the
  first blow** (static instruction). Capture keeps it as an **offer**; the reader fights it (`combat.start`)
  or turns it down (`combat.dismiss`). No story text settles a fight.
- Tiers: `trivial`, `weak`, `even`, `strong`, `deadly` (`TIERS`). A threat word is never a creature name.
  At most `MAX_COUNT` (9) per row and `MAX_ENCOUNTER_FOES` (54) per line; waves past the field cap
  (`fieldPerMember` × members, `fieldMax`) come in later, within the tier's budget; stunners capped per tier
  (`MAX_STUNNERS`). Bosses keep their level and are never resized.
- **Power-based sizing** (`power.js`): each creature's danger measured against the five creation presets
  at band levels (1, 5, 10, 20, 40, 60) with fixed-seed duels; HP and damage scaled by
  `√(reference / power)` within `SCALE_MIN`–`SCALE_MAX`. Deterministic and cached.
- **Quest-sized fights** (`quest.js`): a fight for a Story Director kill quest brings at least
  `QUEST_SHARE` (⅓) of the goal, at most what is missing, at most `QUEST_MAX_FOES` (24). Without Story
  Director nothing is quest-sized.
- A fight is stored as its **setup and the player's actions only** (`combat.session`); every view is rebuilt
  with v1's replay (`src/combat.js`), so a swipe or a deleted reply takes the fight back with its actions.
  Auto turns advance with the session seed; every random number comes from `ctx.rng`.
- During the fight HP/MP/SP follow the board (`party.fightPools`); items used are consumed at once
  (`inventory.consume`); an item sold or dropped mid-fight is cut before the next action (`stock`).
- A fight that is over and not finished on the board is settled before the next new reply (`settleBeforeReply`,
  the `combat.end` cue; not for a swipe, Continue, quiet or impersonate), so it never stays on.
- **The last fight folds** once the story has moved on: `combat.last` keeps the reply it was settled on
  (`reply`, from `ctx.reply`); the `combat.last` query answers `folded` and `fresh` (the head reply is the
  settled one, from `tools.reply`). Before a new reply whose head is a later reply, `settleBeforeReply` cues
  `combat.fold` (system only, a claim `combat:fold:r<rev>`); the Fight screen then shows
  "No fight on offer" with "Last fight" in a closed `<details>`. Swipe, Continue, quiet, impersonate: no fold.
- `combat.end` settles once: pools and conditions via `party.applyResult`, XP via `party.grantXp`, loot via
  `inventory.grant` (what cannot be carried is left and told, F39), coin via `wallet.receive`, foes beaten
  kept for Story Director (`combat.foesBeaten`), and the receipt summary the next reply narrates.
- Death with `stakes: death` leads to Return in time (`src/v2/return/`); the return card is drawn on the reply.
- Rank ladder and level words come from the reader's Terms (and packs), never from the story.

## Key files and functions

- `src/v2/combat/index.js` (part, commands `combat.start|act|flee|end|dismiss|fold`, queries), `encounter.js`
  (`readEncounter`, `tierOf`, `rankFoe`, `foesCard`), `setup.js` (`buildSetup`, `fightNumbers`, `planWaves`,
  `fieldCap`, `moneyScale`, `COMBAT_DEFAULTS`, `COMBAT_LIMITS`), `power.js` (`creaturePower`, `powerScale`),
  `quest.js` (`questSized`, `questTargets`), `stored.js` (`sessionOf`, fight rules), `view.js`.
- `src/v2/board/`: the Fight screen and battle-board widget. `src/v2/return/`: return point and card.
- v1 maths: `src/combat.js` (`act`, `availableActions`, `summarize`), `src/enemies.js`, `src/templates.js`.

## Tests that guard it

- `tests/v2/combat/` (`combat`, `waves`, `power`, `boss-rank`, `quest-fights`, `stun-rule`, `money-scale`,
  `gear-capped`, `foe-rank-tail`, `v2-rules`, `story-line-offer` (suite)), `tests/v2/board/`, `tests/v2/return/`.
- `tests/v2/qa/balance-tiers.test.js`, `qa/weak-foes.test.js`, `qa/fight-views.test.js`, `tests/balance.test.js`.
- Break findings: `tests/v2/break/a2-*` (ladder, waves, bosses, quest sizing; `a2-rules.test.js` alone, the
  rest need the suite), `b4-*`, `final-*`; fuzz: `tests/v2/qa/fuzz.test.js`, `tests/v2/break/fuzz-delete.test.js`.

## When you change it

- Re-run the balance tests and say in the PR how the tier hit rates moved; one tier change shifts all presets.
- New combat command or kind: add it to `tests/v2/qa/helpers/fuzz.js` and prove replay == live.

## Checks: the table, other modules' modifiers and the dice told back

- **The check table** (`checks/table.js`, default): `checks.prepare` rolls 2 d20s per member (`prepared.actors`,
  PC first, ≤ 4); the tail line per member groups every stat / topic / `vs Name` row by its cell for the 1st
  and 2nd die. Capture: the actor's die at the reply's place (`place` 1/2; crafts and a `pre` check count),
  the same `modifiersFor`, so the table and the record agree. No `actors` (an older chat): Roll by place.

- Before a check is resolved (`checks/commands.js` applyCheck), `checks/outside.js` asks Story Block's
  `ctx.gather('checkModifiers', { actor, skill, stat, target, dc })` (every other module's hook, MODULES §F126)
  and, for a social skill against someone, NSD's `npc.socialModifier({ name, skill })` (feature
  `npc-state-delta.social`; absent, off or throwing → nothing). Target: `vs:` / `target:`, else the first
  `scene.present` name the line's text has (`who:` stays the member making it). Each entry ±5, at most 4,
  the sum held to ±`checks.outsideCap` (default 5, 0 off) with a "held to ±N" entry; stored as modifiers with
  source `module`, so the card and the total show them. Read on the reply's state: Re-read and swipe agree.
- `checks.toldBack({ for })` (card.js): the next reply's tail lines "[Dice] … actually failed (5 vs DC 10): …"
  for the checks of the last carrier with a receipt before it (receipts), at most 2, not for `pre` checks
  (made by Story Block's `assist.precheck`). Tests: `tests/v2/checks/outside.test.js`.
