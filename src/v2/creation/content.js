// The choices character creation offers (MODULES §F12, §F14): races and talents, and the packs'
// ready-made characters (presets, with the pack skills they start with). Each record has
// the pack shape (PACKS.md "races, talents": `{ id, name, note, stats, tags }`, nothing else), so a
// pack can replace them one for one. RPG Battle ships a small set of its own, used for a kind when
// no enabled pack gives any records of that kind; with none at all, creation is a name and stat
// points. Pure.
//
// Balance against v1's numbers (every stat starts at 5 and a new character spends 10 points):
// * a race is free and moves stats by a net +2 (two small gains, sometimes a small loss);
// * a talent costs points from the same budget: the net sum of its stat changes, at least 1. A
//   talent never gives more than it costs, so talents are flavour (tags the story and checks can
//   read) and a reshaping of points, not extra power.

import { STATS } from '../../rules.js';
import { cardImage } from './choice-pick.js';

export const STAT_LABELS = Object.freeze({
    STR: 'Strength', VIT: 'Vitality', AGI: 'Agility', DEX: 'Dexterity', INT: 'Intellect', LUK: 'Luck', CHA: 'Charisma',
});

/** The built-in races: original plain fantasy, each net +2. */
export const BUILT_IN_RACES = Object.freeze([
    { id: 'human', name: 'Human', note: 'Quick to learn and quick to make friends; found on every road and in every port.', stats: { STR: 1, CHA: 1 }, tags: ['human'] },
    { id: 'elf', name: 'Elf', note: 'Long-lived and light of step, with sharp eyes and a slight frame.', stats: { DEX: 2, INT: 1, VIT: -1 }, tags: ['elf', 'fey'] },
    { id: 'dwarf', name: 'Dwarf', note: 'Stone-hardy folk of the deep halls: tough, strong and not built for running.', stats: { VIT: 2, STR: 1, AGI: -1 }, tags: ['dwarf'] },
    { id: 'hearthling', name: 'Hearthling', note: 'Small, nimble home-lovers whom fortune seems to like; not much for heavy lifting.', stats: { LUK: 2, AGI: 1, STR: -1 }, tags: ['small'] },
    { id: 'tuskborn', name: 'Tuskborn', note: 'Broad, tusked hill clans who settle arguments by strength more than by study.', stats: { STR: 2, VIT: 1, INT: -1 }, tags: ['tuskborn'] },
    { id: 'starborn', name: 'Starborn', note: 'Pale people said to descend from a fallen star: bright minds in fragile bodies.', stats: { INT: 2, CHA: 1, VIT: -1 }, tags: ['starborn', 'arcane'] },
]);

/** The built-in talents; costs come from talentCost. */
export const BUILT_IN_TALENTS = Object.freeze([
    { id: 'keen-eyes', name: 'Keen Eyes', note: 'You notice the small things: tracks, tells, a loose stone.', stats: { DEX: 1 }, tags: ['perception'] },
    { id: 'iron-gut', name: 'Iron Gut', note: 'Bad water, odd mushrooms and tavern stew rarely bother you.', stats: { VIT: 1 }, tags: ['endurance'] },
    { id: 'silver-tongue', name: 'Silver Tongue', note: 'People tend to believe you, and to like you for it.', stats: { CHA: 2 }, tags: ['social'] },
    { id: 'quick-feet', name: 'Quick Feet', note: 'Fast on your feet, a little light in the arm.', stats: { AGI: 2, STR: -1 }, tags: ['speed'] },
    { id: 'bookish', name: 'Bookish', note: 'Years of reading: much learning, little exercise.', stats: { INT: 2, STR: -1 }, tags: ['lore'] },
    { id: 'lucky-star', name: 'Lucky Star', note: 'Things just tend to go your way.', stats: { LUK: 2 }, tags: ['luck'] },
    { id: 'strong-back', name: 'Strong Back', note: 'You can carry a load all day, if not quickly.', stats: { STR: 2, AGI: -1 }, tags: ['labour'] },
    { id: 'night-owl', name: 'Night Owl', note: 'Most awake when others sleep; at home in the dark.', stats: { DEX: 1, INT: 1, VIT: -1 }, tags: ['dark'] },
    { id: 'wild-heart', name: 'Wild Heart', note: 'Raised outdoors: hardy and quick, ill at ease in polite company.', stats: { VIT: 1, AGI: 1, CHA: -1 }, tags: ['nature'] },
    { id: 'steady-hands', name: 'Steady Hands', note: 'Locks, knots, needles and bowstrings come easily to you.', stats: { DEX: 2 }, tags: ['craft'] },
    { id: 'stubborn', name: 'Stubborn', note: 'Hard to hurt and harder to persuade.', stats: { VIT: 2, CHA: -1 }, tags: ['will'] },
    { id: 'animal-friend', name: 'Animal Friend', note: 'Dogs, horses and birds trust you on sight.', stats: {}, tags: ['animals'] },
]);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * A record's stat changes as creation uses them: the seven stats only (a pack may name others,
 * which creation leaves out), whole numbers, zeros dropped, in STATS order.
 */
export function statChanges(stats) {
    const out = {};
    if (!isRecord(stats)) return out;
    for (const stat of STATS) {
        const value = stats[stat];
        if (Number.isInteger(value) && value !== 0) out[stat] = value;
    }
    return out;
}

/** The points a talent costs: the net sum of its stat changes, at least 1. */
export function talentCost(talent) {
    const net = Object.values(statChanges(talent?.stats)).reduce((sum, value) => sum + value, 0);
    return Math.max(1, net);
}

/** "+2 DEX, +1 INT, −1 VIT", or '' for none. */
export function bonusText(stats) {
    return Object.entries(statChanges(stats)).map(([stat, value]) => `${value > 0 ? '+' : '−'}${Math.abs(value)} ${stat}`).join(', ');
}

// A record as the wizard and the commands use it: the pack fields, cleaned, plus what the screen
// shows (`bonus` text, `cost` for talents, `source`).
function choice(record, kind, source) {
    if (!isRecord(record)) return null;
    const id = text(record.id, 120);
    const name = text(record.name, 80);
    if (!id || !name) return null;
    const stats = statChanges(record.stats);
    const out = {
        id, name, note: text(record.note, 500), stats,
        tags: Array.isArray(record.tags) ? record.tags.map(tag => text(tag, 40)).filter(Boolean) : [],
        bonus: bonusText(stats), source,
    };
    // A picture only when the pack gives a real one (https: or a data:image address); never an id.
    const image = cardImage(record.image);
    if (image) out.image = image;
    if (kind === 'talents') out.cost = talentCost(out);
    return out;
}

function fromPacks(tools, kind) {
    if (typeof tools?.query !== 'function') return null;
    let list;
    try {
        list = tools.query('packs.content', { kind });
    } catch {
        return null;            // no packs part, or it failed: the built-ins stand in
    }
    return Array.isArray(list) ? list : null;
}

// A built-in record is offered under a namespaced id, `rpg-battle/<slug>`, as a pack's comes as
// `pack.<pack>/<slug>` (Story Block's packs.content): the party keeps it on your character's origin,
// and Story Block reads any `id` field in the state as an ID (a record id or a namespaced slug).
export const BUILT_IN_PREFIX = 'rpg-battle/';
const builtInRecord = record => ({ ...record, id: `${BUILT_IN_PREFIX}${record.id}` });

function choicesOf(tools, kind, builtIn) {
    const packed = fromPacks(tools, kind);
    const records = packed?.length ? packed : builtIn.map(builtInRecord);
    const source = packed?.length ? 'packs' : 'built-in';
    const seen = new Set();
    const out = [];
    for (const record of records) {
        const entry = choice(record, kind, source);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        out.push(entry);
    }
    return out;
}

const SKILL_TYPES = ['physical', 'magic', 'heal', 'buff', 'debuff'];
const SKILL_TARGETS = ['one', 'all', 'self', 'ally', 'allies'];

// A pack skill (PACKS kind `skills`: { id, name, type, stat, target, element, note }) as a
// template the party part builds with v1 skillFromTemplate: words only, the rules set the numbers.
function skillChoice(record) {
    if (!isRecord(record)) return null;
    const id = text(record.id, 120);
    const name = text(record.name, 60);
    if (!id || !name) return null;
    return {
        id, name,
        type: SKILL_TYPES.includes(record.type) ? record.type : 'physical',
        stat: STATS.includes(record.stat) ? record.stat : null,
        target: SKILL_TARGETS.includes(record.target) ? record.target : 'one',
        element: typeof record.element === 'string' && /^[a-z]{1,24}$/.test(record.element) ? record.element : null,
        note: text(record.note, 300),
    };
}

/**
 * The packs' ready-made characters (PACKS kind `presets`: { id, name, note, race, talents,
 * points, skills }, references as full pack ids), each checked against what is on offer: a race
 * or talent creation does not offer is left out, so is a skill no pack has. A preset fills the
 * wizard's race, talents and points only (MODULES §F22: the name and background stay the
 * persona's); its skills are learned when the character is made.
 */
function presetsOf(tools, races, talents) {
    const records = fromPacks(tools, 'presets') ?? [];
    if (!records.length) return [];
    const skills = (fromPacks(tools, 'skills') ?? []).map(skillChoice).filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const record of records) {
        if (!isRecord(record)) continue;
        const id = text(record.id, 120);
        const name = text(record.name, 80);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        const race = races.find(entry => entry.id === record.race) ?? null;
        const picked = (Array.isArray(record.talents) ? record.talents : []).map(ref => talents.find(entry => entry.id === ref)).filter(Boolean);
        const taught = (Array.isArray(record.skills) ? record.skills : []).map(ref => skills.find(entry => entry.id === ref)).filter(Boolean);
        const points = {};
        for (const stat of STATS) {
            const value = record.points?.[stat];
            if (Number.isInteger(value) && value > 0) points[stat] = value;
        }
        out.push({
            id, name, note: text(record.note, 500),
            race: race?.id ?? '', talents: picked.map(entry => entry.id), points, skills: taught,
            raceName: race?.name ?? '', talentNames: picked.map(entry => entry.name).join(', '),
            skillNames: taught.map(entry => entry.name).join(', '), source: 'packs',
            ...(cardImage(record.image) ? { image: cardImage(record.image) } : {}),
        });
    }
    return out;
}

/**
 * The races and talents on offer: the enabled packs' (Story Block's `packs.content` query) for each
 * kind that has any, otherwise RPG Battle's built-in ones. `builtIn: false` turns the built-ins off
 * (a story with no races and talents at all). `presets`: the packs' ready-made characters (none
 * built in). `tools` is `{ query }` (a query's tools or a ctx).
 */
export function creationContent(tools, { builtIn = true } = {}) {
    const races = choicesOf(tools, 'races', builtIn ? BUILT_IN_RACES : []);
    const talents = choicesOf(tools, 'talents', builtIn ? BUILT_IN_TALENTS : []);
    return { races, talents, presets: presetsOf(tools, races, talents) };
}
