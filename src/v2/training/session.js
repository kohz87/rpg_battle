// RPG Battle v2, training sessions as pure data (contract §3 skill.train, §5 "Training start", B3 training): which session
// a request names, who may be asked for what, and what a screen is told. A query cannot allocate an id (contract §3 "No query
// assigns IDs"), so the id of the *next* session of a character with a trainer for a skill in a form is a function of what
// the chat holds: its name is `tr_` plus a 40-bit mix of (character, trainer, skill, form, the rules, how many such sessions
// there already are). The request must carry exactly that id (or it is STALE), so two clicks on one offer are one session and
// the id is the same on every replay. Pure.

import { dayOf } from './clock.js';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

// A 40-bit mix of a text (two 32-bit FNV-style lanes); ids need to differ, not to resist an adversary.
function mix40(text) {
    let a = 0x811c9dc5;
    let b = 0x01000193 ^ 0x9e3779b9;
    for (let i = 0; i < text.length; i += 1) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193) >>> 0;
        b = Math.imul(b + c + (a >>> 7), 0x85ebca6b) >>> 0;
        b ^= b >>> 13;
    }
    return (b & 0xff) * 2 ** 32 + a;
}

const named = (prefix, n) => {
    let out = '';
    let rest = n;
    for (let i = 0; i < 8; i += 1) {
        out = BASE36[rest % 36] + out;
        rest = Math.floor(rest / 36);
    }
    return `${prefix}_${out}`;
};

const same = (s, key) => s.actor === key.actor && s.trainer === key.trainer && s.skill === key.skill && s.form === key.form;

/** The id the next session for `key` ({ actor, trainer, skill, form }) must have, given the sessions the chat holds. */
export function expectedSessionId(sessions, key, rulesHash) {
    const held = Object.values(sessions ?? {});
    let n = held.filter(item => same(item, key)).length;
    for (;;) {
        const id = named('tr', mix40(`${key.actor}|${key.trainer}|${key.skill}|${key.form}|${rulesHash}|${n}`));
        if (!Object.hasOwn(sessions ?? {}, id)) return id;
        n += 1;
    }
}

/** An actor's sessions, oldest first (by the minute they ran, then by id; a request that has not run is last). */
export function sessionsOf(training, actor) {
    const at = s => (Number.isSafeInteger(s.endMinute) ? s.endMinute : Infinity);
    return Object.values(training?.sessions ?? {}).filter(s => s.actor === actor).sort((a, b) => (at(a) - at(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The session waiting for the host (status requested) of an actor, or null. */
export const waitingOf = (training, actor) => sessionsOf(training, actor).find(s => s.status === 'requested') ?? null;

/** The session a screen shows: the one waiting, else the latest that ran or was refused, else null. */
export function currentOf(training, actor) {
    const list = sessionsOf(training, actor);
    return list.find(s => s.status === 'requested') ?? list.at(-1) ?? null;
}

/**
 * A session as the contract's screens read it: { id, status, skill, form, trainer, startMinute, endMinute, fee, credits,
 * creditsAwarded, reason, event, capDay }. `credits`: how many the session gives; `creditsAwarded` / `reason`: from the
 * credits its attempts earned (`reason` of the first that earned nothing, else the refusal's); `capDay`: the day it counts on.
 */
export function sessionView(session, { constants, trainer, progress }) {
    const attempts = Object.entries(progress?.attempts ?? {}).filter(([, item]) => item.session === session.id);
    const credits = attempts.map(([id]) => progress.credits?.[id]).filter(Boolean);
    const zero = credits.find(item => item.award < 1);
    return {
        id: session.id, status: session.status, skill: session.skill, form: session.form, trainer: session.trainer,
        startMinute: session.startMinute, endMinute: session.endMinute, fee: session.fee ?? trainer?.fee ?? 0,
        credits: constants.trainCredits, creditsAwarded: credits.filter(item => item.award > 0).length,
        reason: session.status === 'refused' || session.status === 'interrupted' ? session.reason : zero?.reason ?? null,
        event: session.event ? { die: session.event.die, template: session.event.template } : null,
        capDay: Number.isSafeInteger(session.endMinute) ? dayOf(session.endMinute, constants.clockMinutesPerDay) : null,
    };
}
