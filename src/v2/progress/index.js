// RPG Battle v2, part **progress** (contract §3, §5, §10 B "First slice"): the 5/5 mastery cap, level and XP from
// the pinned ruleset, promotion with the atomic three-skill swap, the waiting paths and the selected-parent
// rule, with every credit and choice guarded so a swipe, delete or Re-read that removes a prerequisite removes
// what depended on it. See domain.js for the records, offers.js for the rules, guard.js for the replay.
//
// module.js reserves this part with deferred domains/APIs on a compatible host. Only rules.pin initializes
// it for a new character timeline; an unpinned chat keeps its old bytes (contract §9). The part supplies
// the `progress` domain, `class.choose` and `path.choose`, and answers
// `hooks.replayGuard` for its own guards (`GUARD_KINDS`) and `afterCapture` (it asks the host for
// `rules.settle` once a reply has attempts waiting for a credit). The `rules` part (../rules/index.js) holds
// the pinned ruleset, `rules.progress` and `rules.settle`.

import { commands } from './commands.js';
import { commands as rosterCommands } from './roster.js';
import { commands as useCommands, kinds as useKinds } from './use.js';
import { commands as rescueCommands } from './rescue.js';
import { initialProgress, progressProblems } from './domain.js';
import { replayGuard } from './guard.js';
import { pendingOf } from './credit.js';
import { pinOf } from '../rules/pin.js';
import { placeOf, purseOf } from './session-step.js';
import { readClock } from '../training/clock.js';

export { GUARD_KINDS, PREREQUISITE_REMOVED } from './guard.js';
export { buildGuard } from './guard.js';
export { recordAttempt, recordBasicClass, recordCombatUses } from './record.js';
export { startRulesClass } from './start.js';

/** Whether uses wait for a credit that can be given now: a pinned ruleset, and an attempt with a minute of its own or a clock to settle it at. */
function settlementDue(view) {
    if (!pinOf(view?.state)) return false;
    const pending = pendingOf(view.state.domains?.progress);
    return pending.some(item => Number.isSafeInteger(item.attempt.minute)) || (pending.length > 0 && readClock(view.query) !== null);
}

/**
 * afterCapture(view): once a reply's lines have run, ask for the settlement of the attempts that wait for a credit, and for
 * the start of each training session the player asked for (when the clock, the place and the purse can be read: otherwise it
 * waits). Nothing in a chat that pins no rules (contract §9: a legacy chat is left alone), with none waiting, or with only
 * attempts that wait for a clock (no minute of their own and no clock set: held until one is, contract §4 "unset time holds
 * only dependent actions").
 */
export function afterCapture(view) {
    if (!pinOf(view?.state)) return { commands: [] };
    const commands = [];
    if (settlementDue(view)) commands.push({ type: 'rules.settle', payload: {} });
    const waiting = Object.values(view.state.domains?.training?.sessions ?? {}).filter(session => session.status === 'requested').map(session => session.id).sort();
    if (waiting.length && readClock(view.query) !== null && placeOf(view.query) !== null && purseOf(view.query) !== null) {
        for (const session of waiting) commands.push({ type: 'rules.settle', payload: { session } });
    }
    return { commands };
}

/**
 * beforeGenerate (SPEC §4.1 step 3): the uses that wait for a credit are settled before the next reply is written, as a system step kept on the reply at the head. afterCapture
 * settles them only after a reply that wrote a change line (Story Block runs it for no other), so a fight's uses stayed unpaid through quiet replies, and the boundary they were
 * credited at depended on what the next reply wrote. Here the boundary is the reply the fight was told on, which every delete and swipe keeps or takes back with it.
 * For a new reply only (not a swipe, a Continue, a quiet or an impersonated one); like afterCapture, nothing without a pinned ruleset, with none waiting, or with only
 * attempts that wait for a clock.
 */
export function settleBeforeReply(view, info = {}) {
    const type = String(info?.type ?? 'normal').toLowerCase();
    if (type === 'swipe' || type === 'continue' || type === 'quiet' || type === 'impersonate') return { commands: [] };
    return settlementDue(view) ? { commands: [{ type: 'rules.settle', payload: {} }] } : { commands: [] };
}

export const part = {
    domains: { progress: { initial: initialProgress, validate: progressProblems } },
    commands: { 'class.choose': commands['class.choose'], 'path.choose': commands['path.choose'], ...rosterCommands, ...useCommands, ...rescueCommands },
    kinds: { ...useKinds },
    hooks: { replayGuard, afterCapture, beforeGenerate: settleBeforeReply },
    // The queries its replay guards ask (Story Block REPLAY.md: a guard may ask only its owner module's own queries listed here, and they must
    // depend on the state and their arguments alone). They are the party part's; module.js unions this list into the module's.
    replayQueries: ['party.actor', 'party.actors'],
};
