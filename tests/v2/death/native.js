// Synthetic NSD-shaped participant, exercising the real host protocol. This is not the NSD production participant.
import { hashJson } from '../../../src/v2/rules/hash.js';
import { crash } from '../../vendor/story-block/src/v2/timeline/util.js';
export const NPC = 'np_00000001';
export function nativeFixture(saved = null) {
    const n = saved ?? { live: { map: { [NPC]: 'lyra' }, dossiers: { lyra: { name: 'Lyra', alive: true, trust: 7 } }, applied: [] }, checkpoints: {}, prepared: {}, returns: {}, seq: 0, fail: new Set(), missing: new Set(), calls: [] };
    const keep = () => {
        const checkpoint = `ck_${(++n.seq).toString(36).padStart(8, '0')}`;
        const hash = hashJson(n.live);
        n.checkpoints[checkpoint] = { hash, bytes: structuredClone(n.live) };
        return { checkpoint, hash, schema: 1 };
    };
    const failure = (code, message) => ({ ok: false, code, message });
    const call = (method, input, f) => {
        n.calls.push({ method, input });
        if (n.fail.has(method)) return failure('FAILED', `Native ${method} held.`);
        const out = f();
        if (n.crashAfter?.delete(method)) throw crash(`native.${method}.applied`);
        return out;
    };
    const participant = {
        schema: 1,
        checkpoint: input => call('checkpoint', input, () => ({ ok: true, ...keep() })),
        current: ({ hash }) => ({ ok: true, current: hashJson(n.live) === hash }),
        prepare: input => call('prepare', input, () => {
            const cp = n.checkpoints[input.checkpoint];
            if (!cp || n.missing.has(input.checkpoint)) return failure('SNAPSHOT_UNAVAILABLE', 'Missing native bytes.');
            if (cp.hash !== input.hash) return failure('CONFLICT', 'Changed native bytes.');
            const prepared = `pr_${(++n.seq).toString(36).padStart(8, '0')}`;
            n.prepared[prepared] = { checkpoint: input.checkpoint, return: input.return };
            n.returns[input.return] = { checkpoint: input.checkpoint, hash: cp.hash, status: 'prepared' };
            return { ok: true, prepared, hash: cp.hash };
        }),
        activate: input => call('activate', input, () => {
            const held = n.prepared[input.prepared];
            if (!held || held.return !== input.return) return failure('NOT_FOUND', 'Missing native preparation.');
            const cp = n.checkpoints[held.checkpoint];
            n.live = structuredClone(cp.bytes);
            n.returns[input.return] = { checkpoint: held.checkpoint, hash: cp.hash, status: 'active' };
            return { ok: true, checkpoint: held.checkpoint, hash: cp.hash };
        }),
        abort: input => call('abort', input, () => {
            if (n.returns[input.return]?.status === 'active') return failure('REFUSED', 'Already active.');
            const held = n.returns[input.return];
            if (held) held.status = 'aborted';
            return { ok: true, aborted: true };
        }),
        status: input => call('status', input, () => n.returns[input.return] ? { ok: true, ...n.returns[input.return] } : failure('NOT_FOUND', 'No return.')),
        applyEvent: input => call('applyEvent', input, () => {
            if (!n.live.dossiers[input.nativeKey]) return failure('REFUSED', 'No dossier.');
            if (!n.live.applied.includes(input.event)) {
                n.live.dossiers[input.nativeKey].alive = false;
                n.live.applied.push(input.event);
            }
            const cp = keep();
            return { ok: true, event: input.event, checkpoint: cp.checkpoint, hash: cp.hash, ack: true };
        }),
    };
    return { native: n, module: { id: 'npc-state-delta', name: 'Synthetic native participant', version: '1.0.0', participant,
        queries: { 'npc.identity': (state, { id } = {}) => n.live.map[id] ? { id, nativeKey: n.live.map[id], name: n.live.dossiers[n.live.map[id]].name } : null } } };
}
