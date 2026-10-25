import { initialDeath, deathProblems } from './records.js';
import { commands, recordLethal, intervene } from './commands.js';
import { replayGuard } from './guard.js';
import { indexOfState } from '../rules/graph.js';
import { generationProblem } from './selection.js';

export { recordLethal, intervene };
export { initialDeath, deathProblems };

export function afterCapture(view) {
    if (!indexOfState(view.state)) return { commands: [] };
    const batches = Object.values(view.state.domains.death?.batches ?? {}).filter(b => b.status === 'pending');
    return { commands: batches.map(b => ({ type: 'death.resolve', payload: { event: [...b.events].sort()[0] } })) };
}

// Registered only with the rules-v2 parts after preflight, never added to an old chat by module.js.
export function createDeathPart({ host = () => null } = {}) { return {
    domains: { death: { version: 2, initial: initialDeath, absent: initialDeath, validate: deathProblems } },
    commands,
    replayQueries: ['party.actor', 'party.actors', 'return.status'],
    kinds: {
        lethal: { grammar: '! lethal <actor ID> | cause: narrative|execution | evidence: <comma-separated IDs>', apply: (ctx, line) => recordLethal(ctx, { actor: line.name, cause: line.labels?.cause, evidence: String(line.labels?.evidence ?? '').split(',').map(s => s.trim()) }) },
        intervention: { grammar: '! intervention <event ID> | evidence: <ID>', apply: (ctx, line) => intervene(ctx, { event: line.name, evidence: line.labels?.evidence }) },
    },
    hooks: { replayGuard, afterCapture,
        canGenerate(view) {
            if (!indexOfState(view.state)) return { ok: true };
            const reason = generationProblem(view.state, host());
            return reason ? { ok: false, reason, action: false } : { ok: true };
        },
    },
}; }
export const part = createDeathPart();
