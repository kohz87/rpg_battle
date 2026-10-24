# Progression (rules v2, first and second slice)

Code: `src/v2/rules/` (the pinned ruleset, its class and form graph, lookups, the party sheets, flags, item rules and the
generation bounds), `src/v2/progress/` (choices, offers, credits, guards, commands, the roster, the entry points, the fold),
`src/v2/training/` (the clock, the request, the host's step, the offers). Tests: `tests/v2/progress/`,
`tests/v2/rules/`, `tests/v2/training/`. Contract: `RB_CONTRACT` §3–§7, B3 and B5 in the track B design.

The parts (`rules/index.js`, `progress/index.js`) are **not registered** by `module.js`. They are one unit: `rulesParts`
(exported by `rules/index.js`) lists `['rules', part]` and `['progress', part]`, to register together or not at all
(`rules.settle` writes `progress`; every `progress` guard reads the `rules` pin). Registering them on a chat
adds the `rules` slice, whose root is the rules-v2 marker `sdk.preflight` reads, so the lead gates it on the host's
preflight (a legacy chat must stay legacy). Until then no existing chat, pack or command changes
(`tests/v2/progress/legacy.test.js`).

## Records

- `rules`: `{ schema, rulesVersion: 2, rulesHash, pin }`. `pin` holds what Story Block's checker gave
  (`resolved`, `RULES_V2_PROGRESSION`) and an identity; every number and every class and form is read from it.
- `progress.choices[<actor>|<milestone>]`: the basic class (0), promotions (10–30) and path steps (40–90). Class,
  three skills and forms are **derived** from them (`derive.js`), so a class change swaps all three skills at once.
- `progress.attempts[id]` / `progress.credits[id]`: every paid use, and what `rules.settle` decided for it
  (1 or 0 and why). Mastery and every cap are derived from what survives; nothing is cached.

## Rules in one place

- Mastery steps `[1,5,12,22,35]`; 35 uses is 5/5 and the cap (a mastered form earns 0, reason `mastered`).
- Caps per reply and per story day, skill and actor, shared by combat, narrative and training; zero results
  (`skill-reply`, `actor-reply`, `skill-day`, `actor-day`) stay on the ledger. **An unset clock holds, it does not zero:** an
  attempt with no minute of its own while there is no clock stays pending, with no credit row and no claim, until a clock
  is set (contract §4 "unset time holds only dependent actions", §3 `CLOCK_UNSET`). `rules.settle` answers `CLOCK_UNSET` when
  only such attempts remain, and the host's `afterCapture` does not ask for it while nothing can be settled. A dormant Story
  Director is the same thing.
- The oldest milestone is the only one offered; nothing is ever chosen for the player.
- A path step needs the advanced class, the skill's current form at 5/5 and the form it is taken from to be the
  one the skill holds (selected parent). A step whose parent is missing does not apply.

## Replay

Every choice and every settlement attaches a guard (`guard.js`) and a claim (`rb:<epoch>:class|path|credit:…`). `buildGuard`
is the one helper that builds a guard envelope (exported from `progress/index.js` for the other tracks: the same `source`
hashes the same everywhere). The epoch is `epochOf(ctx)` (`ctx.epoch` once Story Block provides it, else the state's
savepoints epoch, else the genesis epoch `ep_00000000`); the guard names it, the hook hashes with the guard's own epoch and
turns the block off when it is not the state's. A settlement's guard hashes each row's **day**, not its minute (the row keeps
the minute), so a minute edited within its day moves no later settlement. Choices are refused while the combat part holds
any session at all (a won fight that is not settled yet included); only a missing or throwing `combat.session` is no fight.
On the state before the block the hook asks the same question the command asked (`assess.js`); if it is no longer
earned the block stays stored but off (REPLAY_PREREQUISITE) and nothing replaces it. `rules.settle` asks to be
planned again (`replan`), so a zero credit can become a credit and the other way.

## The ledger stays bounded (slice 2 design; review item 7)

Measured: about 0.5 ms per attempt per reply (the validator, the draft and the replay all walk the domain), 2400 attempts
is 1.2 s a reply and a 3.2 s rebuild, and the 4000 cap failed `LIMITED` inside a payer's own transaction. **Chosen: a guarded
fold of settled attempts into per-form and per-day totals, in the same domain, plus two rules that keep the payer from ever
failing on size.** (Splitting the domain was not chosen: every cap and every mastery reads all of it, so a split moves the same
total across more files and a replay still walks every shard.)

- Only a **credit** counts toward anything (`note`: a 0 counts nothing). So what mastery and the caps need from a settled
  attempt is just its credited use: `progress.sealed = { forms: { "<actor>|<form>": uses }, days: { "<actor>|<skill>|<day>": uses },
  folded }`. The actor's day total is the sum of its skills' day entries. `tallyOf(rows, sealed)` adds them to the live counts,
  so every number derived from the ledger reads the same before and after a fold.
- **The fold** is part of `rules.settle` (no new command): when the ledger holds more than `FOLD_AT` (300) attempts, the
  settlement also folds every attempt that has a credit (existing or just planned) and whose boundary reply is not the one
  settling now: the attempt and its credit rows go, the sealed counts grow. The fold writes new totals (base + n), so the guard inputs carry the ids, the counts **and the totals they were added to**
  (`foldInputs`): a fold planned on other totals (an earlier fold was taken back) is off and planned again. (Chosen over one
  record per settlement, which would grow with every settlement and need a sum on every read.)
  When a reply that held a folded attempt is deleted or re-read, the settlement's guard no longer matches and the host plans
  the step again in place (`replan`), now without that attempt, so the totals follow the surviving story exactly as the
  rows did. Audit of old zero-credit attempts is the price (they counted nothing).
- **A payer never fails on size.** `recordAttempt` does not store an attempt that cannot earn: the third use of one skill in one
  form by one character on one reply (the per-reply skill cap is 2, and the reasons that zeroed the first two persist), for
  combat and narrative attempts that count on the clock's day. At the hard limit (4000 held, e.g. a clock unset for ever) it
  returns `{ dropped: true }` instead of `LIMITED`. A reply therefore adds at most a few dozen attempts, and the ledger stays
  near `FOLD_AT` plus what waits for a clock.

## Slice 2

**Entry points** (every caller attaches its own guard and claim; the progress side only records):

- `creation.finish { class, checkActor }` and `party.addCompanion { class }` call `startRulesClass` (`progress/start.js`): the
  milestone-0 class in the same transaction, a `class.start` guard. Nothing at all in a chat that pins no rules.
- Narrative use: the capture `! skill-use <actor> | skill: <def> | form: <def>` (and the internal `skill.use`) pays the form's
  cost from the pool, gives a `use` proof and records the attempt, or cites one surviving `use` proof (`paid`), never both.
- Combat end: `recordCombatUses(ctx, { fight, uses })`: a no-op in a chat with no pin and a skipped row for anything that cannot be
  an attempt, so a fight's end never fails on its ledger. Training completion: the host's step below.

**Commands and queries** (payloads as the contract §3 and track C's fixtures): `rules.party`, `rules.flags`, `rules.item`,
`rules.training`; `skill.train` (asks), `rules.settle { session }` (the host's step), `party.setActive`, `summon.end`,
`rules.flagSet`, `rules.registerItem`.

**Roster** (`progress/roster.js`): the PC and two durable companions are active; `party.setActive` is the player's, outside any
fight, 1 to 3 living durable members with the PC among them. Summons and pets are temporary units outside that limit;
`summon.end` ends one (the player may only dismiss).

**Training** (`training/`): `skill.train` only asks; the id of the session is the next one for that character, trainer, skill and
form (a function of the chat, never allocated by a query; a stale one is `STALE`). The host's `afterCapture` asks for
`rules.settle { session }` once the clock, the place and the purse can be read. The step rolls the 10% event die once (`ctx.roll`,
recorded), checks the trainer is here and the purse can pay, pays the fee (`wallet.pay`), moves the clock by exactly sixty
minutes (`director.advance`, rejected whole if it moved otherwise), and either interrupts (the fee and the time are spent, no
credit, no refund) or records two completion attempts that count on the day the session ended. A session the host cannot start
is refused with its reason and costs nothing. A request the host cannot start (the clock never set) would hold that character's
asks for good, so the player may withdraw it with `skill.cancelTrain { actor, session }` (**not in the contract's command list**:
the lead adds it or names another way; it keeps the session as `refused`, moves no coin and no time, and is guarded like a
request). A session keeps what it earned (`awarded`, `unearned`) so its view survives the fold.

**Flags** (`rules/flags.js`): a flag is declared by the keys the pinned requirements name; it is false until an authorized event
sets it. `rules.flagSet` takes a surviving Story Director `event` proof whose payload is exactly `{ flag, value }`, from Story
Director's adapter or this module's own step only, claims the evidence once and guards the block; a deleted proof turns the write
off. The adapter that gives the proof and asks in one block is trusted by the replay through `recorded.own`.

**Items** (`rules/items.js`, `rules/bounds.js`): `rules.item` reads the pin (a pack item's rule) or what was registered.
`rules.registerItem` is the single route for generated items (Story Block's own grant, and this module's craft, trade and loot
adapters): it recomputes the bounds from Story Director's tier for where the party is, rejects (never clamps) what is over,
registers the definition with Story Block in the same transaction and stores the def, the rule and the provenance. The bounds are
v1's numbers frozen (`bounds.js`), by the place's tier: rarity ceiling common/uncommon/rare/epic at tiers 0-1/2-3/4-6/7-9, level
ceiling `min(99, 10 * (tier + 1))`, stat budget `rarityBudget` at that level, effects at the story's own ceilings, never
legendary, at most 1000 item rules. The pack's frozen ItemDefs are registered by `registerPackDefs(ctx)` (activation calls it
inside its transaction).

**Level and XP from the pin** (`progress/level.js` `pinnedSettings`): a pinned ruleset's `xpPerLevel`, level cap, starting points,
points per level and stat cap override the reader's, in the party's commands, its capture, its prompt line and its combat numbers,
and in the creation wizard's budget. Hook lines outside this part: `party/sheets.js` (`rulesFrom(settings, rules)`,
`rulesSliceOf`), `party/commands.js`, `party/capture.js`, `party/context.js`, `party/queries.js`, `creation/build.js`
(`creationRules(settings, rules)`), `creation/commands.js` (three call sites).

## Differences from the contract and track C's fixtures, and gaps (written down, not decided)

- `rules.item` answers an `ItemRule` (the contract); C's fixture adds `frozen: true`, which the screens do not need.
- C08: the party part allows three companions by default, so a test party has one reserve, not two.
- **No flag or generation-template schema exists in the pack checker.** Flags are therefore the keys the pinned requirements name,
  and a generated item's source template is any pinned recipe (craft/), shop (trade/) or, for story items, nothing or any pinned
  recipe, shop, foe, quest or item. The shape of the event payload (`{ flag, value }`) is this module's reading; Story Director
  has not frozen one. D/E3 own the schemas.
- Story Block's grant passes `rule: null`: a rule is made only for an item that is not equipment (no slots, no hands, weight 0).
  **Equipment from a story line is refused** until track A's slot routing says how the five legacy slots map to the eight rule
  slots (`allowedSlots`, `hands`); a name is never read for one.
- No ceiling or floor for an item's `value`, and no per-template budget (P25 asks for template-derived ceilings; the pack schema
  has no template to derive from). The tier budget stands in for them.
- In a chat with no ruleset, `rules.registerItem` passes Story Block's own grant through to `inventory.registerDefinition`
  unchecked (a sub-command that fails would fail the whole grant, so there is no "not here" to answer). Left as the lead decided,
  with a TODO: once registration gating makes a handler `FEATURE_OFF` in a non-v2 chat this becomes a refusal.
- Story equipment stays refused until a later slice imports track A's `slotsForLegacy` (`src/v2/items/slots.js`, #142): imported,
  never copied. Flags and generation templates keep the interim rules above until D adds the schema; Story Director freezes `{ flag, value }`.
- A character's pinned rules are read through one helper (`rulesSliceOf`) at every site (screens, party queries and recovery, combat cards,
  creation); the item effect ceilings are held equal to the story's by a drift test (`tests/v2/rules/items.test.js`).
- The full resolved pin rides in every checkpoint (583 KB for a big pack); B3/E6 will store `resolved` once, keyed by `rulesHash`.
- Story Block must expose `resolved`, `rulesHash`, `packHash` and `RULES_V2_PROGRESSION` to the activation: `packs.rules` returns
  only the manifest today. That is an E/D task before activation.
- Slice 3 and later: combat actions, effects and conditions, death and return, Story Director checks, tiers and danger.

## Code that production does not reach yet

`pinRules` and `registerPackDefs` (activation), and the parts themselves (`rulesParts`, not registered by `module.js`). Everything
else above is reached through the commands and queries once the parts are registered.
