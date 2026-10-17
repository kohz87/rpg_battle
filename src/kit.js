// A companion's starting kit (0.4): the skills someone the story brings along already has,
// in words from one short model call, like a made-up creature's flavour (flavour.js).
//
// A companion joins from the story (<Joins>) with a role ("healer", "old soldier") and, with
// NPC State Delta, a few lines of who they are. The model is asked once for two or three skills
// in words only: a name, a few words, and type, stat, target and effect from short fixed lists.
// Code reads them leniently (story.parseHints and story.guessSkill, the same grammar as a
// <Learned> line), drops every number and unknown word, and builds each skill with
// skills.skillFromTemplate at the companion's level, so the model never sets power, MP or
// cooldown. Without the call (flavour off, no model, a failure, the deadline), or when it says
// nothing usable, the kit is two or three library skills that fit the focus and role
// (builds.suggestSkills): the same answer every time. Pure: index.js makes the call.

import { STATS } from './rules.js';
import { findSkill } from './skills.js';
import { buildStats, suggestSkills } from './builds.js';
import { guessSkill, parseHints } from './story.js';

export const KIT_MIN = 2;
export const KIT_MAX = 3;
const MAX_NAME = 40;
const MAX_WORDS = 80;

export const KIT_SYSTEM = [
    'You name the skills a companion in a story already has. Words only, never numbers.',
    `Answer with ${KIT_MIN} or ${KIT_MAX} lines, one skill each:`,
    'Name — a few words | type: physical|magic|heal|buff|debuff, stat: STR|VIT|AGI|DEX|INT|LUK|CHA, target: one|all|self|ally|allies, effect: none|fire|ice|lightning|poison',
    'Fit the skills to who they are and the story; plain names, no numbers, nothing else.',
].join('\n');

/**
 * The call's messages: [{ role: 'system', content }, { role: 'user', content }] for a
 * companion { name, role, summary, level (in the reader's words), focus }.
 */
export function kitPrompt({ name, role = '', summary = '', level = '', focus = [] } = {}) {
    const lines = [
        `Companion: ${String(name ?? '').trim() || 'a companion'}`,
        role ? `Role: ${String(role).trim()}` : '',
        summary ? `Who they are: ${String(summary).trim().slice(0, 240)}` : '',
        level ? `Power: ${level}` : '',
        focus?.length ? `Strongest stats: ${focus.join(', ')}` : '',
        `Their ${KIT_MIN} or ${KIT_MAX} skills:`,
    ].filter(Boolean);
    return [{ role: 'system', content: KIT_SYSTEM }, { role: 'user', content: lines.join('\n') }];
}

const clean = value => String(value ?? '').normalize('NFKC').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();

/**
 * The answer as skill specs: [{ name, words, type, stat, target, element }], at most KIT_MAX,
 * names unique (any case). Lines without a name, numbering and digits go; the fields only take
 * known words (story.parseHints), the rest is guessed from the words (story.guessSkill).
 */
export function parseKit(text) {
    const out = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = clean(raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')).replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
        if (!line || /^<\/?[A-Za-z]/.test(line)) continue;
        const bar = line.indexOf('|');
        const head = bar < 0 ? line : line.slice(0, bar);
        const hints = bar < 0 ? {} : parseHints(line.slice(bar + 1));
        const parts = head.match(/^(.+?)\s*(?:[—–:]|--|\s-)\s*(.*)$/);
        const name = clean((parts ? parts[1] : head).replace(/^name\s*:\s*/i, '')).replace(/[.:,;]+$/, '').slice(0, MAX_NAME).trim();
        const words = clean(parts ? parts[2] : '').slice(0, MAX_WORDS);
        // A skill has a short name and something said about it; chatter around the answer has neither.
        if (!name || name.length < 2 || /[!?]/.test(name) || name.split(' ').length > 5 || (!words && bar < 0)) continue;
        if (/^(?:skills?|answer|companion|name)$/i.test(name) || out.some(entry => entry.name.toLowerCase() === name.toLowerCase())) continue;
        out.push({ name, words, ...guessSkill(`${name} ${words}`, hints) });
        if (out.length >= KIT_MAX) break;
    }
    return out;
}

/**
 * Library skills as kit specs, for the default kit: { name, words: their description,
 * type, stat, target, library: true }.
 */
function librarySpec(skill) {
    return { name: skill.name, words: String(skill.description ?? ''), type: skill.type, stat: skill.stat, target: skill.target, element: 'none', library: true };
}

/**
 * The kit when the call gives nothing: KIT_MAX library skills the companion's built stats allow,
 * fitted to the focus and role (builds.suggestSkills). Deterministic.
 */
export function fallbackKit({ focus = [], level = 1, role = '' } = {}, library, rules) {
    const stats = buildStats(focus, level, rules);
    return suggestSkills(stats, focus, library, { role, count: KIT_MAX }).map(name => librarySpec(findSkill(library, name)));
}

/**
 * The kit for a <Joins> hint that names skills (`| skills: Frost Lance, Mend`): a library
 * skill by its name, any other name as a template guessed from its words. Not checked against
 * stats: the story says they have them.
 */
export function namedKit(names, library) {
    return (names ?? []).slice(0, KIT_MAX).map(name => {
        const found = findSkill(library, name);
        return found ? librarySpec(found) : { name: clean(name).slice(0, MAX_NAME), words: '', ...guessSkill(name) };
    }).filter(spec => spec.name);
}

/** Whether a kit from the call is usable: at least KIT_MIN skills. */
export function usableKit(specs) {
    return Array.isArray(specs) && specs.length >= KIT_MIN;
}

/** A spec's template as skills.skillFromTemplate takes it ({ name, type, stat, target, element }), stat checked. */
export function kitTemplate(spec) {
    return { name: spec.name, type: spec.type, stat: STATS.includes(spec.stat) ? spec.stat : undefined, target: spec.target, element: spec.element };
}
