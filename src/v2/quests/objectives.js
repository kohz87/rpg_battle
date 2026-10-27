// B3 objective evidence: one guarded root turns a validated action into one proof of one objective, writes the evidence row
// through Story Director's quest writer and takes the claims that keep it from counting twice.
//
//   quest.objective { id|key, objective, fight?, proof? }   (kill: a sealed victory; visit: the canonical place; story: a captured line;
//                                                            `proof` cites a surviving proof instead of publishing one)
//
// The proof is RPG Battle's (`kill` or `story`, proofs.js) with the reader's acceptance proof as its only parent, so taking the
// acceptance back hides the proof, and the guard (kind quest.objective) turns the evidence row and its claims off with it.
// The guard obeys the replay rule: it reads the state it is given (threads, the combat and progress domains, the clock, the scene),
// `story.evidence` for the acceptance and a cited proof, and what the block recorded (the canonical place, the line); it asks no
// other query. One plan answers the command and the guard, so a block is stored only if its guard will hold.

import { baseFoeRef, matchesFoe } from '../fight/foes.js';
import { acceptanceOf } from './planner.js';
import { objectivePayload, objectiveProofProblem, payloadProblem, proofKindOf, effectiveEvidence } from './proofs.js';
import { ask, boundary, call, copy, fail, pinned, stateEpoch, writeId } from './seams.js';
import { sealedProblem } from '../fight/batch.js';
import { indexOfCtx, indexOfState } from '../rules/graph.js';
import { buildGuard as sharedBuildGuard } from '../progress/index.js';
import { isObject } from '../rules/ids.js';

const refuse = (code, message) => ({ ok: false, code, message });
const record = value => (isObject(value) ? value : {});
const safe = value => Number.isSafeInteger(value);
const claimPart = value => String(value).replaceAll('/', ':');

export const objectiveClaim = (epoch, thread, quest, objective) => `rb:${epoch}:objective:${thread}:${quest.instance}:${objective}`;
/** One sealed victory pays one objective per foe, for every quest (MODULES F7). */
export const killClaim = (epoch, batch, foe) => `rb:${epoch}:objective:fight:${batch}:${claimPart(baseFoeRef(foe))}`;
export const proofClaim = (epoch, proof) => `rb:${epoch}:objective:proof:${proof}`;

/** The threads of a state as the public query shows them (without Story Director's private order). */
export const threadsOf = state => Object.values(state?.domains?.director?.threads ?? {}).map(({ track: _track, ...thread }) => thread);

/** The sealed victory of `fight` over `objective`'s foe after the acceptance: `{ fight, batch: { id, hash }, count }` or a refusal. */
export function killSource({ ix, quest, combat, progress }, objective, fight) {
    const beaten = record(combat?.beaten)[fight];
    const foe = ix?.foe(baseFoeRef(objective.foe));
    if (!isObject(beaten) || beaten.won !== true || !foe) return refuse('NOT_FOUND', 'No victory over that foe is recorded.');
    if (!quest.acceptedCursor || !safe(beaten.rev) || beaten.rev <= quest.acceptedCursor.rev) return refuse('REFUSED', 'That fight ended before the quest was taken on.');
    const found = Object.entries(record(progress?.batches)).find(([, entry]) => entry?.bytes?.kind === 'fight' && entry.bytes.fight === fight);
    if (!found || sealedProblem(found[1])) return refuse('NOT_FOUND', 'The fight\'s sealed result is not kept.');
    const bytes = found[1].bytes;
    if (bytes.outcome !== 'victory') return refuse('REFUSED', 'That fight was not won.');
    // The sealed rows keep the name the fight showed ("Wolf A"); the foe's own name is that without the letter that told twins apart.
    const nameOf = enemy => String(enemy?.name ?? '').replace(/\s+[A-Z]$/, '').trim().toLowerCase();
    const count = (Array.isArray(bytes.enemies) ? bytes.enemies : []).filter(enemy => enemy?.gone === 'down' && (Object.hasOwn(enemy, 'foe')
        ? matchesFoe(objective, enemy.foe)
        : ix.foeNamed(nameOf(enemy))?.id === objective.foe)).length;
    if (count < 1) return refuse('NOT_FOUND', 'That fight did not defeat this foe.');
    return { ok: true, fight, batch: { id: found[0], hash: found[1].hash }, count: Math.min(count, 999) };
}

/**
 * The most rows of evidence an objective keeps. A kill objective is counted a fight at a time and every fight it counts is at least one kill, so it never needs more rows than it asks
 * kills (up to 999); a hunt of a hundred is not stopped at 64 fights. The rest (a place, a line of the story) keep 64.
 */
export const evidenceLimit = objective => (objective?.kind === 'kill' && Number.isSafeInteger(objective.count) ? Math.min(999, Math.max(64, objective.count)) : 64);

/**
 * The one plan of an objective's evidence. `facts`: { hash, ix, thread, proofs(ids) → surviving proofs, combat, progress, clock (minute | null),
 * place (canonical id | null), scene (place name | null), line (hash | null) }. `request`: { objective, fight?, proof? }.
 * → { ok, objective, payload | null, cited | null, amount, acceptance, claims, inputs } | { ok: false, code, message }.
 */
export function planObjective(facts, request) {
    const { hash, ix, thread } = facts;
    const quest = thread?.rpg;
    if (!quest || quest.id !== thread.id) return refuse('NOT_FOUND', 'This thread has no matching RPG quest.');
    if (thread.status !== 'active' || !thread.taken || quest.state !== 'active' || quest.settlement) return refuse('REFUSED', 'This quest is not active.');
    const objective = quest.objectives.find(row => row.id === request.objective);
    if (!objective) return refuse('NOT_FOUND', 'This quest has no such objective.');
    const kind = proofKindOf(objective.kind);
    if (!kind) return refuse('REFUSED', 'That objective is counted from the bag, not proved.');
    if (quest.deadline !== null) {
        if (!safe(facts.clock)) return refuse('CLOCK_UNSET', 'The quest deadline needs the story clock.');
        if (facts.clock >= quest.deadline) return refuse('REFUSED', 'The quest has expired.');
    }
    const acceptance = acceptanceOf(thread, facts.proofs(thread.acceptance ? [thread.acceptance.proof] : []));
    if (!acceptance) return refuse('REFUSED', 'The original reader acceptance proof is not active.');
    const mine = { id: acceptance.id, payloadHash: acceptance.payloadHash };
    const rows = Object.values(quest.evidence).filter(row => row.objective === objective.id);
    if (rows.length >= evidenceLimit(objective)) return refuse('LIMITED', 'This objective already holds its evidence limit.');
    const epoch = facts.epoch;
    let payload = null;
    let cited = null;
    let amount;
    let claims;
    let source = null;
    if (request.proof !== undefined) {
        const found = facts.proofs([request.proof]).find(proof => proof.id === request.proof);
        if (!found) return refuse('NOT_FOUND', 'No surviving proof is named.');
        const problem = objectiveProofProblem({ objective, quest, acceptance: mine, proof: found });
        if (problem) return refuse('REFUSED', problem);
        if (facts.threads?.some(other => Object.hasOwn(other.rpg?.evidence ?? {}, found.id) || Object.values(other.rpg?.evidence ?? {}).some(row => row.proof === found.id))) {
            return refuse('CLAIMED', 'That proof was already counted once.');
        }
        cited = { id: found.id, payloadHash: found.payloadHash };
        amount = found.payload.count ?? 1;
        claims = [proofClaim(epoch, found.id)];
    } else if (objective.kind === 'kill') {
        if (typeof request.fight !== 'string') return refuse('INVALID', 'A kill is proved by the fight it came from.');
        const won = killSource({ ix, quest, combat: facts.combat, progress: facts.progress }, objective, request.fight);
        if (!won.ok) return won;
        payload = objectivePayload(quest, objective, acceptance.id, won);
        amount = won.count;
        source = { fight: won.fight, batch: won.batch, count: won.count };
        claims = [killClaim(epoch, won.batch.id, objective.foe)];
    } else if (objective.kind === 'story') {
        if (typeof facts.line !== 'string') return refuse('REFUSED', 'A story objective is met by a line of the story.');
        payload = objectivePayload(quest, objective, acceptance.id, { line: facts.line });
        if (request.undo) {
            const row = effectiveEvidence(quest, facts.proofs(Object.values(quest.evidence).map(row => row.proof)), mine)
                .find(row => row.proof === request.undo && row.objective === objective.id);
            if (!row) return refuse('REFUSED', 'That story evidence is no longer met.');
            payload.undo = request.undo;
        }
        amount = request.undo ? 0 : 1;
        source = { line: facts.line };
        const previous = rows.at(-1)?.proof;
        claims = [request.undo ? `rb:${epoch}:objective:undo:${request.undo}`
            : `${objectiveClaim(epoch, thread.id, quest, objective.id)}${previous ? `:${previous}` : ''}`];
    } else {
        if (typeof facts.place !== 'string' || facts.place !== objective.place) return refuse('REFUSED', 'The party is not at that place.');
        if (typeof facts.scene !== 'string' || !facts.scene) return refuse('REFUSED', 'The scene names no place.');
        payload = objectivePayload(quest, objective, acceptance.id, { scene: facts.scene });
        amount = 1;
        source = { place: facts.place, scene: facts.scene };
        claims = [objectiveClaim(epoch, thread.id, quest, objective.id)];
    }
    if (payload) {
        const problem = payloadProblem(objective.kind, payload);
        if (problem) return refuse('INVALID', problem);
    }
    const inputs = { thread: thread.id, instance: quest.instance, objective: objective.id, kind, acceptance: mine, amount,
        proof: cited ?? { payloadHash: hash(payload) }, ...(source ? { source } : {}), ...(quest.deadline !== null ? { clock: facts.clock } : {}) };
    return { ok: true, objective, payload, cited, amount, acceptance: mine, claims, source, inputs };
}

const operationOf = (thread, request) => ({ thread, objective: request.objective,
    ...(request.undo ? { undo: request.undo } : {}), ...(request.proof !== undefined ? { proof: request.proof } : {}), ...(request.fight !== undefined ? { fight: request.fight } : {}) });

export function createObjectives(policy = {}) {
    const buildGuard = policy.buildGuard ?? sharedBuildGuard;

    /** The command: validates, publishes (or cites) the proof, writes the evidence row, claims and guards. */
    function recordObjective(ctx, thread, request, extra = {}) {
        const { epoch, source } = boundary(ctx);
        const pin = pinned(ctx.read('rules'));
        if (!pin) return ctx.fail('RULES_MISMATCH', 'No frozen quest rules are pinned.');
        if (typeof buildGuard !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The shared B5 guard builder is unavailable.');
        const ix = indexOfCtx(ctx);
        const read = name => { try { return ctx.read(name); } catch { return null; } };
        const quest = thread.rpg;
        const objective = quest?.objectives?.find(row => row.id === request.objective);
        const external = {};
        if (objective?.kind === 'visit') {
            external.place = ask(ctx.query, 'atlas.canonical')?.id ?? null;
            external.scene = ask(ctx.query, 'scene.place')?.name ?? null;
        }
        if (extra.line !== undefined) external.line = extra.line;
        const facts = { hash: ctx.hash, ix, thread, epoch, proofs: ids => (ids.length ? ctx.query('story.evidence', { ids }) : []),
            threads: ask(ctx.query, 'director.threads') ?? [], combat: read('combat'), progress: read('progress'),
            clock: ask(ctx.query, 'director.time')?.minutes ?? null, ...external };
        const plan = planObjective(facts, request);
        if (!plan.ok) return fail(ctx, plan);
        for (const claim of plan.claims) if (!ctx.claim(claim)) return ctx.fail('CLAIMED', 'That action already counted for an objective.');
        let proof = plan.cited;
        let own = null;
        if (!proof) {
            const made = ctx.proof({ kind: proofKindOf(plan.objective.kind), payload: plan.payload, parents: [plan.acceptance.id] });
            proof = { id: made.id, payloadHash: made.payloadHash };
            own = proof;
            if (!ctx.claim(proofClaim(epoch, proof.id))) return ctx.fail('CLAIMED', 'That proof was already counted once.');
        }
        const next = copy(quest);
        next.evidence[proof.id] = { objective: plan.objective.id, proof: proof.id, amount: plan.amount };
        call(ctx, 'threads.questWrite', { write: writeId(ctx, `objective:${thread.id}:${proof.id}`), thread: thread.id,
            expectedHash: ctx.query('threads.hash', { thread: thread.id }), quest: next });
        const guard = buildGuard({ hash: ctx.hash, owner: 'rpg-battle', epoch, source, rulesHash: pin.hash, kind: 'quest.objective',
            payload: operationOf(thread.id, request), inputs: plan.inputs });
        ctx.replayGuard(guard, { ...(own ? { own } : {}), external });
        return { summary: `${thread.key}: ${plan.objective.kind === 'kill' ? `${plan.amount} defeated` : 'objective met'}.`, narrate: false,
            ...(ctx.cause === 'system' ? { replan: true } : {}),
            data: { quest: thread.id, objective: plan.objective.id, proof: proof.id, amount: plan.amount,
                v2: { key: `objective:${proof.id}`, result: { thread: thread.id, instance: quest.instance, objective: plan.objective.id, proof: proof.id, amount: plan.amount } } } };
    }

    /** `~ quest Name | met: yes [| objective: <id>]`: the story says its own objective is done; the line is the validated action. */
    function captureObjective(ctx, thread, line) {
        const met = line.labels?.met;
        if (met !== 'yes' && met !== 'no') return ctx.fail('INVALID_MET', 'met takes exactly yes or no.');
        const quest = thread.rpg;
        const proofs = ctx.query('story.evidence', {});
        const acceptance = acceptanceOf(thread, proofs);
        const evidence = effectiveEvidence(quest, proofs, acceptance);
        const wanted = typeof line.labels?.objective === 'string' ? line.labels.objective.trim() : '';
        const open = quest.state === 'active' ? quest.objectives.filter(row => row.kind === 'story'
            && (met === 'no' || !evidence.some(e => e.objective === row.id))) : [];
        const choices = wanted ? open.filter(row => row.id === wanted) : open;
        if (choices.length > 1) return ctx.fail('AMBIGUOUS', 'Name the exact story objective.');
        const objective = choices[0];
        if (!objective) return { summary: `No open story objective for ${thread.key}.`, narrate: false, data: { quest: thread.id, held: true, reply: ctx.reply?.sid ?? null } };
        const undo = met === 'no' ? evidence.find(row => row.objective === objective.id)?.proof : null;
        if (met === 'no' && !undo) return { summary: 'This objective is not met.', narrate: false };
        const seen = ctx.hash({ op: line.op, name: line.name, text: line.text ?? '', labels: line.labels ?? {} });
        return recordObjective(ctx, thread, { objective: objective.id, ...(undo ? { undo } : {}) }, { line: seen });
    }

    /** hooks.replayGuard for kind quest.objective (undefined for any other kind). */
    function replayObjective({ state, query, hash }, info) {
        const guard = info.guard;
        if (guard?.predicate?.kind !== 'quest.objective') return undefined;
        const off = reason => ({ ok: false, reason: reason ?? 'The objective\'s action, acceptance or quest changed.' });
        const pin = pinned(state?.domains?.rules);
        if (!pin || typeof buildGuard !== 'function' || guard.version !== 2 || guard.rulesHash !== pin.hash || guard.epoch !== stateEpoch(state)) return off('The quest rules or epoch changed.');
        const payload = guard.predicate.payload;
        const threads = threadsOf(state);
        const thread = threads.find(row => row.id === payload?.thread);
        const recorded = record(info.recorded);
        const external = record(recorded.external);
        if (!thread) return off('The quest is no longer present.');
        // The scene a visit was seen in is the state's own: taking back the reply that moved the party takes the visit back.
        if (typeof external.scene === 'string' && state?.domains?.scene?.place?.name !== external.scene) return off('The party is no longer at that place.');
        const facts = { hash, ix: indexOfState(state), thread, epoch: guard.epoch, threads, combat: state?.domains?.combat, progress: state?.domains?.progress,
            clock: state?.domains?.director?.time?.minutes ?? null, proofs: ids => (ids.length ? query('story.evidence', { ids }) : []), ...external };
        const plan = planObjective(facts, { objective: payload.objective, ...(payload.undo ? { undo: payload.undo } : {}), ...(payload.proof !== undefined ? { proof: payload.proof } : {}), ...(payload.fight !== undefined ? { fight: payload.fight } : {}) });
        if (!plan.ok) return off(plan.message);
        const expected = buildGuard({ hash, owner: guard.owner, epoch: guard.epoch, source: info.source, rulesHash: pin.hash, kind: 'quest.objective', payload, inputs: plan.inputs });
        return expected.inputHash === guard.inputHash ? { ok: true } : off();
    }
    return { recordObjective, captureObjective, replayObjective };
}

/** What the command takes: a selector, the objective and either the fight that proves it or a proof to cite. */
export const OBJECTIVE_FIELDS = ['id', 'key', 'objective', 'fight', 'proof'];

/**
 * The objectives a reply's afterCapture asks code to prove: a sealed victory over a quest's foe that no quest has counted yet, and
 * the party standing at a visit objective's place. Reads the state and the two queries it needs; asks for nothing the host would not
 * run again. → [{ type: 'quest.objective', payload }].
 */
export function pendingObjectives(view) {
    const state = view?.state;
    const ix = indexOfState(state);
    if (!ix) return [];
    const epoch = stateEpoch(state);
    const claims = state?.meta?.claims ?? {};
    const clock = state?.domains?.director?.time?.minutes ?? null;
    const fights = Object.values(record(state?.domains?.combat?.beaten)).filter(entry => isObject(entry) && entry.won === true)
        .sort((a, b) => (a.rev - b.rev) || (a.fight < b.fight ? -1 : 1));
    const out = [];
    for (const thread of threadsOf(state)) {
        const quest = thread.rpg;
        if (!quest || quest.id !== thread.id || quest.state !== 'active' || quest.settlement || thread.status !== 'active' || !thread.taken) continue;
        if (quest.deadline !== null && !(safe(clock) && clock < quest.deadline)) continue;
        for (const objective of quest.objectives) {
            if (objective.kind !== 'kill' && objective.kind !== 'visit') continue;
            const rows = Object.values(quest.evidence).filter(row => row.objective === objective.id);
            let have = rows.reduce((sum, row) => sum + row.amount, 0);
            const need = objective.kind === 'kill' ? objective.count : 1;
            if (have >= need || rows.length >= evidenceLimit(objective)) continue;
            if (objective.kind === 'visit') {
                if (ask(view.query, 'atlas.canonical')?.id === objective.place) out.push({ type: 'quest.objective', payload: { id: thread.id, objective: objective.id } });
                continue;
            }
            for (const entry of fights) {
                const won = killSource({ ix, quest, combat: state.domains.combat, progress: state.domains.progress }, objective, entry.fight);
                if (!won.ok || Object.hasOwn(claims, killClaim(epoch, won.batch.id, objective.foe))) continue;
                out.push({ type: 'quest.objective', payload: { id: thread.id, objective: objective.id, fight: won.fight } });
                have += won.count;
                if (have >= need) break;
            }
        }
    }
    return out;
}
