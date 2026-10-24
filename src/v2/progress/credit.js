// RPG Battle v2, use credits and their caps (contract §4 Constants, §5 "Use / training (P03)", B3 "caps",
// B5 "Narrative uses"). A paid use of a skill is an **attempt** (recorded by whatever paid for it: a fight's
// end settlement, a narrative use, a finished training session); the **credit** is what rules.settle decides
// for it: 1 use or 0, with the reason for a 0.
//
//   progress.attempts[<attempt id>] = { actor, skill, form, kind, source, capSource, cost, session, minute }
//   progress.credits[<attempt id>]  = { award: 0 | 1, reason, minute, day, reply }
//
// Every paid attempt stays, whatever it earned: a form's mastery and every cap are *derived* from the
// attempts and credits that survive (a deleted use takes its credit with it; nothing is cached). One use
// earns at most one credit, and none when
//
//   * the form is at the top step ("mastered": uses never pass the cap; XP is not touched here),
//   * the clock is not set ("clock": time is never taken from a wall clock; the day caps need the day),
//   * the skill already earned usePerSkillReply credits on the reply that settles it ("skill-reply"),
//   * the character already earned usePerActorReply credits on it ("actor-reply"),
//   * the skill already earned usePerSkillDay on that story day ("skill-day"), or the character
//     usePerActorDay ("actor-day").
//
// The skill caps count a skill across all its forms and classes; the actor caps count every skill, so a new
// form or class cannot reset them. Combat, narrative and training attempts share them. The day is the day of
// the attempt's own minute (a training session records its completion minute) or, without one, the clock when
// the settlement runs. The reasons are checked in the order above, and the first that applies is recorded.
// Pure: the pinned constants and the progress slice in, decisions out.

import { isMastered } from './mastery.js';
import { dayOf } from '../training/clock.js';

export const KINDS = Object.freeze(['combat', 'narrative', 'training']);
export const REASONS = Object.freeze(['mastered', 'clock', 'skill-reply', 'actor-reply', 'skill-day', 'actor-day']);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The attempts that have a credit, as rows { id, attempt, credit }. */
export function rowsOf(progress) {
    const attempts = isObject(progress?.attempts) ? progress.attempts : {};
    const credits = isObject(progress?.credits) ? progress.credits : {};
    const rows = [];
    for (const [id, credit] of Object.entries(credits)) if (isObject(attempts[id]) && isObject(credit)) rows.push({ id, attempt: attempts[id], credit });
    return rows;
}

/** The attempts with no credit yet, as { id, attempt }, in a fixed order (by id: a record's position is not something a replay keeps). */
export function pendingOf(progress) {
    const attempts = isObject(progress?.attempts) ? progress.attempts : {};
    const credits = isObject(progress?.credits) ? progress.credits : {};
    const open = Object.entries(attempts).filter(([id, attempt]) => isObject(attempt) && !Object.hasOwn(credits, id)).map(([id, attempt]) => ({ id, attempt }));
    return open.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

/** The counts the caps and the masteries are read from, built from the surviving credits. */
export function tallyOf(rows) {
    const tally = { formUses: new Map(), skillReply: new Map(), actorReply: new Map(), skillDay: new Map(), actorDay: new Map() };
    for (const { attempt, credit } of rows) note(tally, attempt, credit);
    return tally;
}

/** Counts one credit (a 0 counts nothing). */
export function note(tally, attempt, credit) {
    if (!credit || credit.award < 1) return;
    const { actor, skill, form } = attempt;
    bump(tally.formUses, `${actor}|${form}`);
    bump(tally.skillReply, `${actor}|${skill}|${credit.reply}`);
    bump(tally.actorReply, `${actor}|${credit.reply}`);
    if (Number.isInteger(credit.day)) {
        bump(tally.skillDay, `${actor}|${skill}|${credit.day}`);
        bump(tally.actorDay, `${actor}|${credit.day}`);
    }
}

/** A form's credited uses for an actor (0…the top step). */
export const usesOf = (tally, actor, form) => tally.formUses.get(`${actor}|${form}`) ?? 0;

/**
 * What an attempt earns given the counts so far: { award, reason, minute, day, reply }. `minute` is the
 * absolute story minute it counts on (null with no clock), `reply` the canonical sid of the reply whose
 * boundary settles it (attempt.capSource.sid).
 */
export function decide(constants, tally, attempt, minute) {
    const known = Number.isSafeInteger(minute);
    const day = known ? dayOf(minute, constants.clockMinutesPerDay) : null;
    const reply = attempt.capSource.sid;
    const out = (award, reason) => ({ award, reason, minute: known ? minute : null, day, reply });
    const { actor, skill, form } = attempt;
    if (isMastered(usesOf(tally, actor, form), constants.masteryAt)) return out(0, 'mastered');
    if (!known) return out(0, 'clock');
    if ((tally.skillReply.get(`${actor}|${skill}|${reply}`) ?? 0) >= constants.usePerSkillReply) return out(0, 'skill-reply');
    if ((tally.actorReply.get(`${actor}|${reply}`) ?? 0) >= constants.usePerActorReply) return out(0, 'actor-reply');
    if ((tally.skillDay.get(`${actor}|${skill}|${day}`) ?? 0) >= constants.usePerSkillDay) return out(0, 'skill-day');
    if ((tally.actorDay.get(`${actor}|${day}`) ?? 0) >= constants.usePerActorDay) return out(0, 'actor-day');
    return out(1, null);
}

/**
 * The credits a settlement gives every attempt that has none, one after the other (each sees the ones before
 * it): [{ id, award, reason, minute, day, reply }]. `clock`: the absolute minute now, or null.
 */
export function planSettlement(constants, progress, clock) {
    const tally = tallyOf(rowsOf(progress));
    const plan = [];
    for (const { id, attempt } of pendingOf(progress)) {
        const credit = decide(constants, tally, attempt, Number.isSafeInteger(attempt.minute) ? attempt.minute : clock);
        note(tally, attempt, credit);
        plan.push({ id, ...credit });
    }
    return plan;
}
