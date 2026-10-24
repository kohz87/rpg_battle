---
name: run-tests
description: Run RPG Battle's tests with compact output (dot reporter), one file while working, and read the failures. Use before pushing and whenever a change touches src/ or tests/.
---

# Run RPG Battle's tests

Node 24 is what CI uses (node ≥ 22 works). No install step.

1. While working, run only the files that cover the change (`docs/dev/*.md` lists them):
   ```sh
   node --test --test-reporter=dot tests/v2/combat/waves.test.js tests/v2/trade/trade.test.js
   node --test --test-name-pattern="carry" tests/v2/items/carry.test.js    # by test name (spec output)
   ```
2. Once, after the fix, the whole suite (same files as `npm test`, about 1,550 tests, 2–3 minutes):
   ```sh
   npm run test:dot
   npm run check
   git diff --check origin/main
   ```
   Run it once; do not re-run old code to show a test failed before.
3. Reading the output:
   - one `.` per passing or skipped test, `X` per failure; no totals. The exit code is the verdict (0 green).
   - after the dots, `Failed tests:` lists each failure: name, assertion message, and a stack whose first
     `file:///…` line is the test file and line.
   - a line starting `⚠` is a failing `test.todo` (known open problem, e.g. `qa/currency.test.js` "1 crown");
     it prints `X` but does not fail the run.
   - for totals and skips run a file with the default reporter: `node --test tests/v2/combat/waves.test.js`.
4. The suite tests (`tests/v2/break/helpers/suite*.js` and the tests that import them) skip unless
   `Story_block`, `rpg_battle`, `Story_director` and `npc_state_delta` are checked out side by side
   (or `STORY_SUITE_ROOT=<folder>`). CI skips them; run them locally that way, or with Story Block's
   `suite-check` skill.
5. Tests run against the vendored Story Block in `tests/vendor/story-block/` (VERSION names the commit). A
   failure that comes from the host side needs the `sync-testkit` skill, not a local workaround.
