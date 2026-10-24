# Equipment handoff

A4 provides pure equipPlan(payload,env), equipmentSlots(env), equipInputHash,
EQUIP_SLOTS/SLOT_LABELS and authoring normalizeSlot/isAmbiguousSlot. Planning uses immutable
rules/definitions, base stats, eight canonical slots, exact ownership/displacement and 2H rules.
No projection writes state or supplies a caller bypass.

Live rules.equipPlan registration, item.equip routing to SB inventory.equipOn,
items.slots/items.canWear binding, and eight-slot rules/packs/prompt/UI integration remain
incomplete. C's paperdoll was not edited. Non-alive eligibility still requires the rule owner's
policy. This resume changes quest replay, not that outstanding equipment integration.
