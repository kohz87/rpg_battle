// rules/queries.js: the lookups track C's screens read (rules.identity, rules.classes, rules.names, rules.training).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR, AREA_TIERS, DAY, FRIEND, realWorld, ref, started, world } from '../progress/helpers/world.js';

test('rules.identity: the pinned rules hash class.choose and path.choose need, with the pack and its version', async t => {
    const w = await started(t);
    const identity = w.q('rules.identity', {});
    assert.deepEqual(Object.keys(identity).sort(), ['hash', 'packId', 'version']);
    assert.equal(identity.hash, w.slice('rules').rulesHash);
    assert.equal(identity.packId, 'fixture');
    assert.equal(identity.version, '2.0.0');
    assert.equal(w.q('rules.identity', { x: 1 }), null, 'malformed arguments');
    const bare = await world(t);
    await bare.say('Dawn.');
    assert.equal(bare.q('rules.identity', {}), null, 'no pin, no identity');
});

test('rules.classes: the pack\'s classes in its order with their three skills, filtered by tier', async t => {
    const w = await started(t);
    const all = w.q('rules.classes', {});
    assert.deepEqual(all.map(item => item.id), [0, 1, 2, 3].map(n => ref(`c${n}`)));
    assert.deepEqual(all[1], { id: ref('c1'), name: 'Class 1', tier: 1, parent: ref('c0'), skills: [ref('s10'), ref('s11'), ref('s12')] });
    assert.equal(all[0].parent, null);
    assert.deepEqual(w.q('rules.classes', { tier: 0 }).map(item => item.id), [ref('c0')]);
    assert.deepEqual(w.q('rules.classes', { tier: 7 }), []);
    assert.deepEqual(w.q('rules.classes', { tier: 'x' }), []);
    assert.deepEqual(w.q('rules.classes', { nope: 1 }), []);
    const bare = await world(t);
    await bare.say('Dawn.');
    assert.deepEqual(bare.q('rules.classes', {}), []);
});

test('rules.names: class, skill and form names for refs; unknown refs and bad arguments leave nothing', async t => {
    const w = await started(t);
    const names = w.q('rules.names', { refs: [ref('c2'), ref('s30'), ref('s30-base-a-g'), ref('nope'), 7, ref('s30')] });
    assert.deepEqual(names, { [ref('c2')]: 'Class 2', [ref('s30')]: 's30', [ref('s30-base-a-g')]: 's30-base-a' });
    assert.deepEqual(w.q('rules.names', { refs: 'x' }), {});
    assert.deepEqual(w.q('rules.names', {}), {});
    assert.deepEqual(w.q('rules.names', { refs: [] }), {});
});

test('rules.training: the caps of today from the clock and the credits, no session and no offers before the training package', async t => {
    const w = await started(t);
    assert.deepEqual(w.q('rules.training', { actor: ACTOR }), { actor: ACTOR, session: null, caps: {
        day: null, actor: { used: 0, max: 30 }, skill: { used: 0, max: 10 },
        skills: { [ref('s00')]: { used: 0, max: 10 }, [ref('s01')]: { used: 0, max: 10 }, [ref('s02')]: { used: 0, max: 10 } },
    }, offers: [] });
    await w.say('Practice.', [`~ time ${3 * DAY + 600}`, ...['s00', 's00', 's01'].map((s, i) => `! attempt ${ACTOR} | skill: ${s} | form: ${s}-base | key: t${i}`)]);
    const caps = w.q('rules.training', { actor: ACTOR }).caps;
    assert.equal(caps.day, 3);
    assert.deepEqual(caps.actor, { used: 3, max: 30 });
    assert.deepEqual(caps.skill, { used: 2, max: 10 });
    assert.deepEqual(caps.skills[ref('s00')], { used: 2, max: 10 });
    await w.say('Next day.', [`~ time ${4 * DAY + 5}`]);
    assert.deepEqual(w.q('rules.training', { actor: ACTOR }).caps.actor, { used: 0, max: 30 }, 'another story day has its own room');
    assert.equal(w.q('rules.training', { actor: FRIEND }), null, 'not in the party');
    assert.equal(w.q('rules.training', { actor: 'x' }), null);
    assert.equal(w.q('rules.training', {}), null);
});

test('rules.sheet: your character by default, a member by id, null for a stranger, a malformed argument or a member with no class', async t => {
    const w = await started(t);
    const sheet = w.q('rules.sheet', {});
    assert.equal(sheet.id, ACTOR);
    assert.equal(sheet.class, ref('c0'));
    assert.equal(sheet.skills.length, 3, 'a class holds three skills');
    assert.deepEqual(sheet.skills.map(skill => skill.form), ['s00-base', 's01-base', 's02-base'].map(ref));
    assert.deepEqual(Object.keys(sheet.gear).sort(), ['accessory-1', 'accessory-2', 'body', 'feet', 'head', 'legs', 'offhand', 'weapon']);
    assert.deepEqual(w.q('rules.sheet', { actor: ACTOR }), sheet);
    assert.equal(w.q('rules.sheet', { actor: 'ac_zzzzzzzz' }), null, 'a stranger');
    assert.equal(w.q('rules.sheet', { actor: 'nobody' }), null);
    assert.equal(w.q('rules.sheet', { nope: 1 }), null);
    assert.equal(w.host.bus.command('tp.add', { id: FRIEND, name: 'Lyra' }, { cause: 'ui' }).ok, true);
    assert.equal(w.q('rules.sheet', { actor: FRIEND }), null, 'no basic class yet');
    const bare = await world(t);
    await bare.say('Dawn.');
    assert.equal(bare.q('rules.sheet', {}), null, 'no pin');
});

test('rules.modifier: the base stat\'s check modifier and what the member brings to the check, in parts that sum to the amount; null for what it cannot answer', async t => {
    for (const key of Object.keys(AREA_TIERS)) delete AREA_TIERS[key];
    AREA_TIERS['pack.fixture/haven'] = 4;
    try {
        const w = await realWorld(t, { sd: true });
        await w.say('Haven.', ['~ here pack.fixture/haven', '+ item Lockpicks | qty: 1']);
        const bare = w.q('rules.modifier', { actor: w.pc, stat: 'STR', skill: 'shout' });
        assert.deepEqual(Object.keys(bare), ['actor', 'stat', 'amount', 'parts']);
        assert.deepEqual(bare.parts, [{ source: 'stat', ref: null, reason: 'STR', amount: bare.amount }]);
        const lock = w.q('rules.modifier', { actor: w.pc, stat: 'DEX', skill: 'pick the lock' });
        assert.deepEqual(lock.parts.map(part => [part.source, part.reason]).slice(0, 2), [['stat', 'DEX'], ['item', 'Lockpicks']]);
        assert.equal(lock.amount, lock.parts.reduce((sum, part) => sum + part.amount, 0));
        assert.equal(lock.parts[1].amount, 1, 'one item +1');
        assert.ok(lock.parts.every(part => part.ref === null && Number.isInteger(part.amount) && part.reason.length <= 120));
        // The skill word may be absent, and the stat decides.
        assert.equal(w.q('rules.modifier', { actor: w.pc, stat: 'DEX' }).parts.length, 1);
        // Nothing else: a stranger, a stat that is not one, a malformed call, no pin.
        assert.equal(w.q('rules.modifier', { actor: 'ac_zzzzzzzz', stat: 'DEX' }), null);
        assert.equal(w.q('rules.modifier', { actor: w.pc, stat: 'WIS' }), null);
        assert.equal(w.q('rules.modifier', { actor: w.pc, stat: 'DEX', die: 20 }), null);
        assert.equal(w.q('rules.modifier', { actor: w.pc }), null);
        assert.equal(w.q('rules.modifier', {}), null);
        const plain = await world(t);
        await plain.say('Dawn.');
        assert.equal(plain.q('rules.modifier', { actor: ACTOR, stat: 'DEX' }), null, 'no pin');
    } finally {
        for (const key of Object.keys(AREA_TIERS)) delete AREA_TIERS[key];
    }
});
