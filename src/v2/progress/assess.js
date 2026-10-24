// RPG Battle v2, one question asked in two places: "is this choice, or this settlement, earned on this state?".
// The command asks it on the state it runs on; the replay guard asks it again, with the same code, on the state
// before the stored block (guard.js). Both get the same answer from the same function, so a choice is stored
// only if the guard will accept it on the same story. Pure over the pinned index, the progress slice and the
// queries it is given (`party.actor` for the level, `director.time` for the clock).

import { evaluateClass, evaluatePath, standing } from './offers.js';
import { planSettlement } from './credit.js';
import { readClock } from '../training/clock.js';
import { isObject } from '../rules/ids.js';

/** A party member through `query` ({ id, name, level, … }) or null: the party part is another part's, asked only by query. */
export function memberOf(query, actor) {
    if (typeof query !== 'function') return null;
    try {
        const member = query('party.actor', { id: actor });
        return isObject(member) && Number.isInteger(member.level) ? member : null;
    } catch {
        return null;
    }
}

/**
 * Asks about an operation: `kind` 'class.choose' | 'path.choose' (payload = the command's payload) or
 * 'rules.settle'. `env`: { ix, progress, query }. → { ok: true, inputs, … } | { ok: false, code, why }.
 * `inputs` is what the guard hashes; the extras (`member`, `skills`, `step`, `plan`) are for the command.
 */
export function assess(kind, env, payload) {
    const { ix, progress, query } = env;
    if (kind === 'rules.settle') {
        const plan = planSettlement(ix.constants, progress, readClock(query));
        return plan.length ? { ok: true, plan, inputs: { plan } } : { ok: false, code: 'NO_LONGER_DONE', why: 'There is nothing to settle here.' };
    }
    const member = memberOf(query, payload.actor);
    if (!member) return { ok: false, code: 'NOT_FOUND', why: 'That character is not in the party.' };
    const st = standing(ix, progress, payload.actor);
    if (kind === 'class.choose') {
        const result = evaluateClass(ix, st, payload, member.level);
        return result.ok ? { ok: true, member, skills: result.skills, inputs: { facts: result.facts, selected: payload.class, skills: result.skills } } : { ...result };
    }
    const result = evaluatePath(ix, st, payload, member.level);
    return result.ok ? { ok: true, member, step: result.step, inputs: { facts: result.facts, option: payload.option } } : { ...result };
}
