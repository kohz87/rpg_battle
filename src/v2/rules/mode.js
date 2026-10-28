// RPG Battle v2, the mode of Jobs from the story, fixed for a chat when its rules are pinned (GENERATIVE_OFFERS_SPEC, Decisions).
//
// The switch "Jobs from the story" is the reader's. The mode a chat runs in is the switch as it stood when the chat's rules were pinned, kept in the rules slice (`rules.mode`, 'free' |
// 'strict'): every capture of the chat (live, Re-read edited or not, rebuild, reload) reads that mode, and so do the rules block, the cards and the queries of the feature, so the narrator is never
// told rules the chat will not apply. Changing the switch afterwards changes the chats whose rules are pinned afterwards (and a new character timeline), not the ones that are running. A chat
// pinned before 2.3.0 records none and is read as RPG Battle 2.2.0 did: strict.

import { featureOn } from '../items/condition.js';
import { isObject } from './ids.js';

export const OFFERS_FEATURE = 'rpg-battle.generative-offers';

/** The mode the reader's switch asks for now, 'free' | 'strict' (a host that cannot say takes the switch as on): what a pin records. */
export const switchMode = source => (featureOn(source, OFFERS_FEATURE) ? 'free' : 'strict');

/**
 * The mode the reader's stored choice asks for, 'free' | 'strict': for an activation that pins before the module is registered, when the host cannot yet answer for the feature (it is not
 * declared). `extensionSettings` is SillyTavern's; a switch never touched is the feature's default, on.
 */
export const storedMode = extensionSettings => (extensionSettings?.storySuite?.features?.[OFFERS_FEATURE] === false ? 'strict' : 'free');

/** The mode a rules slice was pinned in: 'free' only when it says so ('strict' for a chat pinned before 2.3.0, and for one pinned with the switch off). */
export const modeOf = slice => (isObject(slice) && slice.mode === 'free' ? 'free' : 'strict');

/** Whether a state's chat runs in free mode (Jobs from the story). */
export const stateFree = state => modeOf(state?.domains?.rules) === 'free';

/** Whether a capture reads freely (Jobs from the story): by the mode its chat was pinned in, whatever the switch says now. */
export function readsFreely(ctx) {
    try {
        return modeOf(ctx?.read?.('rules')) === 'free';
    } catch {
        return false;
    }
}
