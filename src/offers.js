// What the story offers the party (0.4): one reply's hidden blocks (or the opening message's)
// turned into offers the reader accepts or not, never applied on their own.
//
// The model writes <Joins>, <Leaves>, <Learned>, <XP> and <Rest> when the story makes them
// true (story.STORY_INSTRUCTION); Story Director may close a quest in the same reply. Each
// line becomes one offer with a key made of the message, the kind and the line as written, so
// "Not now" puts it away for that text (a swipe writes other text, and is offered anew). Names
// match your character or a companion by full or first name, as story wounds do; a name nobody
// has is left to the story, except in <Joins>. Lines for your character (also "You", or your
// persona's name) wait while there is no character yet: they are offered once one is made.
// Pure: index.js reads the blocks, filters what was put away, and acts on an accepted offer.

import { DEFAULT_RULES } from './rules.js';
import { findSkill } from './skills.js';
import { guessFocus } from './builds.js';
import { awardShare, questDifficulty, xpAward } from './growth.js';
import { findTarget, guessSkill, meansYou, parseJoins, parseLearned, parseLeaves, parseRest, parseXp } from './story.js';
import { xpGainText, xpLabel } from './terms.js';

const sameKey = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** "XP +25", "Soul Growth +25": what an award of `share` is worth to your character (at the XP rate), in the reader's terms. */
function xpText(share, pc, rules) {
    return `${xpLabel(rules)} ${xpGainText(xpAward(share, pc.level, rules))}`;
}

/**
 * The offers in one message's hidden blocks: [{ key, kind, text, accept, note?, data }].
 *   joins   → data { name, role, level, focus, skills, free }   ("Lyra joined. Add as companion?")
 *   leaves  → data { memberId }                                  ("Lyra left the party. Remove?")
 *   learned → data { memberId, prefill: { name, words, type, stat, target, element, free } }
 *   xp      → data { share }                                     ("+25 XP: rescued the caravan. Award?")
 *   rest    → data { kind: 'short' | 'long' }                    ("Rest (long): slept at the inn. Recover?")
 * `texts` holds each block's text ({ joins, leaves, learned, xp, rest }); `opening`: the
 * story's opening message (its skills come without stat requirements: the card says they are
 * yours); `narrating`: the reply that narrates a fight (no XP or rest from it, the fight gave
 * its own); `pending`: a fight result still waits to be narrated (no rest).
 */
export function storyOffers({ index, texts = {}, pc = null, members = [], persona = '', rules = DEFAULT_RULES, library = [], opening = false, narrating = false, pending = false } = {}) {
    const offers = [];
    const people = [
        { id: 'pc', name: pc?.name || persona || '', sheet: pc },
        ...(members ?? []).map(member => ({ id: member.id, name: member.name ?? member.sheet?.name, sheet: member.sheet })),
    ].filter(person => String(person.name ?? '').trim());
    const who = name => (meansYou(name) ? people.find(person => person.id === 'pc') ?? { id: 'pc', name: persona, sheet: null } : findTarget(people, name));
    const key = (kind, line) => `${index}:${kind}:${line}`;

    for (const join of parseJoins(texts.joins, rules)) {
        // Someone already in the party is not offered again.
        if (findTarget(people.filter(person => person.id !== 'pc'), join.name) || (pc && findTarget([people[0]], join.name))) continue;
        offers.push({
            key: key('joins', join.line), kind: 'joins', text: `${join.name} joined. Add as companion?`, accept: 'Add as companion',
            data: { name: join.name, role: join.role, level: join.level ?? pc?.level ?? 1, focus: join.focus.length ? join.focus : guessFocus(join.role), skills: join.skills, free: opening },
        });
    }
    for (const leave of parseLeaves(texts.leaves)) {
        const member = findTarget(people.filter(person => person.id !== 'pc'), leave.name);
        if (!member) continue;
        offers.push({ key: key('leaves', leave.line), kind: 'leaves', text: `${member.name} left the party. Remove?`, accept: 'Remove', note: leave.reason, data: { memberId: member.id } });
    }
    for (const entry of parseLearned(texts.learned)) {
        const person = who(entry.name);
        // Yours wait for a character; anyone else must be in the party.
        if (!person?.sheet) continue;
        const known = findSkill(library, entry.skill);
        const name = known?.name ?? entry.skill;
        if ((person.sheet.skills ?? []).some(skill => sameKey(skill.name, name))) continue;
        const shape = known ? { type: known.type, stat: known.stat, target: known.target, element: 'none' } : guessSkill(entry.words || entry.skill, { ...entry.hints, name: entry.skill });
        offers.push({
            key: key('learned', entry.line), kind: 'learned', text: `${person.name} learned ${name}. Add it?`, accept: 'Add it',
            note: entry.words,
            data: { memberId: person.id, prefill: { name, words: entry.words, ...shape, free: opening } },
        });
    }
    if (pc && !narrating) {
        for (const award of parseXp(texts.xp)) {
            const share = awardShare({ kind: award.kind }, rules);
            if (!share) continue;
            offers.push({ key: key('xp', award.line), kind: 'xp', text: `${xpText(share, pc, rules)}${award.reason ? `: ${award.reason}` : ''}. Award?`, accept: 'Award', data: { share } });
        }
    }
    if (pc && !narrating && !pending) {
        for (const rest of parseRest(texts.rest)) {
            offers.push({ key: key('rest', rest.line), kind: 'rest', text: `Rest (${rest.kind})${rest.reason ? `: ${rest.reason}` : ''}. Recover?`, accept: 'Recover', data: { kind: rest.kind } });
        }
    }
    return offers;
}

/**
 * Story Director's quests finished in reply `index` (questsDoneAt) as XP offers:
 * "Quest done: The Lost Caravan (hard). Award +15 XP?". No character, no offer.
 */
export function questOffers({ index, quests = [], pc = null, rules = DEFAULT_RULES } = {}) {
    if (!pc) return [];
    return (Array.isArray(quests) ? quests : []).filter(quest => quest && String(quest.name ?? '').trim()).map(quest => {
        const difficulty = questDifficulty(quest.difficulty);
        const share = awardShare({ difficulty }, rules);
        return {
            key: `${index}:quest:${quest.id ?? quest.name}`, kind: 'quest',
            text: `Quest done: ${String(quest.name).trim()} (${difficulty}). Award ${xpText(share, pc, rules)}?`, accept: 'Award',
            data: { share },
        };
    }).filter(offer => offer.data.share > 0);
}

// The opening message's offers that wait for the reader (a character to be made, a companion to
// add): its starting skills and companions. Anything else in it is of its moment, like a reply's.
const WAITING_KINDS = ['joins', 'learned'];

/**
 * Offers that still belong to their moment: a reply's (and a quest it finished) only while it
 * is the latest assistant reply and no fight has started since it (`foughtSince`: a fight
 * started while that reply was the latest), so a rest from before a fight can never heal after
 * it. The opening message's skills and companions wait until taken or put away; offers tied to
 * no reply (`index` −1: a fallen companion, a rename) stay. Each offer carries `index` and,
 * from the opening message, `opening`.
 */
export function liveOffers(offers, { latest, foughtSince = false } = {}) {
    return (offers ?? []).filter(offer => {
        if (offer.index === -1 || offer.index === undefined) return true;
        if (offer.opening && WAITING_KINDS.includes(offer.kind)) return true;
        return offer.index === latest && !foughtSince;
    });
}
