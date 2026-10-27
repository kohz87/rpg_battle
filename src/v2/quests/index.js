// The retained quest API. Mechanics live here; SD owns the one shared thread and its journal.
import { replayOpening } from './opening.js';
import { replayOffer } from './offer-plan.js';
import { OFFERS_FEATURE } from './offer-feature.js';
import { OFFER_DEFAULTS, OFFER_SCHEMA } from './offer-settings.js';
import { offerCard } from './offer-card.js';
import { createSettlement } from './settlement.js';
import { createCommands } from './commands.js';
import { createQueries } from './queries.js';
import { questCreditHook, questExpiryHook } from './credit.js';
import { QUEST_STATIC, questTail } from './prompt.js';
import { createCapture, QUEST_GRAMMAR } from './capture.js';
import { evaluateRequirements } from './requirements.js';
import { canReceive } from './rewards.js';
import { createObjectives } from './objectives.js';
import { validateObjectiveProof } from './proofs.js';

export { findQuest, objectiveProgress, planQuestSettlement, settlementKey } from './planner.js';
export { parseTarget, parseReward, settleReward } from './parse.js';
export { progressOf, questLists } from './progress.js';
export { ranksOf } from './ranks.js';
export { offeredQuest, terminalQuest, nextOffers } from './outcomes.js';

export function createQuestPart(policy = {}) {
    policy = { evaluateRequirements, canReceive, validateProof: validateObjectiveProof, ...policy };
    const objectives = createObjectives(policy);
    policy = { ...policy, ...createSettlement(policy), ...objectives };
    // One replayGuard for the part: an objective's guard first, every other quest guard as before.
    const replayGuard = policy.replayGuard && ((env, info) => replayOffer(env, info) ?? replayOpening(env, info) ?? objectives.replayObjective(env, info) ?? policy.replayGuard(env, info));
    // The rules block of Jobs from the story is a piece under the feature: Story Block leaves it out while the feature is off, and so does it when the
    // piece answers nothing (an unpinned chat, a pin with no open quest template): every such chat keeps the static bytes it had.
    const offerPiece = { feature: OFFERS_FEATURE, static: ({ settings = {}, query = null } = {}) => {
        try { return query('quest.offerBlock', { ranks: settings.offerGuideRanks, examples: settings.offerGuideExamples }) ?? ''; } catch { return ''; }
    } };
    return { context: { static: () => QUEST_STATIC, tail: questTail, budget: 250, parts: [offerPiece] }, replayQueries: ['quest.replayInputs'], domains: {}, commands: createCommands(policy), queries: createQueries(policy),
        kinds: { quest: { grammar: QUEST_GRAMMAR, apply: createCapture(policy) } },
        features: [Object.freeze({ id: OFFERS_FEATURE, label: 'Jobs from the story', default: true, prompt: true,
            describe: 'The narrator may offer a job or a teacher in its own words; code picks the template, rank, count, coin, XP, deadline and fee inside the pack\'s limits and tells the narrator the terms. Off: only the frozen forms, as before.' })],
        settings: { defaults: { followLadder: true, ...OFFER_DEFAULTS }, schema: { followLadder: { type: 'bool', label: 'Quest ranks follow the rank ladder' }, ...OFFER_SCHEMA } },
        hooks: { ...(replayGuard ? { replayGuard, afterCapture: questCreditHook, beforeGenerate: questExpiryHook } : {}), replyCard: Object.assign(info => offerCard(info), { feature: OFFERS_FEATURE }) } };
}
export const part = createQuestPart();
