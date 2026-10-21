// RPG Battle v2, part **party** (MODULES §A, §B1): the `party` domain (your character and the
// companions, story-taught skills, and the join and skill offers waiting for the reader), its
// commands, the wound / join / skill / check / rest change-line kinds, queries, the prompt's
// party lines, the 'Character' settings and the Party tab. The coordinator's src/v2/module.js
// merges this part with the others into one registerModule definition.

import { commands } from './commands.js';
import { kinds } from './capture.js';
import { queries } from './queries.js';
import { context } from './context.js';
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from './sheets.js';
import { initialParty, validateParty } from './validate.js';
import { tabs } from './tab.js';

/**
 * canGenerate(view) (MODULES §F12): character creation is mandatory, so no story reply is
 * written until party.create has made your character.
 */
export function canGenerate(view) {
    const party = view?.state?.domains?.party;
    return party?.pc && party.actors?.[party.pc] ? { ok: true } : { ok: false, reason: 'Create your character first.' };
}

export const part = {
    domains: {
        party: { initial: initialParty, validate: slice => validateParty(slice) },
    },
    commands,
    queries,
    kinds,
    context,
    hooks: { canGenerate },
    settings: { section: 'Character', defaults: { ...SETTINGS_DEFAULTS }, schema: SETTINGS_SCHEMA },
    tabs,
};
