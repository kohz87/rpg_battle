// The five P23 writers: one owner, one optimistic hash and an atomic retry ledger.
import { hashJson } from './hash.js';
import { lineKey } from '../../changes.js';
import { THREAD_KINDS } from './convert.js';
import { replyDraft, replyTurn } from './domain.js';
import { neutralAcceptance, prepareThreadWrite, threadProjection, threadWriteEntry } from './thread-writes.js';
import { closed, cursor, hash, map, recordId, source, text, validQuest } from './quest-shape.js';

const neutralFields = new Set(['desc', 'now', 'then', 'on', 'due', 'shown', 'leg', 'arrive', 'place', 'people', 'encounter', 'reach', 'goal', 'step', 'progress', 'giver']);
const copy = value => structuredClone(value);
const same = (ctx, a, b) => ctx.hash(a) === ctx.hash(b);
const fail = (ctx, code, message) => ctx.fail(code, message);
const reply = result => ({ summary: 'Thread updated.', narrate: false, data: result });

function authority(ctx, payload, rbOnly) {
    // ctx.caller is host-authenticated; the host refuses dispatch from dormant modules.
    if ((rbOnly || Object.hasOwn(payload ?? {}, 'quest')) && ctx.caller !== 'rpg-battle') {
        fail(ctx, 'REFUSED', 'Only ready RPG Battle may write a quest extension.');
    }
}
function shape(ctx, type, payload) {
    const fields = {
        'threads.offer': [['write', 'thread', 'kind', 'key', 'summary', 'fields', 'expectedHash'], ['quest']],
        'threads.accept': [['write', 'thread', 'expectedHash'], ['acceptance', 'quest']],
        'threads.link': [['write', 'thread', 'quest', 'expectedHash'], []],
        'threads.questWrite': [['write', 'thread', 'quest', 'expectedHash'], []],
        'threads.close': [['write', 'thread', 'expectedHash', 'instance', 'outcome', 'reason', 'settlement'], []],
    }[type];
    if (!closed(payload, ...fields) || !recordId(payload.thread) || !payload.thread.startsWith('th_')
        || !recordId(payload.write) || (type !== 'threads.offer' && !hash(payload.expectedHash))) fail(ctx, 'INVALID', 'Invalid thread writer payload.');
    if (Object.hasOwn(payload, 'quest') && (!validQuest(payload.quest) || payload.quest.id !== payload.thread)) fail(ctx, 'INVALID', 'Invalid Quest extension.');
}
function acceptance(ctx, thread, proofId) {
    let selected = proofId;
    if (!selected && ctx.cause === 'ui' && (!ctx.caller || ctx.caller === 'rpg-battle')) {
        selected = ctx.proof({ kind: 'acceptance', payload: { thread: thread.id, selection: thread.key } }).id;
    }
    const checked = neutralAcceptance(thread, ctx.query('story.evidence', selected ? { ids: [selected] } : {}), selected,
        { cause: ctx.cause, caller: ctx.caller });
    if (!checked.ok) fail(ctx, checked.code, checked.message);
    const at = typeof ctx.cursor === 'function' ? ctx.cursor() : null;
    if (!cursor(at) || !source(checked.proof.source)) fail(ctx, 'DEPENDENCY_UNAVAILABLE', 'Thread acceptance needs the host cursor and Source.');
    return { source: copy(checked.proof.source), cursor: copy(at), minute: ctx.time(), proof: checked.proof.id };
}
function activeQuest(ctx, quest, accepted) {
    if (quest.state !== 'active' || quest.settlement !== null || !accepted || !same(ctx, quest.acceptedCursor, accepted.cursor)
        || quest.acceptedAt !== accepted.minute) fail(ctx, 'CONFLICT', 'The quest must retain the original acceptance cursor and minute.');
}
function survivingAcceptance(ctx, thread) {
    const accepted = thread.acceptance;
    if (!accepted) fail(ctx, 'REFUSED', 'The original acceptance evidence is missing.');
    const proof = ctx.query('story.evidence', { ids: [accepted.proof] }).find(p => p.id === accepted.proof);
    if (!proof || proof.kind !== 'acceptance' || proof.owner !== 'story-director' || proof.payload.thread !== thread.id
        || !same(ctx, proof.source, accepted.source)) fail(ctx, 'REFUSED', 'The original acceptance evidence is inactive.');
    const checked = neutralAcceptance(thread, [proof], proof.id, { cause: Object.hasOwn(proof.payload, 'selection') ? 'ui' : ctx.cause, caller: ctx.caller });
    if (!checked.ok) fail(ctx, checked.code, checked.message);
}
function compatible(thread) {
    // Compatibility fields are projections of this extension; they never authorize payouts.
    const q = thread.rpg;
    const first = q.objectives[0];
    thread.target = first?.kind === 'collect' || first?.kind === 'kill'
        ? { noun: first.def ?? first.foe, count: first.count, kind: first.kind === 'collect' ? 'items' : 'foes' } : null;
    thread.reward = { amount: q.reward.coin, each: false, unit: '', text: String(q.reward.coin) };
    thread.ready = null;
}

/**
 * Objective evidence is append-only and each row stands on a surviving proof that names this thread, this instance and this objective
 * (docs/v2/EVIDENCE.md, B3): a stored row is never changed or removed here (taking its block back is how it goes), a new one may not ride with
 * a terminal write, its proof must be active and bound to exactly this objective, and no proof counts twice, in this quest or any other.
 * Whether the proof means what the objective says is RPG Battle's (its payload); the binding is the thread's.
 */
function evidenceRows(ctx, director, thread, next) {
    const before = thread.rpg.evidence;
    for (const [key, row] of Object.entries(before)) if (!Object.hasOwn(next.evidence, key) || !same(ctx, next.evidence[key], row)) fail(ctx, 'REFUSED', 'Stored objective evidence cannot be changed or removed.');
    const added = Object.entries(next.evidence).filter(([key]) => !Object.hasOwn(before, key));
    if (!added.length) return;
    if (next.settlement !== null || next.state !== 'active') fail(ctx, 'REFUSED', 'Objective evidence is added only to an active quest.');
    const counted = new Set(Object.values(director.threads).flatMap(other => Object.values(other.rpg?.evidence ?? {}).map(row => row.proof)));
    for (const [, row] of added) {
        if (counted.has(row.proof)) fail(ctx, 'CLAIMED', 'That proof already counted for an objective.');
        counted.add(row.proof);
        const proof = ctx.query('story.evidence', { ids: [row.proof] }).find(item => item.id === row.proof);
        if (!proof) fail(ctx, 'NOT_FOUND', 'No active proof stands behind that evidence.');
        const said = proof.payload ?? {};
        if (said.thread !== next.id) fail(ctx, 'REFUSED', 'That proof is bound to another thread.');
        if (said.instance !== next.instance) fail(ctx, 'REFUSED', 'That proof is bound to another instance of the quest.');
        if (said.objective !== row.objective) fail(ctx, 'REFUSED', 'That proof is bound to another objective.');
    }
}

export function writeThread(type, ctx, payload) {
    authority(ctx, payload, ['threads.link', 'threads.questWrite', 'threads.close'].includes(type));
    shape(ctx, type, payload);
    const director = ctx.draft('director');
    const prepared = prepareThreadWrite(director, type, payload, ctx.hash);
    if (!prepared.ok) fail(ctx, prepared.code, prepared.message);
    if (prepared.retry) return reply(prepared.result);
    let thread = director.threads[payload.thread];
    if (thread?.kind === 'quest' && !thread.rpg && !Object.hasOwn(thread, 'acceptance')) fail(ctx, 'REFUSED', 'Quest from an earlier version (read only).');
    let result;
    if (type === 'threads.offer') {
        if (!THREAD_KINDS.includes(payload.kind) || !text(payload.key, 120, true) || !lineKey(payload.key)
            || !text(payload.summary, 600) || !map(payload.fields)
            || Object.entries(payload.fields).some(([k, v]) => !neutralFields.has(k) || !text(v, 600))) fail(ctx, 'INVALID', 'Invalid neutral thread fields.');
        const occupied = director.threads[director.keys[lineKey(payload.key)]];
        if (occupied?.status === 'active') fail(ctx, 'CONFLICT', 'This display key is already active.');
        if (Object.values(director.threads).filter(t => t.status === 'active').length >= 300
            || replyTurn(director).added >= 16) fail(ctx, 'LIMITED', 'The thread limit was reached.');
        if (payload.quest && (payload.quest.state !== 'offered' || payload.quest.acceptedAt !== null || payload.quest.acceptedCursor !== null || Object.keys(payload.quest.evidence).length)) fail(ctx, 'REFUSED', 'A new quest must be offered without acceptance or evidence.');
        thread = { id: payload.thread, kind: payload.kind, key: payload.key, summary: payload.summary, fields: copy(payload.fields),
            status: 'active', offer: true, taken: null, ended: null, target: null, reward: null, acceptance: null, rev: ctx.rev,
            track: { order: Math.max(-1, ...Object.values(director.threads).map(t => t.track?.order ?? 0)) + 1,
                created: { turn: director.turn?.n ?? 0, time: ctx.time() }, changed: { turn: director.turn?.n ?? 0, time: ctx.time() },
                seen: { turn: director.turn?.n ?? 0, time: ctx.time() } } };
        if (payload.quest) thread.rpg = copy(payload.quest);
        director.threads[thread.id] = thread;
        director.keys[lineKey(thread.key)] = thread.id;
        const turn = replyDraft(director);
        if (turn) turn.added++;
        result = { thread: thread.id, hash: ctx.hash(threadProjection(thread)) };
    } else if (type === 'threads.accept') {
        if (thread.status !== 'active' || !thread.offer || thread.taken) fail(ctx, 'REFUSED', 'This thread is not an unaccepted offer.');
        if (thread.rpg && !payload.quest) fail(ctx, 'REFUSED', 'An RPG offer requires its matching active Quest.');
        const accepted = acceptance(ctx, thread, payload.acceptance);
        if (ctx.caller !== 'rpg-battle') {
            if (!recordId(ctx.epoch)) fail(ctx, 'DEPENDENCY_UNAVAILABLE', 'Acceptance requires the host epoch.');
            const given = ctx.query('story.evidence', { ids: [accepted.proof] })[0];
            const external = given && !same(ctx, given.source, ctx.source) ? accepted.proof : null;
            const inputs = { thread: threadProjection(thread), proof: external };
            const proof = external ? [given] : [];
            ctx.replayGuard({ owner: 'story-director', version: 2, epoch: ctx.epoch, rulesHash: null,
                inputHash: ctx.hash({ inputs, proof }), predicate: { kind: 'threads.accept', inputs } }, { proof });
        }
        if (payload.quest) {
            activeQuest(ctx, payload.quest, accepted);
            if (Object.keys(payload.quest.evidence).length) fail(ctx, 'REFUSED', 'A quest is taken on without objective evidence.');
            if (thread.rpg && (payload.quest.template !== thread.rpg.template || payload.quest.instance !== thread.rpg.instance)) fail(ctx, 'CONFLICT', 'Quest identity changed.');
            thread.rpg = copy(payload.quest);
            compatible(thread);
        }
        thread.offer = false;
        thread.taken = { rev: ctx.rev };
        thread.acceptance = accepted;
        thread.rev = ctx.rev;
        result = { thread: thread.id, hash: ctx.hash(threadProjection(thread)), accepted: true, linked: !!thread.rpg };
    } else if (type === 'threads.link') {
        if (thread.status !== 'active' || thread.offer || !thread.taken || thread.rpg) fail(ctx, 'REFUSED', 'Only an accepted neutral thread can be linked.');
        survivingAcceptance(ctx, thread);
        activeQuest(ctx, payload.quest, thread.acceptance);
        if (Object.keys(payload.quest.evidence).length) fail(ctx, 'REFUSED', 'A quest is taken on without objective evidence.');
        thread.rpg = copy(payload.quest);
        thread.rev = ctx.rev;
        compatible(thread);
        result = { thread: thread.id, instance: thread.rpg.instance, hash: ctx.hash(threadProjection(thread)) };
    } else if (type === 'threads.questWrite') {
        if (!thread.rpg || thread.status !== 'active' || thread.rpg.settlement) fail(ctx, 'REFUSED', 'This quest cannot be changed.');
        if (['id', 'template', 'instance'].some(k => thread.rpg[k] !== payload.quest[k])) fail(ctx, 'CONFLICT', 'Quest identity changed.');
        if (!same(ctx, thread.rpg.acceptedCursor, payload.quest.acceptedCursor) || thread.rpg.acceptedAt !== payload.quest.acceptedAt) fail(ctx, 'CONFLICT', 'Quest acceptance changed.');
        if (thread.rpg.state === 'offered' && payload.quest.state !== 'offered' || thread.rpg.state === 'active' && payload.quest.state === 'offered') fail(ctx, 'REFUSED', 'Use acceptance for that transition.');
        evidenceRows(ctx, director, thread, payload.quest);
        thread.rpg = copy(payload.quest);
        thread.rev = ctx.rev;
        compatible(thread);
        result = { thread: thread.id, instance: thread.rpg.instance, hash: ctx.hash(threadProjection(thread)) };
    } else {
        if (!Number.isInteger(payload.instance) || payload.instance < 1 || payload.instance > 1000000
            || !['done', 'failed', 'expired', 'abandoned'].includes(payload.outcome) || !text(payload.reason, 240) || !recordId(payload.settlement)) fail(ctx, 'INVALID', 'Invalid terminal thread transition.');
        const settlement = thread.rpg?.settlement;
        if (!settlement || thread.rpg.instance !== payload.instance || settlement.id !== payload.settlement || settlement.outcome !== payload.outcome) fail(ctx, 'CONFLICT', 'The matching terminal quest settlement is required.');
        if (thread.status !== 'active') {
            if (thread.ended?.outcome !== (payload.outcome === 'expired' ? 'failed' : payload.outcome)) fail(ctx, 'CONFLICT', 'This thread ended differently.');
        } else {
            if (!same(ctx, settlement.source, ctx.source)) fail(ctx, 'CONFLICT', 'Closure must share the terminal extension transaction.');
            if (!ctx.claim(settlement.claim)) fail(ctx, 'REFUSED', 'Closure must share the settlement transaction claim.');
            // One claim in the shared settlement root covers the extension, payout and journal.
            thread.status = 'resolved';
            thread.ended = { rev: ctx.rev, reason: payload.reason, outcome: payload.outcome === 'expired' ? 'failed' : payload.outcome };
            thread.rev = ctx.rev;
            ctx.call('chronicle.threadOutcome', { thread: thread.id, text: `${thread.key}: ${payload.outcome}.` });
        }
        result = { thread: thread.id, instance: payload.instance, outcome: payload.outcome, settlement: payload.settlement, hash: ctx.hash(threadProjection(thread)) };
    }
    director.writes ??= {};
    director.writes[payload.write] = threadWriteEntry(prepared, result);
    return reply(result);
}

export const threadCommands = Object.fromEntries(['offer', 'accept', 'link', 'questWrite', 'close']
    .map(name => [`threads.${name}`, (ctx, payload) => writeThread(`threads.${name}`, ctx, payload)]));

/** Neutral accept binds the offer and proof bytes, independent of transport revision/ordinal. */
export function threadReplayGuard({ state, query }, { guard, recorded }) {
    if (guard?.predicate?.kind !== 'threads.accept') return undefined;
    const off = () => ({ ok: false, reason: 'The offer or reader acceptance evidence changed.' });
    if (guard.version !== 2 || guard.epoch !== (state?.domains?.savepoints?.epoch ?? 'ep_00000000')) return off();
    const inputs = guard.predicate.inputs;
    const savedProof = recorded?.proof;
    if (!inputs?.thread || !Array.isArray(savedProof) || hashJson({ inputs, proof: savedProof }) !== guard.inputHash) return off();
    const thread = query('director.thread', { id: inputs.thread.id });
    const proof = inputs.proof ? query('story.evidence', { ids: [inputs.proof] }) : [];
    const semanticThread = value => {
        if (!value) return null;
        const { rev: _rev, ...rest } = value;
        return rest;
    };
    const semanticProofs = list => list.map(value => {
        const item = copy(value);
        if (item.source) delete item.source.ordinal;
        return item;
    });
    return hashJson(semanticThread(thread)) === hashJson(semanticThread(inputs.thread))
        && hashJson(semanticProofs(proof)) === hashJson(semanticProofs(savedProof))
        ? { ok: true } : off();
}
