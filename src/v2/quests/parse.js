// RPG Battle v2, quests: reading a quest's target and reward out of the words the
// story wrote (its `target:` / `reward:` labels, else its goal), and matching names whole-word.
// Pure: no ctx, no state. Every number here comes from the text by code; nothing is guessed
// from a vague sentence ("deal with the wolves" has no target, and that is fine).

import { entityKey } from './words.js';

const clean = value => String(value ?? '').normalize('NFKC').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();

export const NUMBER_WORDS = Object.freeze({
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20,
});
const COUNT = `(\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;

// Amount phrases a story uses for a number (RB generative offers §3.2), longest first. Read only where a caller asks (`amountWords`).
const AMOUNT_PHRASES = Object.freeze([['half a dozen', 6], ['a score of', 20], ['a handful of', 5], ['a couple of', 2], ['a hundred', 100],
    ['a dozen', 12], ['a pair of', 2], ['a few', 3], ['several', 4], ['dozen', 12]]);
const AMOUNT_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(${AMOUNT_PHRASES.map(([phrase]) => phrase.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
const AMOUNT_VALUE = new Map(AMOUNT_PHRASES);

/** The text with each amount phrase ("a dozen", "a handful of") written as its digits: "a dozen crowns" → "12 crowns". */
export function amountDigits(text) {
    return String(text ?? '').replace(AMOUNT_PATTERN, found => String(AMOUNT_VALUE.get(found.toLowerCase().replace(/\s+/g, ' '))));
}

/** A whole count from digits or a number word up to twenty; null for anything else. `amountWords`: an amount phrase ("a dozen") counts too. */
export function countOf(word, { amountWords = false } = {}) {
    const text = clean(amountWords ? amountDigits(word) : word).toLowerCase();
    if (/^\d+$/.test(text)) {
        const value = Number(text);
        return Number.isSafeInteger(value) ? value : null;
    }
    return Object.hasOwn(NUMBER_WORDS, text) ? NUMBER_WORDS[text] : null;
}

// Plurals entityKey (v1) does not know; everything else goes through it.
const IRREGULAR = Object.freeze({
    thieves: 'thief', elves: 'elf', dwarves: 'dwarf', halves: 'half', wives: 'wife', calves: 'calf',
    men: 'man', women: 'woman', teeth: 'tooth', feet: 'foot', children: 'child', oxen: 'ox', lice: 'louse',
    hooves: 'hoof', loaves: 'loaf', scarves: 'scarf', staves: 'staff', pennies: 'penny', pence: 'penny',
});

const PLURAL_OF = Object.freeze(Object.fromEntries([
    ...Object.entries(IRREGULAR), ['wolves', 'wolf'], ['knives', 'knife'], ['leaves', 'leaf'], ['mice', 'mouse'], ['geese', 'goose'],
].filter(([many]) => many !== 'pence').map(([many, one]) => [one, many])));

/** One word in its singular, lower case: "Wolves" → "wolf", "Rats" → "rat", "boss" → "boss". */
export function singular(word) {
    const lower = clean(word).toLowerCase();
    return IRREGULAR[lower] ?? entityKey(lower);
}

const wordsOf = text => clean(text).toLowerCase().split(/[^\p{L}\p{N}'-]+/u).filter(Boolean).map(singular);

/**
 * Whether `noun` names the thing called `name`, by whole words in the singular: the noun's
 * words appear in the name, in order and side by side. "wolves" matches "Grey Wolf" and
 * "Wolf", never "Wolfhound Handler"; "cellar rats" matches "Cellar Rat Swarm".
 */
export function nameMatches(noun, name) {
    const want = wordsOf(noun);
    const have = wordsOf(name);
    if (!want.length || want.length > have.length) return false;
    for (let start = 0; start + want.length <= have.length; start += 1) {
        if (want.every((word, i) => have[start + i] === word)) return true;
    }
    return false;
}

const FOE_VERBS = ['defeat', 'kill', 'slay', 'slaughter', 'beat', 'clear', 'cull', 'hunt', 'hunt down', 'destroy',
    'vanquish', 'exterminate', 'dispatch', 'eliminate', 'take down', 'put down', 'wipe out', 'bring down', 'fight'];
const ITEM_VERBS = ['bring', 'bring back', 'deliver', 'fetch', 'gather', 'collect', 'find', 'retrieve', 'recover',
    'harvest', 'return', 'obtain', 'procure', 'forage', 'possess', 'get', 'hand over', 'turn in', 'buy', 'pick'];
const verbPattern = list => [...list].sort((a, b) => b.length - a.length).map(verb => `${verb.replace(' ', '\\s+')}s?`).join('|');
const VERB_KIND = new RegExp(`^(?:(${verbPattern(FOE_VERBS)})|(${verbPattern(ITEM_VERBS)}))$`, 'i');
const VERBS = verbPattern([...FOE_VERBS, ...ITEM_VERBS]);

// Where a target's noun ends: a preposition, a joining word, or punctuation.
export const STOP_WORDS = new Set(['from', 'in', 'at', 'near', 'for', 'to', 'on', 'by', 'before', 'after', 'within', 'and',
    'or', 'with', 'around', 'outside', 'inside', 'under', 'over', 'that', 'who', 'which', 'while', 'then', 'until',
    'each', 'per', 'apiece', 'into', 'across', 'along', 'behind', 'beyond', 'without', 'if', 'so', 'as']);
const NOUN_WORDS_MAX = 5;

function nounAfter(rest) {
    const words = [];
    for (const match of rest.matchAll(/([\p{L}][\p{L}'-]*)|([^\s\p{L}])/gu)) {
        if (match[2]) break;
        const word = match[1];
        if (STOP_WORDS.has(word.toLowerCase())) break;
        words.push(word);
        if (words.length > NOUN_WORDS_MAX) return '';
    }
    return words.join(' ');
}

// "and 2 bears" / ", 4 boars" right after the noun: two targets at once, which code does not split.
const SECOND_TARGET = new RegExp(`^\\s*(?:,|&|\\band\\b|\\bor\\b)\\s*(?:then\\s+)?(?:at\\s+least\\s+)?${COUNT}\\s+\\p{L}`, 'iu');

function targetIn(text, { verbRequired }) {
    const head = verbRequired
        ? new RegExp(`(?:^|[^\\p{L}])(${VERBS})\\s+(?:the\\s+)?(?:at\\s+least\\s+)?${COUNT}\\s+`, 'iu')
        : new RegExp(`^(?:(${VERBS})\\s+)?(?:the\\s+)?(?:at\\s+least\\s+)?${COUNT}\\s+`, 'iu');
    const match = head.exec(text);
    if (!match) return null;
    const count = countOf(match[2]);
    if (!count || count < 1) return null;
    const rest = text.slice(match.index + match[0].length);
    const noun = nounAfter(rest);
    if (!noun) return null;
    const after = rest.slice(rest.indexOf(noun) + noun.length);
    if (SECOND_TARGET.test(after)) return null;
    const verb = (match[1] ?? '').toLowerCase().replace(/\s+/g, ' ');
    const kinds = VERB_KIND.exec(verb);
    const kind = kinds ? (kinds[1] ? 'foes' : 'items') : null;
    return { noun, count, kind };
}

/**
 * A quest's target from its fields: `{ noun, count, kind: 'foes' | 'items' | null }` or null.
 * The `target:` label may leave out the verb ("3 wolves", "at least 3 wolves"), then `kind`
 * is null and the caller decides it (an item the inventory knows, else foes); in the goal
 * text a verb is needed ("Clear at least 3 wolves from East Bluff"). A label code cannot read
 * gives no target rather than falling back to the goal.
 */
export function parseTarget(fields = {}, summary = '') {
    const label = clean(fields.target);
    if (label) return targetIn(label, { verbRequired: false });
    for (const text of [fields.goal, fields.desc, summary]) {
        const found = targetIn(clean(text), { verbRequired: true });
        if (found) return found;
    }
    return null;
}

// The coin words code reads as money. A chat has one currency (MODULES §F1). Without coins a number in the
// chat's own currency word (its name, plural, short form, a bare "coin") is a whole amount of it; any other
// coin word ("40 silver" where money is pennies) names a coin the chat does not know, and is never read as
// that many of its money (Story Block MODULES §F122, money.js foreignCoin): code does not pay it, the story's
// words are kept and the reader is told. Only a caller that gives no currency reads the number alone, as
// before. With Story Block's coins (MODULES §F108) a coin word is priced from the chat's coins only (coinValueIn).
const COIN_WORDS = Object.freeze(['copper', 'silver', 'gold', 'platinum', 'electrum', 'cp', 'sp', 'gp', 'pp', 'ep',
    'coin', 'coins', 'crown', 'crowns', 'mark', 'marks', 'penny', 'pennies', 'pence', 'shilling', 'shillings',
    'ducat', 'ducats', 'florin', 'florins', 'sovereign', 'sovereigns', 'denar', 'denars', 'gil']);
const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EACH = `(?:\\s*,?\\s*(?:(each|apiece|a\\s+head|per\\s+head)(?![\\p{L}])(?:\\s+([\\p{L}][\\p{L}'-]*))?|(?:per|for\\s+each|for\\s+every|each)\\s+([\\p{L}][\\p{L}'-]*)))?`;
// The count of a part without its capture group, for the whole reward's pattern.
const COUNT_WORD = `(?:\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;
// What may stand between two parts of one amount: "1 gold 5 silver", "1 gold, 5 silver", "1 gold and 5 silver".
const PART_JOIN = '(?:\\s*[,&+]\\s*|\\s+and\\s+|\\s+)';
// Words that sometimes follow a coin's name and say nothing more (Story Block's money.js COIN_FILLER).
const COIN_FILLER = new Set(['coin', 'coins', 'piece', 'pieces', 'of', 'in']);

const coinsIn = currency => (Array.isArray(currency?.coins) ? currency.coins.filter(coin => coin && Number.isSafeInteger(coin.value) && coin.value >= 1) : []);

// The words for money in this chat: the usual coin words plus the chat's own currency name and
// short form ("Gil", "g") and its coins (with any short form the coin list gives), longest first so "gold coins" is
// read before "gold". No capture group: the parts are read again one by one (PART).
function coinWords(currency) {
    const coins = coinsIn(currency).flatMap(coin => [coin?.name, coin?.plural]);
    const own = [currency?.name, currency?.short, ...coins].map(word => clean(word).toLowerCase()).filter(word => word && /^[\p{L}][\p{L} '-]*$/u.test(word));
    const words = [...new Set([...COIN_WORDS, ...own.flatMap(word => [word, `${word}s`]), ...shortForms(currency).keys()])].sort((a, b) => b.length - a.length);
    return `(?:${words.map(escape).join('|').replace(/ /g, '\\s+')})`;
}

// Short forms the chat's coin list gives its coins (a coin's own `short`, "gp" when the list says so),
// only where one coin has it. A short form the list does not give ("gp" for a coin listed only as
// "gold") is not guessed: Story Block's coin line refuses it too. → Map(short → value).
function shortForms(currency) {
    const seen = new Map();
    for (const coin of coinsIn(currency)) {
        const short = clean(coin.short).toLowerCase();
        if (!short || !/^[\p{L}][\p{L}'-]*$/u.test(short)) continue;
        seen.set(short, seen.has(short) && seen.get(short) !== coin.value ? 0 : coin.value);
    }
    return new Map([...seen].filter(([, value]) => value > 0));
}

/**
 * What one of the money word `word` is worth in the smallest unit with the chat's coins
 * (`currency.coins`, from inventory.currency), by Story Block's own rule (money.js coinValue): a coin's
 * name or plural, or its name + "s", any case, "coins"/"pieces of" around it ignored; the currency's
 * own name or plural is 1; a short form the coin list gives (shortForms). Anything else: 0.
 */
export function coinValueIn(word, currency) {
    const want = clean(word).toLowerCase().split(' ').filter(part => part && !COIN_FILLER.has(part)).join(' ');
    if (!want) return 0;
    const coin = coinsIn(currency).find(entry => [entry?.name, entry?.plural, `${clean(entry?.name)}s`].some(name => clean(name).toLowerCase() === want));
    if (coin) return coin.value;
    const short = shortForms(currency).get(want);
    if (short) return short;
    const plural = clean(currency?.plural) || `${clean(currency?.name)}s`;
    return want === clean(currency?.name).toLowerCase() || want === plural.toLowerCase() ? 1 : 0;
}

/** What one coin named `word` is worth in the smallest unit (coinValueIn); 1 otherwise (a word that only says "money"). */
export function coinWorth(word, currency) {
    return coinValueIn(word, currency) || 1;
}

// One "<n> <coin>" part of an amount: [count, coin word].
const partPattern = currency => new RegExp(`(${COUNT_WORD})\\s+(${coinWords(currency)})(?:\\s+(?:coins?|pieces?))?(?![\\p{L}])`, 'giu');

function rewardPattern(currency) {
    const part = `${COUNT_WORD}\\s+${coinWords(currency)}(?:\\s+(?:coins?|pieces?))?`;
    return new RegExp(`(?:^|[^\\p{L}\\d])(${part}(?:${PART_JOIN}${part})*)(?![\\p{L}])${EACH}`, 'iu');
}

// A `reward:` label that is only a number ("30", "2 each", "1 per wolf"): money too.
const BARE_REWARD = new RegExp(`^${COUNT}${EACH}\\.?$`, 'iu');

/*
 * The amount the parts of one written amount make ("1 gold 5 silver"): `{ amount }`, or `{ amount: null,
 * problem }`. With coins the parts add up, each priced from the chat's coins; a word that is not one
 * of them is refused, never read as the smallest coin ("2 platinum" in a copper/silver/gold world).
 * Without coins one amount is the number; two are refused (no coin says what they are worth together).
 */
function amountOf(written, currency) {
    const parts = [...written.matchAll(partPattern(currency))].map(match => ({ count: countOf(match[1]), word: clean(match[2]) }));
    if (!parts.length || parts.some(part => part.count === null)) return { amount: null, problem: '' };
    const coins = coinsIn(currency);
    if (!coins.length) {
        const foreign = parts.map(part => foreignWord(part.word, currency)).find(Boolean);
        if (foreign) return { amount: null, problem: `"${foreign}" is not this chat's money, which counts in ${moneyWords(currency)}; name the coins under Story Block's Settings → Coins to have it paid` };
        if (parts.length === 1) return { amount: parts[0].count };
        return { amount: null, problem: `"${written}" holds more than one amount; write one amount of ${currencyName(currency)}` };
    }
    let amount = 0;
    for (const part of parts) {
        const value = coinValueIn(part.word, currency);
        if (!value) {
            const names = coins.map(coin => clean(coin.name)).join(', ');
            return { amount: null, problem: `"${part.word}" is not a coin here: write ${names}, or a number of ${smallestOf(currency)}` };
        }
        amount += part.count * value;
    }
    return Number.isSafeInteger(amount) ? { amount } : { amount: null, problem: `"${written}" is too large an amount` };
}

// "gp" is gold pieces in a gold chat (and so on): the metal's own short form (money.js PIECES).
const PIECES = Object.freeze({ gold: 'gp', silver: 'sp', copper: 'cp', platinum: 'pp', electrum: 'ep' });

/*
 * A chat without coins: the coin word `word` when it is not the chat's own money (its name, plural, name +
 * "s", short form, the metal's "gp", a bare "coin"), else ''. '' when no currency is given (the number alone).
 */
function foreignWord(word, currency) {
    if (!currency || typeof currency !== 'object') return '';
    const want = clean(word).toLowerCase().split(' ').filter(part => part && !COIN_FILLER.has(part)).join(' ');
    if (!want) return '';
    const name = clean(currencyName(currency)).toLowerCase();
    const own = [name, `${name}s`, clean(currency.plural).toLowerCase(), clean(currency.short).toLowerCase(), PIECES[name] ?? ''].filter(Boolean);
    return own.includes(want) ? '' : want;
}

// The chat's money in words for a refusal: "pennies", "gold".
const moneyWords = currency => clean(currency?.plural) || currencyName(currency);

// The smallest coin's plural (the one worth 1), else the currency's own name.
function smallestOf(currency) {
    const one = coinsIn(currency).find(coin => coin.value === 1);
    return clean(one?.plural) || clean(one?.name) || currencyName(currency);
}

/**
 * The coin word of a written reward ("30 copper bits") that this chat cannot count, as `amountOf` refuses it
 * (a word that is not the chat's money without Coins, a word that is none of its coins with them), else ''.
 * A reward in such a word is owed, not lost (quests/index.js `owedPhrase`): paid once the chat can count it.
 */
export function unknownCoin(written, currency) {
    const label = clean(written);
    const match = label ? rewardPattern(currency).exec(label) : null;
    if (!match) return '';
    const words = [...match[1].matchAll(partPattern(currency))].map(found => clean(found[2]));
    return (coinsIn(currency).length ? words.find(word => !coinValueIn(word, currency)) : words.map(word => foreignWord(word, currency)).find(Boolean)) || '';
}

// Words that end a coin phrase ("30 copper bits and a horse").
const PHRASE_STOP = new Set(['and', 'plus', 'or', 'each', 'per', 'for', 'a', 'an', 'the', 'of', 'to', 'from', 'in', 'on', 'coin', 'coins', 'piece', 'pieces']);

/**
 * The coin as the story wrote it, for "add copper bits in Settings → Coins": the unknown word (`unknownCoin`)
 * with the word after it when that is a plain word of the phrase ("copper bits"), else the word alone.
 */
export function coinPhrase(written, word) {
    const label = clean(written);
    if (!word) return '';
    const found = new RegExp(`(?:^|[^\\p{L}])${escape(word).replace(/ /g, '\\s+')}(?:\\s+([\\p{L}'-]+))?`, 'iu').exec(label);
    const next = clean(found?.[1]);
    return next && !PHRASE_STOP.has(next.toLowerCase()) ? `${word} ${next}` : word;
}

/**
 * A reward from the `reward:` label, else from the goal text:
 * `{ amount, each, unit, text, per }` — `amount` a whole number of the chat's one currency, in its
 * smallest coin with Story Block's coins ("1 gold 5 silver" is 150 when gold is 100 and silver 10;
 * `unit` is always ''; the currency's name comes from `inventory.currency` when it is shown), or
 * null when the reward is not money code can read (a favour, a horse); `each` when it is paid per
 * unit of the target ("1 silver each wolf", "2 per tail"), `per` the unit word as written ('' when
 * "each" names none). `reward: none` is `{ amount: 0 }`. No reward written → null. A coin amount code
 * refuses (a coin the chat does not have, two amounts without coins) is `amount: null` with `problem`,
 * a plain sentence for the reader. `options.currency` ({ name, short, coins }) adds the chat's own
 * currency words to the coin words; `options.amountWords` reads an amount phrase ("a dozen crowns", "a handful of silver") as its digits first.
 */
export function parseReward(fields = {}, summary = '', { currency = null, amountWords = false } = {}) {
    const spelled = value => clean(amountWords ? amountDigits(value) : value);
    const label = spelled(fields.reward);
    if (/^(?:none|nothing|no reward|unpaid)\.?$/i.test(label)) return { amount: 0, each: false, unit: '', text: label, per: '' };
    const sources = label ? [label] : [fields.goal, fields.desc, summary].map(spelled).filter(Boolean);
    const pattern = rewardPattern(currency);
    for (const text of sources) {
        const bare = text === label ? BARE_REWARD.exec(text) : null;
        const match = bare ? [bare[0], bare[1], bare[2], bare[3], bare[4]] : pattern.exec(text);
        if (!match) continue;
        // Story Block's coins (MODULES §F108): "3 silver" is 30 when silver is worth 10 of the smallest.
        const read = bare ? { amount: countOf(bare[1]) } : amountOf(match[1], currency);
        if (read.amount === null && !read.problem) continue;
        const each = Boolean(match[2] || match[4]);
        // "each wolf" may be "each, paid on return": a word after a bare "each" is only a hint.
        const per = clean(match[4] || match[3] || '');
        const loose = !match[4] && Boolean(match[3]);
        const text2 = label || match[0].replace(/^[^\p{L}\d]/u, '').trim();
        if (read.amount === null) return { amount: null, each: false, unit: '', text: text2, per: '', problem: `${read.problem}.` };
        // Another amount after the one read ("8 pennies per tail + 3 silver"): code would pay only the first,
        // so it pays neither and keeps the story's words.
        const rest = text === label ? text.replace(match[0], ' ') : '';
        const more = rest ? [...rest.matchAll(partPattern(currency))].map(found => clean(found[0])) : [];
        if (more.length) return { amount: null, each: false, unit: '', text: text2, per: '', problem: `"${label}" holds more than one amount (${more.join(', ')} after the first).` };
        return { amount: read.amount, each, unit: '', text: text2, per, loose };
    }
    return label ? { amount: null, each: false, unit: '', text: label, per: '' } : null;
}

/**
 * The reward as stored on the thread (MODULES §C1 shape), checked against the target: a
 * per-unit reward whose unit is not the target's ("1 silver per rat" on a wolf quest) is not
 * money code pays (amount null; the story settles it).
 */
export function settleReward(reward, target) {
    if (!reward) return null;
    const { amount, each, text, per, loose } = reward;
    const unitMismatch = per && target && !nameMatches(per, target.noun) && !nameMatches(target.noun, per);
    if (each && (!target || (unitMismatch && !loose))) return { amount: null, each: false, unit: '', text };
    return { amount, each, unit: '', text };
}

/** The chat's one currency as `{ name }` from a name, a `{ name }` or nothing (gold, Story Block's default). */
export function currencyName(currency) {
    const name = clean(typeof currency === 'string' ? currency : currency?.name);
    return name || 'gold';
}

/**
 * "1 mark", "8 marks": an amount of the chat's one currency (its plural for any amount but one). With coins
 * (`inventory.currency`'s `coins`, the reader's Coins setting or a pack's currency), the way Story Block
 * writes an amount in its wallet and receipts (money.js formatAmount): mixed coins, largest first ("3 silver
 * 5 pennies"), or the smallest coin alone with `display: 'base'` ("35 pennies"), so a quest's terms name
 * the money as the wallet does.
 */
export function money(amount, currency) {
    const coins = typeof currency === 'object' && Array.isArray(currency?.coins)
        ? currency.coins.filter(coin => Number.isSafeInteger(coin?.value) && coin.value > 0 && clean(coin.name)) : [];
    const n = Number(amount);
    if (coins.length && Number.isSafeInteger(n) && n >= 0) {
        const named = (coin, count) => `${count} ${count === 1 ? clean(coin.name) : clean(coin.plural) || clean(coin.name)}`;
        const one = coins.find(coin => coin.value === 1);
        const base = one ?? { name: currencyName(currency), plural: clean(currency?.plural) || currencyName(currency) };
        if (currency.display === 'base' || n === 0) return named(base, n);
        const parts = [];
        let rest = n;
        const shown = coins.filter((coin, index) => coins.findIndex(other => other.value === coin.value) === index);
        for (const coin of [...shown].sort((a, b) => b.value - a.value)) {
            const count = Math.floor(rest / coin.value);
            if (!count) continue;
            parts.push(named(coin, count));
            rest -= count * coin.value;
        }
        if (rest) parts.push(named(base, rest));
        return parts.join(' ');
    }
    const name = currencyName(currency);
    const plural = typeof currency === 'object' ? clean(currency?.plural) : '';
    return `${amount} ${Math.abs(Number(amount)) === 1 || !plural ? name : plural}`;
}

const matchCase = (word, like) => (like[0] && like[0] === like[0].toUpperCase() ? word.replace(/^./, c => c.toUpperCase()) : word);

/**
 * The target's noun for `n` of them: "1 wolf", "8 wolves" (as written when it was plural);
 * a noun written singular after a count above one ("5 moonleaf") is kept as written.
 */
export function nounFor(target, n) {
    const words = clean(target?.noun).split(' ');
    const last = words.at(-1) ?? '';
    const one = singular(last);
    const isPlural = one !== last.toLowerCase();
    if (!isPlural && target.count > 1) return words.join(' ');
    const many = isPlural ? last : PLURAL_OF[last.toLowerCase()] ? matchCase(PLURAL_OF[last.toLowerCase()], last) : (/(?:s|x|z|ch|sh)$/i.test(last) ? `${last}es` : /[^aeiou]y$/i.test(last) ? `${last.slice(0, -1)}ies` : `${last}s`);
    const oneForm = isPlural ? matchCase(one, last) : last;
    words[words.length - 1] = n === 1 ? oneForm : many;
    return words.join(' ');
}

/** The pay for `units` of the target, a whole amount of the currency, or null when code pays nothing. */
export function payFor(reward, units) {
    if (!reward || !Number.isSafeInteger(reward.amount) || reward.amount < 0) return null;
    const total = reward.each ? reward.amount * units : reward.amount;
    return Number.isSafeInteger(total) ? total : null;
}

/** "beat 3 wolves", "bring 5 moonleaf": the target in words, for summaries. */
export function targetText(target) {
    if (!target) return '';
    return `${target.kind === 'items' ? 'bring' : 'beat'} ${target.count} ${nounFor(target, target.count)}`;
}

/** "1 gold per wolf", "8 gold", or the reward as written when it is not money. */
export function rewardText(reward, target, currency) {
    if (!reward) return '';
    if (reward.amount === null) return reward.text;
    if (reward.amount === 0) return 'no reward in money';
    return reward.each ? `${money(reward.amount, currency)} per ${target ? nounFor(target, 1) : 'unit'}` : money(reward.amount, currency);
}
