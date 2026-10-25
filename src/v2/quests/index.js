// The retained quest API. Mechanics live here; SD owns the one shared thread and its journal.
import { createSettlement } from './settlement.js';
import { createCommands } from './commands.js';
import { createQueries } from './queries.js';
import { questCreditHook, questExpiryHook } from './credit.js';
import { QUEST_STATIC, questTail } from './prompt.js';
import { createCapture, QUEST_GRAMMAR } from './capture.js';
import { evaluateRequirements } from './requirements.js';
import { canReceive } from './rewards.js';

export { findQuest, objectiveProgress, planQuestSettlement, settlementKey } from './planner.js';
export { parseTarget, parseReward, settleReward } from './parse.js';
export { progressOf, questLists } from './progress.js';
export { ranksOf } from './ranks.js';
export { offeredQuest, terminalQuest, nextOffers } from './outcomes.js';

export function createQuestPart(policy = {}) {
    policy = { evaluateRequirements, canReceive, ...policy };
    policy = { ...policy, ...createSettlement(policy) };
    return { context: { static: () => QUEST_STATIC, tail: questTail, budget: 250 }, replayQueries: ['quest.replayInputs'], domains: {}, commands: createCommands(policy), queries: createQueries(policy),
        kinds: { quest: { grammar: QUEST_GRAMMAR, apply: createCapture(policy) } },
        settings: { defaults: { followLadder: true }, schema: { followLadder: { type: 'bool', label: 'Quest ranks follow the rank ladder' } } },
        ...(policy.replayGuard ? { hooks: { replayGuard: policy.replayGuard, afterCapture: questCreditHook, beforeGenerate: questExpiryHook } } : {}) };
}
export const part = createQuestPart();
