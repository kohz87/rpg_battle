# Track A handoff

The frozen phase-0 contract, P23, B5 and lead decisions D1–D3 govern this branch.
Story Block and NPC State Delta are unchanged. No legacy character conversion is included.

| Task | Delivered | Remaining integration |
| --- | --- | --- |
| A1 | RB owns retained quest commands/queries, parser, progress/ranks, board/retry adapters and quest capture. | B3's frozen requirements and non-collect objective validators. |
| A2 | SD owns the five thread writers, hash and retry ledger; neutral acceptance/progress/journal work alone. Old quest registrations and payouts are removed. | Host D1 cursor/epoch. |
| A3 | One guarded quest settlement spans SD closure/journal, SB costs/rewards and one nonzero XP grant. Repeat/chain offers use fresh IDs; raw-result XP is retired. | Shared B5 export and B3 owner inputs; host E6 epoch enforcement. |
| A4 | Pure eight-slot planner, slot projection, authoring aliases and SB hash parity. | Live equipment routing/projection/registration and rules/packs/prompt/UI integration remain incomplete; see track-a-equipment.md. |
| A5 | NSD preset ownership confirmed; no runtime needs moving. | None; read-only audit. |
| A6 | Real retained-selector/alias, retirement, neutral standalone, forged-caller, C15, rollback, old-chat and replay/reload fixtures. | Final integrated B3/E6/matrix coverage. |

## Integration seams and gaps

- D1 supplies only `ctx.cursor()` and `ctx.epoch`. Production uses no alternate source and
  refuses missing support. Tests supply an explicit host shim. Writer IDs derive from the
  caller's Source plus writer key and are recorded in SD's writes ledger.
- The sole guard envelope is `buildGuard({hash,owner,epoch,source,rulesHash,kind,payload,inputs})`,
  exported by progress on track B at `3f27e5650e70ae5cf0130743d13642f4e92fdc5e`.
  It is not on main. Merge B's implementation; no copy is included here. Its absence holds
  quest mutations. Tests use that actual implementation from a temporary archive.
- B3's closed kill/visit/story validator, shared requirement evaluator, reward carry check,
  giver-presence resolution and objective-event capture exports are not specified in this
  checkout. The private quest policy accepts these owner callbacks and fails closed when
  required. Narration, `met`, ready flags and opaque visible proofs cannot replace them.
- Frozen templates come only from `rules.pin.resolved.quests`. Installed packs never replace
  historical rewards. Existing typed storyCredit reduces only that quest's coin; its claims
  are retained and bound by the guard. New story-credit attribution needs B3's validated
  reward-event seam; this branch does not guess which unbound coin line paid which quest.
- The quest hook checks pinned rules and all retained thread/proof/plan inputs. Active epoch
  enforcement remains the host's E6 responsibility; no second epoch source is invented.
- D3 keeps old quest/owed data readable and unpaid, including after reload. There is no
  automatic conversion, second quest store, wallet authority or duplicate name owner.

## Validation

Latest full RB run: 1,758 tests; 1,751 passed, zero failures, one skipped, six TODOs.
The existing currency-format TODO prints a failing assertion without failing the suite.
SD: 880 tests; 879 passed, zero failures, one skipped. Syntax checks and
`git diff --check origin/main HEAD` pass in both repositories. No baseline suite was run.
Fixtures use real module definitions and the pinned SB runtime/testkit at
`d23ab1fd04e80b06d443cb79e3174c6ffc443c8e`, with the explicit D1/B5 seams above.

Removing only the settlement guard makes swipe/delete fixtures retain stale payment;
restoring raw-result XP fails the duplicate-award fixture. Removing acceptance-proof
forwarding or SD's neutral RPG routing fails its C15 fixture. Each fix was restored.

The permitted party edit is `src/v2/party/commands.js`: clear raw-result XP before
applyResult. Existing explicit combat XP and all grantXp payload variants remain.
`combat/quest.js` filters eligible quests before its 50-quest limit. No other protected
party/combat/checks/rules/progress/training/death/screen/board/creation source was changed.

Lead-owned commits: RB `e2d1cd4`; SD `6c812f3`, `e3745a6`. These contain the minimal shared
registration/settings changes. File inventories are in track-a-files.md in each repository.
