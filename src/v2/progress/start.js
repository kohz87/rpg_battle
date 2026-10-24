// RPG Battle v2, where a new character gets its basic class (contract §3: creation.finish "gains required
// player-selected class:Ref. It atomically creates the actor and records the milestone-0 Choice"; party.addCompanion
// "resolves its v2 class from the accepted recruitment offer when omitted").
//
// `startRulesClass(ctx, { actor, class, checkActor? })` is called by those two commands in their own transaction, right
// after the actor exists. In a chat that pins no rules it does nothing at all (a legacy chat, or the parts not
// registered: `ctx.read('rules')` is null), so the callers behave exactly as they always did. In a rules-v2 chat the
// class is required, must be a basic class of the pinned ruleset, and is recorded with its three skills; the caller's
// block gets the `class.start` guard, so if the pin or the class is gone on replay, the character is not made and nothing
// else is made in its place. `checkActor` (an SD check actor to link) is checked for shape here; linking is Story
// Director's side (`checks.link`, a later package).

import { assess } from './assess.js';
import { attachGuard } from './guard.js';
import { recordBasicClass } from './record.js';
import { indexOfCtx } from '../rules/graph.js';
import { isDefId, isRecordId } from '../rules/ids.js';

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
    return made;
}
