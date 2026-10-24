# Progression (rules v2, first slice)

Code: `src/v2/rules/` (the pinned ruleset, its class and form graph, lookups), `src/v2/progress/` (choices, offers,
credits, guards, commands), `src/v2/training/` (the clock arithmetic only). Tests: `tests/v2/progress/`,
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

## Code that production does not reach yet (slice 2 wires it)

`recordBasicClass` and `recordAttempt` (the entry points creation, party, combat end, narrative use and training call),
`pinRules` (activation), `readClock` for the settlement (the host's clock query), `PREREQUISITE_REMOVED` and `GUARD_KINDS`
(the hook's own). They are exercised by the tests only, until the parts are registered and the payers call them.

## Open (written down, not decided here)

See the PR description: epoch source (E6), how production code reaches Story Block's checker, the creation and
payer entry points (`recordBasicClass`, `recordAttempt`), attempt-ledger growth, `rules.settle`
boundary, training sessions and offers.
