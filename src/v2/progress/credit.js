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
//   * the skill already earned usePerSkillReply credits on the reply that settles it ("skill-reply"),
//   * the character already earned usePerActorReply credits on it ("actor-reply"),
//   * the skill already earned usePerSkillDay on that story day ("skill-day"), or the character
//     usePerActorDay ("actor-day").
//
// The skill caps count a skill across all its forms and classes; the actor caps count every skill, so a new
// form or class cannot reset them. Combat, narrative and training attempts share them. The day is the day of
// the attempt's own minute (a training session records its completion minute) or, without one, the clock when
// the settlement runs. An attempt with neither is **held**, not zeroed: time is never taken from a wall clock, an unset clock
// (or a dormant Story Director) holds only the actions that depend on it (contract §4 "unset time holds only dependent actions",
// §3 CLOCK_UNSET), so it stays pending, with no row and no claim, and earns when a clock is set. The reasons are checked in the
// order above, and the first that applies is recorded.
// Pure: the pinned constants and the progress slice in, decisions out.

import { isMastered } from './mastery.js';
import { dayOf } from '../training/clock.js';
import { isObject } from '../rules/ids.js';

export const KINDS = Object.freeze(['combat', 'narrative', 'training']);
export const REASONS = Object.freeze(['mastered', 'skill-reply', 'actor-reply', 'skill-day', 'actor-day']);

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

/**
 * The counts the caps and the masteries are read from, built from the surviving credits and the **sealed** counts (the credited
 * uses of attempts folded away, fold.js): `sealed` = { forms: { "<actor>|<form>": n }, days: { "<actor>|<skill>|<day>": n } }.
 */
export function tallyOf(rows, sealed = null) {
    const tally = { formUses: new Map(), skillReply: new Map(), actorReply: new Map(), skillDay: new Map(), actorDay: new Map() };
    for (const { attempt, credit } of rows) note(tally, attempt, credit);
    if (isObject(sealed)) {
        for (const [key, n] of Object.entries(sealed.forms ?? {})) tally.formUses.set(key, (tally.formUses.get(key) ?? 0) + n);
        for (const [key, n] of Object.entries(sealed.days ?? {})) {
            tally.skillDay.set(key, (tally.skillDay.get(key) ?? 0) + n);
            const cut = key.lastIndexOf('|');
            const actorDay = `${key.slice(0, key.indexOf('|'))}|${key.slice(cut + 1)}`;
            tally.actorDay.set(actorDay, (tally.actorDay.get(actorDay) ?? 0) + n);
        }
    }
    return tally;
}

/** The tally of a progress slice: its surviving credits and its sealed counts. */
export const tallyOfProgress = progress => tallyOf(rowsOf(progress), progress?.sealed);

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
 * absolute story minute it counts on (a whole minute: an attempt with none is held by planSettlement and never asked here),
 * `reply` the canonical sid of the reply whose boundary settles it (attempt.capSource.sid).
 */
export function decide(constants, tally, attempt, minute) {
    const day = dayOf(minute, constants.clockMinutesPerDay);
    const reply = attempt.capSource.sid;
    const out = (award, reason) => ({ award, reason, minute, day, reply });
    const { actor, skill, form } = attempt;
    if (isMastered(usesOf(tally, actor, form), constants.masteryAt)) return out(0, 'mastered');
    if ((tally.skillReply.get(`${actor}|${skill}|${reply}`) ?? 0) >= constants.usePerSkillReply) return out(0, 'skill-reply');
    if ((tally.actorReply.get(`${actor}|${reply}`) ?? 0) >= constants.usePerActorReply) return out(0, 'actor-reply');
    if ((tally.skillDay.get(`${actor}|${skill}|${day}`) ?? 0) >= constants.usePerSkillDay) return out(0, 'skill-day');
    if ((tally.actorDay.get(`${actor}|${day}`) ?? 0) >= constants.usePerActorDay) return out(0, 'actor-day');
    return out(1, null);
}

/**
 * The credits a settlement gives every attempt that has none, one after the other (each sees the ones before
 * it): [{ id, award, reason, minute, day, reply }]. `clock`: the absolute minute now, or null. An attempt with no minute of its
 * own while there is no clock is left out (held: still pending, no credit, no claim).
 */
export function planSettlement(constants, progress, clock) {
    const tally = tallyOfProgress(progress);
    const plan = [];
    for (const { id, attempt } of pendingOf(progress)) {
        const minute = Number.isSafeInteger(attempt.minute) ? attempt.minute : clock;
        if (!Number.isSafeInteger(minute)) continue;
        const credit = decide(constants, tally, attempt, minute);
        note(tally, attempt, credit);
        plan.push({ id, ...credit });
    }
    return plan;
}
