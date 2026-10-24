// RPG Battle v2, one question asked in two places: "is this choice, or this settlement, earned on this state?".
// The command asks it on the state it runs on; the replay guard asks it again, with the same code, on the state
// before the stored block (guard.js). Both get the same answer from the same function, so a choice is stored
// only if the guard will accept it on the same story. Pure over the pinned index, the progress slice and the
// queries it is given (`party.actor` for the level, `director.time` for the clock).

import { evaluateClass, evaluatePath, standing } from './offers.js';
import { pendingOf, planSettlement } from './credit.js';
import { planFold } from './fold.js';
import { readClock } from '../training/clock.js';
import { planSession } from '../training/step.js';
import { expectedSessionId, waitingOf } from '../training/session.js';
import { isObject, isActorId } from '../rules/ids.js';
import { ACTIVE_LIMIT, lifeOf } from '../rules/sheet.js';
import { assessFlag } from '../rules/flags.js';
import { assessItem } from '../rules/items.js';
import { buildAct, buildEnd } from '../fight/guards.js';

/** A party member through `query` ({ id, name, level, … }) or null: the party part is another part's, asked only by query. */
export function memberOf(query, actor) {
    if (typeof query !== 'function') return null;
    try {
        const member = query('party.actor', { id: actor });
        return isObject(member) && Number.isInteger(member.level) ? member : null;
    } catch {
        return null;
    }
}

const members = query => {
    try {
        const list = query('party.actors', {});
        return Array.isArray(list) ? list.filter(isObject) : [];
    } catch {
        return [];
    }
};

/** party.setActive: the chosen ids are durable, living members, the PC among them, at most the limit. → { ok, inputs } | refusal. */
function assessRoster(env, payload) {
    const { progress, query } = env;
    const list = members(query);
    const pc = list.find(member => member.kind === 'pc');
    const wanted = payload.actors;
    if (!Array.isArray(wanted) || !wanted.length || !wanted.every(isActorId)) return { ok: false, code: 'INVALID', why: 'Choose one to three characters by id.' };
    if (new Set(wanted).size !== wanted.length) return { ok: false, code: 'REFUSED', why: 'A character is listed twice.' };
    if (wanted.length > ACTIVE_LIMIT) return { ok: false, code: 'REFUSED', why: `At most ${ACTIVE_LIMIT} can be active.` };
    for (const id of wanted) {
        const member = list.find(item => item.id === id);
        if (!member) return Object.hasOwn(progress.temporary ?? {}, id) ? { ok: false, code: 'REFUSED', why: 'A summon or pet is not part of the party.' } : { ok: false, code: 'NOT_FOUND', why: 'That is not in the party.' };
        if (lifeOf(member) === 'dead') return { ok: false, code: 'REFUSED', why: `${member.name} is dead.` };
    }
    if (!pc || !wanted.includes(pc.id)) return { ok: false, code: 'REFUSED', why: 'Your character stays active.' };
    const order = list.map(member => member.id);
    const actors = [pc.id, ...order.filter(id => id !== pc.id && wanted.includes(id))];
    return { ok: true, actors, reserve: order.filter(id => !actors.includes(id)), inputs: { actors, pc: pc.id } };
}

/** summon.end: the unit is a temporary one of the party that has not ended (or ended for this very reason: the same answer). */
function assessUnit(env, payload) {
    const unit = env.progress.temporary?.[payload.actor];
    if (!unit) return { ok: false, code: 'REFUSED', why: 'That is not a summon or a pet: a character of the party does not end this way.' };
    return { ok: true, unit, inputs: { unit: unit.id, kind: unit.kind, ended: unit.ended?.reason ?? null } };
}

/**
 * skill.train: the character is alive and holds the skill in that form, the trainer is the pack's and teaches it, no request of
 * this character waits, and the session named is exactly the next one for this character, trainer, skill and form.
 */
function assessRequest(env, payload) {
    const { ix, progress, training, query } = env;
    const member = memberOf(query, payload.actor);
    if (!member) return { ok: false, code: 'NOT_FOUND', why: 'That character is not in the party.' };
    if (lifeOf(member) !== 'alive') return { ok: false, code: 'REFUSED', why: `${member.name} cannot train now.` };
    const trainer = ix.trainer(payload.trainer);
    if (!trainer) return { ok: false, code: 'NOT_FOUND', why: 'That is not a trainer of this world.' };
    const view = standing(ix, progress, payload.actor).skills.find(item => item.skill === payload.skill);
    if (!view || view.form !== payload.form) return { ok: false, code: 'REFUSED', why: 'That is not one of the character\'s skills in that form.' };
    if (!trainer.skills.includes(payload.skill)) return { ok: false, code: 'REFUSED', why: `${trainer.name} does not teach that.` };
    const waiting = waitingOf(training, payload.actor);
    if (waiting) return { ok: false, code: 'REFUSED', why: 'A training is already waiting for the host to start it.' };
    const expected = expectedSessionId(training?.sessions, { actor: payload.actor, trainer: payload.trainer, skill: payload.skill, form: payload.form }, ix.rulesHash);
    if (payload.session !== expected) return { ok: false, code: 'STALE', why: 'That offer is out of date; read the trainers again.' };
    return { ok: true, member, trainer, inputs: { trainer: trainer.id, skill: payload.skill, form: payload.form, session: expected } };
}

/** class.start: a basic class of the pinned ruleset (a root: tier 0, no parent). */
function assessStart(env, payload) {
    const picked = env.ix.class(payload.class);
    if (!picked || picked.tier !== 0 || picked.parent !== null) return { ok: false, code: 'REFUSED', why: 'A new character starts in a basic class.' };
    return { ok: true, skills: [...picked.skills], inputs: { class: picked.id, tier: 0 } };
}

const POOL_OF = { physical: 'sp' };

/**
 * skill.use: the character is alive, holds the skill in that form, and either can pay the form's cost now (`pays`) or the use
 * names one surviving already-paid action (`paid`: a `use` proof of the same character, skill and form). Never both.
 */
function assessUse(env, payload) {
    const { ix, progress, query } = env;
    const member = memberOf(query, payload.actor);
    if (!member) return { ok: false, code: 'NOT_FOUND', why: 'That character is not in the party.' };
    if (lifeOf(member) !== 'alive') return { ok: false, code: 'REFUSED', why: `${member.name} cannot use a skill now.` };
    const st = standing(ix, progress, payload.actor);
    const view = st.skills.find(item => item.skill === payload.skill);
    if (!view || view.form !== payload.form) return { ok: false, code: 'REFUSED', why: 'That is not one of the character\'s skills in that form.' };
    if (payload.paid !== null && payload.paid !== undefined) {
        let proofs = [];
        try { proofs = query('story.evidence', { ids: [payload.paid] }); } catch { proofs = []; }
        const proof = Array.isArray(proofs) ? proofs[0] : null;
        const said = proof?.payload;
        if (!proof || proof.kind !== 'use' || said?.actor !== payload.actor || said?.skill !== payload.skill || said?.form !== payload.form) {
            return { ok: false, code: 'NOT_FOUND', why: 'No surviving paid use of that skill is named.' };
        }
        return { ok: true, member, form: ix.form(payload.form), inputs: { paid: proof.id, proof: proof.payloadHash } };
    }
    const form = ix.form(payload.form);
    const pool = POOL_OF[form.type] ?? 'mp';
    const amount = form.cost?.[pool] ?? 0;
    if ((member[pool]?.cur ?? 0) < amount) return { ok: false, code: 'NOT_ENOUGH', why: `${member.name} has ${member[pool]?.cur ?? 0} ${pool.toUpperCase()}, ${amount} is needed.` };
    return { ok: true, member, form, pool, amount, inputs: { pays: { pool, amount } } };
}

/**
 * Asks about an operation: `kind` 'class.choose' | 'path.choose' (payload = the command's payload) or
 * 'rules.settle'. `env`: { ix, progress, query }. → { ok: true, inputs, … } | { ok: false, code, why }.
 * `inputs` is what the guard hashes (a settlement's rows carry the day, not the minute: a minute edited within its day moves no later
 * settlement, and the row stored keeps the minute); the extras (`member`, `skills`, `step`, `plan`) are for the command.
 */
export function assess(kind, env, payload, extra = {}) {
    const { ix, progress, query } = env;
    if (kind === 'rules.settle' && typeof payload.session === 'string') {
        // The host starts and finishes one training session (training/step.js); the event die is the one rolled, or the one recorded.
        return planSession(env, payload.session, extra.event ?? { die: 0, template: null }, extra.source, extra.hash);
    }
    if (kind === 'skill.train') return assessRequest(env, payload);
    if (kind === 'rules.flagSet') return assessFlag(env, payload, extra);
    if (kind === 'rules.registerItem') return assessItem(env, payload);
    if (kind === 'combat.act') return buildAct(env, payload);
    if (kind === 'combat.end') return buildEnd(env, payload);
    if (kind === 'rules.settle') {
        const plan = planSettlement(ix.constants, progress, readClock(query));
        if (plan.length) {
            const fold = planFold(progress, plan, extra.source?.sid ?? null);
            return { ok: true, plan, fold, inputs: { plan: plan.map(({ minute, ...row }) => row), fold: fold ? fold.ids : null } };
        }
        // Only held attempts left (no minute of their own, no clock): the contract's CLOCK_UNSET; nothing at all: nothing to do.
        return pendingOf(progress).length
            ? { ok: false, code: 'CLOCK_UNSET', why: 'The story clock is not set, so these uses wait for it.' }
            : { ok: false, code: 'NO_LONGER_DONE', why: 'There is nothing to settle here.' };
    }
    if (kind === 'class.start') return assessStart(env, payload);
    if (kind === 'skill.use') return assessUse(env, payload);
    if (kind === 'party.setActive') return assessRoster(env, payload);
    if (kind === 'summon.end') return assessUnit(env, payload);
    const member = memberOf(query, payload.actor);
    if (!member) return { ok: false, code: 'NOT_FOUND', why: 'That character is not in the party.' };
    const st = standing(ix, progress, payload.actor);
    if (kind === 'class.choose') {
        const result = evaluateClass(ix, st, payload, member.level);
        return result.ok ? { ok: true, member, skills: result.skills, inputs: { facts: result.facts, selected: payload.class, skills: result.skills } } : { ...result };
    }
    const result = evaluatePath(ix, st, payload, member.level);
    return result.ok ? { ok: true, member, step: result.step, inputs: { facts: result.facts, option: payload.option } } : { ...result };
}
