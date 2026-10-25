// The rules of a new character, in one pure function both the command and the wizard's live
// preview use (SPEC §13.6: the dialog only holds a draft; code checks every rule):
//
// * the points budget is v1's startPoints (the reader's 'Character' setting), and the talents
//   taken are paid from it first; the rest is spent on stats, exactly, as v1 newSheet asks;
// * every stat starts at v1's startStat; the points go on, then the race's and the talents'
//   stat changes; no stat may end above the stat cap (0: none) or below 0;
// * a race must be picked when any are offered, and talents (each at most once, rolled ones
//   included) are at most `maxTalents`.
//
// buildCharacter never throws: it returns { ok: true, … } or { ok: false, code, message, … }
// with the numbers so far, so the wizard can show how the budget stands while the draft is
// still incomplete.

import { DEFAULT_RULES, STATS } from '../../rules.js';
import { STAT_LABELS, statChanges, talentCost } from './content.js';

export const SETTINGS_DEFAULTS = Object.freeze({
    maxTalents: 2,
    builtInChoices: true,
});

export const SETTINGS_SCHEMA = Object.freeze({
    maxTalents: { type: 'int', min: 0, max: 6, label: 'Talents a new character may take' },
    builtInChoices: { type: 'bool', label: 'Offer RPG Battle\'s own races and talents when no pack has any' },
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const whole = (value, fallback, min, max) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * The numbers creation needs from the module's settings: v1's startPoints, statCap and startStat
 * (the party part's 'Character' fields, with v1's defaults and ranges) and this part's own.
 * `settings` is a part's own (bare keys) or the module's whole (namespaced keys). `rules`: the `rules` slice; a pinned ruleset's
 * starting numbers replace the reader's (contract §5).
 */
export function creationRules(settings, rules = null) {
    let raw = settings;
    if (typeof raw === 'function') {
        try { raw = raw(); } catch { raw = null; }
    }
    const s = isRecord(raw) ? raw : {};
    // src/v2/module.js keeps each part's keys under its part id (`party.startPoints`); a part's
    // ctx sees its own bare. Both forms are read here.
    const party = key => s[`party.${key}`] ?? s[key];
    const own = key => s[`creation.${key}`] ?? s[key];
    const d = DEFAULT_RULES.character;
    const pinned = rules?.pin?.resolved?.constants;
    return {
        startPoints: pinned ? pinned.startPoints : whole(party('startPoints'), d.startPoints, 0, 60),
        statCap: pinned ? pinned.statCap : whole(party('statCap'), d.statCap, 0, 999),
        startStat: pinned ? pinned.startStat : d.startStat,
        maxTalents: whole(own('maxTalents'), SETTINGS_DEFAULTS.maxTalents, 0, 6),
        builtInChoices: own('builtInChoices') !== false,
    };
}

const refuse = (code, message) => ({ code, message });

function readPoints(points) {
    if (points === undefined || points === null) return { points: {} };
    if (!isRecord(points)) return { problem: refuse('INVALID', 'Points must say how many go into each stat.') };
    const out = {};
    for (const [stat, value] of Object.entries(points)) {
        if (!STATS.includes(stat)) return { problem: refuse('INVALID', `"${stat}" is not a stat (${STATS.join(', ')}).`) };
        if (value === null || value === undefined || value === '') continue;
        if (!Number.isInteger(value) || value < 0) return { problem: refuse('INVALID', `${stat} must be a whole number of points, 0 or more.`) };
        if (value) out[stat] = value;
    }
    return { points: out };
}

function readIds(list, what) {
    if (list === undefined || list === null || list === '') return { ids: [] };
    const raw = Array.isArray(list) ? list : typeof list === 'string' ? [list] : null;
    if (!raw) return { problem: refuse('INVALID', `${what} must be a list.`) };
    const ids = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') return { problem: refuse('INVALID', `${what} must be a list of ids.`) };
        const id = entry.trim();
        if (id) ids.push(id);
    }
    return { ids };
}

const listText = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * input `{ race?, talents?: [ids], points?: { STAT: n } }`, content `{ races, talents }` (from
 * creationContent), rules from creationRules, rolled: talent ids already rolled and kept.
 * `requireRace: false` lets a draft without a race through (the talent roll, mid-wizard).
 * → { ok, code, message, problems: [text], issues: [{ code, message }], budget, cost, spent,
 *     left, race, talents, rolled, bonus, stats, rows, axes, points, origin, … }
 */
export function buildCharacter(input, content, rules, rolled = [], { requireRace = true } = {}) {
    const draft = isRecord(input) ? input : {};
    const races = content?.races ?? [];
    const offered = content?.talents ?? [];
    const out = {
        ok: false, code: null, message: '',
        budget: rules.startPoints, cost: 0, spent: 0, left: rules.startPoints,
        race: null, talents: [], bonus: {}, stats: {}, rows: [], axes: [], origin: null,
        maxTalents: rules.maxTalents, talentsLeft: rules.maxTalents,
    };
    const problems = [];
    const note = problem => { if (problem) problems.push(problem); };

    // Race
    const raceId = typeof draft.race === 'string' ? draft.race.trim() : draft.race ?? '';
    if (raceId !== '' && typeof raceId !== 'string') note(refuse('INVALID', 'The race must be one of the choices.'));
    else if (raceId) {
        out.race = races.find(race => race.id === raceId) ?? null;
        if (!out.race) note(refuse('NOT_FOUND', races.length ? 'That race is not one of the choices.' : 'This story has no races to choose from.'));
    } else if (races.length && requireRace) note(refuse('INVALID', 'Choose a race.'));

    // Talents: the rolled ones first (kept, SPEC §13.6), then the picked ones.
    const picked = readIds(draft.talents, 'Talents');
    note(picked.problem);
    // A rolled talent no pack offers any more (switched off since) is left out, not held against
    // the reader.
    const kept = (Array.isArray(rolled) ? rolled : []).filter(id => offered.some(entry => entry.id === id));
    const ids = [...new Set([...kept, ...(picked.ids ?? [])])];
    if ((picked.ids ?? []).length !== new Set(picked.ids ?? []).size) note(refuse('INVALID', 'A talent can be taken only once.'));
    out.rolled = kept;
    for (const id of ids) {
        const talent = offered.find(entry => entry.id === id);
        if (!talent) {
            note(refuse('NOT_FOUND', offered.length ? `"${id}" is not one of the talents.` : 'This story has no talents to choose from.'));
            continue;
        }
        out.talents.push(talent);
    }
    out.talentsLeft = Math.max(0, rules.maxTalents - out.talents.length);
    if (out.talents.length > rules.maxTalents) {
        note(refuse('REFUSED', rules.maxTalents ? `A new character takes ${plural(rules.maxTalents, 'talent')} at most.` : 'Talents are switched off for new characters.'));
    }
    out.cost = out.talents.reduce((sum, talent) => sum + (Number.isInteger(talent.cost) ? talent.cost : talentCost(talent)), 0);

    // Points
    const read = readPoints(draft.points);
    note(read.problem);
    const points = read.points ?? {};
    out.spent = Object.values(points).reduce((sum, value) => sum + value, 0);
    out.left = out.budget - out.cost - out.spent;

    // Stats: start + points, then the race's and talents' changes (MODULES §F14).
    for (const source of [out.race, ...out.talents]) {
        for (const [stat, value] of Object.entries(statChanges(source?.stats))) out.bonus[stat] = (out.bonus[stat] ?? 0) + value;
    }
    const cap = rules.statCap > 0 ? rules.statCap : Infinity;
    for (const stat of STATS) {
        const base = rules.startStat + (points[stat] ?? 0);
        const bonus = out.bonus[stat] ?? 0;
        const final = base + bonus;
        out.stats[stat] = final;
        out.rows.push({ id: stat, label: STAT_LABELS[stat], points: points[stat] ?? 0, base, bonus, final });
        out.axes.push({ label: stat, value: Math.max(0, final), before: rules.startStat });
    }
    const over = STATS.find(stat => out.stats[stat] > cap);
    if (over) note(refuse('REFUSED', `${over} would be ${out.stats[over]}; no stat can go higher than ${cap}.`));
    const under = STATS.find(stat => out.stats[stat] < 0);
    if (under) note(refuse('REFUSED', `${under} would be ${out.stats[under]}; no stat can go below 0.`));
    if (out.cost > out.budget) note(refuse('REFUSED', `The talents cost ${plural(out.cost, 'point')}; a new character has ${plural(out.budget, 'point')}.`));
    else if (out.left < 0) note(refuse('REFUSED', `${plural(out.spent, 'point')} spent on stats, ${plural(out.budget - out.cost, 'point')} to spend${out.cost ? ` after the talents (${out.cost})` : ''}.`));
    else if (out.left > 0) note(refuse('REFUSED', `Spend every point: ${plural(out.left, 'point')} left.`));

    out.origin = { race: out.race ? { id: out.race.id, name: out.race.name } : null, talents: out.talents.map(talent => ({ id: talent.id, name: talent.name })) };
    out.points = points;
    out.raceName = out.race?.name ?? '';
    out.talentNames = listText(out.talents.map(talent => talent.name));
    if (problems.length) {
        out.code = problems[0].code;
        out.message = problems[0].message;
        out.problems = problems.map(problem => problem.message);
        out.issues = problems;
        return out;
    }
    out.ok = true;
    out.problems = [];
    out.issues = [];
    return out;
}
