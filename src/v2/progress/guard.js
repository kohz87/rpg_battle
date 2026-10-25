// RPG Battle v2, the replay guards of progression (contract §6 P12, B5). What a choice or a credit depended on is
// not in the host's ops, so every block that depends on something attaches a guard (`ctx.replayGuard`) and the
// host asks `hooks.replayGuard` below, on the state *before* the block, whenever the chat is replayed: after a
// swipe, a delete, a Re-read or a reload. The block is applied, with its claims, only if it is **still earned**;
// otherwise it stays stored but off (REPLAY_PREREQUISITE) and nothing is substituted. If the deleted reply gave
// the XP a promotion needed, or the use that made a skill 5/5, the promotion is off, and so is every choice
// after it; if the prerequisite comes back (a Re-read, a new swipe) the block is asked again and comes back too.
//
// Three kinds of guard (predicate.kind):
//   * `class.choose` and `path.choose`: the player's choices. inputs = the facts the choice depended on
//     (offers.js evaluateClass / evaluatePath): the earlier class and the skills held, that the level was
//     reached, that it was the oldest milestone, that the skills were 5/5, the form it was taken from. Not the
//     raw level or uses: a level that moved without crossing the milestone does not undo the choice.
//   * `rules.settle`: the host's credits. inputs = the whole settlement (which attempts and what each earned, on
//     which day). When the settlement planned on the state before it is another one (an earlier use was
//     deleted, the clock moved) the stored block no longer holds, and the host plans the step again at its
//     place (it asked for `replan`), so a zero-credit can become a credit and a credit a zero.
//
// Guard.inputHash is the contract's (B5): SHA-256 of the normalised { version, operation, source, rulesHash,
// epoch, inputs, proofs }. `operation` is this command's own type and payload (it is also the predicate, so the
// hook recomputes from the guard alone, whatever root the command ran under), `source` the reply's canonical
// { sid, swipeKey } (never the ordinal, which a block planned again gets anew). Pure apart from `hash`.

import { assess } from './assess.js';
import { indexOfState } from '../rules/graph.js';
import { epochOf } from '../rules/ids.js';

export const GUARD_KINDS = Object.freeze(['check.practice', 'class.choose', 'path.choose', 'rules.settle', 'party.setActive', 'summon.end', 'class.start', 'skill.use', 'rescue.use', 'skill.train', 'skill.cancelTrain', 'rules.flagSet', 'rules.registerItem', 'combat.start', 'combat.act', 'combat.end']);
/** What a block the guard turned off says (contract C14: REPLAY_PREREQUISITE, "The earlier prerequisite was removed."). */
export const PREREQUISITE_REMOVED = 'The earlier prerequisite was removed.';

const sourceOf = source => ({ sid: source.sid, swipeKey: source.swipeKey });

/**
 * The Guard of an operation (`hash`: ctx.hash or the hook's): owner = the module that attaches it, `epoch` the epoch it is made in
 * (epochOf(ctx); the replay hook passes the guard's own, after checking it is the state's). **The one helper that builds a guard
 * envelope** (B5): every track that guards a block (the quests' settlement included) imports this, so `source` and the rest hash
 * identically.
 */
export function buildGuard({ hash, owner, epoch, source, rulesHash, kind, payload, inputs }) {
    const inputHash = hash({ version: 2, operation: { type: kind, payload }, source: sourceOf(source), rulesHash, epoch, inputs, proofs: [] });
    return { owner, version: 2, epoch, rulesHash, inputHash, predicate: { kind, payload } };
}

/** Attaches the guard of a command's block to its transaction: `inputs` are the facts the block depended on. */
export function attachGuard(ctx, ix, kind, payload, inputs, recorded) {
    const source = ctx.source ?? ctx.fail('FAILED', 'There is no reply yet to hold this.');
    ctx.replayGuard(buildGuard({ hash: value => ctx.hash(value), owner: ctx.module, epoch: epochOf(ctx), source, rulesHash: ix.rulesHash, kind, payload, inputs }), recorded);
}

/**
 * Like attachGuard, for a nested step whose root may already carry the guard of another operation (a loot item registered inside
 * combat.end): the root's guard binds the whole block, this step goes with it, so a second guard is simply not attached.
 */
export function attachIfFree(ctx, ix, kind, payload, inputs, recorded) {
    try {
        attachGuard(ctx, ix, kind, payload, inputs, recorded);
    } catch (error) {
        if (error?.code !== 'CONFLICT') throw error;
    }
}

/**
 * hooks.replayGuard({ state, query, hash }, { guard, source, … }) → { ok } | { ok: false, reason } | undefined.
 * undefined for a guard that is not this file's (another part may answer); the host fails closed on no answer.
 */
export function replayGuard({ state, query: asked, hash }, info) {
    // Story Block answers a guard only the queries its owner lists as replay-safe (REPLAY.md): the story clock is read as data from the state
    // (Story Director's `director.time`), and what else a guard needs from outside (the place, the purse) was recorded when the block was planned.
    const query = (name, args) => (name === 'director.time' ? (state?.domains?.director?.time ?? null) : asked(name, args));
    const guard = info?.guard;
    const kind = guard?.predicate?.kind;
    if (!GUARD_KINDS.includes(kind)) return undefined;
    const off = detail => ({ ok: false, reason: detail ? `${PREREQUISITE_REMOVED} ${detail}` : PREREQUISITE_REMOVED });
    const ix = indexOfState(state);
    if (!ix) return { ok: false, reason: 'No rules are pinned in this chat, so this cannot be checked.' };
    if (guard.version !== 2 || guard.rulesHash !== ix.rulesHash) return { ok: false, reason: 'It was made under other rules than the ones this chat runs.' };
    if (guard.epoch !== epochOf(state)) return { ok: false, reason: 'It was made in another epoch than the one this chat is in.' };
    const progress = state?.domains?.progress;
    if (!progress || typeof progress !== 'object') return off('');
    const payload = guard.predicate.payload;
    if (payload === null || typeof payload !== 'object') return off('');
    const answer = assess(kind, { ix, progress, training: state?.domains?.training, rules: state?.domains?.rules, combat: state?.domains?.combat, query, recorded: info.recorded ?? null }, payload, { source: info.source, hash, event: info.recorded?.event, recorded: info.recorded });
    if (!answer.ok) return off(answer.why);
    const expected = buildGuard({ hash, owner: guard.owner, epoch: guard.epoch, source: info.source, rulesHash: ix.rulesHash, kind, payload, inputs: answer.inputs });
    return expected.inputHash === guard.inputHash ? { ok: true } : off('');
}
