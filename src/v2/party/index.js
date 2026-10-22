// RPG Battle v2, part **party** (MODULES §A, §B1): the `party` domain (your character and the
// companions, story-taught skills, and the join and skill offers waiting for the reader), its
// commands, the wound / join / skill / check / rest change-line kinds, queries, the prompt's
// party lines, the 'Character' settings and the Party tab; and the `effects` domain (timed buffs
// and debuffs, feature `rpg-battle.effects`, effects.js) with its commands and `effect` kind; HP and MP back
// with story time (feature `rpg-battle.recovery`, recovery.js) and the story's `xp` awards. The coordinator's src/v2/module.js
// merges this part with the others into one registerModule definition.

import { commands } from './commands.js';
import { kinds } from './capture.js';
import { queries } from './queries.js';
import { context } from './context.js';
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from './sheets.js';
import { initialParty, validateParty } from './validate.js';
import { PARTY_COUNTERS } from './pools.js';
import { tabs } from './tab.js';
import { FEATURES, effectCommands, effectKinds, initialEffects, turnBeforeReply, validateEffects } from './effects.js';
import { RECOVERY_FEATURES, recover, recoveryBeforeReply } from './recovery.js';

/** beforeGenerate: the effects' turn and story time folded in (recovery.js), both as cues. */
export function beforeReply(view, info) {
    return { commands: [...(turnBeforeReply(view, info)?.commands ?? []), ...(recoveryBeforeReply(view, info)?.commands ?? [])] };
}

/**
 * canGenerate(view) (MODULES §F12): character creation is mandatory, so no story reply is
 * written until party.create has made your character. `action` is the words of the button Story
 * Block's Home shows with the reason ("Before you start"), which runs the onBlocked hook (the wizard).
 */
export function canGenerate(view) {
    const party = view?.state?.domains?.party;
    return party?.pc && party.actors?.[party.pc] ? { ok: true } : { ok: false, reason: 'Create your character first.', action: 'Create your character' };
}

export const part = {
    // Optional mechanics (MODULES §F100): timed buffs and debuffs, and HP/MP back with story time, both on by default.
    features: [...FEATURES, ...RECOVERY_FEATURES],
    domains: {
        // HP/MP/SP `lost` and `max`, level, XP, points and stats are counts (pools.js): a replay after a
        // deleted reply adds each later change to what is there; readers fit them (pools.js fitActor).
        party: { initial: initialParty, validate: slice => validateParty(slice), counters: [...PARTY_COUNTERS] },
        // Timed buffs and debuffs, keyed by effect id (effects.js).
        // `turns` is per-reply bookkeeping (SPEC §2.2 scratch): replay makes it when only a deleted reply had.
        effects: { initial: initialEffects, validate: slice => validateEffects(slice), scratch: ['turns'] },
    },
    commands: { ...commands, ...effectCommands, 'party.recover': recover },
    queries,
    kinds: { ...kinds, ...effectKinds },
    context,
    hooks: { canGenerate, beforeGenerate: beforeReply },
    settings: { section: 'Character', defaults: { ...SETTINGS_DEFAULTS }, schema: SETTINGS_SCHEMA },
    tabs,
};
