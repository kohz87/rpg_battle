// Seeded randomness: the same seed and the same calls give the same fight, so a fight is
// stored as its seed and its actions and replayed exactly (reload, rollback). Pure.

/** A 32-bit hash of any string (FNV-1a). */
export function hashSeed(text) {
    let hash = 0x811c9dc5;
    for (const char of String(text ?? '')) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/**
 * A generator from a seed (string or number): { next, int, chance, pick, between, state }.
 * mulberry32: small, fast and good enough for dice.
 */
export function makeRng(seed) {
    let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        /** A float in [0, 1). */
        next,
        /** An integer in [low, high], both included. */
        int: (low, high) => Math.floor(next() * (Math.floor(high) - Math.ceil(low) + 1)) + Math.ceil(low),
        /** True with `percent` % probability. */
        chance: percent => next() * 100 < percent,
        /** A float in [low, high). */
        between: (low, high) => low + next() * (high - low),
        /** One element of a non-empty array. */
        pick: list => list[Math.floor(next() * list.length)],
        /** The internal state, to resume a generator later with makeRng(state). */
        state: () => state,
    };
}

/** Private repeated trials can reuse the same immutable random draws. Each reader owns its
 * cursor; values and resumed states are exactly makeRng's. Cap retained prefixes so long
 * unsettled fights cannot grow the cache without bound. */
export function makeRngCache() {
    const streams = new Map();
    return seed => {
        let stream = streams.get(seed);
        if (!stream) {
            const source = makeRng(seed);
            stream = { source, initial: source.state(), values: [] };
            streams.set(seed, stream);
        }
        let position = 0, tail = null;
        const state = () => (stream.initial + Math.imul(position, 0x6d2b79f5)) >>> 0;
        const next = () => {
            if (position < stream.values.length) return stream.values[position++];
            if (position < 4096) {
                const value = stream.source.next();
                stream.values.push(value);
                position++;
                return value;
            }
            tail ??= makeRng(state());
            position++;
            return tail.next();
        };
        return { next, state,
            int: (low, high) => Math.floor(next() * (Math.floor(high) - Math.ceil(low) + 1)) + Math.ceil(low),
            chance: percent => next() * 100 < percent,
            between: (low, high) => low + next() * (high - low),
            pick: list => list[Math.floor(next() * list.length)],
        };
    };
}
