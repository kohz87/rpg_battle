// Durable combat contributions and branch-local queries. Only the combat runtime writes
// these records; narration and the transient hand-off are never evidence. Pure.

export const EVIDENCE_VERSION = 1;

export function resultEvidence(fightId, result, { planId = null } = {}) {
    if (!fightId || !['victory', 'defeat', 'fled'].includes(result?.outcome)) throw new Error('Combat has not resolved.');
    return {
        id: String(fightId),
        planId,
        outcome: result.outcome,
        defeated: (result.enemies ?? []).filter(enemy => enemy.gone === 'down').map(enemy => ({
            id: `${fightId}:${enemy.id}`,
            // Display suffixes are assigned by enemiesFromRows, not part of the creature.
            name: String(enemy.questName ?? String(enemy.name ?? '').replace(/\s+[A-Z]$/, '')).trim(),
        })),
    };
}

export function appendEvidence(previous, event, owner) {
    const ledger = previous?.version === EVIDENCE_VERSION && previous.owner === owner
        ? previous : { version: EVIDENCE_VERSION, owner, events: [] };
    if (ledger.events.some(entry => entry.id === event.id)) return ledger;
    return { ...ledger, events: [...ledger.events, structuredClone(event)] };
}

export function queryEvidence(history, cursor) {
    if (cursor?.version !== EVIDENCE_VERSION || !cursor.anchor) return { availability: 'unavailable', events: [], revision: '' };
    const start = history.findIndex(entry => entry.owner === cursor.anchor);
    if (start < 0) return { availability: 'incomplete', events: [], revision: '' };
    const excluded = new Set(cursor.excluded ?? []);
    const seen = new Set();
    const events = [];
    for (const entry of history.slice(start)) {
        const ledger = entry.ledger;
        if (!ledger) continue;
        if (ledger.version !== EVIDENCE_VERSION || ledger.owner !== entry.owner) return { availability: 'incomplete', events: [], revision: '' };
        for (const event of ledger.events ?? []) {
            if (seen.has(event.id) || (entry.owner === cursor.anchor && excluded.has(event.id))) continue;
            seen.add(event.id);
            events.push(structuredClone(event));
        }
    }
    return { availability: 'available', events, revision: JSON.stringify(events) };
}
