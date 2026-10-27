// RPG Battle v2, generative offers: reading a job the narrator wrote in its own words (GENERATIVE_OFFERS_SPEC §3, §4, §5.1) and settling it
// inside the pin's open templates. `matchOffer` is pure and is called once, live, at capture; its answer is recorded with the offer and a
// replay never calls it (§7). Nothing here asks a query: everything it reads is in `env`.

import { foeToEngine, foeVariant } from '../fight/foes.js';
import { DEFAULT_RULES } from '../../rules.js';
import { evaluateRequirements } from './requirements.js';
import { amountDigits, countOf, NUMBER_WORDS, parseReward, singular, STOP_WORDS } from './parse.js';
import { defaultRank, rankNamed, WRITTEN_RANKS_ABOVE } from './ranks.js';
import { templates } from './seams.js';
import { bindingOf } from './offer-plan.js';
import { DEFAULT_MINUTES, boundsOf, durationRange, formulaAt, kindOf, tierOfRank } from './offer-rules.js';
import { MATCHER, bandOf, flat, hold, keepNotes, NOTE } from './offer-bands.js';
import { difficultyFromLabel, EXTRA_STOPS, FILLER, firstVerb, minutesOf, SKIPPED, titleCase, typeFromLabel, TYPES, wordsOf } from './offer-words.js';

export { MATCHER, boundsOf };
/** Longest name, goal and other label an offer keeps, in code points. */
export const NAME_CHARS = 80;
export const GOAL_CHARS = 240;
const VARIANT_CANDIDATES = 8;
const PHRASE_WORDS = 8;
const PARTICIPLE = 7;
const KNOWN = new Set(['type', 'goal', 'text', 'target', 'foe', 'item', 'place', 'count', 'reward', 'due', 'deadline', 'difficulty', 'rank', 'giver', 'like', 'status', 'met']);
const OFFER_LABELS = ['type', 'goal', 'target', 'foe', 'item', 'count', 'reward', 'due', 'deadline', 'difficulty', 'rank'];
/** A canonical ref the narrator copied ("pack.fixture/wolf", "pack.fixture/wolf~ash-wolf"): the 2.2.0 form of a target. */
const REF = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9_-]*(?:~[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const DONE = /^(?:done|complete|completed|finished|resolved|turned in)\.?$/i;

/** The key two spellings of one job's name share (§5.3): SD's lineKey (lower case, apostrophes dropped, punctuation as one space) without a leading article. */
export const offerKey = name => String(name ?? '').normalize('NFKC').toLowerCase().replace(/['’‘`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^(?:the|a|an) /, '');
const refuse = (code, message) => ({ kind: 'refuse', code, message });
const lowerKeys = labels => Object.fromEntries(Object.entries(labels ?? {}).map(([key, value]) => [String(key).trim().toLowerCase(), value]));
/** The words of a phrase for matching: lower case, singular, hyphens as spaces, filler left out. */
export const phraseWords = text => String(text ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean).map(singular).filter(word => !FILLER.includes(word));
const within = (part, whole) => {
    if (!part.length || part.length > whole.length) return false;
    for (let at = 0; at + part.length <= whole.length; at += 1) if (part.every((word, i) => whole[at + i] === word)) return true;
    return false;
};
const sameWords = (a, b) => a.length === b.length && a.every((word, i) => word === b[i]);

/** The labels of a line as the offer reads them (§3.1): flattened, cut, with the fallbacks. */
export function readLine(line) {
    const labels = lowerKeys(line.labels);
    const pick = (...names) => {
        for (const name of names) if (Object.hasOwn(labels, name) && String(labels[name]).trim()) return flat(labels[name], NAME_CHARS);
        return '';
    };
    const name = flat(line.name, NAME_CHARS);
    const goalFrom = [labels.goal, labels.text, line.text].find(value => String(value ?? '').trim());
    const goal = flat(goalFrom ?? name, GOAL_CHARS);
    const unused = Object.keys(labels).filter(key => !KNOWN.has(key));
    return {
        name, goal, goalLabelled: [labels.goal, labels.text].some(value => String(value ?? '').trim()), unused,
        type: pick('type'), target: pick('target', 'foe', 'item', 'place'), foeLabel: pick('foe'), itemLabel: pick('item'), placeLabel: pick('place'), count: pick('count'), reward: pick('reward'),
        due: pick('due', 'deadline'), difficulty: pick('difficulty', 'rank'), giver: pick('giver'), like: pick('like'), status: pick('status'), met: pick('met'),
    };
}

/** The labels of a line as the offer read them, in the order they were written (the dash text first, as a goal): what the Adjustments log shows (§9.4). */
export function saidOf(line, textKey = 'goal') {
    const said = {};
    const labels = lowerKeys(line.labels);
    const text = flat(line.text, GOAL_CHARS);
    if (text && !String(labels.goal ?? labels.text ?? '').trim()) said[textKey] = text;
    for (const [key, value] of Object.entries(labels)) {
        const cleaned = flat(value, key === 'goal' || key === 'text' ? GOAL_CHARS : NAME_CHARS);
        if (cleaned && Object.keys(said).length < 12) said[key] = cleaned;
    }
    return said;
}

/** The target phrase and count of a text (§4.2). `{ phrase, count }`; count null when none is written. */
export function targetOf(text) {
    const rest = amountDigits(String(text ?? ''));
    let words = [...rest.matchAll(/([\p{L}][\p{L}'’-]*)|(\d+)|([^\s\p{L}\d])/gu)].map(m => ({ word: m[1] ?? null, number: m[2] ?? null, punct: m[3] ?? null }));
    // Leading words are skipped ("at least" is two).
    let at = 0;
    const lowerAt = i => words[i]?.word?.toLowerCase();
    for (;;) {
        if (lowerAt(at) === 'at' && lowerAt(at + 1) === 'least') at += 2;
        else if (words[at]?.word && SKIPPED.includes(lowerAt(at))) at += 1;
        else break;
    }
    words = words.slice(at);
    let count = null;
    if (words[0]?.number !== null && words[0]?.number !== undefined) {
        count = Number(words[0].number);
        words = words.slice(1);
    } else if (words[0]?.word && Object.hasOwn(NUMBER_WORDS, words[0].word.toLowerCase())) {
        count = NUMBER_WORDS[words[0].word.toLowerCase()];
        words = words.slice(1);
    }
    const phrase = [];
    for (const entry of words) {
        if (entry.word === null) break;
        const lower = entry.word.toLowerCase();
        if (STOP_WORDS.has(lower) || EXTRA_STOPS.includes(lower)) break;
        // A word ending in -ing after the first starts a clause ("stealing chickens"); a short one is a name ("Hollow King").
        if (phrase.length > 0 && lower.length >= PARTICIPLE && lower.endsWith('ing')) break;
        phrase.push(entry.word);
        if (phrase.length >= PHRASE_WORDS) break;
    }
    return { phrase: phrase.join(' '), count: Number.isSafeInteger(count) && count >= 0 ? count : null };
}

const rankIndex = (ladder, id) => ladder.findIndex(row => String(row.id).toLowerCase() === String(id).toLowerCase());

/** The foes of the pin in pack order (`env.order` lists refs; the pin itself is sorted), each with its words. */
function foesOf(env) {
    const list = Object.values(env.pin.resolved.foes ?? {});
    const place = new Map((env.order ?? []).map((ref, i) => [ref, i]));
    return list.map((foe, i) => ({ foe, order: place.has(foe.id) ? place.get(foe.id) : (env.order?.length ?? 0) + i,
        names: [foe.name, foe.slug, ...(Array.isArray(foe.aliases) ? foe.aliases : [])].filter(Boolean).map(phraseWords).filter(words => words.length),
        tags: (foe.loreTags ?? []).flatMap(phraseWords) })).sort((a, b) => a.order - b.order);
}

const levelOf = (env, row) => defaultRank(env.ladder, 'normal', row.foe.level);
const distance = (a, b) => Math.abs(a - b);

/** The foe a phrase names, by the first rule that finds one (§4.3 steps 1 to 4); null for none. `how`: 'exact' | 'contains' | 'part' | 'scan'. */
function findFoe(env, foes, phrase, hintIndex) {
    const words = phraseWords(phrase);
    if (!words.length) return null;
    const part = () => {
        const found = foes.filter(row => row.names.some(name => within(words, name)));
        if (found.length < 2) return found[0] ?? null;
        const rankOf = row => rankIndex(env.ladder, levelOf(env, row)?.id);
        return [...found].sort((a, b) => distance(rankOf(a), hintIndex) - distance(rankOf(b), hintIndex)
            || distance(a.foe.level, env.level ?? 1) - distance(b.foe.level, env.level ?? 1) || a.order - b.order)[0];
    };
    const exact = foes.find(row => row.names.some(name => sameWords(name, words)));
    if (exact) return { row: exact, how: 'exact' };
    const contains = foes.filter(row => row.names.some(name => within(name, words)))
        .sort((a, b) => Math.max(...b.names.map(n => n.length)) - Math.max(...a.names.map(n => n.length)) || a.order - b.order)[0];
    if (contains) return { row: contains, how: 'contains' };
    const found = part();
    if (found) return { row: found, how: 'part' };
    return null;
}

function scanFoe(env, foes, goal, hintIndex) {
    const seen = new Set();
    for (const raw of wordsOf(goal)) {
        const word = singular(raw);
        if (word.length < 3 || seen.has(word) || FILLER.includes(word) || STOP_WORDS.has(word) || SKIPPED.includes(word)) continue;
        seen.add(word);
        const found = findFoe(env, foes, word, hintIndex);
        if (found && found.how === 'part') return { ...found, how: 'scan' };
    }
    return null;
}

/** Whether the engine can fight `foe` in `area` (the checks a kill objective runs): `{ ok }` or `{ ok: false, code }`. */
function fightable(env, foe, area) {
    const checked = foeToEngine(foe, { rules: DEFAULT_RULES, forms: env.ix, items: ref => env.ix.itemDef(ref), area, ordinal: 1 });
    return checked.ok ? { ok: true } : { ok: false, code: checked.code };
}

/** The named variant of a foe for a phrase nothing matched (§4.3 step 5): `{ row, foe, name }` or null. */
function variantFor(env, foes, phrase, hintIndex, area) {
    const words = phraseWords(phrase);
    if (!words.length) return null;
    const name = titleCase(phrase, NAME_CHARS);
    const shared = row => new Set([...row.names.flat(), ...row.tags].filter(word => words.includes(word))).size;
    const near = foes.map(row => ({ row, shared: shared(row) })).filter(entry => entry.shared > 0)
        .sort((a, b) => b.shared - a.shared || distance(rankIndex(env.ladder, levelOf(env, a.row)?.id), hintIndex) - distance(rankIndex(env.ladder, levelOf(env, b.row)?.id), hintIndex)
            || distance(a.row.foe.level, env.level ?? 1) - distance(b.row.foe.level, env.level ?? 1) || a.row.order - b.row.order).map(entry => entry.row);
    const rest = foes.filter(row => rankIndex(env.ladder, levelOf(env, row)?.id) === hintIndex).sort((a, b) => distance(a.foe.level, env.level ?? 1) - distance(b.foe.level, env.level ?? 1) || a.order - b.order);
    for (const row of (near.length ? near : rest).slice(0, VARIANT_CANDIDATES)) {
        const made = foeVariant(row.foe, name, area);
        // The objective binds the base foe, so the base must be one the area lets fight as well as the named kind.
        if (made.ok && fightable(env, made.foe, area).ok && fightable(env, row.foe, area).ok) return { row, foe: made.foe, name };
    }
    return null;
}

/** The pin's item a phrase names: its name or slug, else one that contains or is contained by it; null unless exactly one (§4.4). */
function findItem(env, phrase) {
    const words = phraseWords(phrase);
    if (!words.length) return null;
    const items = Object.keys(env.pin.resolved.items ?? {}).map(ref => env.ix.itemDef(ref)).filter(def => def?.id && def.name).map(def => ({ def, names: [def.name, String(def.id).split('/')[1]].map(phraseWords).filter(w => w.length) }));
    const exact = items.filter(row => row.names.some(name => sameWords(name, words)));
    if (exact.length === 1) return exact[0].def;
    if (exact.length > 1) return null;
    const loose = items.filter(row => row.names.some(name => within(words, name) || within(name, words)));
    if (loose.length === 1) return loose[0].def;
    // Several: the one whose name ends with the phrase ("pelts" is a Crag Wolf Pelt, not a Wolf-pelt Mantle).
    const headed = loose.filter(row => row.names.some(name => name.slice(-words.length).join(' ') === words.join(' ')));
    return headed.length === 1 ? headed[0].def : null;
}

/** The ladder rows that have an open template, as indexes, ascending. */
const templatedRows = (env, open) => [...new Set(open.map(template => rankIndex(env.ladder, template.rank)).filter(i => i >= 0))].sort((a, b) => a - b);
/** A rank index held to a row with a template: above the top the top; between, the next one below; below the lowest the lowest. */
function templated(rows, index) {
    if (!rows.length) return index;
    const below = rows.filter(row => row <= index);
    return below.length ? below.at(-1) : rows[0];
}

/**
 * Reads and settles one `+ quest` line.
 *   env  { pin, ix, ladder, level, area, currency, inputs, clock, here, words, order }
 *        pin `{ hash, resolved }` (quests/seams pinned()); ix the pin's index; ladder the rank rows `[{ id, title, levels, reward }]`; level the PC's
 *        level or null; area `areaPolicyNow` (tier null when unknown); currency `inventory.currency`; inputs what `evaluateRequirements` reads;
 *        clock whether the story clock is set; here `{ id, name }` of the canonical place or null; words the manifest's `offerWords`; order
 *        the foe refs in pack order; thread(name) the director's thread of that name or null; declined(key) whether a far-out decision is recorded for the offer key.
 *   line the host's parsed line `{ name, text, labels }`
 * → { kind: 'offer', band, settled, binding, said, notes, where, area, link } | { kind: 'noop', message }
 *   | { kind: 'far', name, why: 'reward' | 'done' | 'already', ... } | { kind: 'refuse', code, message }
 */
export function matchOffer(env, line) {
    const read = readLine(line);
    if (!read.name) return refuse('INVALID', 'Name the job in plain words.');
    const notes = [];
    const said = saidOf(line);
    // Dedupe (§5.3): the name as written, without its article and with "The" added are one job; only equal keys merge.
    const found = typeof env.thread === 'function' ? [read.name, read.name.replace(/^(?:the|a|an)\s+/i, ''), `The ${read.name.replace(/^(?:the|a|an)\s+/i, '')}`].map(spelling => env.thread(spelling)).find(Boolean) ?? null : null;
    let link = null;
    if (found?.rpg) {
        if (['offered', 'active'].includes(found.rpg.state)) return { kind: 'noop', message: `${flat(found.key, NAME_CHARS) || read.name} is already posted.` };
        return { kind: 'far', name: flat(found.key, NAME_CHARS) || read.name, why: 'already', said };
    }
    if (found) link = found.id;
    const labelled = OFFER_LABELS.some(key => Object.hasOwn(lowerKeys(line.labels), key));
    if (!found && !labelled && typeof env.declined === 'function' && env.declined(offerKey(read.name))) return { kind: 'noop', message: `${read.name} was not offered.` };
    if (DONE.test(read.status) || /^(?:yes|true)$/i.test(read.met) || DONE.test(String(line.text ?? '').trim()) && !read.goalLabelled) {
        return { kind: 'far', name: read.name, why: 'done', said };
    }
    const all = templates(env.pin);
    const open = all.filter(template => template.open === true && ['story', 'kill', 'collect', 'visit'].includes(kindOf(template)));
    if (!open.length) return refuse('RULES_MISMATCH', 'This world has no open job template for that.');
    const ladder = env.ladder;
    const rows = templatedRows(env, open);
    const party = defaultRank(ladder, 'normal', env.level);
    const partyIndex = Math.max(0, ladder.indexOf(party));

    // The template `like:` names, if it is an open one (the first word run: "swordplay — blade drills" names swordplay).
    const likeKey = read.like.split(/\s+[—–-]\s+/)[0].trim();
    const liked = likeKey ? open.find(template => template.id === likeKey || template.slug === likeKey) ?? null : null;
    if (likeKey && !liked) notes.push(NOTE.likeUnknown(likeKey));

    // Type and kind (§3.2): the `type:` word, else the goal's first verb, else the labels that name a target; `like:` names its template's kind.
    let type = typeFromLabel(read.type, env.words);
    if (!type) type = firstVerb(read.goal, { words: env.words })?.type ?? null;
    if (!type && read.foeLabel) type = 'hunt';
    if (!type && read.itemLabel) type = 'gather';
    if (!type && read.placeLabel) type = 'explore';
    let kind = type ? TYPES[type].kind : 'story';
    if (liked) kind = kindOf(liked);

    // The hint rank (§4.1).
    const writtenRank = read.difficulty ? rankNamed(read.difficulty, ladder) : null;
    const word = read.difficulty && !writtenRank ? difficultyFromLabel(read.difficulty, env.words) : null;
    let hint = party;
    if (writtenRank) hint = ladder[Math.min(ladder.indexOf(writtenRank), partyIndex + WRITTEN_RANKS_ABOVE)];
    else if (word) hint = defaultRank(ladder, word, env.level, WRITTEN_RANKS_ABOVE);
    const hintIndex = ladder.indexOf(hint);

    // Target phrase and count (§4.2).
    let phrase = '';
    let written = null;
    if (kind === 'kill' || kind === 'collect' || kind === 'visit') {
        let source = read.target;
        if (!source) {
            const verb = firstVerb(read.goal, { words: env.words, kind });
            source = verb ? read.goal.slice(verb.end) : '';
        }
        const target = targetOf(source);
        phrase = target.phrase;
        written = target.count;
    }
    if (read.count) {
        const counted = countOf(read.count, { amountWords: true });
        if (counted !== null) written = counted;
    }

    // The area the job is made in (§4.7); a matched foe above it moves it to the foe's own tier.
    let area = { ...env.area, tier: Number.isInteger(env.area?.tier) ? env.area.tier : tierOfRank(hint) };
    let from = Number.isInteger(env.area?.tier) ? 'place' : 'rank';
    let foe = null;
    let item = null;
    let place = null;
    let storyWhy = null;
    let rankIdx = hintIndex;
    let foeRank = null;

    if (kind === 'kill') {
        const foes = foesOf(env);
        const ref = REF.test(read.target) ? env.ix.foe(read.target.split('~')[0]) : null;
        let found = ref ? { row: foes.find(row => row.foe.id === ref.id), how: 'exact' } : phrase ? findFoe(env, foes, phrase, hintIndex) : scanFoe(env, foes, read.goal, hintIndex);
        if (found) {
            const own = found.row.foe;
            const tier = Math.max(0, Math.ceil(own.level / 10) - 1);
            const above = tier > area.tier;
            const useArea = above ? { ...area, tier } : area;
            const checked = fightable(env, own, useArea);
            if (checked.ok) {
                if (above) { area = useArea; from = 'foe'; }
                foe = { ref: own.id, base: own.id, name: own.name, how: found.how, level: own.level };
            } else {
                storyWhy = NOTE.cannotFight(own.name);
                found = null;
            }
        } else if (phrase) {
            const made = variantFor(env, foes, phrase, hintIndex, area);
            if (made) {
                foe = { ref: made.foe.id, base: made.row.foe.id, name: made.name, how: 'variant', level: made.foe.level };
                notes.push(NOTE.variant(made.name, made.row.foe.name));
            } else storyWhy = NOTE.noFoe(phrase);
        } else storyWhy = NOTE.noFoe(phrase || read.goal);
        if (foe) {
            foeRank = levelOf(env, { foe: { level: foe.level } });
            rankIdx = rankIndex(ladder, foeRank?.id);
        }
    } else if (kind === 'collect') {
        const def = REF.test(read.target) ? env.ix.itemDef(read.target) : phrase ? findItem(env, phrase) : null;
        if (def) item = { ref: def.id, name: def.name };
        else storyWhy = NOTE.noItem(phrase || read.goal);
    } else if (kind === 'visit') {
        const asked = read.placeLabel || read.target || phrase;
        const found = asked && typeof env.placeOf === 'function' ? env.placeOf(asked) : null;
        if (found?.id) place = { id: found.id, name: flat(found.name || asked, NAME_CHARS), record: found };
        else storyWhy = NOTE.noPlace(asked || read.goal);
    }
    if (storyWhy) notes.push(storyWhy);
    const jobKind = (kind === 'kill' && foe) || (kind === 'collect' && item) || (kind === 'visit' && place) ? kind : 'story';

    // The template (§4.6): the rank first, then lower ones, then the rank's story template.
    let rank = templated(rows, rankIdx);
    const foeAbove = foe && rankIdx > partyIndex;
    const choose = () => {
        const order = [];
        const sameKind = index => open.filter(template => rankIndex(ladder, template.rank) === index && kindOf(template) === jobKind);
        if (liked && kindOf(liked) === jobKind) order.push(liked);
        for (let index = rank; index >= 0; index -= 1) order.push(...sameKind(index));
        for (let index = rank; index >= 0; index -= 1) order.push(...open.filter(template => rankIndex(ladder, template.rank) === index && kindOf(template) === 'story'));
        for (const template of order) {
            const checked = evaluateRequirements(template.requirements ?? [], env.inputs);
            if (checked.ok) return { template, waived: [] };
            if (foeAbove) {
                const rest = (template.requirements ?? []).filter(requirement => requirement.kind !== 'level');
                if (rest.length < (template.requirements ?? []).length && evaluateRequirements(rest, env.inputs).ok) return { template, waived: ['level'] };
            }
        }
        return null;
    };
    const chosen = choose();
    if (!chosen) return refuse('RULES_MISMATCH', 'This world has no open job template for that.');
    const { template, waived } = chosen;
    const settledKind = kindOf(template);
    if (settledKind === 'story' && jobKind !== 'story') {
        // The template fell back to a story task: the target cannot be counted, the story judges the goal.
        notes.push(jobKind === 'kill' ? NOTE.noFoe(phrase || read.goal) : jobKind === 'collect' ? NOTE.noItem(phrase || read.goal) : NOTE.noPlace(phrase || read.goal));
        foe = null;
        item = null;
        place = null;
    }
    const templateRank = rankIndex(ladder, template.rank);
    if (templateRank >= 0) rank = templateRank;
    const rankRow = ladder[rank] ?? hint;
    if (foe && foeRank && (writtenRank || word) && ladder.indexOf(hint) !== rankIdx) notes.push(NOTE.setAside(`difficulty ${read.difficulty}`, foe.name, foeRank.id));
    if (rank > partyIndex) notes.push(NOTE.aboveRank(rankRow.id, party.id));

    // The area's tier for the formula when the place gave none is the template rank's.
    if (!Number.isInteger(env.area?.tier) && from === 'rank') area = { ...area, tier: tierOfRank(rankRow) };
    const range = template.reward;
    const tier = area.tier;

    // Count (§4.5).
    let count = null;
    let moved = false;
    if (settledKind === 'kill' || settledKind === 'collect') {
        const bounds = boundsOf(all, template);
        if (written === null) {
            count = bounds.own;
            notes.push(NOTE.countSet(count));
        } else if (written > bounds.max) {
            count = bounds.max;
            moved = true;
            notes.push(NOTE.countCapped(bounds.max));
        } else if (written < bounds.min) {
            count = bounds.min;
            moved = true;
            notes.push(NOTE.countSet(bounds.min));
        } else count = written;
    }

    // Coin (§4.7).
    const formula = formulaAt(range.coinMin, range.coinMax, tier);
    let coin = formula;
    let coinBy = 'formula';
    const reward = parseReward({ reward: read.reward, goal: read.goal }, '', { currency: env.currency, amountWords: true });
    if (reward) {
        if (reward.amount === null) {
            moved = true;
            const foreign = /is not this chat's money|is not a coin here/.test(reward.problem ?? '');
            notes.unshift(foreign ? NOTE.rewardForeign(flat(reward.text, 60), coin, env.currency) : NOTE.rewardUnreadable(flat(reward.text, 60), coin, env.currency));
        } else {
            const total = reward.each && count !== null ? reward.amount * count : reward.amount;
            const held = hold(total, range.coinMin, range.coinMax);
            if (held.far) return { kind: 'far', name: read.name, why: 'reward', written: total, max: range.coinMax, rank: rankRow.id, said };
            coin = held.value;
            coinBy = 'said';
            if (held.moved) {
                moved = true;
                notes.unshift(NOTE.rewardSet(coin, rankRow.id, env.currency));
            }
        }
    }
    const xp = formulaAt(range.xpMin, range.xpMax, tier);

    // Deadline (§5.1).
    let durationMinutes = null;
    if (!env.clock) notes.push(NOTE.noClock());
    else {
        const [shortest, longest] = durationRange(template);
        const asked = read.due ? minutesOf(read.due) : null;
        if (asked === null) {
            durationMinutes = Number.isSafeInteger(template.durationMinutes) ? template.durationMinutes : DEFAULT_MINUTES;
            notes.push(NOTE.deadlineSet(durationMinutes));
        } else {
            durationMinutes = Math.min(longest, Math.max(shortest, asked));
            if (durationMinutes !== asked) {
                moved = true;
                notes.push(NOTE.deadlineSet(durationMinutes));
            }
        }
    }
    for (const label of read.unused) notes.push(NOTE.unused(label));

    const settled = {
        template: template.id, text: read.goal,
        ...(settledKind === 'kill' && foe ? { foe: { ref: foe.ref, base: foe.base, name: foe.name, how: foe.how } } : {}),
        ...(settledKind === 'collect' && item ? { item } : {}),
        ...(settledKind === 'visit' && place ? { place: { id: place.id, name: place.name } } : {}),
        ...(count !== null ? { count } : {}),
        coin, coinBy, xp, durationMinutes, turnInPlace: env.here?.id ?? null, giver: read.giver || null,
        rank: rankRow.id, area: { tier, from }, waived,
    };
    const binding = bindingOf(settled);
    return { kind: 'offer', band: bandOf({ moved }), settled, binding, said, notes: keepNotes(notes), where: flat(env.here?.name ?? '', NAME_CHARS), area, link, ...(place ? { placeRecord: place.record } : {}) };
}
