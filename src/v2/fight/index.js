// RPG Battle v2, a fight on a pinned ruleset (contract §3/§5/§10 B; B4/B5): the entry points the v2 combat part calls, and nothing else
// of it changes. A chat with no pinned ruleset never reaches any of this beyond the one question "is there a pin" (`pinnedOf`), so its
// fights are exactly what they were (tests/v2/fight/engine-unchanged.test.js, legacy.test.js).
//
//   pinnedOf(ctx)                    the pinned index or null
//   fightSkills(ctx, ix, actor)      the fighter's three skills at their current forms and mastery, as the engine's skills
//   pinnedSetup(ctx, setup)          the fight's setup with its ruleset and the rule that its draws belong to its actions
//   actionWithId(ctx, session, action)   an action of a pinned fight gets its id (from the receipt's seed, same on replay)
//   guardAction(ctx, session, action)    the replay guard of combat.act: the prefix this action stands on
//   lootHeld(ctx, def)               whether a new loot item cannot be registered under the pin (the drop is left behind, never a failed end)
//   settleEnd(ctx, ...)              combat.end on a pinned fight: the guard, the paid uses, the sealed result
//   cleanSelections / actionProblems closed shapes

import './interpret.js';
import { indexOf } from '../rules/graph.js';
import { pinOf } from '../rules/pin.js';
import { choicesOf, deriveActor, skillViews } from '../progress/derive.js';
import { formSkill } from './forms.js';
import { attachGuard } from '../progress/guard.js';
import { recordCombatUses } from '../progress/record.js';
import { boundProblems } from '../rules/bounds.js';
import { areaNow } from '../rules/items.js';
import { buildEnd, buildAct } from './guards.js';
import { batchBytes, seal, withDraws, MAX_BATCHES } from './batch.js';
import { playStored, rebuild } from '../combat/view.js';
import { fightRules, unpackSetup } from '../combat/stored.js';
import { replay } from '../../combat.js';

export { actionProblems, isActionId } from './records.js';
export { resolveBatch } from './batch.js';

/** The pinned index of a chat, or null: a chat that runs no ruleset (or has no `rules` domain registered at all). */
export function pinnedOf(ctx) {
    let rules = null;
    try { rules = ctx.read('rules'); } catch { rules = null; }
    return rules ? indexOf(pinOf({ domains: { rules } })) : null;
}

/**
 * Whether a loot drop's new definition cannot be registered under the pin right now: equipment (its slots and hands wait for track A's
 * slot routing: docs/dev/progress.md), an item over the place's bounds, or a place with no tier. The drop is then left behind with the
 * others the party cannot take, because a refused registration inside the grant would fail the fight's whole end.
 * (The value the item.define hook gives it is checked at registration, not here.) False in a chat with no pin.
 */
export function lootHeld(ctx, def) {
    if (!pinnedOf(ctx)) return false;
    if (def.kind === 'equipment') return true;
    return boundProblems(def, areaNow((name, args) => ctx.query(name, args))).length > 0;
}

/** The fighter's skills as the engine's: its class's three, at their current forms, mastery from the credited uses; null for a stranger to the rules. */
export function fightSkills(ctx, ix, actor) {
    let progress = null;
    try { progress = ctx.read('progress'); } catch { progress = null; }
    if (!progress) return null;
    const derived = deriveActor(ix, choicesOf(progress, actor));
    if (derived.class === null) return null;
    return skillViews(ix, derived, progress, actor).map(view => formSkill(ix.form(view.form), view.mastery, ix));
}

/**
 * A regeneration a fight left on a character keeps its strength (B4: "Shields/regeneration retain resolved strength from their source"):
 * the party record keeps the kind and the rounds only, so the strength is read back from the newest sealed result that recorded one for
 * the character, as long as it had at least as many rounds then as the record has now. A combatant's conditions are changed in place.
 */
export function restoreStrengths(ctx, combatant) {
    const regen = combatant.conditions.find(cond => cond.name === 'regen' && !(cond.power > 0));
    if (!regen) return;
    let batches = null;
    try { batches = ctx.read('progress')?.batches; } catch { batches = null; }
    const newest = Object.values(batches ?? {}).sort((a, b) => b.seq - a.seq);
    for (const entry of newest) {
        const member = entry.bytes?.party?.find(item => item.actor === combatant.memberId);
        const kept = member?.conditions?.find(item => item.kind === 'regenerating' && item.strength > 0 && item.rounds >= regen.rounds);
        if (kept) {
            regen.power = kept.strength;
            return;
        }
    }
}

/** The stored setup of a pinned fight: it names its ruleset and draws by action. */
export function pinnedSetup(ctx, setup) {
    const ix = pinnedOf(ctx);
    return ix ? { ...setup, ruleset: ix.rulesHash, draws: 'action' } : setup;
}

const drawsByAction = session => session?.setup?.draws === 'action';

/** An action of a pinned fight with its id (a caller's `id` is never kept); any other fight's action as it was. */
export function actionWithId(ctx, session, action) {
    if (!drawsByAction(session)) return action;
    const { id: _ignored, ...rest } = action;
    return { ...rest, id: ctx.id('ca') };
}

/** Attaches combat.act's guard (pinned fights only): what the action stands on, and that it can be played. */
export function guardAction(ctx, session, action) {
    const ix = pinnedOf(ctx);
    if (!ix || !drawsByAction(session)) return;
    const asked = buildAct({ ix, combat: ctx.read('combat') }, { session: session.id, action });
    if (!asked.ok) ctx.fail('REFUSED', asked.why);
    attachGuard(ctx, ix, 'combat.act', { session: session.id, action }, asked.inputs);
}

/** The story minute the receipt stands at (Story Director's clock), or null. */
function storyMinute(ctx) {
    try {
        const now = typeof ctx?.time === 'function' ? ctx.time() : null;
        const minutes = now && typeof now === 'object' ? now.minutes : now;
        return Number.isInteger(minutes) && minutes >= 0 ? minutes : null;
    } catch {
        return null;
    }
}

/** The units a played action called (a combatant on the party's side that is `summoned` and was not in the fight before): their narrative records begin. */
export function beginUnits(ctx, session, before, after) {
    if (!drawsByAction(session)) return;
    for (const c of after.combatants) {
        if (!c.summoned || before.combatants.some(other => other.id === c.id)) continue;
        ctx.call('summon.begin', { actor: c.id, owner: c.summoned.owner, kind: c.summoned.kind, template: c.summoned.class, fight: session.id, name: c.name, level: c.level, hp: { ...c.hp }, mp: { ...c.mp }, sp: { ...c.sp } });
    }
}

/** The end of each action's own random stream, from the fight replayed action by action. */
function drawEnds(session) {
    const setup = unpackSetup(session.setup);
    const rules = fightRules(setup);
    let fight = replay({ setup, actions: [] }, rules);
    const ends = [];
    for (const action of session.actions) {
        try { fight = playStored(fight, action, rules); } catch { break; }
        ends.push(fight.rngState);
    }
    return ends;
}

/**
 * combat.end on a pinned fight, in the end settlement's own transaction (B5: "combat.end alone awards it"): the terminal prefix is bound by
 * a guard, the paid uses go through recordCombatUses, and the result is sealed. → { batch: { id, hash } } | null for a fight that is not pinned.
 * `result` is v1's summary with the loot's money already in the chat's scale. The ending minute is the story clock's (null without one).
 */
export function settleEnd(ctx, { session, fight, result }) {
    const at = storyMinute(ctx);
    const ix = pinnedOf(ctx);
    if (!ix || !drawsByAction(session)) return null;
    const asked = buildEnd({ ix, combat: ctx.read('combat') }, { session: session.id });
    if (!asked.ok) ctx.fail('REFUSED', asked.why);
    attachGuard(ctx, ix, 'combat.end', { session: session.id }, asked.inputs);
    // The fight's units lose their combat sheets; one that went down or ran out ends, one still standing stays as a narrative presence.
    const units = fight.combatants.filter(c => c.summoned).map(c => ({ actor: c.id, reason: c.gone === 'expired' ? 'expired' : c.gone === 'down' || c.hp.cur <= 0 ? 'downed' : null }));
    if (units.length) ctx.call('summon.settle', { fight: session.id, units });
    const uses = [];
    for (const [actor, byForm] of Object.entries(result.uses ?? {})) {
        for (const [form, count] of Object.entries(byForm ?? {})) {
            const known = ix.form(form);
            if (known && count > 0) uses.push({ actor, skill: known.skill, form, count });
        }
    }
    if (uses.length) recordCombatUses(ctx, { fight: session.id, uses });
    const bytes = withDraws(batchBytes({ fight, session, result, ix, at }), drawEnds(session));
    const sealed = seal(bytes);
    const id = ctx.id('br');
    const progress = ctx.draft('progress');
    progress.batches ??= {};
    progress.batches[id] = { ...sealed, seq: Object.keys(progress.batches).length ? Math.max(...Object.values(progress.batches).map(entry => entry.seq)) + 1 : 1 };
    const old = Object.keys(progress.batches).sort((a, b) => progress.batches[a].seq - progress.batches[b].seq);
    for (const key of old.slice(0, Math.max(0, old.length - MAX_BATCHES))) delete progress.batches[key];
    return { batch: { id, hash: sealed.hash } };
}

export { rebuild };
