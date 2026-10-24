// class.choose and path.choose on the real Story Block host (vendored): the player's choices, their results,
// refusals, claims and guards (fixtures C01, C02, C04, C05; contract §3 result table).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR, FRIEND, grind, ref, started, world } from './helpers/world.js';
import { promoted, step } from './helpers/states.js';

const BASE = ['s00-base', 's01-base', 's02-base'].map(ref);
const hashOf = w => w.slice('rules').rulesHash;
const promote = (w, over = {}) => w.ui('class.choose', { actor: ACTOR, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: hashOf(w), ...over });
const path = (w, over = {}) => w.ui('path.choose', { actor: ACTOR, milestone: 40, skill: ref('s30'), fromForm: ref('s30-base'), option: ref('s30-base-a'), rulesHash: hashOf(w), ...over });

async function ready(t) {
    const w = await started(t);
    await w.say('Training.', [`! xp ${ACTOR} | n: 1000`]);
    await grind(w, { forms: BASE });
    return w;
}

// A character already at the advanced class with every skill 5/5, set up by seeding (the promotions themselves are tested above).
async function advanced(t, { uses = { 's30-base': 35, 's31-base': 35, 's32-base': 35 }, xp = 5000 } = {}) {
    const w = await world(t);
    await w.say('Dawn.');
    for (const [type, payload] of [['test.pin', {}], ['tp.add', { id: ACTOR, name: 'Astra' }], ['test.seed', { choices: promoted(), uses: Object.fromEntries(Object.entries(uses).map(([k, v]) => [ref(k), v])) }]]) {
        const out = w.host.bus.command(type, payload, { cause: 'ui' });
        assert.equal(out.ok, true, `${type}: ${out.message}`);
    }
    await w.say('Years pass.', [`! xp ${ACTOR} | n: ${xp}`]);
    return w;
}

test('C01 fresh: the basic class is milestone 0; a second one, a non-root class and an unknown class are refused', async t => {
    const w = await started(t);
    assert.deepEqual(w.slice('progress').choices[`${ACTOR}|0`], {
        actor: ACTOR, milestone: 0, kind: 'class', previous: null, selected: ref('c0'), skills: [ref('s00'), ref('s01'), ref('s02')], rulesHash: hashOf(w),
    });
    assert.ok(w.head().meta.claims[`rb:ep_00000001:class:${ACTOR}:0`]);
    const p = w.progress();
    assert.equal(p.level, 1);
    assert.equal(p.checklist.length, 3);
    assert.ok(p.checklist.every(item => item.mastery === 0 && item.needed === 5));
    assert.equal(w.host.bus.command('test.start', { actor: ACTOR, class: ref('c0') }, { cause: 'ui' }).code, 'REFUSED');
    await w.host.bus.command('tp.add', { id: FRIEND, name: 'Lyra' }, { cause: 'ui' });
    assert.match(w.host.bus.command('test.start', { actor: FRIEND, class: ref('c1') }, { cause: 'ui' }).message, /basic class/);
    assert.equal(w.host.bus.command('test.start', { actor: FRIEND, class: ref('nope') }, { cause: 'ui' }).code, 'REFUSED');
    assert.equal(w.host.bus.command('test.start', { actor: 'x', class: ref('c0') }, { cause: 'ui' }).code, 'INVALID');
    assert.equal(w.host.bus.command('test.start', { actor: FRIEND, class: ref('c0') }, { cause: 'ui' }).ok, true, 'a companion has a class of their own');
    assert.equal(w.progress(FRIEND).level, 1);
});

test('C02 promotion: the last credit enables the child; one click swaps all three skills to the new class\'s, at 0/5', async t => {
    const w = await started(t);
    await w.say('Training.', [`! xp ${ACTOR} | n: 1000`]);
    await grind(w, { forms: [BASE[0], BASE[1]] });
    await grind(w, { forms: [BASE[2]], uses: 34, day: 9 });
    assert.deepEqual(w.progress().checklist.map(item => item.mastery), [5, 5, 4]);
    assert.equal(w.progress().promotions[0].eligible, false);
    const refused = await promote(w);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'REFUSED');
    assert.match(refused.message, /5\/5: s02 is 4\/5/);
    assert.deepEqual(Object.keys(w.slice('progress').choices), [`${ACTOR}|0`], 'a refusal stores nothing');
    await grind(w, { forms: [BASE[2]], uses: 1, day: 20 });
    assert.equal(w.progress().promotions[0].eligible, true);

    const result = await promote(w);
    assert.equal(result.ok, true, result.message);
    const { receipt } = result;
    assert.equal(receipt.type, 'class.choose');
    assert.equal(receipt.cause, 'ui');
    assert.equal(receipt.narrate, true, 'a promotion is told once');
    assert.match(receipt.summary, /Astra becomes a Class 1/);
    assert.deepEqual(receipt.data.v2.result, { actor: ACTOR, milestone: 10, previous: ref('c0'), selected: ref('c1'), skills: [ref('s10'), ref('s11'), ref('s12')] });
    assert.equal(receipt.data.v2.key, `class:${ACTOR}:10`);
    assert.equal(receipt.data.v2.rulesHash, hashOf(w));
    assert.equal(receipt.data.v2.guard.owner, 'rpg-battle');
    assert.equal(receipt.data.v2.guard.predicate.kind, 'class.choose');
    assert.deepEqual(w.slice('progress').choices[`${ACTOR}|10`], { actor: ACTOR, milestone: 10, kind: 'class', previous: ref('c0'), selected: ref('c1'), skills: [ref('s10'), ref('s11'), ref('s12')], rulesHash: hashOf(w) });
    assert.ok(w.head().meta.claims[`rb:ep_00000001:class:${ACTOR}:10`], 'the milestone is claimed');
    const after = w.progress();
    assert.equal(after.class, ref('c1'));
    assert.equal(after.checklist.length, 3, 'exactly three skills after the swap');
    assert.deepEqual(after.checklist.map(item => item.skill), [ref('s10'), ref('s11'), ref('s12')]);
    assert.ok(after.checklist.every(item => item.mastery === 0), 'nothing is inherited');
    assert.deepEqual(w.problems(), []);
    // Once only: a second try at the same milestone, from either class, changes nothing.
    assert.equal((await promote(w)).code, 'STALE');
    assert.equal((await promote(w, { expectedClass: ref('c1'), class: ref('c2') })).code, 'REFUSED');
    assert.equal(Object.keys(w.slice('progress').choices).length, 2);
});

test('class.choose is the player\'s: not a story line and not the host\'s own step', async t => {
    const w = await ready(t);
    const payload = { actor: ACTOR, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: hashOf(w) };
    for (const cause of ['story', 'system']) {
        const out = w.host.bus.command('class.choose', payload, { cause });
        assert.equal(out.ok, false);
        assert.equal(out.code, 'REFUSED', cause);
    }
    assert.deepEqual(Object.keys(w.slice('progress').choices), [`${ACTOR}|0`]);
    assert.equal((await promote(w)).ok, true, 'the player\'s own click works');
});

test('a module calling class.choose through ctx.call is refused, even at the player\'s click', async t => {
    const caller = { id: 'other-module', name: 'Other', version: '0.0.0', commands: { 'other.promote': (ctx, payload) => ctx.call('class.choose', payload), 'other.path': (ctx, payload) => ctx.call('path.choose', payload) } };
    const w = await started(t, { modules: [caller] });
    await w.say('Training.', [`! xp ${ACTOR} | n: 1000`]);
    await grind(w, { forms: BASE });
    const payload = { actor: ACTOR, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: hashOf(w) };
    const out = w.host.bus.command('other.promote', payload, { cause: 'ui' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'REFUSED');
    assert.match(out.message, /player's own choice/);
    assert.deepEqual(Object.keys(w.slice('progress').choices), [`${ACTOR}|0`]);
    assert.equal(w.host.bus.command('other.path', { actor: ACTOR, milestone: 40, skill: ref('s00'), fromForm: ref('s00-base'), option: ref('s00-base-g'), rulesHash: hashOf(w) }, { cause: 'ui' }).code, 'REFUSED');
    assert.equal((await promote(w)).ok, true, 'the player\'s own click works');
});

test('refusals: wrong shape, unknown character, rules changed, stale class, early level, no pack', async t => {
    const w = await ready(t);
    const good = { actor: ACTOR, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: hashOf(w) };
    const ask = over => w.host.bus.command('class.choose', { ...good, ...over }, { cause: 'ui' });
    assert.equal(ask({ extra: 1 }).code, 'INVALID');
    assert.equal(w.host.bus.command('class.choose', { actor: ACTOR }, { cause: 'ui' }).code, 'INVALID');
    assert.equal(w.host.bus.command('class.choose', null, { cause: 'ui' }).code, 'INVALID');
    assert.equal(ask({ actor: 'nobody' }).code, 'INVALID');
    assert.equal(ask({ milestone: 'ten' }).code, 'INVALID');
    assert.equal(ask({ class: 'c1' }).code, 'INVALID');
    assert.equal(ask({ rulesHash: 'x' }).code, 'INVALID');
    assert.equal(ask({ rulesHash: 'a'.repeat(64) }).code, 'RULES_MISMATCH');
    assert.equal(ask({ actor: FRIEND }).code, 'NOT_FOUND');
    assert.equal(ask({ expectedClass: ref('c1') }).code, 'STALE');
    assert.equal(ask({ milestone: 20, class: ref('c2'), expectedClass: ref('c0') }).code, 'REFUSED');
    assert.equal(ask({ milestone: 7 }).code, 'INVALID');
    assert.equal(ask({ class: ref('c3') }).code, 'REFUSED');
    assert.deepEqual(Object.keys(w.slice('progress').choices), [`${ACTOR}|0`], 'nothing was stored by any of them');
    assert.deepEqual(w.problems(), []);
    // A chat with no rules pack pinned.
    const bare = await world(t);
    await bare.say('Dawn.');
    assert.equal(bare.host.bus.command('class.choose', good, { cause: 'ui' }).code, 'REFUSED');
    assert.equal(bare.progress(), null);
});

test('level: a character below the milestone is refused with the level it needs', async t => {
    const w = await started(t);
    await grind(w, { forms: BASE });
    await w.say('A little XP.', [`! xp ${ACTOR} | n: 850`]);
    assert.equal(w.progress().level, 9);
    assert.deepEqual(w.progress().promotions, []);
    const out = await promote(w);
    assert.equal(out.code, 'REFUSED');
    assert.match(out.message, /Level 10 is needed \(this character is level 9\)/);
    await w.say('A little more.', [`! xp ${ACTOR} | n: 50`]);
    assert.equal(w.progress().level, 10);
    assert.equal((await promote(w)).ok, true);
});

test('no choice while a fight is on', async t => {
    const fight = { id: 'fake-fight', name: 'Fight', version: '0.0.0', queries: { 'combat.session': () => ({ status: 'active' }) } };
    const w = await started(t, { modules: [fight] });
    await w.say('Training.', [`! xp ${ACTOR} | n: 1000`]);
    await grind(w, { forms: BASE });
    const out = await promote(w);
    assert.equal(out.code, 'REFUSED');
    assert.match(out.message, /Finish the fight/);
});

test('C04 waiting: level 90 on a basic class; nothing is chosen, later milestones are refused, then promotions go in order', async t => {
    const w = await started(t);
    await w.say('Years.', [`! xp ${ACTOR} | n: 9000`]);
    await grind(w, { forms: BASE });
    const p = w.progress();
    assert.equal(p.level, 91);
    assert.deepEqual(p.promotions.map(item => [item.milestone, item.eligible]), [[10, true], [20, false], [30, false]]);
    assert.deepEqual(p.pathways.map(item => [item.milestone, item.eligible]), [40, 50, 60, 70, 80, 90].map(m => [m, false]));
    assert.deepEqual(Object.keys(w.slice('progress').choices), [`${ACTOR}|0`], 'no auto-pick, however long it waits');
    await w.say('Another day.');
    await w.say('And another.', [`! xp ${ACTOR} | n: 500`]);
    assert.deepEqual(Object.keys(w.slice('progress').choices), [`${ACTOR}|0`]);
    assert.equal((await promote(w, { milestone: 20, class: ref('c2') })).code, 'REFUSED', 'the 10 promotion comes first');
    assert.equal((await path(w)).code, 'REFUSED');
    assert.equal((await promote(w)).ok, true);
    const next = w.progress();
    assert.deepEqual(next.promotions.map(item => [item.milestone, item.eligible, item.choices]), [[20, false, [ref('c2')]], [30, false, []]]);
    assert.match(next.promotions[0].why[0], /s10 is 0\/5/);
    assert.equal(next.pathways.length, 6);
    assert.equal(next.pathways[0].eligible, false);
    assert.match(next.pathways[0].why[0], /20 promotion comes first/);
});

test('C05 selected parent through the host: a step at 40 opens its own three options at 50, the other skills start at the base', async t => {
    const w = await advanced(t);
    assert.equal(w.progress().level, 51);
    const first = await path(w);
    assert.equal(first.ok, true, first.message);
    assert.deepEqual(first.receipt.data.v2.result, { actor: ACTOR, milestone: 40, previous: ref('s30-base'), selected: ref('s30-base-a') });
    assert.equal(first.receipt.narrate, true);
    assert.match(first.receipt.summary, /s30-base-a/);
    assert.deepEqual(w.slice('progress').choices[`${ACTOR}|40`], step(ACTOR, 40, 's30', 's30-base', 's30-base-a', 1));
    assert.ok(w.head().meta.claims[`rb:ep_00000001:path:${ACTOR}:40`]);
    const view = w.progress();
    assert.equal(view.checklist[0].form, ref('s30-base-a'));
    assert.equal(view.checklist[0].mastery, 0, 'the new form starts at 0/5');
    assert.equal(view.checklist[1].mastery, 5, 'the other skills are left alone');
    assert.equal(view.pathways[0].milestone, 50);
    assert.equal(view.pathways[0].eligible, true, 'two skills are 5/5: a step may be taken on one of them');
    assert.deepEqual(view.pathways[0].skills.map(item => [item.skill, item.fromForm, item.step]), [[ref('s30'), ref('s30-base-a'), 2], [ref('s31'), ref('s31-base'), 1], [ref('s32'), ref('s32-base'), 1]]);
    // At 50 the 0/5 skill cannot be taken (its form is not 5/5), a sibling's option is not its own, and the stale parent is stale.
    assert.match((await path(w, { milestone: 50, fromForm: ref('s30-base-a'), option: ref('s30-base-a-g') })).message, /s30-base-a is 0\/5/);
    assert.equal((await path(w, { milestone: 50, skill: ref('s31'), fromForm: ref('s31-base'), option: ref('s32-base-a') })).code, 'REFUSED');
    assert.equal((await path(w, { milestone: 50, skill: ref('s30'), fromForm: ref('s30-base'), option: ref('s30-base-g') })).code, 'STALE');
    assert.equal((await path(w, { milestone: 50, skill: ref('s31'), fromForm: ref('s31-base-a'), option: ref('s31-base-a-a') })).code, 'STALE');
    const second = await path(w, { milestone: 50, skill: ref('s31'), fromForm: ref('s31-base'), option: ref('s31-base-b') });
    assert.equal(second.ok, true, second.message);
    assert.equal(w.slice('progress').choices[`${ACTOR}|50`].step, 1);
    assert.deepEqual(w.problems(), []);
});

test('paths are taken in order, once, and need the advanced class', async t => {
    const w = await ready(t);
    assert.match((await path(w)).message, /10 promotion comes first/);
    const adv = await advanced(t);
    assert.equal((await path(adv, { milestone: 50, skill: ref('s31'), fromForm: ref('s31-base'), option: ref('s31-base-g') })).code, 'REFUSED', 'the 40 step comes first');
    assert.equal((await path(adv, { milestone: 45 })).code, 'INVALID');
    assert.equal((await path(adv, { milestone: 10 })).code, 'INVALID', 'a promotion level is not a path');
    assert.equal((await path(adv)).ok, true);
    const again = await path(adv, { skill: ref('s31'), fromForm: ref('s31-base'), option: ref('s31-base-a') });
    assert.equal(again.code, 'REFUSED');
    assert.match(again.message, /50 step comes first|already taken/);
    assert.equal(adv.host.bus.command('path.choose', { actor: ACTOR }, { cause: 'story' }).code, 'INVALID');
    assert.equal(adv.host.bus.command('path.choose', { actor: ACTOR, milestone: 50, skill: ref('s31'), fromForm: ref('s31-base'), option: ref('s31-base-g'), rulesHash: hashOf(adv) }, { cause: 'story' }).code, 'REFUSED');
});

test('a second step needs the first form at 5/5; two steps is all a skill takes, and each new form starts at 0/5', async t => {
    const w = await advanced(t);
    assert.equal((await path(w)).ok, true);
    // s30-base-a is 0/5: its own step 2 waits for it, though the other skills are ready.
    assert.equal((await path(w, { milestone: 50, fromForm: ref('s30-base-a'), option: ref('s30-base-a-g') })).code, 'REFUSED');
    await grind(w, { forms: [ref('s30-base-a')], day: 40 });
    assert.equal(w.progress().checklist[0].mastery, 5);
    const second = await path(w, { milestone: 50, fromForm: ref('s30-base-a'), option: ref('s30-base-a-g') });
    assert.equal(second.ok, true, second.message);
    assert.equal(w.slice('progress').choices[`${ACTOR}|50`].step, 2);
    await w.say('More years.', [`! xp ${ACTOR} | n: 1000`]);
    const view = w.progress();
    assert.equal(view.checklist[0].form, ref('s30-base-a-g'));
    assert.equal(view.checklist[0].mastery, 0);
    assert.equal(view.checklist[0].skill, ref('s30'));
    assert.equal(view.pathways[0].milestone, 60);
    assert.deepEqual(view.pathways[0].skills.map(item => item.skill), [ref('s31'), ref('s32')], 'the skill that took two steps is not offered again');
    assert.deepEqual(w.problems(), []);
});

test('the guard on a choice names the rules, the epoch and a hash of the facts (not of the raw level)', async t => {
    const w = await ready(t);
    const out = await promote(w);
    assert.equal(out.ok, true);
    const span = w.host.ctx.chat.at(-1).extra.storySuite.spans.at(-1);
    assert.equal(span.guard.version, 2);
    assert.equal(span.guard.rulesHash, hashOf(w));
    assert.match(span.guard.inputHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(span.guard.predicate, { kind: 'class.choose', payload: { actor: ACTOR, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: hashOf(w) } });
    assert.deepEqual(span.claims, [`rb:ep_00000001:class:${ACTOR}:10`]);
    assert.deepEqual(span.recorded.facts.held.length, 3);
});
