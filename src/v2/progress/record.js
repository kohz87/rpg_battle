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
    if (!ctx.claim(`rb:${epochOf(ctx)}:class:${actor}:0`)) ctx.fail('CLAIMED', 'That character\'s basic class was already chosen.');
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
    const source = ctx.source;
    if (!source) ctx.fail('FAILED', 'There is no reply yet to hold the attempt.');
    const ix = ixOf(ctx);
    if (isObject(input) && ix.form(input.form)?.skill !== input.skill) ctx.fail('INVALID', 'That form does not belong to that skill.');
    const made = attemptFor(input, source, value => ctx.hash(value), message => ctx.fail('INVALID', message));
    const attempts = ctx.draft('progress').attempts;
    const have = attempts[made.id];
    if (have) {
        // The same attempt again changes nothing; the Source it was first recorded on is the one that stays.
        const same = ['actor', 'skill', 'form', 'kind', 'cost', 'session', 'minute'].every(field => have[field] === made.record[field]);
        if (!same) ctx.fail('CONFLICT', 'That attempt was recorded with other contents.');
        return { id: made.id, created: false };
    }
    // A payer never fails on the ledger's size (fold.js): an attempt that cannot earn is not kept, and past the hard limit none is.
    if (cannotEarn(ix.constants, attempts, made.record) || Object.keys(attempts).length >= MAX_ATTEMPTS) return { id: made.id, created: false, dropped: true };
    // The attempt's own claim outlives its row: one folded into the sealed counts (fold.js) is not recorded again under the same key.
    if (!ctx.claim(`rb:${epochOf(ctx)}:attempt:${made.id}`)) return { id: made.id, created: false, folded: true };
    attempts[made.id] = made.record;
    return { id: made.id, created: true };
}

/**
 * Whether a use is sure to earn nothing: a combat or narrative use that counts on the clock's day, when the same character has
 * already used the same skill in the same form on the same reply `usePerSkillReply` times. Whatever zeroed the first ones (the
 * mastered form, a day cap, the reply caps) holds for this one too, since counts only grow. Training counts on its own day and is
 * never judged here.
 */
function cannotEarn(constants, attempts, record) {
    if (record.kind === 'training' || record.minute !== null) return false;
    let same = 0;
    for (const other of Object.values(attempts)) {
        if (other.kind !== 'training' && other.minute === null && other.actor === record.actor && other.skill === record.skill && other.form === record.form && other.capSource.sid === record.capSource.sid) same += 1;
    }
    return same >= constants.usePerSkillReply;
}

/**
 * The attempt record and its id for `input` on `source` (pure; `hash` the contract's Hash, `invalid(message)` throws). Shared
 * by recordAttempt and by whatever plans an attempt before it is written (the training step's replay guard).
 */
export function attemptFor(input, source, hash, invalid) {
    if (!isObject(input)) invalid('An attempt is { actor, skill, form, kind, key }.');
    const { actor, skill, form, kind, key } = input;
    if (!isActorId(actor) || !isDefId(skill) || !isDefId(form) || !KINDS.includes(kind) || typeof key !== 'string' || !key || key.length > 120) {
        invalid('An attempt names an actor, a skill, a form, its kind (combat, narrative or training) and a key.');
    }
    const cost = input.cost ?? null;
    const session = input.session ?? null;
    const minute = input.minute ?? null;
    if (!(cost === null || (typeof cost === 'string' && cost && cost.length <= 120)) || !(session === null || (typeof session === 'string' && session && session.length <= 120)) || !(minute === null || Number.isSafeInteger(minute))) {
        invalid('An attempt\'s cost and session are text, its minute a whole minute.');
    }
    const capSource = input.capSource ?? source;
    if (!isObject(capSource) || !isRecordId(capSource.sid) || !isRecordId(capSource.swipeKey) || !isRecordId(capSource.evidence)) invalid('An attempt\'s boundary is a Source.');
    return { id: idFromHash('at', hash({ kind, key })), record: { actor, skill, form, kind, source: whole(source), capSource: whole(capSource), cost, session, minute } };
}

/**
 * A fight's paid uses (contract B3/B5: "No permanent mastery at act; combat.end alone awards it"): what combat.end calls once
 * the fight's end is confirmed, in the end settlement's own transaction (it carries the guard that binds the terminal prefix).
 * `uses`: [{ actor, skill, form, count }] counted from the fight's recorded actions; each use is an attempt of kind combat
 * named by the fight, the character, the skill and its number, so settling the same end again records nothing twice.
 * The end settlement is the cap source (the default: this reply). → { ids: [attempt id], created: n }.
 */
export function recordCombatUses(ctx, { fight, uses } = {}) {
    // The end of a fight never fails on its ledger: an unpinned chat has none (a no-op), and a row that cannot be an attempt is skipped.
    const ids = [];
    let created = 0;
    if (typeof fight !== 'string' || !fight || !Array.isArray(uses) || !ctx.source) return { ids, created };
    const ix = indexOf(pinOf({ domains: { rules: ctx.read('rules') } }));
    if (!ix) return { ids, created };
    for (const item of uses) {
        if (!isObject(item) || !Number.isSafeInteger(item.count) || item.count < 1 || item.count > 1000) continue;
        if (!isActorId(item.actor) || ix.form(item.form)?.skill !== item.skill) continue;
        for (let n = 1; n <= item.count; n += 1) {
            const made = recordAttempt(ctx, { actor: item.actor, skill: item.skill, form: item.form, kind: 'combat', key: `${fight}:${item.actor}:${item.skill}:${n}`, cost: fight });
            ids.push(made.id);
            if (made.created) created += 1;
        }
    }
    return { ids, created };
}
