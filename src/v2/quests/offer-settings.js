// The settings of Jobs from the story (GENERATIVE_OFFERS_SPEC §2.5): what the rules block's grading guide lists, and how many settled terms one reply tells.
// All under the feature, so they are drawn only while it is on.
import { OFFERS_FEATURE } from './offer-feature.js';

export const OFFER_DEFAULTS = Object.freeze({ offerGuideRanks: 4, offerGuideExamples: 3, offerTermsPerReply: 3 });
const GROUP = 'Jobs from the story';

export const OFFER_SCHEMA = Object.freeze({
    offerGuideRanks: Object.freeze({ type: 'int', group: GROUP, feature: OFFERS_FEATURE, min: 0, max: 8, label: 'Ranks in the grading guide (0: no guide)',
        help: 'How many job ranks the narrator is told about, with what each pays and the foes that fit it. Each rank costs about 200 characters in every prompt.' }),
    offerGuideExamples: Object.freeze({ type: 'int', group: GROUP, feature: OFFERS_FEATURE, min: 0, max: 4, label: 'Foes named per rank in the guide',
        help: 'How many example foes each guide line names (the weakest, the middle, the strongest).' }),
    offerTermsPerReply: Object.freeze({ type: 'int', group: GROUP, feature: OFFERS_FEATURE, min: 1, max: 6, label: 'Settled terms told per reply',
        help: 'After a burst of offers the narrator is told this many jobs\' terms; the rest are only counted ("…and 2 more jobs are posted").' }),
});

/** A whole number in `[low, high]` from a setting, else the default. */
export const settingInt = (settings, key, low, high) => (Number.isInteger(settings?.[key]) && settings[key] >= low && settings[key] <= high ? settings[key] : OFFER_DEFAULTS[key]);
