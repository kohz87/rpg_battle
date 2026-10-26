// Real Ersveil 1.5.0 fixture copied from Story Block cc0b793. No sibling checkout is needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../../src/v2/module.js';
import { SD, AREA_TIERS } from '../../progress/helpers/world.js';
import { partyCombatants, fightNumbers } from '../../../../src/v2/combat/setup.js';
import { fightRules, unpackSetup } from '../../../../src/v2/combat/stored.js';

export const PACK = JSON.parse(readFileSync(new URL('../fixtures/ersveil-bluewatch.pack.json', import.meta.url)));
export const PLACE = 'pack.ersveil-bluewatch/bluewatch-village';
export const ok = result => { assert.equal(result.ok, true, `${result.code}: ${result.message}`); return result; };
export const allFoes = setup => [...setup.enemies, ...(setup.waves ?? []).flatMap(wave => wave.enemies)];
export const SEEDS = 300;

export async function world(t, klass = 'militiaman') {
    const h = await createHost({ modules: [{ ...SD, version: '2.0.0' }] });
    t.after(() => h.close());
    ok(await h.packs.packs.install(structuredClone(PACK)));
    const preflight = () => h.sdk.preflight({ module: 'rpg-battle', rulesVersion: 2, peers: ['story-director'] });
    await h.sdk.registerModule(createModule({ settings: () => h.sdk.settings('rpg-battle'), query: (name, args) => h.sdk.query(name, args), preflight: preflight(), readPreflight: preflight }));
    h.q = (name, args = {}) => h.sdk.query(name, args);
    const { name, ...choice } = h.q('rules.selection').offers[0];
    ok(await h.sdk.command('rules.pin', choice));
    const human = h.q('packs.content', { kind: 'races' }).find(race => /human/i.test(race.id));
    ok(await h.sdk.command('creation.finish', { name: 'Ren', race: human.id, talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: `pack.ersveil-bluewatch/${klass}`, checkActor: null }));
    AREA_TIERS[PLACE] = 0;
    t.after(() => { delete AREA_TIERS[PLACE]; });
    await h.send('Here.', `Here.\n\n<Changes>\n~ time 3000\n~ here ${PLACE}\n</Changes>`);
    h.ctxForFight = { query: h.q, read: domain => h.head().domains[domain] };
    return h;
}

export async function offer(h, tier = 'weak', extra = '') {
    const previous = h.q('combat.offers').at(-1)?.id;
    await h.send('They attack.', `They attack.\n\n<Changes>\n! encounter 6 Cellar Rat Swarm | tier: ${tier}${extra}\n</Changes>`);
    const result = h.q('combat.offers').at(-1);
    assert.ok(result, JSON.stringify(h.store.problems()));
    assert.notEqual(result.id, previous, 'the new encounter must have been captured');
    return result;
}

export function setupOf(h, offered) {
    const party = partyCombatants(h.ctxForFight, { rules: fightRules(fightNumbers({})) });
    return { ...unpackSetup(offered.opposition), id: 'fi_00000001', party };
}

