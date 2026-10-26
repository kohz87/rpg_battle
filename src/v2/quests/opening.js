// Explicit opening: frozen policy + recorded offer evidence -> concrete objectives and numeric reward.
// Replay reads only our declared projection, surviving proofs, prefix state and env.recorded.
import { buildGuard } from '../progress/guard.js';
import { indexOfCtx, indexOfState } from '../rules/graph.js';
import { areaPolicyNow } from '../rules/items.js';
import { baseFoeRef, foeToEngine, foeVariant, isFoeRef } from '../fight/foes.js';
import { DEFAULT_RULES } from '../../rules.js';
import { evaluateRequirements } from './requirements.js';
import { offeredQuest } from './outcomes.js';
import { ask, boundary, call, copy, fail, freshThreadId, guardQuestInputs, pinned, recordQuestInputs, stateEpoch, templates, writeId } from './seams.js';

const refuse = (code, message) => ({ ok: false, code, message });
const text = (value, max) => typeof value === 'string' && value.trim() === value && value.length > 0 && [...value].length <= max && !/[<>\p{Cc}]/u.test(value);
const fields = ['template', 'text', 'foe', 'place', 'item'];
export const templateBinding = (pin, ref) => templates(pin).find(t => t.id === ref || t.slug === ref) ?? null;
const threadFacts = thread => thread ? { id: thread.id, key: thread.key, summary: thread.summary, fields: thread.fields, status: thread.status,
    offer: thread.offer, rpg: thread.rpg ?? null, acceptance: thread.acceptance ? { proof: thread.acceptance.proof, minute: thread.acceptance.minute,
        sid: thread.acceptance.source.sid, swipeKey: thread.acceptance.source.swipeKey } : null } : null;

// Names resolve only against explicit surviving variant declarations, never a fuzzy bestiary match.
function namedVariants(combat) {
    const rows = Object.values(combat?.offers ?? {}).flatMap(offer => offer.foes ?? []).filter(row => row.variant).map(row => ({ name: row.variant.name, ref: row.ref }));
    for (const fight of Object.values(combat?.fights ?? {})) {
        for (const enemy of [...(fight.setup?.enemies ?? []), ...(fight.setup?.waves ?? []).flatMap(wave => wave.enemies ?? [])]) {
            if (enemy.foeRef?.includes('~')) rows.push({ name: enemy.questName ?? enemy.name, ref: enemy.foeRef });
        }
    }
    return rows;
}

export function planOpening({ pin, ix, thread, inputs, external, combat }, binding) {
    if (!binding || Object.keys(binding).some(k => !fields.includes(k)) || !text(binding.template, 160) || !text(binding.text, 240)
        || ['foe', 'place', 'item'].some(k => binding[k] !== undefined && !text(binding[k], 200))) return refuse('INVALID', 'Bind a template slug and objective text; targets use foe, place or item.');
    const template = templateBinding(pin, binding.template);
    if (!template?.open) return refuse('RULES_MISMATCH', 'Choose an open frozen quest template explicitly.');
    if (thread && (thread.rpg || thread.status !== 'active' || !thread.offer && !thread.acceptance)) return refuse('REFUSED', 'Only a current neutral goal can become a quest.');
    if (!Number.isInteger(external?.area?.tier) || external.area.tier < 0 || external.area.tier > 9) return refuse('AREA', 'This goal needs a recorded area danger tier.');
    const requirements = evaluateRequirements(template.requirements, inputs);
    if (!requirements.ok) return requirements;
    if (template.durationMinutes !== null && !Number.isSafeInteger(thread?.offer === false ? thread.acceptance?.minute : inputs.clock?.minutes)) return refuse('CLOCK_UNSET', 'This timed quest needs its acceptance clock.');
    const used = new Set();
    const objectives = [];
    for (const original of template.objectives) {
        const objective = copy(original);
        const target = { story: 'text', visit: 'place', kill: 'foe', collect: 'def' }[objective.kind];
        const label = objective.kind === 'collect' ? 'item' : target;
        if (!target) return refuse('INVALID', 'The template does not allow that objective kind.');
        const proposed = binding[label];
        if (proposed !== undefined) used.add(label);
        if (objective[target] !== undefined && proposed !== undefined && objective[target] !== proposed && objective.kind === 'story') return refuse('REFUSED', 'The template fixes this objective text.');
        let selector = objective[target] ?? proposed;
        if (objective.kind === 'kill' && typeof selector === 'string' && !isFoeRef(selector)) {
            const matches = [...new Set(namedVariants(combat).filter(row => row.name === selector).map(row => row.ref))];
            const collides = matches.length && Object.values(pin.resolved.foes ?? {}).some(foe => foe.slug === selector || foe.name.toLowerCase() === selector.toLowerCase());
            if (matches.length > 1 || collides) return refuse('AMBIGUOUS', 'That variant name has more than one explicit base binding; use its canonical ref.');
            if (matches.length === 1) selector = matches[0];
        }
        if (selector === undefined) return refuse('INVALID', `This ${objective.kind} objective needs an explicit ${label} target.`);
        if (objective.kind === 'kill') {
            let foe = isFoeRef(selector) ? ix.foe(baseFoeRef(selector)) : Object.values(pin.resolved.foes ?? {}).find(f => f.slug === selector) ?? ix.foeNamed(selector);
            if (!foe) return refuse('NOT_FOUND', 'The foe is not a frozen pack record or an explicitly bound variant.');
            if (selector.includes('~')) {
                const made = foeVariant(foe, selector.split('~')[1], external.area);
                if (!made.ok) return refuse(made.code, made.why);
                if (made.foe.id !== selector) return refuse('INVALID', 'The variant ref is not canonical.');
                foe = made.foe;
            }
            const checked = foeToEngine(foe, { rules: DEFAULT_RULES, forms: ix, items: ref => ix.itemDef(ref), area: external.area, ordinal: 1 });
            if (!checked.ok) return refuse(checked.code, checked.why);
            objective.foe = foe.id;
            if (original.foe && proposed && proposed !== selector && proposed !== foe.id) return refuse('REFUSED', 'The template fixes this foe.');
        } else if (objective.kind === 'collect') {
            const candidates = Object.keys(pin.resolved.items ?? {}).filter(ref => ref === selector || ref.split('/')[1] === selector || ix.itemDef(ref)?.name === selector);
            if (candidates.length !== 1 || !ix.itemDef(candidates[0])) return refuse('NOT_FOUND', 'The item must name one real frozen item.');
            objective.def = candidates[0];
            if (original.def && proposed && ![original.def, objective.def].includes(proposed)) return refuse('REFUSED', 'The template fixes this item.');
        } else if (objective.kind === 'visit') {
            const place = external.places?.[selector];
            if (!place?.id) return refuse('NOT_FOUND', 'The place must name one real canonical place.');
            objective.place = place.id;
            if (original.place && proposed && ![original.place, place.id].includes(proposed)) return refuse('REFUSED', 'The template fixes this place.');
        } else objective.text = selector;
        objectives.push(objective);
    }
    if (['foe', 'place', 'item'].some(k => binding[k] !== undefined && !used.has(k))) return refuse('INVALID', 'That target kind is not allowed by this template.');
    const range = template.reward;
    if (['coin', 'xp'].some(k => !Number.isSafeInteger(range[`${k}Min`]) || !Number.isSafeInteger(range[`${k}Max`]) || range[`${k}Min`] < 0 || range[`${k}Min`] > range[`${k}Max`])) return refuse('RULES_MISMATCH', 'The frozen reward range is invalid.');
    const at = (min, max) => min + Math.floor((max - min) * external.area.tier / 9);
    const reward = { coin: at(range.coinMin, range.coinMax), xp: at(range.xpMin, range.xpMax), items: [] };
    const concrete = { ...copy(template), name: thread?.key ?? template.name, objectives, reward };
    return { ok: true, concrete, facts: { binding, thread: threadFacts(thread), objectives, reward, area: external.area,
        acceptance: thread?.acceptance ? inputs.proofs.filter(p => p.id === thread.acceptance.proof).map(p => ({ id: p.id, payloadHash: p.payloadHash })) : [], prerequisites: true } };
}

export function openingPlan(ctx, binding, thread) {
    const pin = pinned(ctx.read('rules'));
    const template = templateBinding(pin, binding?.template);
    const external = { area: areaPolicyNow(ctx.query), places: {}, ...recordQuestInputs(ctx.query, template ? { rpg: template } : null) };
    for (const selector of [binding?.place, ...(template?.objectives ?? []).filter(o => o.kind === 'visit').map(o => o.place)].filter(Boolean)) {
        external.places[selector] = ask(ctx.query, 'atlas.canonical', { id: selector }) ?? ask(ctx.query, 'atlas.canonical', { name: selector });
    }
    const inputs = guardQuestInputs(ctx.query, null, external);
    return { ...planOpening({ pin, ix: indexOfCtx(ctx), thread, inputs, external, combat: ctx.read('combat') }, binding), external };
}

export function commitOpening(ctx, binding, thread, plan, title = null) {
    if (!plan.ok) return fail(ctx, plan);
    const { source, epoch } = boundary(ctx);
    const pin = pinned(ctx.read('rules'));
    const operation = { binding, thread: thread?.id ?? null, title: title ?? thread?.key ?? plan.concrete.name };
    ctx.replayGuard(buildGuard({ hash: ctx.hash, owner: 'rpg-battle', epoch, source, rulesHash: pin.hash,
        kind: 'quest.open', payload: operation, inputs: plan.facts }), { external: plan.external });
    const id = thread?.id ?? freshThreadId(ctx);
    const quest = offeredQuest({ ...plan.concrete, name: operation.title }, id);
    if (thread) {
        if (!thread.offer) {
            quest.state = 'active'; quest.acceptedAt = thread.acceptance.minute; quest.acceptedCursor = copy(thread.acceptance.cursor);
            quest.deadline = plan.concrete.durationMinutes === null ? null : quest.acceptedAt + plan.concrete.durationMinutes;
            if (quest.deadline !== null && !Number.isSafeInteger(quest.deadline)) return ctx.fail('INVALID', 'The deadline overflowed.');
        }
        call(ctx, 'threads.link', { write: writeId(ctx, `open:${id}`), thread: id, quest, expectedHash: ctx.query('threads.hash', { thread: id }) });
    } else call(ctx, 'threads.offer', { write: writeId(ctx, `offer:${id}`), thread: id, kind: 'hook', key: operation.title,
        summary: binding.text, fields: { goal: binding.text }, expectedHash: null, quest });
    return { summary: `Made ${operation.title} a quest.`, narrate: false, data: { quest: id, reward: quest.reward } };
}

export function replayOpening({ state, query, hash }, info) {
    const guard = info.guard;
    if (guard?.predicate?.kind !== 'quest.open') return undefined;
    const pin = pinned(state?.domains?.rules);
    if (!pin || pin.hash !== guard.rulesHash || guard.epoch !== stateEpoch(state) || guard.version !== 2) return { ok: false, reason: 'The quest rules or epoch changed.' };
    const operation = guard.predicate.payload;
    const inputs = guardQuestInputs(query, null, info.recorded?.external ?? {});
    const thread = operation.thread ? inputs.threads.find(t => t.id === operation.thread) : null;
    if (operation.thread && !thread || !operation.thread && inputs.threads.some(t => t.key === operation.title)) return { ok: false, reason: 'The neutral goal changed.' };
    const plan = planOpening({ pin, ix: indexOfState(state), thread, inputs, external: info.recorded?.external, combat: state?.domains?.combat }, operation.binding);
    if (!plan.ok) return { ok: false, reason: plan.message };
    const expected = buildGuard({ hash, owner: 'rpg-battle', epoch: guard.epoch, source: info.source, rulesHash: pin.hash,
        kind: 'quest.open', payload: operation, inputs: plan.facts });
    return { ok: expected.inputHash === guard.inputHash, reason: 'The quest opening evidence changed.' };
}
