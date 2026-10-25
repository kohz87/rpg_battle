B6 integration notes (the lead folds these into the contract and progress log).

The closed private records are in records.js and the owner proof payloads in proofs.js.
They add no public command beyond death.resolve. lethal/intervention are capture entry points.
The death part must be registered with the pinned rules/progress/training parts, after preflight;
it must never initialize on a legacy chat. Registration remains lead-owned.

The production SDK does not grant RB the authenticated timeline coordinator handle required by
contract §8. The coordinator must be composed by the host with its bound prepare/activate/
nativeEvent/recover methods; an asserted caller, cause, prepared ID or public SDK is insufficient.
No new SDK method or capability transport is invented here.

SB owns the prepared manifest and durable journal outside restored domains: prepared token/head,
manifest hash, before/after checkpoints, acknowledgments, return ID and cue. RB's sealed result
and outbox are pinned there before restore; RB must not write a second mutable journal that can
disagree with it. Native participants are not implemented or registered by this RB slice.

The contract defines no producer API for validated lethal/rescue evidence. B6 defines closed
payloads and validates active owner proofs and paid parents. Capture does not mint lethal proof
from narration. A trusted code adapter must produce these through ctx.proof.

The host currently fixes return memory to deja-vu. none/full require the host's policy transport.
Clock-boundary snapshot creation is host-owned; B6 selects existing eligible descriptors only.

The vendored host c36b355 is E6a. It journals native prefix mappings but does not switch native
checkpoints when a restore/evidence carrier is swiped, deleted or changed by Re-read. B6's
selection check refuses RB generation/delivery in that case. It cannot supply the host-wide
scan/mutable-read barrier or switch another owner's native state. The E6b acceptance row
therefore remains open; a refusal is not a claim of matching native state. The host's history
also still includes the target reply when the target is inside it; intra-reply exclusion is E6b.

Return tests use the real SB coordinator, real RB parts and a synthetic NSD-shaped participant.
The production NSD participant is not present in this checkout, so a complete four-module
acceptance run is still required at integration. No synthetic fixture is presented as NSD code.

The host-authenticated command adapter passed to createDeathCoordinator must flush/announce
its system wake with the host's ordinary durable action lifecycle. Production composition,
UI returnInTime/card routing and automatic outbox scheduling remain lead/C/E integration work.
The old return adapter refuses pinned chats until that authenticated route is wired; it never
branches a rules-v2 death through the legacy rewind.

Resume 1 review and handoff

- Rescue records retain paymentHash in addition to the rescue proof hash. A paid parent changing
  under the same id invalidates its dependent intervention/result. Each result retains actor kind
  so returnRequested and outcome semantics can be validated, including a rescued companion in a
  batch whose PC dies. The outcome projection always describes the requested event.
- The guard kinds are lethal, intervention, death.resolve, death.fight-end and return.cue.
  death.fight-end combines B4's exact terminal prefix with the fighting actors' native links,
  life/pool/condition state and SD minute. Its one claim/guard covers fight payout and the wipe
  result/outbox together. The part declares party.actor, party.actors and return.status as
  replayQueries; story.evidence is the host's intrinsically replay-safe query (E5).
- A capture batch uses the canonical carrier/swipe and epoch. A fight-end uses that key plus
  the host-issued fight id so it cannot collide with a narrative batch on the same carrier.
  The host exposes no assigned lethal-batch id: deriving this private db_ id is an explicit
  transport gap against B6's host-assigned-batch wording, not a new public host signature.
- Injury remains one HP on recovery, with the pinned 1440-minute condition and STR/AGI penalty.
  Ordinary rest, recovery and sheet/XP rewrites preserve its anchor; an expired injury cannot
  become indefinite. Death stays permanent until an authenticated timeline selection restores
  saved living state. A fight begun before the rules pin keeps its saved legacy settlement.
- Delivery compares the entire outbox to the sealed decisions before native writes and refuses
  a non-idle host recovery. The injected command adapter must persist its wake; the test adapter
  flushes it and propagates save failures. The factory does not turn public sdk.timeline into
  an authenticated handle, and production composition is still required.

Available host records (copied from the vendored timeline/coordinator.js, not redefined by RB):

- pin(id): {id, hash, bytes, resolvedBy, return, prepared, deathEvents, manifestHash,
  preRestore, aborted}. Its preRestore projection contains the captured payload and proofs.
- journal() restore entry: {id, kind:'restore', phase, session, return, snapshot, deathEvents,
  batchResult, expectedHead, newEpoch, block, cue, payloadHash, manifest, manifestHash,
  participants, pre}. Participant slots retain {checkpoint, hash, schema, prepared,
  preparedHash, ack}. Native prefix mappings retain before/after/selected checkpoints in SB.
- SB owns transition/retry semantics, checkpoint schemas and durable acknowledgments. B6 consumes
  these host records and pins, and does not draft savepoints, native dossiers or the archive.

Validation scope: real SB c36b355 + real RB mechanics + the existing SD clock fixture + a clearly
marked synthetic native participant. C11, C12, concurrent duplicate delivery, a second epoch's
cue, missing payload/native bytes, stale prepare, crash after native write/before host ack,
paid-parent deletion and restore swipe/delete are covered. The fuzz compares checkpoint replay
with replay after removing every cache after the genesis checkpoint, then restores the caches
and compares again. A native mismatch after an E6a history edit is explicitly held; that hold
is not a passing assertion of the requested native-selection invariant. Real NSD identity-map
mutation/rename and four-module restoration remain integration acceptance, not RB test claims.

Read locations: the home Story_block checkout lacks docs/v2/TIMELINE.md. The E6a document was
read at /tmp/e6bwork/Story_block/docs/v2/TIMELINE.md and checked against the vendored code. No
host, native participant, module registration, screen, shared testkit or contract files were
changed by this resume. Those integration gaps require their owners; no extra public API was
invented to hide them.

Resume validation: 48 B6 tests pass; full suite 1987 tests, zero failures, six existing TODOs
and 14 skips; npm run check and git diff --check pass. Expanded death fuzz: seeds 33/91/217,
200 steps each (600 steps), zero failures. New bug regressions were also run with only their
fixes temporarily removed and failed, then restored. The old active-roster fixture was aligned
with B6's dead-member exclusion. An unseeded legacy foe-rank-tail test failed once through a
random immediate defeat; its isolated file and the final full suite passed. It was not changed.

Resume 2: main and replay audit

- Merged RB main febdef5 with a real merge. Only the vendored host conflicted; main's
  version resolved those conflicts, followed by a vendor-only sync from exact SB main
  fa1853d3ea0a83d1cbe37193741f19afa2c8d9d9. tests/v2/qa/vendor is unchanged.
- Audited every B6 predicate against 027-resume3 step 0. lethal reads declared party.actor
  and host-safe story.evidence. intervention additionally reads the progress/death state
  for its rescuer/form/payment. death.resolve reads the same queries, the state clock,
  and recorded snapshot/checks. death.fight-end reads the combat prefix, declared party.actor,
  the state clock and recorded area. return.cue reads declared return.status; on a pinned
  chat that projection reads state alone. No new query declaration or runtime fix was needed.
  Live native identity, snapshot availability, place and purse queries remain plan/delivery
  reads, outside guard replay. No additional lead-owned file was edited.
- tests/v2/death/real-module.test.js composes the real module and B6 part under their single
  rpg-battle owner, without replacing replay queries. It covers all five guard kinds, pending
  death, paid intervention, permanent companion death, wipe, authenticated return, one wake,
  reward erasure/re-earning and reload/full replay with no Problems. Its declarations check
  verifies owner/query identity. Replacing the guard's state clock with director.time made
  both scenario tests fail at the real host's replay gate; the safe implementation was restored.
  Removing return.status from the composed allowlist also failed the declaration check and
  the complete-return scenario. Main's progression real-module assertion now includes the
  existing return part's declarations; its omission was the only non-TODO full-suite failure.
- This pin still has E6a's native-selection and intra-reply history limitations described
  above. Real NSD participation and production coordinator/registration remain integration
  work; no four-module or E6b acceptance is claimed by these tests.
- Final validation: syntax check passes; 1993 tests, 1973 pass, zero failures, six existing
  TODOs and 14 integration skips. All 51 B6 tests and 16 module tests pass. Expanded fuzz
  seeds 33/91/217 ran 200 steps each (600 B6 steps); the fight/progression entry fuzzes
  also passed at 200 steps per seed. After the assertion fix, the full suite passed with
  its default fuzz lengths. Both whitespace checks pass, including origin/main to HEAD.

Release gap (closed)

| Gap | Tag | Today | Closes with |
|---|---|---|---|
| Native mismatch after a delivered companion death leaves the story. | closed — must close before release | E6b's native-event journal already publishes before/after checkpoints. Delete, swipe and Re-read select the matching native checkpoint; RB honors `savepoint.contract().participantsReady` after recovery, retaining its visible remedy if selection cannot finish. | Real SB + RB + NSD tests cover both alive after removal, both dead after swipe back, unchanged Re-read, reload/full rebuild, a held activation and missing native bytes. No earlier save point is required. |

The E6a limitations and synthetic-only evidence above are historical. The current tests vendor E6b. The real-module
native-selection tests use NSD's shipped adapter, identity and participant with in-memory storage and DOM ports, not
an NSD-shaped participant. SB also preserves reused Sources on unchanged Re-read after native work was published,
so ordinal allocation alone cannot invalidate a delivered death's exact prefix. No NSD runtime change is needed.

Injury anchor (review round 2)

- An injury written while the story clock is unset has no `at`. The first reply that ends with a clock gives it one through
  `death.anchor` (anchor.js), a guarded system step after the reply's lines (the death part's afterCapture). The party's
  conditions are never rewritten for it without that guard, which binds the injury as it stands, the sealed death result it came
  from (none for a fight settlement's injury) and the minute. Deleting the injury's cause retracts the anchor and the penalty with it.
- The anchor follows a full replay, not the first reading. Deleting the clock reply an anchor was read from removes that anchor
  with it; the injury is unanchored again (it waits, like any condition with no clock) until the next reply that ends with a
  clock, which anchors it there. The earlier clock is not looked up again, and the later replies do not re-anchor it by
  themselves: live state after the delete equals the state a rebuild gives (tests/v2/death/recovery.test.js). The end of the
  injury (`at` plus its rounds) moves with the anchor; this is intended, not a bug.
