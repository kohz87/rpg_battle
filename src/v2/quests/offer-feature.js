// The feature switch of the generative offers (F100, GENERATIVE_OFFERS_SPEC §10): "Jobs from the story". Off is strict mode, every path as in RPG
// Battle 2.2.0. The reader's choice, but a chat runs in the mode its rules were pinned in (rules/mode.js): the switch is read once, at the pin.
//
// What the narrator is shown (the rules block, the quests' tail), the card under a reply and the queries of the feature follow the chat's pinned mode, never the switch of the moment, so the
// narrator is never told rules the chat will not apply.
import { templates } from './seams.js';
import { OFFERS_FEATURE, stateFree } from '../rules/mode.js';

export { OFFERS_FEATURE };

/** Whether the chat of a view (or of a ctx) was pinned in free mode: Jobs from the story is on for it. */
export const offersOn = source => stateFree(source?.state ?? (typeof source?.read === 'function' ? { domains: { rules: source.read('rules') } } : null));

/** Whether the pin has at least one open quest template: without one there is nothing to settle an offer in. */
export const hasOpenQuests = pin => templates(pin).some(template => template?.open === true);
