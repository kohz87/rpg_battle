// RPG Battle v2, the read-only queries of the rules part that a screen needs beside rules.progress (lead decisions
// on track C's gaps; the contract §3 names none of them). All read the pinned ruleset; none writes or assigns an id.
// A chat that pins no rules answers null, [] or {} (a legacy chat is left alone).
//
//   rules.identity({})            → { hash, packId, version } | null     the rules hash class.choose and path.choose carry
//   rules.classes({ tier? })      → [{ id, name, tier, parent, skills: [Ref, Ref, Ref] }]   the pack's classes, in its order
//   rules.names({ refs })         → { [Ref]: name }                      class, skill and form names; unknown refs left out
//   rules.party({})               → PartyView | null                     active (PC + 2), reserve, temporary sheets (sheet.js)
//   rules.training({ actor })     → see ../training/queries.js (the training section of a character's screen)

import { indexOfState } from './graph.js';
import { isObject } from './ids.js';
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

/** rules.party({}) → PartyView: the active, reserve and temporary sheets, or null without a pinned ruleset. */
export function rulesParty(state, args, tools) {
    if (!noArgs(args)) return null;
    return partyView(indexOfState(state), state, tools?.query);
}

export const queries = { 'rules.party': rulesParty, 'rules.identity': rulesIdentity, 'rules.classes': rulesClasses, 'rules.names': rulesNames };
