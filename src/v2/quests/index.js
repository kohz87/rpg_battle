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
    // The rules block of Jobs from the story is a piece that answers nothing for a chat pinned in strict mode (or not pinned, or with no open quest template): every such chat keeps the static bytes it had.
    // It follows the chat's pinned mode, not the switch of the moment (quests/offer-feature.js).
    const offerPiece = { static: ({ settings = {}, query = null } = {}) => {
        try { return query('quest.offerBlock', { ranks: settings.offerGuideRanks, examples: settings.offerGuideExamples }) ?? ''; } catch { return ''; }
    } };
    return { context: { static: () => QUEST_STATIC, tail: questTail, budget: 250, parts: [offerPiece] }, replayQueries: ['quest.replayInputs'], domains: {}, commands: createCommands(policy), queries: createQueries(policy),
        kinds: { quest: { grammar: QUEST_GRAMMAR, apply: createCapture(policy) } },
        features: [Object.freeze({ id: OFFERS_FEATURE, label: 'Jobs from the story', default: true, prompt: true,
            describe: 'The narrator may offer a job or a teacher in its own words; code fixes the numbers inside the pack\'s limits. Applies to chats whose rules are pinned from now on; a chat keeps the mode it was pinned with.' })],
        settings: { defaults: { followLadder: true, ...OFFER_DEFAULTS }, schema: { followLadder: { type: 'bool', label: 'Quest ranks follow the rank ladder' }, ...OFFER_SCHEMA } },
        hooks: { ...(replayGuard ? { replayGuard, afterCapture: questCreditHook, beforeGenerate: questExpiryHook } : {}), replyCard: info => offerCard(info) } };
}
export const part = createQuestPart();
