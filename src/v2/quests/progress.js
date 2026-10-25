// RPG Battle v2, quests: how far a quest is, and whether it can be turned in here.
// Pure. The evidence comes through `sources` (other modules' queries: RPG Battle's
// `combat.foesBeaten`, Story Block's `inventory.items`), so the same rules serve a command
// (through ctx.query), the `quest.progress` query and the tab (through view.query).

import { nameMatches, nounFor } from './parse.js';

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Runs a query, or gives `fallback` when it is not registered or fails (its module is off). */
export function tryQuery(query, name, args, fallback = undefined) {
    if (typeof query !== 'function') return fallback;
    try {
        const value = query(name, args);
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

/**
 * Fights won after `sinceRev`: `[{ rev, foes: [{ name, count }] }]` (rev null when the record
 * has none); null when no fights module answers.
 */
function fightsSince(query, sinceRev) {
    const list = tryQuery(query, 'combat.foesBeaten', { sinceRev }, null);
    if (!Array.isArray(list)) return null;
    const foesOf = foes => foes.map(foe => ({ name: text(foe?.name), count: Number.isSafeInteger(foe?.count) && foe.count > 0 ? foe.count : 1 }))
        .filter(foe => foe.name);
    // Either beaten entries `{ rev, foes: [{ name, count }], won }` (MODULES §B3) or foes already flat.
    return list.flatMap(entry => {
        if (!Array.isArray(entry?.foes)) return [{ rev: null, foes: foesOf([entry]) }];
        if (entry.won === false) return [];
        if (Number.isInteger(entry.rev) && Number.isInteger(sinceRev) && entry.rev <= sinceRev) return [];
        return [{ rev: Number.isInteger(entry.rev) ? entry.rev : null, foes: foesOf(entry.foes) }];
    });
}

/**
 * Whether a module counts fights (RPG Battle's `combat.foesBeaten` answers a list). Story Director
 * stands alone (WAVE rule 11): without it, a kill goal cannot be counted and the story vouches for it.
 */
export function fightsCounted(query) {
    return Array.isArray(tryQuery(query, 'combat.foesBeaten', {}, null));
}

/**
 * The target code counts, or null: an item target always (the inventory is Story Block's), a kill
 * target only while a module counts fights. A quest without one is met on the story's word (F83, F94).
 */
export function countedTarget(target, query) {
    if (!target) return null;
    return target.kind === 'items' || fightsCounted(query) ? target : null;
}

/** Why a kill goal is the story's to judge: no module counts fights. */
export const NO_FIGHTS = 'No fights are counted (RPG Battle is not running): the story says when it is done (met: yes).';

/** The claim key that keeps one fight from paying two kill quests (MODULES §F7). */
export const beatenClaim = rev => `beaten:${rev}`;

/** `free(rev)` for a state: a fight no kill quest has claimed yet. */
export function unclaimedIn(state) {
    const claims = state?.meta?.claims ?? {};
    return rev => !Object.hasOwn(claims, beatenClaim(rev));
}

/** Stacks `[{ stack, name, qty }]` the party holds; null when no inventory answers. */
function stacksHeld(query) {
    const list = tryQuery(query, 'inventory.items', {}, null);
    if (!Array.isArray(list)) return null;
    return list.map(item => ({
        stack: text(item?.stack ?? item?.id),
        name: text(item?.name ?? item?.def?.name),
        qty: Number.isSafeInteger(item?.qty) && item.qty > 0 ? item.qty : 0,
    })).filter(item => item.name && item.qty > 0)
        .sort((a, b) => (a.stack < b.stack ? -1 : a.stack > b.stack ? 1 : 0));
}

/**
 * Progress of a quest thread: `{ have, need, met, source, noun, reason, stacks, fights }`.
 * `source` is 'fights' or 'inventory' (null without a target). Fights count only after
 * `taken.rev`; a quest never taken on here counts none (its fights could predate it). One fight
 * pays one kill quest (MODULES §F7): `free(rev)` says whether a fight is still unclaimed (another
 * kill quest turned in with it otherwise); `fights` lists the revs of the fights counted, which a
 * turn-in claims. Item quests count the inventory and are independent of fights.
 * `stacks` (items only) lists what a turn-in would hand over, in order.
 */
export function progressOf(thread, query, { free = () => true, closing = false } = {}) {
    const target = thread?.target;
    if (!target) {
        // A goal code cannot count (F83): met once the story said so (`met: yes`, `ready`), or when the
        // story itself turns it in (`closing`, F94: its word is taken at turn-in).
        const ready = Boolean(thread?.ready);
        const met = ready || closing;
        return { have: 0, need: 0, met, ready, source: null, noun: '', reason: met ? '' : NOT_MET_YET };
    }
    const need = target.count;
    const noun = target.noun;
    if (target.kind === 'items') {
        const held = stacksHeld(query);
        if (!held) return { have: 0, need, met: false, source: 'inventory', noun, reason: 'The inventory is not available.' };
        const matching = held.filter(item => nameMatches(noun, item.name));
        const have = matching.reduce((sum, item) => sum + item.qty, 0);
        const met = have >= need;
        return { have, need, met, source: 'inventory', noun, reason: met ? '' : `Need ${need - have} more ${nounFor(target, need - have)}.`, stacks: matching };
    }
    if (!thread.taken) return { have: 0, need, met: false, source: 'fights', noun, reason: 'Fights count from when it is taken on.', fights: [] };
    const fights = fightsSince(query, thread.taken.rev);
    if (!fights) {
        // Nobody counts fights: a kill goal is the story's word, as a goal code cannot count (F83, F94).
        const ready = Boolean(thread?.ready);
        const met = ready || closing;
        return { have: met ? need : 0, need, met, ready, source: 'story', noun, reason: met ? '' : NO_FIGHTS, fights: [] };
    }
    let have = 0;
    const counted = [];
    for (const fight of fights) {
        const beaten = fight.foes.filter(foe => nameMatches(noun, foe.name)).reduce((sum, foe) => sum + foe.count, 0);
        if (!beaten) continue;
        if (fight.rev !== null && !free(fight.rev)) continue;
        have += beaten;
        if (fight.rev !== null) counted.push(fight.rev);
    }
    const met = have >= need;
    return { have, need, met, source: 'fights', noun, reason: met ? '' : `Need ${need - have} more ${nounFor(target, need - have)}.`, fights: counted };
}

/** Why a quest code cannot count is not done yet: the story has not said its goal is met. */
export const NOT_MET_YET = 'The story has not said its goal is met yet.';

/** "Wolves 8/3". */
export function progressLabel(thread, progress) {
    if (!thread?.target) return '';
    const noun = nounFor(thread.target, 2);
    return `${noun.replace(/^./, c => c.toUpperCase())} ${progress.have}/${progress.need}`;
}

const nameWords = name => text(name).toLowerCase().split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
function samePersonName(a, b) {
    const x = nameWords(a);
    const y = nameWords(b);
    if (!x.length || !y.length) return false;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    for (let start = 0; start + short.length <= long.length; start += 1) {
        if (short.every((word, i) => long[start + i] === word)) return true;
    }
    return false;
}

// The place kinds a quest is turned in at: the scene's class `settlement`, or a kind the atlas or a pack
// gives a settlement ("village", "lock town", "fortress city"), as `atlas.here` reports it.
const SETTLEMENT_KIND = /(?:^|[^\p{L}])(?:settlement|village|town|city|hamlet|capital)(?![\p{L}])/u;

/** Whether a place kind is one a quest is turned in at. */
export const isSettlementKind = kind => SETTLEMENT_KIND.test(text(kind).toLowerCase());

/**
 * The place rule for a turn-in: in a settlement (`scene.place.kind`, or the atlas's kind when the scene
 * has none: quests/index.js hereScene), or with the giver in `scene.present` (whole-word names: "Fenna"
 * is "Fenna the miller"). `{ ok, reason }`.
 */
/** Whether the quest's giver is among the people present in `scene` (Story Block's scene). */
export function giverHere(thread, scene) {
    const giver = text(thread?.fields?.giver);
    return Boolean(giver) && (scene?.present ?? []).some(name => samePersonName(giver, name));
}

export function placeRule(thread, scene) {
    const kind = text(scene?.place?.kind).toLowerCase();
    if (SETTLEMENT_KIND.test(kind)) return { ok: true, reason: '' };
    const giver = text(thread?.fields?.giver);
    if (giver && (scene?.present ?? []).some(name => samePersonName(giver, name))) return { ok: true, reason: '' };
    return { ok: false, reason: giver ? `Turn it in at a settlement or where ${giver} is.` : 'Turn it in at a settlement.' };
}

/**
 * Whether `quest.finish` would turn `thread` in now (`progress` from progressOf, `scene` Story Block's
 * scene): `{ ok, reason }`, checked in quest.finish's order: over, taken on, a target code can count,
 * the target met, the place rule. The reason is the first refusal, in plain words.
 */
export function finishRule(thread, progress, scene) {
    if (!thread) return { ok: false, reason: 'There is no such quest.' };
    if (thread.ended || thread.status !== 'active') return { ok: false, reason: `${text(thread.key)} is already over.` };
    if (!thread.taken) return { ok: false, reason: 'It was never taken on.' };
    if (!progress?.met) return { ok: false, reason: text(progress?.reason) || 'Not done yet.' };
    return placeRule(thread, scene);
}

/**
 * Plain lists the Quests board and the tail use: active quests and finished ones (latest first). An
 * older chat's offers (`offer: true`, not taken on) are in neither: they are shown nowhere.
 */
export function questLists(director) {
    const quests = Object.values(director?.threads ?? {}).filter(thread => thread?.kind === 'quest');
    const byKey = (a, b) => text(a.key).localeCompare(text(b.key)) || (a.id < b.id ? -1 : 1);
    const open = thread => thread.status === 'active' && !thread.ended;
    return {
        active: quests.filter(thread => open(thread) && !(thread.offer && !thread.taken)).sort(byKey),
        finished: quests.filter(thread => !open(thread))
            .sort((a, b) => (b.ended?.rev ?? b.rev ?? 0) - (a.ended?.rev ?? a.rev ?? 0) || byKey(a, b)),
    };
}
