// RPG Battle v2, part **progress** (contract §3, §5, §10 B "First slice"): the 5/5 mastery cap, level and XP from
// the pinned ruleset, promotion with the atomic three-skill swap, the waiting paths and the selected-parent
// rule, with every credit and choice guarded so a swipe, delete or Re-read that removes a prerequisite removes
// what depended on it. See domain.js for the records, offers.js for the rules, guard.js for the replay.
//
// This part is **not registered** by module.js yet (the lead wires it, behind the host's lifecycle: a chat is
// a rules-v2 chat only when its `rules` slice says so, contract §9). Until then no existing chat, pack or
// command changes. A registered part adds the `progress` domain, `class.choose` and `path.choose`, and answers
// `hooks.replayGuard` for its own guards (`GUARD_KINDS`) and `afterCapture` (it asks the host for
// `rules.settle` once a reply has attempts waiting for a credit). The `rules` part (../rules/index.js) holds
// the pinned ruleset, `rules.progress` and `rules.settle`.

import { commands } from './commands.js';
import { commands as rosterCommands } from './roster.js';
import { commands as useCommands, kinds as useKinds } from './use.js';
import { initialProgress, progressProblems } from './domain.js';
import { replayGuard } from './guard.js';
import { pendingOf } from './credit.js';
import { pinOf } from '../rules/pin.js';

export { GUARD_KINDS, PREREQUISITE_REMOVED } from './guard.js';
export { recordAttempt, recordBasicClass, recordCombatUses } from './record.js';
export { startRulesClass } from './start.js';

/**
 * afterCapture(view): once a reply's lines have run, ask for the settlement of the attempts that wait for a
 * credit. Nothing in a chat that pins no rules (contract §9: a legacy chat is left alone) or has none waiting.
 */
export function afterCapture(view) {
    if (!pinOf(view?.state)) return { commands: [] };
    return { commands: pendingOf(view.state.domains?.progress).length ? [{ type: 'rules.settle', payload: {} }] : [] };
}

export const part = {
    domains: { progress: { initial: initialProgress, validate: progressProblems } },
    commands: { 'class.choose': commands['class.choose'], 'path.choose': commands['path.choose'], ...rosterCommands, ...useCommands },
    kinds: { ...useKinds },
    hooks: { replayGuard, afterCapture },
};
