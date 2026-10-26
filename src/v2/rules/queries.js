// RPG Battle v2, the read-only queries of the rules part that a screen needs beside rules.progress (lead decisions
// on track C's gaps; the contract §3 names none of them). All read the pinned ruleset; none writes or assigns an id.
// A chat that pins no rules answers null, [] or {} (a legacy chat is left alone).
//
//   rules.identity({})            → { hash, packId, version } | null     the rules hash class.choose and path.choose carry
//   rules.classes({ tier? })      → [{ id, name, tier, parent, skills: [Ref, Ref, Ref] }]   the pack's classes, in its order
//   rules.names({ refs })         → { [Ref]: name }                      class, skill and form names; unknown refs left out
//   rules.party({})               → PartyView | null                     active (PC + 2), reserve, temporary sheets (sheet.js)
//   rules.sheet({ actor? })       → SheetView | null                      the member with class, three skills, gear (sheet.js); your character by default
//   rules.modifier({ actor, stat, skill? }) → RulesModifier | null        what a check of this stat and skill adds for the member (no die, no relationship
//                                                                         bonus): Story Director's checks.roll reads it for a character it is linked to

import { envOfState, findRecipe, planOf, recipes } from '../craft/book.js';
import { indexOfState } from './graph.js';
import { isObject } from './ids.js';
import { pinOf } from './pin.js';
import { ask } from './ask.js';
import { gearOf, partyView, sheetView } from './sheet.js';
import { isActorId } from './ids.js';
import { STATS } from '../../rules.js';
import { memberOf, modifiersFor, rulesFor } from './modifiers.js';

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

/** rules.sheet({ actor? }) -> SheetView | null (your character by default): the party member with its class, three skills and gear. */
export function rulesSheet(state, args, tools) {
    const ix = indexOfState(state);
    if (!ix) return null;
    if (args !== undefined && args !== null && (!isObject(args) || Object.keys(args).some(key => key !== 'actor') || (args.actor !== undefined && !isActorId(args.actor)))) return null;
    const query = tools?.query;
    const id = args?.actor ?? ask(query, 'party.pc', {})?.id ?? null;
    const member = id ? ask(query, 'party.actor', { id }) : null;
    if (!isObject(member)) return null;
    return sheetView(ix, state.domains.progress ?? {}, member, gearOf(query, member.id));
}

/**
 * rules.modifier({ actor, stat, skill? }) -> { actor, stat, amount, parts: [{ source, ref, reason, amount }] } | null (contract §3). The rule is the
 * rules' (modifiers.js): v1's check modifier of the member's **base** stat (gear does not count again), a skill in use whose name falls
 * under the check's topic +2, a talent +1, one item +1 (the extras together at most +3), effects together at most +-3, and the host's burden -2
 * outside the caps. `amount` is the sum of the parts, whole, within -30..30. An unknown actor, a stat that is not one, is null. An unpinned character still supplies the legacy craft/check modifier.
 */
export function rulesModifier(state, args, tools) {
    const ix = indexOfState(state);
    if (!isObject(args) || Object.keys(args).some(key => !['actor', 'stat', 'skill', 'craft'].includes(key)) || !isActorId(args.actor) || !STATS.includes(args.stat)) return null;
    if (args.skill !== undefined && (typeof args.skill !== 'string' || args.skill.length > 80)) return null;
    const query = tools?.query;
    const member = ask(query, 'party.actor', { id: args.actor });
    if (!isObject(member)) return null;
    if (args.craft !== undefined) {
        if (!isObject(args.craft) || Object.keys(args.craft).some(key => !['recipe', 'at'].includes(key)) || typeof args.craft.recipe !== 'string') return null;
        const env = envOfState(state, query);
        const recipe = findRecipe(recipes(env), args.craft.recipe);
        if (!recipe) return null;
        const plan = planOf(env, member, recipe, { made: args.craft.at === 'campfire' ? ['campfire'] : [] });
        const parts = plan.modifiers.map(part => ({ ...part, ref: null }));
        const amount = Math.max(-30, Math.min(30, plan.mod));
        if (amount !== plan.mod) parts.push({ source: 'cap', ref: null, amount: amount - plan.mod, reason: 'held to 30' });
        if (parts.some(part => !Number.isSafeInteger(part.amount) || Math.abs(part.amount) > 30)) return null;
        return { actor: args.actor, stat: args.stat, amount, parts };
    }
    const found = modifiersFor(memberOf(query, member, state?.domains?.inventory?.defs ?? {}), args.skill ?? '', args.stat, rulesFor(null));
    const parts = found.map(part => ({ source: part.source === 'effect' && part.reason === 'Encumbered' ? 'encumbrance' : part.source, ref: null, reason: String(part.reason).slice(0, 120), amount: part.amount }));
    if (ix && ['STR', 'AGI'].includes(args.stat) && member.conditions?.some(c => c.kind === 'injury')) parts.push({ source: 'effect', ref: null, reason: 'Injury', amount: ix.constants.injuryCheckPenalty });
    const amount = parts.reduce((sum, part) => sum + part.amount, 0);
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 30 || parts.some(part => Math.abs(part.amount) > 30)) return null;
    return { actor: args.actor, stat: args.stat, amount, parts };
}

export const queries = { 'rules.sheet': rulesSheet, 'rules.party': rulesParty, 'rules.identity': rulesIdentity, 'rules.classes': rulesClasses, 'rules.names': rulesNames };
