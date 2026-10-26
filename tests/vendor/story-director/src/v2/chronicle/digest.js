// Story Director v2, chronicle part: writing the day digests (feature `story-director.digest`), the
// hook that asks for it, and the one tail line after a time skip. Pure apart from the ctx.
//
// Before each reply (`beforeGenerate`), two system commands, both receipts on the head reply:
// * `chronicle.note`, when anything was committed since the last note (meta.rev moved on): reads those
//   receipts while they are fresh (`chronicle.noteFacts`; Story Block trims old receipts' data) and
//   keeps their facts by day under `chronicle.dayFacts["<day>.<rev>"]` (days.js). The entries go with
//   the reply they are a receipt of: a swipe or a delete of it takes exactly its facts away.
// * `chronicle.digest`, when the clock's day has moved past `chronicle.written` (or a day written then
//   is gone, because the reply that wrote it was deleted): writes a digest for each finished day since
//   the last write (and each one gone missing) from that day's entries, applies the caps and records
//   where it got to. A whole day's entries stay (up to FOLLOW_MAX): its digest follows them when one of
//   its replies is deleted later (days.daysOf); a short day's go. A chat from before the entries (no `noted`) has its
//   older days read from the receipts as before. Replay applies the receipts' ops; it never runs these.

import { DIGEST, DIGEST_FEATURE, FOLD_AT, FOLLOW_MAX, QUEST_LOG_KEPT, QUEST_LOG_TEXT, cut, capDays, dayOf, daysOf, digestSettings, entriesByDay, factsOf, foldEntries, makeDigest, notedOf, orderedDays, rangeDays, writtenOf } from './days.js';
import { calendarFrom } from './queries.js';
import { toSlot } from '../slot.js';

const isInt = value => Number.isSafeInteger(value);

/** Whether the digest feature is on: `ctx.feature` / `view.feature` when the host has them (F100), else on. */
export function digestOn(source) {
    if (typeof source?.feature !== 'function') return true;
    try {
        return source.feature(DIGEST_FEATURE) !== false;
    } catch {
        return true;
    }
}

function ask(query, name, args) {
    if (typeof query !== 'function') return null;
    try {
        return query(name, args) ?? null;
    } catch {
        return null;
    }
}

const minutesFrom = query => {
    const minutes = ask(query, 'director.time', {})?.minutes;
    return isInt(minutes) ? minutes : null;
};

/** The days to write now: those since `written.through` up to yesterday, and those it had that are gone. */
export function daysToWrite(chronicle, today) {
    const written = writtenOf(chronicle);
    const kept = daysOf(chronicle);
    const missing = (written?.days ?? []).filter(day => isInt(day) && day < today && !Object.hasOwn(kept, String(day)));
    return { from: written ? written.through : null, missing };
}

/**
 * Whether the hook should commit `chronicle.digest` on `state` at story day `today`: the day moved
 * since digests were last written, or a day written then is gone. With nothing written yet, when the
 * clock has moved into a later day since the time part last settled it (`settledDay`), or the notes
 * began on an earlier day (`chronicle.noted.from`) or kept facts of one: the digest was off while a
 * day ended, and is back on (B-c2-3).
 */
export function needsDigest(chronicle, today, { settledDay = null } = {}) {
    if (!chronicle || !isInt(today)) return false;
    const written = writtenOf(chronicle);
    if (!written) {
        const begun = notedOf(chronicle)?.from;
        const earlier = [...entriesByDay(chronicle).keys()].some(day => day < today);
        return (isInt(settledDay) && settledDay < today) || (isInt(begun) && begun < today) || earlier;
    }
    if (written.through !== today) return true;
    return daysToWrite(chronicle, today).missing.length > 0;
}

export const NOTE = 'chronicle.note';

/**
 * `chronicle.note {}` (cause `system`, from the hook): keeps what the receipts committed since the last
 * note hold: by day, as entries of their own (`chronicle.dayFacts["<day>.<rev>"]`, `rev` this receipt's;
 * only while the digest feature is on), and the quest history (`chronicle.questLog`, always), and
 * records where it got to (`chronicle.noted`). A day already holding FOLD_AT entries has them folded
 * into this note's one (theirs removed). Refused from a click.
 */
export function noteCommand(ctx) {
    if (ctx?.cause === 'ui') return ctx.fail('REFUSED', 'Day facts are kept by Story Director itself.');
    const query = typeof ctx.query === 'function' ? (name, args) => ctx.query(name, args) : null;
    const chronicle = ctx.draft('chronicle');
    const isMap = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    if (!isMap(chronicle.dayFacts)) chronicle.dayFacts = {};
    if (!isMap(chronicle.questLog)) chronicle.questLog = {};
    const before = notedOf(chronicle);
    const now = minutesFrom(query);
    const on = digestOn(ctx);
    // Where the day facts stopped while the digest was off (`gap`): back on, the note reads from there.
    // The quest history read again from there adds what it holds already (the same keys and texts).
    const gap = isMap(before?.gap) ? before.gap : null;
    const after = on && gap ? { after: gap.rev, minutes: gap.minutes } : { after: before ? before.rev : null, minutes: before ? before.minutes : null };
    const plan = ask(query, 'chronicle.noteFacts', after) ?? { entries: [], settle: null };
    const rev = isInt(ctx.rev) ? ctx.rev : 0;
    // The quest history: each receipt that touched a quest or thread, by its revision; the newest few
    // per thread stay (older ones removed by key).
    const touched = new Set();
    for (const item of plan.quests ?? []) {
        if (!isInt(item?.rev) || typeof item.thread !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(item.thread)) continue;
        const said = cut(String(item.text ?? '').replace(/^Director: /, ''), QUEST_LOG_TEXT);
        if (!said) continue;
        chronicle.questLog[String(item.rev)] = { thread: item.thread, text: said };
        touched.add(item.thread);
    }
    for (const thread of touched) {
        const keys = Object.keys(chronicle.questLog).filter(key => chronicle.questLog[key]?.thread === thread).sort((a, b) => Number(a) - Number(b));
        for (const key of keys.slice(0, Math.max(0, keys.length - QUEST_LOG_KEPT))) delete chronicle.questLog[key];
    }
    const byDay = entriesByDay(chronicle);
    const kept = [];
    // The day facts only while the digest is on.
    for (const { day, entry } of on ? plan.entries ?? [] : []) {
        if (!isInt(day) || !entry || entry.count <= 0) continue;
        const earlier = byDay.get(day) ?? [];
        let own = entry;
        // A very long day: its entries become this one (each removed by its key).
        if (earlier.length >= FOLD_AT) {
            own = foldEntries([...earlier.map(item => item.entry), entry], day);
            for (const item of earlier) delete chronicle.dayFacts[item.key];
        }
        chronicle.dayFacts[`${day}.${rev}`] = own;
        kept.push(day);
    }
    const firstDay = isInt(now) ? dayOf(now) : null;
    chronicle.noted = toSlot({
        rev,
        minutes: isInt(now) ? now : before?.minutes ?? null,
        // The first day a note saw the clock on (a note before the clock was set leaves it to a later one).
        from: before && isInt(before.from) ? before.from : firstDay,
        settle: plan.settle ?? before?.settle ?? null,
        ...(on ? {} : { gap: gap ?? { rev: before ? before.rev : null, minutes: before ? before.minutes : null } }),
    });
    return { summary: '', narrate: false, data: { days: kept } };
}

/** The hook's note: `[{ type: chronicle.note }]` when something was committed since the last note. */
export function noteCommands(view) {
    const chronicle = view?.state?.domains?.chronicle;
    if (!chronicle) return [];
    const rev = view.state.meta?.rev;
    const noted = notedOf(chronicle);
    if (!isInt(rev) || (noted && noted.rev >= rev)) return [];
    return [{ type: NOTE, payload: {} }];
}

/**
 * `chronicle.digest { at? }` (cause `system`, from the hook): writes the digests of the finished days
 * (see above) and records where it got to. `at`: the chat's length when the hook ran. Refused from a
 * click and while the story time is not set.
 */
export function digestCommand(ctx, payload = {}) {
    if (ctx?.cause === 'ui') return ctx.fail('REFUSED', 'Day digests are written by Story Director itself when a story day ends.');
    if (!digestOn(ctx)) return ctx.fail('REFUSED', 'The day digest is turned off.');
    const at = payload?.at ?? null;
    if (!(at === null || (isInt(at) && at >= 0))) return ctx.fail('INVALID', 'chronicle.digest: "at" must be the chat\'s length (a whole number).');
    const query = typeof ctx.query === 'function' ? (name, args) => ctx.query(name, args) : null;
    const now = minutesFrom(query);
    if (now === null) return ctx.fail('REFUSED', 'The story time is not set yet, so no day has ended.');
    const today = dayOf(now);
    const settings = digestSettings(ctx.settings);
    const chronicle = ctx.draft('chronicle');
    if (!chronicle.days || typeof chronicle.days !== 'object' || Array.isArray(chronicle.days)) chronicle.days = {};
    const before = writtenOf(chronicle);
    const { from, missing } = daysToWrite(chronicle, today);
    const wanted = day => day < today && ((from === null || day >= from) || missing.includes(day));
    const noted = notedOf(chronicle);
    const byDay = entriesByDay(chronicle);
    const dayOfRev = rangeDays(byDay);
    // Each finished day from its kept entries. A day from before the entries began (a chat older than
    // them: no `noted`, or a day before the first note) is read from the receipts, as before.
    let director = null;
    try { director = typeof ctx.read === 'function' ? ctx.read('director') : null; } catch { director = null; }
    const state = { domains: { director } };
    const plan = [];
    for (const [day, list] of byDay) {
        if (wanted(day)) plan.push({ day, facts: factsOf(list.map(item => item.entry), { state, day, dayOfRev }), src: list.map(item => item.rev) });
    }
    const older = day => !noted || (isInt(noted.from) && day < noted.from);
    if (!noted || (isInt(noted.from) && (from === null || from < noted.from || missing.some(older)))) {
        const walked = ask(query, 'chronicle.dayFacts', { before: today }) ?? { days: [] };
        for (const entry of walked.days ?? []) {
            if (isInt(entry?.day) && wanted(entry.day) && older(entry.day) && !byDay.has(entry.day)) plan.push(entry);
        }
    }
    plan.sort((a, b) => a.day - b.day);
    const calendar = calendarFrom(query);
    const currency = ask(query, 'inventory.currency', {});
    const rev = isInt(ctx.rev) ? ctx.rev : 0;
    const written = [];
    const found = new Set();
    for (const entry of plan) {
        if (!entry.facts || entry.facts.count <= 0) continue;
        found.add(entry.day);
        let date = '';
        try { date = calendar.format(entry.day * 1440, { time: false }); } catch { date = ''; }
        chronicle.days[String(entry.day)] = toSlot(makeDigest(entry.day, entry.facts, { date, currency, made: rev, revs: entry.revs ?? entry.facts.revs ?? [], src: entry.src ?? null }));
        written.push(date || `day ${entry.day}`);
    }
    // A day to write that no receipt is left for (the only reply of that day was deleted): it goes. So
    // does a day that has not ended any more: the clock went back to it or before it (the reply that
    // moved the clock past it was deleted, which takes its move back). Its facts stay, and it is
    // written again when the clock passes it.
    for (const key of Object.keys(chronicle.days)) {
        const day = Number(key);
        if ((wanted(day) && !found.has(day)) || day >= today) delete chronicle.days[key];
    }
    const live = { state, currency };
    for (const [key, change] of Object.entries(capDays(daysOf(chronicle, live), settings))) {
        if (change === null) delete chronicle.days[key];
        else chronicle.days[key] = toSlot(change);
    }
    keepFollowed(chronicle, byDay, today, live);
    // A time skip: this run follows the day turning (not a rewrite after a delete), and the clock's last
    // jump, as the time part settled it just now, was at least the While away threshold.
    const turned = !before || today > before.through;
    const settle = noted?.settle ?? null;
    const skip = Boolean(turned && settle && settle.to === now && isInt(settle.from) && now - settle.from >= settings.skipMinutes);
    chronicle.written = toSlot({ through: today, days: orderedDays(chronicle).map(digest => digest.day), at, skip });
    return {
        summary: written.length ? `Day digest written: ${written.join(', ')}.` : '',
        narrate: false,
        data: { days: [...found].sort((a, b) => a - b), through: today, skip },
    };
}

/**
 * The entries of the finished days after a digest: a whole digest made from its day's entries keeps
 * those it was made from (its `src`), newest days first while FOLLOW_MAX holds, so it follows them
 * (days.daysOf); every other entry of a finished day goes by key (a short day, a day read from the
 * receipts, one the clock went back to after it was written). A whole digest past FOLLOW_MAX stays
 * as the facts stand now, its `src` cleared (written whole, like a short one).
 */
function keepFollowed(chronicle, byDay, today, live) {
    if (!chronicle.dayFacts || typeof chronicle.dayFacts !== 'object') return;
    const keep = new Set();
    let held = 0;
    const followed = daysOf(chronicle, live);
    for (const digest of Object.values(followed).sort((a, b) => b.day - a.day)) {
        if (digest.brief || !Array.isArray(digest.src) || !(digest.day < today)) continue;
        const src = new Set(digest.src);
        const list = (byDay.get(digest.day) ?? []).filter(item => src.has(item.rev));
        if (held + list.length <= FOLLOW_MAX) {
            held += list.length;
            for (const item of list) keep.add(item.key);
            continue;
        }
        const { src: _src, ...frozen } = digest;
        chronicle.days[String(digest.day)] = toSlot(frozen);
    }
    for (const [day, list] of byDay) if (day < today) for (const item of list) if (!keep.has(item.key)) delete chronicle.dayFacts[item.key];
}

/** The hook's part: `[{ type: chronicle.digest, payload: { at } }]` when digests are due, else []. */
export function digestCommands(view) {
    const chronicle = view?.state?.domains?.chronicle;
    if (!chronicle || !digestOn(view)) return [];
    const minutes = view.state.domains.director?.time?.minutes;
    if (!isInt(minutes)) return [];
    const settled = ask(typeof view.query === 'function' ? (name, args) => view.query(name, args) : null, 'time.overdue', {});
    const settledDay = isInt(settled?.minutes) ? dayOf(settled.minutes) : null;
    if (!needsDigest(chronicle, dayOf(minutes), { settledDay })) return [];
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    return [{ type: DIGEST, payload: { at } }];
}

// ---- the tail line ----------------------------------------------------------------------------

export const YESTERDAY_TAG = '[Yesterday]';
export const LAST_DAY_TAG = '[Last day]';
/** About 60 tokens: the line is optional, and Story Block drops it before anything else. */
export const DIGEST_TAIL_BUDGET = 60;

// The time part's While away recap is for this reply (its own staleness rule, time/settle.js).
function recapLive(view) {
    const recap = ask(typeof view.query === 'function' ? (name, args) => view.query(name, args) : null, 'time.recap', {});
    if (!recap || !Array.isArray(recap.lines) || !recap.lines.length) return false;
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    if (isInt(at) && isInt(recap.at)) return at < recap.at + 2;
    const rev = view?.state?.meta?.rev;
    return !(isInt(rev) && isInt(recap.rev) && rev > recap.rev);
}

/**
 * The tail's optional line: the last day's one line (`[Yesterday] …`, or `[Last day] …` when it was
 * longer ago), for the reply right after a time skip or a While away recap. '' otherwise.
 */
export function digestTailLine(view) {
    const chronicle = view?.state?.domains?.chronicle;
    if (!chronicle || !digestOn(view)) return '';
    if (!digestSettings(view.settings).tail) return '';
    const minutes = view.state.domains.director?.time?.minutes;
    if (!isInt(minutes)) return '';
    const written = writtenOf(chronicle);
    const at = isInt(view?.chat?.length) ? view.chat.length : null;
    // This reply (or a swipe of it) is the one the digests were written for.
    const fresh = written && isInt(written.at) && isInt(at) && at >= written.at && at < written.at + 2;
    if (!(fresh && written.skip) && !recapLive(view)) return '';
    const today = dayOf(minutes);
    // The digests as their days' facts stand now (a reply of the last day deleted since: its facts gone).
    const query = typeof view.query === 'function' ? (name, args) => view.query(name, args) : null;
    const last = orderedDays(chronicle, { state: view.state, currency: ask(query, 'inventory.currency', {}) }).filter(digest => digest.day < today).at(-1);
    if (!last?.line) return '';
    return `${last.day === today - 1 ? YESTERDAY_TAG : LAST_DAY_TAG} ${last.line}`;
}
