// RPG Battle v2, the ledger kept bounded (docs/dev/progress.md "The ledger stays bounded"; review item 7). Only a credit counts
// toward mastery and the caps, so once an attempt is settled all that is needed of it is its credited use: a count per
// (character, form) and a count per (character, skill, story day). When the ledger holds more than FOLD_AT attempts, the
// settlement that credits attempts also folds the settled ones into those counts (`progress.sealed`) and removes their rows.
//
// What is never folded: an attempt of the reply that is settling now, and an attempt whose boundary reply still has one waiting
// (a clock unset holds it), because the per-reply caps of that reply are still being counted from its rows. Pure.

import { isObject } from '../rules/ids.js';

/** More attempts than this on the ledger, and a settlement folds the settled ones. */
export const FOLD_AT = 300;

/**
 * The fold of `progress` once `plan` (a settlement's rows) is applied, or null when the ledger is small enough or nothing can be
 * folded: { ids: [attempt id, sorted], forms: { "<actor>|<form>": n }, days: { "<actor>|<skill>|<day>": n }, base: { forms, days } }.
 * `base` is what the sealed counts of those keys stood at, because applying the fold writes the new total (base + n): a settlement
 * whose base is not the chat's any more (an earlier fold was taken back) is not the one that was planned, so its guard carries
 * the base (`foldInputs`) and the host plans it again. `reply`: the sid of the reply that settles (its attempts stay), `at`: the
 * size above which to fold.
 */
export function planFold(progress, plan, reply, at = FOLD_AT) {
    const attempts = isObject(progress?.attempts) ? progress.attempts : {};
    if (Object.keys(attempts).length <= at) return null;
    const credits = { ...(isObject(progress?.credits) ? progress.credits : {}), ...Object.fromEntries(plan.map(({ id, ...row }) => [id, row])) };
    const waiting = new Set(reply ? [reply] : []);
    for (const [id, attempt] of Object.entries(attempts)) if (!Object.hasOwn(credits, id)) waiting.add(attempt.capSource.sid);
    const ids = Object.keys(attempts).filter(id => Object.hasOwn(credits, id) && !waiting.has(attempts[id].capSource.sid)).sort();
    if (!ids.length) return null;
    const forms = {};
    const days = {};
    for (const id of ids) {
        const credit = credits[id];
        if (credit.award < 1) continue;
        const { actor, skill, form } = attempts[id];
        forms[`${actor}|${form}`] = (forms[`${actor}|${form}`] ?? 0) + 1;
        days[`${actor}|${skill}|${credit.day}`] = (days[`${actor}|${skill}|${credit.day}`] ?? 0) + 1;
    }
    const sealed = isObject(progress?.sealed) ? progress.sealed : {};
    const base = { forms: {}, days: {} };
    for (const key of Object.keys(forms)) base.forms[key] = sealed.forms?.[key] ?? 0;
    for (const key of Object.keys(days)) base.days[key] = sealed.days?.[key] ?? 0;
    return { ids, forms, days, base };
}

/** What a fold adds to the guard's inputs: the attempts it removes, the counts it adds and the totals it adds them to (null: no fold). */
export const foldInputs = fold => (fold ? { ids: fold.ids, forms: fold.forms, days: fold.days, base: fold.base } : null);

/** Applies a fold to the progress draft: the rows go, the sealed counts grow. */
export function applyFold(draft, fold) {
    for (const id of fold.ids) {
        delete draft.attempts[id];
        delete draft.credits[id];
    }
    for (const [key, n] of Object.entries(fold.forms)) draft.sealed.forms[key] = (draft.sealed.forms[key] ?? 0) + n;
    for (const [key, n] of Object.entries(fold.days)) draft.sealed.days[key] = (draft.sealed.days[key] ?? 0) + n;
    draft.sealed.folded += fold.ids.length;
}
