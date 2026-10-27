// Retained quest command payloads; all thread changes go through SD's P23 writers.
import { openingPlan, commitOpening } from './opening.js';
import { offeredQuest } from './outcomes.js';
import { OBJECTIVE_FIELDS } from './objectives.js';
import { ask, boundary, call, copy, fail, freshThreadId, pinned, questInputs, templateOf, threadOf, writeId } from './seams.js';

const requireThread = (ctx, payload) => {
    if (!payload || typeof payload !== 'object' || Object.keys(payload).some(k => !['id', 'key', 'by', 'credit', 'reason'].includes(k))) return ctx.fail('INVALID', 'Invalid quest selector.');
    const thread = threadOf(ctx.query, payload);
    if (!thread) return ctx.fail('NOT_FOUND', 'There is no such quest.');
    if (!thread.rpg && thread.kind === 'quest' && !thread.acceptance) return ctx.fail('REFUSED', 'Quest from an earlier version (read only).');
    return thread;
};

export function offerQuest(ctx, template, options = {}) {
    const id = freshThreadId(ctx);
    const quest = offeredQuest(template, id, options);
    call(ctx, 'threads.offer', { write: writeId(ctx, `offer:${id}`), thread: id, kind: 'hook', key: template.name,
        summary: template.name, fields: { goal: template.name }, expectedHash: null, quest });
    return id;
}

export function createCommands({ settleQuest, evaluateRequirements = null, guardTake = null, recordObjective = null, attributeCoin = null } = {}) {
    function open(ctx, payload = {}) {
        if (ctx.cause !== 'ui' || ctx.caller) return ctx.fail('REFUSED', 'Make this a quest is a reader action.');
        if (!payload || Object.keys(payload).some(k => !['id', 'template', 'text', 'foe', 'place', 'item'].includes(k))) return ctx.fail('INVALID', 'Use an existing goal and an explicit open template binding.');
        const { id, ...binding } = payload;
        const thread = threadOf(ctx.query, { id });
        if (!thread) return ctx.fail('NOT_FOUND', 'There is no such goal.');
        const plan = openingPlan(ctx, binding, thread);
        return commitOpening(ctx, binding, thread, plan);
    }
    function take(ctx, payload = {}) {
        if (payload.by !== undefined || payload.credit !== undefined || payload.reason !== undefined) return ctx.fail('INVALID', 'Taking a quest uses id or key.');
        if (ctx.caller && !['story-director', 'rpg-battle'].includes(ctx.caller)) return ctx.fail('REFUSED', 'Quest acceptance requires the reader or validated player intent.');
        const thread = requireThread(ctx, payload);
        const pin = pinned(ctx.read('rules'));
        if (!pin) return ctx.fail('RULES_MISMATCH', 'No frozen quest rules are pinned.');
        const template = templateOf(pin, thread.rpg?.template ?? thread.key);
        if (!template || !thread.rpg && template.open) return ctx.fail('RULES_MISMATCH', 'This goal needs an explicit quest binding.');
        const { cursor } = boundary(ctx);
        const quest = thread.rpg ? copy(thread.rpg) : offeredQuest(template, thread.id);
        const inputs = questInputs(ctx.query, { ...thread, rpg: quest });
        if (thread.status !== 'active' || quest.settlement) return ctx.fail('REFUSED', 'This quest is already over.');
        if (quest.state === 'active') return ctx.fail('REFUSED', 'This quest is already taken on.');
        if (!thread.offer && (!thread.taken || !thread.acceptance)) return ctx.fail('REFUSED', 'The original reader acceptance proof is missing.');
        const now = inputs.clock?.minutes;
        // A job the story offered keeps its own deadline in the offer's record (the quest has no field for a duration); any other quest, its template's.
        const settled = ctx.read('rules')?.offers?.[thread.id]?.settled;
        const duration = settled ? settled.durationMinutes : template.durationMinutes;
        if ((quest.repeat?.nextOfferAt !== null && quest.repeat?.nextOfferAt !== undefined) || duration !== null) {
            if (!Number.isSafeInteger(now)) return ctx.fail('CLOCK_UNSET', 'This quest needs the story clock.');
            if (quest.repeat?.nextOfferAt > now) return ctx.fail('REFUSED', 'The repeat cooldown has not ended.');
        }
        if (template.chain?.previous) {
            const previous = ask(ctx.query, 'director.threads');
            if (!previous?.some(t => t.rpg?.template === template.chain.previous && t.rpg.state === 'done' && t.rpg.settlement)) return ctx.fail('REFUSED', 'The previous chain quest is not done.');
        }
        if (quest.requirements.length) {
            if (typeof evaluateRequirements !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The shared requirements evaluator is unavailable.');
            const checked = evaluateRequirements(quest.requirements, inputs);
            if (checked?.ok !== true) return fail(ctx, checked ?? {});
        }
        quest.state = 'active';
        quest.acceptedAt = thread.acceptance ? thread.acceptance.minute : (Number.isSafeInteger(now) ? now : null);
        if (duration !== null && !Number.isSafeInteger(quest.acceptedAt)) return ctx.fail('CLOCK_UNSET', 'A timed quest needs its original acceptance minute.');
        quest.acceptedCursor = copy(thread.acceptance?.cursor ?? cursor);
        quest.deadline = duration === null ? null : quest.acceptedAt + duration;
        if (quest.deadline !== null && !Number.isSafeInteger(quest.deadline)) return ctx.fail('INVALID', 'The quest deadline overflowed.');
        if (guardTake) guardTake(ctx, thread, payload, inputs);
        const acceptance = ctx.cause === 'ui' ? null : inputs.proofs?.find(p => p.owner === 'story-director' && p.kind === 'acceptance'
            && p.payload?.thread === thread.id && p.source?.sid === ctx.source.sid && p.source?.swipeKey === ctx.source.swipeKey
            && p.source?.evidence === ctx.source.evidence && p.source?.ordinal === ctx.source.ordinal)?.id;
        call(ctx, thread.offer ? 'threads.accept' : 'threads.link', { write: writeId(ctx, `take:${thread.id}`), thread: thread.id,
            expectedHash: ctx.query('threads.hash', { thread: thread.id }), quest, ...(thread.offer && acceptance ? { acceptance } : {}) });
        return { summary: `Takes on ${thread.key}.`, narrate: true, data: { quest: thread.id, key: thread.key,
            target: threadOf(ctx.query, { id: thread.id }).target, reward: threadOf(ctx.query, { id: thread.id }).reward } };
    }
    function finish(ctx, payload = {}) {
        if (!(ctx.cause === 'ui' && !ctx.caller || ctx.caller === 'rpg-battle'
            || ctx.caller === 'story-director' && ctx.cause === 'story')) return ctx.fail('REFUSED', 'Quest turn-in requires the reader, SD capture or RB.');
        const thread = requireThread(ctx, payload);
        if (!thread.rpg) return ctx.fail('REFUSED', 'This goal has no RPG quest extension.');
        if (payload.by !== undefined && payload.by !== 'story') return ctx.fail('INVALID', 'Unknown turn-in authority.');
        if (payload.by === 'story' && ctx.cause === 'ui' && !ctx.caller) return ctx.fail('REFUSED', 'A reader action cannot assert story authority.');
        if (typeof settleQuest !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The guarded settlement adapter is unavailable.');
        return settleQuest(ctx, thread, payload, 'done');
    }
    function abandon(ctx, payload = {}) {
        const thread = requireThread(ctx, payload);
        if (!thread.rpg) return ctx.fail('REFUSED', 'This goal has no RPG quest extension.');
        if (ctx.cause !== 'ui' && ctx.caller !== 'rpg-battle') return ctx.fail('REFUSED', 'Giving up requires the reader action or validated player intent.');
        if (typeof settleQuest !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The guarded settlement adapter is unavailable.');
        return settleQuest(ctx, thread, payload, 'abandoned');
    }
    function payOwed(ctx, payload = {}) {
        if (ctx.cause !== 'system') return ctx.fail('REFUSED', 'Rewards owed are settled by code.');
        const thread = requireThread(ctx, payload);
        if (!thread.rpg) return ctx.fail('REFUSED', 'Reward from an earlier version (read only).');
        if (thread.rpg.settlement) return ctx.fail('CLAIMED', 'This quest settlement is already complete.');
        const expired = thread.rpg.deadline !== null && Number.isSafeInteger(ctx.time()) && ctx.time() >= thread.rpg.deadline;
        if (!expired && !(ask(ctx.query, 'quest.autoTurnIns') ?? []).includes(thread.id)) {
            return ctx.fail('NO_LONGER_DONE', 'This quest has neither expired nor a surviving turn-in intent.');
        }
        const out = settleQuest(ctx, thread, { ...payload, by: 'story' }, expired ? 'expired' : 'done');
        return { ...out, replan: true };
    }
    // B3: one validated action becomes one proof of one objective (objectives.js). A button is not an action of the story.
    function objective(ctx, payload = {}) {
        if (!payload || typeof payload !== 'object' || Object.keys(payload).some(k => !OBJECTIVE_FIELDS.includes(k))) return ctx.fail('INVALID', 'quest.objective takes { id|key, objective, fight? | proof? }.');
        if (typeof payload.objective !== 'string' || (payload.fight !== undefined && payload.proof !== undefined)) return ctx.fail('INVALID', 'Name the objective and either the fight or the proof, not both.');
        if (ctx.cause === 'ui' && !ctx.caller) return ctx.fail('REFUSED', 'An objective is proved by the story or by code, not by a button.');
        if (typeof recordObjective !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The objective adapter is unavailable.');
        const thread = requireThread(ctx, { ...(payload.id ? { id: payload.id } : {}), ...(payload.key ? { key: payload.key } : {}) });
        if (!thread.rpg) return ctx.fail('REFUSED', 'This goal has no RPG quest extension.');
        const { id: _id, key: _key, ...request } = payload;
        return recordObjective(ctx, thread, request);
    }
    return { 'quest.open': open, 'quest.attributeCoin': attributeCoin, 'quest.take': take, 'quest.abandon': abandon, 'quest.finish': finish, 'quest.payOwed': payOwed, 'quest.objective': objective };
}
