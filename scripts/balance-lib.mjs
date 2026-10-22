// The balance simulation's engine (scripts/balance-sim.mjs runs it, tests/v2/qa/balance-*.test.js
// read it): one fight from an encounter's words to its end, played on auto, through v2's own
// encounter → offer → setup code (readEncounter, buildSetup) and v1's engine (startFight, act), with
// no bus in between. A fight here is the same fight combat.start makes for the same setup seed
// (tests/v2/qa/balance-tiers.test.js checks it against the QA harness), about ten times faster.
//
// The hero is a standard character of a creation preset: made by party.create through the QA
// harness, raised to a level with v1's own gainXp and spendPoints, its points spent in the preset's
// proportions, its skills at a mastery that fits the level (masteryAt). No gear, no items: a tier
// is calibrated against the character alone (skewed builds and good gear may do better or worse).
//
// The creatures: the bestiary's, the Ersveil pack's (as a chat's bestiary keeps them, cleaned by
// templates.cleanCreature) and two names nobody wrote up (made up per fight, as combat.start does).

import { withHero, patch } from '../tests/v2/qa/helpers/harness.js';
import { ERSVEIL_CREATURES } from '../tests/v2/qa/helpers/ersveil-creatures.js';
import { PRESETS } from '../src/skills.js';
import { DEFAULT_RULES, xpToNext } from '../src/rules.js';
import { gainXp } from '../src/growth.js';
import { spendPoints } from '../src/sheet.js';
import { DEFAULT_BESTIARY } from '../src/enemies.js';
import { cleanCreature, combinedBestiary } from '../src/templates.js';
import { startFight, actInPlace } from '../src/combat.js';
import { fromSheet, toSheet } from '../src/v2/party/sheets.js';
import { readEncounter } from '../src/v2/combat/encounter.js';
import { buildSetup, fightNumbers, partyCombatants } from '../src/v2/combat/setup.js';
import { fightRules } from '../src/v2/combat/stored.js';

export const TARGETS = Object.freeze({ trivial: [98, 100], weak: [90, 100], even: [50, 75], strong: [20, 50], deadly: [0, 19.99] });
export const TIERS = Object.freeze(['trivial', 'weak', 'even', 'strong', 'deadly']);
export const PRESET_IDS = Object.freeze(PRESETS.map(preset => preset.id));
export const LEVELS = Object.freeze([1, 5, 10, 20, 40, 60]);
// Headcounts per tier: every count is fought (past the field setting, in waves: setup.planWaves).
export const COUNTS = Object.freeze({ trivial: [1, 2, 3, 4, 6, 9], weak: [1, 2, 3, 4, 6, 9], even: [1, 2, 3, 4, 6, 9], strong: [1, 2, 3, 4, 6, 9], deadly: [1, 2, 3, 4, 6, 9] });

/** The Ersveil pack's creatures as a chat's bestiary keeps them (v1 list). */
export const PACK_BESTIARY = Object.freeze(ERSVEIL_CREATURES.map(entry => cleanCreature(entry)).filter(Boolean));
/** Creature sets: { set, name, chat } (chat: the chat's own bestiary the fight runs with). */
export const CREATURES = Object.freeze([
    ...DEFAULT_BESTIARY.map(entry => ({ set: 'bestiary', name: entry.name, chat: [] })),
    ...PACK_BESTIARY.map(entry => ({ set: 'ersveil', name: entry.name, chat: PACK_BESTIARY })),
    ...['Marsh Ghoul', 'Cellar Rat Swarm'].map(name => ({ set: 'made', name, chat: [] })),
]);

/** The mastery a standard character's skills have at `level`: 1, 2 from 5, 3 from 10, 4 from 20, 5 from 40. */
export const masteryAt = level => (level >= 40 ? 5 : level >= 20 ? 4 : level >= 10 ? 3 : level >= 5 ? 2 : 1);

/** Your character raised to `level` by v1's rules, points spent like the preset, skills at masteryAt (test setup only). */
export function levelUp(h, preset, level) {
    patch(h, state => {
        const party = state.domains.party;
        const actor = party.actors[party.pc];
        let xp = 0;
        for (let lv = 1; lv < level; lv += 1) xp += xpToNext(lv, DEFAULT_RULES);
        let sheet = gainXp(toSheet(actor), xp, DEFAULT_RULES).sheet;
        const points = PRESETS.find(entry => entry.id === preset).points;
        const total = Object.values(points).reduce((a, b) => a + b, 0);
        const keys = Object.keys(points);
        let left = sheet.points;
        const allocation = {};
        const room = key => DEFAULT_RULES.character.statCap - sheet.stats[key];
        keys.forEach((key, index) => {
            const n = Math.min(room(key), index === keys.length - 1 ? left : Math.floor(sheet.points * points[key] / total));
            allocation[key] = n;
            left -= n;
        });
        // A stat at the cap (99) passes what it cannot take to the others, in the preset's order, then VIT.
        for (const key of [...keys, 'VIT', 'AGI', 'DEX', 'LUK', 'CHA']) {
            const more = Math.min(left, room(key) - (allocation[key] ?? 0));
            if (more > 0) { allocation[key] = (allocation[key] ?? 0) + more; left -= more; }
        }
        sheet = spendPoints(sheet, allocation, DEFAULT_RULES);
        sheet.skills = sheet.skills.map(skill => ({ ...skill, mastery: masteryAt(level) }));
        sheet.hp = { ...sheet.hp, cur: sheet.hp.max };
        sheet.mp = { ...sheet.mp, cur: sheet.mp.max };
        party.actors[party.pc] = fromSheet(actor, sheet, DEFAULT_RULES);
        party.actors[party.pc].sp = { ...party.actors[party.pc].sp, cur: party.actors[party.pc].sp.max };
    });
}

const heroes = new Map();
/** The fight's party for a standard character of `preset` at `level` (made once, then copied). */
export function heroParty(preset, level = 1) {
    const key = `${preset}:${level}`;
    if (!heroes.has(key)) {
        const { h } = withHero({ seed: 1, preset });
        if (level > 1) levelUp(h, preset, level);
        const ctx = { query: (name, args) => h.query(name, args), read: domain => h.state().domains[domain] ?? null };
        heroes.set(key, partyCombatants(ctx, { rules: fightRules(fightNumbers({})) }));
    }
    return structuredClone(heroes.get(key));
}

/**
 * One fight on auto, as combat.start and combat.act({ auto }) play it: 'won', 'lost', 'fled' or
 * 'refused' (the words are no encounter). `party` from heroParty; `chat` the chat's bestiary.
 */
export function directFight({ words, tier, seed, party, chat = [], stakes = 'normal', shifts, settings = {} }) {
    const bestiary = combinedBestiary(chat, DEFAULT_BESTIARY);
    const read = readEncounter({ op: '!', kind: 'encounter', name: words, text: '', labels: { tier } }, { bestiary });
    if (!read.ok) return 'refused';
    const numbers = fightNumbers(settings);
    let built;
    try {
        built = buildSetup({ id: 'fi_00000001', seed, offer: { foes: read.foes, stakes }, party, chatBestiary: chat, numbers, ...(shifts ? { shifts } : {}) });
    } catch {
        return 'refused';
    }
    const rules = fightRules(built.setup);
    const f = startFight({ ...built.setup, rules });
    if (f.status === 'active') actInPlace(f, { type: 'auto' }, rules);
    return f.status === 'victory' ? 'won' : f.status === 'defeat' ? 'lost' : f.status;
}

/** A LEVEL_SHIFT-shaped table with `value` everywhere (the calibration tries one value at a time). */
export function flatShifts(value) {
    const row = Array(6).fill(value);
    return Object.fromEntries(TIERS.map(tier => [tier, LEVELS.map(() => row)]));
}

/** Win rate in % of a cell: `seeds` fights from seed `first` (`shift`: one LEVEL_SHIFT value to try instead of the table). */
export function cellRate({ creature, count, tier, preset, level = 1, seeds = 200, first = 1000, shift = null, settings = {} }) {
    const base = heroParty(preset, level);
    const shifts = shift === null || shift === undefined ? undefined : flatShifts(shift);
    let won = 0;
    for (let seed = first; seed < first + seeds; seed += 1) {
        if (directFight({ words: `${count} ${creature.name}`, tier, seed, party: structuredClone(base), chat: creature.chat, shifts, settings }) === 'won') won += 1;
    }
    return won / seeds * 100;
}

/** Whether a win rate is on the tier's target. */
export const onTarget = (tier, rate) => rate >= TARGETS[tier][0] && rate <= TARGETS[tier][1];

/** Every cell of the calibration matrix: { tier, level, count, preset, creature } (filters optional). */
export function cells({ tiers = TIERS, levels = LEVELS, presets = PRESET_IDS, creatures = CREATURES, counts = null } = {}) {
    const out = [];
    for (const tier of tiers) {
        for (const level of levels) {
            for (const count of counts ?? COUNTS[tier]) {
                if (!COUNTS[tier].includes(count)) continue;
                for (const preset of presets) for (const creature of creatures) out.push({ tier, level, count, preset, creature });
            }
        }
    }
    return out;
}
