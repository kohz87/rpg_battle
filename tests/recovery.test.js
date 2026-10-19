// Recovery out of a fight: rests, story time and items used at camp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRules } from '../src/rules.js';
import { PRESETS } from '../src/skills.js';
import { newSheet } from '../src/sheet.js';
import { recoverOverTime, rest, useItemOutside } from '../src/recovery.js';

const rules = makeRules();
const fresh = newSheet({ name: 'Ren', stats: PRESETS[0].points, skills: PRESETS[0].skills }, rules);
const hurt = { ...fresh, hp: { ...fresh.hp, cur: 10 }, mp: { ...fresh.mp, cur: 0 }, conditions: [{ name: 'poison', rounds: 2 }, { name: 'exhausted', rounds: null }] };

test('a short rest gives back a quarter; a long rest fills and ends fight conditions only', () => {
    const short = rest(hurt, 'short', { rules });
    assert.equal(short.hp.cur, 10 + Math.floor(fresh.hp.max * 0.25));
    assert.equal(short.mp.cur, Math.floor(fresh.mp.max * 0.25));
    assert.equal(short.conditions.length, 2, 'a breather cures nothing');
    const long = rest(hurt, 'long', { rules });
    assert.equal(long.hp.cur, fresh.hp.max);
    assert.equal(long.mp.cur, fresh.mp.max);
    assert.deepEqual(long.conditions.map(entry => entry.name), ['exhausted'], 'story conditions stay');
    assert.equal(hurt.hp.cur, 10, 'the sheet passed in is untouched');
});

test('story time: 5 % of max per hour, a full rest at 6 hours or more, nothing for no time', () => {
    const two = recoverOverTime(hurt, 2, { rules });
    assert.equal(two.kind, 'regen');
    assert.equal(two.hp, Math.floor(fresh.hp.max * 0.1));
    const night = recoverOverTime(hurt, 8, { rules });
    assert.equal(night.kind, 'long');
    assert.equal(night.sheet.hp.cur, fresh.hp.max);
    assert.equal(recoverOverTime(hurt, 0, { rules }).kind, null);
    assert.equal(recoverOverTime(fresh, 3, { rules }).kind, null, 'nothing to recover');
});

test('an item at camp: heal, MP and cures apply; fight-only or needless items are not spent', () => {
    const potion = { name: 'Healing Draught', qty: 2, effect: { heal: 30 } };
    const used = useItemOutside(hurt, potion);
    assert.ok(used.used);
    assert.equal(used.sheet.hp.cur, 40);
    assert.match(used.message, /\+30 HP/);
    const antidote = useItemOutside(hurt, { name: 'Antidote', qty: 1, effect: { cure: ['poison'] } });
    assert.deepEqual(antidote.sheet.conditions.map(entry => entry.name), ['exhausted']);
    assert.equal(useItemOutside(hurt, { name: 'Ember Flask', qty: 1, effect: { damage: { amount: 25 } } }).used, false);
    assert.equal(useItemOutside(fresh, potion).used, false, 'already at full HP');
});

test('stamina (0.5.29): any rest fills it; story time brings it back fast', async () => {
    const { rest, recoverOverTime } = await import('../src/recovery.js');
    const sheet = { name: 'Ren', level: 1, hp: { cur: 50, max: 100 }, mp: { cur: 10, max: 40 }, sp: { cur: 4, max: 40 }, stats: {}, conditions: [] };
    assert.equal(rest(sheet, 'short').sp.cur, 40);
    assert.equal(rest(sheet, 'long').sp.cur, 40);
    const half = recoverOverTime(sheet, 0.5);
    assert.equal(half.sp, 20, 'half an hour, half the stamina');
    assert.equal(half.sheet.sp.cur, 24);
    assert.equal(recoverOverTime(sheet, 1).sheet.sp.cur, 40);
    // An older sheet without stamina is left as it was.
    const { sp: _sp, ...old } = sheet;
    assert.equal(rest(old, 'short').sp, undefined);
});
