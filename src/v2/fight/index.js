// RPG Battle v2, a fight on a pinned ruleset (contract §3/§5/§10 B; B4/B5): the entry points the v2 combat part calls, and nothing else
// of it changes. A chat with no pinned ruleset never reaches any of this beyond the one question "is there a pin" (`pinnedOf`), so its
// fights are exactly what they were (tests/v2/fight/engine-unchanged.test.js, legacy.test.js).
//
//   pinnedOf(ctx)                    the pinned index or null
//   fightSkills(ctx, ix, actor)      the fighter's three skills at their current forms and mastery, as the engine's skills
//   pinnedSetup(ctx, setup)          the fight's setup with its ruleset and the rule that its draws belong to its actions
//   actionWithId(ctx, session, action)   an action of a pinned fight gets its id (from the receipt's seed, same on replay)
//   guardAction(ctx, session, action)    the replay guard of combat.act: the prefix this action stands on
//   lootProblem(ctx, def)            null, or why a new loot item cannot be registered under the pin (the drop is held, never a failed end)
//   guardStart(ctx, ...)             the replay guard of combat.start: the offer and the forms each fighter took in
//   settleEnd(ctx, ...)              combat.end on a pinned fight: the guard, the paid uses, the sealed result
//   cleanSelections / actionProblems closed shapes

import './interpret.js';
import { indexOfCtx } from '../rules/graph.js';
import { areaNow, areaPolicyNow, plainRule, registrable } from '../rules/items.js';
import { defineItem } from '../items/define.js';
import { formSkill } from './forms.js';
import { foeToEngine, foeVariant } from './foes.js';
import { attachGuard } from '../progress/guard.js';
import { recordCombatUses } from '../progress/record.js';
import { buildAct, buildEnd, buildStart, fightForms } from './guards.js';
import { batchBytes, seal, withDraws, MAX_BATCHES } from './batch.js';
import { playStored, rebuild } from '../combat/view.js';
import { fightRules, unpackSetup } from '../combat/stored.js';
import { replay } from '../../combat.js';
import { DEFAULT_RULES } from '../../rules.js';
import { guardFightEnd } from '../death/guard.js';

export { actionProblems, isActionId } from './records.js';
export { resolveBatch } from './batch.js';

/** The pinned index of a chat, or null: a chat that runs no ruleset (or has no `rules` domain registered at all). */
export const pinnedOf = indexOfCtx;

/**
 * Why a loot drop's new definition cannot be registered under the pin right now, or null when it can (nothing to say in a chat with no
 * pin). The drop is then held back with the others the party cannot take, because a refusal inside the grant would fail the fight's whole
 * end: nothing inside combat.end may fail on a loot item. It asks the question rules.registerItem asks (`registrable`) of the def as
 * Story Block's item.define hook will price it (the money scale included), on the area as it stands now.
 * → null | { reason: 'equipment' | 'no-tier' | 'rules', why }.
 */
export function lootProblem(ctx, def) {
    const ix = pinnedOf(ctx);
    if (!ix) return null;
    const area = areaNow((name, args) => ctx.query(name, args));
    // The def as the hook leaves it: Story Block hands it { note: '', owner: 'party', scale }, merges what comes back, and a piece never stacks.
    const priced = structuredClone(def);
    Object.assign(priced, defineItem(structuredClone(def), { note: '', owner: 'party', scale: area.scale, settings: ctx.settings() }));
    if (priced.kind === 'equipment') priced.stack = false;
    const rule = plainRule(priced);
    if (rule === null) return { reason: 'equipment', why: 'A piece of gear needs its slots and hands from the rules; loot cannot give them yet.' };
    if (area.tier === null) return { reason: 'no-tier', why: 'The place has no danger tier, so nothing can be bounded.' };
    const answer = registrable({ ix, rules: ctx.read('rules') }, { def: priced, rule, template: null, area });
    return answer.ok ? null : { reason: 'rules', why: answer.why };
}

/** The fighter's skills as the engine's: its class's three, at their current forms, mastery from the credited uses; null for a stranger to the rules. */
export function fightSkills(ctx, ix, actor) {
    let progress = null;
    try { progress = ctx.read('progress'); } catch { progress = null; }
    const forms = fightForms(ix, progress, actor);
    return forms ? forms.map(({ form, mastery }) => formSkill(ix.form(form), mastery, ix)) : null;
}

/**
 * The replay guard of combat.start (pinned chats): the offer is still there and each fighter holds the forms, at the mastery, the
 * fight is begun with. Taking back a promotion or the use that gave a mastery turns the start off, and the acts and the end with it.
 */
export function guardStart(ctx, { offer, fight, setup }) {
    const ix = pinnedOf(ctx);
    if (!ix) return;
    const payload = { fight, offer, party: setup.party.map(c => c.memberId ?? c.id) };
    const asked = buildStart({ ix, combat: ctx.read('combat'), progress: ctx.read('progress') }, payload);
    if (!asked.ok) ctx.fail(asked.code, asked.why);
    attachGuard(ctx, ix, 'combat.start', payload, asked.inputs);
}

/**
 * A regeneration a fight left on a character keeps its strength (B4: "Shields/regeneration retain resolved strength from their source"):
 * the party record keeps the kind and the rounds only, so the strength is read back from `progress.carried[actor]`, which every fight's
 * end replaces for the members it had, as long as it had at least as many rounds then as the record has now. A regeneration that
 * no fight left (the story gave it) acts as the engine's damage-over-time default does: a share of the character's maximum HP, never
 * nothing. A combatant's conditions are changed in place.
 */
export function restoreStrengths(ctx, combatant, rules = DEFAULT_RULES) {
    const regen = combatant.conditions.find(cond => cond.name === 'regen' && !(cond.power > 0));
    if (!regen) return;
    let carried = null;
    try { carried = ctx.read('progress')?.carried?.[combatant.memberId]; } catch { carried = null; }
    const kept = (carried ?? []).find(item => item.kind === 'regenerating' && item.strength > 0 && item.rounds >= regen.rounds);
    regen.power = kept ? kept.strength : Math.max(1, Math.round(combatant.hp.max * rules.combat.dotMaxHpShare));
}

/**
 * The stored setup of a pinned fight: it names its ruleset, draws by action and levels by the pin's xpPerLevel (the foes' XP is a share of
 * a level, fightRules reads `xpBase` when the setup has it; a v1 setup has none and is unchanged).
 */
export function pinnedSetup(ctx, setup, offer = null) {
    const ix = pinnedOf(ctx);
    if (!ix) return setup;
    // `autoRule`: Auto plays each unmastered form once; fights stored before it was written have none and play as they did. An offer records the rule it was made with
    // (`offer.autoRule`, written at capture); one made before that field has its stored opposition's, and one with neither (recorded on 2.2.0) none. No offer: the rule of today.
    const practice = offer?.autoRule !== undefined ? offer.autoRule === 'practice'
        : offer?.opposition ? offer.opposition.autoRule === 'practice'
            : !offer;
    const { autoRule: _kept, ...rest } = setup;
    const pinned = { ...rest, ruleset: ix.rulesHash, draws: 'action', xpBase: ix.constants.xpPerLevel, ...(practice ? { autoRule: 'practice' } : {}) };
    // New offers own their resolved foes. Old offers deliberately keep the adapter they used.
    if (offer?.opposition) {
        const { enemies, waves = [], area } = unpackSetup(structuredClone(offer.opposition));
        return { ...pinned, enemies, waves, area };
    }
    return packFoes(ctx, ix, pinned, offer);
}

/**
 * A foe the offer names that the ruleset's pack wrote up is fought as the pack wrote it (fight/foes.js), as far as the place allows:
 * only where Story Director gives the place a tier (`world.areaTier`), and only a foe the area's level ceiling and allowlists let in. Any other
 * foe (no tier, not allowed, not in the pack) stays what the v1 projection made of it, so a fight never fails to start for want of one.
 * The foe keeps its id, its letter ("Wolf A"), its wave and its row's threat word.
 */
export function packFoes(ctx, ix, setup, offer = null) {
    const area = offer?.area ?? areaPolicyNow((name, args) => ctx.query(name, args));
    const rules = fightRules(setup);
    const swap = enemy => {
        const binding = offer?.foes?.find(row => row.name === (enemy.questName ?? enemy.name));
        if (binding?.variant) {
            const made = foeVariant(ix.foe(binding.variant.base), binding.variant.name, area);
            if (!made.ok) return ctx.fail(made.code, made.why);
            const adapted = foeToEngine(made.foe, { rules, forms: ix, items: ref => ix.itemDef(ref), area, ordinal: Number(String(enemy.id).slice(3)) });
            if (!adapted.ok) return ctx.fail(adapted.code, adapted.why);
            return { ...adapted.enemy, foeRef: made.foe.id, id: enemy.id, name: enemy.name,
                ...(enemy.questName ? { questName: enemy.questName } : {}), ...(enemy.wave ? { wave: enemy.wave } : {}), ...(enemy.threat ? { threat: enemy.threat } : {}) };
        }

        // An offer's foe that names a ref is that foe (an unknown ref is none); one that names only a name is the pack's one foe of that name.
        const foe = typeof enemy.ref === 'string' ? ix.foe(enemy.ref) : ix.foeNamed(enemy.questName ?? enemy.name);
        enemy = { ...enemy, foeRef: foe?.id ?? null };
        const ordinal = Number(String(enemy.id).slice(3));
        if (!foe || !Number.isInteger(ordinal) || area.tier === null) return enemy;
        // A fight always starts: whatever the adapter cannot do, the foe stays what the v1 projection made of it.
        try {
            const made = foeToEngine(foe, { rules, forms: ix, items: ref => ix.itemDef(ref), area, ordinal });
            if (!made.ok) return enemy;
            return { ...made.enemy, foeRef: foe.id, id: enemy.id, name: enemy.name, ...(enemy.questName ? { questName: enemy.questName } : {}), ...(enemy.wave ? { wave: enemy.wave } : {}), ...(enemy.threat ? { threat: enemy.threat } : {}) };
        } catch {
            return enemy;
        }
    };
    return {
        ...setup,
        ...(offer?.area ? { area: structuredClone(area) } : {}),
        enemies: setup.enemies.map(swap),
        ...(setup.waves ? { waves: setup.waves.map(wave => ({ ...wave, enemies: wave.enemies.map(swap) })) } : {}),
    };
}

/** Bind the capture's literal foe names to pinned records. A like label binds one variant name only. */
export function bindEncounter(ctx, rows, like) {
    const ix = pinnedOf(ctx);
    if (!ix || like === undefined) return null;
    const area = areaPolicyNow(ctx.query);
    if (typeof like !== 'string' || !like.trim() || new Set(rows.map(row => row.name)).size !== 1) return ctx.fail('FOE', 'like binds exactly one variant name to one pack foe slug.');
    const base = Object.values(ctx.read('rules').pin.resolved.foes).find(foe => foe.id === like || foe.slug === like);
    if (!base) return ctx.fail('FOE', 'The variant needs an explicit frozen base foe slug.');
    const foes = rows.map(row => {
        const made = foeVariant(base, row.name, area);
        if (!made.ok) return ctx.fail(made.code, made.why);
        const checked = foeToEngine(made.foe, { rules: DEFAULT_RULES, forms: ix, items: ref => ix.itemDef(ref), area, ordinal: 1 });
        if (!checked.ok) return ctx.fail(checked.code, checked.why);
        return { ...row, ref: made.foe.id, variant: { base: base.id, name: row.name } };
    });
    return { foes, area };
}

/** Whether a stored fight is one on a pinned ruleset: the fight decides, not the chat's pin of the moment (a session begun before the pin is v1's). */
export const pinnedFight = session => session?.setup?.draws === 'action';
const drawsByAction = pinnedFight;

/**
 * An action of a pinned fight with its id (a caller's `id` is never kept). An action of any other fight is v1's: a form means nothing
 * there (null), and an id, a form or selections a caller sent are not kept, so a stored v1 action is what it always was.
 */
export function actionWithId(ctx, session, action) {
    if (drawsByAction(session)) {
        const { id: _ignored, ...kept } = action;
        return { ...kept, id: ctx.id('ca') };
    }
    if (action.type === 'form') return null;
    const { id: _id, form: _form, selections: _selections, ...v1 } = action;
    return v1;
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
        ctx.call('summon.begin', { actor: c.id, owner: c.summoned.owner, kind: c.summoned.kind, template: c.summoned.class, fight: session.id, name: c.name, level: c.level, standing: after.combatants.filter(other => other.summoned && other.side === 'party' && other.hp.cur > 0 && !other.gone).length, hp: { ...c.hp }, mp: { ...c.mp }, sp: { ...c.sp } });
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
    if (!ix || !pinnedFight(session)) return null;
    const asked = buildEnd({ ix, combat: ctx.read('combat'), query: (name, args) => ctx.query(name, args) }, { session: session.id });
    if (!asked.ok) ctx.fail('REFUSED', asked.why);
    // The area is read now and kept with the block; a replay reads it from the record (Story Block answers a guard no query of Story Director's).
    if (!guardFightEnd(ctx, ix, { session: session.id }, { area: asked.inputs.area }))
        attachGuard(ctx, ix, 'combat.end', { session: session.id }, asked.inputs, { area: asked.inputs.area });
    // The fight's units lose their combat sheets; one that went down or ran out ends, one still standing stays as a narrative presence.
    const units = fight.combatants.filter(c => c.summoned).map(c => ({ actor: c.id, reason: c.gone === 'expired' ? 'expired' : c.gone === 'down' || c.hp.cur <= 0 ? 'downed' : null }));
    if (units.length) ctx.call('summon.settle', { fight: session.id, units });
    // Only the party's own members earn mastery or are written into the result: a summoned unit or a pet is not one of them.
    const members = new Set(unpackSetup(session.setup).party.map(c => c.memberId ?? c.id));
    const mine = { ...result, uses: Object.fromEntries(Object.entries(result.uses ?? {}).filter(([actor]) => members.has(actor))) };
    const uses = [];
    for (const [actor, byForm] of Object.entries(mine.uses)) {
        for (const [form, count] of Object.entries(byForm ?? {})) {
            const known = ix.form(form);
            if (known && count > 0) uses.push({ actor, skill: known.skill, form, count });
        }
    }
    if (uses.length) recordCombatUses(ctx, { fight: session.id, uses });
    const bytes = withDraws(batchBytes({ fight, session, result: mine, ix, at }), drawEnds(session));
    const sealed = seal(bytes);
    const id = ctx.id('br');
    storeBatch(ctx, id, sealed);
    const progress = ctx.draft('progress');
    // What each member carries out (a regeneration's strength: the party record keeps the kind and the rounds only) replaces what the last
    // fight left for that member.
    progress.carried ??= {};
    for (const member of bytes.party) {
        const kept = member.conditions.filter(item => item.strength > 0).map(({ kind, rounds, strength }) => ({ kind, rounds, strength }));
        if (kept.length) progress.carried[member.actor] = kept;
        else delete progress.carried[member.actor];
    }
    return { batch: { id, hash: sealed.hash } };
}

/**
 * Writes a sealed result under its id, once: an id that is taken is a CONFLICT (a sealed result is never written over), and the newest
 * MAX_BATCHES results of fights are kept; a result of another kind (a death or a return, B6) is never pruned.
 */
export function storeBatch(ctx, id, sealed) {
    const batches = (ctx.draft('progress').batches ??= {});
    if (Object.hasOwn(batches, id)) ctx.fail('CONFLICT', 'A sealed result is never written over: that id is taken.');
    const seqs = Object.values(batches).map(entry => entry.seq);
    batches[id] = { ...sealed, seq: seqs.length ? Math.max(...seqs) + 1 : 1 };
    const fights = Object.keys(batches).filter(key => (batches[key].bytes?.kind ?? 'fight') === 'fight').sort((a, b) => batches[a].seq - batches[b].seq);
    for (const key of fights.slice(0, Math.max(0, fights.length - MAX_BATCHES))) delete batches[key];
}

export { rebuild };
