// Unmodified production RB and SD definitions, activated with a checked frozen pack and real host preflight.
import { existsSync } from 'node:fs';
import { createHost } from '../../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../../src/v2/module.js';
import { smallRulesPack, foesPack, pinFor, ref } from '../../progress/helpers/fixture.js';

const path = new URL('../../../../../Story_director/src/v2/module.js', import.meta.url);
export const director = existsSync(path) ? (await import(path.href)).createModule : null;
export const skip = !director && 'Sibling Story Director checkout is absent.';
export const herb = { id: ref('herb'), name: 'Herb', kind: 'goods', rarity: 'common', value: 1, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' };

export function questPin(over = {}, more = []) {
    const pack = smallRulesPack();
    pack.content.items = [{ ...herb, id: undefined, slug: 'herb' }];
    delete pack.content.items[0].id;
    pack.content.rules[0].itemRules = [{ def: 'herb', allowedSlots: [], hands: 0, requires: {}, weight: 1 }];
    pack.content.quests = [{ slug: 'job', name: 'Mill job', category: 'side', giver: null, turnInPlace: null,
        requirements: [], objectives: [{ id: 'ob_00000001', kind: 'collect', def: 'herb', count: 2, consume: true }],
        reward: { coin: 30, xp: 25, items: [] }, durationMinutes: null, repeat: null, chain: null, ...over }, ...more];
    return { ...pinFor(JSON.stringify([over, more]), pack), defs: { [herb.id]: herb } };
}

export async function realQuestHost(t, { given = questPin(), st = null, modules = [] } = {}) {
    const host = await createHost({ modules: [director(), ...modules], ...(st ? { st } : {}) });
    const sdk = host.sdk;
    await sdk.registerModule(createModule({ settings: () => sdk.settings('rpg-battle'), rules: given,
        preflight: sdk.preflight({ module: 'rpg-battle', rulesVersion: 2 }) }));
    t.after(() => host.close());
    if (!st) {
        const made = await sdk.command('party.create', { name: 'Ren', preset: 'fighter', class: ref('c0') });
        if (!made.ok) throw new Error(made.message);
    }
    return host;
}

/** A kill quest on the golden fight pack: two Wolves (the pack's creature) for the same reward. */
export function killPin(over = {}, more = []) {
    const pack = foesPack();
    pack.content.quests = [{ slug: 'job', name: 'Mill job', category: 'side', giver: null, turnInPlace: null,
        requirements: [], objectives: [{ id: 'ob_00000001', kind: 'kill', foe: 'wolf', count: 2 }],
        reward: { coin: 30, xp: 25, items: [] }, durationMinutes: null, repeat: null, chain: null, ...over }, ...more];
    const rope = { id: ref('rope'), name: 'Rope', kind: 'goods', rarity: 'common', value: 2, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' };
    return { ...pinFor(`kill${JSON.stringify([over, more])}`, pack), defs: { [rope.id]: rope } };
}
