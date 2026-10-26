// Story Director v2, part **checks**: independent checks (contract §3 P09). Story Director owns the dice outside a fight: an actor of its
// own with standalone bonuses, an optional explicit link to a RPG Battle character, one d20 per check (`checks.roll`), the policy it is
// read from (`checks.policy`) and the probe other modules ask first (`director.contract`). It needs nobody: with Story Block and Story Director
// alone a check rolls with SD's standalone bonuses; a linked RPG Battle adds its `rules.modifier` in their place, and NPC State Delta's
// `npc.socialModifier` adds how a person feels about you. The coordinator's src/v2/module.js merges this part with the others.
//
// This part alone owns the `check` capture and its dice. Crafting calls checks.roll with a recipe
// reference; RPG Battle supplies the modifier and decides the item quality.

import { commands } from './commands.js';
import { initialChecks, validateChecks } from './domain.js';
import { kind as checkKind } from './capture.js';
import { queries } from './queries.js';
import { TOPIC_NAMES } from './words.js';

export { checkKind };
export const DEFAULTS = Object.freeze({ defaultDc: 15, costMargin: 2, rbModifiers: true, social: true });

export const part = {
    domains: {
        checks: { initial: initialChecks, validate: slice => validateChecks(slice, TOPIC_NAMES) },
    },
    context: {
        static: () => 'Checks: write ? check skill — attempt | dc: hard (optionally who: Name or vs: Name), without a result. Story Director rolls once; narrate the outcome told by the tail. A pre-rolled check already told under [Happened] is not rolled again.',
        tail: () => ({ lines: [], optional: [] }),
        budget: 1,
    },
    commands,
    queries,
    // The `check` change line is one checks.roll (contract P09): after the flip this module keeps the kind, and RPG Battle's checks part is gone.
    kinds: { check: checkKind },
    settings: {
        section: 'Checks',
        defaults: { ...DEFAULTS },
        schema: {
            defaultDc: { type: 'int', label: 'Difficulty when none is written', min: 1, max: 40 },
            costMargin: { type: 'int', label: 'A miss by this much is a success at a cost', min: 0, max: 5 },
            rbModifiers: { type: 'bool', label: 'Use a linked RPG Battle character\'s modifiers' },
            social: { type: 'bool', label: 'Add how a person feels about you (NPC State Delta)' },
        },
    },
};
