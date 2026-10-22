// The party domain's validator, queries, prompt tail and settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byName, capture, makeState, pcOf, run, withPc } from './helpers/fake-ctx.js';
import { part } from '../../../src/v2/party/index.js';
import { DEFAULT_RULES } from '../../../src/rules.js';
import { combatNumbers } from '../../../src/party.js';
import { toSheet } from '../../../src/v2/party/sheets.js';

const validate = slice => part.domains.party.validate(slice);

function sample() {
    let state = withPc();
    state = run(state, 'party.addCompanion', { name: 'Lyra', role: 'ranger', level: 3 }).state;
    state = capture(state, '+ join Bram — a smith').state;
    return state;
}

test('initial state is a valid empty party', () => {
    assert.deepEqual(part.domains.party.initial(), { pc: null, order: [], actors: {}, custom: {}, offers: {} });
    assert.deepEqual(validate(part.domains.party.initial()), []);
    assert.deepEqual(validate(sample().domains.party), []);
});

test('the validator catches broken records', () => {
    const base = sample().domains.party;
    const pc = base.pc;
    const broken = (change, pattern) => {
        const slice = structuredClone(base);
        change(slice);
        const errors = validate(slice);
        assert.ok(errors.some(error => pattern.test(error)), `${pattern}: ${errors.join(' | ')}`);
    };
    broken(slice => { slice.actors[pc].hp.lost = 1.5; }, /HP must be whole numbers/);
    broken(slice => { slice.actors[pc].hp.left = 3; }, /HP must be whole numbers/);
    broken(slice => { slice.actors[pc].mp.cur = -1; }, /MP must be/);
    broken(slice => { slice.actors[pc].sp = null; }, /SP must be/);
    broken(slice => { slice.actors[pc].level = 1.5; }, /level must be/);
    broken(slice => { slice.actors[pc].xp = 1.5; }, /xp must be/);
    broken(slice => { slice.actors[pc].points = '2'; }, /points must be/);
    broken(slice => { slice.actors[pc].stats.STR = '9'; }, /stats must be/);
    broken(slice => { slice.actors[pc].stats.POW = 3; }, /stats must be/);
    broken(slice => { slice.actors[pc].name = ''; }, /a name is needed/);
    broken(slice => { slice.actors[pc].kind = 'npc'; }, /kind must be/);
    broken(slice => { slice.actors[pc].control = 'command'; }, /control must be/);
    broken(slice => { slice.actors[pc].skills = [{ name: 'Sweep', level: 0, uses: 0, active: true }]; }, /each skill needs/);
    broken(slice => { slice.actors[pc].skills = [{ name: 'Sweep', level: 1, uses: 0, active: true }, { name: 'sweep', level: 1, uses: 0, active: true }]; }, /listed twice/);
    broken(slice => { slice.actors[pc].conditions = [{ kind: 'poison', stacks: 0 }]; }, /each condition needs/);
    broken(slice => { slice.actors[pc].npc = 5; }, /npc must be/);
    broken(slice => { slice.actors[pc].id = 'ac_other000'; }, /its id field/);
    broken(slice => { slice.actors.pc = { ...slice.actors[pc], id: 'pc' }; slice.order.push('pc'); }, /not an actor id/);
    broken(slice => { slice.pc = null; }, /party.pc is empty/);
    broken(slice => { slice.pc = slice.order[1]; }, /must name the pc actor/);
    broken(slice => { slice.order.reverse(); }, /must start with the pc/);
    broken(slice => { slice.order.pop(); }, /every actor once/);
    broken(slice => { slice.custom.Zap = { name: 'Zop' }; }, /custom.Zap/);
    broken(slice => { Object.values(slice.offers)[0].kind = 'farewell'; }, /join, skill or leave/);
    broken(slice => { Object.values(slice.offers)[0].kind = 'leave'; Object.values(slice.offers)[0].actor = slice.pc; }, /leave offer is for a companion/);
    broken(slice => { slice.actors[pc].background = 7; }, /background must be text/);
    broken(slice => { slice.actors[pc].origin = { race: 'elf', talents: [] }; }, /origin must be/);
    broken(slice => { Object.values(slice.offers)[0].id = 'bad'; }, /not an offer id/);
    broken(slice => { Object.values(slice.offers)[0].rev = -1; }, /rev must be/);
    broken(slice => { slice.offers.of_zzzzzzzz = { ...Object.values(slice.offers)[0] }; }, /kept under another id/);
    broken(slice => { slice.offers = [...Object.values(slice.offers), ...Object.values(slice.offers)]; }, /id twice/);
    broken(slice => { slice.offers.of_aaaaaaaa = { id: 'of_aaaaaaaa', kind: 'skill', actor: '', skill: 'Mend', rev: 0 }; }, /names nobody/);
    assert.deepEqual(validate(null), ['party is not a record.']);
});

test('queries: actors in order, one by id or name, the pc, offers; plain copies', () => {
    const state = sample();
    const list = part.queries['party.actors'](state);
    assert.deepEqual(list.map(actor => actor.name), ['Ren', 'Lyra']);
    list[0].name = 'changed';
    assert.equal(pcOf(state).name, 'Ren', 'a copy, not the state');
    const lyra = byName(state, 'Lyra');
    assert.deepEqual(part.queries['party.actor'](state, { id: lyra.id }), lyra);
    assert.deepEqual(part.queries['party.actor'](state, { name: 'lyra' }), lyra);
    assert.deepEqual(part.queries['party.actor'](state, { name: 'you' }), pcOf(state));
    assert.equal(part.queries['party.actor'](state, { name: 'Kael' }), null);
    assert.equal(part.queries['party.actor'](state, {}), null);
    assert.deepEqual(part.queries['party.pc'](state), pcOf(state));
    assert.equal(part.queries['party.pc'](makeState()), null);
    assert.equal(part.queries['party.offers'](state)[0].name, 'Bram');
    assert.deepEqual(part.queries['party.actors']({ domains: {} }), []);
});

test('party.combatNumbers counts the equipped stacks the member owns (v1 combatNumbers)', () => {
    const base = sample();
    const pc = base.domains.party.pc;
    const lyra = byName(base, 'Lyra');
    const state = structuredClone(base);
    const inv = state.domains.inventory;
    inv.defs['story/longsword'] = { id: 'story/longsword', name: 'Longsword', kind: 'equipment', rarity: 'uncommon', value: 0, stack: false, slot: 'weapon', stats: { ATK: 5, STR: 1 }, effect: {}, tags: [], note: '' };
    inv.defs['story/ring'] = { id: 'story/ring', name: 'Copper Ring', kind: 'equipment', rarity: 'common', value: 0, stack: false, slot: 'accessory', stats: { LUK: 1 }, effect: {}, tags: [], note: '' };
    inv.stacks.it_sword000 = { id: 'it_sword000', def: 'story/longsword', qty: 1, owner: pc, equipped: 'weapon', note: '', from: '' };
    inv.stacks.it_ring0000 = { id: 'it_ring0000', def: 'story/ring', qty: 1, owner: pc, equipped: null, note: '', from: '' };
    inv.stacks.it_ring0001 = { id: 'it_ring0001', def: 'story/ring', qty: 1, owner: lyra.id, equipped: 'accessory', note: '', from: '' };
    const numbers = part.queries['party.combatNumbers'](state, { id: pc });
    const gear = [{ name: 'Longsword', equipped: true, slot: 'weapon', rarity: 'uncommon', stats: { ATK: 5, STR: 1 }, tags: [] }];
    const v1 = combatNumbers(toSheet(pcOf(state)), { gear, rules: DEFAULT_RULES });
    for (const key of ['attack', 'magic', 'defence', 'mdef', 'crit', 'hit', 'dodge', 'stats']) assert.deepEqual(numbers[key], v1[key], key);
    assert.deepEqual(numbers.gear, ['Longsword']);
    assert.equal(numbers.stats.STR, pcOf(state).stats.STR + 1);
    assert.deepEqual(part.queries['party.combatNumbers'](state, { id: lyra.id }).gear, ['Copper Ring']);
    assert.equal(part.queries['party.combatNumbers'](state, { id: 'ac_nobody00' }), null);
    assert.ok(part.queries['party.combatNumbers'](base, { id: pc }).attack > 0, 'no gear works too');
});

test('the tail: one compact line per member, offers as optional lines', () => {
    let state = sample();
    state = capture(state, '~ wound Ren — a fall | harm: wound', { carrier: 1 }).state;
    state = capture(state, '~ wound Lyra — poisoned', { carrier: 1 }).state;
    const ren = pcOf(state);
    const lyra = byName(state, 'Lyra');
    const tail = part.context.tail({ state, settings: {} });
    assert.deepEqual(tail.lines, [
        `Party: Ren (you): Lv 1 · HP ${ren.hp.cur}/${ren.hp.max} · MP ${ren.mp.cur}/${ren.mp.max} · SP ${ren.sp.cur}/${ren.sp.max}`,
        `Party: Lyra (ranger): Lv 3 · HP ${lyra.hp.cur}/${lyra.hp.max} · MP ${lyra.mp.cur}/${lyra.mp.max} · SP ${lyra.sp.cur}/${lyra.sp.max} · poisoned`,
    ]);
    assert.deepEqual(tail.optional, ['Party, waiting on the reader: Bram asked to join (do not write these lines again).']);
    const chars = [...tail.lines, ...tail.optional].join('\n').length;
    assert.ok(chars / 4 <= part.context.budget, 'within the budget');
    assert.deepEqual(part.context.tail({ state: makeState() }), { lines: [], optional: [] });
    const down = structuredClone(state);
    // A pool below full keeps `lost` (party/pools.js): HP 0 is all of max lost.
    Object.assign(pcOf(down).hp, { cur: 0, lost: pcOf(down).hp.max });
    assert.match(part.context.tail({ state: down, settings: () => ({}) }).lines[0], /· down$/);
    const tiers = part.context.tail({ state, settings: { terms: { levelName: 'Soul Power', xpName: 'Growth' } } });
    assert.match(tiers.lines[0], /Soul Power 1/);
});

test('settings: the Character section with v1\'s defaults and a schema for each', () => {
    const { section, defaults, schema } = part.settings;
    assert.equal(section, 'Character');
    assert.deepEqual(defaults, {
        startPoints: DEFAULT_RULES.character.startPoints, statCap: DEFAULT_RULES.character.statCap,
        pointsPerLevel: DEFAULT_RULES.character.pointsPerLevel, xpBase: DEFAULT_RULES.character.xpBase,
        maxLevel: DEFAULT_RULES.character.maxLevel, activeSkills: DEFAULT_RULES.character.activeSkills, autoSpend: true,
        maxCompanions: 3, xpName: '', levelName: '', ranks: [], levelsPerRank: 0,
    });
    for (const key of Object.keys(defaults)) assert.ok(schema[key], key);
    const tuned = run(makeState(), 'party.create', { name: 'Ren', points: { STR: 15 } }, { settings: { startPoints: 15 } });
    assert.ok(tuned.ok, tuned.message);
    assert.equal(pcOf(tuned.state).stats.STR, 20);
});

test('the part has the MODULES §A shape', () => {
    assert.deepEqual(Object.keys(part).sort(), ['commands', 'context', 'domains', 'features', 'hooks', 'kinds', 'queries', 'settings', 'tabs']);
    for (const [kind, def] of Object.entries(part.kinds)) {
        assert.equal(typeof def.grammar, 'string', kind);
        assert.equal(typeof def.apply, 'function', kind);
    }
    assert.equal(typeof part.context.tail, 'function');
    assert.equal(part.context.budget, 320);
    assert.deepEqual(part.tabs.map(tab => tab.id), ['party']);
});
