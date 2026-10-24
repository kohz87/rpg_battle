# Track A handoff

Frozen phase-0/P23/B5 contracts apply. Runtime ownership remains RB quests, SD threads,
SB inventory/wallet/claims and NSD presets. No legacy migration is included.

| Task | Done | Left |
| --- | --- | --- |
| A1 | Retained quest commands/queries, parser, progress/ranks, board/retry adapters and context. | B3 requirements and kill/visit/story validators. |
| A2 | SD neutral writers, acceptance, retry ledger and standalone journal; old quest payouts retired. | Host cursor()/epoch integration. |
| A3 | One guarded settlement, exact consumption, wallet/XP/journal/claim, fresh follow-up offers and story-coin deduplication. | B3 giver/place, carry and objective-event adapters; expiry sweep. |
| A4 | Pure eight-slot planner and slot projection. | Live equipment routing, rules/packs/prompt/UI; see track-a-equipment.md. |
| A5 | NSD preset ownership audit. | None; NSD unchanged. |
| A6 | Alias, retirement, C15, enforcing-host, closed-input, story-credit, Continue, deadline and authority fixtures. | Integrated B3/E6 and SB matrix scripts. |

Resume steps 0–7 are implemented. Both testkits use SB
78fd75e11b7bd3aa96d51ccf11a993bf102bd0d9 (E1 enforcement); RB's QA vendor remains unchanged.
SD declares director.thread for replay. RB forwards part replayQueries and declares only its
state-only quest.replayInputs query; guards also read story.evidence and compare the state epoch.
Closed records exclude calendar text, party/item lists and irrelevant transport counters.

Production still holds mutations without host cursor()/epoch or B's shared buildGuard export.
B's progress folder is absent here, so settlement.js retains an explicit static-import TODO.
Requirements, giver/canonical turn-in place, reward carry, objective proof/capture validators,
expiry sweep and SB matrix scripts remain outside this resume. No substitute rules are supplied.
SD's threads.intent adapter is documented as a contract addition for the lead.

Final checks: 1,770 tests, 1,763 passed, zero failures, one skipped, six TODOs, with the
actual B buildGuard imported from an independent checkout at 3f27e56. A single-repo copy
without siblings or .git also passes: 1,717 passed, 47 skipped, six TODOs. Skips identify
missing integration dependencies. Syntax and git diff --check origin/main HEAD pass.
Regression checks revert only the relevant fix and run only its test file; all fixes restored.

Lead-owned commits: 3648da3 (replay declarations); earlier branch commit e2d1cd4 (quest wiring).
No protected source folder was changed in this resume except the authorized SD dead-board
export removal. The earlier permitted RB hook retirement is party/commands.js:654 and
combat/quest.js. Full resume file lists are in track-a-files.md.
