# Track A equipment handoff

A4 supplies a pure eight-slot planner and slot projection. The live equipment migration is
still incomplete; no legacy save is rewritten.

src/v2/items/equip-plan.js exports equipPlan(payload,env), equipmentSlots(env), equipInputHash,
EQUIP_SLOTS/SLOT_LABELS and authoring-only normalizeSlot/isAmbiguousSlot. The public query
remains rules.equipPlan({stack,actor,targetSlot?}); env is a private owner input, never a
trusted command plan or bypass token. It requires stacks, immutable definitions, frozen
ItemRules/rulesHash, the complete base sheet and durable owner IDs.

Planning uses eight canonical slots, exact ownership moves/displacements, base-stat
requirements and 2H/offhand rules. Omitted slot selects the first legal empty slot, otherwise
the first legal swap. Runtime slots must be canonical; ambiguous worn/hands/waist/accessory
requires explicit authoring. No uniqueness or non-alive eligibility rule was invented.
The browser-safe hash matches SB's equipment input bytes. Neither projection writes state.

Remaining work:

- Bind frozen owner inputs and register rules.equipPlan once in a lead-owned commit.
- Route retained item.equip stack/to/actor plus targetSlot through SB inventory.equipOn;
  bind items.slots/items.canWear to the same planner and fail closed when it is absent.
- Integrate eight-slot rules, pack transport, prompt and UI. The current live legacy path
  still has six-slot assumptions. C-owned screens/paperdoll.js was not edited.
- Obtain the rule owner's non-alive equipment eligibility policy; the planner currently
  holds those cases rather than inventing an exception.

Thirteen focused tests pass. Removing only 2H offhand displacement fails displacement and
SB hash-parity assertions; the fix was restored. Full branch validation is in track-a.md.
