// The feature switch of the generative offers (F100, GENERATIVE_OFFERS_SPEC §10): "Jobs from the story". Off is strict mode, every path as in RPG
// Battle 2.2.0. The reader's choice, not the chat's; a host that cannot say takes it as on.
//
// The switch is what the reader sees now (the rules block of the prompt, the settings, the queries and cards of the feature). What a capture does with a line is decided by the mode its reply
// was read under (rules/mode.js: `readsFreely(ctx)`), which a change of the switch moves only for replies read after it.
import { featureOn } from '../items/condition.js';
import { templates } from './seams.js';
import { OFFERS_FEATURE } from '../rules/mode.js';

export { OFFERS_FEATURE };

/** Whether a ctx or view has the feature on. */
export const offersOn = source => featureOn(source, OFFERS_FEATURE);

/** Whether the pin has at least one open quest template: without one there is nothing to settle an offer in. */
export const hasOpenQuests = pin => templates(pin).some(template => template?.open === true);
