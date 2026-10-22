// How a check reads on its reply (beta.1 live test: "there's no way for us to know the rolls?"). The
// reply's `? check … | roll: 1 | result: success` names the roll handed over ("Roll 1"), not the die, and
// the reader never saw the dice. Each result of the log is told here from its stored fields, at read time
// (so an older chat's results read the same way):
//
//   text     "Wessel, Stealth (AGI) — slipping past the guard: d20 8 (Roll 1) + 2 AGI + 1 Keen Eyes = 11 vs DC 10 → success"
//   summary  "Stealth 11 vs DC 10: success" (the folded card's header; a companion's name first)
//   flag     "Story said success; dice said fail" when the reply's written result disagrees with code's
//
// Code's outcome is the one that counts: the log, the receipt and the card keep it; the written result is
// only compared (crit and success count alike, a success at a cost is its own kind, a critical fail is a
// fail). Nothing else reads a check's outcome, so a disagreement changes no number; it is told on the
// card, not listed as a Problem (the line was used).
//
// `replyCard` is Story Block's `hooks.replyCard` (MODULES §F123): the checks that reply's ops added, as lines
// on its "Changed this reply" card. `diagnostics` is this part's section of Settings → Diagnostics: the dice
// handed over for the latest reply and which a check took (behind a click, never in the prompt's view).
// Pure apart from `diagnostics`' default sdk.

import { OUTCOMES } from '../party/checks.js';
import { logEntries } from './shared.js';
import { promptRolls } from './dice.js';

const LOG_PATH = /^\/domains\/checks\/log\/([^/]+)/;
const LOG_WHOLE = /^\/domains\/checks(?:\/log)?$/;

/** The kind a result counts as when the written one is compared: success, cost or fail. */
const KIND = Object.freeze({ crit: 'success', success: 'success', cost: 'cost', fail: 'fail', critfail: 'fail' });

const flat = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const title = word => (word ? word[0].toUpperCase() + word.slice(1) : word);

/** "Stealth (AGI)", or "AGI" when the skill is the stat itself. */
export function skillLabel(entry) {
    const skill = flat(entry?.skill, 40);
    const stat = String(entry?.stat ?? '');
    if (!skill || skill.toUpperCase() === stat) return stat || title(skill);
    return stat ? `${title(skill)} (${stat})` : title(skill);
}

/** "d20 8 (Roll 1) + 2 AGI + 1 Keen Eyes = 11 vs DC 10 (normal)" */
export function diceText(entry) {
    const die = `d20 ${entry.die}${entry.roll ? ` (Roll ${entry.roll})` : entry.roll === 0 ? ' (rolled by code)' : ''}`;
    const list = Array.isArray(entry.modifiers) ? entry.modifiers : [];
    const mods = list.length
        ? list.map(mod => ` ${mod.amount < 0 ? '−' : '+'} ${Math.abs(mod.amount)} ${flat(mod.reason, 40)}`).join('')
        : Number.isInteger(entry.mod) && entry.mod !== 0 ? ` ${entry.mod < 0 ? '−' : '+'} ${Math.abs(entry.mod)}` : '';
    return `${die}${mods} = ${entry.total} vs DC ${entry.dc}${entry.word ? ` (${entry.word})` : ''}`;
}

/** "Story said success; dice said fail" when the written result is another kind than code's, else ''. */
export function disagreement(entry) {
    const said = entry?.said;
    if (said && OUTCOMES[said] && OUTCOMES[entry.outcome]) {
        return KIND[said] === KIND[entry.outcome] ? '' : `Story said ${OUTCOMES[said]}; dice said ${OUTCOMES[entry.outcome]}`;
    }
    // A result kept before `said` was (its own note, "narrated as …, the dice say …").
    return said === undefined && entry?.mismatch ? title(flat(entry.mismatch, 120)) : '';
}

/**
 * One result as the reader sees it: { id, who, skill, stat, die, roll, modifiers, total, dc, outcome,
 * outcomeText, said, text, summary, flag, note, pass }. `pc`: your character's id (a companion's checks
 * name them in the summary).
 */
export function checkView(entry, { name = '', pc = null } = {}) {
    const who = flat(entry.name || name, 40);
    const outcomeText = OUTCOMES[entry.outcome] ?? String(entry.outcome ?? '');
    const what = flat(entry.what, 80);
    const skill = skillLabel(entry);
    const flag = disagreement(entry);
    const companion = pc && entry.actor !== pc && who ? `${who} ` : '';
    return {
        id: entry.id, actor: entry.actor, who, skill, stat: entry.stat, die: entry.die, roll: entry.roll ?? null,
        modifiers: (entry.modifiers ?? []).map(mod => ({ reason: mod.reason, amount: mod.amount })),
        total: entry.total, dc: entry.dc, outcome: entry.outcome, outcomeText, said: entry.said ?? null,
        text: flat(`${who ? `${who}, ` : ''}${skill}${what ? ` — ${what}` : ''}: ${diceText(entry)} → ${outcomeText}`, 200),
        summary: flat(`${companion}${skill.replace(/ \(.*\)$/, '')} ${entry.total} vs DC ${entry.dc}: ${outcomeText}${flag ? ' (story said otherwise)' : ''}`, 80),
        flag,
        note: flat(entry.note, 160),
        pass: entry.outcome === 'crit' || entry.outcome === 'success' || entry.outcome === 'cost',
    };
}

const actorName = (state, id) => {
    const actors = state?.domains?.party?.actors ?? {};
    return Object.hasOwn(actors, id) ? actors[id]?.name ?? '' : '';
};

/** `checks.view` → { [check id]: checkView } for every result kept (the status card reads its reply's). */
export function viewAll(state) {
    const pc = state?.domains?.party?.pc ?? null;
    const out = {};
    for (const entry of logEntries(state?.domains?.checks)) out[entry.id] = checkView(entry, { name: actorName(state, entry.actor), pc });
    return out;
}

/**
 * Story Block's `hooks.replyCard({ state, changes })` (MODULES §F123): the checks this reply's ops added
 * (a log key its ops touched, still in its state), oldest first, as lines for "Changed this reply".
 */
export function replyCard({ state = null, changes = [] } = {}) {
    const paths = Array.isArray(changes) ? changes.filter(path => typeof path === 'string') : [];
    const ids = new Set(paths.map(path => LOG_PATH.exec(path)?.[1]).filter(Boolean));
    const entries = logEntries(state?.domains?.checks);
    // An older chat's first keyed write replaced the whole log: the newest reply's entries then.
    const chosen = ids.size ? entries.filter(entry => ids.has(entry.id))
        : paths.some(path => LOG_WHOLE.test(path)) ? entries.filter(entry => entry.carrier && entry.carrier === entries.at(-1)?.carrier) : [];
    const pc = state?.domains?.party?.pc ?? null;
    return chosen.map(entry => {
        const view = checkView(entry, { name: actorName(state, entry.actor), pc });
        return { text: view.text, summary: view.summary, flag: view.flag, note: view.note, icon: 'fa-dice-d20' };
    });
}

/**
 * This part's section of Settings → Diagnostics (MODULES §F118): the dice handed over for the latest reply
 * (the one written last, or the one being written), and which of them a check took. Numbers only, no story
 * words. `sdk`: Story Block's (globalThis.StoryBlock.sdk by default).
 */
export function diagnostics(sdk = globalThis.StoryBlock?.sdk) {
    const ask = (name, args) => {
        try { return typeof sdk?.query === 'function' ? sdk.query(name, args) : null; } catch { return null; }
    };
    const latest = ask('checks.rolls', {});
    if (!latest?.rolls?.length) return ['Dice: none handed over yet (they are rolled when a reply starts).'];
    const log = Array.isArray(ask('checks.log', {})) ? ask('checks.log', {}) : [];
    const used = log.filter(entry => (entry.rev ?? 0) > (latest.rev ?? 0) && entry.roll >= 1);
    const where = Number.isInteger(latest.for) ? ` (message ${latest.for})` : '';
    const lines = [`Dice handed over for the latest reply${where}: ${promptRolls(latest.rolls).replace(/ \(.*\)$/, '')}.`];
    const taken = [...new Set(used.map(entry => entry.roll))].sort((a, b) => a - b);
    lines.push(taken.length ? `Taken by a check: ${taken.map(roll => `Roll ${roll}`).join(', ')}.` : 'No check took them yet.');
    lines.push('Every new reply, swipe or regenerate rolls fresh dice when it starts; a Continue keeps them.');
    return lines;
}

// ---------------------------------------------------------------------------------------------------
// Dice told back (lead, after the beta.1 live test): a reply whose check line wrote another result than
// the dice gave gets, in the NEXT reply's tail, one line per such check (at most MAX_TOLD_BACK), e.g.
// "[Dice] Wessel's AGI check (pursuing the wounded wolf) actually failed (5 vs DC 10): let the consequence
// show." Derived from the stored checks and receipts, so a swipe, a delete or a rebuild tells the same:
// the checks of the reply right before the one being written (the last carrier with a receipt before it;
// every reply leaves at least its dice there), not repeated after that. Not for a check Story Block's
// pre-roll made (`pre`, assist.precheck: the narrator was told that outcome before it wrote).

export const MAX_TOLD_BACK = 2;

const ACTUALLY = Object.freeze({
    crit: 'actually succeeded, brilliantly', success: 'actually succeeded', cost: 'actually succeeded only at a cost',
    fail: 'actually failed', critfail: 'actually failed badly',
});

/** The tail line for one result that disagrees, else ''. */
export function toldBackLine(entry, name = '') {
    if (!entry || entry.pre || !disagreement(entry) || entry.said === undefined) return '';
    const who = flat(entry.name || name, 40);
    const what = flat(entry.what, 50);
    const skill = skillLabel(entry).replace(/ \(.*\)$/, '');
    return `[Dice] ${who ? `${who}'s ` : ''}${skill} check${what ? ` (${what})` : ''} ${ACTUALLY[entry.outcome] ?? entry.outcome} (${entry.total} vs DC ${entry.dc}): let the consequence show.`;
}

/**
 * `checks.toldBack({ for })` (state, args, tools): the lines for the reply at chat index `for`, from the
 * checks of the last reply before it with a receipt (tools.receipts). [] without receipts or an index.
 */
export function toldBack(state, args = {}, tools = null) {
    const at = args?.for;
    if (!Number.isInteger(at)) return [];
    let receipts = [];
    try { receipts = typeof tools?.receipts === 'function' ? tools.receipts() ?? [] : []; } catch { receipts = []; }
    const before = receipts.filter(item => Number.isInteger(item?.index) && item.index < at);
    if (!before.length) return [];
    const last = Math.max(...before.map(item => item.index));
    const ids = new Set(before.filter(item => item.index === last).map(item => item.receipt?.data?.check).filter(id => typeof id === 'string'));
    return logEntries(state?.domains?.checks).filter(entry => ids.has(entry.id))
        .map(entry => toldBackLine(entry, actorName(state, entry.actor))).filter(Boolean).slice(0, MAX_TOLD_BACK);
}
