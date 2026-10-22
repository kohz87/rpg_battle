// The fight: a state machine over plain data. startFight() builds the first state, act() takes
// one player action and runs every automatic turn after it, and summarize() turns a finished
// fight into the result the sheets and the hand-off are built from (DESIGN §5, §7.3, §8).
//
// A fight is stored as its setup plus the player's actions. Every random number comes from one
// seeded generator whose state is saved after each step and resumed from there, so replaying
// the same actions over the same setup reproduces the fight exactly (reload, rollback).
// act() never mutates its argument: it works on a deep copy. Pure.

import { DEFAULT_RULES, clampXpRate, costPool, fleeChance, hitChance, mitigate, parleyChance, xpFactor, xpToNext } from './rules.js';
import { makeRng } from './rng.js';
import { effectivePower } from './skills.js';
import { LOOT_TABLES, rollLoot } from './enemies.js';
import { templateFor } from './templates.js';

const DOTS = ['poison', 'burn', 'bleed'];
const HARMFUL = new Set(['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'daze']);
// Conditions that only make sense inside a fight; the rest may follow the sheet out of it.
const FIGHT_ONLY = new Set(['guard', 'shield', 'stun', 'slow', 'weaken', 'daze']);
const LABELS = {
    poison: 'poisoned', burn: 'burning', bleed: 'bleeding', stun: 'stunned', slow: 'slowed',
    weaken: 'weakened', shield: 'shielded', regen: 'regenerating', guard: 'on guard', daze: 'dazed',
};
// (v2) The stun rule (`setup.stunRule: 'daze'`, RPG Battle v2's fights only): nobody is stunned two
// turns in a row. A stun that lands on someone whose last turn was lost to a stun dazes them
// instead: their next action rolls DAZE_POINTS points lower (to hit, to flee, to talk). A fight
// without the rule (every v1 fight, and v2 fights stored before it) plays exactly as before.
export const DAZE_POINTS = 2;

/**
 * (v2) The one table from the fight's condition names (and the words a story writes for them)
 * to the kinds a v2 party record keeps (MODULES §B1: `poisoned`). Every other condition keeps
 * its own words. Shared by RPG Battle v2's party and combat parts.
 */
export const CONDITION_KINDS = Object.freeze({
    poison: 'poisoned', poisoning: 'poisoned',
    burn: 'burning', burned: 'burning', burnt: 'burning',
    bleed: 'bleeding', bled: 'bleeding',
    stun: 'stunned',
    slow: 'slowed',
    weaken: 'weakened', weak: 'weakened',
    shield: 'shielded',
    regen: 'regenerating', regenerate: 'regenerating',
    guard: 'guarded',
});
// The fight's own names, by the kind a party record keeps ("poisoned" → "poison").
const FIGHT_NAMES = Object.freeze(Object.fromEntries(Object.entries(CONDITION_KINDS)
    .filter(([name]) => Object.hasOwn(LABELS, name)).map(([name, kind]) => [kind, name])));

/** A condition's kind as a v2 party record keeps it: "poison" is "poisoned"; anything else as written. */
export function conditionKind(name) {
    const text = String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 40);
    return CONDITION_KINDS[text.toLowerCase()] ?? text;
}

/**
 * The fight's name for a party record's condition kind ("poisoned" → "poison"), or null for a
 * condition the fight has no rules for (a story's "exhausted", "dead").
 */
export function fightCondition(kind) {
    const key = conditionKind(kind).toLowerCase();
    if (FIGHT_NAMES[key]) return FIGHT_NAMES[key];
    return Object.hasOwn(LABELS, key) ? key : null;
}

// --- small helpers ------------------------------------------------------------------------

const isActive = c => Boolean(c) && !c.gone && c.hp.cur > 0;
const share = c => (c.hp.max > 0 ? c.hp.cur / c.hp.max : 0);
const byId = (f, id) => f.combatants.find(c => c.id === id) ?? null;
const opponents = (f, c) => f.combatants.filter(o => o.side !== c.side && isActive(o));
const allies = (f, c) => f.combatants.filter(o => o.side === c.side && isActive(o));
const has = (c, name) => c.conditions.some(cond => cond.name === name);
// The points a dazed actor's rolls lose this action (0 when not dazed; only the stun rule dazes).
const dazed = c => (has(c, 'daze') ? DAZE_POINTS : 0);
const cap = text => text.charAt(0).toUpperCase() + text.slice(1);
const norm = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const average = list => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);
const lowest = list => [...list].sort((a, b) => share(a) - share(b))[0] ?? null;

// (0.5.33) The creatures holy gear bites harder: by their loot table or their name.
const HALLOWED_FOES = new Set(['undead', 'spirit']);
const hallowedFoe = c => c?.side === 'enemy' && (HALLOWED_FOES.has(c.loot) || HALLOWED_FOES.has(templateFor(c.name)));
// The damage × an actor's holy gear gives against `target` (1 when none or not undead).
const holyFactor = (actor, target, rules) => (actor?.onHit?.includes('holy') && hallowedFoe(target) ? Number(rules.combat.gearEffects?.holy) || 1 : 1);

/** "the Goblin" for an unnamed enemy, the name itself for the party and proper names. */
function label(c) {
    if (c.side !== 'enemy' || c.proper || /^(the|a|an)\s/i.test(c.name)) return c.name;
    return `the ${c.name}`;
}

function log(f, actor, text, kind, important = false) {
    f.log.push({ round: f.round, actor: actor?.id ?? null, text: cap(text), kind, important });
}

function bump(table, key, name, by = 1) {
    if (!key) return;
    table[key] ??= {};
    table[key][name] = (table[key][name] ?? 0) + by;
}

// Healing and buffs land on your own side, everything else on the other, so the five target
// words collapse to five scopes: one foe, all foes, self, one ally, all allies.
function scopeOf(skill) {
    const friendly = skill.type === 'heal' || skill.type === 'buff';
    const t = skill.target;
    if (friendly) return t === 'self' ? 'self' : t === 'allies' || t === 'all' ? 'allies' : 'ally';
    return t === 'all' || t === 'allies' ? 'all' : 'one';
}

function itemScope(item) {
    const damage = item.effect?.damage;
    if (damage) return damage.target === 'all' ? 'all' : 'one';
    return 'ally';
}

function findSkillOf(actor, name) {
    return actor.skills.find(s => norm(s.name) === norm(name)) ?? null;
}

function findItemOf(actor, name) {
    return (actor.items ?? []).find(i => norm(i.name) === norm(name) && i.effect && (Number(i.qty) || 0) > 0) ?? null;
}

/** The pool a skill's cost comes out of for this actor: stamina for a physical skill, else MP. */
function costOf(actor, skill) {
    return actor[costPool(skill)] ?? actor.mp;
}

/** Why a skill cannot be used now, or null. */
function blockReason(actor, skill) {
    if (has(actor, 'stun')) return 'stunned';
    if ((skill.cooldownLeft ?? 0) > 0) return 'cooldown';
    // (0.5.29) A physical skill costs stamina (a monster, with no stamina, pays from MP as before).
    if ((skill.mp ?? 0) > costOf(actor, skill).cur) return costPool(skill) === 'sp' && actor.sp ? 'sp' : 'mp';
    return null;
}

/**
 * The number a skill multiplies. Physical skills scale patk, the rest matk; for a party member
 * a skill keyed to another stat swaps that stat in (an archer's Aimed Shot runs on DEX, not STR),
 * so presets that build DEX or VIT get full use of their skills. Enemies' numbers come straight
 * from the rank table and are used as they are.
 */
function skillValue(actor, skill, rules) {
    const physical = !skill || skill.type === 'physical';
    const base = physical ? actor.patk : actor.matk;
    if (!skill || actor.side === 'enemy') return Math.max(1, base);
    const d = rules.derived;
    const pivot = physical ? 'STR' : 'INT';
    const per = physical ? d.atkPerStr : d.matkPerInt;
    const stat = skill.stat in actor.stats ? skill.stat : pivot;
    return Math.max(1, base + (actor.stats[stat] - actor.stats[pivot]) * per);
}

function normalizeCombatant(c) {
    const out = structuredClone(c);
    out.conditions = (out.conditions ?? []).map(cond => ({
        name: cond.name,
        rounds: Number.isFinite(cond.rounds) && cond.rounds > 0 ? cond.rounds : 3,
        power: Number(cond.power) || 0,
    }));
    out.skills = (out.skills ?? []).map(s => ({ ...s, mastery: s.mastery ?? 1, cooldownLeft: s.cooldownLeft ?? 0 }));
    out.items = (out.items ?? []).map(i => ({ ...i }));
    // A Party member's "control: command" means the player picks its actions.
    out.controller = out.controller === 'command' || out.controller === 'player' ? 'player' : 'auto';
    out.gone = out.hp.cur <= 0 ? 'down' : out.gone ?? null;
    out.memberId = out.memberId ?? (out.side === 'party' ? out.id : null);
    return out;
}

// --- conditions and damage ----------------------------------------------------------------

function addCondition(target, name, rounds, power) {
    const existing = target.conditions.find(cond => cond.name === name);
    if (existing) {
        existing.rounds = Math.max(existing.rounds, rounds);
        existing.power = Math.max(existing.power, power);
    } else {
        target.conditions.push({ name, rounds, power });
    }
}

/** Applies a skill's `effect` to one target; the strength of each condition comes from its source. */
function applyEffect(f, source, target, skill, rules) {
    if (!skill?.effect || !isActive(target)) return [];
    const c = rules.combat;
    const value = skillValue(source, skill, rules);
    const power = effectivePower(skill, skill.mastery, rules);
    const applied = [];
    for (const [written, given] of Object.entries(skill.effect)) {
        if (!LABELS[written] || !(given > 0)) continue;
        // The stun rule: a second stun in a row is a daze, for one turn.
        const daze = written === 'stun' && f.stunRule === 'daze' && Boolean(f.marks.stunned?.[target.id]);
        const name = daze ? 'daze' : written;
        const rounds = daze ? 1 : given;
        let strength = 0;
        if (DOTS.includes(name)) strength = Math.max(1, Math.round(value * c.dot[name]));
        else if (name === 'regen') strength = Math.max(1, Math.round(value * power * c.regen));
        else if (name === 'shield') strength = Math.max(1, Math.round(value * power * c.shield));
        addCondition(target, name, rounds, strength);
        applied.push(name === 'shield' ? `shielded (${strength})` : `${LABELS[name]} (${rounds} ${rounds === 1 ? 'round' : 'rounds'})`);
    }
    return applied;
}

function markHurt(f, c, rules) {
    if (c.side !== 'party' || !isActive(c)) return;
    f.marks.hurt ??= {};
    const low = share(c) <= rules.combat.nearDeath;
    if (low && !f.marks.hurt[c.id]) {
        f.marks.hurt[c.id] = true;
        log(f, c, `${label(c)} is badly hurt (${c.hp.cur}/${c.hp.max} HP).`, 'info', true);
    } else if (!low) {
        f.marks.hurt[c.id] = false;
    }
}

/** HP loss; a target reaching 0 is down. `source` (or `cause`) names the finishing blow. */
function takeDamage(f, target, amount, rules, { source = null, cause = null } = {}) {
    const dealt = Math.min(target.hp.cur, amount);
    target.hp.cur -= dealt;
    f.stats.damageTaken[target.id] = (f.stats.damageTaken[target.id] ?? 0) + dealt;
    if (target.hp.cur > 0) {
        markHurt(f, target, rules);
        return;
    }
    target.hp.cur = 0;
    target.gone = 'down';
    target.conditions = [];
    if (target.side === 'party') log(f, target, `${label(target)} is down.`, 'down', true);
    else if (source) log(f, source, `${label(source)} finishes ${label(target)}.`, 'down', true);
    else log(f, target, `${label(target)} succumbs to ${cause ?? 'its wounds'}.`, 'down', true);
}

/** A shield soaks damage before HP does; returns what got through and what was absorbed. */
function soak(target, amount) {
    const shield = target.conditions.find(cond => cond.name === 'shield');
    if (!shield) return { through: amount, absorbed: 0 };
    const absorbed = Math.min(shield.power, amount);
    shield.power -= absorbed;
    if (shield.power <= 0) target.conditions = target.conditions.filter(cond => cond !== shield);
    return { through: amount - absorbed, absorbed };
}

/**
 * One damaging hit: a physical one rolls to hit, spells never miss; then mitigation, variance,
 * critical, guard and shield, in that order (and always in the same rng order).
 */
function strike(f, actor, target, skill, rng, rules) {
    const a = rules.attack;
    const physical = !skill || skill.type === 'physical';
    const what = skill ? `${label(actor)}'s ${skill.name}` : label(actor);
    if (physical && !rng.chance(hitChance(actor.stats.DEX - dazed(actor), target.stats.AGI, rules))) {
        log(f, actor, `${what} misses ${label(target)}.`, 'miss');
        return false;
    }
    const power = skill ? effectivePower(skill, skill.mastery, rules) : 1;
    let raw = skillValue(actor, skill, rules) * power * holyFactor(actor, target, rules);
    if (has(actor, 'weaken')) raw *= rules.combat.weaken;
    let damage = mitigate(raw, physical ? target.pdef : target.mdef) * rng.between(a.varianceLow, a.varianceHigh);
    const crit = rng.chance(actor.crit);
    if (crit) damage *= a.critMultiplier;
    if (has(target, 'guard')) damage *= a.defendTaken;
    damage = Math.max(1, Math.round(damage));
    const { through, absorbed } = soak(target, damage);
    const soaked = absorbed ? ` (${absorbed} absorbed)` : '';
    let text;
    if (!skill) text = `${label(actor)} hits ${label(target)} for ${through}${soaked}.`;
    else if (skill.type === 'physical') text = `${label(actor)} uses ${skill.name} on ${label(target)} for ${through}${soaked}.`;
    else text = `${label(actor)} casts ${skill.name} on ${label(target)} for ${through}${soaked}.`;
    if (crit) text = `Critical! ${cap(what)} hits ${label(target)} for ${through}${soaked}.`;
    if (!through) text = `${crit ? 'Critical! ' : ''}${cap(what)} hits ${label(target)}, but the shield absorbs it.`;
    log(f, actor, text, crit ? 'crit' : skill ? 'skill' : 'hit', crit);
    takeDamage(f, target, through, rules, { source: actor });
    if (skill?.effect && isActive(target)) {
        const applied = applyEffect(f, actor, target, skill, rules);
        if (applied.length) log(f, actor, `${label(target)} is ${applied.join(', ')}.`, 'condition');
    }
    if (physical) gearOnHit(f, actor, target, skill, rng, rules);
    return true;
}

/**
 * (0.5.33) A physical hit with fire, poison or ice on the actor's gear (`onHit`): a chance each
 * to burn, poison or slow the target, as strong as the hit's attack value. No gear element, no
 * roll, so a fight without such gear rolls as before.
 */
function gearOnHit(f, actor, target, skill, rng, rules) {
    const g = rules.combat.gearEffects;
    if (!g || !actor.onHit?.length) return;
    const applied = [];
    const from = [];
    for (const element of ['fire', 'poison', 'ice']) {
        if (!actor.onHit.includes(element) || !g[element] || !isActive(target)) continue;
        if (!rng.chance(Number(g.chance) || 0)) continue;
        for (const [name, rounds] of Object.entries(g[element])) {
            if (!LABELS[name] || !(rounds > 0)) continue;
            const strength = DOTS.includes(name) ? Math.max(1, Math.round(skillValue(actor, skill, rules) * rules.combat.dot[name])) : 0;
            addCondition(target, name, rounds, strength);
            applied.push(`${LABELS[name]} (${rounds} ${rounds === 1 ? 'round' : 'rounds'})`);
            if (!from.includes(element)) from.push(element);
        }
    }
    if (applied.length) log(f, actor, `${label(target)} is ${applied.join(', ')}, from ${label(actor)}'s ${from.join(' and ')} gear.`, 'condition');
}

function heal(f, target, amount) {
    const gained = Math.min(target.hp.max - target.hp.cur, Math.max(0, Math.round(amount)));
    target.hp.cur += gained;
    return gained;
}

// --- turns and rounds ---------------------------------------------------------------------

function pendingWaves(f) {
    return (f.setup.waves ?? []).map((wave, index) => ({ wave, index })).filter(({ index }) => !f.marks.waves.includes(index));
}

/** Reinforcements due this round join; with nobody left to fight, the next wave comes early. */
function joinWaves(f) {
    const pending = pendingWaves(f);
    let due = pending.filter(({ wave }) => (Number(wave.round) || 1) <= f.round);
    if (!due.length && pending.length && !f.combatants.some(c => c.side === 'enemy' && isActive(c))) {
        const first = Math.min(...pending.map(({ wave }) => Number(wave.round) || 1));
        due = pending.filter(({ wave }) => (Number(wave.round) || 1) === first);
    }
    for (const { wave, index } of due) {
        f.marks.waves.push(index);
        const joined = [];
        for (const enemy of wave.enemies ?? []) {
            const c = normalizeCombatant(enemy);
            while (byId(f, c.id)) c.id = `${c.id}w${index + 1}`;
            c.side = 'enemy';
            c.controller = 'auto';
            f.combatants.push(c);
            joined.push(label(c));
        }
        if (joined.length) log(f, null, `Reinforcements arrive: ${joined.join(', ')}.`, 'info', true);
    }
}

function startRound(f, rng, rules) {
    f.round += 1;
    if (f.round > rules.combat.maxRounds) {
        f.round -= 1;
        f.status = 'fled';
        log(f, null, 'The fight drags on until both sides break off.', 'flee', true);
        return;
    }
    joinWaves(f);
    const i = rules.initiative;
    const rolled = f.combatants
        .map((c, index) => ({ c, index }))
        .filter(({ c }) => isActive(c))
        .map(({ c, index }) => ({ c, index, init: c.stats.AGI * i.perAgi + c.stats.DEX * i.perDex + rng.int(1, i.die) }));
    // Highest first; ties to the party (DESIGN §5.3); slowed fighters act after everyone else.
    rolled.sort((x, y) => (has(x.c, 'slow') - has(y.c, 'slow')) || (y.init - x.init)
        || ((x.c.side === 'party' ? 0 : 1) - (y.c.side === 'party' ? 0 : 1)) || (x.index - y.index));
    f.order = rolled.map(({ c }) => c.id);
    f.turn = 0;
    f.turnStarted = false;
}

// --- the turn timeline (0.5.14) -------------------------------------------------------------
// A fight started with `turns: 'timeline'` has no rounds of one turn each: every fighter waits
// TICK ÷ speed between turns, speed being AGI + the speed offset (halved while slowed), and
// whoever's turn comes up first acts. A fighter twice as fast acts twice as often, with no
// limit. A "round" is the wait of a fighter at the starting stat, kept for waves, the log, the
// fight's length and its seconds. A fight saved before 0.5.14 has no `turns` and keeps rounds.

const TICK = 100;
const PREVIEW_TURNS = 8;

const timeline = f => f.turns === 'timeline';
const speedOf = (f, c) => Math.max(1, (Number(c.stats?.AGI) || 0) + f.speedOffset) * (has(c, 'slow') ? 0.5 : 1);
const waitOf = (f, c) => TICK / speedOf(f, c);
const roundLength = (f, rules) => TICK / Math.max(1, rules.character.startStat + f.speedOffset);

/** Who acts first among `pool` ({ c, next, index }): the soonest, ties to the party, then setup order. */
function soonest(pool) {
    return [...pool].sort((x, y) => (x.next - y.next)
        || ((x.c.side === 'party' ? 0 : 1) - (y.c.side === 'party' ? 0 : 1)) || (x.index - y.index))[0] ?? null;
}

/** A fighter entering the timeline: its first turn after most of one wait (the jitter is the old d6). */
function enterTimeline(f, c, rng) {
    c.next = f.time + waitOf(f, c) * rng.between(0.8, 1);
}

/**
 * The turns ahead, the current fighter first: each fighter's next turn and the ones after it at
 * its present speed, for the turn-order strip (a fighter can appear more than once).
 */
function previewOrder(f, actorId) {
    const pool = f.combatants.map((c, index) => ({ c, index })).filter(({ c }) => isActive(c))
        .map(({ c, index }) => ({ c, index, next: c.id === actorId ? f.time : c.next }));
    const order = [];
    while (order.length < PREVIEW_TURNS && pool.length) {
        const up = soonest(pool);
        order.push(up.c.id);
        up.next += waitOf(f, up.c);
    }
    return order;
}

/**
 * The next fighter on the timeline: time moves to their turn, rounds passed on the way bring
 * their waves (and, with nobody left to fight, the next wave comes at once). Sets f.order with
 * them first, or ends the fight when it has dragged on too long.
 */
function nextOnTimeline(f, rng, rules) {
    const length = roundLength(f, rules);
    const enemiesLeft = f.combatants.some(c => c.side === 'enemy' && isActive(c));
    if (!enemiesLeft && pendingWaves(f).length) {
        // The field is clear: the next round starts now, so the wave can join.
        f.time = Math.max(f.time, f.round * length);
        if (!passRounds(f, f.round + 1, rng, rules)) return;
    }
    const pool = f.combatants.map((c, index) => ({ c, index })).filter(({ c }) => isActive(c))
        .map(({ c, index }) => {
            if (!Number.isFinite(c.next)) enterTimeline(f, c, rng);
            return { c, index, next: c.next };
        });
    const up = soonest(pool);
    if (!up) return;
    f.time = Math.max(f.time, up.next);
    if (!passRounds(f, Math.floor(f.time / length) + 1, rng, rules)) return;
    f.order = previewOrder(f, up.c.id);
    f.turn = 0;
    f.turnStarted = false;
}

/** Counts rounds up to `round`, joining the waves due; false once the fight is broken off. */
function passRounds(f, round, rng, rules) {
    while (f.round < round) {
        f.round += 1;
        if (f.round > rules.combat.maxRounds) {
            f.round -= 1;
            f.status = 'fled';
            log(f, null, 'The fight drags on until both sides break off.', 'flee', true);
            return false;
        }
        const before = new Set(f.combatants.map(c => c.id));
        joinWaves(f);
        for (const c of f.combatants) if (!before.has(c.id)) enterTimeline(f, c, rng);
    }
    return true;
}

/**
 * The start of a combatant's turn: damage and healing over time, guard from the last Defend
 * wears off, every duration counts down. Returns whether the combatant may act.
 */
function beginTurn(f, actor, rng, rules) {
    let stunned = false;
    for (const cond of [...actor.conditions]) {
        if (!isActive(actor)) break;
        if (DOTS.includes(cond.name)) {
            const amount = cond.power || Math.max(1, Math.round(actor.hp.max * rules.combat.dotMaxHpShare));
            const { name } = cond;
            log(f, actor, `${cap(name === 'bleed' ? 'bleeding' : name)} deals ${Math.min(amount, actor.hp.cur)} to ${label(actor)}.`, 'condition');
            takeDamage(f, actor, amount, rules, { cause: name === 'bleed' ? 'bleeding' : name });
        } else if (cond.name === 'regen') {
            const gained = heal(f, actor, cond.power);
            if (gained) log(f, actor, `${label(actor)} regenerates ${gained} HP.`, 'heal');
            markHurt(f, actor, rules);
        } else if (cond.name === 'stun') {
            stunned = true;
        }
        cond.rounds -= 1;
    }
    // Guard is "until your next turn", so it goes now; everything else lasts through this turn.
    actor.conditions = actor.conditions.filter(cond => cond.name !== 'guard' || cond.rounds > 0);
    if (!isActive(actor)) return false;
    // (0.5.29) A little stamina comes back each turn, as breath does.
    if (actor.sp && actor.sp.cur < actor.sp.max) {
        actor.sp.cur = Math.min(actor.sp.max, actor.sp.cur + Math.max(1, Math.round(actor.sp.max * (rules.combat.spPerTurn ?? 0))));
    }
    if (f.stunRule === 'daze') {
        // The stun rule's memory: whose last turn a stun took (the next stun on them is a daze).
        f.marks.stunned ??= {};
        if (stunned) f.marks.stunned[actor.id] = true;
        else delete f.marks.stunned[actor.id];
    }
    if (stunned) {
        log(f, actor, `${label(actor)} is stunned and loses the turn.`, 'condition');
        return false;
    }
    if (has(actor, 'daze')) log(f, actor, `${label(actor)} is dazed (−${DAZE_POINTS} to this action).`, 'condition');
    return true;
}

function endTurn(f, actor, usedSkill) {
    for (const s of actor.skills) if (s.name !== usedSkill && s.cooldownLeft > 0) s.cooldownLeft -= 1;
    actor.conditions = actor.conditions.filter(cond => cond.rounds > 0);
    f.turnStarted = false;
    if (timeline(f)) {
        // Their next turn after one wait at the speed they have now (slowed or not).
        actor.next = f.time + waitOf(f, actor);
        f.order = [];
        f.turn = 0;
        return;
    }
    f.turn += 1;
}

function checkEnd(f) {
    if (f.status !== 'active') return;
    const enemies = f.combatants.some(c => c.side === 'enemy' && isActive(c));
    const party = f.combatants.some(c => c.side === 'party' && isActive(c));
    if (!enemies && !pendingWaves(f).length) {
        f.status = 'victory';
        log(f, null, 'Victory.', 'info');
    } else if (!party) {
        f.status = 'defeat';
        log(f, null, 'Defeat.', 'info');
    }
}

// --- actions ------------------------------------------------------------------------------

function pickOne(f, actor, id, pool, what) {
    if (id == null && pool.length === 1) return pool[0];
    if (id == null && what === 'ally') return actor;
    const target = pool.find(c => c.id === id);
    if (!target) throw new Error(`Invalid target ${id ?? '(none)'} for ${actor.name}.`);
    return target;
}

function targetsFor(f, actor, scope, id) {
    if (scope === 'self') return [actor];
    if (scope === 'all') return opponents(f, actor);
    if (scope === 'allies') return allies(f, actor);
    if (scope === 'ally') return [pickOne(f, actor, id, allies(f, actor), 'ally')];
    return [pickOne(f, actor, id, opponents(f, actor), 'foe')];
}

/** Parley is possible with an enemy that talks, unless it is a boss still above the threshold. */
function canTalkTo(target, rules) {
    return isActive(target) && target.side === 'enemy' && target.talks && !(target.boss && share(target) > rules.boss.noParleyAbove);
}

/** Checks an action and works out its targets; throws when it is not allowed. */
function resolve(f, actor, action, rules) {
    const type = action?.type;
    if (type === 'attack') {
        return { type, targets: targetsFor(f, actor, 'one', action.target) };
    }
    if (type === 'skill') {
        const skill = findSkillOf(actor, action.skill);
        if (!skill) throw new Error(`${actor.name} has no skill ${action.skill}.`);
        const reason = blockReason(actor, skill);
        if (reason) throw new Error(`${skill.name} cannot be used now (${reason}).`);
        return { type, skill, targets: targetsFor(f, actor, scopeOf(skill), action.target) };
    }
    if (type === 'item') {
        const item = findItemOf(actor, action.item);
        if (!item) throw new Error(`${actor.name} has no usable ${action.item}.`);
        return { type, item, targets: targetsFor(f, actor, itemScope(item), action.target) };
    }
    if (type === 'defend') return { type, targets: [actor] };
    if (type === 'flee') return { type, targets: [] };
    if (type === 'parley') {
        if (actor.side !== 'party') throw new Error('Only the party can parley.');
        const target = pickOne(f, actor, action.target, opponents(f, actor).filter(c => canTalkTo(c, rules)), 'foe');
        return { type, targets: [target] };
    }
    throw new Error(`Unknown action ${type}.`);
}

function useSkill(f, actor, skill, targets, rng, rules) {
    costOf(actor, skill).cur -= skill.mp ?? 0;
    skill.cooldownLeft = skill.cooldown ?? 0;
    if (actor.side === 'party') bump(f.stats.uses, actor.memberId, skill.name);
    const verb = skill.type === 'magic' || (skill.type !== 'physical' && skill.stat === 'INT') ? 'casts' : 'uses';
    if (skill.type === 'physical' || skill.type === 'magic') {
        for (const target of targets) if (isActive(target)) strike(f, actor, target, skill, rng, rules);
        return;
    }
    if (skill.type === 'heal') {
        const a = rules.attack;
        const amount = skillValue(actor, skill, rules) * effectivePower(skill, skill.mastery, rules);
        for (const target of targets) {
            const gained = heal(f, target, amount * rng.between(a.varianceLow, a.varianceHigh));
            const applied = applyEffect(f, actor, target, skill, rules);
            const on = target === actor ? '' : ` on ${label(target)}`;
            const extra = applied.length ? `, ${applied.join(', ')}` : '';
            log(f, actor, `${label(actor)} ${verb} ${skill.name}${on}: +${gained} HP${extra}.`, 'heal');
            markHurt(f, target, rules);
        }
        return;
    }
    if (skill.type === 'buff') {
        for (const target of targets) {
            const applied = applyEffect(f, actor, target, skill, rules);
            const on = target === actor ? '' : ` on ${label(target)}`;
            log(f, actor, `${label(actor)} ${verb} ${skill.name}${on}: ${applied.join(', ') || 'no effect'}.`, 'skill');
        }
        return;
    }
    // Debuff: a curse can be shrugged off (the same roll as a hit), and may also hurt.
    for (const target of targets) {
        if (!isActive(target)) continue;
        if (!rng.chance(hitChance(actor.stats.DEX - dazed(actor), target.stats.AGI, rules))) {
            log(f, actor, `${label(actor)} ${verb} ${skill.name} on ${label(target)} — miss.`, 'miss');
            continue;
        }
        if ((skill.power ?? 0) > 0) {
            strike(f, actor, target, { ...skill, type: 'magic', effect: null }, rng, rules);
            if (!isActive(target)) continue;
        }
        const applied = applyEffect(f, actor, target, skill, rules);
        log(f, actor, `${label(actor)} ${verb} ${skill.name} on ${label(target)}: ${applied.join(', ') || 'no effect'}.`, 'condition');
    }
}

function useItem(f, actor, item, targets, rules) {
    item.qty -= 1;
    if (actor.side === 'party') bump(f.stats.itemsUsed, actor.memberId, item.name);
    const e = item.effect ?? {};
    if (e.damage) {
        const parts = [];
        for (const target of targets) {
            if (!isActive(target)) continue;
            let amount = Math.max(0, Math.round(Number(e.damage.amount) || 0));
            if (has(target, 'guard')) amount = Math.round(amount * rules.attack.defendTaken);
            const { through } = soak(target, amount);
            parts.push({ target, through });
        }
        log(f, actor, `${label(actor)} uses ${item.name}: ${parts.map(p => `${p.through} to ${label(p.target)}`).join(', ') || 'no effect'}.`, 'item');
        for (const { target, through } of parts) takeDamage(f, target, through, rules, { source: actor });
        return;
    }
    const target = targets[0] ?? actor;
    const parts = [];
    if (e.heal) parts.push(`+${heal(f, target, Number(e.heal) || 0)} HP`);
    if (e.mp) {
        const gained = Math.min(target.mp.max - target.mp.cur, Math.max(0, Math.round(Number(e.mp) || 0)));
        target.mp.cur += gained;
        parts.push(`+${gained} MP`);
    }
    if (Array.isArray(e.cure) && e.cure.length) {
        const all = e.cure.some(name => norm(name) === 'all');
        const removed = target.conditions.filter(cond => (all ? HARMFUL.has(cond.name) : e.cure.some(name => norm(name) === cond.name)));
        target.conditions = target.conditions.filter(cond => !removed.includes(cond));
        parts.push(removed.length ? `cured of ${removed.map(cond => cond.name).join(', ')}` : 'nothing to cure');
    }
    const on = target === actor ? '' : ` on ${label(target)}`;
    log(f, actor, `${label(actor)} uses ${item.name}${on}: ${parts.join(', ') || 'no effect'}.`, 'item');
    markHurt(f, target, rules);
}

function flee(f, actor, rng, rules) {
    if (actor.side === 'enemy') {
        f.marks.fleeTried[actor.id] = true;
        const partyAgi = average(f.combatants.filter(c => c.side === 'party' && isActive(c)).map(c => c.stats.AGI));
        if (rng.chance(fleeChance(actor.stats.AGI - dazed(actor), partyAgi, {}, rules))) {
            actor.gone = 'fled';
            log(f, actor, `${label(actor)} flees.`, 'flee', true);
        } else {
            log(f, actor, `${label(actor)} tries to flee but cannot get away.`, 'flee');
        }
        return;
    }
    const party = f.combatants.filter(c => c.side === 'party' && isActive(c));
    const daze = dazed(actor) * rules.flee.perAgi;
    if (rng.chance(daze ? Math.max(rules.flee.min, partyFleeChance(f, rules) - daze) : partyFleeChance(f, rules))) {
        f.status = 'fled';
        log(f, actor, party.length > 1 ? 'The party escapes!' : `${label(actor)} escapes!`, 'flee', true);
    } else {
        log(f, actor, `${label(actor)} tries to flee, but the way is blocked.`, 'flee');
    }
}

function partyFleeChance(f, rules) {
    const party = f.combatants.filter(c => c.side === 'party' && isActive(c));
    const enemies = f.combatants.filter(c => c.side === 'enemy' && isActive(c));
    return fleeChance(average(party.map(c => c.stats.AGI)), average(enemies.map(c => c.stats.AGI)), { boss: enemies.some(c => c.boss) }, rules);
}

function parley(f, actor, target, rng, rules) {
    if (rng.chance(parleyChance(actor.stats.CHA - dazed(actor), target.morale, share(target), rules))) {
        target.gone = 'parleyed';
        log(f, actor, `${label(actor)} talks ${label(target)} down; it withdraws.`, 'parley', true);
    } else {
        target.morale += 1;
        log(f, actor, `${label(target)} will not listen to ${label(actor)}.`, 'parley');
    }
}

function perform(f, actor, plan, rng, rules) {
    const a = rules.attack;
    switch (plan.type) {
        case 'attack': strike(f, actor, plan.targets[0], null, rng, rules); break;
        case 'skill': useSkill(f, actor, plan.skill, plan.targets, rng, rules); break;
        case 'item': useItem(f, actor, plan.item, plan.targets, rules); break;
        case 'defend': {
            addCondition(actor, 'guard', 1, 0);
            const back = Math.min(actor.mp.max - actor.mp.cur, Math.max(actor.mp.max > 0 ? 1 : 0, Math.round(actor.mp.max * a.defendMpBack)));
            actor.mp.cur += back;
            // (0.5.29) And a breath caught: stamina back too.
            const breath = actor.sp ? Math.min(actor.sp.max - actor.sp.cur, Math.max(actor.sp.max > 0 ? 1 : 0, Math.round(actor.sp.max * (a.defendSpBack ?? 0)))) : 0;
            if (breath) actor.sp.cur += breath;
            const gained = [back ? `+${back} MP` : '', breath ? `+${breath} SP` : ''].filter(Boolean).join(', ');
            log(f, actor, `${label(actor)} defends${gained ? ` (${gained})` : ''}.`, 'defend');
            break;
        }
        case 'flee': flee(f, actor, rng, rules); break;
        case 'parley': parley(f, actor, plan.targets[0], rng, rules); break;
        default: throw new Error(`Unknown action ${plan.type}.`);
    }
}

// --- automatic turns (DESIGN §7.3) ---------------------------------------------------------

/** How much an attack skill is worth right now: its power over its targets, plus its effects. */
function attackScore(skill, foes, target, rules) {
    const count = scopeOf(skill) === 'all' ? foes.length : 1;
    let score = effectivePower(skill, skill.mastery, rules) * count;
    for (const [name, rounds] of Object.entries(skill.effect ?? {})) {
        const fresh = scopeOf(skill) === 'all' ? foes.some(c => !has(c, name)) : !has(target, name);
        if (!fresh) continue;
        score += DOTS.includes(name) ? 0.15 * rounds : name === 'stun' ? 0.5 : 0.2;
    }
    return score;
}

/**
 * Simple and predictable: flee when broken, heal an ally under the threshold, put up a buff or
 * a curse that is not already there, else the strongest affordable attack skill, else attack
 * the foe with the lowest HP share. The party's auto members use the same rules.
 */
function chooseAuto(f, actor, rules) {
    const foes = opponents(f, actor);
    const friends = allies(f, actor);
    if (!foes.length) return { type: 'defend' };
    if (actor.side === 'enemy' && !actor.boss && actor.fleesBelow > 0 && share(actor) <= actor.fleesBelow && !f.marks.fleeTried[actor.id]) {
        return { type: 'flee' };
    }
    const usable = actor.skills.filter(s => !blockReason(actor, s));
    const best = list => [...list].sort((x, y) => effectivePower(y, y.mastery, rules) - effectivePower(x, x.mastery, rules))[0];

    const hurt = friends.filter(c => share(c) < rules.combat.healBelow).sort((x, y) => share(x) - share(y));
    if (hurt.length) {
        const heals = usable.filter(s => s.type === 'heal' && (scopeOf(s) !== 'self' || hurt.includes(actor)));
        const skill = best(heals);
        if (skill) return { type: 'skill', skill: skill.name, target: scopeOf(skill) === 'self' ? actor.id : hurt[0].id };
        const potion = (actor.items ?? []).find(i => i.effect?.heal && i.qty > 0);
        if (potion && actor.side === 'party') {
            const needy = hurt.find(c => share(c) < rules.combat.itemHealBelow);
            if (needy) return { type: 'item', item: potion.name, target: needy.id };
        }
    }

    for (const skill of usable.filter(s => s.type === 'buff')) {
        const names = Object.keys(skill.effect ?? {});
        const scope = scopeOf(skill);
        const pool = scope === 'self' ? [actor] : friends;
        const bare = pool.filter(c => names.some(name => !has(c, name)));
        if (!bare.length) continue;
        return { type: 'skill', skill: skill.name, target: scope === 'ally' ? lowest(bare).id : actor.id };
    }

    const target = lowest(foes);
    for (const skill of usable.filter(s => s.type === 'debuff')) {
        const names = Object.keys(skill.effect ?? {});
        const pool = scopeOf(skill) === 'all' ? foes : [target];
        if (pool.some(c => names.some(name => !has(c, name)))) return { type: 'skill', skill: skill.name, target: target.id };
    }

    const attacks = usable.filter(s => s.type === 'physical' || s.type === 'magic');
    if (attacks.length) {
        const skill = [...attacks].sort((x, y) => attackScore(y, foes, target, rules) - attackScore(x, foes, target, rules))[0];
        if (attackScore(skill, foes, target, rules) > 1) return { type: 'skill', skill: skill.name, target: target.id };
    }
    return { type: 'attack', target: target.id };
}

/** Runs turns until a player-controlled combatant must choose, or the fight is over. */
function advance(f, rng, rules) {
    let steps = 0;
    while (f.status === 'active') {
        if (++steps > 100000) throw new Error('Fight did not settle.');
        const enemiesLeft = f.combatants.some(c => c.side === 'enemy' && isActive(c));
        if (timeline(f)) {
            if (!f.order.length || (!enemiesLeft && !f.turnStarted)) {
                nextOnTimeline(f, rng, rules);
                checkEnd(f);
                continue;
            }
        } else if (f.turn >= f.order.length || (!enemiesLeft && !f.turnStarted)) {
            // Nobody left to fight but reinforcements due: close the round so the wave can join.
            startRound(f, rng, rules);
            checkEnd(f);
            continue;
        }
        const actor = byId(f, f.order[f.turn]);
        if (!isActive(actor)) {
            if (timeline(f)) f.order = [];
            else f.turn += 1;
            f.turnStarted = false;
            continue;
        }
        if (!f.turnStarted) {
            f.turnStarted = true;
            const canAct = beginTurn(f, actor, rng, rules);
            checkEnd(f);
            if (f.status !== 'active') break;
            if (!canAct) {
                endTurn(f, actor, null);
                continue;
            }
        }
        if (actor.controller === 'player') return;
        const action = chooseAuto(f, actor, rules);
        let plan;
        try {
            plan = resolve(f, actor, action, rules);
        } catch {
            plan = { type: 'defend', targets: [actor] };
        }
        perform(f, actor, plan, rng, rules);
        endTurn(f, actor, plan.skill?.name ?? null);
        checkEnd(f);
    }
}

function current(f) {
    if (f.status !== 'active' || !f.turnStarted) return null;
    const actor = byId(f, f.order[f.turn]);
    return isActive(actor) && actor.controller === 'player' ? actor : null;
}

// --- the API --------------------------------------------------------------------------------

/**
 * A new fight from Combatants. Automatic turns run straight away, so the returned fight is
 * waiting on the first player-controlled combatant (or already over when nobody is).
 */
export function startFight({ rules = DEFAULT_RULES, ...setup } = {}) {
    const saved = structuredClone(setup);
    const seed = setup.seed ?? setup.id ?? 'fight';
    const party = (setup.party ?? []).map(c => ({ ...normalizeCombatant(c), side: 'party' }));
    const enemies = (setup.enemies ?? []).map(c => ({ ...normalizeCombatant(c), side: 'enemy', controller: 'auto' }));
    const f = {
        id: setup.id ?? null,
        seed,
        stakes: setup.stakes === 'death' ? 'death' : 'normal',
        round: 0,
        status: 'active',
        // (0.5.14) 'timeline' only when the setup asks for it: a fight saved before keeps rounds.
        turns: setup.turns === 'timeline' ? 'timeline' : 'rounds',
        speedOffset: Number.isFinite(Number(setup.speedOffset)) ? Math.max(0, Number(setup.speedOffset)) : rules.turns.speedOffset,
        // (v2) The stun rule, only when the setup asks for it (DAZE_POINTS).
        ...(setup.stunRule === 'daze' ? { stunRule: 'daze' } : {}),
        time: 0,
        order: [],
        turn: 0,
        turnStarted: false,
        combatants: [...party, ...enemies],
        log: [],
        actions: [],
        rngState: 0,
        setup: saved,
        stats: { uses: {}, itemsUsed: {}, damageTaken: {} },
        // Bookkeeping that is not part of any combatant: waves joined, one flee try per enemy,
        // and who has already had their "badly hurt" moment.
        marks: { waves: [], fleeTried: {}, hurt: {} },
    };
    const rng = makeRng(seed);
    checkEnd(f);
    advance(f, rng, rules);
    f.rngState = rng.state();
    return f;
}

/** What the player-controlled combatant whose turn it is can do. */
export function availableActions(fight, rules = DEFAULT_RULES) {
    const actor = current(fight);
    if (!actor) {
        return { actor: null, targets: { enemies: [], allies: [] }, skills: [], items: [], canParley: false, parleyChance: null, canFlee: false, fleeChance: 0, previews: { attack: {}, skills: {} } };
    }
    const foes = opponents(fight, actor);
    const talkers = foes.filter(c => canTalkTo(c, rules));
    const chances = talkers.map(c => parleyChance(actor.stats.CHA, c.morale, share(c), rules));
    return {
        actor,
        targets: { enemies: foes.map(c => c.id), allies: allies(fight, actor).map(c => c.id) },
        skills: actor.skills.map(s => {
            const reason = blockReason(actor, s);
            return { name: s.name, usable: !reason, reason, target: scopeOf(s) };
        }),
        items: (actor.items ?? []).filter(i => i.effect && i.qty > 0).map(i => ({ name: i.name, qty: i.qty, target: itemScope(i) })),
        canParley: talkers.length > 0,
        parleyChance: chances.length ? Math.max(...chances) : null,
        canFlee: true,
        fleeChance: partyFleeChance(fight, rules),
        // (0.5.15) For aiming: per enemy, what Attack and each damaging skill would do.
        previews: {
            attack: Object.fromEntries(foes.map(c => [c.id, previewStrike(actor, c, null, rules)])),
            skills: Object.fromEntries(actor.skills.filter(s => s.type === 'physical' || s.type === 'magic').map(s => [s.name, Object.fromEntries(foes.map(c => [c.id, previewStrike(actor, c, s, rules)]))])),
        },
    };
}

/**
 * The current player's action, then every automatic turn up to the next player choice.
 * Returns a new fight; throws when the action is not allowed.
 */
export function act(fight, action, rules = DEFAULT_RULES) {
    if (fight?.status !== 'active') throw new Error('The fight is over.');
    return actInPlace(structuredClone(fight), action, rules);
}

/**
 * act on a fight this caller owns, changing it in place (replay's step: one copy for the whole
 * replay, not one per action, so a long fight is not rebuilt at a cost that grows with its log).
 */
export function actInPlace(f, action, rules = DEFAULT_RULES) {
    if (f?.status !== 'active') throw new Error('The fight is over.');
    const actor = current(f);
    if (!actor) throw new Error('No player-controlled combatant is waiting to act.');
    if (action?.actor != null && action.actor !== actor.id) throw new Error(`It is ${actor.name}'s turn.`);
    const rng = makeRng(f.rngState);
    if (action?.type === 'auto') {
        for (const c of f.combatants) if (c.side === 'party' && c.controller === 'player') c.controller = 'auto';
        log(f, actor, 'The rest of the fight runs on auto.', 'info');
    } else {
        const plan = resolve(f, actor, action, rules);
        perform(f, actor, plan, rng, rules);
        endTurn(f, actor, plan.skill?.name ?? null);
        checkEnd(f);
    }
    f.actions.push(structuredClone(action));
    advance(f, rng, rules);
    f.rngState = rng.state();
    return f;
}

/**
 * (0.5.15) What one attack or damaging skill from `actor` would do to `target`, by the same sums
 * a strike uses: { hit (%), low, high (damage before a critical, across the variance), crit (%) }.
 * Physical attacks roll to hit; spells never miss (hit 100). A guarding target takes half. Null
 * for a skill that does no damage (heal, buff, debuff).
 */
export function previewStrike(actor, target, skill = null, rules = DEFAULT_RULES) {
    if (!actor || !target) return null;
    if (skill && skill.type !== 'physical' && skill.type !== 'magic') return null;
    if (skill && !(Number(skill.power) > 0)) return null;
    const a = rules.attack;
    const physical = !skill || skill.type === 'physical';
    let raw = skillValue(actor, skill, rules) * (skill ? effectivePower(skill, skill.mastery, rules) : 1) * holyFactor(actor, target, rules);
    if (has(actor, 'weaken')) raw *= rules.combat.weaken;
    let damage = mitigate(raw, physical ? target.pdef : target.mdef);
    if (has(target, 'guard')) damage *= a.defendTaken;
    return {
        hit: physical ? hitChance((Number(actor.stats?.DEX) || 0) - (actor.conditions ? dazed(actor) : 0), target.stats?.AGI, rules) : 100,
        low: Math.max(1, Math.round(damage * a.varianceLow)),
        high: Math.max(1, Math.round(damage * a.varianceHigh)),
        crit: Number(actor.crit) || 0,
    };
}

/**
 * The fight again from its setup and the player's actions: identical, roll for roll. `before(f,
 * action)`, when given, may adjust the fight just before each action is played (v2 records what the
 * inventory still held then, so the replay plays with what the live fight had).
 */
export function replay({ setup, actions = [] }, rules = DEFAULT_RULES, { before = null } = {}) {
    // startFight keeps its own copy of the setup, but its combatants may share nested objects with
    // it: one copy here, then every action is played on that copy (actInPlace).
    const f = structuredClone(startFight({ ...setup, rules }));
    for (const action of actions) {
        if (before) before(f, action);
        actInPlace(f, action, rules);
    }
    return f;
}

// Key moments: a party member going down matters most, then finishing blows, near-deaths,
// flights and parleys, then the party's criticals, reinforcements and the enemy's criticals;
// the six best are told in the order they happened.
function momentWeight(entry, f) {
    const actor = entry.actor ? byId(f, entry.actor) : null;
    const ours = actor?.side === 'party';
    if (entry.kind === 'down') return ours && entry.text.endsWith('is down.') ? 6 : 5;
    if (entry.kind === 'flee' || entry.kind === 'parley') return 4;
    if (entry.kind === 'info' && ours) return 4;
    if (entry.kind === 'crit') return ours ? 3 : 2;
    return 2.5;
}

/**
 * (0.5.2) What one foe is worth to a member of `memberLevel`, as summarize counts it: a
 * tenth (rules.xp.even) of the XP the member's next level needs, × the level-gap factor
 * (xpFactor, against the foe's `xpLevel` when a threat word put it below level 1, else its
 * level), × rules.boss.xp for a boss, × rules.parley.xpFactor when `parleyed`, × the XP rate;
 * rounded, at least 1 when anything is left. The rank table's XP plays no part.
 */
export function foeXpWorth(enemy, memberLevel, rules = DEFAULT_RULES, { parleyed = false } = {}) {
    const even = Number(rules?.xp?.even ?? DEFAULT_RULES.xp.even);
    const foeLevel = Number.isFinite(Number(enemy?.xpLevel)) ? Number(enemy.xpLevel) : enemy?.level;
    const raw = xpToNext(memberLevel, rules) * (Number.isFinite(even) ? even : DEFAULT_RULES.xp.even)
        * xpFactor(memberLevel, foeLevel, rules)
        * (enemy?.boss ? Number(rules.boss?.xp ?? 1) : 1)
        * (parleyed ? Number(rules.parley?.xpFactor ?? 1) : 1)
        * clampXpRate(rules?.xpRate);
    return raw > 0 ? Math.max(1, Math.round(raw)) : 0;
}

/** The finished fight as a Result (see docs/ARCHITECTURE.md). */
export function summarize(fight, rules = DEFAULT_RULES) {
    const f = fight;
    const party = f.combatants.filter(c => c.side === 'party');
    const enemies = f.combatants.filter(c => c.side === 'enemy');
    const gone = kind => enemies.filter(c => c.gone === kind);
    const defeated = gone('down');
    const parleyed = gone('parleyed');

    // (0.5.2) Each member against their own level, every foe in full (no splitting): a share of
    // the member's next level by the level gap, boss and parley, at the XP rate (foeXpWorth).
    const xp = {};
    for (const member of party) {
        let total = 0;
        for (const e of defeated) total += foeXpWorth(e, member.level, rules);
        for (const e of parleyed) total += foeXpWorth(e, member.level, rules, { parleyed: true });
        xp[member.memberId ?? member.id] = total;
    }

    const loot = { items: [], money: 0 };
    if (f.status === 'victory') {
        const rng = makeRng(`${f.seed}:loot`);
        const luck = Math.max(...party.map(c => c.stats.LUK ?? rules.character.startStat), rules.character.startStat);
        for (const enemy of defeated) {
            const drop = rollLoot(enemy, { rng, luck, rules, tables: rules.lootTables ?? LOOT_TABLES });
            loot.money += drop.money;
            for (const item of drop.items) {
                const same = loot.items.find(i => i.name === item.name && i.rarity === item.rarity);
                if (same) same.qty += item.qty;
                else loot.items.push(item);
            }
        }
    }

    const important = f.log.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.important);
    const chosen = [...important]
        .sort((x, y) => momentWeight(y.entry, f) - momentWeight(x.entry, f) || x.index - y.index)
        .slice(0, 6)
        .sort((x, y) => x.index - y.index);

    return {
        outcome: f.status,
        rounds: f.round,
        seconds: f.round * rules.secondsPerRound,
        stakes: f.stakes,
        party: party.map(c => ({
            memberId: c.memberId ?? c.id,
            name: c.name,
            // The level fought at, so an XP gain can be told as a share of the member's tier.
            level: c.level,
            hp: { ...c.hp },
            mp: { ...c.mp },
            ...(c.sp ? { sp: { ...c.sp } } : {}),
            down: c.gone === 'down' || c.hp.cur <= 0,
            conditions: c.conditions.filter(cond => !FIGHT_ONLY.has(cond.name)).map(cond => ({ name: cond.name, rounds: cond.rounds })),
        })),
        enemies: enemies.map(c => ({ id: c.id, name: c.name, ...(c.questName ? { questName: c.questName } : {}), gone: c.gone, xp: c.xp, level: c.level, rank: c.rank })),
        defeated: defeated.map(c => c.name),
        fled: gone('fled').map(c => c.name),
        parleyed: parleyed.map(c => c.name),
        xp,
        loot,
        keyMoments: chosen.map(({ entry }) => entry.text),
        uses: structuredClone(f.stats.uses),
        itemsUsed: structuredClone(f.stats.itemsUsed),
    };
}
