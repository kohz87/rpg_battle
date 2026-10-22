// Timed buffs and debuffs (feature rpg-battle.effects): made by party.addEffect and `+ effect`
// lines, keyed by id, on while the clock (or the replies) allow and their source lasts, code's
// amounts from word bands, clamped; they move matching checks in the F80 table and fight numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byName, capture, makeState, pcOf, run, withPc } from './helpers/fake-ctx.js';
import { part } from '../../../src/v2/party/index.js';
import { bandOf, minutesSince, isOn, readDuration, readOn, validateEffects, SETBACK, turnBeforeReply, FEATURE, MAX_TURNS } from '../../../src/v2/party/effects.js';
import { effects as effectsQuery, combatNumbersOf, toSpend } from '../../../src/v2/party/queries.js';
import { memberOf, modifiersFor, tableLine } from '../../../src/v2/checks/modifiers.js';
import { tail } from '../../../src/v2/party/context.js';

const rejects = (out, code, pattern) => {
    assert.equal(out.ok, false, 'expected a rejection');
    assert.equal(out.code, code, out.message);
    if (pattern) assert.match(out.message, pattern);
};
const listOf = state => Object.values(state.domains.effects.active);
const carrier = (index, sid = `sid${index}`) => ({ index, swipe: 0, sid, key: `${index}:0` });

function party() {
    return run(withPc(), 'party.addCompanion', { name: 'Lyra', role: 'ranger', level: 1 }).state;
}

test('reading words: strength bands, what it acts on, how long', () => {
    assert.equal(bandOf('a faint glow'), 1);
    assert.equal(bandOf('moderate'), 2);
    assert.equal(bandOf('a mighty surge'), 3);
    assert.deepEqual(readOn('perception, DEX and attack'), { checks: ['perception', 'DEX'], combat: ['attack'] });
    assert.deepEqual(readOn('all checks'), { checks: ['all'], combat: [] });
    assert.deepEqual(readOn('magic defence; crit'), { checks: [], combat: ['mdef', 'crit'] });
    assert.deepEqual(readOn('sneaking'), { checks: ['stealth'], combat: [] });
    assert.deepEqual(readDuration('2h'), { minutes: 120 });
    assert.deepEqual(readDuration('30 min'), { minutes: 30 });
    assert.deepEqual(readDuration('a day'), { minutes: 1440 });
    assert.deepEqual(readDuration('3 replies'), { replies: 3 });
    assert.equal(readDuration('until the moon turns'), null);
});

test('+ effect: a timed buff on the clock, code\'s amounts, the model\'s numbers never read', () => {
    const state = party();
    const out = capture(state, '+ effect Keen Sight — sharper eyes | on: perception | for: 2h | who: Lyra | strength: +9', { carrier: carrier(5), time: 600 });
    assert.equal(out.result.problem, undefined, 'a number is no band: minor, no Problem');
    assert.ok(out.ok, out.message);
    const [effect] = listOf(out.state);
    const lyra = byName(out.state, 'Lyra');
    assert.equal(effect.actor, lyra.id);
    assert.deepEqual(effect.checks, [{ on: 'perception', amount: 1 }], 'a number written is not a band: minor');
    assert.equal(effect.minutes, 120, 'a length, never an absolute end (RX-TL-4)');
    assert.equal(effect.until, undefined);
    assert.equal(effect.replies, 4, 'the reply count is kept for when the clock goes');
    assert.deepEqual(effect.start, { minutes: 600, turn: 0 });
    assert.equal(effect.tone, 'good');
    assert.equal(effect.source.kind, 'story');
    assert.equal(out.result.narrate, false);
    assert.match(out.result.summary, /Lyra: Keen Sight, 2 h/);
    assert.deepEqual(validateEffects(out.state.domains.effects), []);
});

test('+ effect: a debuff, any word held to the weak size (Problem), a day at most, and refusals', () => {
    const state = party();
    const out = capture(state, '+ effect Shaken — a mighty terror | on: will, attack | for: 3 weeks | kind: debuff', { carrier: carrier(3), time: 0 });
    assert.ok(out.ok, out.message);
    const [effect] = listOf(out.state);
    assert.equal(effect.tone, 'bad');
    assert.deepEqual(effect.checks, [{ on: 'will', amount: -1 }]);
    assert.deepEqual(effect.combat, { attack: -5 }, 'a share in %: −5 %');
    assert.equal(effect.minutes, 1440, 'a story effect lasts a day at most');
    assert.match(out.result.problem, /code sets its size/);
    rejects(capture(state, '+ effect Glow — nice | for: 2h', { carrier: carrier(3) }), 'INVALID', /say what it acts on/);
    rejects(capture(state, '+ effect Glow — nice | on: stealth | for: soon-ish', { carrier: carrier(3) }), 'INVALID', /not a length of time/);
    rejects(capture(state, '+ effect Glow — nice | on: stealth | who: Nobody', { carrier: carrier(3) }), 'NOT_FOUND');
    rejects(capture(state, '~ effect Glow — nice | on: stealth', { carrier: carrier(3) }), 'INVALID');
    rejects(capture(state, '+ effect Glow — nice | on: stealth', { carrier: carrier(3), feature: id => id !== FEATURE }), 'FEATURE_OFF');
});

test('one story effect a reply; the same name renews; a story effect on the same thing takes the old one\'s place', () => {
    let state = party();
    state = capture(state, '+ effect A — x | on: stealth | for: 1h', { carrier: carrier(7) }).state;
    rejects(capture(state, '+ effect B — x | on: lock | for: 1h', { carrier: carrier(7) }), 'REFUSED', /Only one new effect counts/);
    const before = listOf(state).find(effect => effect.name === 'A');
    const renewed = capture(state, '+ effect A — again | on: lock | for: 2h', { carrier: carrier(9) });
    assert.ok(renewed.ok, renewed.message);
    const after = listOf(renewed.state).filter(effect => effect.name === 'A');
    assert.equal(after.length, 1);
    assert.notEqual(after[0].id, before.id);
    assert.deepEqual(renewed.result.data.renewed, [before.id]);
    // Another name on the same check: the newer story effect is the one that counts.
    const other = capture(renewed.state, '+ effect Shadow Step — y | on: lock, attack | for: 1h', { carrier: carrier(11) });
    assert.ok(other.ok, other.message);
    assert.deepEqual(listOf(other.state).map(effect => effect.name), ['Shadow Step']);
    // A thing's effect on the same check stays beside a story one.
    const item = run(other.state, 'party.addEffect', { name: 'Draught', on: 'lock', for: '1h', source: { kind: 'item', name: 'Draught' } });
    const story = capture(item.state, '+ effect Nimble — z | on: lock | for: 1h', { carrier: carrier(13) });
    assert.deepEqual(listOf(story.state).map(effect => effect.name).sort(), ['Draught', 'Nimble']);
});

test('- effect ends a story effect early; a quest\'s or a Setback does not end from the story', () => {
    let state = capture(party(), '+ effect Warmth — a fire | on: endurance | for: 2h', { carrier: carrier(3) }).state;
    state = run(state, 'party.addEffect', { preset: 'setback', source: { name: 'Rats in the Cellar', ref: 'qu_rats0001' } }).state;
    const ended = capture(state, '- effect Warmth', { carrier: carrier(5) });
    assert.ok(ended.ok, ended.message);
    assert.deepEqual(listOf(ended.state).map(effect => effect.name), ['Setback']);
    rejects(capture(ended.state, '- effect Setback', { carrier: carrier(5) }), 'REFUSED', /ends by itself/);
    rejects(capture(ended.state, '- effect Nothing', { carrier: carrier(5) }), 'NOT_FOUND');
});

test('party.addEffect: internal only, Setback once per quest on everyone, a consumable\'s buff, a worn piece\'s', () => {
    const state = party();
    rejects(run(state, 'party.addEffect', { name: 'X', on: 'stealth' }, { cause: 'ui' }), 'REFUSED', /not from a button/);
    const setback = run(state, 'party.addEffect', { preset: 'setback', source: { name: 'Rats', ref: 'qu_rats0001' } }, { time: 100 });
    assert.ok(setback.ok, setback.message);
    const [effect] = listOf(setback.state);
    assert.equal(effect.actor, 'party');
    assert.equal(effect.name, SETBACK.name);
    assert.deepEqual(effect.checks, [{ on: 'all', amount: -1 }]);
    assert.equal(effect.minutes, 24 * 60);
    rejects(run(setback.state, 'party.addEffect', { preset: 'setback', source: { name: 'Rats', ref: 'qu_rats0001' } }), 'CLAIMED');
    const draught = run(state, 'party.addEffect', { who: 'Lyra', name: 'Hawk Eye', note: 'the draught', on: 'perception', strength: 'major', for: '1h', source: { kind: 'item', name: 'Hawk Draught' } });
    assert.ok(draught.ok, draught.message);
    assert.deepEqual(listOf(draught.state)[0].checks, [{ on: 'perception', amount: 3 }], 'code may give major');
    // A worn piece's effect lasts while that stack is equipped by the member.
    const worn = structuredClone(state);
    const pc = pcOf(worn);
    worn.domains.inventory.defs.ring = { id: 'ring', name: 'Ember Ring', kind: 'gear', slot: 'accessory' };
    worn.domains.inventory.stacks.st_ring0001 = { def: 'ring', qty: 1, owner: pc.id, equipped: 'accessory-1' };
    const gear = run(worn, 'party.addEffect', { actor: pc.id, name: 'Ember Ward', on: 'defence', source: { kind: 'gear', name: 'Ember Ring', ref: 'st_ring0001' } });
    assert.ok(gear.ok, gear.message);
    const ward = listOf(gear.state)[0];
    assert.equal(ward.minutes, null);
    assert.equal(ward.replies, null);
    const view = s => ({ party: s.domains.party, inventory: s.domains.inventory, now: { minutes: 999999, at: 999 } });
    assert.equal(isOn(ward, view(gear.state)), true);
    const off = structuredClone(gear.state);
    off.domains.inventory.stacks.st_ring0001.equipped = null;
    assert.equal(isOn(ward, view(off)), false, 'taken off: the effect ends');
    rejects(run(worn, 'party.addEffect', { actor: pc.id, name: 'X', on: 'defence', source: { kind: 'gear', name: 'Ring' } }), 'INVALID', /names its stack/);
});

test('an effect ends at whichever comes first: the clock or its replies, counted in turns', () => {
    let state = party();
    state = capture(state, '+ effect Glow — warm | on: social | for: 2 replies', { carrier: carrier(10) }).state;
    const [effect] = listOf(state);
    assert.equal(effect.minutes, null);
    assert.equal(effect.start.turn, 0);
    const at = (turn, minutes = null) => ({ party: state.domains.party, inventory: state.domains.inventory, now: { minutes, turn } });
    assert.equal(isOn(effect, at(0)), true);
    assert.equal(isOn(effect, at(2)), true, 'the second reply after it');
    assert.equal(isOn(effect, at(3)), false);
    const timed = capture(party(), '+ effect Glow — warm | on: social | for: 1h', { carrier: carrier(10), time: 60 }).state;
    const clock = listOf(timed)[0];
    assert.equal(clock.replies, 2, 'an hour is about two replies');
    const now = (minutes, turn) => ({ party: timed.domains.party, inventory: timed.domains.inventory, now: { minutes, turn } });
    assert.equal(isOn(clock, now(119, 1)), true);
    assert.equal(isOn(clock, now(120, 1)), false, 'the clock ends it');
    assert.equal(isOn(clock, now(61, 3)), false, 'the replies end it, however the clock was set back');
    assert.equal(isOn(clock, now(0, 2)), true);
    assert.equal(isOn(clock, now(null, 2)), true, 'no clock: the replies');
});

test('party.effectsTurn: a turn keyed by receipt, numbered past the highest, the oldest pruned; effects that are over go', () => {
    let state = party();
    state = capture(state, '+ effect Glow — warm | on: social | for: 1 reply', { carrier: carrier(4) }).state;
    rejects(run(state, 'party.effectsTurn', {}, { cause: 'ui' }), 'REFUSED');
    for (let rev = 10; rev < 10 + MAX_TURNS + 5; rev += 1) {
        const out = run(state, 'party.effectsTurn', {}, { cause: 'system', rev });
        assert.ok(out.ok, out.message);
        state = out.state;
        if (rev === 10) assert.equal(listOf(state).length, 1, 'turn 1: still on');
        if (rev === 11) assert.deepEqual(listOf(state), [], 'turn 2: over and pruned by key');
    }
    const turns = state.domains.effects.turns;
    assert.equal(Object.keys(turns).length, MAX_TURNS);
    assert.deepEqual(turns[`r${10 + MAX_TURNS + 4}`], { n: MAX_TURNS + 5, rev: 10 + MAX_TURNS + 4, seen: null, dm: 0 });
    assert.deepEqual(validateEffects(state.domains.effects), []);
    // A turn deleted from the middle never lowers the later numbers.
    const gap = structuredClone(state);
    delete gap.domains.effects.turns[`r${20}`];
    assert.equal(run(gap, 'party.effectsTurn', {}, { cause: 'system', rev: 999 }).state.domains.effects.turns.r999.n, MAX_TURNS + 6);
});

test('party.effects and the HUD shape; the check table and the fight numbers move', () => {
    let state = party();
    const lyra = byName(state, 'Lyra');
    state = capture(state, '+ effect Keen Sight — sharper eyes | on: perception, attack | for: 2h | who: Lyra | strength: moderate', { carrier: carrier(4), time: 0 }).state;
    state = run(state, 'party.addEffect', { preset: 'setback', source: { name: 'Rats', ref: 'qu_r' } }, { time: 0 }).state;
    state.domains.director = { time: { minutes: 30 } };
    const list = effectsQuery(state, { actor: lyra.id });
    assert.deepEqual(list.map(effect => [effect.name, effect.tone, effect.left, effect.source]), [['Keen Sight', 'good', '1 h 30 min', 'story'], ['Setback', 'bad', '23 h', 'failed: Rats']]);
    // Without the clock, the replies they have left.
    delete state.domains.director;
    assert.deepEqual(effectsQuery(state, { actor: lyra.id }).map(effect => effect.left), ['4 replies', '48 replies']);
    state.domains.director = { time: { minutes: 30 } };
    assert.deepEqual(effectsQuery(state, {}, { feature: () => false }), [], 'feature off: none');
    const query = (name, args) => part.queries[name](state, args);
    const member = memberOf(query, byName(state, 'Lyra'), {});
    const mods = modifiersFor(member, 'perception');
    assert.deepEqual(mods.filter(entry => entry.source === 'effect'), [{ source: 'effect', amount: 1, reason: 'Keen Sight' }, { source: 'effect', amount: -1, reason: 'Setback' }]);
    assert.deepEqual(modifiersFor(member, 'stealth').filter(entry => entry.source === 'effect'), [{ source: 'effect', amount: -1, reason: 'Setback' }]);
    assert.match(tableLine(member, {}), /\+1 perception \(Keen Sight\), −1 all checks \(Setback\)\.$/);
    const plain = combatNumbersOf(party(), { id: lyra.id });
    const buffed = combatNumbersOf(state, { id: lyra.id });
    assert.equal(buffed.attack, Math.round(plain.attack * 1.05 * 10) / 10, 'a story effect: +5 %');
    assert.deepEqual(buffed.effects, { attack: 5 });
    // Code's effects (things, quests) keep their sizes, and all together stop at ±15 %.
    let strong = state;
    for (const name of ['Ox Draught', 'Bull Tonic']) strong = run(strong, 'party.addEffect', { actor: lyra.id, name, on: 'attack', strength: 3, for: '1h', source: { kind: 'item', name } }, { time: 0 }).state;
    assert.deepEqual(combatNumbersOf(strong, { id: lyra.id }).effects, { attack: 15 });
});

test('effects together move a check by ±3 at most', () => {
    let state = party();
    for (const [name, n] of [['A', 4], ['B', 5], ['C', 6]]) {
        state = run(state, 'party.addEffect', { name, on: 'stealth', strength: 3, for: '1h', source: { kind: 'item', name } }, { carrier: carrier(n) }).state;
    }
    assert.equal(listOf(state).length, 3);
    const query = (name, args) => part.queries[name](state, args);
    const mods = modifiersFor(memberOf(query, pcOf(state), {}), 'stealth');
    assert.equal(mods.filter(entry => entry.source === 'effect').reduce((sum, entry) => sum + entry.amount, 0), 3);
});

test('the tail names effects without numbers; the prune hook only when something is over', () => {
    let state = party();
    state = capture(state, '+ effect Keen Sight — sharper eyes | on: perception | for: 1h | who: Lyra', { carrier: carrier(2), time: 0 }).state;
    const view = (minutes, length = 4) => ({ state: { ...state, domains: { ...state.domains, director: { time: { minutes } } } }, chat: { length }, settings: () => ({}) });
    const lines = tail(view(10)).lines;
    const line = lines.find(entry => entry.startsWith('Effects:'));
    assert.equal(line, 'Effects: Lyra — Keen Sight (sharper eyes, 50 min).');
    assert.doesNotMatch(line, /[+−-]\d/);
    assert.equal(tail(view(61)).lines.some(entry => entry.startsWith('Effects:')), false);
    const turn = { commands: [{ type: 'party.effectsTurn', payload: {} }] };
    assert.deepEqual(turnBeforeReply(view(10), { type: 'normal' }), turn);
    assert.deepEqual(turnBeforeReply(view(10), { type: 'regenerate' }), turn);
    assert.deepEqual(turnBeforeReply(view(10), { type: 'swipe' }), { commands: [] }, 'a swipe is the same turn');
    assert.deepEqual(turnBeforeReply(view(10), { type: 'continue' }), { commands: [] });
    assert.deepEqual(turnBeforeReply({ ...view(10), feature: () => false }), { commands: [] });
    assert.deepEqual(turnBeforeReply({ state: party(), chat: { length: 4 } }), { commands: [] }, 'no effects: no turn');
    const over = { ...state, domains: { ...state.domains, director: { time: { minutes: 61 } } } };
    const pruned = run(over, 'party.effectsTurn', {}, { cause: 'system', time: 61 });
    assert.ok(pruned.ok, pruned.message);
    assert.deepEqual(pruned.state.domains.effects.active, {});
});

test('an effect on someone who left is off; the validator refuses bad records', () => {
    let state = party();
    const lyra = byName(state, 'Lyra');
    state = capture(state, '+ effect Glow — x | on: social | for: 1h | who: Lyra', { carrier: carrier(2) }).state;
    state = run(state, 'party.removeCompanion', { actor: lyra.id }).state;
    assert.deepEqual(effectsQuery(state, {}), []);
    const bad = { active: { ef_00000001: { id: 'ef_00000001', actor: 'nobody', name: '', tone: 'meh', source: { kind: 'x' }, checks: [{ on: 'flying', amount: 9 }], combat: { speed: 1 }, start: {}, until: null, replies: null, rev: -1 } }, turns: { x: 1 } };
    assert.ok(validateEffects(bad).length >= 9);
    assert.deepEqual(validateEffects({ active: {} }), []);
    assert.deepEqual(validateEffects(null), ['effects.active must be a record.']);
});

test('party.toSpend lists who has points to spend', () => {
    const state = makeState();
    assert.deepEqual(toSpend(state), { total: 0, people: [] });
    const pc = withPc();
    pcOf(pc).points = 3;
    assert.deepEqual(toSpend(pc), { total: 3, people: [{ id: pcOf(pc).id, name: 'Ren', points: 3 }] });
});

test('the merged module declares the feature and marks what it owns (MODULES §F100)', async () => {
    const { rpgBattleModule } = await import('../../../src/v2/module.js');
    assert.deepEqual(rpgBattleModule.features.map(feature => [feature.id, feature.default, feature.prompt]), [[FEATURE, true, true], ['rpg-battle.crafting', true, true]]);
    assert.equal(rpgBattleModule.capture.kinds.effect.feature, FEATURE);
    for (const type of ['party.addEffect', 'party.endEffect', 'party.effectsTurn']) assert.equal(rpgBattleModule.commands[type].feature, FEATURE, type);
    assert.equal(rpgBattleModule.queries['party.effects'].feature, FEATURE);
    for (const name of ['party.ranks', 'party.toSpend', 'party.combatNumbers']) assert.equal(rpgBattleModule.queries[name].feature, undefined, name);
    assert.equal(rpgBattleModule.domains.effects.initial().active && true, true);
});

test('encumbered (Story Block\'s inventory.encumbrance): −2 on AGI and DEX checks and fight stats; nothing without the query', async () => {
    const { encumbered } = await import('../../../src/v2/party/queries.js');
    const state = party();
    const ren = pcOf(state);
    const lyra = byName(state, 'Lyra');
    const heavy = { encumbered: true, party: false, who: [{ id: ren.id, name: 'Ren', load: 90, capacity: 60 }], penalty: -2, stats: ['AGI', 'DEX'] };
    const toolsWith = found => ({ query: (name, args) => (name === 'inventory.encumbrance' ? found : part.queries[name]?.(state, args) ?? null) });
    const query = (name, args) => toolsWith(heavy).query(name, args);
    const mods = modifiersFor(memberOf(query, ren, {}), 'stealth');
    assert.deepEqual(mods.find(entry => entry.reason === 'Encumbered'), { source: 'effect', amount: -2, reason: 'Encumbered' });
    assert.equal(modifiersFor(memberOf(query, ren, {}), 'climb').some(entry => entry.reason === 'Encumbered'), false, 'climb is STR');
    assert.equal(modifiersFor(memberOf(query, lyra, {}), 'stealth').some(entry => entry.reason === 'Encumbered'), false, 'Lyra is not named');
    assert.match(tableLine(memberOf(query, ren, {}), {}), /−2 AGI checks \(Encumbered\), −2 DEX checks \(Encumbered\)\.$/);
    const whole = (name, args) => toolsWith({ ...heavy, who: [], party: true }).query(name, args);
    assert.ok(modifiersFor(memberOf(whole, lyra, {}), 'stealth').some(entry => entry.reason === 'Encumbered'), 'the whole party over: everyone');
    const plain = combatNumbersOf(state, { id: ren.id });
    const burdened = combatNumbersOf(state, { id: ren.id }, toolsWith(heavy));
    assert.equal(burdened.stats.AGI, plain.stats.AGI - 2);
    assert.equal(burdened.stats.DEX, plain.stats.DEX - 2);
    assert.deepEqual(encumbered(state, { actor: ren.id }, toolsWith(heavy)), { penalty: -2, stats: ['AGI', 'DEX'], text: 'Encumbered: AGI and DEX checks −2' });
    assert.equal(encumbered(state, { actor: ren.id }, toolsWith({ ...heavy, encumbered: false })), null);
    assert.equal(encumbered(state, { actor: ren.id }, { query: () => { throw new Error('no such query'); } }), null);
    assert.equal(encumbered(state, { actor: ren.id }, null), null);
    assert.equal(modifiersFor(memberOf(() => null, ren, {}), 'stealth').some(entry => entry.reason === 'Encumbered'), false);
});

test('RX-TL-4: story time passed is summed from the turns, never from an absolute end; moves back count as none', () => {
    const effect = { start: { minutes: 780, turn: 0 }, minutes: 120 };
    const turns = list => Object.fromEntries(list.map(([n, seen, dm]) => [`r${n}`, { n, rev: n, seen, dm }]));
    assert.equal(minutesSince(effect, { minutes: 790, turns: {} }), 10);
    // The time jump before the effect deleted: the clock reads 600 now, but no time has passed for the effect.
    assert.equal(minutesSince(effect, { minutes: 600, turns: {} }), 0);
    assert.equal(minutesSince(effect, { minutes: 620, turns: turns([[1, 790, 10], [2, 800, 10]]) }), 20, 'its own turns, then nothing for the clock going back');
    assert.equal(minutesSince(effect, { minutes: 650, turns: turns([[1, 600, 0], [2, 640, 40]]) }), 50, 'a clock set back counts as no time; forward from there counts');
    assert.equal(minutesSince({ start: { minutes: null, turn: 0 }, minutes: null }, { minutes: 700, turns: {} }), null);
    assert.equal(minutesSince(effect, { minutes: null, turns: {} }), null);
});
