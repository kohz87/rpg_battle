// The retained quest API. Mechanics live here; SD owns the one shared thread and its journal.
import { replayOpening } from './opening.js';
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
    const replayGuard = policy.replayGuard && ((env, info) => replayOpening(env, info) ?? objectives.replayObjective(env, info) ?? policy.replayGuard(env, info));
    return { context: { static: () => QUEST_STATIC, tail: questTail, budget: 250 }, replayQueries: ['quest.replayInputs'], domains: {}, commands: createCommands(policy), queries: createQueries(policy),
        kinds: { quest: { grammar: QUEST_GRAMMAR, apply: createCapture(policy) } },
        settings: { defaults: { followLadder: true }, schema: { followLadder: { type: 'bool', label: 'Quest ranks follow the rank ladder' } } },
        ...(replayGuard ? { hooks: { replayGuard, afterCapture: questCreditHook, beforeGenerate: questExpiryHook } } : {}) };
}
export const part = createQuestPart();
