// RPG Battle v2, the ruleset's flags (contract §3 `rules.flags`, `rules.flagSet`; B3 "flag: declared boolean default false; only a
// validated authorized event through rules.flagSet"; P25 requirement `{ kind: 'flag', key, value }`).
//
//   rules.flags({ keys? })   read-only → { values: { [key]: boolean }, hash }   every declared flag (false until set), the
//                             hash of the whole map; unknown keys left out; a malformed argument is null
//   rules.flagSet { write, key, value, evidence, expectedHash }
//                             → { key, value, hash }   Story Director's event adapter or one of this module's rules, from a step of
//                             theirs (never a button, never the story's own words); the key is declared; the evidence is a
//                             surviving `event` proof of Story Director that names exactly this flag and this value; the hash is
//                             the map as the caller read it; the evidence is consumed once (claim `rb:<epoch>:flag:<evidence>`)
//
// A flag is declared by the pinned ruleset (pin.js declaredFlags: the keys its requirements name). Nothing is stored for a flag
// that was never set. The proof is the authority: when it goes (its reply deleted or swiped) the replay guard turns the write off,
// and the claim with it, so the flag is back to what it was and the evidence can be used again. The shape of the event payload
// (`{ flag, value }`, nothing else) is this module's reading of "an active code-validated event authorizes exactly this
// transition"; Story Director has not frozen one (see docs/dev/progress.md, gaps).

import { hashJson } from './hash.js';
import { epochOf, isHash, isObject, isRecordId } from './ids.js';
import { indexOfState } from './graph.js';

/** The evidence's owner and kind: Story Director's `event` proofs (contract §6). */
export const EVENT_OWNER = 'story-director';
/** Who may ask for a write: Story Director's event adapter, or this module's own rule steps. */
export const TRUSTED = Object.freeze(['story-director', 'rpg-battle']);

const KEY_MAX = 80;

/** Every declared flag's value (false until an authorized event set it), by key. */
export function valuesOf(ix, slice) {
    const stored = isObject(slice?.flags) ? slice.flags : {};
    return Object.fromEntries(ix.flags().map(key => [key, Object.hasOwn(stored, key) && stored[key]?.value === true]));
}

/** The hash of the whole declared map. */
export const hashOf = values => hashJson(values);

const validKey = key => typeof key === 'string' && key.length >= 1 && key.length <= KEY_MAX;

/** rules.flags: see above. */
export function rulesFlags(state, args) {
    const ix = indexOfState(state);
    if (!ix) return null;
    if (args !== undefined && args !== null && (!isObject(args) || Object.keys(args).some(key => key !== 'keys'))) return null;
    const keys = args?.keys;
    if (keys !== undefined && (!Array.isArray(keys) || keys.length > 500 || !keys.every(validKey))) return null;
    const all = valuesOf(ix, state.domains.rules);
    const values = keys === undefined ? all : Object.fromEntries(keys.filter(key => Object.hasOwn(all, key)).map(key => [key, all[key]]));
    return { values, hash: hashOf(all) };
}

/**
 * Whether flag `key` may become `value` on this state, by this evidence: the question the command and the replay guard both ask.
 * `env`: { ix, rules (the rules slice), query }. → { ok, inputs } | { ok: false, code, why }.
 */
export function assessFlag(env, payload) {
    const { ix, rules, query } = env;
    if (!ix.flags().includes(payload.key)) return { ok: false, code: 'NOT_FOUND', why: 'That is not a flag this world declares.' };
    const from = rules?.flags?.[payload.key]?.value === true;
    if (from === payload.value) return { ok: false, code: 'REFUSED', why: `That flag is already ${payload.value ? 'on' : 'off'}.` };
    let found = [];
    try { found = query('story.evidence', { ids: [payload.evidence] }); } catch { found = []; }
    const proof = Array.isArray(found) ? found[0] : null;
    if (!proof) return { ok: false, code: 'NOT_FOUND', why: 'No surviving event is named as the reason.' };
    const said = proof.payload;
    if (proof.kind !== 'event' || proof.owner !== EVENT_OWNER || !isObject(said) || Object.keys(said).length !== 2 || said.flag !== payload.key || said.value !== payload.value) {
        return { ok: false, code: 'REFUSED', why: 'That event does not authorize exactly this change of the flag.' };
    }
    return { ok: true, from, inputs: { key: payload.key, from, value: payload.value, proof: proof.payloadHash } };
}

const FIELDS = ['write', 'key', 'value', 'evidence', 'expectedHash'];

/** rules.flagSet: see above. `attach(ctx, ix, kind, payload, inputs)` puts the replay guard on. */
export function flagSet(ctx, payload, attach) {
    if (!isObject(payload) || Object.keys(payload).some(key => !FIELDS.includes(key)) || FIELDS.some(key => !Object.hasOwn(payload, key))) ctx.fail('INVALID', `rules.flagSet takes { ${FIELDS.join(', ')} } and nothing else.`);
    if (!isRecordId(payload.write) || !validKey(payload.key) || typeof payload.value !== 'boolean' || !isRecordId(payload.evidence) || !isHash(payload.expectedHash)) ctx.fail('INVALID', 'A flag write names its write, a flag, a value, the event that allows it and the flags as read.');
    if (ctx.cause === 'ui' || !TRUSTED.includes(ctx.caller)) ctx.fail('REFUSED', 'A flag is set by an event of the story\'s own rules, never from a button or by the story\'s words.');
    const ix = indexOfState({ domains: { rules: ctx.read('rules') } });
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    const slice = ctx.read('rules');
    const held = slice.flags?.[payload.key];
    const answered = values => ({ summary: `${payload.key} is ${payload.value ? 'on' : 'off'}.`, narrate: false, data: { key: payload.key, value: payload.value, hash: hashOf(values) } });
    // The same write again, with the same event: it has been done.
    if (held && held.write === payload.write && held.evidence === payload.evidence && held.value === payload.value) return answered(valuesOf(ix, slice));
    if (hashOf(valuesOf(ix, slice)) !== payload.expectedHash) ctx.fail('STALE', 'The flags changed since they were read.');
    const answer = assessFlag({ ix, rules: slice, query: (name, args) => ctx.query(name, args) }, payload);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    if (!ctx.claim(`rb:${epochOf(ctx)}:flag:${payload.evidence}`)) ctx.fail('CLAIMED', 'That event already changed a flag once.');
    const draft = ctx.draft('rules');
    draft.flags[payload.key] = { value: payload.value, evidence: payload.evidence, write: payload.write };
    attach(ctx, ix, 'rules.flagSet', { write: payload.write, key: payload.key, value: payload.value, evidence: payload.evidence, expectedHash: payload.expectedHash }, answer.inputs);
    return answered(valuesOf(ix, draft));
}

export const queries = { 'rules.flags': rulesFlags };
