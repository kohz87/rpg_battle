// One guarded root owns quest costs, rewards, closure, journal and fresh repeat/chain offers.
// B owns the guard envelope. Its unmerged export is optional only to keep legacy readers bootable;
// a quest mutation fails closed until that dependency is integrated.
import { planQuestSettlement, settlementKey, acceptanceOf } from './planner.js';
import { nextOffers, terminalQuest } from './outcomes.js';
import { creditFor, creditKey } from './credit.js';
import { offerQuest } from './commands.js';
import { boundary, call, copy, fail, pinned, guardQuestInputs, stateEpoch, templateOf, templates, writeId } from './seams.js';

const progress = await import('../progress/index.js').catch(() => null);
const zero = () => ({ coin: 0, xp: 0, items: [] });
const held = message => ({ ok: false, code: 'REFUSED', message });

function terminalPlan(thread, inputs, outcome, policy) {
    if (outcome === 'done') return planQuestSettlement(thread, inputs, policy);
    if (!['abandoned', 'failed'].includes(outcome) || thread.status !== 'active'
        || thread.rpg?.state !== 'active' || thread.rpg.settlement) return held('This quest is not active.');
    const proof = acceptanceOf(thread, inputs.proofs ?? []);
    if (!proof) return held('The original reader acceptance proof is not active.');
    if (thread.rpg.deadline !== null && !Number.isSafeInteger(inputs.clock?.minutes)) return { ok: false, code: 'CLOCK_UNSET', message: 'The quest deadline needs the story clock.' };
    return { ok: true, outcome: thread.rpg.deadline !== null && inputs.clock.minutes >= thread.rpg.deadline ? 'expired' : outcome,
        consumed: [], payout: zero(), proofs: [{ id: proof.id, payloadHash: proof.payloadHash }] };
}

/** The closed prerequisites, not the entire party, inventory or formatted calendar. */
function assess(query, pin, thread, outcome, policy, reply = null) {
    const inputs = guardQuestInputs(query, reply);
    const credited = copy(thread);
    const tally = inputs.storyCoin;
    const coin = outcome === 'done' && tally && !tally.claimed ? creditFor(thread, Math.max(0, tally.coin - tally.vouched)) : 0;
    const credit = coin ? { reply, coin, claim: creditKey(reply) } : null;
    if (credit) { credited.rpg.storyCredit.coin += coin; credited.rpg.storyCredit.claims.push(credit.claim); }
    if (thread.rpg.requirements.length) return { ok: false, code: 'DEPENDENCY_UNAVAILABLE', message: 'B3 requirement replay inputs are unavailable.' };
    const plan = terminalPlan(credited, inputs, outcome, policy);
    if (!plan.ok) return plan;
    if (thread.rpg.repeat && !Number.isSafeInteger(inputs.clock?.minutes)) return { ok: false, code: 'CLOCK_UNSET', message: 'A repeat cooldown needs the story clock.' };
    const follow = nextOffers(thread.rpg, plan.outcome, inputs.clock?.minutes, templates(pin));
    if (follow.some(row => row.instance > 1000000 || row.nextOfferAt !== null && !Number.isSafeInteger(row.nextOfferAt))) return { ok: false, code: 'LIMITED', message: 'The repeat instance or cooldown limit was reached.' };
    return { ok: true, plan, follow, quest: credited.rpg, inputs: guardInputs({ credit,
        ...(reply ? { storyCoin: inputs.storyCoin } : {}), thread: copy(thread),
        ...(thread.rpg.deadline !== null || thread.rpg.repeat ? { clock: inputs.clock } : {}),
        ...(thread.rpg.turnInPlace !== null ? { place: inputs.place } : {}),
        ...(thread.rpg.giver !== null ? { giver: inputs.giverPresent === true } : {}),
        proofs: inputs.proofs.filter(proof => plan.proofs.some(pin => pin.id === proof.id)), plan, follow }) };
}

function takeInputs(thread, inputs, pin) {
    const template = templateOf(pin, thread.rpg?.template ?? thread.key);
    const previous = template?.chain?.previous;
    return guardInputs({ thread: copy(thread),
        ...(template?.durationMinutes !== null || thread.rpg?.repeat?.nextOfferAt != null ? { clock: inputs.clock } : {}),
        acceptance: thread.acceptance ? inputs.proofs?.filter(proof => proof.id === thread.acceptance.proof) ?? [] : [],
        previous: previous ? inputs.threads.filter(t => t.rpg?.template === previous && t.rpg.state === 'done' && t.rpg.settlement) : [],
        prerequisites: null });
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

// A later Continue may repeat a reward that code already paid on this carrier.
// This correction takes back only that duplicate coin; the settlement itself is never paid again.
function repeatedAssessment(query, thread, reply, source) {
    const inputs = guardQuestInputs(query, reply);
    const proof = acceptanceOf(thread, inputs.proofs);
    const paid = thread.rpg?.settlement;
    const tally = inputs.storyCoin;
    const coin = tally && !tally.claimed ? Math.max(0, tally.coin - tally.vouched) : 0;
    if (!proof || !paid || paid.outcome !== 'done' || paid.coinPaid <= 0 || coin !== paid.coinPaid
        || paid.source.sid !== source.sid || paid.source.swipeKey !== source.swipeKey) return null;
    return guardInputs({ thread, proofs: [proof], storyCoin: tally, coin });
}

export function createSettlement(policy = {}) {
    const buildGuard = policy.buildGuard ?? progress?.buildGuard;
    function settleQuest(ctx, thread, payload, outcome) {
        const { epoch, source } = boundary(ctx);
        const pin = pinned(ctx.read('rules'));
        if (!pin) return ctx.fail('RULES_MISMATCH', 'No frozen quest rules are pinned.');
        if (typeof buildGuard !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The shared B5 guard builder is unavailable.');
        const key = settlementKey(epoch, thread.rpg);
        if (thread.rpg.settlement) return ctx.fail('CLAIMED', 'This quest settlement is already complete.');
        const reply = payload.credit === true && ctx.cause === 'system' ? ctx.reply?.sid : null;
        const checked = assess(ctx.query, pin, thread, outcome, policy, reply);
        const threadHash = ctx.query('threads.hash', { thread: thread.id });
        if (!checked.ok) return fail(ctx, checked);
        const progressView = ctx.query('quest.progress', { id: thread.id });
        const operation = { thread: thread.id, outcome, reason: payload.reason ?? outcome, ...(reply ? { reply } : {}) };
        const guard = buildGuard({ hash: ctx.hash, owner: 'rpg-battle', epoch, source, rulesHash: pin.hash,
            kind: 'quest.settlement', payload: operation, inputs: guardInputs(checked.inputs) });
        ctx.replayGuard(guard, { inputs: checked.inputs });
        if (checked.inputs.credit && !ctx.claim(checked.inputs.credit.claim)) return ctx.fail('CLAIMED', 'This reply already credited another quest.');
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
    function settleCredit(ctx, thread) {
        const { epoch, source } = boundary(ctx);
        const pin = pinned(ctx.read('rules'));
        if (!pin || !buildGuard) return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The shared guard and frozen rules are required.');
        const payload = { thread: thread.id, reply: ctx.reply.sid };
        const inputs = repeatedAssessment(ctx.query, thread, payload.reply, source);
        if (!inputs) return ctx.fail('CLAIMED', 'No uncredited repeat of this reward is present.');
        ctx.replayGuard(buildGuard({ hash: ctx.hash, owner: 'rpg-battle', epoch, source, rulesHash: pin.hash,
            kind: 'quest.storyCredit', payload, inputs }), { inputs });
        const key = creditKey(payload.reply);
        if (!ctx.claim(key)) return ctx.fail('CLAIMED', 'This reply already credited another quest.');
        call(ctx, 'wallet.pay', { owner: 'party', amount: inputs.coin, note: thread.key });
        return { summary: `The story's coin repeats ${thread.key}'s reward; counted once.`, narrate: true, replan: true,
            data: { quest: thread.id, credit: inputs.coin, v2: { key, result: { thread: thread.id, coin: inputs.coin } } } };
    }
    function guardTake(ctx, thread, payload, inputs, kind = 'quest.take') {
        const { epoch, source } = boundary(ctx);
        const pin = pinned(ctx.read('rules'));
        if (typeof buildGuard !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The shared B5 guard builder is unavailable.');
        if (thread.rpg?.requirements.length || templateOf(pin, thread.rpg?.template ?? thread.key)?.requirements.length) return ctx.fail('DEPENDENCY_UNAVAILABLE', 'B3 requirement replay inputs are unavailable.');
        const operation = { thread: thread.id };
        const facts = takeInputs(thread, guardQuestInputs(ctx.query), pin);
        ctx.replayGuard(buildGuard({ hash: ctx.hash, owner: 'rpg-battle', epoch, source, rulesHash: pin.hash,
            kind, payload: operation, inputs: guardInputs(facts) }), { inputs: facts });
    }
    function replayGuard({ state, query, hash }, info) {
        if (info.guard?.predicate?.kind === 'quest.storyCredit') {
            const pin = pinned(state?.domains?.rules);
            if (!pin || !buildGuard || info.guard.rulesHash !== pin.hash || info.guard.epoch !== stateEpoch(state)) return { ok: false, reason: 'The quest rules or epoch changed.' };
            const payload = info.guard.predicate.payload;
            const thread = query('quest.replayInputs', {}).threads.find(t => t.id === payload.thread);
            if (!thread?.rpg) return { ok: false, reason: 'The paid quest is no longer present.' };
            const inputs = repeatedAssessment(query, thread, payload.reply, info.source);
            if (!inputs) return { ok: false, reason: 'The repeated coin or original settlement is no longer present.' };
            const expected = buildGuard({ hash, owner: 'rpg-battle', epoch: info.guard.epoch, source: info.source,
                rulesHash: pin.hash, kind: 'quest.storyCredit', payload, inputs });
            return expected.inputHash === info.guard.inputHash && hash(inputs) === hash(info.recorded?.inputs)
                ? { ok: true } : { ok: false, reason: 'The repeated coin changed.' };
        }
        if (['quest.take', 'quest.turnIn'].includes(info.guard?.predicate?.kind)) {
            const pin = pinned(state?.domains?.rules);
            const facts = guardQuestInputs(query);
            const thread = facts.threads.find(t => t.id === info.guard.predicate.payload?.thread);
            if (!pin || pin.hash !== info.guard.rulesHash || info.guard.version !== 2 || info.guard.epoch !== stateEpoch(state) || !thread || !buildGuard) return { ok: false, reason: 'The accepted quest offer or rules changed.' };
            const inputs = takeInputs(thread, facts, pin);
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
        const checked = assess(query, pin, thread, payload.outcome, policy, payload.reply ?? null);
        if (!checked.ok) return off();
        const expected = buildGuard({ hash, owner: 'rpg-battle', epoch: info.guard.epoch, source: info.source,
            rulesHash: pin.hash, kind: 'quest.settlement', payload, inputs: guardInputs(checked.inputs) });
        return expected.inputHash === info.guard.inputHash && hash(guardInputs(info.recorded?.inputs ?? {})) === hash(guardInputs(checked.inputs))
            ? { ok: true } : off();
    }
    return { settleQuest, settleCredit, replayGuard, guardTake, guardIntent: (ctx, thread) => guardTake(ctx, thread, null, null, 'quest.turnIn') };
}
