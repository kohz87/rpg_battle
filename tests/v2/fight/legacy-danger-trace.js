// Capture/offer/start/Auto/end domain bytes recorded on main 81cb400, including waves and loot.
import { withHero } from '../qa/helpers/harness.js';

export function legacyDangerTrace() {
    const traces = [];
    for (const tier of ['trivial', 'weak', 'normal', 'strong', 'deadly']) {
        for (const seed of [7, 101, 1000]) {
            const { h } = withHero({ seed });
            const snapshots = [];
            const keep = () => snapshots.push(JSON.stringify(h.state().domains));
            const captured = h.capture({ op: '!', kind: 'encounter', name: '6 Giant Rat', text: '', labels: { tier } });
            if (!captured.ok) throw new Error(captured.message);
            keep();
            const start = h.command('combat.start', { offer: h.query('combat.offers').at(-1).id });
            if (!start.ok) throw new Error(start.message);
            keep();
            if (h.query('combat.session').status === 'active') {
                const auto = h.command('combat.act', { action: { type: 'auto' } });
                if (!auto.ok) throw new Error(auto.message);
            }
            keep();
            const end = h.command('combat.end', {});
            if (!end.ok) throw new Error(end.message);
            keep();
            traces.push({ tier, seed, snapshots });
        }
    }
    return traces;
}
