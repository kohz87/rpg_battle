import { lifeOf } from '../rules/sheet.js';

// The host's participant barrier owns native selection. Historical deliveries stay in its audit journal
// after their evidence leaves the story; they are not a mismatch once the host confirms the selected head.
// Keep the visible remedy for an unavailable checkpoint or a host without head-selection support.
export function historySelectionProblem(state, journal, contract = null) {
    if (contract?.api === 2 && contract.participantsReady === true) return null;
    const lastRestore = journal.findLast(e => e.kind === 'restore' && Object.keys(e.participants ?? {}).length && ['complete', 'retracted', 'committed', 'participants-pending', 'acked'].includes(e.phase));
    if (lastRestore && !state.domains.savepoints?.returns?.[lastRestore.return]) return 'A return was recorded, but this chat has changed since and the companions\' records no longer match it. To go on, restore a save point from before that return, or put the changed reply back.';
    const after = lastRestore ? journal.indexOf(lastRestore) : -1;
    const active = new Set(Object.values(state.domains.death?.outbox ?? {}).flatMap(o => o.native.map(n => n.event)));
    if (journal.some((e, i) => i > after && e.kind === 'native-event' && e.phase === 'done' && !active.has(e.event))) return 'A companion\'s death was recorded, but the reply that caused it is gone, so the companion\'s record and the story disagree. To go on, restore a save point from before the death, or put that reply back.';
    return null;
}

export function generationProblem(state, host, contract = null) {
    const outboxes = Object.values(state.domains.death?.outbox ?? {});
    const pending = outboxes.flatMap(o => o.native);
    if (!host) return pending.length ? 'The native death awaits the authenticated host coordinator.' : null;
    const journal = host.journal();
    const changed = historySelectionProblem(state, journal, contract);
    if (changed) return changed;
    if (contract?.api === 2 && contract.participantsReady === false) return 'The companions\' records are catching up with the selected story. Please wait; if this continues, restore a save point from before the death, or put that reply back.';
    const undelivered = pending.some(n => !journal.some(e => e.kind === 'native-event' && e.phase === 'done' && e.event === n.event && e.npc === n.npc));
    return undelivered ? 'The native death awaits its durable acknowledgment.' : null;
}

// RB's dependency on delivered native deaths, checked by the host before releasing its selection barrier.
// A surviving delivered death needs a dead dossier; a retracted death needs its living checkpoint.
// A new, undelivered death is left to the normal outbox hold and must not prevent its own delivery.
export function nativeSelection({ state, query }, { events }) {
    const active = new Set(Object.values(state.domains.death?.outbox ?? {}).flatMap(outbox => outbox.native.map(item => item.event)));
    for (const actor of Object.values(state.domains.party?.actors ?? {})) {
        const delivered = events.filter(event => event.npc === actor.npcId && event.participant === 'npc-state-delta');
        if (!delivered.length) continue;
        const dead = lifeOf(actor) === 'dead';
        if (dead && !delivered.some(event => active.has(event.event))) continue;
        const dossier = query('npc.dossier', { id: actor.npcId });
        if (!dossier || (dossier.lifeState === 'deceased') !== dead) return {
            ok: false,
            reason: 'A companion\'s record could not follow the selected story. To go on, restore a save point from before the death, or put the changed reply back.',
        };
    }
    return { ok: true };
}
