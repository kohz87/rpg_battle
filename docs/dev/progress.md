# Progression (rules v2, first slice)

Code: `src/v2/rules/` (the pinned ruleset, its class and form graph, lookups), `src/v2/progress/` (choices, offers,
credits, guards, commands), `src/v2/training/` (the clock arithmetic only). Tests: `tests/v2/progress/`,
`tests/v2/rules/`, `tests/v2/training/`. Contract: `RB_CONTRACT` §3–§7, B3 and B5 in the track B design.

The parts (`rules/index.js`, `progress/index.js`) are **not registered** by `module.js`. Registering them on a chat
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
  (`skill-reply`, `actor-reply`, `skill-day`, `actor-day`, `clock`) stay on the ledger.
- The oldest milestone is the only one offered; nothing is ever chosen for the player.
- A path step needs the advanced class, the skill's current form at 5/5 and the form it is taken from to be the
  one the skill holds (selected parent). A step whose parent is missing does not apply.

## Replay

Every choice and every settlement attaches a guard (`guard.js`) and a claim (`rb:<epoch>:class|path|credit:…`).
On the state before the block the hook asks the same question the command asked (`assess.js`); if it is no longer
earned the block stays stored but off (REPLAY_PREREQUISITE) and nothing replaces it. `rules.settle` asks to be
planned again (`replan`), so a zero credit can become a credit and the other way.

## Open (written down, not decided here)

See the PR description: epoch source (E6), how production code reaches Story Block's checker, the creation and
payer entry points (`recordBasicClass`, `recordAttempt`), attempt-ledger growth, unset-clock policy, `rules.settle`
boundary, training sessions and offers.
