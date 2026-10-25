// Real RB and SD definitions on the pinned host. Only B's not-yet-registered parts and checked pack are fixtures.
import { existsSync } from 'node:fs';
import { createHost } from '../../../vendor/story-block/testkit/host.js';
import { createModule } from '../../../../src/v2/module.js';
import { rulesParts, pinRules, registerPackDefs } from '../../../../src/v2/rules/index.js';
import { smallRulesPack, pinFor, ref } from '../../progress/helpers/fixture.js';

const path = new URL('../../../../../Story_director/src/v2/module.js', import.meta.url);
export const director = existsSync(path) ? (await import(path.href)).createModule : null;
export const skip = !director && 'Sibling Story Director checkout is absent.';
export const herb = { id: ref('herb'), name: 'Herb', kind: 'goods', rarity: 'common', value: 1, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' };

export function questPin(over = {}) {
    const pack = smallRulesPack();
    pack.content.items = [{ ...herb, id: undefined, slug: 'herb' }];
    delete pack.content.items[0].id;
    pack.content.rules[0].itemRules = [{ def: 'herb', allowedSlots: [], hands: 0, requires: {}, weight: 1 }];
    pack.content.quests = [{ slug: 'job', name: 'Mill job', category: 'side', giver: null, turnInPlace: null,
        requirements: [], objectives: [{ id: 'ob_00000001', kind: 'collect', def: 'herb', count: 2, consume: true }],
        reward: { coin: 30, xp: 25, items: [] }, durationMinutes: null, repeat: null, chain: null, ...over }];
    return { ...pinFor(JSON.stringify(over), pack), defs: { [herb.id]: herb } };
}

export async function realQuestHost(t, { given = questPin(), st = null, modules = [] } = {}) {
    let sdk;
    const rb = createModule({ settings: () => sdk?.settings('rpg-battle') ?? {} });
    // Same owner and real handlers, as B's real-module fixture; no replay query or quest handler is substituted.
    for (const [, part] of rulesParts) {
        Object.assign(rb.domains, part.domains);
        Object.assign(rb.commands, part.commands);
        Object.assign(rb.queries, part.queries);
        for (const [name, hook] of Object.entries(part.hooks ?? {})) {
            const old = rb.hooks[name];
            rb.hooks[name] = (...args) => {
                const a = old?.(...args), b = hook(...args);
                return name === 'replayGuard' ? a ?? b : { commands: [...(a?.commands ?? []), ...(b?.commands ?? [])] };
            };
        }
    }
    const initial = rb.domains.rules.initial;
    rb.domains.rules = { ...rb.domains.rules, initial: () => {
        const slice = initial();
        const problem = pinRules(slice, given);
        if (problem) throw new Error(problem);
        return slice;
    } };
    rb.commands['fixture.defs'] = ctx => { registerPackDefs(ctx); return { summary: 'Frozen definitions registered.' }; };
    const host = await createHost({ modules: [director(), rb, ...modules], ...(st ? { st } : {}) });
    sdk = host.sdk;
    t.after(() => host.close());
    if (!st) {
        const made = await sdk.command('party.create', { name: 'Ren', preset: 'fighter', class: ref('c0') });
        if (!made.ok) throw new Error(made.message);
        const defs = await sdk.command('fixture.defs');
        if (!defs.ok) throw new Error(defs.message);
    }
    return host;
}
