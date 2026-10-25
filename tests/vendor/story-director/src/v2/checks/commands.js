// Story Director v2, part **checks**: the commands (contract §3 P09, P24, and the `checks.roll` row of the entry table).
//
//   checks.actor { write, id?, name, bonuses?, makeDefault?, expectedHash }  -> { actor, hash }
//       The player's own settings, or RPG Battle's creation making a missing actor (never editing one). No id allocates `ca_`; bonuses
//       default {} on a new actor and are kept on an edit; the first actor becomes the default. Editing keeps its link.
//   checks.link  { write, actor, rbActor|null, expectedHash }                 -> { actor, rbActor, hash }
//       The player, or RPG Battle's creation. A character must resolve through `rules.sheet` and be the PC or a durable companion; one actor
//       to one character and back; null unlinks. Nothing is linked by a same name. RB's creation never relinks an actor that already has
//       another living character (CONFLICT; a link whose character `rules.sheet` no longer knows is stale and may be taken); the player may.
//   checks.roll  { actor?, stat?, skill, targetNpc?, dc?, evidence }         -> { check, actor, die, modifiers, mod, total, dc, outcome, ... }
//       Capture, the pre-roll and the system only: nobody supplies a die or an outcome. One d20 from the receipt's seed.
//
// Every writer is idempotent by `write` (writes.js), checks its issuer, then retries, then references, then the stale hash, in that
// order: INVALID, REFUSED, (a retry), NOT_FOUND, STALE, CONFLICT.

import { ACTOR_ID, BONUS_LIMIT, MAX_ACTORS, MAX_BONUSES, MAX_LOG, MAX_NAME, RB_ACTOR_ID, bonusKeyOk, draftChecks, isRecord, policyOf, projection } from './domain.js';
import { TOPIC_NAMES, outcomeOf, statForCheck } from './words.js';
import { combine, rbParts, socialParts, standaloneParts } from './roll.js';
import { hashJson } from '../hash.js';
import { WRITE_ID, fingerprintOf, idFrom, remember, retryOf } from '../writes.js';

const isPlayer = ctx => ctx.cause === 'ui' && !ctx.caller;
const isRb = ctx => ctx.caller === 'rpg-battle';
const text = value => String(value ?? '').normalize('NFC').replace(/\p{Cf}+/gu, '').replace(/\s+/g, ' ').trim();
const FIELDS = {
    'checks.actor': ['write', 'id', 'name', 'bonuses', 'makeDefault', 'expectedHash'],
    'checks.link': ['write', 'actor', 'rbActor', 'expectedHash'],
    'checks.roll': ['actor', 'stat', 'skill', 'targetNpc', 'dc', 'evidence', 'craft'],
};
const HASH = /^[0-9a-f]{64}$/;

function shape(ctx, type, payload, required) {
    if (!isRecord(payload)) ctx.fail('INVALID', `${type} takes an object.`);
    const extra = Object.keys(payload).find(key => !FIELDS[type].includes(key));
    if (extra) ctx.fail('INVALID', `${type} does not take "${extra}".`);
    for (const key of required) if (!Object.hasOwn(payload, key)) ctx.fail('INVALID', `${type} needs ${key}.`);
}

/** A writer's front half: the issuer, the retry ledger. → { fingerprint } or { saved } for a retry. */
function opened(ctx, type, payload, issuer) {
    if (!WRITE_ID.test(payload.write ?? '')) ctx.fail('INVALID', `${type} needs the id of the write that asks for it.`);
    if (!HASH.test(payload.expectedHash ?? '')) ctx.fail('INVALID', `${type} needs the hash of the policy it was made on.`);
    if (!issuer) ctx.fail('REFUSED', `${type} is the player's own setting${type === 'checks.actor' ? ' (or the creation of a character making a missing actor)' : ' (or the creation of a character)'}; the story cannot make it.`);
    const fingerprint = fingerprintOf(type, payload);
    const retry = retryOf(ctx.read('checks').writes, payload.write, fingerprint);
    if (retry?.conflict) ctx.fail('CONFLICT', 'That write was already made with another meaning.');
    return { fingerprint, saved: retry?.result ?? null };
}

const answered = (ctx, type, result, data) => ({ summary: '', narrate: false, data: { v2: { key: `${type}:${data}`, result } } });

function finish(ctx, type, payload, fingerprint, result, key) {
    remember(draftChecks(ctx).writes, payload.write, fingerprint, result);
    return answered(ctx, type, result, key);
}

function stale(ctx, payload) {
    if (projection(ctx.read('checks'), ctx.settings()).hash !== payload.expectedHash) ctx.fail('STALE', 'The checks settings changed since they were read.');
}

function bonusesOf(ctx, value) {
    if (!isRecord(value) || Object.keys(value).length > MAX_BONUSES) ctx.fail('INVALID', `Bonuses are a record of at most ${MAX_BONUSES}.`);
    for (const [key, amount] of Object.entries(value)) {
        if (!bonusKeyOk(key, TOPIC_NAMES)) ctx.fail('INVALID', `"${key}" is not a stat or a topic:<name>.`);
        if (!Number.isSafeInteger(amount) || Math.abs(amount) > BONUS_LIMIT) ctx.fail('INVALID', `A bonus is a whole number from -${BONUS_LIMIT} to ${BONUS_LIMIT}.`);
    }
    return { ...value };
}

function checksActor(ctx, payload) {
    shape(ctx, 'checks.actor', payload, ['write', 'name', 'expectedHash']);
    const name = text(payload.name);
    if (!name || name.length > MAX_NAME) ctx.fail('INVALID', `An actor has a name of at most ${MAX_NAME} characters.`);
    if (payload.id !== undefined && !ACTOR_ID.test(payload.id)) ctx.fail('INVALID', 'An actor id looks like ca_k3f9a2qz.');
    if (payload.makeDefault !== undefined && typeof payload.makeDefault !== 'boolean') ctx.fail('INVALID', 'makeDefault is true or false.');
    const bonuses = payload.bonuses === undefined ? undefined : bonusesOf(ctx, payload.bonuses);
    const policy = policyOf(ctx.read('checks'));
    const known = payload.id !== undefined && Object.hasOwn(policy.actors, payload.id);
    // RPG Battle's creation may make a missing actor; only the player edits one.
    const issuer = isPlayer(ctx) || (isRb(ctx) && !known);
    const { fingerprint, saved } = opened(ctx, 'checks.actor', payload, issuer);
    if (saved) return answered(ctx, 'checks.actor', saved, saved.actor);
    if (payload.id !== undefined && !known && !isRb(ctx)) ctx.fail('NOT_FOUND', 'That actor is not there.');
    stale(ctx, payload);
    if (!known && Object.keys(policy.actors).length >= MAX_ACTORS) ctx.fail('LIMITED', `There are at most ${MAX_ACTORS} actors.`);
    const draft = draftChecks(ctx).policy;
    const id = known ? payload.id : payload.id ?? idFrom(ctx, 'ca', draft.actors);
    draft.actors[id] = { id, name, bonuses: bonuses ?? (known ? { ...policy.actors[id].bonuses } : {}) };
    if (payload.makeDefault === true || draft.defaultActor === null) draft.defaultActor = id;
    const result = { actor: id, hash: projection({ policy: draft }, ctx.settings()).hash };
    return finish(ctx, 'checks.actor', payload, fingerprint, result, id);
}

/** What the linked character is for a link: `rules.sheet`'s answer when it is the PC or a durable companion, else why not. */
function characterOf(ctx, rbActor) {
    let sheet;
    const found = ask(ctx, 'rules.sheet', { actor: rbActor });
    const legacy = !found.ok || found.value === null ? ask(ctx, 'party.actor', { id: rbActor }) : found;
    if (!legacy.ok && !found.ok) ctx.fail('DEPENDENCY_UNAVAILABLE', 'RPG Battle is not ready, so no character can be linked now.');
    sheet = legacy.value;
    if (!isRecord(sheet)) ctx.fail('NOT_FOUND', 'RPG Battle has no such character.');
    if (sheet.kind !== 'pc' && sheet.kind !== 'companion') ctx.fail('REFUSED', 'Only the player character or a durable companion is linked.');
    return sheet;
}

/** Whether the character an actor is linked to is still there: false only when RPG Battle answers and does not know it (or it is no longer the PC or a companion). */
function linkedIsLive(ctx, rbActor) {
    let sheet = ask(ctx, 'rules.sheet', { actor: rbActor });
    if (!sheet.ok || sheet.value === null) {
        const legacy = ask(ctx, 'party.actor', { id: rbActor });
        if (legacy.ok) sheet = legacy;
    }
    if (!sheet.ok) return true;
    return isRecord(sheet.value) && (sheet.value.kind === 'pc' || sheet.value.kind === 'companion');
}

function checksLink(ctx, payload) {
    shape(ctx, 'checks.link', payload, ['write', 'actor', 'rbActor', 'expectedHash']);
    if (!ACTOR_ID.test(payload.actor ?? '')) ctx.fail('INVALID', 'An actor id looks like ca_k3f9a2qz.');
    if (!(payload.rbActor === null || RB_ACTOR_ID.test(payload.rbActor ?? ''))) ctx.fail('INVALID', 'rbActor is a character id or null.');
    const { fingerprint, saved } = opened(ctx, 'checks.link', payload, isPlayer(ctx) || isRb(ctx));
    if (saved) return answered(ctx, 'checks.link', saved, saved.actor);
    const policy = policyOf(ctx.read('checks'));
    if (!Object.hasOwn(policy.actors, payload.actor)) ctx.fail('NOT_FOUND', 'That actor is not there.');
    if (payload.rbActor !== null) characterOf(ctx, payload.rbActor);
    stale(ctx, payload);
    const draft = draftChecks(ctx).policy;
    const have = policy.rbActors[payload.actor] ?? null;
    if (payload.rbActor === null) delete draft.rbActors[payload.actor];
    else {
        const owner = Object.entries(policy.rbActors).find(([, target]) => target === payload.rbActor)?.[0] ?? null;
        if (owner !== null && owner !== payload.actor) ctx.fail('CONFLICT', 'That character is already linked to another actor.');
        // The creation never silently relinks a living character; the player may choose another. A link whose character RPG Battle no longer has (stale) is not one.
        if (have !== null && have !== payload.rbActor && isRb(ctx) && !isPlayer(ctx) && linkedIsLive(ctx, have)) ctx.fail('CONFLICT', 'That actor is already linked to another character.');
        draft.rbActors[payload.actor] = payload.rbActor;
    }
    const result = { actor: payload.actor, rbActor: payload.rbActor, hash: projection({ policy: draft }, ctx.settings()).hash };
    return finish(ctx, 'checks.link', payload, fingerprint, result, payload.actor);
}

// ---- the roll ----------------------------------------------------------------------------------------------------------------

function ask(ctx, name, args) {
    try {
        return { ok: true, value: ctx.query(name, args) ?? null };
    } catch {
        return { ok: false, value: null };
    }
}

/** The evidence a check stands on: the block's own, or a proof the story still shows. */
function knownEvidence(ctx, id) {
    if (ctx.source?.evidence === id) return true;
    const proofs = ask(ctx, 'story.evidence', { ids: [id] }).value;
    return Array.isArray(proofs) && proofs.some(proof => isRecord(proof) && (proof.id === id || proof.source?.evidence === id));
}

function checksRoll(ctx, payload) {
    shape(ctx, 'checks.roll', payload, ['skill', 'evidence']);
    // Capture, the pre-roll (Story Block's assist) and the system; never a click, never a module supplying a die.
    if (ctx.cause === 'ui' || (ctx.caller && ctx.caller !== 'story-block' && ctx.caller !== 'story-director' && ctx.caller !== 'rpg-battle')) ctx.fail('REFUSED', 'A check is rolled by the story\'s capture, not asked for.');
    if (payload.craft !== undefined && !isRb(ctx)) ctx.fail('REFUSED', 'Only RPG Battle supplies a craft recipe.');
    if (payload.craft !== undefined && (!isRecord(payload.craft) || typeof payload.craft.recipe !== 'string' || !payload.craft.recipe || payload.craft.recipe.length > 120 || Object.keys(payload.craft).some(key => !['recipe', 'at'].includes(key)) || (payload.craft.at !== undefined && payload.craft.at !== 'campfire'))) ctx.fail('INVALID', 'A craft check names its recipe and optionally a campfire.');
    if (isRb(ctx) && payload.craft === undefined) ctx.fail('REFUSED', 'RPG Battle only asks for crafting checks.');
    const skill = text(payload.skill);
    if (!skill || skill.length > 80) ctx.fail('INVALID', 'A check has a skill of at most 80 characters.');
    if (payload.stat !== undefined && !['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'].includes(payload.stat)) ctx.fail('INVALID', 'stat is one of STR VIT AGI DEX INT LUK CHA.');
    if (payload.dc !== undefined && !(Number.isSafeInteger(payload.dc) && payload.dc >= 1 && payload.dc <= 40)) ctx.fail('INVALID', 'dc is a whole number from 1 to 40.');
    if (payload.actor !== undefined && !ACTOR_ID.test(payload.actor)) ctx.fail('INVALID', 'An actor id looks like ca_k3f9a2qz.');
    if (payload.targetNpc !== undefined && !/^np_[0-9a-z]{8}$/.test(payload.targetNpc)) ctx.fail('INVALID', 'targetNpc is an NPC identity like np_k3f9a2qz.');
    if (!/^[a-z]{2}_[0-9a-z]{8}$/.test(payload.evidence ?? '')) ctx.fail('INVALID', 'evidence names the proof or the reply the check stands on.');
    const settings = ctx.settings() ?? {};
    const checks = ctx.read('checks');
    const policy = policyOf(checks);
    const actorId = payload.actor ?? policy.defaultActor;
    const actor = actorId === null ? null : policy.actors[actorId] ?? null;
    if (!actor) ctx.fail('NOT_FOUND', payload.actor === undefined ? 'There is no check actor to roll for. Make one with checks.actor { write, name, expectedHash } (the player\'s own setting), or let a character made in RPG Battle make it.' : 'That actor is not there.');
    if (!knownEvidence(ctx, payload.evidence)) ctx.fail('NOT_FOUND', 'No such evidence for this check.');
    // One use per evidence and meaning: the same request twice is the same check, not a second die.
    const stat = statForCheck(skill, payload.stat);
    const dc = payload.dc ?? (Number.isSafeInteger(settings.defaultDc) ? settings.defaultDc : 15);
    const margin = Number.isSafeInteger(settings.costMargin) ? settings.costMargin : 2;
    const request = hashJson({ actor: actorId, stat, skill: skill.toLowerCase(), targetNpc: payload.targetNpc ?? null, dc, ...(payload.craft ? { craft: payload.craft } : {}) });
    // Assist previews the seed for the prompt and commits on the generated reply before its story lines.
    // Its message claim belongs to that reply too; a swipe retracts it and rolls once on the new source.
    // System requests and crafts keep receipt scope: two crafts of one recipe are separate attempts, capped by RB.
    const scope = payload.craft || ctx.cause === 'system' ? `:r${ctx.rev}` : '';
    if (!ctx.claim(`sd:check:${payload.evidence}:${request.slice(0, 16)}${scope}`)) ctx.fail('REFUSED', 'That evidence already made this check.');

    // The target person: unknown is NOT_FOUND; NPC State Delta absent or off adds nothing.
    let target = null;
    if (payload.targetNpc !== undefined) {
        const identity = ask(ctx, 'npc.identity', { id: payload.targetNpc });
        if (identity.ok && identity.value === null) ctx.fail('NOT_FOUND', 'No such person.');
        target = identity.ok && isRecord(identity.value) && typeof identity.value.name === 'string' ? identity.value.name : null;
    }

    let parts;
    let source = 'standalone';
    let fallback = null;
    const rbActor = policy.rbActors[actorId] ?? null;
    if (settings.rbModifiers === false) fallback = 'rb-modifiers-off';
    else if (rbActor === null) fallback = 'no-link';
    else {
        const answer = ask(ctx, 'rules.modifier', { actor: rbActor, stat, skill, ...(payload.craft !== undefined ? { craft: payload.craft } : {}) });
        const given = answer.ok ? rbParts(answer.value, rbActor, stat) : null;
        if (given) {
            parts = given;
            source = 'rb';
        } else fallback = !answer.ok ? 'rb-unavailable' : answer.value === null ? 'rb-no-answer' : 'rb-malformed';
    }
    if (payload.craft !== undefined && !parts) ctx.fail('REFUSED', 'No craft modifier is available from RPG Battle.');
    if (!parts) parts = standaloneParts(actor, stat, skill);
    if (target !== null && settings.social !== false) {
        const social = ask(ctx, 'npc.socialModifier', { name: target, skill });
        parts = [...parts, ...(social.ok ? socialParts(social.value) : [])];
    }
    const { parts: modifiers, mod } = combine(parts);
    const die = ctx.roll('1d20').total;
    const total = die + mod;
    const outcome = outcomeOf(die, mod, dc, margin);
    const log = draftChecks(ctx).log;
    const id = idFrom(ctx, 'ck', log);
    log[id] = { id, actor: actorId, stat, skill, die, modifiers, mod, total, dc, outcome, source, fallback, evidence: payload.evidence };
    for (const key of Object.keys(log).slice(0, Math.max(0, Object.keys(log).length - MAX_LOG))) delete log[key];
    // The contract's result and nothing more; where the modifier came from (`source`, `fallback`) is kept on the log record.
    if (rbActor !== null) {
        try { ctx.call('rules.practiceCheck', { actor: rbActor, skill, check: id }); } catch (error) { if (error?.code !== 'UNKNOWN_COMMAND') throw error; }
    }
    const result = { check: id, actor: actorId, die, modifiers, mod, total, dc, outcome };
    const sign = mod >= 0 ? `+${mod}` : String(mod);
    return {
        summary: `${actor.name} tries ${skill}: d20 ${die} ${sign} = ${total} against ${dc}, ${{ crit: 'a critical success', critfail: 'a critical fail', success: 'success', cost: 'success at a cost', fail: 'a fail' }[outcome]}.`,
        narrate: true,
        data: { v2: { key: `check:${id}`, result } },
    };
}

export const commands = { 'checks.actor': checksActor, 'checks.link': checksLink, 'checks.roll': checksRoll };
