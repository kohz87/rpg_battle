// E6a journals native changes but cannot reselect them after a swipe/delete. Refuse RB generation/delivery
// when that missing host step would expose mismatched state. This does not claim to implement E6b's scan barrier.
export function historySelectionProblem(state, journal) {
    const lastRestore = journal.findLast(e => e.kind === 'restore' && Object.keys(e.participants ?? {}).length && ['complete', 'retracted', 'committed', 'participants-pending', 'acked'].includes(e.phase));
    if (lastRestore && !state.domains.savepoints?.returns?.[lastRestore.return]) return 'A return was recorded, but this chat has changed since and the companions\' records no longer match it. To go on, restore a save point from before that return, or put the changed reply back.';
    const after = lastRestore ? journal.indexOf(lastRestore) : -1;
    const active = new Set(Object.values(state.domains.death?.outbox ?? {}).flatMap(o => o.native.map(n => n.event)));
    if (journal.some((e, i) => i > after && e.kind === 'native-event' && e.phase === 'done' && !active.has(e.event))) return 'A companion\'s death was recorded, but the reply that caused it is gone, so the companion\'s record and the story disagree. To go on, restore a save point from before the death, or put that reply back.';
    return null;
}

export function generationProblem(state, host) {
    const outboxes = Object.values(state.domains.death?.outbox ?? {});
    const pending = outboxes.flatMap(o => o.native);
    if (!host) return pending.length ? 'The native death awaits the authenticated host coordinator.' : null;
    const journal = host.journal();
    const changed = historySelectionProblem(state, journal);
    if (changed) return changed;
    const undelivered = pending.some(n => !journal.some(e => e.kind === 'native-event' && e.phase === 'done' && e.event === n.event && e.npc === n.npc));
    return undelivered ? 'The native death awaits its durable acknowledgment.' : null;
}
