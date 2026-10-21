// Dice for the checks part (MODULES §F80): rolled by code before the reply, handed to the model in
// the tail tied to attempts, never chosen by the model.
//
// Ported from Story Block v1 (src/dice.js: rollDice, promptRolls), which ported them from Megumin
// Suite (GPL-3.0): the roll line format, the rejection-sampled die and the "the first attempt takes
// Roll 1" wording are its. Differences here: the die draws from the receipt's seeded dice
// (ctx.rng through `draw`), never from crypto or Math.random, so a receipt replays to the same
// rolls; only d20s; the attempt wording says "uncertain attempt". Pure.

export const SIDES = 20;
export const MAX_ROLLS = 10;

/**
 * `count` fair rolls of a `sides`-sided die from `draw()` → a whole number in [0, 2^32)
 * (rejection sampling: no modulo bias). `draw` is required: the caller's seeded source.
 */
export function rollDice(count, sides = SIDES, draw) {
    if (typeof draw !== 'function') throw new TypeError('rollDice needs a seeded draw().');
    const n = Math.max(0, Math.min(MAX_ROLLS, Number.parseInt(count, 10) || 0));
    const faces = Number.isInteger(sides) && sides >= 2 && sides <= 100 ? sides : SIDES;
    const limit = Math.floor(0x100000000 / faces) * faces;
    const out = [];
    for (let guard = 0; out.length < n && guard < 1000; guard++) {
        const value = draw() >>> 0;
        if (value >= limit) continue;
        out.push((value % faces) + 1);
    }
    // A source that keeps drawing above the limit (never in practice): fill from the last draws.
    while (out.length < n) out.push(((draw() >>> 0) % faces) + 1);
    return out;
}

/** A draw() over ctx.rng(): [0, 1) → a whole number in [0, 2^32). */
export const drawFrom = rng => () => Math.floor(rng() * 0x100000000) >>> 0;

/**
 * The rolls as the tail hands them over, each tied to its attempt: "Roll 1 = 12 · Roll 2 = 5 (the
 * first uncertain attempt takes Roll 1, the next Roll 2, whatever they say)". A plain list is read
 * as a pool to pick from: a model skipped a 2 against DC 10 and took the 13 (v1 0.9.6).
 */
export function promptRolls(rolls) {
    if (!Array.isArray(rolls) || !rolls.length) return 'none';
    const list = rolls.map((roll, index) => `Roll ${index + 1} = ${roll}`).join(' · ');
    return rolls.length === 1
        ? `${list} (the uncertain attempt takes it, whatever it says)`
        : `${list} (the first uncertain attempt takes Roll 1, the next Roll 2${rolls.length > 2 ? ', and so on' : ''}, whatever they say)`;
}
