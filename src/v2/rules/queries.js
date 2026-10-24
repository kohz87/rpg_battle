// RPG Battle v2, the read-only queries of the rules part that a screen needs beside rules.progress (lead decisions
// on track C's gaps; the contract §3 names none of them). All read the pinned ruleset; none writes or assigns an id.
// A chat that pins no rules answers null, [] or {} (a legacy chat is left alone).
//
//   rules.identity({})            → { hash, packId, version } | null     the rules hash class.choose and path.choose carry
//   rules.classes({ tier? })      → [{ id, name, tier, parent, skills: [Ref, Ref, Ref] }]   the pack's classes, in its order
//   rules.names({ refs })         → { [Ref]: name }                      class, skill and form names; unknown refs left out
//   rules.party({})               → PartyView | null                     active (PC + 2), reserve, temporary sheets (sheet.js)
//   rules.training({ actor })     → { actor, session, caps, offers } | null   the training clock's side of the screen:
//       session  null (no sessions exist before the training package),
//       caps     { day (the story day now, null without a clock), actor: { used, max }, skill: { used, max } (the busiest of the
//                actor's three skills today), skills: { [Ref]: { used, max } } } : credits earned today against the pinned caps,
//       offers   [] (a trainer's offer needs the current place from Story Director, the fee from Story Block and a session id
//                that the host allocates: all of that is the training package's).

import { indexOfState } from './graph.js';
import { memberOf } from '../progress/assess.js';
import { deriveActor, choicesOf } from '../progress/derive.js';
import { rowsOf } from '../progress/credit.js';
import { readClock, dayOf } from '../training/clock.js';
import { isActorId, isObject } from './ids.js';
import { pinOf } from './pin.js';
import { partyView } from './sheet.js';

const noArgs = args => args === undefined || args === null || (isObject(args) && Object.keys(args).length === 0);

export function rulesIdentity(state, args) {
    if (!noArgs(args)) return null;
    const pin = pinOf(state);
    return pin ? { hash: pin.rulesHash, packId: pin.identity.packKey, version: pin.identity.packVersion } : null;
}

export function rulesClasses(state, args) {
    const ix = indexOfState(state);
    if (!ix || (args !== undefined && args !== null && (!isObject(args) || Object.keys(args).some(key => key !== 'tier') || (args.tier !== undefined && !Number.isInteger(args.tier))))) return [];
    return [...ix.classes.values()]
        .filter(entry => args?.tier === undefined || entry.tier === args.tier)
        .map(({ id, name, tier, parent, skills }) => ({ id, name, tier, parent, skills: [...skills] }));
}

export function rulesNames(state, args) {
    const ix = indexOfState(state);
    if (!ix || !isObject(args) || !Array.isArray(args.refs)) return {};
    const out = {};
    for (const ref of args.refs.slice(0, 500)) {
        if (typeof ref !== 'string') continue;
        const found = ix.class(ref) ?? ix.skill(ref) ?? ix.form(ref);
        if (found && typeof found.name === 'string') out[ref] = found.name;
    }
    return out;
}

export function rulesTraining(state, args, tools) {
    const ix = indexOfState(state);
    if (!ix || !isObject(args) || Object.keys(args).some(key => key !== 'actor') || !isActorId(args.actor)) return null;
    if (!memberOf(tools?.query, args.actor)) return null;
    const progress = state?.domains?.progress ?? {};
    const derived = deriveActor(ix, choicesOf(progress, args.actor));
    if (derived.class === null) return null;
    const minute = readClock(tools?.query);
    const day = minute === null ? null : dayOf(minute, ix.constants.clockMinutesPerDay);
    const skills = {};
    let actorUsed = 0;
    for (const { skill } of derived.skills) skills[skill] = { used: 0, max: ix.constants.usePerSkillDay };
    if (day !== null) {
        for (const { attempt, credit } of rowsOf(progress)) {
            if (attempt.actor !== args.actor || credit.award < 1 || credit.day !== day) continue;
            actorUsed += 1;
            if (skills[attempt.skill]) skills[attempt.skill].used += 1;
        }
    }
    const busiest = Object.values(skills).reduce((top, item) => (item.used > top.used ? item : top), { used: 0, max: ix.constants.usePerSkillDay });
    return { actor: args.actor, session: null, caps: { day, actor: { used: actorUsed, max: ix.constants.usePerActorDay }, skill: { ...busiest }, skills }, offers: [] };
}

/** rules.party({}) → PartyView: the active, reserve and temporary sheets, or null without a pinned ruleset. */
export function rulesParty(state, args, tools) {
    if (!noArgs(args)) return null;
    return partyView(indexOfState(state), state, tools?.query);
}

export const queries = { 'rules.party': rulesParty, 'rules.identity': rulesIdentity, 'rules.classes': rulesClasses, 'rules.names': rulesNames, 'rules.training': rulesTraining };
