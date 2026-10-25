// Host composition only, never a synchronous command handler. `host` is SB's authenticated timeline.host;
// `timeline` is sdk.timeline; `state` reads RB's state; `command` is the host's system bus adapter.
// Signatures are copied from SB TIMELINE.md and coordinator.js. No capability is fabricated or exposed to a UI.
import { resolveBatch } from '../fight/batch.js';
import { deathResultProblem, refOK, outboxFor } from './records.js';
import { historySelectionProblem } from './selection.js';
import { hashJson } from '../rules/hash.js';

const fail = (code, message) => ({ ok: false, code, message });
export function createDeathCoordinator({ timeline, host, state, command, query, participant = 'npc-state-delta' }) {
    let queue = Promise.resolve();
    const ready = () => timeline && ['head', 'status', 'list'].every(k => typeof timeline[k] === 'function') && host && ['pin', 'journal', 'prepare', 'activate', 'nativeEvent', 'recover'].every(k => typeof host[k] === 'function') && typeof state === 'function' && typeof command === 'function' && typeof query === 'function';
    const selectionProblem = () => historySelectionProblem(state(), host.journal(), query('savepoint.contract', {}));
    // Recovery failures retain the host's code and RB's player-facing remedy. Only the host can settle its barrier.
    async function recoverSelection() {
        const recovered = await host.recover();
        const selection = selectionProblem();
        if (!recovered.ok) return selection ? { ...recovered, message: selection } : recovered;
        if (recovered.state !== 'idle') return fail('RESTORE_PENDING', selection ?? 'The host must finish the prepared native selection before delivery.');
        return selection ? fail('DEPENDENCY_UNAVAILABLE', selection) : recovered;
    }
    const tell = async id => {
        // A chat switch, a selected swipe or a failed participant must not deliver a wake on another head.
        const status = query('return.status', {});
        if (status?.lastReturn?.id !== id || status.lastReturn.status !== 'complete') return fail('STALE', 'That complete return is no longer selected.');
        return command('return.cue', { return: id });
    };
    async function deliver(ref) {
        if (!ready()) return fail('DEPENDENCY_UNAVAILABLE', 'RB needs the host-authenticated timeline coordinator.');
        if (!refOK(ref)) return fail('INVALID', 'A death delivery names its sealed { id, hash }.');
        const recovered = await recoverSelection();
        if (!recovered.ok) return recovered;
        const pinned = host.pin(ref.id);
        if (pinned && pinned.hash !== ref.hash) return fail('CONFLICT', 'The batch is pinned with another meaning.');
        const selected = query('return.status', {})?.lastReturn;
        if (pinned && selected?.id === pinned.return) {
            if (selected.status !== 'complete') return fail('RESTORE_PENDING', 'The native participants have not all agreed.');
            const told = await tell(selected.id);
            return told.ok ? { ok: true, return: selected.id, status: 'complete', receipt: told.receipt } : told;
        }
        const sealed = resolveBatch({ id: ref.id, state: state() });
        if (!sealed) return fail('NOT_FOUND', 'That death batch is not on the selected timeline.');
        if (sealed.hash !== ref.hash || deathResultProblem(sealed)) return fail('CONFLICT', 'The death result bytes or meaning changed.');
        const bytes = sealed.bytes;
        const outbox = state().domains.death?.outbox?.[bytes.batch];
        if (!outbox || outbox.result.id !== ref.id || outbox.result.hash !== ref.hash) return fail('REFUSED', 'The sealed batch has no committed RB outbox.');
        if (hashJson(outbox) !== hashJson(outboxFor(bytes, ref))) return fail('CONFLICT', 'The outbox does not match the sealed death decisions.');
        for (const native of outbox.native) {
            const head = await timeline.head({});
            if (!head.ok) return head;
            // The state may have changed while a participant was awaited; the next death must still be active.
            if (!resolveBatch({ id: ref.id, state: state() })) return fail('STALE', 'The lethal batch left the selected timeline.');
            const ack = await host.nativeEvent({ event: native.event, participant, kind: 'confirmed-death', npc: native.npc, expectedHead: head.headHash });
            if (!ack.ok) return ack;
        }
        if (!bytes.returnRequested) return { ok: true, status: 'complete', batchResult: ref };
        if (!bytes.snapshot) return fail('SNAPSHOT_UNAVAILABLE', 'The sealed death has no eligible saved target; it cannot select another.');
        const head = await timeline.head({});
        if (!head.ok) return head;
        const points = await timeline.list({});
        if (!points.ok) return points;
        const target = points.points.find(p => p.id === bytes.snapshot.id);
        if (!target || target.payloadHash !== bytes.snapshot.payloadHash) return fail('SNAPSHOT_UNAVAILABLE', 'The exact sealed target is unavailable; no other save is substituted.');
        const prepared = await host.prepare({ snapshot: bytes.snapshot.id, deathEvents: outbox.events, batchResult: ref, expectedHead: head.headHash });
        if (!prepared.ok) return prepared;
        // No RB write between prepare and activate: the host's token/head/manifest journal is authoritative.
        const activated = await host.activate({ prepared: prepared.prepared, expectedHead: head.headHash });
        if (!activated.ok || activated.status !== 'complete') return activated;
        const told = await tell(activated.return);
        return told.ok ? { ...activated, receipt: told.receipt } : told;
    }
    return Object.freeze({
        deliver(ref) {
            // Serialize duplicate clicks/deliveries, but keep the queue usable after a failure. SB owns chat binding and durability.
            const work = queue.then(() => deliver(ref));
            queue = work.catch(() => {});
            return work;
        },
        async recover() {
            if (!ready()) return fail('DEPENDENCY_UNAVAILABLE', 'RB needs the host-authenticated timeline coordinator.');
            const out = await recoverSelection();
            if (!out.ok) return out;
            const selected = query('return.status', {})?.lastReturn;
            if (selected?.status === 'complete') return tell(selected.id);
            return out;
        },
    });
}
