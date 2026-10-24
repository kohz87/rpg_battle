// RPG Battle v2, where a new character gets its basic class (contract §3: creation.finish "gains required
// player-selected class:Ref. It atomically creates the actor and records the milestone-0 Choice"; party.addCompanion
// "resolves its v2 class from the accepted recruitment offer when omitted").
//
// `startRulesClass(ctx, { actor, class, checkActor? })` is called by those two commands in their own transaction, right
// after the actor exists. In a chat that pins no rules it does nothing at all (a legacy chat, or the parts not
// registered: `ctx.read('rules')` is null), so the callers behave exactly as they always did. In a rules-v2 chat the
// class is required, must be a basic class of the pinned ruleset, and is recorded with its three skills; the caller's
// block gets the `class.start` guard, so if the pin or the class is gone on replay, the character is not made and nothing
// else is made in its place. The new player character is also linked to one of Story Director's check actors (contract §3 P09,
// `linkChecks` below): `checkActor` if given, else Story Director's default, else a new actor named like the character, made the default.
// Without Story Director's checks nothing is linked and nothing is asked of it.

import { assess } from './assess.js';
import { attachGuard } from './guard.js';
import { recordBasicClass } from './record.js';
import { indexOfCtx } from '../rules/graph.js';
import { isDefId, isObject, isRecordId } from '../rules/ids.js';

/** → { choice } when a class was recorded, or null when the chat pins no rules. */
export function startRulesClass(ctx, { actor, class: ref, checkActor } = {}) {
    const ix = indexOfCtx(ctx);
    if (!ix) return null;
    if (!isDefId(ref)) ctx.fail('INVALID', 'Choose a basic class for the new character.');
    if (checkActor !== undefined && checkActor !== null && !(isRecordId(checkActor) && checkActor.startsWith('ca_'))) ctx.fail('INVALID', 'The check actor is a ca_ id.');
    const answer = assess('class.start', { ix, progress: ctx.read('progress'), query: null }, { actor, class: ref });
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    const made = recordBasicClass(ctx, { actor, class: ref });
    attachGuard(ctx, ix, 'class.start', { actor, class: ref }, answer.inputs);
    linkChecks(ctx, { actor, checkActor });
    return made;
}

/**
 * Links the new character to a Story Director check actor in the creation's own transaction (contract §3 P09: `checks.link`; "use that actor,
 * else the existing SD default, else create an SD actor and default it"). Standalone names and bonuses are kept: an existing actor is only
 * linked. Story Director's refusal (an actor that already has another living character: CONFLICT) fails the creation whole. No Story Director
 * checks, or one that does not answer `checks.policy`: nothing is linked and nothing fails (RPG Battle never depends on it). → the link or null.
 */
function linkChecks(ctx, { actor, checkActor }) {
    let policy = null;
    try { policy = ctx.query('checks.policy', {}); } catch { policy = null; }
    if (!isObject(policy) || typeof policy.hash !== 'string') return null;
    let target = checkActor ?? (typeof policy.defaultActor === 'string' ? policy.defaultActor : null);
    let hash = policy.hash;
    if (target === null) {
        const name = String(ctx.read('party')?.actors?.[actor]?.name ?? '').trim().slice(0, 80) || 'Player';
        const made = ctx.call('checks.actor', { write: ctx.id('wr'), name, makeDefault: true, expectedHash: hash }).data?.v2?.result;
        if (!isObject(made) || typeof made.actor !== 'string') ctx.fail('FAILED', 'Story Director made no check actor.');
        target = made.actor;
        hash = made.hash;
    }
    const linked = ctx.call('checks.link', { write: ctx.id('wr'), actor: target, rbActor: actor, expectedHash: hash }).data?.v2?.result;
    return isObject(linked) ? linked : null;
}
