// The feature switch of the generative offers (F100, GENERATIVE_OFFERS_SPEC §10): "Jobs from the story". Off is strict mode, every path as in RPG
// Battle 2.2.0. The reader's choice, not the chat's; a host that cannot say takes it as on.
import { featureOn } from '../items/condition.js';
import { templates } from './seams.js';

export const OFFERS_FEATURE = 'rpg-battle.generative-offers';

/** Whether a ctx or view has the feature on. */
export const offersOn = source => featureOn(source, OFFERS_FEATURE);

/** Whether the pin has at least one open quest template: without one there is nothing to settle an offer in. */
export const hasOpenQuests = pin => templates(pin).some(template => template?.open === true);
