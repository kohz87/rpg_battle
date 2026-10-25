# Resume file inventory

Changes since the review at 0a4f8ee. Vendor changes are a re-sync from SB
78fd75e11b7bd3aa96d51ccf11a993bf102bd0d9; no vendor file was edited by hand.

```text
M	docs/dev/track-a-files.md
A	src/v2/quests/credit.js
A	src/v2/quests/prompt.js
A	tests/v2/quests/closed-inputs.test.js
A	tests/v2/quests/deadline-runtime.test.js
A	tests/v2/quests/finish-authority.test.js
A	tests/v2/quests/guard-runtime.test.js
A	tests/v2/quests/prompt.test.js
A	tests/v2/quests/story-credit.test.js
M	docs/dev/track-a-equipment.md
M	docs/dev/track-a-fixtures.md
M	docs/dev/track-a-nsd-audit.md
M	docs/dev/track-a-quests.md
M	docs/dev/track-a.md
M	src/v2/module.js
M	src/v2/quests/capture.js
M	src/v2/quests/commands.js
M	src/v2/quests/index.js
M	src/v2/quests/planner.js
M	src/v2/quests/queries.js
M	src/v2/quests/seams.js
M	src/v2/quests/settlement.js
M	tests/v2/quests/c15-runtime.test.js
M	tests/v2/quests/commands-runtime.test.js
M	tests/v2/quests/helpers/b5.js
M	tests/v2/quests/helpers/host.js
M	tests/v2/quests/settlement-replay.test.js
M	tests/v2/quests/settlement-runtime.test.js
```

## Stage 5 files

- Entry/registration: `index.js`, `src/v2/module.js`.
- Creation/Setup: `src/v2/creation/open.js`, `src/v2/screens/rules/setup.js`, `screens.js`.
- Pinning: new `src/v2/rules/selection.js`; rules/progress/training index comments updated.
- Evidence: new `tests/v2/rules/selection.test.js`; progress.md and track-a*.md notes.
- Host dependency: tests/vendor/story-block synced from SB 49675e4 (177 files, matrix 1), including
  resolved pack transport, deferred API/domain activation and reply-bound prefix handling.
- Coordinated SB source: packs/index.js, packs/installed.js, registry.js, sdk.js, commands.js,
  replay.js, store.js; PACKS/LIFECYCLE/REPLAY docs; pack transport, deferred-domain and preflight tests.
