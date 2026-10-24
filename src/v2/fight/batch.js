// RPG Battle v2, the sealed BatchResult of a fight (B4/B5/B6: "a sealed result with immutable bytes and a hash"; Story Block's
// `batchResults.resolve({ id, state }) -> { id, hash, bytes }`, docs/v2/TIMELINE.md "Sealed batch results"). The bytes are plain JSON built
// only from what the fight recorded (never a live setting, a pack that is installed now or a wall clock); the hash is the contract's Hash
// of their normalized JSON, which is what the host recomputes from the bytes it pins. Once sealed under an id, both are fixed.
//
//   { v: 1, kind: 'fight', fight, ruleset, setup (hash), outcome, stakes, rounds,
//     actions: [{ id, type, form, hash, drawEnd }],      the player's actions in order, each with the hash of its record and the end of its draws
//     party:   [{ actor, name, level, hp, mp, sp, down, conditions: [ConditionRecord] }],
//     enemies: [{ id, name, gone, xp, level, rank }], defeated, fled, parleyed,
//     xp: [{ actor, amount }], loot: { money, items: [{ name, qty, rarity }] },
//     uses: [{ actor, skill, form, count }],              the paid uses combat.end pays through recordCombatUses
//     endingMinute }                                      the minute the fight ended (null until a clock says)
//
// Death, return and wipe batches (B6) extend this record with their own kinds; they are not here.

import { hashJson } from '../rules/hash.js';
import { isHash, isObject } from '../rules/ids.js';
import { actionHash, conditionRecord } from './records.js';

export const BATCH_VERSION = 1;
/** How many sealed results the progress domain keeps (the oldest go). */
export const MAX_BATCHES = 8;

const BATCH_ID = /^br_[0-9a-z]{8}$/;
export const isBatchId = value => typeof value === 'string' && BATCH_ID.test(value);

const sorted = list => [...list].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

/**
 * The bytes of a fight's result. `fight`: the finished engine fight; `session`: the stored one (setup and actions); `result`: v1's
 * summarize of it (loot money already in the chat's scale); `ix`: the pinned index; `at`: the ending minute or null.
 */
export function batchBytes({ fight, session, result, ix, at = null }) {
    const uses = [];
    for (const [actor, byForm] of Object.entries(result.uses ?? {})) {
        for (const [form, count] of Object.entries(byForm ?? {})) {
            const known = ix.form(form);
            if (known) uses.push({ actor, skill: known.skill, form, count });
        }
    }
    return {
        v: BATCH_VERSION,
        kind: 'fight',
        fight: session.id,
        ruleset: ix.rulesHash,
        setup: hashJson(session.setup),
        outcome: result.outcome,
        stakes: result.stakes,
        rounds: result.rounds,
        actions: session.actions.map(action => ({ id: action.id, type: action.type, form: action.form ?? null, hash: actionHash(action), drawEnd: null })),
        party: result.party.map(member => ({
            actor: member.memberId, name: member.name, level: member.level,
            hp: { ...member.hp }, mp: { ...member.mp }, sp: member.sp ? { ...member.sp } : null, down: member.down,
            conditions: member.conditions.map(cond => conditionRecord(cond, { at })),
        })),
        enemies: result.enemies.map(e => ({ id: e.id, name: e.name, gone: e.gone ?? null, xp: e.xp ?? 0, level: e.level ?? 1, rank: e.rank ?? null })),
        defeated: [...result.defeated],
        fled: [...result.fled],
        parleyed: [...result.parleyed],
        xp: Object.entries(result.xp ?? {}).map(([actor, amount]) => ({ actor, amount })).sort((a, b) => (a.actor < b.actor ? -1 : 1)),
        loot: { money: result.loot.money, items: result.loot.items.map(item => ({ name: item.name, qty: item.qty, rarity: item.rarity ?? 'common' })) },
        uses: sorted(uses),
        endingMinute: Number.isInteger(at) ? at : null,
    };
}

/** Fills each action's `drawEnd` (the state of its own random stream when it was done) from a fight replayed action by action. */
export function withDraws(bytes, drawEnds) {
    return { ...bytes, actions: bytes.actions.map((entry, index) => ({ ...entry, drawEnd: Number.isInteger(drawEnds[index]) ? drawEnds[index] : null })) };
}

/** The sealed pair for bytes: { hash, bytes } (deeply frozen). */
export function seal(bytes) {
    return { hash: hashJson(bytes), bytes };
}

/** Whether a stored entry is what it says it is: bytes that hash to the hash. */
export const sealedProblem = entry => (!isObject(entry) || !isHash(entry.hash) || !isObject(entry.bytes) ? 'A sealed result is { hash, bytes }.' : hashJson(entry.bytes) !== entry.hash ? 'The bytes of a sealed result do not hash to its hash.' : '');

/** Story Block's `batchResults.resolve({ id, state })`: `{ id, hash, bytes }` for a result this module sealed, else null. Synchronous and pure. */
export function resolveBatch({ id, state } = {}) {
    if (!isBatchId(id)) return null;
    const entry = state?.domains?.progress?.batches?.[id];
    if (!entry || sealedProblem(entry)) return null;
    return { id, hash: entry.hash, bytes: structuredClone(entry.bytes) };
}
