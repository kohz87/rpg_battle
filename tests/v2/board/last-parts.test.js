// The last fight's summary in parts (src/v2/board/parts.js), kept by combat.end beside the summary text
// the story is told: the result line, one row per member with the pools the fight left, key moments,
// the foes' fates, loot and growth. Code builds every part from the fight's result; the summary text is
// unchanged (it is what the story gets), and the stored parts pass the combat validator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastParts, partsProblems, MAX_MOMENTS } from '../../../src/v2/board/parts.js';
import { validateCombat } from '../../../src/v2/combat/index.js';
import { liveFight } from './helpers.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

function finished(foes = 'Giant Rat', labels = { tier: 'weak' }) {
    const world = liveFight(foes, labels);
    for (let n = 0; n < 200 && sessionOf(world.state.domains.combat)?.status === 'active'; n++) world.run('combat.act', { action: { type: 'auto' } });
    const id = sessionOf(world.state.domains.combat).id;
    const end = world.run('combat.end', { session: id });
    assert.equal(end.ok, true, end.message);
    return { world, end, last: world.state.domains.combat.last[0] };
}

test('combat.end keeps the parts beside the unchanged summary text', () => {
    const { end, last } = finished('3 Cellar Rats', { tier: 'weak' });
    const { parts } = last;
    assert.deepEqual(partsProblems(parts), []);
    assert.deepEqual(validateCombat(finished().world.state.domains.combat), []);
    assert.equal(parts.outcome, 'victory');
    assert.match(parts.result, /^Victory in \d+ rounds? \(about \d+ (second|minute)s?\)\.$/);
    // The text the story is told is the receipt's summary, as before: the parts are not in it twice.
    assert.equal(end.receipt.summary, last.summary);
    assert.ok(last.summary.startsWith(parts.result), 'the text opens with the same result line');
    for (const member of parts.party) {
        assert.ok(last.summary.includes(`${member.name}: HP ${member.hp.cur}/${member.hp.max}, MP ${member.mp.cur}/${member.mp.max}`), member.name);
        assert.ok(member.state.length > 0);
    }
    assert.ok(parts.moments.length > 0 && parts.moments.length <= MAX_MOMENTS);
    for (const moment of parts.moments) assert.ok(last.summary.toLowerCase().includes(moment.toLowerCase()), moment);
    assert.deepEqual(parts.foes, ['Foes defeated: Cellar Rat ×3.']);
    assert.ok(last.summary.includes('Foes defeated: Cellar Rat ×3.'));
    for (const item of parts.loot) assert.ok(last.summary.includes(item), item);
    if (parts.growth) assert.ok(last.summary.includes(parts.growth), parts.growth);
});

test('lastParts: a defeat has no loot or growth; someone down shows no pools', () => {
    const result = {
        outcome: 'defeat', stakes: 'normal', rounds: 3, seconds: 18,
        party: [
            { memberId: 'pc', name: 'Ren', hp: { cur: 0, max: 80 }, mp: { cur: 5, max: 30 }, sp: { cur: 2, max: 30 }, down: true, conditions: [] },
            { memberId: 'c1', name: 'Lyra\nthe <b>bold</b>', hp: { cur: 12, max: 60 }, mp: { cur: 0, max: 0 }, down: false, conditions: [] },
        ],
        keyMoments: ['Ren falls.', 'The wolf howls;'],
        defeated: [], fled: ['Wolf A'], parleyed: [],
        loot: { money: 10, items: [{ name: 'Pelt', qty: 1 }] }, xp: { pc: 40 },
    };
    const parts = lastParts(result, { pcName: 'Ren' });
    assert.equal(parts.outcome, 'defeat');
    assert.match(parts.result, /^Defeated: the story decides/);
    assert.deepEqual(parts.loot, []);
    assert.equal(parts.growth, '');
    assert.equal(parts.party[0].down, true);
    assert.equal(parts.party[0].hp.cur, 0);
    assert.equal(parts.party[0].sp, null);
    assert.equal(parts.party[1].name, 'Lyra the <b>bold</b>', 'one line of plain text; the screen shows it as text');
    assert.equal(parts.party[1].sp, null, 'no stamina kept, no SP row');
    assert.deepEqual(parts.moments, ['Ren falls', 'The wolf howls']);
    assert.deepEqual(parts.foes, ['Fled: Wolf.']);
    assert.deepEqual(partsProblems(parts), []);
});

test('lastParts: long texts are cut by code points; lists are capped', () => {
    const name = '🐀'.repeat(100);
    const result = {
        outcome: 'victory', rounds: 1, seconds: 6,
        party: [{ memberId: 'pc', name, hp: { cur: 1, max: 1 }, mp: { cur: 0, max: 0 }, down: false, conditions: [] }],
        keyMoments: Array.from({ length: 12 }, (_, i) => `Moment ${i}`),
        loot: { money: 0, items: Array.from({ length: 30 }, (_, i) => ({ name: `Thing ${i}`, qty: 1 })) }, xp: {},
    };
    const parts = lastParts(result);
    assert.equal(Array.from(parts.party[0].name).length, 60);
    assert.ok(!parts.party[0].name.includes('�'));
    assert.equal(parts.moments.length, MAX_MOMENTS);
    assert.equal(parts.loot.length, 20);
    assert.deepEqual(partsProblems(parts), []);
});

test('the combat validator refuses malformed parts; a last fight without parts (older chats) still passes', () => {
    const { world } = finished();
    const combat = structuredClone(world.state.domains.combat);
    const without = structuredClone(combat);
    delete without.last[0].parts;
    assert.deepEqual(validateCombat(without), []);
    for (const bad of [null, 'text', { ...combat.last[0].parts, outcome: 'won' }, { ...combat.last[0].parts, party: [{ name: 'x' }] }, { ...combat.last[0].parts, loot: 'rat tail' }]) {
        const broken = structuredClone(combat);
        broken.last[0].parts = bad;
        assert.ok(validateCombat(broken).some(error => /combat\.last\.parts/.test(error)), JSON.stringify(bad));
    }
});
