# Track A contract fixtures

A6 adds eighteen tests in tests/v2/quests/track-a-contract.test.js using complete Quest,
Source/Cursor and acceptance proof fixtures over the production pure planner. They cover
SD aliases and shared IDs, distinct instance-1 claims, canonical retained input envelopes,
acceptance binding, expiry equality/unset clock, exact consumption and owner exclusion,
reward bounds, story credit, missing rule checkers, overweight holds and input purity.
A rejecting shared proof checker is a handoff test, not proof of B3's unfinished semantics.

Review found three production bugs, corrected with their tests:

- Full acceptance Source must match evidence and ordinal as well as sid/swipeKey. Cursor
  identity is checked separately, including its pair, block/op/rev and acceptance minute.
- Expired closure must still require active original acceptance. The expired plan now retains
  that proof hash, rather than returning a terminal transition with no acceptance prerequisite.
- Reward items must contain a valid definition ID and an integer quantity in 1..999.

All eighteen focused tests pass. Reverting each fix separately and running only this test
file produces its corresponding assertion failure. The fixed implementation was restored.
The requested test writer could write files but could not execute its shell harness because
its agent script directory is read-only; pass/fail claims were verified by the monitor.

A6 remains incomplete. Required integration rows still left:

- Each retired SD payout path must pay zero after replacement registration; the old paths
  currently remain active. No test in this slice claims they were retired.
- One real guarded root transaction must settle SB wallet/stacks, RB XP and SD closure once
  across swipe/delete/Re-read/reload. Pure planner repetition is not transaction deduplication.
- Full C15 neutral offer -> reader accept -> generic progress/close and atomic RPG upgrade,
  fresh repeat/chain th_ IDs, stale/retry/conflict and failed cross-owner rollback need the
  implemented P23 writers, host write/cursor/epoch adapter and finalized B3/B5 handoffs.

The SB evidence/guard transport is available. The absent runtime adapters and final owner
schemas are recorded in docs/dev/track-a.md, not replaced with a mock payout engine.
