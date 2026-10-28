// The pure side of the generative offers tests: the Bluewatch 1.6.0 pin of the legacy fixture (no host), the pack's own rank ladder and foe order,
// and `env()`, what `matchOffer` and `matchTrainer` read (GENERATIVE_OFFERS_SPEC §11.1).
import { readFileSync } from 'node:fs';
import { parseChanges } from '../../../vendor/story-block/src/v2/capture.js';
import { indexOf } from '../../../../src/v2/rules/graph.js';
import { pinOf } from '../../../../src/v2/rules/pin.js';
import { ladderFrom } from '../../../../src/v2/quests/ranks.js';
import { offerKey } from '../../../../src/v2/quests/offer-match.js';
import { PACK, PACK_KEY, VILLAGE } from './bluewatch.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/pinned-2.2.0.json', import.meta.url), 'utf8'));
const rules = fixture.head.domains.rules;
export const PIN = Object.freeze({ hash: rules.rulesHash, resolved: rules.pin.resolved });
export const IX = indexOf(pinOf({ domains: { rules } }));
export const LADDER = ladderFrom(PACK.content.ranks);
export const ORDER = PACK.content.creatures.map(creature => `${PACK_KEY}/${creature.slug}`);
export const COPPER = PACK.currency;
export const CROWNS = { name: 'crown', plural: 'crowns', coins: [] };
export const PLACE = { id: VILLAGE, name: 'Bluewatch Village' };

/** A pin with `change(resolved)` applied to a copy of the Bluewatch 1.6.0 one (explicit bounds, aliases and offer words stand in for Bluewatch 1.7.0). */
export function derivedPin(change) {
    const resolved = structuredClone(rules.pin.resolved);
    change(resolved);
    return { hash: PIN.hash, resolved };
}
export const ixOf = pin => indexOf({ ...structuredClone(rules.pin), resolved: pin.resolved, rulesHash: pin.hash });

/**
 * What the matchers read. `level`: the PC's level (3); `currency`: COPPER (the pack's own) or CROWNS (the reader's Coins setting); `tier`: the world's
 * danger tier at the place, or null for unknown; `clock`: whether the story clock is set; `threads`: [{ key, state }] RPG quests the director holds;
 * `declined`: offer keys with a far-out decision on record.
 */
export function env({ level = 3, currency = COPPER, tier = 0, clock = true, pin = PIN, threads = [], declined = [], words = null, questOrder = null } = {}) {
    const ix = pin === PIN ? IX : ixOf(pin);
    const active = [{ id: 'ac_test0001', level: level ?? 1, class: `${PACK_KEY}/militiaman`, stats: {} }];
    return {
        pin, ix, ladder: LADDER, level, currency, order: ORDER, questOrder, clock, here: PLACE, words: words ?? pin.resolved.manifest.offerWords ?? null,
        area: { place: VILLAGE, tier, source: tier === null ? 'unknown' : 'world', sourceId: null, scale: 1, allowedFoes: [], allowedTags: [] },
        inputs: { party: { pc: 'ac_test0001', active }, flags: { values: {} }, threads: [], items: [], activeActors: ['ac_test0001'], proofs: [], place: PLACE },
        thread: name => {
            const row = threads.find(entry => offerKey(entry.key) === offerKey(name));
            return row ? { id: 'th_test0001', key: row.key, rpg: { state: row.state } } : null;
        },
        declined: key => declined.includes(key),
    };
}

/** The parsed line of a `+ quest` or `+ trainer` text. */
export function lineOf(text) {
    const { lines, problems } = parseChanges(text);
    if (problems.length || lines.length !== 1) throw new Error(`not one change line: ${text} ${problems.join()}`);
    return lines[0];
}
