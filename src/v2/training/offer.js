// RPG Battle v2, generative offers for teachers (GENERATIVE_OFFERS_SPEC §5.6): reading a `+ trainer` line the narrator wrote in its own words and
// matching it to one of the pin's open trainer templates. `matchTrainer` is pure and called once, live, at capture; the unchanged `planTrainer`
// then decides everything else (the place, the name, the die). Nothing here asks a query: everything it reads is in `env`.

import { saidOf } from '../quests/offer-match.js';
import { MATCHER, bandOf, flat, hold, keepNotes, NOTE } from '../quests/offer-bands.js';
import { parseReward } from '../quests/parse.js';
import { defaultRank } from '../quests/ranks.js';
import { subjectWords } from '../quests/offer-words.js';
import { NAME_MAX, TEXT_MAX } from './domain.js';
import { teachesOf, templateOfLike } from './opening.js';

export { MATCHER };
const KNOWN = new Set(['like', 'teaches', 'fee', 'text']);
const lower = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();

/** The folded words of a template: its name, its skills' names and the names of the classes that hold those skills. */
function wordsOfTemplate(ix, template) {
    const classes = [...ix.classes.values()].filter(entry => (entry.skills ?? []).some(skill => template.skills.includes(skill)));
    return subjectWords([template.name, ...template.skills.map(skill => ix.skill(skill)?.name ?? ''), ...classes.map(entry => entry.name)].join(' '));
}

/** The skills of `template` that `entries` name, in the template's order; entries that name none are returned apart. */
function narrowTo(ix, template, entries) {
    const keep = new Set();
    const dropped = [];
    for (const entry of entries) {
        const wanted = lower(entry);
        const found = template.skills.filter(skill => lower(skill) === wanted || lower(skill.split('/')[1]) === wanted || lower(ix.skill(skill)?.name) === wanted);
        if (found.length === 1) keep.add(found[0]);
        else dropped.push(entry);
    }
    return { skills: template.skills.filter(skill => keep.has(skill)), dropped };
}

/**
 * Reads and matches one `+ trainer` line.
 *   env  { ix, ladder, level, currency }   ix the pin's index; ladder the rank rows; level the PC's level or null; currency `inventory.currency`
 *   line the host's parsed line `{ name, text, labels }`
 * → { kind: 'offer', band, binding: { template, name, text, skills | null }, fee: { value, by: 'said' } | null, said, notes }
 *   | { kind: 'none', name, text }          no template teaches that
 *   | { kind: 'far', name, why: 'fee', written, max, template }
 *   | { kind: 'refuse', code, message }
 */
export function matchTrainer(env, line) {
    const labels = Object.fromEntries(Object.entries(line.labels ?? {}).map(([key, value]) => [String(key).trim().toLowerCase(), value]));
    const name = flat(line.name, NAME_MAX);
    if (!name) return { kind: 'refuse', code: 'INVALID', message: 'Name the teacher in plain words.' };
    const text = flat(labels.text ?? line.text, TEXT_MAX);
    const entries = Object.hasOwn(labels, 'teaches') ? teachesOf(flat(labels.teaches, 240)) : [];
    const likeKey = flat(labels.like ?? '', NAME_MAX).split(/\s+[—–-]\s+/)[0].trim();
    const extra = flat(labels.like ?? '', NAME_MAX).split(/\s+[—–-]\s+/).slice(1).join(' ');
    const said = saidOf(line, 'text');
    const notes = [];
    const templates = ix => ix.trainerTemplates;
    const all = templates(env.ix);
    if (!all.length) return { kind: 'refuse', code: 'RULES_MISMATCH', message: 'This world has no open teacher template.' };

    let template = likeKey ? templateOfLike(env.ix, likeKey) : null;
    if (likeKey && !template) notes.push(NOTE.likeUnknown(likeKey));
    if (!template) {
        const wanted = subjectWords([text, extra, ...entries].join(' '));
        const party = defaultRank(env.ladder, 'normal', env.level);
        const partyIndex = Math.max(0, env.ladder?.indexOf(party) ?? 0);
        const rankIndex = entry => env.ladder?.findIndex(row => lower(row.id) === lower(entry.rank)) ?? -1;
        const scored = all.map((entry, order) => ({ entry, order, shared: [...wordsOfTemplate(env.ix, entry)].filter(word => wanted.has(word)).length }));
        const best = Math.max(0, ...scored.map(row => row.shared));
        if (best === 0) return { kind: 'none', name, text, said };
        // Ties: the template whose rank is nearest at or below the character's, then the pack's order.
        const near = row => { const at = rankIndex(row.entry); return at < 0 ? 1e6 : at <= partyIndex ? partyIndex - at : 1e3 + (at - partyIndex); };
        template = scored.filter(row => row.shared === best).sort((a, b) => near(a) - near(b) || a.order - b.order)[0].entry;
    }
    // Said in the narrator's words, found by the template's: the log shows the match (the template's own name needs no note).
    const asked = flat([text, extra].filter(Boolean).join(' ') || entries.join(', '), 80);
    if (!(likeKey && templateOfLike(env.ix, likeKey)) && asked && lower(asked) !== lower(template.name)) notes.push(NOTE.matched(template.name, asked));

    let skills = null;
    if (entries.length) {
        const narrowed = narrowTo(env.ix, template, entries);
        for (const entry of narrowed.dropped) notes.push(NOTE.skillDropped(flat(entry, 60), template.name));
        skills = narrowed.skills.length ? narrowed.skills : null;
    }

    // A written fee (§5.6): inside the template's range it stands, outside it is held; above FAR times the top it is far out; one code cannot
    // read is the rolled fee, moderate.
    let fee = null;
    let moved = false;
    if (labels.fee && String(labels.fee).trim()) {
        const read = parseReward({ reward: flat(labels.fee, NAME_MAX) }, '', { currency: env.currency, amountWords: true });
        if (read && read.amount === null) {
            moved = true;
            const foreign = /is not this chat's money|is not a coin here/.test(read.problem ?? '');
            notes.push(foreign ? NOTE.feeForeign(flat(read.text, 60)) : NOTE.feeUnreadable(flat(read.text, 60)));
        } else if (read) {
            const held = hold(read.amount, template.fee.coinMin, template.fee.coinMax);
            if (held.far) return { kind: 'far', name, why: 'fee', written: read.amount, max: template.fee.coinMax, template: template.name, said };
            fee = { value: held.value, by: 'said' };
            if (held.moved) {
                moved = true;
                notes.push(NOTE.feeSet(held.value, env.currency));
            }
        }
    }
    for (const label of Object.keys(labels).filter(key => !KNOWN.has(key))) notes.push(NOTE.unused(label));
    return { kind: 'offer', band: bandOf({ moved }), binding: { template: template.id, name, text, skills }, fee, said, notes: keepNotes(notes) };
}

