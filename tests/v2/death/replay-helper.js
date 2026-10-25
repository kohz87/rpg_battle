import assert from 'node:assert/strict';

// Keep the genesis checkpoint (the host's domain initialization), remove every later cache,
// replay all surviving blocks, then put the caches back and compare that selection too.
export function assertFullReplay(w) {
    const snapshot = () => structuredClone({ domains: w.head().domains, claims: w.head().meta.claims });
    const before = snapshot();
    const removed = [];
    const seen = new Set();
    let genesis = null;
    for (const message of w.host.ctx.chat) {
        const record = message.extra?.storySuite;
        if (record?.checkpoint) { genesis = record; break; }
    }
    for (const message of w.host.ctx.chat) {
        for (const record of [message.extra?.storySuite, ...(message.swipe_info ?? []).map(s => s.extra?.storySuite)]) {
            if (!record || record === genesis || seen.has(record)) continue;
            seen.add(record);
            if (Object.hasOwn(record, 'checkpoint')) {
                removed.push([record, record.checkpoint]);
                delete record.checkpoint;
            }
        }
    }
    try {
        w.host.store.rebuild();
        assert.deepEqual(snapshot(), before, 'checkpoint state differs from full replay');
    } finally {
        for (const [record, checkpoint] of removed) record.checkpoint = checkpoint;
        w.host.store.rebuild();
    }
    assert.deepEqual(snapshot(), before, 'restored checkpoint selection differs from full replay');
}
