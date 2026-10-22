// Other modules' modifiers on a check (Story Block MODULES §F124). Before a check is resolved, the checks
// part asks:
//
// * every other module's hook `checkModifiers({ state, query }, { actor: { id, name }, skill, stat, target, dc })`
//   through Story Block's `ctx.gather` → `[{ mod, text }]` (or one `{ mod, text }`), on the state the check's
//   reply has (a Re-read or a swipe asks the same state, so they agree);
// * NPC State Delta's query `npc.socialModifier({ name, skill })` → `{ mod, reasons: [{ text, value }] } | null`
//   (its feature `npc-state-delta.social`) for a social skill (persuade, charm or seduce, intimidate,
//   deceive) against someone, when Delta is there. A missing module, a query not registered, a feature off
//   or a throw is no modifier.
//
// The target: the check's `vs:` or `target:` label, else the first person here (scene.present) whose name
// the line's text has ("persuading Elula to open the gate"). `who:` stays the member making the check.
//
// Bounds: each amount a whole number held to −5…5, at most MAX_ENTRIES entries, texts one line of at most
// 40 characters, and the sum held to ±cap (the setting `outsideCap`, default 5, 0 turns them off); when the
// sum is held, one more entry says so ("held to ±5"), so the line still adds up. Each entry is a modifier
// with source `module` and a reason naming its module: "Elula is wary (Delta)". Pure apart from ctx.

export const DEFAULT_CAP = 5;
export const MAX_CAP = 10;
export const MAX_ENTRIES = 4;
/** One entry's amount at most (so the "held to" entry stays within a modifier's −20…20). */
export const PER_ENTRY = 5;
export const HOOK = 'checkModifiers';
export const SOCIAL_QUERY = 'npc.socialModifier';

/** The social skills Delta is asked about, each to the word Delta is given. */
const SOCIAL = [
    ['persuade', /\b(?:persua\w*|convinc\w*|negotiat\w*|diplomac\w*|plead\w*)\b/],
    ['charm', /\b(?:charm\w*|seduc\w*|flirt\w*|allur\w*)\b/],
    ['intimidate', /\b(?:intimidat\w*|threat\w*|menac\w*|coerc\w*)\b/],
    ['deceive', /\b(?:decei\w*|decept\w*|bluff\w*|lie|lies|lying|trick\w*)\b/],
];

/** Short names for the suite's modules on a check line. */
const SHORT = Object.freeze({ 'npc-state-delta': 'Delta', 'story-director': 'Director', 'story-block': 'Story Block' });

const flat = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const nameKey = value => flat(value, 80).normalize('NFKC').toLowerCase();

/** The social word for Delta ('persuade' | 'charm' | 'intimidate' | 'deceive'), or null. */
export function socialSkill(skill) {
    const text = ` ${String(skill ?? '').toLowerCase()} `;
    return SOCIAL.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/** The cap from the part's settings: a whole number 0…MAX_CAP, else DEFAULT_CAP. */
export function capOf(settings) {
    const value = settings?.outsideCap;
    return Number.isInteger(value) && value >= 0 && value <= MAX_CAP ? value : DEFAULT_CAP;
}

/**
 * Who the check is against: its `vs:` / `target:` label, else the first person here whose name the line's
 * text has (whole words, any case), never the member making it. '' for nobody.
 */
export function targetOf(labels, text, present, actorName = '') {
    const written = flat(labels?.vs ?? labels?.target ?? '', 60);
    if (written) return written;
    const words = ` ${nameKey(text).replace(/[^\p{L}\p{N}' -]+/gu, ' ')} `;
    const self = nameKey(actorName);
    for (const name of Array.isArray(present) ? present : []) {
        const key = nameKey(name).replace(/[^\p{L}\p{N}' -]+/gu, ' ').trim();
        if (!key || key === self) continue;
        if (words.includes(` ${key} `)) return flat(name, 60);
    }
    return '';
}

const amountOf = value => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(-PER_ENTRY, Math.min(PER_ENTRY, Math.round(n))) : 0;
};

/** One answer ([{ mod, text }] or { mod, text }) as entries for `module`. */
function entriesFrom(answer, module) {
    const list = Array.isArray(answer) ? answer : answer && typeof answer === 'object' ? [answer] : [];
    const label = SHORT[module] ?? flat(module, 20);
    return list.filter(item => item && typeof item === 'object')
        .map(item => ({ amount: amountOf(item.mod ?? item.amount), text: flat(item.text ?? item.reason, 40) }))
        .filter(item => item.amount !== 0)
        .map(item => ({ source: 'module', amount: item.amount, reason: flat(`${item.text || 'a reason'} (${label})`, 60), module: flat(module, 40) }));
}

/** Delta's answer `{ mod, reasons: [{ text, value }] }` as entries: its reasons when they add up to `mod`, else one. */
function deltaEntries(answer) {
    if (!answer || typeof answer !== 'object') return [];
    const total = amountOf(answer.mod);
    const reasons = (Array.isArray(answer.reasons) ? answer.reasons : []).filter(item => item && typeof item === 'object')
        .map(item => ({ mod: amountOf(item.value), text: item.text }));
    const sum = reasons.reduce((n, item) => n + item.mod, 0);
    if (reasons.length && sum === total) return entriesFrom(reasons, 'npc-state-delta');
    return entriesFrom([{ mod: total, text: reasons.map(item => flat(item.text, 40)).filter(Boolean).join('; ') }], 'npc-state-delta');
}

/**
 * The other modules' modifiers for a check: [{ source: 'module', amount, reason, module }], held as above.
 * `ctx`: the command's (gather, query, read); `check`: { actor: { id, name }, skill, stat, target, dc }.
 */
export function outsideModifiers(ctx, check, cap = DEFAULT_CAP) {
    if (!(cap > 0)) return [];
    const entries = [];
    let gathered = [];
    try { gathered = typeof ctx?.gather === 'function' ? ctx.gather(HOOK, check) ?? [] : []; } catch { gathered = []; }
    for (const item of gathered) {
        // Delta answers through its query below; a hook of its own as well would count it twice.
        if (item?.module === 'npc-state-delta') continue;
        entries.push(...entriesFrom(item?.answer, String(item?.module ?? '')));
    }
    const social = socialSkill(check.skill);
    if (social && check.target) {
        let answer = null;
        try { answer = typeof ctx?.query === 'function' ? ctx.query(SOCIAL_QUERY, { name: check.target, skill: social }) : null; } catch { answer = null; }
        entries.push(...deltaEntries(answer));
    }
    const kept = entries.slice(0, MAX_ENTRIES);
    const sum = kept.reduce((n, item) => n + item.amount, 0);
    const held = Math.max(-cap, Math.min(cap, sum));
    if (held !== sum) kept.push({ source: 'module', amount: held - sum, reason: `held to ±${cap}`, module: 'rpg-battle' });
    return kept;
}
