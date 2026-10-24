// RPG Battle v2, the two records other commands write into the progress domain (they are not commands of their
// own; contract §3 names no command for them): the **basic class** of a new character (milestone 0, written
// by creation.finish and party.addCompanion in their own transaction) and a **paid attempt** (written by what
// paid for the use: a fight's end settlement, a narrative use, a finished training session). Both take the
// command's `ctx`, write the progress draft and leave the guard, the proof and the payment to the caller's own
// block, which already has them (nested writes share the caller's guard). Neither is reachable from the story.
//
//   recordBasicClass(ctx, { actor, class })     → { choice }
//   recordAttempt(ctx, { actor, skill, form, kind, key, cost?, session?, minute?, capSource? }) → { id, created }

import { choiceKey } from './derive.js';
import { KINDS } from './credit.js';
import { MAX_ATTEMPTS } from './domain.js';
import { indexOf } from '../rules/graph.js';
import { pinOf } from '../rules/pin.js';
import { epochOf, idFromHash, isActorId, isDefId, isObject, isRecordId } from '../rules/ids.js';

// A Source as an attempt keeps it: the reply and swipe it stands on and its evidence id, never the ordinal (the host numbers a
// block anew when a Re-read plans it again, and a record that changed with it would make the same story read differently).
const whole = source => ({ sid: source.sid, swipeKey: source.swipeKey, evidence: source.evidence });

/** The pinned index for a writer, or a refusal. */
function ixOf(ctx) {
    const ix = indexOf(pinOf({ domains: { rules: ctx.read('rules') } }));
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    return ix;
}

/**
 * The milestone-0 Choice (contract §3: creation.finish "records the milestone-0 Choice with its three base
 * skills"): the basic class (a root: tier 0, no parent) and its three skills, each at its base form and 0/5.
 * A character has one; a second is refused. Claims `rb:<epoch>:class:<actor>:0`.
 */
export function recordBasicClass(ctx, { actor, class: ref }) {
    if (!isActorId(actor) || !isDefId(ref)) ctx.fail('INVALID', 'A basic class needs an actor and a class.');
    const ix = ixOf(ctx);
    const picked = ix.class(ref);
    if (!picked || picked.tier !== 0 || picked.parent !== null) ctx.fail('REFUSED', 'A new character starts in a basic class.');
    const choices = ctx.draft('progress').choices;
    const key = choiceKey(actor, 0);
    if (Object.hasOwn(choices, key)) ctx.fail('REFUSED', 'That character already has a basic class.');
    if (!ctx.claim(`rb:${epochOf()}:class:${actor}:0`)) ctx.fail('CLAIMED', 'That character\'s basic class was already chosen.');
    const choice = { actor, milestone: 0, kind: 'class', previous: null, selected: ref, skills: [...picked.skills], rulesHash: ix.rulesHash };
    choices[key] = choice;
    return { choice };
}

/**
 * One paid attempt (contract B3 "Keep every paid attempt"): { actor, skill, form, kind: combat | narrative |
 * training, key (the payer's stable name for it: an action id, a proof id, a session and its credit number),
 * cost (the payment's reference), session (a training session's), minute (the story minute it counts on, when
 * the payer recorded one: a training session's completion), capSource (the Source of the boundary that settles
 * it, default this reply) }. The same key again is the same attempt; the same key with other contents is a
 * CONFLICT. The credit is not decided here: rules.settle decides it.
 */
export function recordAttempt(ctx, input) {
    if (!isObject(input)) ctx.fail('INVALID', 'An attempt is { actor, skill, form, kind, key }.');
    const { actor, skill, form, kind, key } = input;
    if (!isActorId(actor) || !isDefId(skill) || !isDefId(form) || !KINDS.includes(kind) || typeof key !== 'string' || !key || key.length > 120) {
        ctx.fail('INVALID', 'An attempt names an actor, a skill, a form, its kind (combat, narrative or training) and a key.');
    }
    const cost = input.cost ?? null;
    const session = input.session ?? null;
    const minute = input.minute ?? null;
    if (!(cost === null || (typeof cost === 'string' && cost && cost.length <= 120)) || !(session === null || (typeof session === 'string' && session && session.length <= 120)) || !(minute === null || Number.isSafeInteger(minute))) {
        ctx.fail('INVALID', 'An attempt\'s cost and session are text, its minute a whole minute.');
    }
    const source = ctx.source;
    if (!source) ctx.fail('FAILED', 'There is no reply yet to hold the attempt.');
    const capSource = input.capSource ?? source;
    if (!isObject(capSource) || !isRecordId(capSource.sid) || !isRecordId(capSource.swipeKey) || !isRecordId(capSource.evidence)) ctx.fail('INVALID', 'An attempt\'s boundary is a Source.');
    ixOf(ctx);
    const id = idFromHash('at', ctx.hash({ kind, key }));
    const attempt = { actor, skill, form, kind, source: whole(source), capSource: whole(capSource), cost, session, minute };
    const attempts = ctx.draft('progress').attempts;
    const have = attempts[id];
    if (have) {
        // The same attempt again changes nothing; the Source it was first recorded on is the one that stays.
        const same = ['actor', 'skill', 'form', 'kind', 'cost', 'session', 'minute'].every(field => have[field] === attempt[field]);
        if (!same) ctx.fail('CONFLICT', 'That attempt was recorded with other contents.');
        return { id, created: false };
    }
    if (Object.keys(attempts).length >= MAX_ATTEMPTS) ctx.fail('LIMITED', `This chat keeps at most ${MAX_ATTEMPTS} paid attempts.`);
    attempts[id] = attempt;
    return { id, created: true };
}
