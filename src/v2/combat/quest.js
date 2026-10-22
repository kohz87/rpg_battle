// Quest-sized fights (user decision, wave C): a fight the story starts against the foes an active
// quest is about brings enough of them for real progress, about a third of the goal or more, in
// waves past the field (setup.planWaves), and the quest's item drops from every one of them. A
// count the story wrote ("3 Cellar Rat") is kept as written; only a foe written without one is
// sized. The quests are Story Director's (`director.threads`, `quest.progress`); without it, or
// with no quest that counts these foes or their loot, nothing changes. Pure apart from ctx.

import { LOOT_TABLES, findCreature } from '../../enemies.js';

// The most quest foes a quest-sized fight brings in all (the field takes them in waves), and a row's own cap.
export const QUEST_MAX_FOES = 24;
export const ROW_MAX = 9;
// A fight brings at least this share of the quest's whole goal (what is still missing at most).
export const QUEST_SHARE = 1 / 3;

const singular = word => (word.endsWith('ies') && word.length > 4 ? `${word.slice(0, -3)}y`
    : word.endsWith('ves') ? `${word.slice(0, -3)}f`
        : word.endsWith('s') && !word.endsWith('ss') && word.length > 3 ? word.slice(0, -1) : word);
const words = text => String(text ?? '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(singular);

/** Whether a quest's noun ("rat tails", "cellar rats") names this thing ("Cellar Rat Tail", "Cellar Rat"): every noun word in it. */
export function nounNames(noun, name) {
    const want = words(noun).filter(word => !['the', 'a', 'an', 'of'].includes(word));
    const have = new Set(words(name));
    return want.length > 0 && want.every(word => have.has(word));
}

function ask(ctx, name, args) {
    try {
        const value = ctx.query(name, args);
        return value === undefined ? null : value;
    } catch {
        return null;
    }
}

/**
 * The active quests code can count, with what is still missing: [{ id, noun, kind: 'foes' | 'items',
 * need, left }] (Story Director's `director.threads` and `quest.progress`; [] without them).
 */
export function questTargets(ctx) {
    const threads = ask(ctx, 'director.threads', { kind: 'quest', status: 'active' });
    if (!Array.isArray(threads)) return [];
    const out = [];
    for (const thread of threads.slice(0, 50)) {
        if (!thread || typeof thread.id !== 'string' || thread.offer) continue;
        const progress = ask(ctx, 'quest.progress', { id: thread.id });
        const need = Math.round(Number(progress?.need) || 0);
        const have = Math.max(0, Math.round(Number(progress?.have) || 0));
        if (!progress?.countable || !(need > have) || !String(progress.noun ?? '').trim()) continue;
        const kind = progress.source === 'inventory' ? 'items' : progress.source === 'fights' ? 'foes' : null;
        if (!kind) continue;
        out.push({ id: thread.id, noun: String(progress.noun), kind, need, left: need - have });
    }
    return out;
}

/** The loot rows a creature drops: its own list, or the table its id names. */
const lootOf = entry => (Array.isArray(entry?.loot) ? entry.loot : LOOT_TABLES[entry?.loot] ?? []);

/** The quest item a foe drops: { name, qty } from its loot, or (a creature not written up yet) the noun itself when it names the foe's kind. */
function questItemOf(target, foeName, bestiary) {
    const entry = findCreature(bestiary, foeName);
    const row = lootOf(entry).find(item => nounNames(target.noun, item.name));
    if (row) return { name: row.name, qty: Math.max(1, Math.round(Number(Array.isArray(row.qty) ? row.qty[0] : row.qty) || 1)) };
    // "rat tails" from a made-up Cellar Rat: the noun's words other than the part are the foe's.
    const part = words(target.noun).at(-1);
    const rest = words(target.noun).slice(0, -1);
    if (!entry && rest.length && rest.every(word => words(foeName).includes(word)) && part) return { name: target.noun, qty: 1, part };
    return null;
}

/**
 * The offer's foes sized for the active quests (questTargets), per fight: a foe written without a
 * count that a quest counts (a kill) or drops a quest item (a collection) is the one more of them
 * come as. What the fight brings toward a quest is reckoned over all its rows: about a third of the
 * goal at least (what is still missing at most), the foes the story wrote counted in it; the whole
 * fight's quest foes at most QUEST_MAX_FOES, and each tier at most `room(tier)` more (what the tier
 * can hold, setup.tierRoom). Sized rows are split into rows of ROW_MAX; a quest item is marked on
 * the foe (`questItem`) so it drops from each one (setup.reliableLoot). Returns { foes, sized: [{
 * quest, name, from, to }] }.
 */
export function questSized(foes, targets, bestiary, { room = () => Infinity } = {}) {
    if (!targets.length) return { foes, sized: [] };
    const rows = foes.map(foe => {
        const target = targets.find(entry => (entry.kind === 'foes' ? nounNames(entry.noun, foe.name) : questItemOf(entry, foe.name, bestiary)));
        if (!target || foe.boss) return { foe };
        const item = target.kind === 'items' ? questItemOf(target, foe.name, bestiary) : null;
        // The story wrote how many (or a rank): kept as written (the drops are still sure).
        return { foe: { ...foe, quest: target.id, ...(item ? { questItem: item.name } : {}) }, target, per: item ? item.qty : 1, fixed: Boolean(foe.counted || foe.rank) };
    });
    // What each quest still wants from this fight (in its own units: kills, or items), less what the
    // rows bring as written; and how many more quest foes the fight may bring.
    const want = Object.fromEntries(targets.map(target => [target.id, Math.min(target.left, Math.ceil(Math.max(target.need * QUEST_SHARE, 1)))]));
    let more = QUEST_MAX_FOES;
    for (const row of rows) {
        if (!row.target) continue;
        want[row.target.id] -= row.foe.count * row.per;
        more -= row.foe.count;
    }
    const added = {};
    const out = [];
    const sized = [];
    for (const row of rows) {
        if (!row.target || row.fixed) {
            out.push(row.foe);
            continue;
        }
        const tier = row.foe.tier ?? '';
        const free = Math.max(0, Math.floor(Number(room(tier)) - (added[tier] ?? 0)) || 0);
        const add = Math.max(0, Math.min(more, free, Math.ceil(Math.max(0, want[row.target.id]) / row.per)));
        const count = row.foe.count + add;
        more -= add;
        added[tier] = (added[tier] ?? 0) + add;
        want[row.target.id] -= add * row.per;
        for (let left = count; left > 0; left -= ROW_MAX) out.push({ ...row.foe, count: Math.min(ROW_MAX, left) });
        if (add) sized.push({ quest: row.target.id, name: row.foe.name, from: row.foe.count, to: count });
    }
    return { foes: out, sized };
}
