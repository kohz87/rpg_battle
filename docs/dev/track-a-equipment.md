# Track A equipment handoff

A4 currently supplies a pure eight-slot planner and slot projection, not an active equipment
migration. The frozen contract governs; existing legacy item runtime files were preserved.

src/v2/items/equip-plan.js exports equipPlan(payload, env), equipmentSlots(env), equipInputHash,
EQUIP_SLOTS/SLOT_LABELS and authoring-only normalizeSlot/isAmbiguousSlot. The public signature
for future registration remains rules.equipPlan({stack,actor,targetSlot?}); env is a private
owner handoff, never a command/query payload or trusted caller plan. It requires explicit
stacks, immutable defs, frozen itemRules/rulesHash, actorSheet and durable owner IDs. It does
not read a guessed rules domain layout, invent rules.hash or infer rules-v2 from settings.

The planner uses the fixed eight-slot order, exact displaced records and ownership moves,
base-stat requirements and 2H/offhand rules. Omitted slot selects the first legal empty slot,
then a canonical first-slot swap. Alias normalization is for authoring/import; a runtime
ItemRule and targetSlot must already use canonical IDs. Ambiguous worn/hands/waist/accessory
keys require explicit reauthoring, never an old-save rewrite. No uniqueness equip rule was
invented from ItemRule.unique. The acquisition owner must enforce frozen unique-item policy.

The browser-safe SHA-256/strict JSON helper in equip-hash.js matches the SB equipment input
hash, including selected stack, affected records, actor base stats/life and requested slot.
The focused tests compare actual bytes with SB's vendored equipInputHash reference. No Node
built-in import remains in browser runtime. No state is written by either projection.

Still required before A4 can be called complete:

- B/lead must bind the frozen inputs and register rules.equipPlan once. Frozen rules storage
  and its hash accessor are not finalized in this checkout; no guessed replacement was added.
- Route item.equip's retained stack/to/actor plus targetSlot through SB inventory.equipOn;
  add the live items.slots/items.canWear adapters over the pure projections. Do not activate
  a route that would fall back to unplanned equipment when the required planner is absent.
- Apply eight-slot rules/packs/prompt/UI integration. The live six-slot legacy path remains.
  C-owned screens/paperdoll.js is hard-coded to six slots; ownership forbids A editing it.
- The frozen contract includes life in equipment inputs but does not specify non-alive equip
  eligibility. For these sheets the pure planner holds DEPENDENCY_UNAVAILABLE pending owner
  policy instead of defaulting missing life/kind or inventing an injury/death exception.

One requested writer round was reviewed. Browser imports, guessed hash/state/feature probes,
unsafe fallback routing and arbitrary new default weights were rejected; the final pure
implementation and tests were corrected locally. The writer's shell harness could not run
commands because its agent script directory was read-only; verification was run by the monitor.

Thirteen focused tests pass. Reverting only 2H offhand displacement causes the displacement
and SB hash-parity assertions to fail; the fix was restored. No baseline suite was run.
