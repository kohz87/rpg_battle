// The party part's commands (MODULES §B1). Each handler is synchronous and pure apart from ctx
// (SPEC §3.2): it reads and drafts only through ctx, turns the actor it changes into a v1 Sheet,
// lets v1's rules do the sums (sheet.js newSheet / spendPoints / learnSkill / applyResult,
// party.js newCompanion, growth.js awards and auto-spend, recovery.js rests and items, story.js
// wounds), and writes the result back. A rule v1 enforces by throwing is a rejection here
// (INVALID, its own words); a command that would change nothing is rejected too, so nothing is
// saved for it. Summaries are code-written with code's numbers (SPEC §4.3).

import { STATS, checkModifier, maxHp, maxMp, maxSp } from '../../rules.js';
import { PRESETS, findSkill, skillFromTemplate, DEFAULT_SKILLS, canLearn } from '../../skills.js';
import { applyResult as applyResultV1, forgetSkill as forgetV1, learnSkill as learnV1, newSheet, setSkillActive as setActiveV1, spendPoints } from '../../sheet.js';
import { newCompanion } from '../../party.js';
import { QUEST_DIFFICULTIES, awardShare, gainXp, settleCompanions, spendByBuild, xpAward } from '../../growth.js';
import { rest as restV1, restAfter, useItemOutside } from '../../recovery.js';
import { cleanFocus, guessFocus, lockedReason, suggestSkills } from '../../builds.js';
import { COMPANION_LEVELS_ABOVE, companionStats, companionWeights, joinLevel } from './formula.js';
import { levelText, maxLevel, xpGainText, xpLabel } from '../../terms.js';
import { fromSheet, growthOf, wornGear, libraryOf, maxCompanionsOf, rulesFrom, rulesSliceOf, settingsOf, toSheet } from './sheets.js';
import { pinnedSettings } from '../progress/level.js';
import { exportCharacter, originIds, readCharacter } from './portable.js';
import { defineItem } from '../items/define.js';
import { OUTCOMES, dcOf, outcomeOf, statForCheck } from './checks.js';
import { sessionOf } from '../combat/stored.js';
import { filledBy, fitActor, fitParty, fitPool, storedPool } from './pools.js';
import { foldStoryTime } from './recovery.js';
import { actorFrom, actorsInOrder, attempt, cleanName, cleanRole, fail, nameKey, newId, offersRecord, revOf, waitingOffers } from './util.js';
import { startRulesClass } from '../progress/start.js';
import { rulesFightResult } from '../death/fight.js';
import { preserveInjury } from '../death/injury.js';

// Skills learned onto a built sheet, in order (v1 newSheet's own loop, for a sheet made from final stats).
const newSheetSkills = (sheet, skills, rules) => skills.reduce((out, skill) => learnV1(out, skill, { rules }), sheet);
const settingsFor = ctx => pinnedSettings(settingsOf(typeof ctx?.settings === 'function' ? ctx.settings() : null), rulesSliceOf(ctx));
const rulesFor = ctx => rulesFrom(settingsFor(ctx), rulesSliceOf(ctx));

function readInventory(ctx) {
    try {
        return ctx.read('inventory');
    } catch {
        return null;
    }
}

/** The actor's record rewritten from a v1 Sheet (`options.filled`: the pools a rest filled, fromSheet). */
function writeSheet(ctx, party, actor, sheet, rules, options) {
    party.actors[actor.id] = preserveInjury(ctx, actor, fromSheet(actor, sheet, rules, options));
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

/**
 * v1 settleCompanions on the companions: those whose points are on auto (MODULES §F29, growthOf)
 * spend them by build when the setting allows; v1's 'command' is a companion on manual.
 */
function settle(ctx, party, ids, rules, settings) {
    const members = ids.map(id => party.actors[id]).filter(actor => actor?.kind === 'companion')
        .map(actor => ({ id: actor.id, name: actor.name, control: growthOf(actor) === 'manual' ? 'command' : 'auto', sheet: toSheet(actor) }));
    for (const member of settleCompanions(members, { autoSpend: settings.autoSpend !== false, rules })) {
        writeSheet(ctx, party, party.actors[member.id], member.sheet, rules);
    }
}

/**
 * The fight that has the party now, or null: one under way, or over and not yet settled
 * (combat.end). While there is one, nobody leaves and your character is not remade, so the
 * fight's result always finds the people who fought it (QA #75).
 */
export function fightOn(ctx) {
    let combat = null;
    try {
        combat = ctx.read('combat');
    } catch {
        combat = null;
    }
    return sessionOf(combat);
}

/** The story clock now (ctx.time(): Story Director's minutes), or null without one. */
function storyMinute(ctx) {
    try {
        const now = typeof ctx?.time === 'function' ? ctx.time() : null;
        const minutes = now && typeof now === 'object' ? now.minutes : now;
        return Number.isInteger(minutes) && minutes >= 0 ? minutes : null;
    } catch {
        return null;
    }
}

/** Is this actor dead (a lost fight to the death: party.applyResult's `dead` mark)? */
export const isDead = actor => (actor?.conditions ?? []).some(entry => (entry?.kind ?? entry?.name) === 'dead');

/**
 * Commands only another part may send (MODULES §B1: from combat.end, quests, item.use, an accepted
 * offer), never a button: a click with no calling module is refused, as party.fightPools and
 * party.import are.
 */
function internalOnly(ctx, why) {
    if (ctx.cause === 'ui' && !ctx.caller) fail(ctx, 'REFUSED', why);
}

// The most offers of one kind (join, skill, leave) that wait for the reader at once (B1-12).
export const MAX_OFFERS_PER_KIND = 10;

function refuseInFight(ctx, what) {
    const session = fightOn(ctx);
    if (!session) return;
    fail(ctx, 'REFUSED', session.status === 'active' ? `A fight is under way: ${what} after it.` : `The last fight is not settled yet: finish it, then ${what}.`);
}

/**
 * What someone leaving the party carried goes to the party's bag: every stack they own
 * (inventory.transfer, which also takes worn pieces off) and the coin in their purse
 * (wallet.pay from them, wallet.receive by the party), so nothing is left with an id that is no
 * longer in the party. A host without the inventory commands (UNKNOWN_COMMAND) leaves it as it is.
 * → { stacks, coin } handed over.
 */
function handOver(ctx, actor) {
    const inventory = readInventory(ctx);
    const carried = Object.entries(inventory?.stacks ?? {}).filter(([, stack]) => stack?.owner === actor.id).map(([id]) => id).sort();
    let stacks = 0;
    for (const stack of carried) {
        try {
            ctx.call('inventory.transfer', { stack, to: 'party' });
            stacks += 1;
        } catch (error) {
            if (error?.code !== 'UNKNOWN_COMMAND') throw error;
            break;
        }
    }
    const coin = Number(inventory?.wallets?.[actor.id]?.coin) || 0;
    if (coin > 0) {
        try {
            ctx.call('wallet.pay', { owner: actor.id, amount: coin, note: `${actor.name} leaves the party` });
            ctx.call('wallet.receive', { owner: 'party', amount: coin, note: `from ${actor.name}` });
        } catch (error) {
            if (error?.code !== 'UNKNOWN_COMMAND') throw error;
            return { stacks, coin: 0 };
        }
    }
    return { stacks, coin };
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
    if (party.pc) refuseInFight(ctx, 'remake your character');
    const preset = payload.preset ? PRESETS.find(entry => entry.id === payload.preset) : null;
    if (payload.preset && !preset) fail(ctx, 'NOT_FOUND', `There is no "${payload.preset}" preset.`);
    const points = payload.points ?? preset?.points ?? {};
    if (!points || typeof points !== 'object' || Array.isArray(points)) fail(ctx, 'INVALID', 'Points must say how many go into each stat.');
    const name = cleanName(payload.name);
    if (!name) fail(ctx, 'INVALID', 'New character: a name is needed.');
    if (nameTaken(party, name, party.pc)) fail(ctx, 'REFUSED', `There is already a ${name} in the party.`);
    const wanted = [...new Set((payload.skills ?? preset?.skills ?? []).map(entry => String(entry ?? '').trim()).filter(Boolean))];
    if (wanted.length > rules.character.starterSkills) fail(ctx, 'REFUSED', `A new character starts with ${rules.character.starterSkills} skills at most.`);
    // A race and talents (MODULES §F14): the creation part's checked final stats for them.
    let built = null;
    if (payload.origin !== undefined && payload.origin !== null) {
        if (typeof payload.origin !== 'object' || Array.isArray(payload.origin)) fail(ctx, 'INVALID', 'The origin must be { race, talents }.');
        try {
            built = ctx.query('creation.build', { race: payload.origin.race ?? '', talents: payload.origin.talents ?? [], points, settings: settingsFor(ctx) });
        } catch {
            fail(ctx, 'NOT_FOUND', 'Races and talents need the character creation part.');
        }
        if (!built?.ok) fail(ctx, built?.code ?? 'INVALID', built?.message ?? 'That race or those talents cannot be taken.');
    }
    // v1 newSheet with the final stats: the start points it checks are the ones the stats were bought with.
    const build = skills => {
        if (!built) return newSheet({ name, stats: points, skills }, rules);
        const spentPoints = Object.values(built.points).reduce((sum, n) => sum + n, 0);
        const local = { ...rules, character: { ...rules.character, startPoints: spentPoints, statCap: 0 } };
        const out = newSheet({ name, stats: built.points, skills: [] }, local);
        out.stats = { ...built.stats };
        for (const [key, fn] of [['hp', maxHp], ['mp', maxMp], ['sp', maxSp]]) { const max = fn(out.stats, 1, rules); out[key] = { cur: max, max }; }
        return skills.length ? newSheetSkills(out, skills, rules) : out;
    };
    const sheet = attempt(ctx, () => build([]));
    const skills = wanted.map(skillName => {
        const found = findSkill(DEFAULT_SKILLS, skillName);
        if (!found) fail(ctx, 'NOT_FOUND', `"${skillName}" is not in the skill library.`);
        const why = lockedReason(sheet.stats, found);
        if (why) fail(ctx, 'REFUSED', `${name} cannot take ${found.name}: it ${why}.`);
        return found.name;
    });
    const full = attempt(ctx, () => build(skills));
    const old = party.pc;
    // A new id even in place of an old character; what the old one carried goes to the party's bag.
    const id = newId(ctx, 'ac', candidate => Boolean(party.actors[candidate]));
    if (old) {
        if (party.actors[old]) handOver(ctx, party.actors[old]);
        delete party.actors[old];
        // Their waiting offers go (each a key of its own: one a deleted reply made is passed over on replay).
        dropOffersFor(party, old);
    }
    const background = String(payload.background ?? '').trim().slice(0, 2000);
    writeSheet(ctx, party, {
        id, kind: 'pc', control: 'player', role: cleanRole(payload.role ?? ''), npc: null, portrait: portraitOf(ctx, payload.portrait),
        ...(background ? { background } : {}), ...(built ? { origin: built.origin } : {}),
    }, full, rules);
    party.pc = id;
    party.order = [id, ...party.order.filter(entry => entry !== old && entry !== id)];
    // Rules v2: the basic class of the new character, recorded here and nowhere else (a rules chat refuses a character with none;
    // nothing at all in a chat with no rules pack). creation.finish passes the wizard's class down to this.
    startRulesClass(ctx, { actor: id, class: payload.class, checkActor: payload.checkActor, pc: true });
    return { summary: `${name} is ready.`, data: { actor: id }, narrate: false };
}

/**
 * party.addCompanion { name, role?, level?, preset?, focus?: [stats], skills?: [names], control?:
 * 'auto' | 'player', growth?: 'auto' | 'manual', npc?, portrait? }: a companion by formula
 * (MODULES §F91, formula.js): the level given, held to at most COMPANION_LEVELS_ABOVE above your
 * character's, else within one level of your character; the stat points a character of that level
 * has by your character's rule, spread by the preset's or the role's (focus) weights; the skills given or, without any,
 * the ones v1 suggestSkills picks for those stats. Fights on auto and points spent by build
 * unless told otherwise (MODULES §F29, §F49); refused when the party already has as many
 * companions as the setting allows (§F48). Internal (an accepted join offer, another part):
 * refused from a click.
 */
function addCompanion(ctx, payload = {}) {
    internalOnly(ctx, 'A companion joins from the story (an accepted join offer), not from a button.');
    return joinParty(ctx, payload);
}

/** addCompanion's work, for an accepted join offer too (a click on Accept: no calling module). */
function joinParty(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const name = cleanName(payload.name);
    if (!name) fail(ctx, 'INVALID', 'Give the companion a name.');
    if (payload.control !== undefined && payload.control !== null && payload.control !== 'player' && payload.control !== 'auto') fail(ctx, 'INVALID', 'Control is player or auto.');
    if (payload.growth !== undefined && payload.growth !== null && payload.growth !== 'manual' && payload.growth !== 'auto') fail(ctx, 'INVALID', 'Stat points are spent on auto or by hand (manual).');
    const most = maxCompanionsOf(settingsFor(ctx));
    const companions = actorsInOrder(party).filter(actor => actor.kind === 'companion').length;
    if (companions >= most) fail(ctx, 'REFUSED', most ? `The party is full: ${most} companion${most === 1 ? '' : 's'} beside you at most.` : 'Companions are switched off in this chat.');
    if (nameTaken(party, name)) fail(ctx, 'REFUSED', `There is already a ${name} in the party.`);
    const role = cleanRole(payload.role ?? '') || 'companion';
    const pc = party.pc ? party.actors[party.pc] : null;
    const asked = Number(payload.level);
    if (payload.level !== undefined && payload.level !== null && !(Number.isInteger(asked) && asked >= 1)) fail(ctx, 'INVALID', 'The level must be a whole number from 1.');
    // MODULES §F91 (formula.js): the level given is held to at most two above your character's
    // (B-b3-16); without one, within one level of your character, by the receipt's dice.
    const level = joinLevel({ asked: payload.level ? asked : null, pcLevel: pc?.level ?? 1, rules, rng: () => ctx.rng() });
    const focus = cleanFocus(payload.focus?.length ? payload.focus : guessFocus(role, payload.text ?? ''));
    // The stats by formula: your character's points for that level, spread by the preset's or the role's weights.
    const stats = companionStats({ level, weights: companionWeights({ preset: payload.preset ?? null, role, focus }), rules });
    const library = libraryOf(party);
    const wanted = Array.isArray(payload.skills) && payload.skills.length
        ? payload.skills.map(skill => findSkill(library, skill)?.name ?? String(skill ?? '').trim()).filter(Boolean)
        : suggestSkills(stats, focus, DEFAULT_SKILLS, { role, count: rules.character.starterSkills });
    const skills = [...new Set(wanted)];
    if (skills.length > rules.character.starterSkills) fail(ctx, 'REFUSED', `A new companion starts with ${rules.character.starterSkills} skills at most.`);
    for (const skillName of skills) {
        const found = findSkill(library, skillName);
        if (!found) fail(ctx, 'REFUSED', `"${skillName}" is not in the skill library.`);
        const why = lockedReason(stats, found);
        if (why) fail(ctx, 'REFUSED', `${name} cannot take ${found.name}: it ${why}.`);
    }
    const member = attempt(ctx, () => newCompanion({ name, role, control: payload.control === 'player' ? 'command' : 'auto', level, focus, skills: [] }, { rules, existing: [], library }));
    // The formula's stats with full HP, MP and SP for them, then the skills (v1 learnSkill).
    let sheet = { ...member.sheet, level, stats: { ...stats } };
    for (const [pool, fn] of [['hp', maxHp], ['mp', maxMp], ['sp', maxSp]]) { const max = fn(stats, level, rules); sheet[pool] = { cur: max, max }; }
    sheet = attempt(ctx, () => newSheetSkills(sheet, skills, rules));
    const id = newId(ctx, 'ac', candidate => Boolean(party.actors[candidate]));
    const npc = payload.npc ? String(payload.npc).trim().slice(0, 80) || null : null;
    writeSheet(ctx, party, { id, kind: 'companion', control: payload.control === 'player' ? 'player' : 'auto', growth: payload.growth === 'manual' ? 'manual' : 'auto', role: member.role, npc, portrait: portraitOf(ctx, payload.portrait) }, sheet, rules);
    party.order.push(id);
    // Rules v2: the companion's basic class, chosen by the player (nothing at all in a chat with no rules pack).
    startRulesClass(ctx, { actor: id, class: payload.class });
    return { summary: `${name} joins the party (${levelText(level, rules)}, ${member.role}).`, data: { actor: id, level }, narrate: true };
}

export { COMPANION_LEVELS_ABOVE };

/**
 * party.edit { actor, name?, role?, control?, growth?, npc?, portrait? }: v1 editCompanion's rules
 * (a name cleaned for the heading, never another member's; a role, else 'companion'). Ids never
 * change in v2. Your character is always played by you and spends their own points. The two
 * per-companion toggles (MODULES §F29, §F49): `control` (fights: 'auto' or 'player') and `growth`
 * (stat points: 'auto', spent by build at once and at every level, or 'manual').
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
    if (payload.growth !== undefined) {
        if (payload.growth !== 'manual' && payload.growth !== 'auto') fail(ctx, 'INVALID', 'Stat points are spent on auto or by hand (manual).');
        if (actor.kind === 'pc') fail(ctx, 'REFUSED', 'Your character\'s points are yours to spend.');
        next.growth = payload.growth;
    }
    if (payload.npc !== undefined) next.npc = payload.npc ? String(payload.npc).trim().slice(0, 80) || null : null;
    if (payload.portrait !== undefined) next.portrait = portraitOf(ctx, payload.portrait);
    const growthChanged = actor.kind === 'companion' && payload.growth !== undefined && growthOf(next) !== growthOf(actor);
    if (!growthChanged && ['name', 'role', 'control', 'npc', 'portrait'].every(key => (next[key] ?? null) === (actor[key] ?? null))) fail(ctx, 'REFUSED', 'Nothing to change.');
    party.actors[actor.id] = next;
    // Turned to auto with points waiting: spent by build now, as at a level-up (v1 spendByBuild).
    let spent = 0;
    if (growthChanged && next.growth === 'auto' && next.points > 0 && settingsFor(ctx).autoSpend !== false) {
        const rules = rulesFor(ctx);
        const sheet = spendByBuild(toSheet(next), rules);
        spent = next.points - sheet.points;
        writeSheet(ctx, party, next, sheet, rules);
    }
    const parts = [];
    if (next.name !== actor.name) parts.push(`${actor.name} is now called ${next.name}`);
    if ((next.control ?? null) !== (actor.control ?? null)) parts.push(`${next.name} ${next.control === 'player' ? 'takes your orders' : 'fights on their own'} in fights`);
    if (growthChanged) parts.push(`${next.name}'s stat points are ${next.growth === 'auto' ? `spent by build${spent ? ` (${spent} spent now)` : ''}` : 'yours to spend'}`);
    return { summary: parts.length ? `${parts.join('; ')}.` : `${next.name} is updated.`, data: { actor: actor.id, ...(growthChanged ? { growth: next.growth, spent } : {}) }, narrate: false };
}

/**
 * A companion taken out of the party: the record, their place in the order, the offers waiting
 * for them; what they carried and their coin go to the party's bag (handOver), so nothing is left
 * with someone who is not there. → what was handed over.
 */
function dropMember(ctx, party, actor) {
    const handed = handOver(ctx, actor);
    delete party.actors[actor.id];
    party.order = party.order.filter(id => id !== actor.id);
    dropOffersFor(party, actor.id);
    return handed;
}

/**
 * party.removeCompanion { actor }: a companion leaves (their waiting offers go too; what they
 * carried goes to the party). Refused while a fight has the party (until combat.end settles it).
 */
function removeCompanion(ctx, payload = {}) {
    const party = ctx.draft('party');
    const actor = actorFrom(ctx, party, payload, { pcDefault: false });
    if (actor.kind !== 'companion') fail(ctx, 'REFUSED', 'Only a companion can leave the party.');
    refuseInFight(ctx, `${actor.name} can leave`);
    const handed = dropMember(ctx, party, actor);
    return { summary: `${actor.name} leaves the party${handed.stacks || handed.coin ? '; what they carried stays with the party' : ''}.`, data: { actor: actor.id, handed }, narrate: true };
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
    const before = toSheet(actor);
    const sheet = attempt(ctx, () => spendPoints(before, points, rules));
    const total = before.points - sheet.points;
    if (!total) fail(ctx, 'INVALID', 'Choose where the points go.');
    writeSheet(ctx, party, actor, sheet, rules);
    const spent = STATS.filter(stat => sheet.stats[stat] !== before.stats[stat]).map(stat => `${stat} ${sheet.stats[stat]}`).join(', ');
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
        found = skillFromTemplate({ name: asked, ...payload.template }, fitActor(actor).level, rules);
        // A pack skill's own words (MODULES §F14 presets) describe it; the numbers stay the rules'.
        const note = typeof payload.template.note === 'string' ? payload.template.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
        if (note) found.description = note;
        party.custom[found.name] = found;
    }
    if (skillKnown(actor, found.name)) fail(ctx, 'REFUSED', `${actor.name} already knows ${found.name}.`);
    const sheet = attempt(ctx, () => learnV1(toSheet(actor), found.name, { rules, setAside: payload.setAside ?? null }));
    const after = writeSheet(ctx, party, actor, sheet, rules);
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
    writeSheet(ctx, party, actor, sheet, rules);
    return { summary: `${actor.name} ${active ? 'takes up' : 'sets aside'} ${current.name}.`, data: { actor: actor.id, skill: current.name, active }, narrate: false };
}

/** party.forgetSkill { actor?, name }: a skill gone with its mastery and progress (v1 forgetSkill). */
function forgetSkill(ctx, payload = {}) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const actor = actorFrom(ctx, party, payload);
    const current = actor.skills.find(skill => nameKey(skill.name) === nameKey(payload.name));
    if (!current) fail(ctx, 'NOT_FOUND', `${actor.name} does not know ${payload.name}.`);
    writeSheet(ctx, party, actor, attempt(ctx, () => forgetV1(toSheet(actor), current.name)), rules);
    return { summary: `${actor.name} forgets ${current.name}.`, data: { actor: actor.id, skill: current.name }, narrate: false };
}

// ---------------------------------------------------------------------------------------
// HP, MP, SP

// What a member gained, from their numbers as they stood (pools.js fitActor) to after.
const gains = (record, result) => {
    const before = fitActor(record);
    const after = fitActor(result);
    return { hp: after.hp.cur - before.hp.cur, mp: after.mp.cur - before.mp.cur, sp: after.sp.cur - before.sp.cur };
};
const gainText = gain => [gain.hp ? `HP +${gain.hp}` : '', gain.mp ? `MP +${gain.mp}` : '', gain.sp ? `SP +${gain.sp}` : ''].filter(Boolean).join(', ');

/**
 * party.rest { kind: 'short' | 'long', actors?: [ids], reason? }: v1 recovery.rest for each
 * member, max HP/MP/SP first recomputed with what they wear now (their equipped inventory
 * stacks): a short rest gives back rules.recovery.shortRestShare, a long one fills everything
 * and ends fight conditions; any rest fills stamina. What it fills is stored as full ("restore to
 * full", pools.js), so a replay after an earlier reply was deleted still finds the member rested.
 * Story time is folded in first (recovery.js); a short rest then gives only what its share adds beyond
 * what that time gave (v1 restAfter: one stretch of time, not two).
 */
function rest(ctx, payload = {}) {
    const timeFold = payload.kind === 'short' || payload.kind === 'long' ? foldStoryTime(ctx) : null;
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const kind = payload.kind;
    if (kind !== 'short' && kind !== 'long') fail(ctx, 'INVALID', 'A rest is short or long.');
    if (fightOn(ctx)?.status === 'active') fail(ctx, 'REFUSED', 'There is no resting in the middle of a fight.');
    const asked = Array.isArray(payload.actors) ? payload.actors : party.order;
    if (!asked.length) fail(ctx, 'NOT_FOUND', 'There is nobody in the party yet.');
    for (const id of asked) if (!party.actors[id]) fail(ctx, 'NOT_FOUND', 'That person is not in the party.');
    // The dead do not rest back to life (B-b4-12).
    const ids = asked.filter(id => !isDead(party.actors[id]));
    if (!ids.length) fail(ctx, 'REFUSED', `${listNames(asked.map(id => party.actors[id].name))} ${asked.length === 1 ? 'is' : 'are'} dead: no rest brings the dead back.`);
    const inventory = readInventory(ctx);
    const parts = [];
    const data = {};
    for (const id of ids) {
        const actor = party.actors[id];
        const sheet = toSheet(actor);
        const gear = wornGear((name, args) => ctx.query(name, args), inventory, id, { pc: party.pc });
        const already = timeFold?.gains?.[id] ?? null;
        const rested = already ? restAfter(sheet, kind, { gear, rules, already }) : restV1(sheet, kind, { gear, rules });
        // Any rest ends what a fight left (a bleed with rounds to go, B-c1-1); a story's condition waits for a long one.
        const next = { ...rested, conditions: (rested.conditions ?? []).filter(entry => !Number.isInteger(entry.rounds)) };
        const after = writeSheet(ctx, party, actor, next, rules, { filled: filledBy(kind) });
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
 * so an item is never spent for nothing, for the dead, and from a click (internal).
 */
function heal(ctx, payload = {}) {
    internalOnly(ctx, 'HP and MP come back by using something (item.use) or resting, not from a button.');
    // Story time first (recovery.js), so the item heals what is still missing after it.
    if (fightOn(ctx)?.status !== 'active') foldStoryTime(ctx);
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const actor = actorFrom(ctx, party, payload, { pcDefault: false });
    if (isDead(actor)) fail(ctx, 'REFUSED', `${actor.name} is dead: nothing brings the dead back.`);
    // In a fight, HP follows the fight (party.fightPools): a draught is drunk there, as a fight action.
    if (fightOn(ctx)?.status === 'active') fail(ctx, 'REFUSED', 'A fight is under way: use it in the fight.');
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
    const proposed = preserveInjury(ctx, actor, fromSheet(actor, next, rules));
    const cured = sheet.conditions.filter(entry => !proposed.conditions.some(other => other.kind === entry.name)).map(entry => entry.name);
    if (!gain.hp && !gain.mp && !gain.sp && !cured.length) fail(ctx, 'REFUSED', `${actor.name} does not need that now.`);
    writeSheet(ctx, party, actor, next, rules);
    const parts = [gain.hp ? `+${gain.hp} HP` : '', gain.mp ? `+${gain.mp} MP` : '', gain.sp ? `+${gain.sp} SP` : '', cured.length ? `cured ${cured.join(', ')}` : ''].filter(Boolean);
    return { summary: `${actor.name}: ${parts.join(', ')} (now ${next.hp.cur}/${next.hp.max} HP).`, data: { actor: actor.id, ...gain, cured }, narrate: false };
}

// ---------------------------------------------------------------------------------------
// Fights and XP

/**
 * party.fightPools { actors: [{ id, hp?, mp?, sp? }] } (internal, from combat.start / combat.act):
 * current HP, MP and SP as the running fight has them, never above max, so every view of the
 * party agrees with the battle board. Members no longer in the party are passed over; a pool
 * already at that number stays. combat.end's applyResult still writes the result.
 */
function fightPools(ctx, payload = {}) {
    if (ctx.cause === 'ui' && !ctx.caller) fail(ctx, 'REFUSED', 'HP in a fight follows the fight.');
    if (!Array.isArray(payload.actors)) fail(ctx, 'INVALID', 'Say whose HP, MP and SP the fight changed.');
    const party = ctx.draft('party');
    const changed = [];
    for (const entry of payload.actors) {
        const actor = party.actors[entry?.id];
        if (!actor || isDead(actor)) continue;
        for (const key of ['hp', 'mp', 'sp']) {
            if (entry[key] === undefined) continue;
            if (!Number.isInteger(entry[key]) || entry[key] < 0) fail(ctx, 'INVALID', `${key.toUpperCase()} must be a whole number, 0 or more.`);
            const now = fitPool(actor[key]);
            const cur = Math.min(now.max, entry[key]);
            if (cur !== now.cur) {
                actor[key] = storedPool({ cur, max: now.max });
                if (!changed.includes(actor.id)) changed.push(actor.id);
            }
        }
    }
    return { summary: changed.length ? `${listNames(changed.map(id => party.actors[id].name))}: as the fight left them.` : 'Nothing moved.', data: { actors: changed }, narrate: false };
}

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
 * lasting conditions as the fight left them, kept as party kinds: poison → poisoned; skill mastery), companions on auto then spending by
 * build. A fight to the death that is lost leaves your character dead; a companion who went down
 * in a fight to the death died and is gone from the party for good (MODULES §F26, no offer: what
 * they carried goes to the party). Member ids are actor ids ('pc' is read as your character).
 */
function applyResult(ctx, payload = {}) {
    internalOnly(ctx, 'A fight\'s result is written by the fight (combat.end), not from a button.');
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const raw = Array.isArray(payload.actors) ? resultFromActors(payload) : payload.result;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.party)) fail(ctx, 'INVALID', 'That is not a fight result.');
    const result = { ...normalResult(raw, party.pc), xp: {} };
    const named = new Set([...result.party.map(entry => entry.memberId), ...Object.keys(result.xp), ...Object.keys(result.uses)]);
    const ids = party.order.filter(id => named.has(id));
    if (!ids.length) fail(ctx, 'NOT_FOUND', 'That fight result names nobody in the party.');
    const levels = {};
    const mastery = {};
    for (const id of ids) {
        const actor = party.actors[id];
        const applied = applyResultV1(toSheet(actor), id, result, rules);
        let sheet = applied.sheet;
        if (!rulesFightResult(ctx) && id === party.pc && (payload.stakes ?? result.stakes) === 'death' && (result.outcome === 'defeat' || result.outcome === 'lost')) {
            sheet = { ...sheet, hp: { ...sheet.hp, cur: 0 }, conditions: [{ name: 'dead', rounds: null }] };
        }
        // What the fight left keeps its rounds and the story minute it ended (sheets.js conditionRecord).
        writeSheet(ctx, party, actor, sheet, rules, { at: storyMinute(ctx) });
        if (applied.levelsGained) levels[id] = applied.levelsGained;
        if (applied.masteryGained.length) mastery[id] = applied.masteryGained;
    }
    // MODULES §F26: in a fight to the death, a companion who went down died.
    const toTheDeath = !rulesFightResult(ctx) && (payload.stakes ?? result.stakes) === 'death';
    const fallen = toTheDeath
        ? ids.filter(id => id !== party.pc && party.actors[id]?.kind === 'companion' && result.party.some(entry => entry.memberId === id && (entry.down || entry.hp?.cur === 0)))
        : [];
    const died = fallen.map(id => ({ id, name: party.actors[id].name }));
    for (const id of fallen) dropMember(ctx, party, party.actors[id]);
    const living = ids.filter(id => party.actors[id]);
    settle(ctx, party, living, rules, settingsFor(ctx));
    const reached = Object.keys(levels).filter(id => party.actors[id]).map(id => `${party.actors[id].name} reaches ${levelText(party.actors[id].level, rules)}`);
    const lost = died.length ? [`${listNames(died.map(entry => entry.name))} died in the fight and ${died.length === 1 ? 'is' : 'are'} gone from the party for good`] : [];
    const said = [...lost, ...reached];
    return {
        summary: said.length ? `${said.join('; ')}.` : 'The fight is written to the party.',
        data: { actors: living, levels: Object.fromEntries(Object.entries(levels).filter(([id]) => party.actors[id])), mastery: Object.fromEntries(Object.entries(mastery).filter(([id]) => party.actors[id])), died },
        narrate: died.length > 0,
    };
}

/**
 * party.grantXp (internal): XP with v1's level-ups. The payload MODULES §F5 names,
 * { actor?, amount?, quest?, difficulty? }, plus { actors?: [ids], xp?: n | { [actorId]: n },
 * kind?: 'minor'|'major'|'milestone', claim?, reason? }. No actor: the whole party. A kind or a
 * quest difficulty is v1's award (a share of each member's next level at the reader's XP rate,
 * growth.xpAward); an amount is given as it is. Companions on auto then spend by build. With
 * `claim` (claimed as `xp:<claim>`, so it can never be another rule's key) or `quest` (claimed as
 * `xp:quest:<quest>`) the award is given once on this line of history (CLAIMED after). Internal:
 * refused from a click.
 */
function grantXp(ctx, payload = {}) {
    internalOnly(ctx, 'XP comes from fights, quests and the story, not from a button.');
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const ids = Array.isArray(payload.actors) ? payload.actors : payload.actor ? [payload.actor] : [...party.order];
    if (!ids.length) fail(ctx, 'NOT_FOUND', 'There is nobody in the party yet.');
    for (const id of ids) if (!party.actors[id]) fail(ctx, 'NOT_FOUND', 'That person is not in the party.');
    const given = payload.xp ?? payload.amount;
    const byKind = given === undefined && (payload.kind || payload.difficulty);
    if (given === undefined && !byKind) fail(ctx, 'INVALID', 'Say how much XP, or how big the achievement was.');
    // A quest difficulty is one of v1's words (growth.QUEST_DIFFICULTIES); any other is refused, not read as normal.
    if (byKind && !payload.kind && !QUEST_DIFFICULTIES.includes(String(payload.difficulty ?? '').trim().toLowerCase())) {
        fail(ctx, 'INVALID', `"${payload.difficulty}" is not a quest difficulty (${QUEST_DIFFICULTIES.join(', ')}).`);
    }
    const share = byKind ? awardShare({ kind: payload.kind ?? null, difficulty: payload.kind ? null : payload.difficulty }, rules) : 0;
    if (byKind && (!share || (payload.kind && !['minor', 'major', 'milestone'].includes(payload.kind)))) fail(ctx, 'INVALID', `"${payload.kind ?? payload.difficulty}" is not an XP award.`);
    const amountFor = record => {
        const actor = fitActor(record);
        if (actor.level >= maxLevel(rules)) return 0;
        const value = byKind ? xpAward(share, actor.level, rules) : typeof given === 'object' && given ? given[actor.id] ?? 0 : given;
        if (!Number.isInteger(value) || value < 0) fail(ctx, 'INVALID', 'XP must be a whole number, 0 or more.');
        return value;
    };
    const amounts = ids.map(id => [id, amountFor(party.actors[id])]);
    const capped = ids.every(id => fitActor(party.actors[id]).level >= maxLevel(rules));
    if (!capped && amounts.every(([, xp]) => !xp)) fail(ctx, 'REFUSED', 'There is no XP to give (the amount is 0).');
    // An XP claim lives in its own key space: a caller's key can never take another rule's claim
    // (`combat:<id>:end`, a quest's payment), B-b3-11.
    const key = payload.claim ? String(payload.claim) : payload.quest ? `quest:${payload.quest}` : null;
    const claim = key === null ? null : key.startsWith('xp:') ? key : `xp:${key}`;
    if (claim && !ctx.claim(claim)) fail(ctx, 'CLAIMED', 'That XP was already given.');
    // Everyone named is at the level cap: nothing to give, and that is no failure (a fight still settles, QA #75).
    if (capped) {
        const names = listNames(ids.map(id => party.actors[id].name));
        return { summary: `${names} ${ids.length === 1 ? 'is' : 'are'} at the level cap: no ${xpLabel(rules)} to give.`, data: { gains: [] }, narrate: false };
    }
    const out = [];
    for (const [id, xp] of amounts) {
        if (!xp) continue;
        const actor = party.actors[id];
        const gained = gainXp(toSheet(actor), xp, rules);
        writeSheet(ctx, party, actor, gained.sheet, rules);
        out.push({ actor: id, xp, levels: gained.levelsGained });
    }
    settle(ctx, party, ids, rules, settingsFor(ctx));
    const reason = String(payload.reason ?? '').trim().slice(0, 120);
    const xpWord = xpLabel(rules);
    const each = out.map(gain => `${party.actors[gain.actor].name} ${xpWord} ${xpGainText(gain.xp)}${gain.levels ? `, reaches ${levelText(party.actors[gain.actor].level, rules)}` : ''}`);
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
    const actor = fitActor(actorFrom(ctx, party, payload));
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
// Your character as a file (MODULES §F66)

/**
 * party.export {}: your character as a portable file (portable.exportCharacter) in the receipt's
 * data (`data.character`, with `data.fileName`), for the screen to offer as a download. Changes
 * nothing; also works through preview.
 */
function exportPc(ctx) {
    const party = fitParty(ctx.read('party'));
    const pc = party?.pc ? party.actors?.[party.pc] : null;
    if (!pc) fail(ctx, 'NOT_FOUND', 'Make your character first.');
    let currency = null;
    try {
        currency = ctx.query('inventory.currency');
    } catch {
        currency = null;
    }
    const character = exportCharacter(party, readInventory(ctx), { currency: currency?.name ?? '' });
    const slug = String(pc.name).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'character';
    const things = character.items.reduce((sum, entry) => sum + entry.qty, 0);
    return {
        summary: `${pc.name} is written to a character file (${levelText(pc.level, rulesFor(ctx))}, ${things} thing${things === 1 ? '' : 's'} carried).`,
        data: { actor: pc.id, character, fileName: `${slug}.rpg-battle.json` },
        narrate: false,
    };
}

/**
 * What one of a character file's (checked) defs is worth in this chat, as creation.import will
 * bring it in (B-b3-r2-4): a def id this chat has is that def (its own value); any other is a new
 * thing the item.define hook prices, reckoned here at the file's level (at least what the hook
 * makes it at level 1), so its name cannot make goods a potion the count does not see.
 */
function chatWorth(ctx) {
    const defs = readInventory(ctx)?.defs ?? {};
    let currency = null;
    try {
        currency = ctx.query('inventory.currency');
    } catch {
        currency = null;
    }
    const settings = typeof ctx?.settings === 'function' ? ctx.settings() ?? null : null;
    const valueOf = (def, level) => {
        const value = Number(defineItem(def, { settings, currency, level }).value);
        return Number.isFinite(value) && value > 0 ? value : 0;
    };
    return (def, level) => {
        const known = typeof def.id === 'string' ? defs[def.id] : null;
        if (known) return Number.isInteger(known.value) && known.value > 0 ? known.value : valueOf(known, level);
        const { id: _id, ...given } = def;
        return Math.max(valueOf(given, 1), valueOf(given, level));
    };
}

/**
 * party.import { character, name?, portrait?, background? } (internal, from creation.import):
 * your character from a character file instead of the wizard, checked by this chat's Character
 * rules (portable.readCharacter: level cap, stat cap, the points a character of that level can
 * have, the skills). Its story-taught skills are kept in party.custom. The checked items and
 * purse are given back in the receipt's data ({ actor, items, purse }) for the caller to grant.
 */
function importPc(ctx, payload = {}) {
    const party = ctx.draft('party');
    if (party.pc && party.actors[party.pc]) fail(ctx, 'REFUSED', 'You already have a character.');
    if (ctx.cause === 'ui' && !ctx.caller) fail(ctx, 'REFUSED', 'A character file is read through character creation.');
    const rules = rulesFor(ctx);
    const file = payload.character;
    // The race and talents the file names, as this chat knows them: what they add to the stats.
    const ids = originIds(file?.origin);
    let built = null;
    if (ids && (ids.race || ids.talents.length)) {
        try {
            built = ctx.query('creation.build', { race: ids.race ?? '', talents: ids.talents, points: {}, settings: settingsFor(ctx) });
        } catch {
            built = null;
        }
    }
    const bonus = Object.values(built?.bonus ?? {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    // What the race and talents take off a stat: the most a stat may be below the start value.
    const penalty = Object.fromEntries(Object.entries(built?.bonus ?? {}).map(([stat, value]) => [stat, Math.min(0, Number(value) || 0)]));
    const read = readCharacter(file, { rules, bonus, penalty, name: payload.name ?? null, worth: chatWorth(ctx) });
    if (!read.ok) fail(ctx, read.code, read.message);
    const character = read.character;
    if (nameTaken(party, character.name)) fail(ctx, 'REFUSED', `There is already a ${character.name} in the party.`);
    for (const skill of character.custom) if (!Object.hasOwn(party.custom, skill.name)) party.custom[skill.name] = skill;
    const id = newId(ctx, 'ac', candidate => Boolean(party.actors[candidate]));
    const background = String(payload.background ?? character.background ?? '').trim().slice(0, 2000);
    // The origin as this chat knows it, else as the file names it (when it is well formed).
    const known = built && !(built.issues ?? []).some(issue => issue.code === 'NOT_FOUND') ? built.origin : null;
    const named = entry => entry && typeof entry.id === 'string' && entry.id.trim() && typeof entry.name === 'string' && entry.name.trim();
    const given = file.origin && (file.origin.race === null || named(file.origin.race)) && Array.isArray(file.origin.talents) && file.origin.talents.every(named)
        ? { race: file.origin.race ? { id: file.origin.race.id, name: file.origin.race.name } : null, talents: file.origin.talents.map(entry => ({ id: entry.id, name: entry.name })) }
        : null;
    const origin = known ?? given;
    writeSheet(ctx, party, {
        id, kind: 'pc', control: 'player', role: character.role, npc: null, portrait: portraitOf(ctx, payload.portrait),
        ...(background ? { background } : {}), ...(origin ? { origin } : {}),
    }, character.sheet, rules);
    party.pc = id;
    party.order = [id, ...party.order.filter(entry => entry !== id)];
    // Rules v2: an arrival takes a basic class like any new character (a rules chat refuses one without).
    startRulesClass(ctx, { actor: id, class: payload.class, checkActor: payload.checkActor, pc: true });
    return {
        summary: `${character.name} arrives from another story (${levelText(character.sheet.level, rules)}).`,
        data: { actor: id, items: character.items, purse: character.purse, cut: { ...character.cut } },
        narrate: false,
    };
}

// ---------------------------------------------------------------------------------------
// Offers (from join and skill lines)

/**
 * party.acceptOffer { offer, …choices }: the reader takes a waiting offer. A leave offer takes the
 * companion out of the party (party.removeCompanion). A join offer adds the
 * companion (party.addCompanion with the offer's name, role, level, focus and skills; the
 * reader's `control`, `focus` or `skills` win); a skill offer teaches the skill (party.learnSkill
 * with its template; `setAside` when the member already uses as many as they can).
 */
function acceptOffer(ctx, payload = {}) {
    const party = ctx.draft('party');
    const offer = waitingOffers(party).find(entry => entry.id === payload.offer);
    if (!offer) fail(ctx, 'NOT_FOUND', 'That offer is no longer waiting.');
    delete offersRecord(party)[offer.id];
    if (offer.kind === 'leave') return removeCompanion(ctx, { actor: offer.actor });
    if (offer.kind === 'join') {
        return joinParty(ctx, {
            name: offer.name, role: offer.role, level: offer.level ?? undefined, npc: offer.npc, text: offer.text, preset: offer.preset ?? null,
            focus: payload.focus ?? offer.focus, skills: payload.skills ?? offer.skills, control: payload.control, class: payload.class,
        });
    }
    return learnSkill(ctx, { actor: offer.actor, name: offer.skill, template: offer.template, setAside: payload.setAside ?? null });
}

/** party.dismissOffer { offer }: the reader turns a waiting offer down. */
function dismissOffer(ctx, payload = {}) {
    const party = ctx.draft('party');
    const offer = waitingOffers(party).find(entry => entry.id === payload.offer);
    if (!offer) fail(ctx, 'NOT_FOUND', 'That offer is no longer waiting.');
    delete offersRecord(party)[offer.id];
    const who = party.actors[offer.actor]?.name ?? 'Nobody';
    const what = offer.kind === 'join' ? `${offer.name} does not join` : offer.kind === 'leave' ? `${who} stays with the party` : `${who} does not learn ${offer.skill}`;
    return { summary: `${what}.`, data: { offer: offer.id }, narrate: false };
}

const listNames = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The waiting offers for `actorId` removed from the party's record (B-b1r2-13: by key). */
function dropOffersFor(party, actorId) {
    const record = offersRecord(party);
    for (const [id, offer] of Object.entries(record)) if (offer?.actor === actorId) delete record[id];
}

/** Adds an offer to the party (used by the join, skill and leave kinds). */
export function addOffer(ctx, party, offer) {
    const waiting = waitingOffers(party).filter(entry => entry.kind === offer.kind).length;
    if (waiting >= MAX_OFFERS_PER_KIND) {
        const what = offer.kind === 'join' ? 'offers to join' : offer.kind === 'leave' ? 'companions leaving' : 'skills offered';
        fail(ctx, 'REFUSED', `${MAX_OFFERS_PER_KIND} ${what} already wait for the reader: accept or dismiss some first.`);
    }
    const record = offersRecord(party);
    const id = newId(ctx, 'of', candidate => Object.hasOwn(record, candidate));
    const full = { id, ...offer, rev: revOf(ctx) };
    // Under its own id (B-b1r2-13): a reply deleted before it never moves it.
    record[id] = full;
    return full;
}

export const handlers = {
    create, addCompanion, edit, removeCompanion, spend, learnSkill, setSkillActive, forgetSkill,
    rest, heal, fightPools, applyResult, grantXp, resolveCheck, acceptOffer, dismissOffer, exportPc, importPc,
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
    'party.fightPools': fightPools,
    'party.grantXp': grantXp,
    'party.heal': heal,
    'party.restore': heal,
    'party.acceptOffer': acceptOffer,
    'party.dismissOffer': dismissOffer,
    'party.export': exportPc,
    'party.import': importPc,
    'check.resolve': resolveCheck,
};
