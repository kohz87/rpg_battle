// The party part's change-line kinds (SPEC §4.4, MODULES §B1): wound, join, skill, check, rest,
// leave (MODULES §F26).
// Each `apply(ctx, line)` runs as a `story` command: it finds the member the line names (v1
// story.findTarget rules), sets every number by code, and rejects what it cannot accept (the
// host keeps those as Problems). A join, skill or leave line is never applied by itself: it waits in
// party.offers for the reader's Accept (party.acceptOffer) or Dismiss. A companion leaving is
// `- leave Lyra — parts ways at the ford`, or `- join Lyra — leaves`. Pure apart from ctx.
//
// `line` is the host's parsed line: { op, kind, name, text, labels, raw, index }.

import { applyWounds, describeWound, guessSkill, parseHints, parseWounds } from '../../story.js';
import { cleanFocus, guessFocus } from '../../builds.js';
import { findSkill, DEFAULT_SKILLS } from '../../skills.js';
import { parseLevelLabel, maxLevel } from '../../terms.js';
import { fromSheet, rulesFrom, settingsOf, toSheet } from './sheets.js';
import { COMPANION_LEVELS_ABOVE, addOffer, fightOn, handlers } from './commands.js';
import { clipped } from '../lines.js';
import { presetFor } from './formula.js';
import { MAX_LABEL, cleanName, cleanRole, fail, labelsOf, nameKey, replyOf, resolveName, waitingOffers } from './util.js';

// The static grammar each kind adds to the change-line instruction (SPEC §5): fixed words only,
// so the static prompt is byte-identical every reply.
export const GRAMMAR = Object.freeze({
    wound: '~ wound Name — what happened | harm: scratch|wound|severe|grievous (or heal: the same words; or — poisoned to add a condition, — cure poisoned to lift one); one blow or heal per person per reply',
    join: '+ join Name — who they are | level: <number> | role: <word> (someone asks to travel with the party; the reader decides)',
    skill: '+ skill Name — Skill Name: what it does | taught by: <who> (someone in the party is taught a skill; the reader decides)',
    check: '? check <skill or stat> — what is attempted | dc: easy|normal|hard|<number> | who: Name (then stop before the outcome; code rolls it)',
    rest: '! rest short|long — where and how the party rests',
    leave: '- leave Name — why they go (a companion parts ways with the party; the reader decides)',
});

const rulesFor = ctx => rulesFrom(settingsOf(typeof ctx?.settings === 'function' ? ctx.settings() : null));

function memberOf(ctx, party, name) {
    const found = resolveName(party, name);
    return found.actor ?? fail(ctx, found.error, found.message);
}

// The severity words a harm or heal label may use: v1's four, and "grave" for the worst.
function severityWord(ctx, value) {
    const word = String(value ?? '').trim().toLowerCase();
    if (/^grave/.test(word)) return 'grievous';
    if (/^(?:scratch|wound|sever|grievous)/.test(word)) return word;
    return fail(ctx, 'INVALID', 'Harm and heal are scratch, wound, severe or grievous.');
}

/**
 * `~ wound Ren — fell into the weir | harm: wound`, `| heal: scratch`, `~ wound Astra — cure
 * poisoned`, `~ wound Astra — poisoned: a bite`: v1 Wounds rules (a share of max HP by the word,
 * never a number; a condition added or lifted), at most one harm or heal per person per reply.
 */
function applyWound(ctx, line) {
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const actor = memberOf(ctx, party, line.name);
    // While a fight has the party its HP and conditions are the fight's (party.fightPools, then
    // combat.end): a story's blow or heal would be put back by the next fight action (B-b4-6).
    if (fightOn(ctx)) fail(ctx, 'REFUSED', `${actor.name} is in a fight: what happens to them there is the fight's, played on the battle board.`);
    const labels = labelsOf(line);
    const text = String(line.text ?? '').trim();
    let written;
    if (labels.harm) written = `${actor.name} — ${severityWord(ctx, labels.harm)}: ${text}`;
    else if (labels.heal) written = `${actor.name} — heal ${severityWord(ctx, labels.heal)}: ${text}`;
    else if (labels.cure) written = `${actor.name} — cure ${labels.cure}${text ? `: ${text}` : ''}`;
    else if (labels.condition) written = `${actor.name} — ${labels.condition}${text ? `: ${text}` : ''}`;
    else written = `${actor.name} — ${text.replace(/^grave(?:ly)?\b/i, 'grievous')}`;
    const [wound] = parseWounds(written);
    if (!wound) fail(ctx, 'INVALID', `That wound line says nothing RPG Battle can use for ${actor.name}.`);
    if (wound.kind === 'harm' || wound.kind === 'heal') {
        const reply = replyOf(ctx, line);
        if (reply !== null && !ctx.claim(`wound:${actor.id}:${reply}`)) fail(ctx, 'CLAIMED', `${actor.name} was already hurt or healed in this reply.`);
    }
    const sheet = toSheet(actor);
    const input = actor.id === party.pc ? { pc: sheet } : { members: [{ id: actor.id, name: actor.name, sheet }] };
    const out = applyWounds(input, [{ ...wound, name: actor.name }], rules);
    const entry = out.applied[0];
    if (!entry) fail(ctx, 'REFUSED', `That changes nothing for ${actor.name}.`);
    party.actors[actor.id] = fromSheet(actor, out.pc ?? out.members[0].sheet, rules);
    return {
        summary: describeWound(entry),
        data: { actor: actor.id, kind: entry.kind, severity: entry.severity, hp: entry.hp, condition: entry.condition, down: Boolean(entry.down) },
        narrate: false,
    };
}

// A list label ("DEX, AGI", "Slash; Parry"): labelsOf has cut it to MAX_LABEL already; a plain
// split and trim (a split on /\s*[,;/]\s*/ is slow on a long run of spaces, B-b5b-robust-13).
const list = value => String(value ?? '').slice(0, MAX_LABEL).split(/[,;/]/).map(part => part.trim()).filter(Boolean);

/** `+ join Lyra — the archer | level: 3 | role: ranger | focus: DEX, AGI | skills: Aimed Shot` → a join offer. */
function applyJoin(ctx, line) {
    if (line.op === '-') return applyLeave(ctx, line);
    if (line.op !== '+') fail(ctx, 'INVALID', 'Only "+ join" lines (and "- join Name — leaves") are read.');
    const party = ctx.draft('party');
    const rules = rulesFor(ctx);
    const labels = labelsOf(line);
    const name = cleanName(line.name);
    if (!name || /^(?:you|me|myself)$/i.test(name)) fail(ctx, 'INVALID', 'A join line needs the newcomer\'s name.');
    if (Object.values(party.actors).some(actor => nameKey(actor.name) === nameKey(name))) fail(ctx, 'REFUSED', `${name} is already in the party.`);
    if (waitingOffers(party).some(offer => offer.kind === 'join' && nameKey(offer.name) === nameKey(name))) fail(ctx, 'REFUSED', `${name}'s offer to join is already waiting.`);
    const text = String(line.text ?? '').trim().slice(0, 160);
    let level = null;
    if (labels.level) {
        const written = parseLevelLabel(labels.level, rules) ?? Number(labels.level.match(/\d+/)?.[0]);
        if (!(written >= 1)) fail(ctx, 'INVALID', `The level "${labels.level}" is not a level.`);
        // Held near your character's level (B-b3-16); party.addCompanion holds it there again.
        const pc = party.pc ? party.actors[party.pc] : null;
        level = Math.max(1, Math.min(maxLevel(rules), Math.max(1, pc?.level ?? 1) + COMPANION_LEVELS_ABOVE, Math.round(written)));
    }
    const role = cleanRole(labels.role ?? '') || cleanRole(text.replace(/^(?:an?|the)\s+/i, '').split(/[,;:.]/)[0]);
    const focus = cleanFocus(labels.focus ? list(labels.focus).map(stat => stat.toUpperCase()) : guessFocus(role, text));
    const skills = labels.skills ? list(labels.skills).slice(0, rules.character.starterSkills) : [];
    const npc = labels.npc ? String(labels.npc).slice(0, 80) : null;
    // A preset's name (F91: its points are the weights the formula spreads); only a known one is kept.
    const preset = presetFor({ preset: labels.preset ?? null })?.id ?? null;
    const offer = addOffer(ctx, party, { kind: 'join', name, role, level, focus, skills, npc, text, ...(preset ? { preset } : {}) });
    return { summary: `${name} offers to join the party.`, data: { offer: offer.id, name }, narrate: false };
}

/**
 * `- leave Lyra — parts ways at the ford` (or `- join Lyra — leaves`) → an offer to take that
 * companion out of the party (MODULES §F26): the reader accepts (party.removeCompanion) or keeps
 * them. Your character never leaves this way.
 */
function applyLeave(ctx, line) {
    if (line.op !== '-' && line.op !== '!') fail(ctx, 'INVALID', 'A companion leaving is written "- leave Name — why".');
    const party = ctx.draft('party');
    const actor = memberOf(ctx, party, line.name);
    if (actor.kind !== 'companion') fail(ctx, 'REFUSED', 'Only a companion can leave the party.');
    if (waitingOffers(party).some(offer => offer.kind === 'leave' && offer.actor === actor.id)) fail(ctx, 'REFUSED', `${actor.name}'s leaving is already waiting for the reader.`);
    const text = String(line.text ?? '').trim().replace(/^leaves\.?$/i, '').slice(0, 160);
    const offer = addOffer(ctx, party, { kind: 'leave', actor: actor.id, text });
    return { summary: `${actor.name} means to leave the party.`, data: { offer: offer.id, actor: actor.id }, narrate: false };
}

/** `+ skill Ren — Shadow Cut: a blurring slash | taught by: Kael | type: physical` → a skill offer. */
function applySkill(ctx, line) {
    if (line.op !== '+') fail(ctx, 'INVALID', 'Only "+ skill" lines are read.');
    const party = ctx.draft('party');
    const actor = memberOf(ctx, party, line.name);
    const labels = labelsOf(line);
    const text = String(line.text ?? '').trim();
    const colon = text.indexOf(':');
    const skill = cleanRole(colon >= 0 ? text.slice(0, colon) : text).slice(0, 40).trim() || cleanRole(labels.skill ?? '');
    if (!skill) fail(ctx, 'INVALID', 'A skill line needs the skill\'s name.');
    const words = colon >= 0 ? text.slice(colon + 1).trim().slice(0, 160) : '';
    if (actor.skills.some(entry => nameKey(entry.name) === nameKey(skill))) fail(ctx, 'REFUSED', `${actor.name} already knows ${skill}.`);
    if (waitingOffers(party).some(offer => offer.kind === 'skill' && offer.actor === actor.id && nameKey(offer.skill) === nameKey(skill))) fail(ctx, 'REFUSED', `${skill} is already offered to ${actor.name}.`);
    const known = findSkill(DEFAULT_SKILLS, skill) ?? findSkill(Object.values(party.custom), skill);
    // The template the story's words and hints suggest; code still sets every number when learned.
    const hints = parseHints(Object.entries(labels).filter(([key]) => ['type', 'stat', 'target', 'effect', 'element'].includes(key)).map(([key, value]) => `${key}: ${value}`).join(', '));
    const template = known ? null : guessSkill(words, { ...hints, name: skill });
    const taughtBy = String(labels['taught by'] ?? labels.from ?? labels.by ?? '').trim().slice(0, 60);
    const offer = addOffer(ctx, party, { kind: 'skill', actor: actor.id, skill: known?.name ?? skill, template, words, taughtBy });
    return { summary: `${actor.name} could learn ${offer.skill}${taughtBy ? ` from ${taughtBy}` : ''}.`, data: { offer: offer.id, actor: actor.id, skill: offer.skill }, narrate: false };
}

/** `? check stealth — slipping past the guard | dc: hard | who: Lyra` → check.resolve. */
function applyCheck(ctx, line) {
    const labels = labelsOf(line);
    const who = labels.who ?? labels.by ?? null;
    return handlers.resolveCheck(ctx, { who, skill: line.name, stat: labels.stat ?? null, dc: labels.dc ?? '', what: line.text ?? '' });
}

/** `! rest long — a night at the inn` → party.rest; one rest a reply (B1-3: the rest is narrated). */
function applyRest(ctx, line) {
    const labels = labelsOf(line);
    const word = `${line.name ?? ''} ${labels.kind ?? ''} ${line.text ?? ''}`.toLowerCase();
    const kind = /^\s*long\b/.test(word) || labels.kind === 'long' ? 'long' : /^\s*short\b/.test(word) || labels.kind === 'short' ? 'short' : null;
    if (!kind) fail(ctx, 'INVALID', 'A rest is short or long.');
    const reply = replyOf(ctx, line);
    if (reply !== null && !ctx.claim(`rest:${reply}`)) fail(ctx, 'CLAIMED', 'The party already rested in this reply.');
    return handlers.rest(ctx, { kind, reason: line.text ?? '' });
}

export const kinds = {
    wound: { grammar: GRAMMAR.wound, apply: clipped(applyWound) },
    join: { grammar: GRAMMAR.join, apply: clipped(applyJoin) },
    skill: { grammar: GRAMMAR.skill, apply: clipped(applySkill) },
    check: { grammar: GRAMMAR.check, apply: clipped(applyCheck) },
    rest: { grammar: GRAMMAR.rest, apply: clipped(applyRest) },
    leave: { grammar: GRAMMAR.leave, apply: clipped(applyLeave) },
};
