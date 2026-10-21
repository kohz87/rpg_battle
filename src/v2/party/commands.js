// The party part's commands (MODULES §B1). Each handler is synchronous and pure apart from ctx
// (SPEC §3.2): it reads and drafts only through ctx, turns the actor it changes into a v1 Sheet,
// lets v1's rules do the sums (sheet.js newSheet / spendPoints / learnSkill / applyResult,
// party.js newCompanion, growth.js awards and auto-spend, recovery.js rests and items, story.js
// wounds), and writes the result back. A rule v1 enforces by throwing is a rejection here
// (INVALID, its own words); a command that would change nothing is rejected too, so nothing is
// saved for it. Summaries are code-written with code's numbers (SPEC §4.3).

import { STATS, checkModifier } from '../../rules.js';
import { PRESETS, findSkill, skillFromTemplate, DEFAULT_SKILLS, canLearn } from '../../skills.js';
import { applyResult as applyResultV1, forgetSkill as forgetV1, learnSkill as learnV1, newSheet, setSkillActive as setActiveV1, spendPoints } from '../../sheet.js';
import { newCompanion } from '../../party.js';
import { awardShare, gainXp, settleCompanions, xpAward } from '../../growth.js';
import { rest as restV1, useItemOutside } from '../../recovery.js';
import { buildStats, cleanFocus, guessFocus, lockedReason, suggestSkills } from '../../builds.js';
import { levelText, maxLevel } from '../../terms.js';
import { fromSheet, gearOf, libraryOf, rulesFrom, settingsOf, toSheet, v1Control } from './sheets.js';
import { OUTCOMES, dcOf, outcomeOf, statForCheck } from './checks.js';
import { actorFrom, actorsInOrder, attempt, cleanName, cleanRole, fail, nameKey, newId, revOf } from './util.js';

const settingsFor = ctx => settingsOf(typeof ctx?.settings === 'function' ? ctx.settings() : null);
const rulesFor = ctx => rulesFrom(settingsFor(ctx));

function readInventory(ctx) {
    try {
        return ctx.read('inventory');
    } catch {
        return null;
    }
}

/** The actor's record rewritten from a v1 Sheet. */
function writeSheet(party, actor, sheet, rules) {
    party.actors[actor.id] = fromSheet(actor, sheet, rules);
    return party.actors[actor.id];
}

/**
 * A portrait (MODULES §F11): the persona avatar for your character, an NPC's for a companion, as
 * the image path or URL SillyTavern gives; null for none. No script URLs.
 */
function portraitOf(ctx, value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    if (!text || text.length > 2048 || /^\s*(?:javascript|vbscript):/i.test(text)) fail(ctx, 'INVALID', 'That portrait is not an image path or address.');
    return text;
}

const nameTaken = (party, name, except = null) => actorsInOrder(party).some(actor => actor.id !== except && nameKey(actor.name) === nameKey(name));
const skillKnown = (actor, name) => (actor.skills ?? []).some(skill => nameKey(skill.name) === nameKey(name));

/** v1 settleCompanions on the companions (auto ones spend their points by build when the setting allows). */
function settle(party, ids, rules, settings) {
    const members = ids.map(id => party.actors[id]).filter(actor => actor?.kind === 'companion')
        .map(actor => ({ id: actor.id, name: actor.name, control: v1Control(actor), sheet: toSheet(actor) }));
    for (const member of settleCompanions(members, { autoSpend: settings.autoSpend !== false, rules })) {
        writeSheet(party, party.actors[member.id], member.sheet, rules);
    }
}

// ---------------------------------------------------------------------------------------
// Making and changing members

/**
 * party.create { name, points: { STR: n, … } | preset: 'fighter', skills?: [names], role?,
 * portrait?, replace?: true }: your character, the only way one is made (MODULES §F12), by v1
 * newSheet (every stat at the start value plus the points, which spend exactly the start points;
 * a name; the stat cap). Skills are optional library names the built stats allow, at most
 * rules.character.starterSkills. `portrait` is the persona avatar.
 */
function create(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    if (party.pc && !payload.replace) fail(ctx, 'REFUSED', 'You already have a character.');
    const preset = payload.preset ? PRESETS.find(entry => entry.id === payload.preset) : null;
    if (payload.preset && !preset) fail(ctx, 'NOT_FOUND', `There is no "${payload.preset}" preset.`);
    const points = payload.points ?? preset?.points ?? {};
    if (!points || typeof points !== 'object' || Array.isArray(points)) fail(ctx, 'INVALID', 'Points must say how many go into each stat.');
    const name = cleanName(payload.name);
    if (!name) fail(ctx, 'INVALID', 'New character: a name is needed.');
    if (nameTaken(party, name, party.pc)) fail(ctx, 'REFUSED', `There is already a ${name} in the party.`);
    const wanted = [...new Set((payload.skills ?? preset?.skills ?? []).map(entry => String(entry ?? '').trim()).filter(Boolean))];
    if (wanted.length > rules.character.starterSkills) fail(ctx, 'REFUSED', `A new character starts with ${rules.character.starterSkills} skills at most.`);
    const sheet = attempt(ctx, () => newSheet({ name, stats: points, skills: [] }, rules));
    const skills = wanted.map(skillName => {
        const found = findSkill(DEFAULT_SKILLS, skillName);
        if (!found) fail(ctx, 'NOT_FOUND', `"${skillName}" is not in the skill library.`);
        const why = lockedReason(sheet.stats, found);
        if (why) fail(ctx, 'REFUSED', `${name} cannot take ${found.name}: it ${why}.`);
        return found.name;
    });
    const full = attempt(ctx, () => newSheet({ name, stats: points, skills }, rules));
    const old = party.pc;
    // A new id even in place of an old character: what was kept under the old one stays theirs.
    const id = newId(ctx, 'ac', candidate => Boolean(party.actors[candidate]));
    if (old) {
        delete party.actors[old];
        party.offers = party.offers.filter(offer => offer.actor !== old);
    }
    writeSheet(party, { id, kind: 'pc', control: 'player', role: cleanRole(payload.role ?? ''), npc: null, portrait: portraitOf(ctx, payload.portrait) }, full, rules);
    party.pc = id;
    party.order = [id, ...party.order.filter(entry => entry !== old && entry !== id)];
    return { summary: `${name} is ready.`, data: { actor: id }, narrate: false };
}

/**
 * party.addCompanion { name, role?, level?, focus?: [stats], skills?: [names], control?:
 * 'auto' | 'player', npc?, portrait? }: a companion built by v1 newCompanion at the level given
 * (else your character's), their stats spread over the focus (else the role's words), and the
 * skills given or, without any, the ones v1 suggestSkills picks for that build.
 */
function addCompanion(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const name = cleanName(payload.name);
    if (!name) fail(ctx, 'INVALID', 'Give the companion a name.');
    if (nameTaken(party, name)) fail(ctx, 'REFUSED', `There is already a ${name} in the party.`);
    const role = cleanRole(payload.role ?? '') || 'companion';
    const pc = party.pc ? party.actors[party.pc] : null;
    const asked = Number(payload.level);
    if (payload.level !== undefined && payload.level !== null && !(Number.isInteger(asked) && asked >= 1)) fail(ctx, 'INVALID', 'The level must be a whole number from 1.');
    const level = Math.min(maxLevel(rules), payload.level ? asked : Math.max(1, pc?.level ?? 1));
    const focus = cleanFocus(payload.focus?.length ? payload.focus : guessFocus(role, payload.text ?? ''));
    const library = libraryOf(party);
    const skills = Array.isArray(payload.skills) && payload.skills.length
        ? payload.skills.map(skill => findSkill(library, skill)?.name ?? String(skill ?? '').trim()).filter(Boolean)
        : suggestSkills(buildStats(focus, level, rules), focus, DEFAULT_SKILLS, { role, count: rules.character.starterSkills });
    const member = attempt(ctx, () => newCompanion({ name, role, control: payload.control === 'player' ? 'command' : 'auto', level, focus, skills }, { rules, existing: [], library }));
    const id = newId(ctx, 'ac', candidate => Boolean(party.actors[candidate]));
    const npc = payload.npc ? String(payload.npc).trim().slice(0, 80) || null : null;
    writeSheet(party, { id, kind: 'companion', control: payload.control === 'player' ? 'player' : 'auto', role: member.role, npc, portrait: portraitOf(ctx, payload.portrait) }, member.sheet, rules);
    party.order.push(id);
    return { summary: `${name} joins the party (${levelText(level, rules)}, ${member.role}).`, data: { actor: id, level }, narrate: true };
}

/**
 * party.edit { actor, name?, role?, control?, npc?, portrait? }: v1 editCompanion's rules (a
 * name cleaned for the heading, never another member's; a role, else 'companion'). Ids never
 * change in v2. Your character is always played by you.
 */
function edit(ctx, payload = {}) {
    const party = ctx.draft('party');
    const actor = actorFrom(ctx, party, payload);
    const next = { ...actor };
    if (payload.name !== undefined) {
        next.name = cleanName(payload.name);
        if (!next.name) fail(ctx, 'INVALID', actor.kind === 'pc' ? 'Your character needs a name.' : 'Give the companion a name.');
        if (nameTaken(party, next.name, actor.id)) {
            fail(ctx, 'REFUSED', party.pc && nameKey(party.actors[party.pc].name) === nameKey(next.name) ? `${next.name} is your character's name.` : `There is already a ${next.name} in the party.`);
        }
    }
    if (payload.role !== undefined) next.role = cleanRole(payload.role) || (actor.kind === 'companion' ? 'companion' : '');
    if (payload.control !== undefined) {
        if (payload.control !== 'player' && payload.control !== 'auto') fail(ctx, 'INVALID', 'Control is player or auto.');
        if (actor.kind === 'pc' && payload.control !== 'player') fail(ctx, 'REFUSED', 'Your character is always yours to play.');
        next.control = payload.control;
    }
    if (payload.npc !== undefined) next.npc = payload.npc ? String(payload.npc).trim().slice(0, 80) || null : null;
    if (payload.portrait !== undefined) next.portrait = portraitOf(ctx, payload.portrait);
    if (['name', 'role', 'control', 'npc', 'portrait'].every(key => (next[key] ?? null) === (actor[key] ?? null))) fail(ctx, 'REFUSED', 'Nothing to change.');
    party.actors[actor.id] = next;
    return { summary: next.name === actor.name ? `${next.name} is updated.` : `${actor.name} is now called ${next.name}.`, data: { actor: actor.id }, narrate: false };
}

/** party.removeCompanion { actor }: a companion leaves (their waiting skill offers go too). */
function removeCompanion(ctx, payload = {}) {
    const party = ctx.draft('party');
    const actor = actorFrom(ctx, party, payload, { pcDefault: false });
    if (actor.kind !== 'companion') fail(ctx, 'REFUSED', 'Only a companion can leave the party.');
    delete party.actors[actor.id];
    party.order = party.order.filter(id => id !== actor.id);
    party.offers = party.offers.filter(offer => offer.actor !== actor.id);
    return { summary: `${actor.name} leaves the party.`, data: { actor: actor.id }, narrate: true };
}

// ---------------------------------------------------------------------------------------
// Points and skills

/** party.spend { actor?, points: { STR: n, … } }: unspent points into stats (v1 spendPoints). */
function spend(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const actor = actorFrom(ctx, party, payload);
    const points = payload.points;
    if (!points || typeof points !== 'object' || Array.isArray(points)) fail(ctx, 'INVALID', 'Choose where the points go.');
    const sheet = attempt(ctx, () => spendPoints(toSheet(actor), points, rules));
    const total = actor.points - sheet.points;
    if (!total) fail(ctx, 'INVALID', 'Choose where the points go.');
    writeSheet(party, actor, sheet, rules);
    const spent = STATS.filter(stat => sheet.stats[stat] !== actor.stats[stat]).map(stat => `${stat} ${sheet.stats[stat]}`).join(', ');
    return { summary: `${actor.name} spends ${total} point${total === 1 ? '' : 's'}: ${spent}.`, data: { actor: actor.id, points: total }, narrate: false };
}

/**
 * party.learnSkill { actor?, name, template?: { type, stat, target, element }, setAside?, free? }:
 * a library skill (its stat requirements met, unless `free`: the story's opening gives it), a
 * story-taught skill already kept in party.custom, or a new one built by v1 skillFromTemplate at
 * the learner's level and kept in party.custom. At the cap of skills in use, `setAside` names
 * the one that sits out (v1 learnSkill).
 */
function learnSkill(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const actor = actorFrom(ctx, party, payload);
    const asked = String(payload.name ?? payload.skill ?? '').trim();
    if (!asked) fail(ctx, 'INVALID', 'Learn skill: a name is needed.');
    const library = findSkill(DEFAULT_SKILLS, asked);
    let found = library ?? findSkill(Object.values(party.custom), asked);
    if (library && !payload.free) {
        const { ok, missing } = canLearn(actor.stats, library);
        if (!ok) fail(ctx, 'REFUSED', `${actor.name} cannot learn ${library.name} yet: it needs ${Object.keys(missing).map(stat => `${stat} ${library.requires[stat]}`).join(', ')}.`);
    }
    if (!found) {
        if (!payload.template || typeof payload.template !== 'object') fail(ctx, 'NOT_FOUND', `"${asked}" is not in the skill library.`);
        found = skillFromTemplate({ name: asked, ...payload.template }, actor.level, rules);
        party.custom[found.name] = found;
    }
    if (skillKnown(actor, found.name)) fail(ctx, 'REFUSED', `${actor.name} already knows ${found.name}.`);
    const sheet = attempt(ctx, () => learnV1(toSheet(actor), found.name, { rules, setAside: payload.setAside ?? null }));
    const after = writeSheet(party, actor, sheet, rules);
    const aside = after.skills.find(skill => nameKey(skill.name) === nameKey(found.name))?.active === false;
    return { summary: `${actor.name} learns ${found.name}${aside ? ' (set aside for now)' : ''}.`, data: { actor: actor.id, skill: found.name }, narrate: true };
}

/** party.setSkillActive { actor?, name, active, swapOut? }: a skill put in use or set aside (v1 setSkillActive). */
function setSkillActive(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const actor = actorFrom(ctx, party, payload);
    const active = payload.active !== false;
    const current = actor.skills.find(skill => nameKey(skill.name) === nameKey(payload.name));
    if (!current) fail(ctx, 'NOT_FOUND', `${actor.name} does not know ${payload.name}.`);
    if (current.active === active) fail(ctx, 'REFUSED', `${current.name} is already ${active ? 'in use' : 'set aside'}.`);
    const sheet = attempt(ctx, () => setActiveV1(toSheet(actor), current.name, active, rules, { swapOut: payload.swapOut ?? null }));
    writeSheet(party, actor, sheet, rules);
    return { summary: `${actor.name} ${active ? 'takes up' : 'sets aside'} ${current.name}.`, data: { actor: actor.id, skill: current.name, active }, narrate: false };
}

/** party.forgetSkill { actor?, name }: a skill gone with its mastery and progress (v1 forgetSkill). */
function forgetSkill(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const actor = actorFrom(ctx, party, payload);
    const current = actor.skills.find(skill => nameKey(skill.name) === nameKey(payload.name));
    if (!current) fail(ctx, 'NOT_FOUND', `${actor.name} does not know ${payload.name}.`);
    writeSheet(party, actor, attempt(ctx, () => forgetV1(toSheet(actor), current.name)), rules);
    return { summary: `${actor.name} forgets ${current.name}.`, data: { actor: actor.id, skill: current.name }, narrate: false };
}

// ---------------------------------------------------------------------------------------
// HP, MP, SP

const gains = (before, after) => ({ hp: after.hp.cur - before.hp.cur, mp: after.mp.cur - before.mp.cur, sp: after.sp.cur - before.sp.cur });
const gainText = gain => [gain.hp ? `HP +${gain.hp}` : '', gain.mp ? `MP +${gain.mp}` : '', gain.sp ? `SP +${gain.sp}` : ''].filter(Boolean).join(', ');

/**
 * party.rest { kind: 'short' | 'long', actors?: [ids], reason? }: v1 recovery.rest for each
 * member, max HP/MP/SP first recomputed with what they wear now (their equipped inventory
 * stacks): a short rest gives back rules.recovery.shortRestShare, a long one fills everything
 * and ends fight conditions; any rest fills stamina.
 */
function rest(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const kind = payload.kind;
    if (kind !== 'short' && kind !== 'long') fail(ctx, 'INVALID', 'A rest is short or long.');
    const ids = Array.isArray(payload.actors) ? payload.actors : party.order;
    if (!ids.length) fail(ctx, 'NOT_FOUND', 'There is nobody in the party yet.');
    const inventory = readInventory(ctx);
    const parts = [];
    const data = {};
    for (const id of ids) {
        const actor = party.actors[id];
        if (!actor) fail(ctx, 'NOT_FOUND', 'That person is not in the party.');
        const sheet = toSheet(actor);
        const next = restV1(sheet, kind, { gear: gearOf(inventory, id, { pc: party.pc }), rules });
        const after = writeSheet(party, actor, next, rules);
        const gain = gains(actor, after);
        data[id] = gain;
        const text = gainText(gain);
        if (text) parts.push(`${actor.name} ${text}`);
    }
    const reason = String(payload.reason ?? '').trim().slice(0, 120);
    const head = `The party takes a ${kind} rest${reason ? ` (${reason})` : ''}`;
    return { summary: parts.length ? `${head}: ${parts.join('; ')}.` : `${head}. Nobody needed it.`, data: { kind, gains: data }, narrate: true };
}

function whole(ctx, value, what) {
    if (value === undefined || value === null) return 0;
    if (!Number.isInteger(value) || value < 0) fail(ctx, 'INVALID', `${what} must be a whole number, 0 or more.`);
    return value;
}

/**
 * party.heal / party.restore { actor, hp?, mp?, sp?, cure?: [conditions], item? } (internal, from
 * item.use): HP, MP and SP back, never above max, and conditions cured (v1 useItemOutside: a cure
 * lifts every condition whose name starts with the word). Rejected when it would change nothing,
 * so an item is never spent for nothing.
 */
function heal(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const actor = actorFrom(ctx, party, payload, { pcDefault: false });
    const hp = whole(ctx, payload.hp, 'HP');
    const mp = whole(ctx, payload.mp, 'MP');
    const sp = whole(ctx, payload.sp, 'SP');
    const cure = Array.isArray(payload.cure) ? payload.cure.map(entry => String(entry ?? '').trim()).filter(Boolean) : [];
    const item = String(payload.item ?? '').trim() || 'it';
    const sheet = toSheet(actor);
    const used = hp || mp || cure.length ? useItemOutside(sheet, { name: item, effect: { heal: hp, mp, cure } }) : { sheet, used: false };
    const next = used.used ? used.sheet : structuredClone(sheet);
    next.sp = { ...next.sp, cur: Math.min(next.sp.max, next.sp.cur + sp) };
    const gain = gains(sheet, next);
    const cured = sheet.conditions.filter(entry => !next.conditions.some(other => other.name === entry.name)).map(entry => entry.name);
    if (!gain.hp && !gain.mp && !gain.sp && !cured.length) fail(ctx, 'REFUSED', `${actor.name} does not need that now.`);
    writeSheet(party, actor, next, rules);
    const parts = [gain.hp ? `+${gain.hp} HP` : '', gain.mp ? `+${gain.mp} MP` : '', gain.sp ? `+${gain.sp} SP` : '', cured.length ? `cured ${cured.join(', ')}` : ''].filter(Boolean);
    return { summary: `${actor.name}: ${parts.join(', ')} (now ${next.hp.cur}/${next.hp.max} HP).`, data: { actor: actor.id, ...gain, cured }, narrate: false };
}

// ---------------------------------------------------------------------------------------
// Fights and XP

// The fight result with 'pc' (v1's id for your character) read as your character's actor id.
function normalResult(result, pc) {
    const id = key => (key === 'pc' && pc ? pc : key);
    const keyed = record => Object.fromEntries(Object.entries(record ?? {}).map(([key, value]) => [id(key), value]));
    return { ...result, party: (result.party ?? []).map(entry => ({ ...entry, memberId: id(entry.memberId) })), xp: keyed(result.xp), uses: keyed(result.uses) };
}

const poolOf = value => (Number.isFinite(value) ? { cur: value } : value && typeof value === 'object' ? { ...value } : undefined);

/**
 * combat.end's payload ({ outcome, stakes, actors: [{ id, hp, mp, sp?, down, conditions: [{ kind,
 * rounds }], uses: { [skill]: n } }] }) as the v1 summarize result v1 applyResult reads. XP is not
 * in it: combat gives that through party.grantXp.
 */
function resultFromActors(payload) {
    const actors = payload.actors.filter(entry => entry && typeof entry === 'object');
    return {
        outcome: payload.outcome ?? null,
        stakes: payload.stakes ?? null,
        party: actors.map(entry => ({
            memberId: entry.id,
            hp: poolOf(entry.hp),
            mp: poolOf(entry.mp),
            ...(entry.sp !== undefined ? { sp: poolOf(entry.sp) } : {}),
            down: Boolean(entry.down),
            conditions: (Array.isArray(entry.conditions) ? entry.conditions : []).map(cond => ({ name: String(cond?.kind ?? cond?.name ?? ''), rounds: Number.isInteger(cond?.rounds) ? cond.rounds : cond?.stacks ?? null })).filter(cond => cond.name),
        })),
        xp: {},
        uses: Object.fromEntries(actors.map(entry => [entry.id, entry.uses && typeof entry.uses === 'object' ? entry.uses : {}])),
    };
}

/**
 * party.applyResult (internal, from combat.end): combat's { outcome, stakes, actors: [{ id, hp,
 * mp, sp?, down, conditions: [{ kind, rounds }], uses }] }, or { result, stakes? } with v1 combat
 * summarize's result as it is. Applied to each member it names by v1 applyResult (HP/MP/SP and
 * lasting conditions as the fight left them, kept as party kinds: poison → poisoned; XP with
 * level-ups when the result carries any; skill mastery), companions on auto then spending by
 * build. A fight to the death that is lost leaves your character dead. Member ids are actor ids
 * ('pc' is read as your character).
 */
function applyResult(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const raw = Array.isArray(payload.actors) ? resultFromActors(payload) : payload.result;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.party)) fail(ctx, 'INVALID', 'That is not a fight result.');
    const result = normalResult(raw, party.pc);
    const named = new Set([...result.party.map(entry => entry.memberId), ...Object.keys(result.xp), ...Object.keys(result.uses)]);
    const ids = party.order.filter(id => named.has(id));
    if (!ids.length) fail(ctx, 'NOT_FOUND', 'That fight result names nobody in the party.');
    const levels = {};
    const mastery = {};
    for (const id of ids) {
        const actor = party.actors[id];
        const applied = applyResultV1(toSheet(actor), id, result, rules);
        let sheet = applied.sheet;
        if (id === party.pc && (payload.stakes ?? result.stakes) === 'death' && (result.outcome === 'defeat' || result.outcome === 'lost')) {
            sheet = { ...sheet, hp: { ...sheet.hp, cur: 0 }, conditions: [{ name: 'dead', rounds: null }] };
        }
        writeSheet(party, actor, sheet, rules);
        if (applied.levelsGained) levels[id] = applied.levelsGained;
        if (applied.masteryGained.length) mastery[id] = applied.masteryGained;
    }
    settle(party, ids, rules, settingsFor(ctx));
    const reached = Object.keys(levels).map(id => `${party.actors[id].name} reaches ${levelText(party.actors[id].level, rules)}`);
    return { summary: reached.length ? `${reached.join('; ')}.` : 'The fight is written to the party.', data: { actors: ids, levels, mastery }, narrate: false };
}

/**
 * party.grantXp (internal): XP with v1's level-ups. The payload MODULES §F5 names,
 * { actor?, amount?, quest?, difficulty? }, plus { actors?: [ids], xp?: n | { [actorId]: n },
 * kind?: 'minor'|'major'|'milestone', claim?, reason? }. No actor: the whole party. A kind or a
 * quest difficulty is v1's award (a share of each member's next level at the reader's XP rate,
 * growth.xpAward); an amount is given as it is. Companions on auto then spend by build. With
 * `claim` (or `quest`, claimed as `xp:quest:<quest>`) the award is given once on this line of
 * history (CLAIMED after).
 */
function grantXp(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const ids = Array.isArray(payload.actors) ? payload.actors : payload.actor ? [payload.actor] : [...party.order];
    if (!ids.length) fail(ctx, 'NOT_FOUND', 'There is nobody in the party yet.');
    for (const id of ids) if (!party.actors[id]) fail(ctx, 'NOT_FOUND', 'That person is not in the party.');
    const given = payload.xp ?? payload.amount;
    const byKind = given === undefined && (payload.kind || payload.difficulty);
    if (given === undefined && !byKind) fail(ctx, 'INVALID', 'Say how much XP, or how big the achievement was.');
    const share = byKind ? awardShare({ kind: payload.kind ?? null, difficulty: payload.kind ? null : payload.difficulty }, rules) : 0;
    if (byKind && (!share || (payload.kind && !['minor', 'major', 'milestone'].includes(payload.kind)))) fail(ctx, 'INVALID', `"${payload.kind ?? payload.difficulty}" is not an XP award.`);
    const amountFor = actor => {
        if (actor.level >= maxLevel(rules)) return 0;
        const value = byKind ? xpAward(share, actor.level, rules) : typeof given === 'object' && given ? given[actor.id] ?? 0 : given;
        if (!Number.isInteger(value) || value < 0) fail(ctx, 'INVALID', 'XP must be a whole number, 0 or more.');
        return value;
    };
    const amounts = ids.map(id => [id, amountFor(party.actors[id])]);
    if (amounts.every(([, xp]) => !xp)) fail(ctx, 'REFUSED', 'There is no XP to give (everyone is at the level cap, or the amount is 0).');
    const claim = payload.claim ? String(payload.claim) : payload.quest ? `xp:quest:${payload.quest}` : null;
    if (claim && !ctx.claim(claim)) fail(ctx, 'CLAIMED', 'That XP was already given.');
    const out = [];
    for (const [id, xp] of amounts) {
        if (!xp) continue;
        const actor = party.actors[id];
        const gained = gainXp(toSheet(actor), xp, rules);
        writeSheet(party, actor, gained.sheet, rules);
        out.push({ actor: id, xp, levels: gained.levelsGained });
    }
    settle(party, ids, rules, settingsFor(ctx));
    const reason = String(payload.reason ?? '').trim().slice(0, 120);
    const each = out.map(gain => `${party.actors[gain.actor].name} +${gain.xp} XP${gain.levels ? `, reaches ${levelText(party.actors[gain.actor].level, rules)}` : ''}`);
    return { summary: `${reason ? `${reason}: ` : ''}${each.join('; ')}.`, data: { gains: out }, narrate: true };
}

// ---------------------------------------------------------------------------------------
// Checks

/**
 * check.resolve { actor? | who?, skill, stat?, dc, what? }: a d20 for the member (your character
 * unless another is named), + v1's check modifier of the stat the skill word names (base stats,
 * as the v1 Checks line), against the difficulty; the outcome by Story Block's dice rules. The
 * roll is the receipt's (ctx.roll), so the same seed gives the same result.
 */
function resolveCheck(ctx, payload = {}) {
    const party = ctx.read('party');
    const rules = rulesFor(ctx);
    const actor = actorFrom(ctx, party, payload);
    const skill = String(payload.skill ?? '').trim().slice(0, 40);
    if (!skill && !payload.stat) fail(ctx, 'INVALID', 'A check needs a skill or a stat.');
    const stat = statForCheck(skill, payload.stat);
    const target = dcOf(payload.dc);
    if (!target) fail(ctx, 'INVALID', 'The difficulty is easy, normal, hard or a number from 1 to 40.');
    const rolled = typeof ctx.roll === 'function' ? ctx.roll('1d20') : null;
    const die = Math.min(20, Math.max(1, Math.round(Number(typeof rolled === 'number' ? rolled : rolled?.dice?.[0] ?? rolled?.total) || 0) || Math.floor(ctx.rng() * 20) + 1));
    const mod = checkModifier(actor.stats?.[stat] ?? rules.character.startStat, rules);
    const total = die + mod;
    const outcome = outcomeOf(die, mod, target.dc);
    const what = String(payload.what ?? '').trim().slice(0, 120);
    const sign = mod < 0 ? `− ${-mod}` : `+ ${mod}`;
    const summary = `${actor.name} tries ${skill || stat}${what ? ` (${what})` : ''}: d20 ${die} ${sign} ${stat} = ${total} against ${target.dc}${target.word ? ` (${target.word})` : ''}, ${OUTCOMES[outcome]}.`;
    return { summary, data: { actor: actor.id, skill, stat, die, mod, total, dc: target.dc, outcome }, narrate: true };
}

// ---------------------------------------------------------------------------------------
// Offers (from join and skill lines)

/**
 * party.acceptOffer { offer, …choices }: the reader takes a waiting offer. A join offer adds the
 * companion (party.addCompanion with the offer's name, role, level, focus and skills; the
 * reader's `control`, `focus` or `skills` win); a skill offer teaches the skill (party.learnSkill
 * with its template; `setAside` when the member already uses as many as they can).
 */
function acceptOffer(ctx, payload = {}) {
    const party = ctx.draft('party');
    const offer = party.offers.find(entry => entry.id === payload.offer);
    if (!offer) fail(ctx, 'NOT_FOUND', 'That offer is no longer waiting.');
    party.offers = party.offers.filter(entry => entry.id !== offer.id);
    if (offer.kind === 'join') {
        return addCompanion(ctx, {
            name: offer.name, role: offer.role, level: offer.level ?? undefined, npc: offer.npc, text: offer.text,
            focus: payload.focus ?? offer.focus, skills: payload.skills ?? offer.skills, control: payload.control,
        });
    }
    return learnSkill(ctx, { actor: offer.actor, name: offer.skill, template: offer.template, setAside: payload.setAside ?? null });
}

/** party.dismissOffer { offer }: the reader turns a waiting offer down. */
function dismissOffer(ctx, payload = {}) {
    const party = ctx.draft('party');
    const offer = party.offers.find(entry => entry.id === payload.offer);
    if (!offer) fail(ctx, 'NOT_FOUND', 'That offer is no longer waiting.');
    party.offers = party.offers.filter(entry => entry.id !== offer.id);
    const what = offer.kind === 'join' ? `${offer.name} does not join` : `${party.actors[offer.actor]?.name ?? 'Nobody'} does not learn ${offer.skill}`;
    return { summary: `${what}.`, data: { offer: offer.id }, narrate: false };
}

/** Adds an offer to the party (used by the join and skill kinds). */
export function addOffer(ctx, party, offer) {
    const id = newId(ctx, 'of', candidate => party.offers.some(entry => entry.id === candidate));
    const full = { id, ...offer, rev: revOf(ctx) };
    party.offers.push(full);
    return full;
}

export const handlers = {
    create, addCompanion, edit, removeCompanion, spend, learnSkill, setSkillActive, forgetSkill,
    rest, heal, applyResult, grantXp, resolveCheck, acceptOffer, dismissOffer,
};

export const commands = {
    'party.create': create,
    'party.addCompanion': addCompanion,
    'party.edit': edit,
    'party.removeCompanion': removeCompanion,
    'party.spend': spend,
    'party.learnSkill': learnSkill,
    'party.setSkillActive': setSkillActive,
    'party.forgetSkill': forgetSkill,
    'party.rest': rest,
    'party.applyResult': applyResult,
    'party.grantXp': grantXp,
    'party.heal': heal,
    'party.restore': heal,
    'party.acceptOffer': acceptOffer,
    'party.dismissOffer': dismissOffer,
    'check.resolve': resolveCheck,
};
