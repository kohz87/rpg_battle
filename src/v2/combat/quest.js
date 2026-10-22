// Quest-sized fights (user decision, wave C): a fight the story starts against the foes an active
// quest is about brings enough of them for real progress, about a third of the goal or more, in
// waves past the field (setup.planWaves), and the quest's item drops from every one of them. A
// count the story wrote ("3 Cellar Rat") is kept as written; only a foe written without one is
// sized. The quests are Story Director's (`director.threads`, `quest.progress`); without it, or
// with no quest that counts these foes or their loot, nothing changes. Pure apart from ctx.

import { LOOT_TABLES, findCreature } from '../../enemies.js';

// The most foes a quest-sized row brings (the field takes them in waves), and a row's own cap.
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
 * The offer's foes sized for the active quests (questTargets): a foe written without a count that
 * a quest counts (a kill) or drops a quest item (a collection) comes as many as a third of the
 * goal at least (what is still missing at most, QUEST_MAX_FOES), split into rows of ROW_MAX; a quest
 * item is marked on the foe (`questItem`) so it drops from each one (setup.reliableLoot). Returns
 * { foes, sized: [{ quest, name, from, to }] }.
 */
export function questSized(foes, targets, bestiary) {
    if (!targets.length) return { foes, sized: [] };
    const out = [];
    const sized = [];
    for (const foe of foes) {
        const target = targets.find(entry => (entry.kind === 'foes' ? nounNames(entry.noun, foe.name) : questItemOf(entry, foe.name, bestiary)));
        if (!target || foe.boss) {
            out.push(foe);
            continue;
        }
        const item = target.kind === 'items' ? questItemOf(target, foe.name, bestiary) : null;
        const marked = { ...foe, quest: target.id, ...(item ? { questItem: item.name } : {}) };
        if (foe.counted || foe.rank) {
            // The story wrote how many: kept as written (the drops are still sure).
            out.push(marked);
            continue;
        }
        const per = item ? item.qty : 1;
        const want = Math.ceil(Math.max(target.need * QUEST_SHARE, 1) / per);
        const most = Math.ceil(target.left / per);
        const count = Math.max(foe.count, Math.min(QUEST_MAX_FOES, most, want));
        for (let left = count; left > 0; left -= ROW_MAX) out.push({ ...marked, count: Math.min(ROW_MAX, left) });
        if (count !== foe.count) sized.push({ quest: target.id, name: foe.name, from: foe.count, to: count });
    }
    return { foes: out, sized };
}
