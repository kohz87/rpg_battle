// The party part's queries (MODULES §B1): read-only, plain copies of the head state's party
// slice, and an actor's fight numbers with the gear they wear (Story Block's inventory domain,
// SPEC §7: the stacks they own that are equipped). `(state, args, tools)` per SPEC §6 and MODULES §F3. Pure.

import { combatNumbers, combatantFromSheet } from '../../party.js';
import { gearOf, rulesFrom, toSheet } from './sheets.js';
import { actorsInOrder, plainCopy, resolveName } from './util.js';

/**
 * A member's record with its `portrait` (MODULES §F11): the one kept on the record (your
 * character's persona avatar, given at creation), else for a companion who is an NPC the one NSD
 * has (`npc.portrait({ name })` through the query tools, when NSD is there), else null.
 */
function withPortrait(record, tools) {
    if (!record) return null;
    let portrait = record.portrait ?? null;
    if (!portrait && record.npc && typeof tools?.query === 'function') {
        try {
            const found = tools.query('npc.portrait', { name: record.npc });
            portrait = typeof found === 'string' && found ? found : null;
        } catch {
            portrait = null;
        }
    }
    return { ...record, portrait };
}

const partyOf = state => state?.domains?.party ?? { pc: null, order: [], actors: {}, custom: {}, offers: [] };

/** Every member, in display order (your character first). */
export function actors(state, args = {}, tools = null) {
    return plainCopy(actorsInOrder(partyOf(state)).map(record => withPortrait(record, tools)));
}

/** One member by `id`, or by a written `name` (v1 findTarget: full name, then first name; "you" is your character); null when none. */
export function actor(state, args = {}, tools = null) {
    const party = partyOf(state);
    if (args?.id) return plainCopy(withPortrait(party.actors?.[args.id] ?? null, tools));
    if (args?.name) return plainCopy(withPortrait(resolveName(party, args.name).actor ?? null, tools));
    return null;
}

/** Your character, or null before one is made. */
export function pc(state, args = {}, tools = null) {
    const party = partyOf(state);
    return plainCopy(withPortrait(party.pc ? party.actors?.[party.pc] ?? null : null, tools));
}

/** The join and skill offers waiting for the reader, oldest first. */
export function offers(state) {
    return plainCopy(partyOf(state).offers ?? []);
}

/**
 * A member's fight numbers with their equipped gear (v1 party.combatNumbers: attack, magic,
 * defence, mdef, crit, hit, dodge, stats with gear) and their HP/MP/SP maxima with it, plus the
 * gear counted. `args.settings` (the module's settings) when the caller has them. null for an
 * unknown id.
 */
export function combatNumbersOf(state, args = {}) {
    const party = partyOf(state);
    const member = party.actors?.[args?.id];
    if (!member) return null;
    const rules = rulesFrom(args?.settings ?? null);
    const gear = gearOf(state?.domains?.inventory, member.id, { pc: party.pc });
    const sheet = toSheet(member);
    const numbers = combatNumbers(sheet, { gear, rules });
    const fighter = combatantFromSheet({ ...sheet, skills: [] }, { gear, rules });
    return plainCopy({ ...numbers, hp: fighter.hp, mp: fighter.mp, sp: fighter.sp, gear: gear.map(item => item.name) });
}

export const queries = {
    'party.actors': actors,
    'party.actor': actor,
    'party.pc': pc,
    'party.offers': offers,
    'party.combatNumbers': combatNumbersOf,
};
