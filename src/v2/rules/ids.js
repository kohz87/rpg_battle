// RPG Battle v2, rules-v2 identities (contract §4): the id patterns the progression records use, and the
// owner's names. Story Block's own patterns (src/v2/check.js:7/:9) are the source; this module cannot import
// Story Block, so the contract's text is copied here and tests/v2/rules/ids.test.js holds it to the vendored
// copy. Pure.

/** The module id every rules-v2 guard names as its owner (the module whose handler attaches it). */
export const OWNER = 'rpg-battle';

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
export const isHash = value => typeof value === 'string' && HASH.test(value);

/** Until Story Block's savepoint epoch exists (track E6) every claim and guard names this epoch. */
export const EPOCH_FALLBACK = 'ep_00000001';

/** The epoch a state is in (contract §6 claims `rb:<epoch>:…`). One place to change when E6 brings the real one. */
export const epochOf = () => EPOCH_FALLBACK;

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
