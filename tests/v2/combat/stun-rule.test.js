// The stun rule (wave C, combat.js): nobody is stunned two turns in a row. A stun that lands on
// someone whose last turn a stun took dazes them instead: their next action rolls DAZE_POINTS (2)
// points lower (to hit, to flee, to talk). Only a fight whose setup asks for it (`stunRule: 'daze'`,
// which every v2 fight's setup has) plays by it: a v1 fight, and a v2 fight stored before the rule,
// replay exactly as they did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRules } from '../../../src/rules.js';
import { DAZE_POINTS, act, previewStrike, replay, startFight } from '../../../src/combat.js';
import { buildSetup, fightNumbers } from '../../../src/v2/combat/setup.js';

// Every attack hits, no variance, no criticals, a fixed initiative die.
const EXACT = makeRules({
    attack: { hitMin: 100, hitMax: 100, varianceLow: 1, varianceHigh: 1, critBase: 0, critPerDex: 0, critPerLuk: 0 },
    initiative: { die: 1 },
});

const zap = { name: 'Zap', type: 'magic', stat: 'INT', power: 0.6, mp: 0, cooldown: 0, target: 'one', effect: { stun: 1 }, mastery: 1, cooldownLeft: 0 };
const hero = (over = {}) => ({
    id: 'pc', memberId: 'pc', name: 'Ren', side: 'party', controller: 'auto', level: 3, rank: null, role: null, boss: false,
    stats: { STR: 10, VIT: 8, AGI: 8, DEX: 8, INT: 8, LUK: 5, CHA: 8 }, hp: { cur: 400, max: 400 }, mp: { cur: 0, max: 0 },
    patk: 4, matk: 4, pdef: 8, mdef: 8, crit: 0, skills: [], items: [], conditions: [], morale: 0, talks: false, fleesBelow: 0, xp: 0, loot: null, gone: null,
    ...over,
});
// A stunner twice as fast as Ren: it zaps (spells never miss) every turn.
const stunner = (over = {}) => ({
    id: 'e1', name: 'Shocker', side: 'enemy', controller: 'auto', level: 1, rank: 'F', role: 'caster', boss: false,
    stats: { STR: 5, VIT: 5, AGI: 40, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, hp: { cur: 60, max: 60 }, mp: { cur: 0, max: 0 },
    patk: 5, matk: 5, pdef: 0, mdef: 0, crit: 0, skills: [{ ...zap }], items: [], conditions: [], morale: 9, talks: false, fleesBelow: 0,
    xp: 10, loot: 'goblin', gone: null, memberId: null,
    ...over,
});
const fightWith = (over = {}) => startFight({ id: 'f1', seed: 'stun-1', party: [hero()], enemies: [stunner()], stakes: 'normal', turns: 'timeline', speedOffset: 10, ...over, rules: EXACT });

/** Ren's turns in order: 'stunned', 'dazed' or 'acted'. */
function renTurns(f) {
    const turns = [];
    for (const entry of f.log) {
        if (entry.actor !== 'pc') continue;
        if (/is stunned and loses the turn/.test(entry.text)) turns.push('stunned');
        else if (/is dazed/.test(entry.text)) turns.push('dazed');
        else if (/^Ren (hits|misses|defends|uses|casts)/.test(entry.text) && turns.at(-1) !== 'dazed') turns.push('acted');
    }
    return turns;
}

test('with the rule, nobody loses two turns in a row: the second stun dazes', () => {
    const f = fightWith({ stunRule: 'daze' });
    const turns = renTurns(f);
    assert.ok(turns.includes('stunned') && turns.includes('dazed'), turns.join(' '));
    for (let i = 1; i < turns.length; i += 1) assert.ok(!(turns[i] === 'stunned' && turns[i - 1] === 'stunned'), `two stunned turns in a row: ${turns.join(' ')}`);
    assert.ok(f.log.some(entry => /Ren is dazed \(−2 to this action\)/.test(entry.text)));
});

test('without the rule (v1, a fight stored before it) the stunner keeps Ren stunned turn after turn, as before', () => {
    const f = fightWith();
    const turns = renTurns(f);
    assert.ok(turns.slice(0, 4).every(turn => turn === 'stunned'), turns.join(' '));
    assert.ok(!f.log.some(entry => /dazed/.test(entry.text)));
    assert.equal(f.stunRule, undefined);
});

test('a fight with no stun plays roll for roll the same with the rule or without (v1 parity)', () => {
    const plain = stunner({ skills: [] });
    const a = startFight({ id: 'f1', seed: 'parity', party: [hero({ controller: 'player' })], enemies: [plain], turns: 'timeline', speedOffset: 10 });
    const b = startFight({ id: 'f1', seed: 'parity', party: [hero({ controller: 'player' })], enemies: [plain], turns: 'timeline', speedOffset: 10, stunRule: 'daze' });
    const strip = f => ({ ...f, setup: null, stunRule: undefined, marks: { ...f.marks, stunned: undefined } });
    const end = f => { let g = f; while (g.status === 'active') g = act(g, { type: 'attack', target: 'e1' }); return g; };
    assert.deepEqual(strip(end(a)), strip(end(b)));
});

test('a dazed actor\'s rolls are DAZE_POINTS lower: the preview\'s hit chance shows it', () => {
    assert.equal(DAZE_POINTS, 2);
    const target = stunner();
    const actor = hero({ stats: { ...hero().stats, DEX: 20 } });
    const clear = previewStrike(actor, target, null, makeRules()).hit;
    const dazed = previewStrike({ ...actor, conditions: [{ name: 'daze', rounds: 0, power: 0 }] }, target, null, makeRules()).hit;
    assert.equal(clear - dazed, DAZE_POINTS * makeRules().attack.hitPerPoint);
});

test('the rule replays: the same setup and actions give the same fight', () => {
    const live = fightWith({ stunRule: 'daze', party: [hero({ controller: 'player' })] });
    let f = live;
    const actions = [];
    for (let n = 0; n < 6 && f.status === 'active'; n += 1) {
        const action = { type: 'attack', target: 'e1' };
        f = act(f, action, EXACT);
        actions.push(action);
    }
    const again = replay({ setup: { ...live.setup }, actions }, EXACT);
    assert.deepEqual(again.log, f.log);
    assert.equal(again.rngState, f.rngState);
});

test('every v2 fight\'s setup asks for the rule', () => {
    const party = [hero({ controller: 'player' })];
    const { setup } = buildSetup({ id: 'fi_00000001', seed: 7, offer: { foes: [{ name: 'Wolf', count: 1, tier: 'even' }] }, party, numbers: fightNumbers({}) });
    assert.equal(setup.stunRule, 'daze');
});
