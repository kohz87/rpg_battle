// B6 closed records, fixed before the handlers. This domain is restored by SB like every other domain.
// Event = { id, batch, source, actor, npcId, cause, evidence:[{id,payloadHash}], intervention:null|Rescue }.
// Rescue = { proof, payloadHash, payment, paymentHash }; the proof carries the full validated rescue payload (proofs.js).
// Batch = { id, source, events:EventId[], status:'pending'|'complete', result:null|{id,hash} }.
// Outbox = { batch, result:{id,hash}, events:EventId[], native:[{event,npc}], returnRequested, snapshot }.
// BatchResult = { v:1, kind:'death', batch, source, epoch, ruleset, minute, events:[Result], snapshot, returnRequested }.
// Result = { ...Event, kind:'pc'|'companion', check:null|{die,mod,dc,total}, outcome:'dead'|'gravely-injured' }.
// snapshot = null | { id, payloadHash }; a missing/unavailable selected target NEVER authorizes a substitute.
// SB pins these bytes + preRestore payload before prepare, then owns the immutable prepared manifest, token/head,
// before/after participant checkpoints, per-participant acks, return and cue. They must not live only in this restored slice.
import { int, isActorId, isHash, isObject, isRecordId } from '../rules/ids.js';
import { sealedProblem } from '../fight/batch.js';

export const initialDeath = () => ({ schema: 2, events: {}, batches: {}, outbox: {}, wakes: {} });
export const closed = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const sourceOK = s => closed(s, ['sid', 'swipeKey', 'evidence', 'ordinal']) && isRecordId(s.sid) && isRecordId(s.swipeKey) && isRecordId(s.evidence) && int(s.ordinal, 0, 1000000);
export const refOK = r => closed(r, ['id', 'hash']) && isRecordId(r.id) && isHash(r.hash);
export const snapshotOK = s => s === null || (closed(s, ['id', 'payloadHash']) && isRecordId(s.id) && isHash(s.payloadHash));
const proofOK = p => closed(p, ['id', 'payloadHash']) && isRecordId(p.id) && isHash(p.payloadHash);
export const eventOK = e => closed(e, ['id', 'batch', 'source', 'actor', 'npcId', 'cause', 'evidence', 'intervention']) && isRecordId(e.id) && isRecordId(e.batch) && sourceOK(e.source) && isActorId(e.actor)
    && (e.npcId === null || /^np_[0-9a-z]{8}$/.test(e.npcId)) && ['narrative', 'execution', 'wipe'].includes(e.cause)
    && Array.isArray(e.evidence) && e.evidence.length <= 32 && e.evidence.every(proofOK) && new Set(e.evidence.map(p => p.id)).size === e.evidence.length
    && (e.cause === 'wipe' ? e.evidence.length === 0 && e.intervention === null : e.evidence.length > 0)
    && (e.intervention === null || (closed(e.intervention, ['proof', 'payloadHash', 'payment', 'paymentHash']) && isRecordId(e.intervention.proof) && isHash(e.intervention.payloadHash) && isRecordId(e.intervention.payment) && isHash(e.intervention.paymentHash)));

export function resultOK(bytes) {
    if (!(closed(bytes, ['v', 'kind', 'batch', 'source', 'epoch', 'ruleset', 'minute', 'events', 'snapshot', 'returnRequested']) && bytes.v === 1 && bytes.kind === 'death'
        && isRecordId(bytes.batch) && sourceOK(bytes.source) && isRecordId(bytes.epoch) && isHash(bytes.ruleset) && (bytes.minute === null || int(bytes.minute)) && snapshotOK(bytes.snapshot)
        && typeof bytes.returnRequested === 'boolean' && Array.isArray(bytes.events) && bytes.events.length > 0 && bytes.events.length <= 64)) return false;
    if (!bytes.events.every(isObject) || new Set(bytes.events.map(e => e.id)).size !== bytes.events.length || new Set(bytes.events.map(e => e.actor)).size !== bytes.events.length) return false;
    if (bytes.returnRequested !== bytes.events.some(e => e.kind === 'pc' && e.outcome === 'dead') || !bytes.returnRequested && bytes.snapshot !== null) return false;
    return bytes.events.every((row, i) => {
            if (!closed(row, ['id', 'batch', 'source', 'actor', 'npcId', 'cause', 'evidence', 'intervention', 'kind', 'check', 'outcome'])) return false;
            const { check, outcome, kind, ...event } = row;
            return eventOK(event) && event.batch === bytes.batch && ['pc', 'companion'].includes(kind)
                && (i === 0 || bytes.events[i - 1].actor < row.actor)
                && event.source.sid === bytes.source.sid && event.source.swipeKey === bytes.source.swipeKey
                && outcome === (event.cause === 'wipe' ? 'dead' : event.intervention || check?.total >= check?.dc ? 'gravely-injured' : 'dead')
                && (event.cause === 'wipe' || event.intervention ? check === null : closed(check, ['die', 'mod', 'dc', 'total']) && int(check.die, 1, 20) && int(check.mod, -30, 30) && int(check.dc, 1, 40) && check.total === check.die + check.mod);
        });
}

export function deathProblems(d) {
    if (!closed(d, ['schema', 'events', 'batches', 'outbox', 'wakes']) || d.schema !== 2 || !['events', 'batches', 'outbox', 'wakes'].every(k => isObject(d[k]))) return ['death: expected schema 2 events, batches, outbox and wakes'];
    for (const [id, e] of Object.entries(d.events)) if (!eventOK(e) || id !== e.id || !Array.isArray(d.batches[e.batch]?.events) || !d.batches[e.batch].events.includes(id)) return ['death: invalid event or batch reference'];
    for (const [id, b] of Object.entries(d.batches)) {
        if (!closed(b, ['id', 'source', 'events', 'status', 'result']) || b.id !== id || !isRecordId(id) || !sourceOK(b.source) || !Array.isArray(b.events) || !b.events.length || b.events.length > 64 || new Set(b.events).size !== b.events.length || !b.events.every(e => d.events[e]?.batch === id)
            || !['pending', 'complete'].includes(b.status) || (b.status === 'pending' ? b.result !== null : !refOK(b.result))) return ['death: invalid batch'];
    }
    if (Object.values(d.batches).some(b => (b.status === 'complete') !== Object.hasOwn(d.outbox, b.id))) return ['death: completed batch must retain its outbox'];
    for (const [id, o] of Object.entries(d.outbox)) if (!closed(o, ['batch', 'result', 'events', 'native', 'returnRequested', 'snapshot']) || id !== o.batch || !d.batches[id] || d.batches[id].status !== 'complete' || !refOK(o.result) || JSON.stringify(o.result) !== JSON.stringify(d.batches[id].result)
        || !Array.isArray(o.events) || o.events.length !== d.batches[id].events.length || new Set(o.events).size !== o.events.length || !o.events.every(e => d.events[e]?.batch === id) || !Array.isArray(o.native) || new Set(o.native.map(n => n?.event)).size !== o.native.length || !o.native.every(n => closed(n, ['event', 'npc']) && o.events.includes(n.event) && d.events[n.event]?.npcId === n.npc)
        || typeof o.returnRequested !== 'boolean' || !snapshotOK(o.snapshot)) return ['death: invalid outbox'];
    for (const [id, w] of Object.entries(d.wakes)) if (!isRecordId(id) || !closed(w, ['return', 'cue']) || id !== w.return || !isRecordId(w.cue)) return ['death: invalid wake'];
    return [];
}

/** Additional validation for death entries in progress.batches; fight entries remain B4's. */
export const deathResultProblem = entry => sealedProblem(entry) || (resultOK(entry.bytes) ? '' : 'death: invalid sealed result');
