// One guarded root owns quest costs, rewards, closure, journal and fresh repeat/chain offers.
// B owns the shared envelope. Guards read only declared pure queries and recorded inputs.
import { buildGuard as sharedBuildGuard } from '../progress/index.js';
import { planQuestSettlement, settlementKey, acceptanceOf } from './planner.js';
import { nextOffers, terminalQuest } from './outcomes.js';
import { attributedOn, coinSources, creditFor, repeatKey } from './credit.js';
import { offerQuest } from './commands.js';
import { boundary, call, copy, fail, pinned, guardQuestInputs, recordQuestInputs, stateEpoch, templateOf, templates, writeId } from './seams.js';

const zero = () => ({ coin: 0, xp: 0, items: [] });
const held = message => ({ ok: false, code: 'REFUSED', message });

function terminalPlan(thread, inputs, outcome, policy) {
    if (outcome === 'done') return planQuestSettlement(thread, inputs, policy);
    if (!['abandoned', 'failed', 'expired'].includes(outcome) || thread.status !== 'active'
        || thread.rpg?.state !== 'active' || thread.rpg.settlement) return held('This quest is not active.');
    const proof = acceptanceOf(thread, inputs.proofs ?? []);
    if (!proof) return held('The original reader acceptance proof is not active.');
    if (thread.rpg.deadline !== null && !Number.isSafeInteger(inputs.clock?.minutes)) return { ok: false, code: 'CLOCK_UNSET', message: 'The quest deadline needs the story clock.' };
    if (outcome === 'expired' && (thread.rpg.deadline === null || inputs.clock.minutes < thread.rpg.deadline)) return held('The quest has not expired.');
    return { ok: true, outcome: thread.rpg.deadline !== null && inputs.clock.minutes >= thread.rpg.deadline ? 'expired' : outcome,
        consumed: [], payout: zero(), proofs: [{ id: proof.id, payloadHash: proof.payloadHash }] };
}

/** The closed prerequisites, not the entire party, inventory or formatted calendar. */
function assess(query, pin, thread, outcome, policy, reply = null, recorded = {}) {
    const inputs = guardQuestInputs(query, reply, recorded);
    const credited = copy(thread);
    // Narrated coin is already in the wallet. A done reward is reduced by the surviving amounts attributed to this quest instance
    // (each a proof bound to its narration); any other outcome pays nothing extra and takes nothing back.
    const sources = outcome === 'done' ? coinSources(inputs.proofs, thread) : { rows: [], coin: 0 };
    credited.rpg.storyCredit.coin += sources.coin;
    const tally = inputs.storyCoin;
    const loose = outcome === 'done' && tally ? Math.max(0, tally.coin - tally.vouched - attributedOn(inputs.proofs, reply)) : 0;
    if (creditFor(credited, loose) > 0) return { ok: false, code: 'CREDIT_UNBOUND', message: 'The narrated reward has no unique surviving source attribution.' };
    const credit = sources.coin ? { coin: sources.coin, sources: sources.rows.map(p => ({ id: p.id, payloadHash: p.payloadHash, coin: p.payload.coin }))
        .sort((x, y) => (x.id < y.id ? -1 : 1)) } : null;
    const plan = terminalPlan(credited, inputs, outcome, policy);
    if (!plan.ok) return plan;
    if (thread.rpg.repeat && !Number.isSafeInteger(inputs.clock?.minutes)) return { ok: false, code: 'CLOCK_UNSET', message: 'A repeat cooldown needs the story clock.' };
    const follow = nextOffers(thread.rpg, plan.outcome, inputs.clock?.minutes, templates(pin));
    if (follow.some(row => row.instance > 1000000 || row.nextOfferAt !== null && !Number.isSafeInteger(row.nextOfferAt))) return { ok: false, code: 'LIMITED', message: 'The repeat instance or cooldown limit was reached.' };
    return { ok: true, plan, follow, quest: credited.rpg, inputs: guardInputs({ credit,
        ...(reply ? { unattributed: loose } : {}), thread: copy(thread),
        ...(thread.rpg.deadline !== null || thread.rpg.repeat ? { clock: inputs.clock } : {}),
        ...(thread.rpg.turnInPlace !== null ? { place: inputs.place } : {}),
        ...(thread.rpg.giver !== null ? { giver: inputs.giverPresent === true } : {}),
        ...(thread.rpg.requirements.length && plan.outcome === 'done' ? { prerequisites: { ok: true } } : {}),
        proofs: inputs.proofs.filter(proof => plan.proofs.some(pin => pin.id === proof.id)).sort((a, b) => a.id.localeCompare(b.id)), plan, follow }) };
}

function takeInputs(thread, inputs, pin, policy) {
    const template = templateOf(pin, thread.rpg?.template ?? thread.key);
    const requirements = thread.rpg?.requirements ?? template?.requirements ?? [];
    if (requirements.length && policy.evaluateRequirements?.(requirements, inputs)?.ok !== true) return null;
    const previous = template?.chain?.previous;
    return guardInputs({ thread: copy(thread),
        ...(template?.durationMinutes != null || thread.rpg?.repeat?.nextOfferAt != null ? { clock: inputs.clock } : {}),
        acceptance: thread.acceptance ? inputs.proofs?.filter(proof => proof.id === thread.acceptance.proof) ?? [] : [],
        previous: previous ? inputs.threads.filter(t => t.rpg?.template === previous && t.rpg.state === 'done' && t.rpg.settlement) : [],
        prerequisites: requirements.length ? { ok: true } : null });
}

// Re-read can renumber transport ordinals/revisions without changing the accepted action.
// Only the surviving proof identity/bytes and thread semantics are prerequisites.
function semanticThread(value) {
    const thread = copy(value);
    delete thread.rev;
    if (thread.taken) delete thread.taken.rev;
    if (thread.ended) delete thread.ended.rev;
    if (thread.acceptance) {
        delete thread.acceptance.source.ordinal;
        thread.acceptance.cursor = { sid: thread.acceptance.cursor.sid, swipeKey: thread.acceptance.cursor.swipeKey };
    }
    if (thread.rpg?.acceptedCursor) {
        const cursor = thread.rpg.acceptedCursor;
        thread.rpg.acceptedCursor = { sid: cursor.sid, swipeKey: cursor.swipeKey };
    }
    if (thread.rpg?.settlement) delete thread.rpg.settlement.source.ordinal;
    return thread;
}
function guardInputs(inputs) {
    const normalized = copy(inputs);
    if (normalized.thread) normalized.thread = semanticThread(normalized.thread);
    delete normalized.threadHash;
    for (const key of ['proofs', 'acceptance']) {
        for (const proof of normalized[key] ?? []) if (proof.source) delete proof.source.ordinal;
    }
    if (normalized.previous) normalized.previous = normalized.previous.map(semanticThread);
    return normalized;
}

const BOUND_KEYS = ['type', 'thread', 'instance', 'reply', 'coin', 'limit'];
const sameBound = bound => !!bound && typeof bound === 'object' && Object.keys(bound).length === BOUND_KEYS.length && BOUND_KEYS.every(k => Object.hasOwn(bound, k))
    && ['quest.coin', 'quest.coin.repeat'].includes(bound.type) && typeof bound.thread === 'string' && typeof bound.reply === 'string'
    && [bound.instance, bound.coin, bound.limit].every(Number.isSafeInteger) && bound.coin > 0 && bound.limit >= bound.coin;

/**
 * What an attribution stands on, or null. A narrated amount counts toward an active quest instance whose acceptance proof shows
 * and whose remaining reward holds it; a repeat is the duplicate of a reward this reply's own settlement paid.
 */
function noteFacts({ thread, bound, proofs, source }) {
    const quest = thread?.rpg;
    if (!quest || quest.id !== thread.id || quest.instance !== bound.instance) return null;
    if (bound.type === 'quest.coin.repeat') {
        const paid = quest.settlement;
        return paid?.outcome === 'done' && paid.source?.sid === source?.sid && paid.source.swipeKey === source.swipeKey && quest.reward.coin >= bound.coin
            ? { settlement: paid.id } : null;
    }
    if (quest.state !== 'active' || quest.settlement || thread.status !== 'active' || !thread.taken) return null;
    const acceptance = acceptanceOf(thread, proofs ?? []);
    if (!acceptance || quest.reward.coin - coinSources(proofs, thread).coin < bound.coin) return null;
    return { acceptance: { id: acceptance.id, payloadHash: acceptance.payloadHash } };
}

export function createSettlement(policy = {}) {
    const buildGuard = policy.buildGuard ?? sharedBuildGuard;
    function settleQuest(ctx, thread, payload, outcome) {
        const { epoch, source } = boundary(ctx);
        const pin = pinned(ctx.read('rules'));
        if (!pin) return ctx.fail('RULES_MISMATCH', 'No frozen quest rules are pinned.');
        if (typeof buildGuard !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The shared B5 guard builder is unavailable.');
        const key = settlementKey(epoch, thread.rpg);
        if (thread.rpg.settlement) return ctx.fail('CLAIMED', 'This quest settlement is already complete.');
        const reply = outcome === 'done' ? ctx.reply?.sid ?? null : null;
        const external = recordQuestInputs(ctx.query, thread);
        const checked = assess(ctx.query, pin, thread, outcome, policy, reply, external);
        const threadHash = ctx.query('threads.hash', { thread: thread.id });
        if (!checked.ok) return fail(ctx, checked);
        const progressView = ctx.query('quest.progress', { id: thread.id });
        const operation = { thread: thread.id, outcome, reason: payload.reason ?? outcome, ...(reply ? { reply } : {}) };
        const guard = buildGuard({ hash: ctx.hash, owner: 'rpg-battle', epoch, source, rulesHash: pin.hash,
            kind: 'quest.settlement', payload: operation, inputs: guardInputs(checked.inputs) });
        ctx.replayGuard(guard, { inputs: checked.inputs, external });
        const terminal = terminalQuest(checked.quest, { outcome: checked.plan.outcome, id: ctx.id('st'), source, epoch,
            minute: checked.inputs.clock?.minutes, payout: checked.plan.payout });
        if (!terminal.ok) return fail(ctx, terminal);
        call(ctx, 'threads.questWrite', { write: writeId(ctx, `settle:${thread.id}`), thread: thread.id,
            expectedHash: threadHash, quest: terminal.quest });
        // close acquires the root settlement claim. Every later failure rolls it back with the journal.
        call(ctx, 'threads.close', { write: writeId(ctx, `close:${thread.id}`), thread: thread.id,
            expectedHash: ctx.query('threads.hash', { thread: thread.id }), instance: thread.rpg.instance,
            outcome: checked.plan.outcome, reason: operation.reason, settlement: terminal.quest.settlement.id });
        for (const stack of checked.plan.consumed) call(ctx, 'inventory.consume', stack);
        const paid = checked.plan.payout;
        if (paid.coin) {
            const received = call(ctx, 'wallet.receive', { owner: 'party', amount: paid.coin, note: thread.key });
            if (received.amount !== paid.coin) return ctx.fail('REFUSED', 'The full quest reward could not be paid.');
        }
        for (const item of paid.items) call(ctx, 'inventory.grant', { def: item.def, qty: item.qty, owner: 'party' });
        const xp = paid.xp ? call(ctx, 'party.grantXp', { quest: thread.id, amount: paid.xp, claim: key }) : null;
        const offers = checked.follow.map(row => offerQuest(ctx, row.template, row));
        return { summary: `${thread.key}: ${checked.plan.outcome}.`, narrate: true,
            data: { quest: thread.id, key: thread.key, ...(outcome === 'abandoned' ? {} : {
                have: progressView?.have ?? 0,
                need: thread.rpg.objectives.reduce((n, o) => n + (o.count ?? 1), 0),
                source: thread.rpg.objectives[0].kind === 'collect' ? 'inventory' : thread.rpg.objectives[0].kind === 'kill' ? 'fights' : 'story',
                units: 1, paid: paid.coin || checked.quest.storyCredit.coin ? { amount: paid.coin, ...(checked.quest.storyCredit.coin ? { story: checked.quest.storyCredit.coin } : {}) } : null,
                consumed: copy(checked.plan.consumed), xp, fights: [], ...(payload.by === 'story' ? { by: 'story' } : {}) }),
                v2: { key, result: { thread: thread.id, instance: thread.rpg.instance, settlement: terminal.quest.settlement.id, outcome: checked.plan.outcome, offers } } } };
    }
    // Record which quest instance a narrated amount may count toward. The narrated coin stays in the wallet; only a guarded
    // `done` settlement reads the proof, so taking the narration, the acceptance or the quest away takes the attribution away.
    // The one wallet effect is the duplicate correction: a Continue repeating a reward this very reply's settlement already paid.
    function attributeCoin(ctx, payload) {
        if (ctx.cause !== 'system' || ctx.caller && ctx.caller !== 'rpg-battle') return ctx.fail('REFUSED', 'Only the reward adapter attributes narrated coin.');
        const { epoch, source } = boundary(ctx);
        const pin = pinned(ctx.read('rules'));
        if (!pin) return ctx.fail('RULES_MISMATCH', 'No frozen rules.');
        if (typeof buildGuard !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The shared B5 guard builder is unavailable.');
        const bound = payload?.bound;
        if (!bound) return ctx.fail('INVALID', 'The source attribution must be recorded at planning.');
        if (!sameBound(bound) || bound.reply !== ctx.reply.sid || bound.thread !== payload.id) return ctx.fail('INVALID', 'Invalid recorded reward attribution.');
        const inputs = ctx.query('quest.replayInputs', { reply: bound.reply });
        if (!inputs.storyCoin || inputs.storyCoin.coin - inputs.storyCoin.vouched < bound.limit) return ctx.fail('NO_LONGER_DONE', 'The source coin is no longer present.');
        const facts = noteFacts({ thread: inputs.threads.find(t => t.id === bound.thread), bound, proofs: ctx.query('story.evidence', {}), source });
        if (!facts) return ctx.fail('NO_LONGER_DONE', 'The quest, its acceptance or its settlement is no longer present.');
        const repeat = bound.type === 'quest.coin.repeat';
        if (repeat && !ctx.claim(repeatKey(epoch, bound))) return ctx.fail('CLAIMED', 'This repeated coin was already taken back.');
        ctx.replayGuard(buildGuard({ hash: ctx.hash, owner: 'rpg-battle', epoch, source, rulesHash: pin.hash,
            kind: 'quest.coinNote', payload: bound, inputs: facts }), { inputs: facts });
        if (repeat) call(ctx, 'wallet.pay', { owner: 'party', amount: bound.coin, note: 'Reward repeated after its settlement' });
        const proof = ctx.proof({ kind: 'story', payload: bound, parents: repeat ? [] : [facts.acceptance.id] });
        return { summary: repeat ? 'The repeated quest reward was taken back.' : 'The narrated coin counts toward the quest reward.', narrate: false,
            replan: true, data: { proof: proof.id, bound } };
    }
    function guardTake(ctx, thread, payload, inputs, kind = 'quest.take') {
        const { epoch, source } = boundary(ctx);
        const pin = pinned(ctx.read('rules'));
        if (typeof buildGuard !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The shared B5 guard builder is unavailable.');
        const operation = { thread: thread.id };
        const template = templateOf(pin, thread.rpg?.template ?? thread.key);
        const external = recordQuestInputs(ctx.query, thread.rpg ? thread : { ...thread, rpg: template });
        const facts = takeInputs(thread, guardQuestInputs(ctx.query, null, external), pin, policy);
        if (!facts) return ctx.fail('REFUSED', 'The quest requirements are not met.');
        ctx.replayGuard(buildGuard({ hash: ctx.hash, owner: 'rpg-battle', epoch, source, rulesHash: pin.hash,
            kind, payload: operation, inputs: guardInputs(facts) }), { inputs: facts, external });
    }
    function replayGuard({ state, query, hash }, info) {
        if (info.guard?.predicate?.kind === 'quest.coinNote') {
            const guard = info.guard, bound = guard.predicate.payload, pin = pinned(state?.domains?.rules);
            const inputs = bound?.reply ? query('quest.replayInputs', { reply: bound.reply }) : null;
            if (!pin || !buildGuard || guard.rulesHash !== pin.hash || guard.epoch !== stateEpoch(state) || !sameBound(bound) || !inputs?.storyCoin
                || inputs.storyCoin.coin - inputs.storyCoin.vouched < bound.limit) return { ok: false, reason: 'The attributed coin source changed.' };
            const facts = noteFacts({ thread: inputs.threads.find(t => t.id === bound.thread), bound, proofs: query('story.evidence', {}), source: info.source });
            if (!facts) return { ok: false, reason: 'The quest, its acceptance or its settlement changed.' };
            const expected = buildGuard({ hash, owner: 'rpg-battle', epoch: guard.epoch, source: info.source, rulesHash: pin.hash,
                kind: 'quest.coinNote', payload: bound, inputs: facts });
            return { ok: expected.inputHash === guard.inputHash && hash(facts) === hash(info.recorded?.inputs) };
        }
        if (['quest.take', 'quest.turnIn'].includes(info.guard?.predicate?.kind)) {
            const pin = pinned(state?.domains?.rules);
            const facts = guardQuestInputs(query, null, info.recorded?.external ?? {});
            const thread = facts.threads.find(t => t.id === info.guard.predicate.payload?.thread);
            if (!pin || pin.hash !== info.guard.rulesHash || info.guard.version !== 2 || info.guard.epoch !== stateEpoch(state) || !thread || !buildGuard) return { ok: false, reason: 'The accepted quest offer or rules changed.' };
            const inputs = takeInputs(thread, facts, pin, policy);
            if (!inputs) return { ok: false, reason: 'The quest requirements are no longer met.' };
            const expected = buildGuard({ hash, owner: 'rpg-battle', epoch: info.guard.epoch, source: info.source,
                rulesHash: pin.hash, kind: info.guard.predicate.kind, payload: info.guard.predicate.payload, inputs: guardInputs(inputs) });
            return expected.inputHash === info.guard.inputHash ? { ok: true } : { ok: false, reason: 'The accepted quest offer or requirements changed.' };
        }
        if (info.guard?.predicate?.kind !== 'quest.settlement') return undefined;
        const off = () => ({ ok: false, reason: 'The quest acceptance, objectives or settlement inputs changed.' });
        if (typeof buildGuard !== 'function') return off();
        const pin = pinned(state?.domains?.rules);
        if (!pin || pin.hash !== info.guard.rulesHash || info.guard.version !== 2 || info.guard.epoch !== stateEpoch(state)) return off();
        const payload = info.guard.predicate.payload;
        const thread = query('quest.replayInputs', {}).threads.find(t => t.id === payload?.thread);
        if (!thread?.rpg) return off();
        const checked = assess(query, pin, thread, payload.outcome, policy, payload.reply ?? null, info.recorded?.external ?? {});
        if (!checked.ok) return off();
        // Older guards retained proof iteration order. Reuse that order after verifying the same proof set.
        const proofOrder = new Map((info.recorded?.inputs?.proofs ?? []).map((p, n) => [p.id, n]));
        checked.inputs.proofs.sort((a, b) => (proofOrder.get(a.id) ?? Infinity) - (proofOrder.get(b.id) ?? Infinity));
        const expected = buildGuard({ hash, owner: 'rpg-battle', epoch: info.guard.epoch, source: info.source,
            rulesHash: pin.hash, kind: 'quest.settlement', payload, inputs: guardInputs(checked.inputs) });
        return expected.inputHash === info.guard.inputHash && hash(guardInputs(info.recorded?.inputs ?? {})) === hash(guardInputs(checked.inputs))
            ? { ok: true } : off();
    }
    return { settleQuest, attributeCoin, replayGuard, guardTake, guardIntent: (ctx, thread) => guardTake(ctx, thread, null, null, 'quest.turnIn') };
}
