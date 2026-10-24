# NSD preset ownership audit

no NSD preset runtime needs to move. NSD src/npc-meters-presets.js owns
BUILT_IN_PRESETS, normalizePreset/presetCatalog and limits. src/storysuite-v2.js imports the
catalog, reads packs.content({kind:'meterPresets'}) in catalog(), and supplies it to
createNpcPart. Preset settings/editor/UI also stay there. Runtime-wide searches for
rpg-battle/rpg_battle and RPG/preset combinations found no RPG preset engine/glue to extract.
Remaining references concern optional social-check consumers, suite ownership/handshake and
UI-noise handling; they do not own presets. NSD and SB were not modified or tested.

Audit method: read the preset catalog and its adapter/callers; search shipped runtime files
for RPG/preset combinations and suite RPG references. No NSD files changed; no baseline
or full NSD suite was run for this read-only audit.
