// The retained quest API. Mechanics live here; SD owns the one shared thread and its journal.
import { createSettlement } from './settlement.js';
import { createCommands } from './commands.js';
import { createQueries } from './queries.js';
import { createCapture, QUEST_GRAMMAR } from './capture.js';

export { findQuest, objectiveProgress, planQuestSettlement, settlementKey } from './planner.js';
export { parseTarget, parseReward, settleReward } from './parse.js';
export { progressOf, questLists } from './progress.js';
export { ranksOf } from './ranks.js';
export { offeredQuest, terminalQuest, nextOffers } from './outcomes.js';

export function createQuestPart(policy = {}) {
    policy = { ...policy, ...createSettlement(policy) };
    return { domains: {}, commands: createCommands(policy), queries: createQueries(policy),
        kinds: { quest: { grammar: QUEST_GRAMMAR, apply: createCapture(policy) } },
        settings: { defaults: { followLadder: true }, schema: { followLadder: { type: 'bool', label: 'Quest ranks follow the rank ladder' } } },
        ...(policy.replayGuard ? { hooks: { replayGuard: policy.replayGuard } } : {}) };
}
export const part = createQuestPart();
