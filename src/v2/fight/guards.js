// RPG Battle v2, the replay guards of a pinned fight (B5: "Combat act/end: full action/cost/draw record and exact predecessor; terminal
// ordered-prefix/outcome guard"). Both questions are asked by the command and again by the replay hook (progress/guard.js) on the state
// before the block, with the same code:
//
//   combat.act  { session, action }   the fight exists; the actions before this one are exactly the ones this action stood on; this action
//                                     can be played on them. inputs: { setup, prefix, version }. A prefix that lost an action (its reply was
//                                     deleted or swiped) turns this block off, and every block after it: nothing is substituted
//   combat.end  { session }           the fight exists and is over; inputs: { setup, actions (ids and hashes, in order), outcome, result }, the
//                                     hash of the result summarized from that prefix. No longer terminal, or a different prefix: the whole
//                                     settlement is off with its costs, rewards, uses and claims
//
// Pure over the state it is given.

import { summarize } from '../../combat.js';
import { hashJson } from '../rules/hash.js';
import { isObject } from '../rules/ids.js';
import { playStored, rebuild } from '../combat/view.js';
import { sessionOf, unpackSetup } from '../combat/stored.js';
import { actionHash, actionProblems } from './records.js';

const FIGHT_VERSION = 1;

/** The stored fight `id` in a combat slice, or null. */
const fightIn = (combat, id) => (isObject(combat?.fights) && isObject(combat.fights[id]) ? combat.fights[id] : sessionOf(combat)?.id === id ? sessionOf(combat) : null);

export function buildAct(env, payload) {
    const session = fightIn(env.combat, payload.session);
    if (!session) return { ok: false, code: 'NOT_FOUND', why: 'That fight is not there any more.' };
    if (session.setup?.ruleset !== env.ix.rulesHash) return { ok: false, code: 'RULES_MISMATCH', why: 'The fight was begun under other rules than the ones this chat runs.' };
    const problems = actionProblems(payload.action);
    if (problems.length) return { ok: false, code: 'INVALID', why: problems[0] };
    const prefix = session.actions ?? [];
    // The action can be played on the prefix (the rebuild is as tolerant as the view; the single step is strict).
    try {
        const { fight, rules } = rebuild({ id: session.id, setup: session.setup, actions: prefix });
        if (fight.status !== 'active') return { ok: false, code: 'REFUSED', why: 'That fight is over.' };
        playStored(fight, payload.action, rules);
    } catch (error) {
        return { ok: false, code: 'REFUSED', why: error?.message || 'That action cannot be played there.' };
    }
    return { ok: true, inputs: { version: FIGHT_VERSION, setup: hashJson(session.setup), prefix: prefix.map(action => hashJson(action)) } };
}

export function buildEnd(env, payload) {
    const session = fightIn(env.combat, payload.session);
    if (!session) return { ok: false, code: 'NOT_FOUND', why: 'That fight is not there any more.' };
    if (session.setup?.ruleset !== env.ix.rulesHash) return { ok: false, code: 'RULES_MISMATCH', why: 'The fight was begun under other rules than the ones this chat runs.' };
    const { fight, rules } = rebuild({ id: session.id, setup: session.setup, actions: session.actions ?? [] });
    if (fight.status === 'active') return { ok: false, code: 'REFUSED', why: 'The fight is not over yet.' };
    const setup = unpackSetup(session.setup);
    const result = summarize(fight, rules);
    return {
        ok: true,
        inputs: {
            version: FIGHT_VERSION,
            setup: hashJson(session.setup),
            actions: (session.actions ?? []).map(action => ({ id: action.id ?? null, hash: actionHash(action) })),
            outcome: result.outcome,
            result: hashJson({ ...result, keyMoments: [], moneyScale: setup.moneyScale ?? 1 }),
        },
    };
}
