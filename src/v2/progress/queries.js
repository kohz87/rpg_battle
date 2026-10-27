// RPG Battle v2, the progression queries (contract §3): `rules.progress({ actor? })` → ProgressView | null.
// Read-only; unknown or malformed → null. The level comes from the party part by `party.actor`, the class,
// skills and masteries from the choices and the credited uses, the milestones from the pinned ruleset.

import { memberOf } from './assess.js';
import { paceOf, progressView } from './offers.js';
import { indexOfState } from '../rules/graph.js';
import { isActorId, isObject } from '../rules/ids.js';
import { ask } from '../rules/ask.js';
import { readClock } from '../training/clock.js';


/** rules.progress({ actor? }): the actor's class, level, skill checklist, and the promotions and paths waiting. Your character by default. */
export function rulesProgress(state, args, tools) {
    if (args !== undefined && args !== null && (!isObject(args) || Object.keys(args).some(key => key !== 'actor'))) return null;
    const ix = indexOfState(state);
    if (!ix) return null;
    const query = tools?.query;
    const actor = args?.actor ?? ask(query, 'party.pc', {})?.id;
    if (!isActorId(actor)) return null;
    const member = memberOf(query, actor);
    if (!member) return null;
    const level = Math.min(Math.max(member.level, ix.constants.startLevel), ix.constants.levelCap);
    return progressView(ix, state?.domains?.progress ?? {}, actor, level, readClock(query));
}

/** rules.pace({}): how mastery grows under the pinned rules (offers.js paceOf), or null with no pin. */
export function rulesPace(state, args) {
    if (args !== undefined && args !== null && (!isObject(args) || Object.keys(args).length)) return null;
    const ix = indexOfState(state);
    return ix ? paceOf(ix) : null;
}

export const queries = { 'rules.progress': rulesProgress, 'rules.pace': rulesPace };
