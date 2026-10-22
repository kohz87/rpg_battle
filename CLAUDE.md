# RPG Battle: notes for coding agents

RPG Battle 2 is a **module** of Story Suite v2 (module id `rpg-battle`). Story Block (kohz87/Story_block,
the host) keeps the state, runs the commands, reads the replies' `<Changes>` lines and builds the prompt;
this repo registers one module definition through Story Block's sdk: party, character creation, checks,
items and gear, combat and the battle board, return in time, trade, crafting, screens. The other modules
are Story Director (kohz87/Story_director) and NPC State Delta (kohz87/npc_state_delta).

RPG Battle must work **alone with Story Block** (no Story Director, no NSD): read other modules only
through guarded queries with a fallback (no level → lowest rank, no clock → no story time) or optional
commands, and test every change with each other module absent. Work is on the `v2` branch (`main` is v1).

## Directory map

- `index.js`: SillyTavern entry; waits for the v2 host and registers `src/v2/module.js`. `v1.js` is v1 glue, not loaded.
- `src/v2/module.js`: merges the parts (`PARTS`, in order) into one definition; settings namespaced per part; terms.
- `src/v2/party/`: `party` domain, pools (`lost` counters), growth, XP lines, story wounds, recovery.
- `src/v2/creation/`: character creation (presets, persona, wizard, Create button).
- `src/v2/checks/`: pending d20 checks (`? check`), modifiers, dice.
- `src/v2/items/`: item use, equip, item.define (story notes), carry limit (F39), gear wear/condition.
- `src/v2/combat/`: encounters (`! encounter`), fight setup, power-based sizing, waves, quest-sized fights, results.
- `src/v2/board/`: the Fight screen (battle board widget, its queries).
- `src/v2/return/`: return in time after death (point and card).
- `src/v2/trade/`: sell, buy, commissions, shortages (`market`), repair and refine.
- `src/v2/craft/`: crafting from the story (feature `rpg-battle.crafting`), recipe book.
- `src/v2/screens/`: default screens (party, trade, crafting, HUD, status card).
- `src/v2/limits.js`, `src/v2/lines.js`: caps for numbers from words or files; shared line helpers.
- `src/*.js`: v1's pure logic reused by v2 (combat maths `combat.js`, `items.js`, `trade.js` pricing, `growth.js`,
  `skills.js`, `templates.js` bestiary, `terms.js`, `rng.js`, ...).
- `tests/*.test.js`: v1 logic tests (incl. a balance simulation). `tests/v2/<part>/`: per-part tests;
  `tests/v2/qa/` (fuzz, conservation, balance tiers, contracts), `tests/v2/break/` (one file per break finding),
  `tests/v2/integration/` (wiring on the real testkit).
- `tests/vendor/story-block/`: Story Block's testkit + runtime, vendored (VERSION names the commit).
- `docs/`: `ARCHITECTURE.md`, `DESIGN.md`, `STORY_SUITE.md`; `docs/dev/`: short area notes.

## Commands

Node 24 in CI (node ≥ 22 works locally). No dependencies.

```sh
npm test                                         # what CI runs (with npm run check and git diff --check)
npm run test:dot                                 # same files, one dot per test, failures listed at the end
npm run check                                    # syntax check
node --test --test-reporter=dot tests/v2/combat/waves.test.js   # one file
npm run sync-testkit                             # re-vendor the testkit from ../Story_block (or $STORY_BLOCK)
git diff --check origin/v2                       # CI fails on trailing whitespace in what the PR adds
```

Full suite: about 1,550 tests, about 2–3 minutes. Skills: `.claude/skills/run-tests`, `sync-testkit`.

## Non-negotiables (every PR keeps them)

1. **Code sets numbers; the story proposes.** Clamp, cap per reply, claim once. Story words never mint coin,
   items, XP, HP (story effects held to `STORY_EFFECT_MAX`; story rarity never legendary).
2. **Per-reply bookkeeping** keyed by carrier `sid` / id with add-only ops (or derived); no positional appends,
   no `replace` of another reply's fields (Story Block SPEC §2.2). Prune with key removes.
3. **Replay == live** after swipes, middle deletes, rewinds, reloads. `tests/v2/break/fuzz-delete.test.js`,
   `tests/v2/craft/fuzz-delete.test.js` and `tests/v2/qa/fuzz.test.js` must pass; add new kinds and commands
   to `tests/v2/qa/helpers/fuzz.js`.
4. **Static prompt byte-identical** reply to reply; new static lines only via a Feature or a setting. Tail short.
5. **Every optional mechanic is a Feature (F100):** declare in the part's `features`, tag kinds, commands,
   queries, context, hooks, screens with `feature:`; check `ctx.feature(id)` (absent host support → on).
6. **Story-driven:** no buttons for story actions (no Fight/Travel buttons for the story); bag buttons are fine.
7. **No markup from text:** templates and widgets only; names flattened; cut by code points.
8. **Tests for every rule,** run once after the fix. `npm test` + `npm run check` green; README/CHANGELOG updated.
9. **Deterministic:** handlers synchronous, every random number from `ctx.rng`; no `Math.random`, no `Date.now()`.

## Conventions

- No model names anywhere in the repo. Commit trailers and PR attribution: the lines the session gives.
- Branch off `v2`, PR into `v2`; agents never merge their own PR. Rebase on `origin/v2` before pushing.
- Re-sync the Story Block testkit before the final push of a PR that needs host changes
  (`npm run sync-testkit`, then the full tests); say the Story Block commit in the PR.
- A part changes another part's or module's state only through its commands (`ctx.call`, e.g.
  `src/v2/trade/calls.js`) and reads it through queries (`ctx.query`); only the owner drafts its domain.
- Kill processes by PID, never with a broad `pkill -f`.

## Specs

- Story Block `docs/v2/SPEC.md`: §2.2 storage and replay rules a–d, §3 commands, §4.4 change lines, §5 prompt,
  §6 modules / `requires` / Features, §7 core domains (inventory, wallets, story budget), §10 testing, §13 UI.
- Story Block `docs/v2/MODULES.md`: §A part layout, **§B RPG Battle** (B1 party … B4 trade), **§F decisions**
  (override older text), §G `sdk.callModel`. `PACKS.md` for creatures, goods, crafts, terms and ranks from packs.
- This repo: `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, README (reader-facing rules), CHANGELOG.
- History and decisions: `suite-notes/` in kohz87/inventory-block, branch `claude/hopeful-babbage-tipaw8`
  (README.md, WAVE_BRIEF.md, V2_LOG.md newest at the end). Area notes: `docs/dev/combat.md`, `docs/dev/economy.md`.

## Known traps

- Suite tests (`tests/v2/break/helpers/suite.js`, `suite-final.js` and the tests importing them, e.g. several
  `a2-*` and `final-*` break tests, `combat/story-line-offer.test.js`) need the four checkouts side by side,
  named exactly `Story_block`, `rpg_battle`, `Story_director`, `npc_state_delta` (or `STORY_SUITE_ROOT`).
  Without them they **skip**, and CI has only this repo: `a2-rules.test.js` covers the a2 rules alone.
  Run Story Block's `suite-check` skill for the full picture.
- Tests run against the **vendored** testkit, not Story Block's head; after a host change they can go red on
  the next re-sync (the fuzz after money-named items, #114). `tests/v2/qa/vendor/` is an older pinned copy for
  the QA suites; `sync-testkit` does not touch it.
- A failing `test.todo` (e.g. `qa/currency.test.js` "1 crown") prints `X` / `⚠` in the dot output but does not
  fail the run.
- Balance numbers (tiers trivial/weak/even/strong/deadly) are calibrated by simulation; a change to combat maths
  or presets moves them all (`tests/v2/qa/balance-tiers.test.js`, `tests/balance.test.js`).
