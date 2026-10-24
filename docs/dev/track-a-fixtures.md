# Track A fixtures

Quest tests under tests/v2/quests exercise production planners and real SB/SD/RB definitions.
They cover retained id/key selectors and SD aliases, shared thread identity, distinct instance-1
claim keys, acceptance Source/cursor/proof, expiry, exact consumption, reserve/temporary owner
exclusion, reward bounds, story credit, missing owner validators and overweight holds.

settlement-runtime verifies one guarded root, wallet/XP/journal/claim results, zero XP omission,
abandonment and rollback after closure. settlement-replay reopens after every swipe, delete,
Re-read and prerequisite restoration, including unchanged story acceptance, changed proof
words and Re-reading away story-backed acceptance.
c15-runtime covers neutral-to-RPG linking, stale/retry/conflict/failure atomicity, fresh
repeat/chain IDs, terminal-minute cooldown, forged take authority and unpaid legacy reloads.
SD's fixtures additionally test neutral standalone lifecycle and forged extensions from UI,
SD capture and a third module, with real RB ready and with RB absent.

The D1 shim supplies exactly cursor()/epoch. The B5 fixture loads the actual pinned shared
builder without copying it into this repository. Missing B3 callbacks remain explicit failure
cases, not substitutes for finalized proof or requirement semantics.

Equipment fixtures test the pure eight-slot planner, 2H displacement/offhand refusal, explicit
slot choice, aliases, base-stat requirements, no self-qualification and SB input-hash parity.
Live equipment integration remains pending. Latest full counts and gaps are in track-a.md.
