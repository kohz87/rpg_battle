// Pure quest settlement planning. Inputs are public projections; only SD/SB/RB owners commit
// the result. Missing owner validation holds settlement rather than treating text as proof.

const copy = value => structuredClone(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (code, message) => ({ ok: false, code, message });
const sameSource = (a, b) => a && b && a.sid === b.sid && a.swipeKey === b.swipeKey;

/** Select by the retained {id|key} payload, including SD-indexed aliases, without a second store. */
export function findQuest(threads, payload = {}, resolve = null) {
    const found = payload.id ? threads.find(thread => thread.id === payload.id)
        : resolve ? resolve({ key: payload.key })
            : threads.find(thread => thread.key.toLowerCase() === String(payload.key ?? '').trim().toLowerCase());
    return found?.rpg ? copy(found) : null;
}

/** The exact §6 key: two different threads with instance 1 cannot collide. */
export function settlementKey(epoch, quest) {
    return `rb:${epoch}:quest:${quest.id}:${quest.instance}:settled`;
}

function acceptanceOf(thread, proofs) {
    const acceptance = thread.acceptance;
    const quest = thread.rpg;
    const proof = proofs.find(proof => proof.id === acceptance?.proof);
    if (!proof || proof.kind !== 'acceptance' || proof.owner !== 'story-director'
        || proof.payload?.thread !== thread.id || !sameSource(proof.source, acceptance.source)
        || !sameSource(acceptance.cursor, quest.acceptedCursor)
        || acceptance.cursor?.block !== quest.acceptedCursor?.block
        || acceptance.cursor?.op !== quest.acceptedCursor?.op
        || acceptance.cursor?.rev !== quest.acceptedCursor?.rev
        || acceptance.minute !== quest.acceptedAt) return null;
    return proof;
}

/**
 * Count only active owner-validated proofs and exact definition IDs. `validateProof` is the
 * B3 handoff: no local guess at the closed kill/visit/story payload or its action authority.
 * It is given the objective, quest, acceptance proof and candidate proof, all read-only.
 */
export function objectiveProgress(thread, { proofs, items, activeActors, validateProof } = {}) {
    if (!thread?.rpg) return refuse('NOT_FOUND', 'This thread has no RPG quest.');
    if (!Array.isArray(proofs) || !Array.isArray(items) || !Array.isArray(activeActors)) {
        return refuse('DEPENDENCY_UNAVAILABLE', 'Quest evidence or inventory projections are unavailable.');
    }
    const acceptance = acceptanceOf(thread, proofs);
    if (!acceptance) return refuse('REFUSED', 'The original reader acceptance proof is not active.');
    const quest = thread.rpg;
    const owners = new Set(['party', ...activeActors]);
    const remaining = new Map(items.filter(item => owners.has(item.owner)).map(item => [item.id ?? item.stack, item.qty]));
    const consumed = [];
    const used = new Map([[acceptance.id, acceptance]]);
    const objectives = [];
    for (const objective of quest.objectives) {
        let have = 0;
        const need = objective.kind === 'visit' || objective.kind === 'story' ? 1 : objective.count;
        if (objective.kind === 'collect') {
            const stacks = items.filter(item => owners.has(item.owner) && (item.def?.id ?? item.def) === objective.def)
                .sort((a, b) => String(a.id ?? a.stack).localeCompare(String(b.id ?? b.stack)));
            for (const stack of stacks) {
                const id = stack.id ?? stack.stack;
                const available = remaining.get(id);
                if (!count(available)) return refuse('INVALID', 'The inventory projection has an invalid quantity.');
                const qty = Math.min(available, Math.max(0, need - have));
                have += qty;
                if (objective.consume && qty > 0) {
                    // One physical item cannot satisfy two consuming objectives in one settlement.
                    remaining.set(id, available - qty);
                    const own = consumed.find(entry => entry.stack === id);
                    if (own) own.qty += qty;
                    else consumed.push({ stack: id, qty });
                }
            }
        } else {
            if (typeof validateProof !== 'function') return refuse('DEPENDENCY_UNAVAILABLE', 'The B3 objective proof validator is not available.');
            const seen = new Set();
            for (const evidence of Object.values(quest.evidence)) {
                if (evidence.objective !== objective.id || seen.has(evidence.proof)) continue;
                const proof = proofs.find(proof => proof.id === evidence.proof);
                if (!proof || !count(evidence.amount) || evidence.amount > 999) continue;
                // The shared checker must verify thread/instance/objective, exact action and
                // the surviving acceptance prefix. A visible line by itself is insufficient.
                if (validateProof({ objective, quest, acceptance, proof }) !== true) continue;
                seen.add(proof.id);
                used.set(proof.id, proof);
                have += evidence.amount;
                if (!count(have)) return refuse('INVALID', 'Quest progress overflowed.');
            }
        }
        objectives.push({ id: objective.id, kind: objective.kind, have, need, met: have >= need });
    }
    return { ok: true, objectives, met: objectives.every(objective => objective.met), consumed,
        proofs: [...used.values()].map(proof => ({ id: proof.id, payloadHash: proof.payloadHash })).sort((a, b) => a.id.localeCompare(b.id)) };
}

/**
 * No drafts, claims, calls, RNG or narration. Requirements, giver identity and carry legality
 * are supplied by their rule owners, not reimplemented here. Expiry precedes all turn-ins.
 */
export function planSettlement(thread, inputs, { evaluateRequirements, validateProof, canReceive } = {}) {
    const quest = thread?.rpg;
    if (!quest || quest.id !== thread.id) return refuse('NOT_FOUND', 'This thread has no matching RPG quest.');
    if (quest.state !== 'active' || quest.settlement || thread.status !== 'active' || !thread.taken) {
        return refuse('REFUSED', 'This quest is not active.');
    }
    const minute = inputs?.clock?.minutes;
    if (quest.deadline !== null && !Number.isSafeInteger(minute)) return refuse('CLOCK_UNSET', 'The quest deadline needs the story clock.');
    if (quest.deadline !== null && minute >= quest.deadline) {
        return { ok: true, outcome: 'expired', consumed: [], payout: { coin: 0, xp: 0, items: [] }, proofs: [] };
    }
    const progress = objectiveProgress(thread, { ...inputs, validateProof });
    if (!progress.ok) return progress;
    if (!progress.met) return refuse('NOT_ENOUGH', 'The quest objectives are not met.');
    if (quest.requirements.length) {
        if (typeof evaluateRequirements !== 'function') return refuse('DEPENDENCY_UNAVAILABLE', 'The shared requirements evaluator is unavailable.');
        const rule = evaluateRequirements(quest.requirements, inputs);
        if (rule?.ok !== true) return rule?.ok === false ? rule : refuse('DEPENDENCY_UNAVAILABLE', 'The shared requirements evaluator gave no valid answer.');
    }
    if (quest.turnInPlace !== null && quest.turnInPlace !== inputs.place?.id) return refuse('REFUSED', 'The quest cannot be turned in at this place.');
    if (quest.giver !== null && inputs.giverPresent !== true) return refuse('REFUSED', 'The quest giver is not present.');
    const reward = quest.reward;
    if (!record(reward) || !count(reward.coin) || !count(reward.xp) || !Array.isArray(reward.items)
        || !count(quest.storyCredit?.coin) || !Array.isArray(quest.storyCredit?.claims)) return refuse('INVALID', 'The typed quest reward is invalid.');
    const payout = { coin: Math.max(0, reward.coin - quest.storyCredit.coin), xp: reward.xp, items: copy(reward.items) };
    if (payout.items.length) {
        if (typeof canReceive !== 'function') return refuse('DEPENDENCY_UNAVAILABLE', 'Reward carry validation is unavailable.');
        const carry = canReceive(payout.items, inputs, progress.consumed);
        if (carry?.ok !== true) return carry?.ok === false ? carry : refuse('DEPENDENCY_UNAVAILABLE', 'Reward carry validation gave no valid answer.');
    }
    return { ok: true, outcome: 'done', consumed: progress.consumed, payout, proofs: progress.proofs };
}

/** B5's canonical envelope; the caller supplies the host Source/epoch and frozen rules hash. */
export function settlementInputs({ operation, source, epoch, rulesHash, thread, inputs, plan }) {
    return { version: 2, operation: copy(operation), source: copy(source), rulesHash, epoch,
        inputs: { thread: copy(thread), clock: copy(inputs.clock), place: copy(inputs.place),
            items: copy(inputs.items), activeActors: copy(inputs.activeActors),
            storyCredit: copy(thread.rpg.storyCredit), consumed: copy(plan.consumed), payout: copy(plan.payout) },
        proofs: copy(plan.proofs) };
}
