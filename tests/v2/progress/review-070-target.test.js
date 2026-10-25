import test from 'node:test';
import assert from 'node:assert/strict';
import { SD, realWorld } from './helpers/world.js';
import { fightPack, pinFor, ref } from './helpers/fixture.js';
const sd = { ...SD, commands: { ...SD.commands, 'sd.rescue': (ctx, payload) => ctx.call('rescue.use', payload) } };
for (const target of ['self', 'ally', 'allies']) test(`rescue shield target ${target} must reach the rescued actor, through reload and rebuild`, async t => {
    const pack = fightPack(); pack.content.rules[0].skills.find(s => s.slug === 's02').base.effects[0].target = target;
    pack.content.rules[0].skills.find(s => s.slug === 's02').base.effects[0].power = 10;
    const w = await realWorld(t, { given: pinFor(`rescue-target-${target}`, pack), companions: ['Lyra'], sd });
    await w.say('Night.', ['~ time 900']);
    assert.equal(w.ui('test.death', { id: 'br_00000009', events: [{ id: 'de_00000001', actor: w.mates[0] }] }).ok, true);
    await w.say('Danger.', ['~ time 1000']);
    const before = structuredClone(w.head());
    const out = w.host.bus.command('sd.rescue', { event: 'de_00000001', batch: { id: 'br_00000009', hash: w.slice('progress').batches.br_00000009.hash },
        actor: w.mates[0], rescuer: w.pc, skill: ref('s02'), form: ref('s02-base'), effect: 0 }, { cause: 'system' });
    assert.equal(out.ok, target !== 'self', JSON.stringify(out));
    if (target === 'self') assert.deepEqual(w.head(), before, 'all validation precedes writes');
    const check = () => assert.equal(w.q('story.evidence', {}).filter(p => p.kind === 'rescue').length, target === 'self' ? 0 : 1);
    check(); await w.host.st.loadChat(structuredClone(w.host.ctx.chat)); check(); w.host.store.rebuild(); check();
    assert.deepEqual(w.problems(), []);
});
