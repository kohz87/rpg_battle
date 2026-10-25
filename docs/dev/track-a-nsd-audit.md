# NSD preset audit

No NSD preset runtime needs moving. src/npc-meters-presets.js owns the catalog/normalizers;
src/storysuite-v2.js imports it, reads packs.content({kind:'meterPresets'}) and passes the
catalog to createNpcPart. Preset settings/editor/UI stay in NSD. Runtime RPG references
concern optional consumers/handshake/UI; no old RPG preset engine or glue was found.
NSD is unchanged; this audit runs no NSD test suite.
