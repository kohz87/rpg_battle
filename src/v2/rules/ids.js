// RPG Battle v2, rules-v2 identities (contract §4): the id patterns the progression records use, and the
// owner's names. Story Block's own patterns (src/v2/check.js:7/:9) are the source; this module cannot import
// Story Block, so the contract's text is copied here and tests/v2/rules/ids.test.js holds it to the vendored
// copy. Pure.

/** Who may take the trusted steps (the caller of the nested command): rules.flagSet and rules.registerItem. */
export const TRUSTED = Object.freeze({
    flagSet: Object.freeze(['story-director', 'rpg-battle']),
    registerItem: Object.freeze(['story-block', 'rpg-battle']),
});

/** `ac_xxxxxxxx`: a character (contract §4 ActorId). */
export const ACTOR_ID = /^ac_[0-9a-z]{8}$/;
/** `<prefix>_<8 base36>` (contract §4 RecordId). */
export const RECORD_ID = /^[a-z][a-z0-9]*_[0-9a-z]{8}$/;
/** `pack.fantasy/iron-sword` (contract §4 DefId; refs inside a ruleset are always in this form). */
export const DEF_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
/** 64 lowercase hex characters (contract §4 Hash). */
export const HASH = /^[0-9a-f]{64}$/;

export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isActorId = value => typeof value === 'string' && ACTOR_ID.test(value);
export const isRecordId = value => typeof value === 'string' && RECORD_ID.test(value);
export const isDefId = value => typeof value === 'string' && DEF_ID.test(value);
export const isId = value => isRecordId(value) || isDefId(value);
/** `tn_xxxxxxxx`: an open trainer offer (RB 2.2.0, the `training` domain's `offers`). */
export const TRAINER_OFFER_ID = /^tn_[0-9a-z]{8}$/;
export const isTrainerOfferId = value => typeof value === 'string' && TRAINER_OFFER_ID.test(value);
/** What a training session or a request names as its trainer: a pack trainer's ref, or an open trainer offer's `tn_` id. */
export const isTrainerRef = value => isDefId(value) || isTrainerOfferId(value);
export const isHash = value => typeof value === 'string' && HASH.test(value);

/** A whole number in a range (safe integers only). */
export const int = (value, min = -Infinity, max = Infinity) => Number.isSafeInteger(value) && value >= min && value <= max;

/** Until Story Block's savepoint epoch exists (track E6) every claim and guard names the genesis epoch. */
export const EPOCH_FALLBACK = 'ep_00000000';

/**
 * The epoch of a command context (`ctx.epoch`, which Story Block provides with E6) or of a state (its savepoints domain), else the
 * genesis epoch (contract §6 claims `rb:<epoch>:…`, Guard.epoch). A guard names the epoch it was made in; the replay hook compares.
 */
export function epochOf(from) {
    if (RECORD_ID.test(from?.epoch ?? '')) return from.epoch;
    const saved = from?.domains?.savepoints?.epoch;
    if (RECORD_ID.test(saved ?? '')) return saved;
    // E6a's ctx does not expose epoch yet. The host-owned epoch is the sole value read here;
    // callers never draft savepoints or mint an epoch when the first restore changed it.
    if (typeof from?.read === 'function') {
        try {
            const epoch = from.read('savepoints')?.epoch;
            if (RECORD_ID.test(epoch ?? '')) return epoch;
        } catch { /* A chat that never used the timeline has no savepoints slice. */ }
    }
    return EPOCH_FALLBACK;
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** `<prefix>_<8 base36>` from the first 40 bits of a hash (the shape Story Block's own derived ids have). */
export function idFromHash(prefix, hex) {
    let n = parseInt(String(hex).slice(0, 10), 16);
    let out = '';
    for (let i = 0; i < 8; i += 1) {
        out = BASE36[n % 36] + out;
        n = Math.floor(n / 36);
    }
    return `${prefix}_${out}`;
}
