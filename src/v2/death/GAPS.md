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
