// RPG Battle v2, generative offers: the pure plan of a settled offer and its replay guard (GENERATIVE_OFFERS_SPEC §7.2). `planOffer` re-checks
// the numbers `matchOffer` settled against the pin and then lets the unchanged `planOpening` build the quest from the base binding, with the settled
// numbers laid over it. It reads only the pin, the state before the block, `quest.replayInputs`, `story.evidence` and what was recorded: it never
// reads a line, a word table or money, so it imports nothing of offer-match.js or parse.js, and a replay never re-decides.

import { buildGuard } from '../progress/guard.js';
import { indexOfState } from '../rules/graph.js';
import { settledProblem } from '../rules/offers.js';
import { foeVariant } from '../fight/foes.js';
import { planOpening, templateBinding } from './opening.js';
import { boundsOf, durationRange, formulaAt, kindOf } from './offer-rules.js';
import { guardQuestInputs, pinned, stateEpoch, templates } from './seams.js';

export const KIND = 'quest.offer';
const refuse = (code, message) => ({ ok: false, code, message });
const copy = value => structuredClone(value);

/** The binding `planOpening` is given for a settled offer: the template, the goal text, and the base foe or the item. */
export function bindingOf(settled) {
    return { template: settled.template, text: settled.text, ...(settled.foe ? { foe: settled.foe.base } : {}), ...(settled.item ? { item: settled.item.ref } : {}), ...(settled.place ? { place: settled.place.id } : {}) };
}

/** The pin with the one template laid out as this offer uses it: the waived requirements gone and its own deadline out of the way (the offer settles that). */
function withOffer(pin, template, settled) {
    const made = { ...copy(template), requirements: template.requirements.filter(row => !(row.kind === 'level' && settled.waived.includes('level'))), durationMinutes: null };
    const quests = Object.fromEntries(templates(pin).map(row => [row.id, row.id === template.id ? made : row]));
    return { ...pin, resolved: { ...pin.resolved, quests } };
}

/**
 * What a settled offer is, on this state.
 *   pin, ix       the pinned ruleset and its index (rules/graph.js)
 *   thread        the neutral SD thread the offer is made on, or null for a new one
 *   inputs        what `planOpening` reads (guardQuestInputs); external what was recorded with the block ({ area, places, … }); combat the combat slice
 *   settled       the numbers the matcher settled (rules/offers.js settledProblem)
 * → { ok: false, code, message } | { ok: true, concrete, facts, durationMinutes } — `concrete` the quest as `planOpening` makes it with the settled
 * numbers laid over; `facts` what the guard hashes.
 */
export function planOffer({ pin, ix, thread, inputs, external, combat }, settled) {
    const bad = settledProblem(settled);
    if (bad) return refuse('INVALID', `The settled offer ${bad}.`);
    const template = templateBinding(pin, settled.template);
    const kind = kindOf(template);
    if (template?.open !== true || !['story', 'kill', 'collect', 'visit'].includes(kind)) return refuse('RULES_MISMATCH', 'Choose an open frozen quest template explicitly.');
    if (settled.template !== template.id || settled.rank !== template.rank) return refuse('RULES_MISMATCH', 'The settled offer is not this template\'s.');
    if ((kind === 'kill') !== (settled.foe !== undefined) || (kind === 'collect') !== (settled.item !== undefined) || (kind === 'visit') !== (settled.place !== undefined) || (kind === 'kill' || kind === 'collect') !== (settled.count !== undefined)) {
        return refuse('INVALID', 'The settled target is not of the template\'s kind.');
    }
    const area = external?.area;
    if (!Number.isInteger(area?.tier) || area.tier !== settled.area.tier) return refuse('AREA', 'The settled area is not the recorded one.');
    if (settled.count !== undefined) {
        const bounds = boundsOf(templates(pin), template);
        if (settled.count < bounds.min || settled.count > bounds.max) return refuse('INVALID', 'The settled count is outside the template\'s bounds.');
    }
    const range = template.reward;
    if (settled.coin < range.coinMin || settled.coin > range.coinMax || settled.xp !== formulaAt(range.xpMin, range.xpMax, settled.area.tier)) return refuse('INVALID', 'The settled reward is outside the template\'s range.');
    if (settled.coinBy === 'formula' && settled.coin !== formulaAt(range.coinMin, range.coinMax, settled.area.tier)) return refuse('INVALID', 'The settled coin is not the formula\'s.');
    if (settled.durationMinutes !== null) {
        const [shortest, longest] = durationRange(template);
        if (settled.durationMinutes < shortest || settled.durationMinutes > longest) return refuse('INVALID', 'The settled deadline is outside the template\'s range.');
    }
    if (settled.foe) {
        const base = ix.foe(settled.foe.base);
        if (!base) return refuse('NOT_FOUND', 'The foe is not a frozen pack record.');
        if (settled.foe.ref !== base.id) {
            const made = foeVariant(base, settled.foe.name, area);
            if (!made.ok) return refuse(made.code, made.why);
            if (made.foe.id !== settled.foe.ref) return refuse('INVALID', 'The variant ref is not canonical.');
        }
    }
    const plan = planOpening({ pin: withOffer(pin, template, settled), ix, thread, inputs, external, combat }, bindingOf(settled));
    if (!plan.ok) return plan;
    const concrete = copy(plan.concrete);
    if (settled.count !== undefined) concrete.objectives[0].count = settled.count;
    concrete.reward = { coin: settled.coin, xp: settled.xp, items: [] };
    concrete.turnInPlace = settled.turnInPlace;
    return { ok: true, concrete, durationMinutes: settled.durationMinutes,
        facts: { ...plan.facts, objectives: concrete.objectives, reward: concrete.reward, settled } };
}

/**
 * hooks.replayGuard for `quest.offer`: the pin, the epoch, then the same plan on the state before the block with what was recorded. Asks only
 * `quest.replayInputs` and `story.evidence`. undefined for any other guard.
 */
export function replayOffer({ state, query, hash }, info) {
    const guard = info.guard;
    if (guard?.predicate?.kind !== KIND) return undefined;
    const pin = pinned(state?.domains?.rules);
    if (!pin || pin.hash !== guard.rulesHash || guard.epoch !== stateEpoch(state) || guard.version !== 2) return { ok: false, reason: 'The quest rules or epoch changed.' };
    const operation = guard.predicate.payload;
    if (!operation || typeof operation !== 'object' || !info.recorded || typeof info.recorded !== 'object') return { ok: false, reason: 'The quest offer is not whole.' };
    const inputs = guardQuestInputs(query, null, info.recorded.external ?? {});
    const thread = operation.thread ? inputs.threads.find(t => t.id === operation.thread) : null;
    if (operation.thread && !thread || !operation.thread && inputs.threads.some(t => t.key === operation.title)) return { ok: false, reason: 'The neutral goal changed.' };
    const ix = indexOfState(state);
    if (!ix) return { ok: false, reason: 'The quest rules or epoch changed.' };
    const plan = planOffer({ pin, ix, thread, inputs, external: info.recorded.external, combat: state?.domains?.combat }, operation.settled);
    if (!plan.ok) return { ok: false, reason: plan.message };
    const expected = buildGuard({ hash, owner: 'rpg-battle', epoch: guard.epoch, source: info.source, rulesHash: pin.hash, kind: KIND, payload: operation, inputs: plan.facts });
    return expected.inputHash === guard.inputHash ? { ok: true } : { ok: false, reason: 'The quest offer evidence changed.' };
}
