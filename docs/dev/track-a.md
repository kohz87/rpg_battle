# Track A implementation evidence

The frozen RB_PHASE0 contract and RB_TRACK_B_DESIGN B5 govern this work. SB is read-only
at 4f5b43449bedba8c4e8a9c499b3c60f2306ee7db. No substitute runtime API or rule is authorized.

A1 currently supplies the transferred pure parse/progress/rank mechanics and a pure typed
settlement planner. It selects the same SD thread, including an RPG extension on a hook,
requires surviving acceptance evidence, consumes exact stacks, excludes reserve/temporary
owners, credits only this reward, and expires at deadline equality. It creates no quest domain.
It is deliberately not registered alongside SD's still-registered quest names.

The following integration gates remain; the extraction is not a completed quest migration:

- P23 requires a host-allocated, persisted write ID before dispatch. Current ctx exposes
  receiptId/id/source, but no contracted write reservation adapter. A deterministic generated
  ID or receipt-derived ID is not proof that the host persisted it before dispatch.
- P23 acceptance requires the host cursor including block/op/rev. ctx.source supplies
  sid/swipeKey/evidence/ordinal only. Receipt rev or a guessed block ID cannot supply that cursor.
- Quest claims require the active savepoint epoch. SB REPLAY.md explicitly leaves active
  epoch/rules comparison to E6. There is no synchronous public epoch accessor for handlers;
  the frozen timeline.head interface is not implemented in this checkout.
- B3 must supply closed kill/visit/story objective proof validation and the single shared
  requirements evaluator. The planner requires these callbacks when needed; it never treats
  narration, ready flags or a visible opaque proof as sufficient action authority.
- B5 leaves the final closed quest operation records/predicates to B. settlementInputs supplies
  its recommended canonical envelope, not a claim that those owner records are frozen.
- Frozen quest-template lookup/registration is a B3 deliverable. No live-pack fallback may
  create a rules-v2 quest with guessed template, objective or reward IDs.

No command may pay or write around these gates. Runtime command/query transfer,
director.retriable/quest.board adapters and ctx.replayGuard wiring remain A1 work.

Verification: 15 focused tests passed. Reverting only the deadline equality fix produced the
expected assertion failure in planner.test.js; the fix was restored. The full RB dot suite
and syntax check passed once for this extraction slice. No baseline suite was run.
