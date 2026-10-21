// The creation part's commands and queries (MODULES §F12, §F14; SPEC §13.6). Handlers are
// synchronous and pure apart from ctx (SPEC §3.2). Your character itself is made by the party
// part's `party.create`, called inside the same transaction; this part checks the wizard's whole
// draft first (budget, talents, race, stat cap) with buildCharacter, the same function the
// wizard's live preview runs, and keeps the talents a reader rolled (the `creation` domain).
//
// What party.create is given (see the part's notes in index.js):
//   { name, points, background?, portrait?, origin?: { race: id | null, talents: [ids] } }
// The name and background are the SillyTavern persona's (MODULES §F22), put in the draft by the
// opener, never typed in the wizard.
// `origin` only when a race or a talent was taken. party.create asks this part's query
// `creation.build` for the checked final stats of that origin, so no caller can hand it stats.
// A pack's ready-made character (`preset`) only filled the draft's race, talents and points; its
// skills are learned after party.create (party.learnSkill with the pack skill as the template,
// built by v1 skillFromTemplate into party.custom).

import { STATS } from '../../rules.js';
import { buildCharacter, creationRules } from './build.js';
import { STAT_LABELS, creationContent } from './content.js';
import { BACKGROUND_LIMIT } from './persona.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Rejects the command (ctx.fail throws; a ctx without it still gets a coded throw). */
function fail(ctx, code, message) {
    if (typeof ctx?.fail === 'function') ctx.fail(code, message);
    const error = new Error(message);
    error.code = code;
    throw error;
}

function settingsOf(ctx) {
    try {
        return typeof ctx?.settings === 'function' ? ctx.settings() : null;
    } catch {
        return null;
    }
}

/** The creation slice as the state has it now ({ rolled: [] } before anything was rolled). */
function creationOf(read) {
    let slice = null;
    try {
        slice = read('creation');
    } catch {
        slice = null;
    }
    return { rolled: Array.isArray(slice?.rolled) ? [...slice.rolled] : [] };
}

function readParty(ctx) {
    try {
        return ctx.read('party');
    } catch {
        return null;
    }
}

const hasPc = party => Boolean(party?.pc && party.actors?.[party.pc]);

// ---------------------------------------------------------------------------------------
// The domain

/** The empty creation slice: nothing rolled. */
export const initialCreation = () => ({ rolled: [] });

/** The creation slice's problems ([] when fine): `rolled` is a list of distinct talent ids. */
export function validateCreation(slice) {
    if (!isRecord(slice)) return ['creation is not a record.'];
    const errors = [];
    for (const key of Object.keys(slice)) if (key !== 'rolled') errors.push(`creation.${key} is not a field (only rolled).`);
    if (!Array.isArray(slice.rolled)) errors.push('creation.rolled must be a list.');
    else {
        if (slice.rolled.some(id => typeof id !== 'string' || !id.trim() || id.length > 120)) errors.push('creation.rolled must list talent ids.');
        if (new Set(slice.rolled).size !== slice.rolled.length) errors.push('creation.rolled lists a talent twice.');
        if (slice.rolled.length > 6) errors.push('creation.rolled lists more than 6 talents.');
    }
    return errors;
}

// ---------------------------------------------------------------------------------------
// Portraits (MODULES §F11; WIDGETS.md "Images")

const RASTER = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

/**
 * The portrait a payload gives, or null for none: an https: address, a base64 raster data: URL,
 * or a same-origin path from the site root (SillyTavern's persona avatars, `/User Avatars/…`,
 * `/thumbnail?type=persona&file=…`). Anything else is refused.
 */
export function cleanPortrait(value) {
    if (value === undefined || value === null) return { portrait: null };
    if (typeof value !== 'string') return { error: 'The portrait must be an image address.' };
    const text = value.trim();
    if (!text) return { portrait: null };
    if (text.length > 2048) return { error: 'That portrait address is too long.' };
    if (RASTER.test(text)) return { portrait: text };
    if (text.startsWith('/') && !text.startsWith('//') && !text.startsWith('/\\')) return { portrait: text };
    try {
        const url = new URL(text);
        if (url.protocol === 'https:' && !url.username && !url.password) return { portrait: text };
    } catch { /* not an address */ }
    return { error: 'The portrait must be an https: address, an image, or one of SillyTavern\'s avatar paths.' };
}

// ---------------------------------------------------------------------------------------
// Queries ((state, args, tools), MODULES §F3)

// A queries' tools over `state`: the host's tools, else a stand-in that only reads this state.
const readerOf = state => domain => state?.domains?.[domain] ?? null;

/** Settings for a query: `args.settings` (a screen passes the module's), else the tools' (src/v2/module.js gives a part's). */
function querySettings(args, tools) {
    if (isRecord(args?.settings)) return args.settings;
    if (isRecord(tools?.settings)) return tools.settings;
    if (typeof tools?.settings === 'function') {
        try { return tools.settings(); } catch { return null; }
    }
    return null;
}

/**
 * `creation.content({ settings? })` → what the wizard offers: { races, talents (each with
 * `rolled`), rolled (the rolled talents' records), presets (the packs' ready-made characters),
 * stats: [{ id, label }], rules: { startPoints, statCap, startStat, maxTalents, pointMax },
 * hasRaces, hasTalents, hasPresets }.
 */
export function contentQuery(state, args = {}, tools = null) {
    const rules = creationRules(querySettings(args, tools));
    const content = creationContent(tools, { builtIn: rules.builtInChoices });
    const { rolled } = creationOf(readerOf(state));
    const cap = rules.statCap > 0 ? rules.statCap : null;
    const kept = new Set(rolled);
    return {
        races: content.races,
        presets: content.presets,
        talents: content.talents.map(talent => ({ ...talent, rolled: kept.has(talent.id) })),
        rolled: rolled.map(id => content.talents.find(talent => talent.id === id)).filter(Boolean),
        stats: STATS.map(id => ({ id, label: STAT_LABELS[id] })),
        rules: { startPoints: rules.startPoints, statCap: rules.statCap, startStat: rules.startStat, maxTalents: rules.maxTalents, pointMax: cap === null ? null : Math.max(0, cap - rules.startStat) },
        hasRaces: content.races.length > 0,
        hasTalents: content.talents.length > 0,
        hasPresets: content.presets.length > 0,
    };
}

/**
 * `creation.build({ race?, talents?, points?, settings? } | { draft, settings? })` → buildCharacter's
 * answer for that draft (with the talents already rolled): the wizard's live budget and preview,
 * and what party.create asks to make a character with an origin.
 */
export function buildQuery(state, args = {}, tools = null) {
    const rules = creationRules(querySettings(args, tools));
    const content = creationContent(tools, { builtIn: rules.builtInChoices });
    const draft = isRecord(args?.draft) ? args.draft : (args ?? {});
    const { rolled } = creationOf(readerOf(state));
    return buildCharacter(draft, content, rules, rolled);
}

// ---------------------------------------------------------------------------------------
// Commands

/** What a command needs: rules from the module's settings, the content, what was rolled. */
function setup(ctx) {
    const rules = creationRules(settingsOf(ctx));
    const content = creationContent(ctx, { builtIn: rules.builtInChoices });
    const creation = creationOf(domain => ctx.read(domain));
    return { rules, content, creation };
}

/**
 * creation.finish { name, background?, race?, talents?: [ids], points: { STAT: n }, portrait?,
 * preset? }: your character from the wizard's draft (name and background from the persona). Every
 * rule is checked here (buildCharacter), then party.create makes the character in the same
 * transaction, and a preset's skills are learned; the talents rolled are then cleared. Nothing
 * is saved when any part refuses.
 */
function finish(ctx, payload = {}) {
    const draft = isRecord(payload) ? payload : {};
    if (hasPc(readParty(ctx))) fail(ctx, 'REFUSED', 'You already have a character.');
    const name = typeof draft.name === 'string' ? draft.name.trim() : '';
    if (!name) fail(ctx, 'INVALID', 'Your character is named after your persona: set a name in SillyTavern\'s Persona Management first.');
    if (name.length > 40) fail(ctx, 'INVALID', 'A name can be at most 40 characters.');
    if (draft.background !== undefined && draft.background !== null && typeof draft.background !== 'string') fail(ctx, 'INVALID', 'The background must be text.');
    // The persona description, as SillyTavern has it; longer ones are cut to the limit.
    const background = String(draft.background ?? '').trim().slice(0, BACKGROUND_LIMIT);
    const portrait = cleanPortrait(draft.portrait);
    if (portrait.error) fail(ctx, 'INVALID', portrait.error);
    const { rules, content, creation } = setup(ctx);
    if (draft.preset !== undefined && draft.preset !== null && typeof draft.preset !== 'string') fail(ctx, 'INVALID', 'The ready-made character must be one of the choices.');
    const presetId = typeof draft.preset === 'string' ? draft.preset.trim() : '';
    const preset = presetId ? content.presets.find(entry => entry.id === presetId) ?? null : null;
    if (presetId && !preset) fail(ctx, 'NOT_FOUND', 'That ready-made character is not one of the choices any more.');
    const built = buildCharacter(draft, content, rules, creation.rolled);
    if (!built.ok) fail(ctx, built.code ?? 'INVALID', built.message);

    const withOrigin = Boolean(built.race || built.talents.length);
    const create = {
        name,
        points: { ...built.points },
        ...(background ? { background } : {}),
        ...(portrait.portrait ? { portrait: portrait.portrait } : {}),
        ...(withOrigin ? { origin: { race: built.race?.id ?? null, talents: built.talents.map(talent => talent.id) } } : {}),
    };
    ctx.call('party.create', create);

    // party.create must have made exactly these stats (it asks creation.build for them); a party
    // part that does not take an origin yet would leave the bonuses out, so that is refused.
    const party = readParty(ctx);
    const pc = hasPc(party) ? party.actors[party.pc] : null;
    if (!pc) fail(ctx, 'FAILED', 'Your character could not be made.');
    const wrong = STATS.find(stat => pc.stats?.[stat] !== built.stats[stat]);
    if (wrong) fail(ctx, 'FAILED', `Your character could not be made with the race and talents: ${wrong} came out ${pc.stats?.[wrong]}, not ${built.stats[wrong]}.`);
    if (background && pc.background !== background) fail(ctx, 'FAILED', 'Your character could not be made with your persona\'s background.');

    // The ready-made character's skills, built from the pack's words by the party part's rules.
    const learned = [];
    for (const skill of preset?.skills ?? []) {
        const known = (readParty(ctx)?.actors?.[pc.id]?.skills ?? []).some(entry => entry.name.toLowerCase() === skill.name.toLowerCase());
        if (known) continue;
        const { type, stat, target, element, note } = skill;
        ctx.call('party.learnSkill', { actor: pc.id, name: skill.name, free: true, template: { type, ...(stat ? { stat } : {}), target, ...(element ? { element } : {}), ...(note ? { note } : {}) } });
        learned.push(skill.name);
    }

    if (creation.rolled.length) ctx.draft('creation').rolled = [];
    const what = [built.race?.name ?? '', built.talentNames, learned.join(', ')].filter(Boolean).join('; ');
    return {
        summary: `${pc.name}${what ? ` (${what})` : ''} is ready.`,
        data: { actor: pc.id, race: built.race?.id ?? null, talents: built.talents.map(talent => talent.id), stats: { ...built.stats }, preset: preset?.id ?? null, skills: learned },
        narrate: false,
    };
}

/**
 * creation.rollTalent { talents?: [ids], points?: { STAT: n } } (the wizard's draft): a random
 * talent, not yet taken or rolled, whose cost the points left can pay (the draft's picks and
 * points counted), drawn with the receipt's rng. Used through preview and commit (SPEC §13.6):
 * the talent the preview shows is the one committed, kept in `creation.rolled` until
 * creation.finish takes it. It costs its points like a picked one.
 */
function rollTalent(ctx, payload = {}) {
    const draft = isRecord(payload) ? payload : {};
    if (hasPc(readParty(ctx))) fail(ctx, 'REFUSED', 'You already have a character.');
    const { rules, content, creation } = setup(ctx);
    if (!content.talents.length) fail(ctx, 'NOT_FOUND', 'This story has no talents to roll.');
    // The draft as it stands: a malformed pick or point is refused; an unfinished budget is fine here.
    const built = buildCharacter({ talents: draft.talents, points: draft.points }, content, rules, creation.rolled, { requireRace: false });
    const malformed = built.issues.find(issue => issue.code === 'INVALID' || issue.code === 'NOT_FOUND');
    if (malformed) fail(ctx, malformed.code, malformed.message);
    const taken = new Set(built.talents.map(talent => talent.id));
    if (taken.size >= rules.maxTalents) {
        fail(ctx, 'REFUSED', rules.maxTalents ? `You already have ${plural(taken.size, 'talent')}, the most a new character takes.` : 'Talents are switched off for new characters.');
    }
    const left = rules.startPoints - built.cost - built.spent;
    const open = content.talents.filter(talent => !taken.has(talent.id) && talent.cost <= left);
    if (!open.length) {
        fail(ctx, 'REFUSED', left > 0 ? `No talent left costs ${plural(left, 'point')} or less; take points off your stats first.` : 'No points are left for a talent; take points off your stats first.');
    }
    const talent = open[Math.min(open.length - 1, Math.floor(ctx.rng() * open.length))];
    const slice = ctx.draft('creation');
    slice.rolled = [...creation.rolled.filter(id => content.talents.some(entry => entry.id === id)), talent.id];
    return {
        summary: `Rolled talent: ${talent.name} (${plural(talent.cost, 'point')}${talent.bonus ? `, ${talent.bonus}` : ''}).`,
        data: { talent: talent.id, name: talent.name, cost: talent.cost },
        narrate: false,
    };
}

export const commands = {
    'creation.finish': finish,
    'creation.rollTalent': rollTalent,
};

export const queries = {
    'creation.content': contentQuery,
    'creation.build': buildQuery,
};
