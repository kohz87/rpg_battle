// The tracker: agendas, events, hooks, clocks, beats and secrets, built only from change
// lines. Because every change lives in the reply that made it, the tracker for any point in
// the chat is a replay of the entries up to it. Pure: every function returns new objects and
// never mutates its inputs (records are copied on write, unchanged ones are shared).

import { FIELDS, QUEST_TYPE_WORDS, formatOp, kindOf, lineKey, questDifficulty } from './changes.js';
import { acceptedContract, requirementOf } from './quest-completion.js';

const HISTORY_LIMIT = 20;
const SUPERSEDED = /supersed|replac|merged/i;
// A quest closed with one of these was not done: it ended without the work being finished.
const FAILED = /\b(?:fail|abandon|gave up|give up|given up|giving up|forfeit|quit\b|walked away|backed out|called off|withdr[eao]w|expired|missed|too late|cancel|refused|declined|botched)/i;
// (0.9.1) How a model says something is over without a `-` line: `~ Quest — step: done`,
// `status: completed`, `outcome: failed`. Only a value that is one of these words, alone or
// before punctuation ("completed — the wolves are dead"): "complete the ritual" is a step.
const OVER_VALUE = /^(?:done|complete|completed|finished|fulfilled|accomplished|resolved|succeeded|success|turned in|handed in|delivered|over|closed|failed|failure|abandoned|given up|gave up|forfeit|forfeited|quit|withdrawn|called off|expired|cancell?ed)\s*(?:$|[.,;:!—–(-])/i;
// (0.9.42) A quest's step that opens with the ending and goes on to confirm it: "Completed and
// turned in to Fenna" (the rest says turned in), or with a `reward:` that reads as paid in the
// same line ("reward: Claimed 2 gold"). "done tracking, now the den" is still a step.
const OVER_START = /^(?:done|completed|finished|fulfilled|accomplished|cleared|turned in|handed in|delivered|failed|abandoned)\b\s*(?:and|&|,|—|–|-|;)\s*(.+)$/i;
const REWARD_TAKEN = /^(?:claimed|collected|received|paid|taken|pocketed|got)\b/i;
const overStep = (value, op) => {
    const rest = value.match(OVER_START)?.[1] ?? '';
    if (!rest) return false;
    return LOOKS_OVER.test(rest) || QUEST_OVER_TEXT.test(rest) || REWARD_TAKEN.test(String(op?.fields?.reward ?? op?.extra?.reward ?? '').trim());
};
// The labels such a value comes under: any record's status or outcome, and a quest's step or now.
const OVER_LABELS = ['status', 'state', 'outcome', 'result', 'progress'];
const QUEST_OVER_FIELDS = ['step', 'now'];
// A `!` on a quest that says it was finished or failed ("! Sheep-killer — wolves slain, reward paid").
// (0.9.27) Or the pay for it: "voucher paid", "bounty collected".
const QUEST_OVER_TEXT = /\b(?:complet|finish|fulfil|accomplish|done\b|turned in|handed in|(?:reward|bounty|voucher|fee|payment)(?:ed)?\s+(?:paid|collected|received|claimed)|paid out|paid in full)/i;
// (0.9.13) A `-` that says the job was taken on, not ended: "- Hook Sheepfold Wolves — accepted
// by Wessel" beside the `+ quest` it became. Not when it also speaks of pay or an ending.
const TAKEN_ON = /\b(?:accept(?:s|ed)?|tak(?:es|en|ing) (?:on|up)|took (?:on|up)|signed (?:on|up|for)|agreed to|became (?:a |the )?(?:quest|bounty|contract|job)|(?:now|turned into|converted (?:in)?to|promoted to|upgraded to) (?:a |the )?(?:quest|bounty|contract|job))\b/i;
const NOT_TAKEN_ON = /\b(?:reward|paid|pay(?:ment)?|coin|silver|gold|copper|fee)\b/i;
const endsJob = reason => QUEST_OVER_TEXT.test(reason) || FAILED.test(reason) || LOOKS_OVER.test(reason);
const takenOn = reason => TAKEN_ON.test(reason) && !NOT_TAKEN_ON.test(reason) && !QUEST_OVER_TEXT.test(reason) && !FAILED.test(reason) && !LOOKS_OVER.test(reason);

// (0.9.5) A quest still open whose own progress reads as over ("step: wolf slain, reward
// collected"): finished or failed words in its step or now. Not its goal or description, which
// say what the job is ("complete the ritual").
const LOOKS_OVER = /\b(?:completed|finished|fulfilled|accomplished|done\b(?!\s+with)|turned in|handed in|delivered|(?:reward|bounty|voucher|fee|payment)(?:ed)?\s+(?:paid|collected|received|claimed)|paid out|paid in full|failed|abandoned|gave up|given up|forfeit(?:ed)?|quit\b|walked away|backed out|called off|expired|too late)/i;

// (0.9.28) A step that is only the pay left to collect ("turn in voucher at the bailiff hatch",
// "collect the bounty from Verna"): the work is done. A time it was given is when the pay can be
// had, not a deadline the job can be failed by; and a failing reason that is only about time.
const PAY_WORDS = '(?:vouchers?|rewards?|bount(?:y|ies)|pay|payment|purse|coins?|fees?|chits?|tokens?|receipts?|scrip|silver|gold|copper|wages?)';
const CLAIM_STEP = new RegExp(`\\b(?:(?:turn|hand|cash|redeem|collect|claim|pick)(?:s|ed|ing)?(?: in| up)?|exchang(?:e|es|ed|ing))(?:\\s+[\\w'’-]+){0,2}?\\s+${PAY_WORDS}\\b|\\b(?:get|getting|be) paid\\b|\\b(?:return|go back|report)\\w*(?:\\s+[\\w'’-]+){0,4}?\\s+for\\s+(?:the |their |his |her |my |our )?${PAY_WORDS}\\b`, 'i');
const TIME_FAIL = /\b(?:expired|missed|too late|deadline|lapsed|ran out|out of time|overdue|late\b|window (?:closed|passed|shut))/i;

/** (0.9.28) Whether an open quest's work is done and only its pay is left (its step or now says so). */
export function waitsForPay(record) {
    if (record?.kind !== 'quest' || record.status !== 'active') return false;
    return ['step', 'now'].some(field => CLAIM_STEP.test(String(record.fields?.[field] ?? '')));
}

/** Whether an open quest's step or now says it is over, so the note can ask the story to close it. */
export function looksFinished(record) {
    if (record?.kind !== 'quest' || record.status !== 'active') return false;
    if (record.contract || requirementOf(record.fields, record.extra).managed) return false;
    return ['step', 'now'].some(field => LOOKS_OVER.test(String(record.fields?.[field] ?? '')));
}

// (0.9.6) The reader's own message (or the reply's narration) saying a job is given up: a
// sentence with one of these and the quest's key, or its giver's name. Only ever a hint: the
// note asks the story to close it, nothing is closed here.
const GIVE_UP = /\b(?:give up|gave up|giving up|given up|forfeit(?:s|ed|ing)?|abandon(?:s|ed|ing)?|quit(?:s|ting)?|walk(?:s|ed|ing)? away from|back(?:s|ed|ing)? out of|call(?:s|ed|ing)? off|drop(?:s|ped|ping)? the (?:job|bounty|contract|quest|hunt|search))\b/i;
const NOT_BEFORE = /\b(?:not|never|won't|wont|don't|dont|didn't|didnt|wouldn't|can't|cannot|refuse to)\s+(?:\w+\s+){0,2}$/i;

/** The open quests a text says are given up, by key: [key], in tracker order. */
export function givenUpIn(tracker, text) {
    const sentences = String(text ?? '').split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);
    const said = sentences.filter(sentence => {
        const match = GIVE_UP.exec(sentence);
        return match && !NOT_BEFORE.test(sentence.slice(0, match.index));
    });
    if (!said.length) return [];
    const names = record => [record.key, String(record.fields?.giver ?? '').trim(), ...(record.aliases ?? [])].filter(name => name.length >= 3);
    const named = (sentence, name) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(sentence);
    return (tracker?.records ?? [])
        .filter(record => record.kind === 'quest' && record.status === 'active')
        .filter(record => said.some(sentence => names(record).some(name => named(sentence, name))))
        .map(record => record.key);
}

// (0.9.15) Choices about a job are the reader's: taking it on, turning it down, giving it up.
// The model's line for one counts only when the reader's own message (the one the reply answers)
// made it, naming the job (its key, its giver or a word of its name). The story keeps the
// outcomes: done, failed, expired. A main quest is the story's to give, and a job the story
// moves on (a step under way) is one the character is already doing.
// (0.9.27) "We" as well as "I", and going along: "we'll join the hunt", "count us in".
// (0.9.32) Taking a notice off a board, or several at once: "took down all three contracts".
const ACCEPT_WORDS = /\b(?:accept(?:s|ed|ing)?|take (?:it|this|that|the|on|up|them|down|all|both|these|those)|takes (?:it|the|on|up|them|down|all|both)|took (?:it|the|on|up|them|down|all|both|these|those)|taking (?:it|the|on|up|them|down|all|both)|(?:tore|pulled|ripped) (?:down|off) (?:the|all|both|them|these|those)|(?:i|we)(?:'?ll| will| shall) (?:take|do|handle|join|help|see to)|join(?:s|ed)? (?:the|you|your|in)|agree(?:s|d)? to|sign(?:s|ed)? (?:up|on)|count (?:me|us) in|(?:i'?m|we'?re) in|(?:i'?m|we'?re) up for|up for it|let'?s do (?:it|this)|deal|choose|chose|pick(?:s|ed)?)\b/i;
// (0.9.27) Plain yes words: they take a job only when the reply's one new quest is the question.
const AGREE_WORDS = /^\W*(?:yes|yeah|aye|sure|okay|ok|alright|all right|very well|of course|fine)\b/i;
const REFUSE_WORDS = /\b(?:refuse[sd]?|refusing|declin(?:e|es|ed|ing)|turn(?:s|ed|ing)? (?:it |that |this |them )?down|no thanks|pass(?:es|ed)? on|not interested)\b/i;
// A closing reason that is the reader's decision rather than the story's outcome.
const CHOSEN_END = /\b(?:abandon|gave up|give up|given up|giving up|forfeit|quit\b|walked away|backed out|withdr[eao]w|refus|declin|turned down|passed on)/i;
// Words of a job's name too general to say which job is meant.
const GENERIC_WORDS = new Set(['quest', 'job', 'jobs', 'contract', 'bounty', 'task', 'work', 'mission', 'favour', 'favor', 'side', 'main']);
// A step that has not started is not the story moving a job on.
const NOT_STARTED = /^\s*(?:0\s*(?:\/|of)\s*\d+|0|none|not (?:yet )?started|pending|unstarted)\b/i;

// (0.9.32) Every job in question at once: "all three contracts", "both jobs", "all of them".
const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6 };
const JOB_NOUNS = '(?:contracts?|jobs?|quests?|bount(?:y|ies)|tasks?|postings?|notices?|offers?|commissions?|requests?|errands?)';
const ALL_JOBS = new RegExp(`\\b(?:(?:all|both|every|each)(?:\\s+(?:of\\s+)?(?:the|these|those))?(?:\\s+(\\d+|two|three|four|five|six))?\\s+${JOB_NOUNS}|(?:all|both)(?:\\s+(\\d+|two|three|four|five|six))?\\s+of\\s+(?:them|those|these)|them\\s+(?:all|both))\\b`, 'i');

/** How many jobs "all of them" means in `said`: { count } (null: as many as are in question), or null when it says none. */
function allJobsIn(said) {
    for (const sentence of sentencesOf(said)) {
        const match = ALL_JOBS.exec(sentence);
        if (!match) continue;
        const word = String(match[1] ?? match[2] ?? '').toLowerCase();
        const count = /^\d+$/.test(word) ? Number(word) : COUNT_WORDS[word] ?? (/\bboth\b/i.test(match[0]) ? 2 : null);
        return { count };
    }
    return null;
}

/**
 * The offers "all of them" means: the ones shown most lately before reply `message` (a
 * count given: that many, newest first). [record]
 */
function offersInQuestion(records, message, count = null) {
    const last = record => Math.max(...[record.seen, record.changed, record.created].map(at => (Number.isInteger(at?.message) && at.message < message ? at.message : -1)));
    const offers = (records ?? []).filter(isOffer).map(record => ({ record, at: last(record) })).filter(entry => entry.at >= 0).sort((a, b) => b.at - a.at);
    if (!offers.length) return [];
    if (count) return offers.slice(0, count).map(entry => entry.record);
    return offers.filter(entry => entry.at === offers[0].at).map(entry => entry.record);
}

const sentencesOf = text => String(text ?? '').split(/(?<=[.!?…\]])\s+|\n+/).filter(Boolean);

function namesJob(sentence, record) {
    const words = keyWords(record.key).filter(word => word.length >= 3 && !GENERIC_WORDS.has(word));
    // (0.9.19) A name the story gave the job (an alias) names it too: "the fold wolf contract".
    const names = [record.key, String(record.fields?.giver ?? '').trim(), ...words, ...(record.aliases ?? [])].filter(name => name.length >= 3);
    // A name as written, or with a plural ending: wolf/wolves, bounty/bounties, rat/rats.
    const pattern = name => {
        const body = escapeRegExp(normalizeQuotes(name)).replace(/\s+/g, '\\s+');
        if (/f$/i.test(name)) return `${body.slice(0, -1)}(?:f|ves)`;
        if (/y$/i.test(name)) return `${body.slice(0, -1)}(?:y|ies)`;
        return `${body}(?:s|es)?`;
    };
    return names.some(name => new RegExp(`(?<![\\p{L}\\p{N}])${pattern(name)}(?![\\p{L}\\p{N}])`, 'iu').test(normalizeQuotes(sentence)));
}

/**
 * Whether `said` (the reader's message) makes a choice about `record` with `words`: a sentence
 * with one of them, not negated, naming the job, or any such sentence when `alone` (it is the
 * only job in question).
 */
function saidAbout(said, record, words, { alone = false, among = false } = {}) {
    return sentencesOf(said).some(sentence => {
        const match = words.exec(sentence);
        if (!match || NOT_BEFORE.test(sentence.slice(0, match.index))) return false;
        // (0.9.32) `among`: the job is one of those "all of them" in the same sentence means.
        return alone || namesJob(sentence, record) || (among && ALL_JOBS.test(sentence));
    });
}

const isJob = record => BECOMES_QUEST.has(record.kind)
    && (JOB_FIELDS.some(name => String(record.fields?.[name] ?? '').trim()) || isQuestType(record.fields?.type));

/** (0.9.15) An offer: a job (a giver, a reward or a quest type) the reader has not taken on yet. */
export function isOffer(record) {
    return record?.status === 'active' && isJob(record);
}

/** The offers `text` (the reader's message) takes on, or turns down: [key], in tracker order. */
export function offersChosenIn(tracker, text, choice = 'accept') {
    const offers = (tracker?.records ?? []).filter(isOffer);
    const words = choice === 'refuse' ? REFUSE_WORDS : ACCEPT_WORDS;
    const all = allJobsIn(text);
    const among = new Set(all ? offersInQuestion(offers, Number.POSITIVE_INFINITY, all.count).map(record => record.id) : []);
    return offers.filter(record => saidAbout(text, record, words, { alone: offers.length === 1, among: among.has(record.id) })).map(record => record.key);
}

// A `-` line's reason with its labelled parts ("failed: deadline passed"), as written.
function closingReason(op) {
    const parts = Object.entries(op.extra ?? {}).map(([label, value]) => (String(value ?? '').trim() ? `${label}: ${value}` : label));
    return [String(op.reason ?? '').trim(), ...parts].filter(Boolean).join('; ');
}

/** What a `~` (or a quest's `!`) says when it means the record is over, or null. */
function overByChange(record, op) {
    if (op.op === '!') {
        // (0.9.27) An offer too, when the story says the job is done ("skins turned in"): what
        // happens to an offer that is not the reader's ("the bandits withdrew") is only news.
        if (record.kind !== 'quest' && !isJob(record)) return null;
        const said = [op.reason, ...Object.values(op.fields ?? {}), ...Object.values(op.extra ?? {})].map(value => String(value ?? '')).join(' ');
        return QUEST_OVER_TEXT.test(said) || (record.kind === 'quest' && FAILED.test(said)) ? (op.reason || said).trim() : null;
    }
    for (const label of OVER_LABELS) {
        const value = String(op.extra?.[label] ?? '').trim();
        if (OVER_VALUE.test(value)) return value;
    }
    if (record.kind === 'quest' || isJob(record) || takesOnQuest(record, op)) {
        for (const field of QUEST_OVER_FIELDS) {
            const value = String(op.fields?.[field] ?? '').trim();
            if (OVER_VALUE.test(value) || overStep(value, op)) return value;
        }
    }
    return null;
}
const MIN_PERSON_LENGTH = 3;

// Matching a key that is not tracked to the record it most likely means (v0.8.3): the words
// that tell keys apart, without a leading article or the small words models swap freely.
const LEADING_ARTICLES = new Set(['the', 'a', 'an']);
const CONNECTIVES = new Set(['in', 'at', 'of', 'on', 'to', 'for', 'from', 'the', 'and']);
// One key's words inside the other's counts only when the shorter has this many words.
const MIN_CONTAINED_WORDS = 2;
const MIN_WORD_OVERLAP = 0.75;
// A `~` on a key that is not tracked, with something to say, becomes a record of this kind.
const UNTRACKED_KIND = 'hook';
// (0.9.14) Keys that only label a line, a block or a kind ("! Encounter — the wolves attack",
// "~ Quest — …"): they name no record, so a line under one is skipped quietly instead of being
// a warning, and the next note never asks the model to add them.
const LABEL_KEYS = new Set(['encounter', 'encounters', 'fight', 'combat', 'battle', 'scene', 'director', 'world state', 'note', 'notes', 'summary', 'status', 'update', 'updates', 'change', 'changes', 'event', 'events', 'record', 'records']);
const isLabelKey = id => LABEL_KEYS.has(id) || Boolean(kindOf(id));
// What the next note may say about ignored lines: at most this many, from the latest reply.
const MAX_UNTRACKED_CORRECTIONS = 3;
// (0.9.19) The other names a record was reached by, newest kept: enough for a model's drift.
const MAX_ALIASES = 8;

export function emptyTracker() {
    return { version: 1, records: [], message: -1, time: null };
}

function blankFields() {
    return Object.fromEntries(FIELDS.map(name => [name, '']));
}

function cloneRecord(record) {
    return {
        ...record,
        fields: { ...record.fields },
        extra: { ...record.extra },
        created: { ...record.created },
        changed: { ...record.changed },
        seen: { ...record.seen },
        resolved: record.resolved ? { ...record.resolved } : null,
        legSince: record.legSince ? { ...record.legSince } : null,
        // (0.9.19) A tracker saved before aliases has none.
        aliases: [...(record.aliases ?? [])],
        // History entries are never edited, only appended, so they can be shared.
        history: [...record.history],
    };
}

function finding(kind, severity, op, message, extra = {}) {
    return { kind, severity, key: op.key ?? null, message, ...extra };
}

/** The words a key is matched by: lineKey's, less a leading article and small connectives. */
export function keyWords(key) {
    const words = lineKey(key).split(' ').filter(Boolean);
    while (words.length && LEADING_ARTICLES.has(words[0])) words.shift();
    return words.filter(word => !CONNECTIVES.has(word));
}

function sameWords(left, right) {
    return left.join(' ') === right.join(' ');
}

// One word set inside the other (the shorter of at least two words), or a Jaccard overlap
// of at least 0.75.
function closeWords(left, right) {
    const a = new Set(left);
    const b = new Set(right);
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    const shared = [...small].filter(word => large.has(word)).length;
    if (shared === small.size && small.size >= MIN_CONTAINED_WORDS) return true;
    const union = a.size + b.size - shared;
    return union > 0 && shared / union >= MIN_WORD_OVERLAP;
}

/**
 * The active records a key that is not tracked may mean, as `[{ record, index }]` (index into
 * `records`): those with the same words (case, punctuation, a leading article and small words
 * like in/at/of ignored) or, only when there are none, those whose words contain or are
 * contained in the key's (two words or more) or overlap by 3/4. One entry is a match; more
 * are ambiguous and none is to be guessed.
 */
export function nearMatches(records, key) {
    const words = keyWords(key);
    if (!words.length) return [];
    const active = (records ?? [])
        .map((record, index) => ({ record, index, words: keyWords(record.key) }))
        .filter(entry => entry.record.status === 'active' && entry.words.length);
    for (const close of [sameWords, closeWords]) {
        const found = active.filter(entry => close(words, entry.words));
        if (found.length) return found.map(({ record, index }) => ({ record, index }));
    }
    // (0.9.16) Looser, and only ever one: "Fold Wolf Contract" for Sheepfold Wolves (plurals
    // folded, job words such as contract or bounty set aside, "fold" inside "sheepfold"), then
    // a name every word of which the record's own name, goal or description holds ("Fold Wolf
    // Contract" for Wolf Hunt, "kill ridge wolves threatening the sheep fold").
    const core = coreWords(words);
    if (!core.length) return [];
    // More than one: none is taken, and the warning names them.
    const loose = active.filter(entry => looseWords(core, coreWords(entry.words)));
    if (loose.length) return loose.map(({ record, index }) => ({ record, index }));
    if (core.length < 2) return [];
    const described = active.filter(entry => {
        const own = coreWords(['key', 'goal', 'desc'].flatMap(field => keyWords(field === 'key' ? entry.record.key : entry.record.fields?.[field] ?? '')));
        return core.every(word => own.some(other => sameWord(word, other)));
    });
    return described.length <= 3 ? described.map(({ record, index }) => ({ record, index })) : [];
}

// Words that only say it is a job, not which one.
const JOB_WORDS = new Set(['quest', 'job', 'jobs', 'contract', 'bounty', 'task', 'work', 'mission', 'favour', 'favor', 'side', 'main', 'hook', 'event']);

// A word in its singular (wolves → wolf, bounties → bounty, rats → rat), job words left out.
function coreWords(words) {
    return [...new Set(words
        .map(word => word.replace(/ies$/, 'y').replace(/ves$/, 'f').replace(/(?<=[^s])s$/, ''))
        .filter(word => word.length >= 3 && !JOB_WORDS.has(word)))];
}

// The same word, or one inside the other when both are long enough to mean it ("fold", "sheepfold").
function sameWord(a, b) {
    return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
}

// Every word of the shorter set found in the longer one, with at least two words on each side.
function looseWords(left, right) {
    if (left.length < 2 || right.length < 2) return false;
    const [small, large] = left.length <= right.length ? [left, right] : [right, left];
    return small.every(word => large.some(other => sameWord(word, other)));
}

// Whether an op has anything to write: a field, or a part, with a value.
function hasContent(op) {
    return [...Object.values(op.fields ?? {}), ...Object.values(op.extra ?? {})].some(value => String(value ?? '').trim());
}

// The record a `~` on a key that is not tracked becomes: a hook, unless its `type:` names a
// kind (`type: clock`; a quest category such as `type: bounty` makes a quest of that type).
function untrackedRecordOp(op, id) {
    const word = lineKey(op.fields?.type ?? '');
    const named = kindOf(word);
    const fields = { ...op.fields };
    // The type was the kind; only a quest's own category (bounty, contract…) stays its type.
    if (named && (named !== 'quest' || word === 'quest' || word === 'quests')) delete fields.type;
    // A job by its parts (0.9.4): who it is for or what it pays.
    const job = !named && ['giver', 'reward'].some(name => String(fields[name] ?? '').trim());
    return { ...op, id, kind: named || (job ? 'quest' : UNTRACKED_KIND), fields };
}

// Work {{user}} took on (0.8.6): a hook or event that a `~` names a quest (`type: quest`, or a
// category such as bounty), or that is a job — it has, or the `~` gives it, a giver, a reward or
// a quest category — and the `~` moves it on (a giver, reward, goal, step or difficulty). So
// `~ Wolf pelts — step: tracking the pack` on a hook the planner offered with its reward makes
// the bounty a quest (0.9.4), while a step on a plain thread ("River stranger") does not
// (0.9.2: models write `step:` for any progress). Beats are the world's, never a quest.
const BECOMES_QUEST = new Set(['hook', 'event']);
const JOB_FIELDS = ['giver', 'reward'];
const MOVES_ON = ['giver', 'reward', 'goal', 'step', 'difficulty'];

const isQuestType = value => {
    const type = lineKey(value ?? '');
    return type === 'quest' || Object.hasOwn(QUEST_TYPE_WORDS, type);
};

function takesOnQuest(record, op) {
    if (!BECOMES_QUEST.has(record.kind)) return false;
    const fields = op.fields ?? {};
    if (isQuestType(fields.type)) return true;
    const given = name => String(fields[name] ?? '').trim();
    const job = JOB_FIELDS.some(name => given(name) || String(record.fields?.[name] ?? '').trim()) || isQuestType(record.fields?.type);
    return job && MOVES_ON.some(given);
}

function withArticle(word) {
    return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

// Records whose leg changed in the op being applied; `touch` stamps when the leg was set, so
// an arrival can be checked against the pace from that moment (a copied leg keeps its time).
const legChanged = new WeakSet();

function applyFields(record, op) {
    const legBefore = record.fields.leg;
    for (const [name, value] of Object.entries(op.fields ?? {})) {
        if (FIELDS.includes(name)) record.fields[name] = String(value ?? '');
    }
    for (const [label, value] of Object.entries(op.extra ?? {})) {
        // The arc a planned record belongs to is identity, not a part to show.
        if (label === 'arc') record.arc = String(value ?? '') || null;
        else record.extra[label] = String(value ?? '');
    }
    if (record.fields.leg !== legBefore) legChanged.add(record);
}

// Every applied op counts as the record being seen, and leaves a trace of the line itself.
function touch(record, op, at, contractContext = null) {
    if (legChanged.has(record)) {
        legChanged.delete(record);
        record.legSince = record.fields.leg ? { ...at } : null;
    } else if (!record.fields.leg) {
        record.legSince = null;
    }
    record.changed = { ...at };
    record.seen = { ...at };
    const text = op.raw || formatOp(op);
    // (0.9.30) With its time, so the Journal can date it once the message is behind a checkpoint.
    record.history = [...record.history, { message: at.message, op: op.op, text, time: at.time ?? null }].slice(-HISTORY_LIMIT);
    if (record.kind === 'hook' && !record.offeredAt && contractContext?.place) record.offeredAt = contractContext.place;
    if (record.kind === 'quest' && !record.contract) {
        const contract = acceptedContract(record, contractContext);
        if (contract) record.contract = contract;
    }
}

function newRecord(op, at, contractContext = null) {
    const record = {
        key: op.key,
        id: op.id || lineKey(op.key),
        // parseChanges always infers a kind for `+`; this covers hand-built ops.
        kind: op.kind || 'event',
        status: 'active',
        fields: blankFields(),
        extra: {},
        created: { ...at },
        changed: { ...at },
        seen: { ...at },
        resolved: null,
        legSince: null,
        pinned: false,
        arc: null,
        aliases: [],
        history: [],
    };
    applyFields(record, op);
    touch(record, op, at, contractContext);
    return record;
}

// (0.9.19) The names records were once reached by (their aliases), each to its record's
// index: a name that is a record's own id is that record's, and a name two records hold
// belongs to the first in tracker order, so a replay always reads it the same way.
function aliasIndexOf(records, indexById) {
    const index = new Map();
    records.forEach((record, at) => {
        for (const alias of record.aliases ?? []) {
            if (!indexById.has(alias) && !index.has(alias)) index.set(alias, at);
        }
    });
    return index;
}

/**
 * Applies ops for one reply. A `~`, `-` or `!` on a key that is not tracked goes to the one
 * active record it plainly means (nearMatches); failing that, a `~` that carries something
 * becomes a new hook, and anything else is reported and ignored. (0.9.19) A key read so is
 * remembered on the record (an alias), and a later line with it, `+` included, is that record's
 * as its own key would be, with no further finding.
 * Returns `{ tracker, problems }`; `tracker.message`/`time` move to this reply.
 */
// `direct` (Story Director v2): the story's `+ quest` is the reader's acceptance, so a job is never
// held as an offer; a hook or event becomes a quest only by `+ quest` (or a `-` that says it was taken
// on), never by a `~` that gives it a giver or a reward, and closing a hook never makes it a quest.
export function applyOps(tracker, ops, { message, time = null, said, chosen = [], taken = [], contractContext = null, settlements = [], direct = false } = {}) {
    const records = [...tracker.records];
    // (0.9.15) With the reader's message given (null: there was none), their choices are theirs.
    const gated = said !== undefined;
    const quests = (ops ?? []).filter(op => op.op === '+' && op.kind === 'quest');
    const alone = op => quests.length === 1 && (!op || quests.includes(op));
    // (0.9.32) "Took down all three contracts": the offers shown last, or that many of them.
    const all = gated ? allJobsIn(said) : null;
    const inQuestion = new Set(all ? offersInQuestion(records, message, all.count).map(record => record.id) : []);
    const among = record => {
        if (!all) return false;
        const tracked = records.find(other => other.id === record.id || lineKey(other.key) === lineKey(record.key));
        return tracked ? inQuestion.has(tracked.id) : true;
    };
    // (0.9.33) `taken`: offers the reader took on with the Take on button (ids stamped on the reply).
    const tookOn = new Set((taken ?? []).map(key => lineKey(key)));
    const accepts = (record, op = null) => direct || !gated
        || tookOn.has(record.id) || tookOn.has(lineKey(record.key))
        || lineKey(op?.fields?.type ?? record.fields?.type ?? '') === 'main'
        || saidAbout(said, record, ACCEPT_WORDS, { alone: alone(op), among: among(record) })
        || (alone(op) && saidAbout(said, record, AGREE_WORDS, { alone: true }));
    // (0.9.27) Whether the reader has spoken of a job: in this reply's message, or before.
    const spokenOf = record => !gated || Boolean(record.engaged) || sentencesOf(said).some(sentence => namesJob(sentence, record));
    // `chosen`: records the reader gave up with the Abandon flag (ids stamped on the reply).
    const picked = new Set((chosen ?? []).map(key => lineKey(key)));
    const chose = record => picked.has(record.id) || picked.has(lineKey(record.key))
        || saidAbout(said, record, GIVE_UP, { alone: false, among: among(record) }) || saidAbout(said, record, REFUSE_WORDS, { alone: false, among: among(record) });
    const offered = (op, record) => problems.push(finding('offered', 'info', op, `"${record.key}" was offered, not taken on: it stays an offer until {{user}} accepts it.`));
    // (0.9.27) An offer the story closes as done ("! Barrow-Viper Clearing — skins turned in to
    // Verna") was done by {{user}}, who went and did it without the words to take it on: when
    // they have spoken of it, it closes as their quest finished. Failed, given up or lapsed, it
    // stays the offer it was.
    const doneOffer = (record, reason, op) => {
        if (direct || !isOffer(record) || !QUEST_OVER_TEXT.test(reason) && !LOOKS_OVER.test(reason)) return;
        if (FAILED.test(reason) || CHOSEN_END.test(reason) || !spokenOf(record)) return;
        record.kind = 'quest';
        problems.push(finding('done-offer', 'info', op, `"${record.key}" was offered and the story says it is done: it is a quest {{user}} finished.`));
    };
    const indexById = new Map(records.map((record, index) => [record.id, index]));
    let aliasIndex = aliasIndexOf(records, indexById);
    // A record by its id, else by a name it was reached by before.
    const lookup = id => indexById.get(id) ?? aliasIndex.get(id);
    const copied = new Set();
    const problems = [];
    const at = { message, time };
    // (0.9.20) Records this reply names with `+ quest`: a `-` on one of them in the same reply
    // closes the hook it was, not the job just taken on.
    const questNow = new Set();

    // Copy a record the first time this call changes it, so the input stays untouched.
    const edit = index => {
        if (!copied.has(index)) {
            records[index] = cloneRecord(records[index]);
            copied.add(index);
        }
        return records[index];
    };
    // (0.9.19) Remember a made-up name a line reached a record by, so the next line with it is
    // that record at once, not matched (and noted) again. The newest names are kept.
    const remember = (index, id) => {
        if (lookup(id) !== undefined) return;
        const record = edit(index);
        const aliases = [...(record.aliases ?? []), id];
        record.aliases = aliases.slice(-MAX_ALIASES);
        if (aliases.length > MAX_ALIASES) aliasIndex = aliasIndexOf(records, indexById);
        else aliasIndex.set(id, index);
    };

    // (0.9.27) An offer the reader's message names is one they have spoken of: it is given the
    // story's grace before it lapses (lapses.js), and done by the story it is their quest.
    if (gated && said) {
        records.forEach((record, index) => {
            if (!record.engaged && isOffer(record) && sentencesOf(said).some(sentence => namesJob(sentence, record))) edit(index).engaged = { ...at };
        });
    }

    for (const line of ops ?? []) {
        // (0.9.28) "- Key — failed: deadline passed" reads its label as a part, leaving no reason:
        // the closing's words are the reason, so a failure is never read as done.
        const op = line.op === '-' ? { ...line, reason: closingReason(line) } : line;
        const id = op.id || lineKey(op.key);
        if (!id) continue;
        const index = lookup(id);

        if (op.op === '+') {
            // One arc at a time: a new arc closes the one before it.
            if ((op.kind === 'arc') && (index === undefined || records[index].status !== 'active')) {
                records.forEach((other, otherIndex) => {
                    if (other.kind !== 'arc' || other.status !== 'active' || otherIndex === index) return;
                    const closed = edit(otherIndex);
                    closed.status = 'superseded';
                    closed.resolved = { ...at, reason: 'a new arc began' };
                    touch(closed, { ...op, op: '-', raw: `- ${closed.key} — a new arc began` }, at);
                });
            }
            if (index === undefined) {
                let added = { ...op, id };
                if (op.kind === 'quest' && !accepts({ key: op.key, fields: op.fields ?? {} }, op)) {
                    added = { ...added, kind: 'hook' };
                    offered(op, added);
                }
                if (op.kind === 'quest') questNow.add(records.length);
                indexById.set(id, records.length);
                copied.add(records.length);
                records.push(newRecord(added, at, contractContext));
                continue;
            }
            if (op.kind === 'quest') questNow.add(index);
            const record = edit(index);
            if (record.status === 'active') {
                // (0.9.9) "+ quest Key" on a hook or event already tracked (one the planner
                // offered) is the job taken on: it becomes the quest, as a ~ with its parts does.
                if (op.kind === 'quest' && BECOMES_QUEST.has(record.kind) && !accepts(record, op)) {
                    offered(op, record);
                } else if (op.kind === 'quest' && BECOMES_QUEST.has(record.kind)) {
                    problems.push(finding('became-quest', 'info', op, `"${record.key}" was ${withArticle(record.kind)}; it is a quest now.`));
                    record.kind = 'quest';
                } else {
                    const as = record.id === id ? '' : ` as "${record.key}"`;
                    problems.push(finding('duplicate-add', 'info', op,
                        `"${op.key}" is already tracked${as}; the + was applied as a change.`));
                }
                applyFields(record, op);
            } else {
                problems.push(finding('reopened', 'info', op,
                    `"${op.key}" was ${record.status}; it is active again.`));
                // A reopened record is described afresh, so stale dates from before it was
                // closed cannot make it due at once. Identity, history and pin are kept.
                record.kind = op.kind === 'quest' && !accepts({ key: record.key, fields: op.fields ?? {} }, op) ? 'hook' : op.kind || record.kind;
                record.status = 'active';
                record.resolved = null;
                record.fields = blankFields();
                record.extra = {};
                applyFields(record, op);
            }
            touch(record, op, at, contractContext);
            continue;
        }

        let target = index;
        // (0.9.20) "- hook Lone Grey Wolf": a kind word in front of a tracked key names the form
        // the line is about ("the hook"), it is not part of the key.
        if (target === undefined) {
            const kinded = String(op.key ?? '').match(/^([A-Za-z]+)\s+(\S.*)$/s);
            if (kinded && kindOf(kinded[1])) target = lookup(lineKey(kinded[2]));
        }
        if (target === undefined && isLabelKey(id)) {
            problems.push(finding('label-key', 'info', op, `"${op.key}" is a label, not a record; the ${op.op} line was skipped.`));
            continue;
        }
        if (target === undefined) {
            // A key that is not tracked: the one record it plainly means, else (for a `~` with
            // something to say) a new record, else the line is ignored and the next note says so.
            const near = nearMatches(records, op.key);
            if (near.length === 1) {
                target = near[0].index;
                problems.push(finding('near-key', 'info', op, `"${op.key}" read as "${near[0].record.key}".`));
                remember(target, id);
            } else if (op.op === '~' && !near.length && hasContent(op) && overByChange({ kind: 'quest', fields: {} }, op) !== null) {
                // (0.9.27) "~ North Levee Vipers — step: completed" on nothing tracked: there is
                // nothing left to track, so no record is made for it.
                problems.push(finding('unknown-key', 'info', op, `"${op.key}" is not tracked and reads as over; the ~ line was ignored.`, { op: op.op }));
                continue;
            } else if (op.op === '~' && !near.length && hasContent(op)) {
                const added = untrackedRecordOp(op, id);
                indexById.set(id, records.length);
                copied.add(records.length);
                records.push(newRecord(added, at, contractContext));
                problems.push(finding('untracked-added', 'info', op,
                    `"${op.key}" was not tracked; added as ${withArticle(added.kind)} (write "+ kind Key" to set its kind).`));
                continue;
            } else {
                // A `-` of something never tracked does no harm, so it is only worth a note.
                const severity = op.op === '-' ? 'info' : 'warn';
                const candidates = near.map(entry => entry.record.key);
                const could = candidates.length ? ` (it could be ${candidates.map(key => `"${key}"`).join(' or ')})` : '';
                problems.push(finding('unknown-key', severity, op,
                    `"${op.key}" is not tracked${could}; the ${op.op} line was ignored.`,
                    { op: op.op, ...(candidates.length ? { candidates } : {}) }));
                continue;
            }
        }

        const record = edit(target);
        // (0.9.13) A job taken on is not over: the `-` turns a hook or event into the quest, and
        // on a quest (most often the `+ quest` just above it) it changes nothing.
        if (op.op === '-' && record.status === 'active' && takenOn(String(op.reason ?? ''))) {
            if (BECOMES_QUEST.has(record.kind) && !accepts(record)) {
                offered(op, record);
            } else if (BECOMES_QUEST.has(record.kind)) {
                problems.push(finding('became-quest', 'info', op, `"${record.key}" was ${withArticle(record.kind)}; it is a quest now.`));
                record.kind = 'quest';
                touch(record, op, at, contractContext);
            } else {
                problems.push(finding('taken-on', 'info', op, `"${record.key}" was taken on, not ended; it stays open.`));
            }
            continue;
        }
        // (0.9.20) "+ quest Key" then "- hook Key — <what the hook was>": the hook made way for the
        // quest, so the quest stays open. Only a reason that says the job is over or failed ends it.
        if (op.op === '-' && record.status === 'active' && questNow.has(target) && !endsJob(String(op.reason ?? ''))) {
            problems.push(finding('taken-on', 'info', op, `"${record.key}" was taken on, not ended; it stays open.`));
            continue;
        }
        // (0.9.1) A change that says the record is over closes it, as its `-` would have.
        // (0.9.7) Closing what is already closed changes nothing: the record keeps the reply that
        // first closed it, so a model repeating "- Quest — done" later never finishes it twice
        // (RPG Battle's quest XP follows the reply a quest was closed in).
        const closing = op.op === '-' || ((op.op === '~' || op.op === '!') && overByChange(record, op) !== null);
        if (closing && record.status !== 'active') {
            problems.push(finding('already-closed', 'info', op, `"${record.key}" is already ${record.status}; the line changed nothing.`));
            continue;
        }
        const over = (op.op === '~' || op.op === '!') ? overByChange(record, op) : null;
        // (0.9.15) Giving a job up or turning it down is the reader's choice, not the model's.
        const ending = op.op === '-' ? String(op.reason ?? '') : over;
        const managed = record.contract || requirementOf(record.fields, record.extra).managed;
        const receipt = settlements.find(entry => entry.quest && entry.quest === record.contract?.id
            && JSON.stringify(entry.contract) === JSON.stringify(record.contract));
        if (closing && managed && !FAILED.test(ending ?? '') && !SUPERSEDED.test(ending ?? '')) {
            if (!receipt || record.settlement) {
                problems.push(finding('unverified-completion', 'warn', op, `"${record.key}" needs a verified Complete turn-in; narrative success was ignored.`));
                continue;
            }
            record.settlement = structuredClone(receipt);
        }
        if (gated && closing && ending !== null && CHOSEN_END.test(ending) && (record.kind === 'quest' || isJob(record)) && !chose(record)) {
            problems.push(finding('not-chosen', 'info', op, `"${record.key}" stays open: giving it up or turning it down is {{user}}'s choice, and their message did not make it.`));
            continue;
        }
        // (0.9.28) The work done and the pay waiting, a quest is not failed for the hour passing.
        if (closing && ending !== null && record.kind === 'quest' && FAILED.test(ending) && TIME_FAIL.test(ending) && waitsForPay(record)) {
            problems.push(finding('pay-waiting', 'info', op, `"${record.key}" stays open: its work is done and only the pay is left, which a passed time does not take away.`));
            continue;
        }
        if (over !== null) {
            const { status: _s, state: _st, outcome: _o, result: _r, progress: _p, ...extra } = op.extra ?? {};
            const fields = Object.fromEntries(Object.entries(op.fields ?? {}).filter(([name, value]) => !(QUEST_OVER_FIELDS.includes(name) && (OVER_VALUE.test(String(value ?? '').trim()) || overStep(String(value ?? '').trim(), op)))));
            applyFields(record, { ...op, fields, extra });
            doneOffer(record, over, op);
            record.status = 'resolved';
            record.resolved = { ...at, reason: over };
            problems.push(finding('closed-by-change', 'info', op, `"${record.key}" read as finished ("${over}"); "- ${record.key} — ${over}" says it directly.`));
            touch(record, op, at, contractContext);
            continue;
        }
        if (op.op === '~') {
            let change = op;
            const moving = ['step', 'now'].some(name => String(op.fields?.[name] ?? '').trim() && !NOT_STARTED.test(String(op.fields[name])));
            // (0.9.33) An offer taken on with the button: any ~ on it in that reply makes it the quest.
            const button = BECOMES_QUEST.has(record.kind) && (tookOn.has(record.id) || tookOn.has(lineKey(record.key)));
            if (direct) {
                // A hook stays a hook until the story writes `+ quest` for it.
            } else if (takesOnQuest(record, op) && gated && !moving && !accepts(record)) {
                offered(op, record);
            } else if (takesOnQuest(record, op) || button) {
                problems.push(finding('became-quest', 'info', op, `"${record.key}" was ${withArticle(record.kind)}; it is a quest now.`));
                record.kind = 'quest';
                // `type: quest` only said what it is; a category (bounty, contract…) stays its type.
                const type = lineKey(op.fields?.type ?? '');
                const { type: _type, ...rest } = op.fields ?? {};
                if (type === 'quest') change = { ...op, fields: rest };
                else if (Object.hasOwn(QUEST_TYPE_WORDS, type)) change = { ...op, fields: { ...op.fields, type: QUEST_TYPE_WORDS[type] } };
            }
            applyFields(record, change);
        } else if (op.op === '-') {
            applyFields(record, op);
            if (!SUPERSEDED.test(op.reason ?? '')) doneOffer(record, String(op.reason ?? ''), op);
            record.status = SUPERSEDED.test(op.reason ?? '') ? 'superseded' : 'resolved';
            record.resolved = { ...at, reason: op.reason ?? '' };
        } else if (op.op === '!') {
            const given = Object.keys(op.fields ?? {}).length > 0;
            applyFields(record, op);
            if (!given) {
                // What was next has happened. With no `then`, `now` is still the best we know.
                if (record.fields.then) record.fields.now = record.fields.then;
                record.fields.then = '';
                record.fields.on = '';
            }
            if (record.kind === 'clock') {
                record.status = 'resolved';
                record.resolved = { ...at, reason: 'fired' };
            }
        } else {
            continue;
        }
        touch(record, op, at, contractContext);
    }

    return {
        tracker: { ...tracker, records, message: message ?? tracker.message, time: time ?? tracker.time },
        problems,
    };
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeQuotes(text) {
    return text.replace(/[’‘]/g, '\'');
}

function namesOf(record) {
    const people = String(record.fields?.people ?? '')
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length >= MIN_PERSON_LENGTH);
    return [record.key, ...people].filter(Boolean);
}

// Whole words only ("Ren" is not in "Renata"), any run of whitespace between words.
function mentionPattern(name) {
    const body = normalizeQuotes(name).trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'iu');
}

/** Records whose key or a `people` name appears in `text` get `seen = { message, time }`. */
export function markSeen(tracker, text, { message, time = null } = {}) {
    const haystack = normalizeQuotes(String(text ?? ''));
    if (!haystack.trim()) return { ...tracker, records: [...tracker.records] };
    const records = tracker.records.map(record => {
        const mentioned = namesOf(record).some(name => mentionPattern(name).test(haystack));
        return mentioned ? { ...record, seen: { message, time } } : record;
    });
    return { ...tracker, records };
}

/**
 * Rebuilds the tracker from chat entries `[{ message, ops, text, time }]` in chat order.
 * Each problem carries the message index it came from in `message`; its description moves
 * to `text` (a Finding's own `message`).
 */
export function replay(entries, { seed = null } = {}) {
    let tracker = seed ?? emptyTracker();
    const problems = [];
    for (const entry of entries ?? []) {
        // A reply without a readable time keeps the last known one rather than forgetting it.
        const time = entry.time ?? tracker.time;
        const at = { message: entry.message, time };
        if (entry.text) tracker = markSeen(tracker, entry.text, at);
        // (0.9.27) A reply with no change lines still reads the reader's message (offers spoken of).
        if (entry.ops?.length || (typeof entry.said === 'string' && entry.said)) {
            const result = applyOps(tracker, entry.ops, {
                ...at, ...(entry.said === undefined ? {} : { said: entry.said }),
                chosen: entry.chosen ?? [], taken: entry.taken ?? [],
                contractContext: entry.contractContext ?? null, settlements: entry.settlements ?? [],
            });
            tracker = result.tracker;
            for (const problem of result.problems) {
                problems.push({ ...problem, text: problem.message, message: entry.message });
            }
        }
        tracker = { ...tracker, message: entry.message, time };
    }
    return { tracker, problems };
}

/**
 * Lines for the next note's `Corrections:` from the problems of the latest reply only: each
 * `~` or `!` line that changed nothing because its key is not tracked, once per key, at most
 * `limit`. With `message`, only replay problems from that message count, so an older reply's
 * lines are never corrected again. A `-` of something never tracked needs no correction.
 */
export function untrackedCorrections(problems, { message, limit = MAX_UNTRACKED_CORRECTIONS } = {}) {
    const seen = new Set();
    const lines = [];
    for (const problem of problems ?? []) {
        if (lines.length >= limit) break;
        if (problem?.kind !== 'unknown-key' || (problem.op !== '~' && problem.op !== '!')) continue;
        if (message !== undefined && problem.message !== message) continue;
        const key = String(problem.key ?? '').trim();
        const id = lineKey(key);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const candidates = (problem.candidates ?? []).slice(0, 2);
        lines.push(candidates.length
            ? `"${key}" is not tracked: use its exact key (${candidates.map(other => `"${other}"`).join(' or ')}) or add it with "+ kind ${key} — …".`
            : `"${key}" is not tracked: add it with "+ kind ${key} — …" before changing it.`);
    }
    return lines;
}

// (0.9.19) A closed quest's own reason, read for the Journal: given up is the reader's choice,
// failed is the story's, anything else is done.
const ABANDONED = /\b(?:abandon|gave up|give up|given up|giving up|forfeit|quit\b|walked away|backed out|withdr[eao]w)/i;

/** How a closed quest ended: 'done' | 'failed' | 'abandoned', or null (open, or merged into another). */
export function questOutcome(record) {
    if (record?.kind !== 'quest' || record.status !== 'resolved') return null;
    const reason = String(record.resolved?.reason ?? '');
    if (ABANDONED.test(reason)) return 'abandoned';
    return FAILED.test(reason) ? 'failed' : 'done';
}

/**
 * The record with this key or id (markdown and punctuation ignored), or null. (0.9.19) Failing
 * that, the record a line once reached by this name (an alias), as applyOps reads it.
 */
export function findRecord(tracker, keyOrId) {
    const id = lineKey(keyOrId);
    if (!id) return null;
    const records = tracker?.records ?? [];
    return records.find(record => record.id === id)
        ?? records.find(record => (record.aliases ?? []).includes(id))
        ?? null;
}

export function activeRecords(tracker, { kind = null } = {}) {
    return tracker.records.filter(record => record.status === 'active' && (!kind || record.kind === kind));
}

/**
 * The quests finished in the reply at `message`: closed there with a `-` line that is not a
 * failure (failed, abandoned, expired…) or a supersession, as `[{ id, name, type, difficulty,
 * reward, giver }]` plain copies; quests finished earlier are not listed.
 */
export function questsDoneIn(tracker, message) {
    const at = Number(message);
    if (!Number.isInteger(at)) return [];
    const text = value => String(value ?? '').trim();
    return (tracker?.records ?? [])
        .filter(record => record.kind === 'quest' && record.status === 'resolved'
            && record.resolved?.message === at && !FAILED.test(record.resolved?.reason ?? ''))
        .map(record => ({
            id: record.id,
            name: record.key,
            type: text(record.fields?.type),
            difficulty: questDifficulty(record.fields?.difficulty),
            reward: text(record.fields?.reward),
            giver: text(record.fields?.giver),
        }));
}
