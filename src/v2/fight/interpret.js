// RPG Battle v2, the typed interpreter of a rules-v2 form in a fight (B4: "supply C's target-selection/action projection"; "every effect
// validates its own side/scope; the preview target from the first effect cannot control all effects"; "pay cost/cooldown once before
// effects"). The engine (src/combat.js) calls it only for a skill that carries `parts`; see forms.js for how a form becomes one.
//
//   action   { type: 'form', form: <form id>, id?, selections?: [{ effect: <index>, targets: [<combatant id>] }] }
//   a v1-style { type: 'skill', skill: <name>, target } on a form (the automatic turns): the one target stands for every effect that
//            needs one, on its own side; every other effect takes its default scope
//
// Each effect has its own side, decided by what it does, never by the first effect's target:
//   hostile  damage, a hostile condition (poison burn bleed stun daze slow weaken), a negative stat shift  -> a foe ("one"), every foe ("all")
//   friendly heal, shield, regen, guard, a positive stat shift                                             -> self, one ally, every ally
// The pack's target word maps as v1 mapped it (src/combat.js scopeOf): hostile all/allies -> every foe, otherwise one foe; friendly self ->
// self, allies/all -> every ally, otherwise one ally. A choice of one target must name a legal one; a scope of everyone takes no choice
// (or exactly everyone). An index twice, an index that is no effect, a target of the wrong side, a repeated target, a target that is
// down or gone, a field that is not in the closed record: all refuse, before anything is paid or rolled.
//
// The sums are the engine's own (strike for damage with the actor's gear and stat-substituted attack value, the heal sum with the
// attack value and the per-target variance, the condition strengths): the power is the pack's hundredths with the mastery factor
// 1 + 0.1 x mastery applied once. Cost: the form's mp and sp are paid once, the cooldown set once, the use counted once (under the
// form's id), then the effects run in index order, targets in the fight's order.

import { DEFAULT_RULES, derive } from '../../rules.js';
import { hashJson } from '../rules/hash.js';
import { idFromHash } from '../rules/ids.js';
import { formHooks } from '../../combat.js';
import { addShift, syncShifts } from './shifts.js';

export const HOSTILE_CONDITIONS = Object.freeze(['poison', 'burn', 'bleed', 'stun', 'daze', 'slow', 'weaken']);
export const FRIENDLY_CONDITIONS = Object.freeze(['regen', 'guard']);
/** Rounds a shield lasts (v1's effectRounds.shield), recorded on the condition. */
export const SHIELD_ROUNDS = DEFAULT_RULES.generated.effectRounds.shield;

/** Which side an effect acts on: 'hostile' | 'friendly'. */
export function sideOf(part) {
    if (part.op === 'damage') return 'hostile';
    if (part.op === 'heal' || part.op === 'shield') return 'friendly';
    if (part.op === 'condition') return HOSTILE_CONDITIONS.includes(part.kind) ? 'hostile' : 'friendly';
    if (part.op === 'stat') return part.amount < 0 ? 'hostile' : 'friendly';
    return 'hostile';
}

/** The scope of an effect: 'one' | 'all' (a foe, every foe) or 'self' | 'ally' | 'allies' (yourself, an ally, every ally). */
export function scopeOfPart(part) {
    const word = part.target;
    if (sideOf(part) === 'friendly') return word === 'self' ? 'self' : word === 'allies' || word === 'all' ? 'allies' : 'ally';
    return word === 'all' || word === 'allies' ? 'all' : 'one';
}

const SELECTION_KEYS = ['effect', 'targets'];

function poolFor(scope, view, actor) {
    if (scope === 'self') return [actor];
    if (scope === 'ally' || scope === 'allies') return view.friends;
    return view.foes;
}

/**
 * The picks of an action on a skill: [{ index, part, scope, targets: [combatant] }], one for each effect, in index order. Throws, before
 * anything has changed, when the action is not legal.
 */
export function planForm(f, actor, skill, action, view) {
    const parts = skill.parts;
    const given = new Map();
    if (action.selections !== undefined) {
        if (!Array.isArray(action.selections)) throw new Error('The selections are a list of { effect, targets }.');
        for (const sel of action.selections) {
            if (sel === null || typeof sel !== 'object' || Array.isArray(sel) || Object.keys(sel).some(key => !SELECTION_KEYS.includes(key)) || !SELECTION_KEYS.every(key => Object.hasOwn(sel, key))) {
                throw new Error('A selection is { effect, targets } and nothing else.');
            }
            if (!Number.isInteger(sel.effect) || sel.effect < 0 || sel.effect >= parts.length) throw new Error(`${skill.name} has no effect ${sel.effect}.`);
            if (given.has(sel.effect)) throw new Error(`The effect ${sel.effect} is chosen twice.`);
            if (!Array.isArray(sel.targets) || sel.targets.some(id => typeof id !== 'string')) throw new Error('The targets of an effect are a list of ids.');
            if (new Set(sel.targets).size !== sel.targets.length) throw new Error(`The effect ${sel.effect} names a target twice.`);
            given.set(sel.effect, sel.targets);
        }
    }
    const picks = [];
    parts.forEach((part, index) => {
        const scope = scopeOfPart(part);
        const pool = poolFor(scope, view, actor);
        const named = given.get(index);
        let targets;
        if (scope === 'self') {
            if (named !== undefined && !(named.length === 1 && named[0] === actor.id)) throw new Error(`The effect ${index} acts on ${actor.name} alone.`);
            targets = [actor];
        } else if (scope === 'all' || scope === 'allies') {
            if (named !== undefined && !(named.length === pool.length && pool.every(c => named.includes(c.id)))) throw new Error(`The effect ${index} acts on everyone on its side.`);
            targets = pool;
        } else {
            let id = named === undefined ? action.target ?? null : named.length === 1 ? named[0] : null;
            if (named !== undefined && named.length !== 1) throw new Error(`The effect ${index} takes exactly one target.`);
            // A v1-style single target stands for the effects that need one, on the side it is on; the rest take their default.
            if (named === undefined && id !== null && !pool.some(c => c.id === id)) id = null;
            if (id === null && pool.length === 1) id = pool[0].id;
            if (id === null && scope === 'ally') id = actor.id;
            const target = pool.find(c => c.id === id);
            if (!target) throw new Error(`The effect ${index} of ${skill.name} has no legal target${id ? ` ${id}` : ''}.`);
            targets = [target];
        }
        picks.push({ index, part, scope, targets });
    });
    return picks;
}

/** An effect's power as the sums take it: the pack's hundredths, times the mastery factor (1 + 0.1 x mastery), once. */
const power = (skill, part) => (part.power / 100) * (1 + 0.1 * (skill.formMastery ?? 0));

function synthetic(skill, part, extra = {}) {
    // mastery 1 = factor 1 in the engine's effectivePower: the pack's hundredths and the mastery factor are already in `power`.
    return { name: skill.name, type: part.damageType === 'magic' ? 'magic' : part.damageType === 'physical' ? 'physical' : skill.type === 'magic' ? 'magic' : 'physical', stat: skill.stat, power: power(skill, part), mastery: 1, effect: null, ...extra };
}

/** Plays a plan: pays once, then every effect in index order. */
export function performForm(f, actor, plan, rng, rules, engine) {
    const { skill, picks } = plan;
    const { log, label, isActive, bump, strike, heal, markHurt, addCondition, skillValue, LABELS } = engine;
    // One paid-cost record: both pools, once, before any effect.
    const costs = skill.costs ?? { mp: 0, sp: 0 };
    if (costs.mp) actor.mp.cur -= costs.mp;
    if (costs.sp && actor.sp) actor.sp.cur -= costs.sp;
    skill.cooldownLeft = skill.cooldown ?? 0;
    if (actor.side === 'party') bump(f.stats.uses, actor.memberId, skill.formId);
    const verb = skill.type === 'magic' || (skill.type !== 'physical' && skill.stat === 'INT') ? 'casts' : 'uses';
    log(f, actor, `${label(actor)} ${verb} ${skill.name}.`, 'skill');
    for (const { index, part, targets } of picks) {
        const side = sideOf(part);
        if (part.op === 'damage') {
            for (const target of targets) {
                if (!isActive(target)) continue;
                strike(f, actor, target, synthetic(skill, part), rng, rules);
            }
        } else if (part.op === 'heal') {
            const a = rules.attack;
            const amount = skillValue(actor, synthetic(skill, part, { type: 'heal' }), rules) * power(skill, part);
            for (const target of targets) {
                if (!isActive(target)) continue;
                const gained = heal(f, target, amount * rng.between(a.varianceLow, a.varianceHigh));
                const on = target === actor ? '' : ` on ${label(target)}`;
                log(f, actor, `${label(actor)} ${verb} ${skill.name}${on}: +${gained} HP.`, 'heal');
                markHurt(f, target, rules);
            }
        } else if (part.op === 'shield') {
            const strength = Math.max(1, Math.round(skillValue(actor, synthetic(skill, part, { type: 'buff' }), rules) * power(skill, part) * rules.combat.shield));
            for (const target of targets) {
                if (!isActive(target)) continue;
                addCondition(target, 'shield', SHIELD_ROUNDS, strength);
                const on = target === actor ? '' : ` on ${label(target)}`;
                log(f, actor, `${label(actor)} ${verb} ${skill.name}${on}: shielded (${strength}).`, 'skill');
            }
        } else if (part.op === 'condition') {
            // The strength of a condition comes from its source: the form's first powered effect, else 1.0, at the caster's value.
            const basis = skill.parts.find(other => other.power)?.power ?? 100;
            const given = synthetic(skill, { ...part, power: basis }, { type: side === 'hostile' ? 'debuff' : 'buff' });
            for (const target of targets) {
                if (!isActive(target)) continue;
                if (side === 'hostile' && !rng.chance(engine.hit(f, actor, target, rules))) {
                    log(f, actor, `${label(actor)} ${verb} ${skill.name} on ${label(target)}: it misses.`, 'miss');
                    continue;
                }
                if (part.chance < 100 && !rng.chance(part.chance / 100)) {
                    log(f, actor, `${label(target)} shrugs off ${skill.name}'s ${LABELS[part.kind] ?? part.kind}.`, 'condition');
                    continue;
                }
                const applied = engine.applyEffect(f, actor, target, { ...given, effect: { [part.kind]: part.rounds } }, rules);
                log(f, actor, `${label(target)} is ${applied.join(', ') || 'unaffected'}.`, 'condition');
            }
        } else if (part.op === 'stat') {
            for (const target of targets) {
                if (!isActive(target)) continue;
                if (side === 'hostile' && !rng.chance(engine.hit(f, actor, target, rules))) {
                    log(f, actor, `${label(actor)} ${verb} ${skill.name} on ${label(target)}: it misses.`, 'miss');
                    continue;
                }
                addShift(target, { key: `${actor.id}|${skill.formId}|${index}`, stat: part.stat, amount: part.amount, rounds: part.rounds });
                log(f, actor, `${label(target)}'s ${part.stat} ${part.amount > 0 ? 'rises' : 'falls'} by ${Math.abs(part.amount)} for ${part.rounds} ${part.rounds === 1 ? 'round' : 'rounds'}.`, 'condition');
            }
        }
    }
    if (skill.unit) summon(f, actor, skill, rng, rules, engine);
}

/** How many summoned units a fight holds on the party's side at once (the contract's temporaryLimit). */
export const UNIT_LIMIT = 6;

/**
 * A form that calls a unit (B4: "owner-level/class/template, statShare/poolShare and fight/round expiry are frozen inputs"): after its
 * effects a combatant joins the party's side, built from the caster as it stands and the form's frozen shares. It fights on auto with the
 * class's three base forms, has no gear, earns nothing and carries nothing out of the fight, and does not keep the party standing. Its id
 * is made from the fight and the moment (replayable); at most UNIT_LIMIT stand at once.
 */
function summon(f, actor, skill, rng, rules, engine) {
    const unit = skill.unit;
    const { log, label, join } = engine;
    const standing = f.combatants.filter(c => c.side === 'party' && c.summoned && engine.isActive(c)).length;
    if (standing >= UNIT_LIMIT) {
        log(f, actor, `${label(actor)} cannot call another: ${UNIT_LIMIT} stand already.`, 'info');
        return;
    }
    const id = idFromHash('ac', hashJson({ fight: f.seed, at: f.actions.length, by: actor.id, form: skill.formId, log: f.log.length }));
    if (f.combatants.some(c => c.id === id)) return;
    const share = (value, per) => Math.max(1, Math.round(value * per / 100));
    const stats = Object.fromEntries(Object.entries(actor.stats).map(([name, value]) => [name, share(value, unit.statShare)]));
    const pools = Object.fromEntries(['hp', 'mp', 'sp'].map(name => {
        const max = actor[name] ? (name === 'hp' ? share(actor[name].max, unit.poolShare) : Math.round(actor[name].max * unit.poolShare / 100)) : 0;
        return [name, { cur: max, max }];
    }));
    const c = {
        id, memberId: id, name: unit.name, side: 'party', controller: 'auto', level: actor.level, rank: null, role: null, boss: false,
        stats, ...pools, ...derive(stats, {}, rules), skills: structuredClone(unit.skills), items: [], conditions: [], morale: 0, talks: false,
        fleesBelow: 0, xp: 0, loot: null, gone: null, capped: [], onHit: [],
        summoned: { owner: actor.id, kind: unit.kind, form: skill.formId, class: unit.class, until: f.round + unit.rounds },
    };
    join(f, c, rng);
    log(f, actor, `${label(actor)} calls ${unit.name}.`, 'skill', true);
}

/** A unit whose rounds are out is gone ('expired'); called at the start and end of every turn with the fight. */
function expireUnits(actor, f) {
    if (!f || !actor.summoned || actor.gone || f.round < actor.summoned.until) return;
    actor.gone = 'expired';
    actor.conditions = [];
    f.log.push({ round: f.round, actor: actor.id, text: `${actor.name} fades.`, kind: 'info', important: false });
}

/** What a screen needs to choose the targets of a form: one row per effect with its side, scope and legal targets. */
export function describeForm(fight, actor, skill) {
    const view = {
        foes: fight.combatants.filter(c => c.side !== actor.side && !c.gone && c.hp.cur > 0),
        friends: fight.combatants.filter(c => c.side === actor.side && !c.gone && c.hp.cur > 0),
    };
    return {
        id: skill.formId,
        skill: skill.skillId,
        effects: skill.parts.map((part, index) => {
            const scope = scopeOfPart(part);
            return { index, op: part.op, side: sideOf(part), scope, choose: scope === 'one' || scope === 'ally', legal: poolFor(scope, view, actor).map(c => c.id) };
        }),
    };
}

/** Registers the interpreter with the engine. Idempotent. */
export function installFormHooks() {
    formHooks.plan = planForm;
    formHooks.perform = performForm;
    formHooks.describe = describeForm;
    formHooks.shifts = (actor, rules, f) => { syncShifts(actor, rules); expireUnits(actor, f); };
}
installFormHooks();
