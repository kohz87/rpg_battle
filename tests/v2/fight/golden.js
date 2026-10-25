// Scripted fights on the v1 engine under the full rules (variance, crits, hits that miss), used to hold the engine to its old
// behaviour byte for byte: the traces below were recorded from src/combat.js before track B added anything to it.
import { DEFAULT_RULES, makeRules } from '../../../src/rules.js';
import { DEFAULT_SKILLS, resolveSkills } from '../../../src/skills.js';
import { act, replay, startFight, summarize } from '../../../src/combat.js';
import { hashJson } from '../../../src/v2/rules/hash.js';

const skills = names => resolveSkills(names, DEFAULT_SKILLS, 3).map(s => ({ ...s, cooldownLeft: 0 }));

export const hero = (over = {}) => ({
    id: 'pc', memberId: 'pc', name: 'Ren', side: 'party', controller: 'player', level: 3, rank: null, role: null, boss: false,
    stats: { STR: 10, VIT: 8, AGI: 8, DEX: 8, INT: 8, LUK: 5, CHA: 8 }, hp: { cur: 160, max: 160 }, mp: { cur: 50, max: 50 }, sp: { cur: 20, max: 20 },
    patk: 20, matk: 16, pdef: 8, mdef: 8, crit: 10, skills: skills(['Power Strike', 'Poison Dart', 'Firebolt', 'Ward']),
    items: [], conditions: [], morale: 0, talks: false, fleesBelow: 0, xp: 0, loot: null, gone: null, ...over,
});
export const friend = (over = {}) => ({ ...hero({ id: 'ally', memberId: 'ally', name: 'Mira', controller: 'auto', skills: skills(['Power Strike', 'Ward']) }), ...over });
export const foe = (id, over = {}) => ({
    id, name: 'Wolf', side: 'enemy', controller: 'auto', level: 2, rank: 'F', role: 'brute', boss: false,
    stats: { STR: 7, VIT: 6, AGI: 6, DEX: 7, INT: 4, LUK: 5, CHA: 4 }, hp: { cur: 240, max: 240 }, mp: { cur: 10, max: 10 },
    patk: 12, matk: 6, pdef: 2, mdef: 1, crit: 5, skills: [], items: [], conditions: [], morale: 3, talks: true, fleesBelow: 0.2,
    xp: 20, loot: 'goblin', gone: null, memberId: null, ...over,
});

export const SCRIPT = [
    { type: 'skill', skill: 'Power Strike', target: 'e1' }, { type: 'attack', target: 'e1' }, { type: 'skill', skill: 'Poison Dart', target: 'e2' },
    { type: 'defend' }, { type: 'skill', skill: 'Firebolt', target: 'e2' }, { type: 'parley', target: 'e1' }, { type: 'attack', target: 'e2' },
    { type: 'skill', skill: 'Ward', target: 'pc' }, { type: 'attack', target: 'e1' }, { type: 'attack', target: 'e2' }, { type: 'skill', skill: 'Power Strike', target: 'e2' }, { type: 'flee' }, { type: 'auto' },
];

/** The fight played with SCRIPT as far as it goes: the log, the rng state and the summary, hashed. */
export function trace(seed, setupOver = {}, rules = DEFAULT_RULES) {
    const setup = { id: `f-${seed}`, seed, party: [hero(), friend()], enemies: [foe('e1'), foe('e2', { name: 'Boar' })], stakes: 'normal', ...setupOver };
    const actions = [];
    let f = startFight({ ...setup, rules });
    for (const action of SCRIPT) {
        if (f.status !== 'active') break;
        try { f = act(f, action, rules); actions.push(action); } catch { /* an action the moment does not allow is skipped */ }
    }
    const again = replay({ setup, actions }, rules);
    return { hash: hashJson({ log: f.log, rngState: f.rngState, status: f.status, combatants: f.combatants.map(c => [c.id, c.hp.cur, c.mp.cur, c.conditions]), summary: f.status === 'active' ? null : summarize(f, rules) }), replayed: hashJson(again.log) === hashJson(f.log), rounds: f.round, status: f.status, steps: actions.length };
}

export const VARIANTS = {
    plain: {},
    timeline: { turns: 'timeline' },
    daze: { stunRule: 'daze', hitRule: 'relative', spellRule: 'roll' },
    rounds: { turns: 'rounds', speedOffset: 4 },
};
export { makeRules };
