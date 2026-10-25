// Story Director v2, the retry ledger of the new policy writers (contract §3 P23/P24): every writer takes `write:RecordId`, allocated and
// persisted by the host before dispatch, and its owner keeps `{ fingerprint, result }` for the normalized command type and payload
// without `write`. The same write with the same fingerprint returns the saved result before any stale check; the same write with another
// meaning is a CONFLICT. The ledger lives in its owner's domain (`checks.writes`, `atlas.writes`) and is left out of every policy hash.
// Bounded: the newest LIMIT entries are kept (the host retries a write soon after it, never long after). Pure.

import { hashJson } from './hash.js';

export const WRITE_ID = /^[a-z]{2}_[0-9a-z]{8}$/;
export const WRITES_LIMIT = 200;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The fingerprint of a command: the hash of its type and payload without `write`. */
export function fingerprintOf(type, payload) {
    const { write: _write, ...rest } = payload ?? {};
    return hashJson({ type, payload: rest });
}

/**
 * Looks a write up in a ledger: `{ result }` for a retry (same fingerprint), `{ conflict: true }` for the same write with another meaning,
 * null for a write not seen.
 */
export function retryOf(ledger, write, fingerprint) {
    if (!isRecord(ledger) || !Object.hasOwn(ledger, write)) return null;
    const held = ledger[write];
    return held.fingerprint === fingerprint ? { result: structuredClone(held.result) } : { conflict: true };
}

/** Records a write's result in a draft ledger, dropping the oldest past the limit. */
export function remember(ledger, write, fingerprint, result) {
    ledger[write] = { fingerprint, result: structuredClone(result) };
    const keys = Object.keys(ledger);
    for (const key of keys.slice(0, Math.max(0, keys.length - WRITES_LIMIT))) delete ledger[key];
}

/** The problems of a ledger (a domain validator's part): [] or sentences. */
export function ledgerProblems(ledger, where) {
    if (!isRecord(ledger)) return [`${where} is not an object.`];
    const errors = [];
    const keys = Object.keys(ledger);
    if (keys.length > WRITES_LIMIT) errors.push(`${where} holds more than ${WRITES_LIMIT} writes.`);
    for (const key of keys) {
        const held = ledger[key];
        if (!WRITE_ID.test(key) || !isRecord(held) || !/^[0-9a-f]{64}$/.test(held.fingerprint ?? '') || !isRecord(held.result)) errors.push(`${where}.${key} is not { fingerprint, result }.`);
    }
    return errors.slice(0, 5);
}

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A fresh `<prefix>_xxxxxxxx` id from the command's seed (no Math.random), not in `taken`. */
export function idFrom(ctx, prefix, taken) {
    for (let tries = 0; tries < 64; tries += 1) {
        let id = '';
        for (let i = 0; i < 8; i += 1) id += ID_CHARS[Math.floor(ctx.rng() * ID_CHARS.length) % ID_CHARS.length];
        id = `${prefix}_${id}`;
        if (!Object.hasOwn(taken, id)) return id;
    }
    throw new Error(`No free ${prefix} id.`);
}
