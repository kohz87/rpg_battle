// The checks part's queries (MODULES §F16): the waiting checks, the last results, and what of a
// member's own could fit a waiting check (checks.suggest). Suggestions are only that: words the
// check and a skill, ability or item have in common; the reader decides what counts and by how
// much. Members and items come through the party and inventory queries (MODULES §F3 tools);
// the words of a skill's description and of an item's definition are read from the state as it
// is (party.custom, inventory.defs), since no query gives one definition. Pure.

import { DEFAULT_SKILLS, findSkill } from '../../skills.js';
import { abilitiesOf, carriedBy } from './commands.js';
import { nameKey, shared, stems } from './shared.js';

const copy = value => JSON.parse(JSON.stringify(value ?? null));
const checksOf = state => state?.domains?.checks ?? { pending: [], log: [] };

/** A query through the host's tools, null when it is not registered or fails. */
function asker(tools) {
    return (name, args) => {
        if (typeof tools?.query !== 'function') return null;
        try {
            return tools.query(name, args);
        } catch {
            return null;
        }
    };
}

/** The checks waiting for a roll, oldest first. */
export function pending(state) {
    return copy(checksOf(state).pending);
}

/** The last results (up to 30), oldest first. */
export function log(state) {
    return copy(checksOf(state).log);
}

// The skill library a member's skills come from: v1's defaults and the story-taught skills the
// party keeps (read only; there is no query for one skill's definition).
function skillDef(state, name) {
    return findSkill([...DEFAULT_SKILLS, ...Object.values(state?.domains?.party?.custom ?? {})], name);
}

/**
 * checks.suggest({ id }) → [{ source: 'skill'|'ability'|'item', name, words: [stems in common],
 * stack? }]: the member's skills, abilities and carried items that share words with the check
 * (its skill word and what is attempted), most words first. [] for an unknown check.
 */
export function suggest(state, args = {}, tools = null) {
    const check = checksOf(state).pending.find(entry => entry.id === args?.id);
    if (!check) return [];
    const query = asker(tools);
    const actor = query('party.actor', { id: check.actor });
    if (!actor) return [];
    const wanted = stems(check.skill, check.what);
    const taken = new Set(check.modifiers.map(entry => `${entry.source}:${nameKey(entry.reason)}`));
    const out = [];
    const offer = (source, name, words, extra = {}) => {
        if (taken.has(`${source}:${nameKey(name)}`)) return;
        const common = shared(wanted, words);
        if (common.length) out.push({ source, name, words: common, ...extra });
    };
    for (const skill of actor.skills ?? []) {
        const def = skillDef(state, skill.name);
        offer('skill', skill.name, stems(skill.name, def?.description, def?.type, ...(def?.tags ?? [])));
    }
    for (const name of abilitiesOf(actor)) offer('ability', name, stems(name));
    for (const item of carriedBy(query, actor.id)) {
        const def = state?.domains?.inventory?.defs?.[item.def];
        offer('item', item.name, stems(item.name, item.note, item.kind, def?.note, ...(def?.tags ?? [])), { stack: item.stack });
    }
    const rank = { skill: 0, ability: 1, item: 2 };
    return out.sort((a, b) => b.words.length - a.words.length || rank[a.source] - rank[b.source] || a.name.localeCompare(b.name));
}

export const queries = {
    'checks.pending': pending,
    'checks.log': log,
    'checks.suggest': suggest,
};
