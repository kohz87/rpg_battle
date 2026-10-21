// QA (UI preview findings): while a fight runs every view reads one HP (the party follows the
// fight per action); fight loot uses the item the chat or a pack already has for that drop (the
// base creature's part) and joins its stack; a fight's id never moves the dice it is fought with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rng as intRng } from '../../vendor/story-block/src/v2/rng.js';
import { fightOut, patch, withHero, each } from './helpers/harness.js';

function start(h, name, tier = 'weak') {
    h.capture({ op: '!', kind: 'encounter', name, text: '', labels: { tier } });
    const r = h.command('combat.start', { offer: h.query('combat.offers').at(-1).id });
    assert.equal(r.ok, true, r.message);
    return r;
}

const fightPools = h => Object.fromEntries(h.query('combat.session').combatants.filter(c => c.side === 'party').map(c => [c.id, { hp: c.hp.cur, mp: c.mp.cur }]));
const partyPools = h => Object.fromEntries(Object.values(h.state().domains.party.actors).map(a => [a.id, { hp: a.hp.cur, mp: a.mp.cur }]));

each('while a fight runs, the party\'s HP and MP are the fight\'s after every action', () => {
    const { h, pc } = withHero({ seed: 4 });
    h.command('party.addCompanion', { name: 'Lyra', role: 'archer', level: 1 });
    start(h, '3 Wolves', 'strong');
    assert.equal(Object.keys(fightPools(h)).length, 2);
    for (const [id, pool] of Object.entries(fightPools(h))) assert.deepEqual(partyPools(h)[id], pool, 'from the first blows on');
    let hurt = false;
    for (let n = 0; n < 40 && h.query('combat.session')?.status === 'active'; n++) {
        const target = h.query('combat.session').actions.targets.enemies[0];
        assert.equal(h.command('combat.act', { action: { type: 'attack', target } }).ok, true);
        const pools = fightPools(h);
        for (const [id, pool] of Object.entries(pools)) assert.deepEqual(partyPools(h)[id], pool, `after action ${n}`);
        hurt ||= pools[pc].hp < h.state().domains.party.actors[pc].hp.max;
    }
    assert.ok(hurt, 'the wolves drew blood');
});

each('in a running fight, healing and resting outside it are refused; a click cannot set HP', () => {
    const { h, pc } = withHero({ seed: 4 });
    start(h, '3 Wolves', 'strong');
    for (const [type, payload] of [['party.heal', { actor: pc, hp: 5 }], ['party.rest', { kind: 'long' }], ['party.fightPools', { actors: [{ id: pc, hp: 1 }] }]]) {
        const before = JSON.stringify(h.state());
        const r = h.command(type, payload);
        assert.equal(r.code, 'REFUSED', type);
        assert.equal(JSON.stringify(h.state()), before);
    }
});

/** The chat already holds a pack's Crag Wolf parts (as when a pack's item was named before). */
function withPackItems(h) {
    patch(h, state => {
        const inv = state.domains.inventory;
        inv.defs['pack.ersveil/crag-wolf-pelt'] = { id: 'pack.ersveil/crag-wolf-pelt', name: 'Crag Wolf Pelt', kind: 'material', rarity: 'common', value: 7, stack: true, slot: null, stats: {}, effect: {}, tags: ['hide'], note: 'A grey pelt.' };
        inv.defs['pack.ersveil/crag-wolf-fang'] = { id: 'pack.ersveil/crag-wolf-fang', name: 'Crag Wolf Fang', kind: 'material', rarity: 'common', value: 4, stack: true, slot: null, stats: {}, effect: {}, tags: ['bone'], note: '' };
    });
}

each('fight loot is the item the chat has for the base creature\'s part, one stack across fights', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 2; seed++) {
        const { h } = withHero({ seed });
        withPackItems(h);
        let parts = 0;
        for (let fight = 0; fight < 2; fight++) {
            start(h, 'Starved Crag Wolf', 'trivial');
            fightOut(h);
            const end = h.command('combat.end');
            assert.equal(end.ok, true, end.message);
            const names = (end.receipt.data.loot?.items ?? []).map(item => item.name);
            assert.ok(names.every(name => !/Starved/.test(name)), names.join(', '));
            parts += (end.receipt.data.loot?.items ?? []).filter(item => /^Crag Wolf (?:Pelt|Fang)$/.test(item.name)).reduce((sum, item) => sum + item.qty, 0);
            assert.equal(h.command('party.rest', { kind: 'long' }).ok, true);
        }
        const inv = h.state().domains.inventory;
        assert.equal(Object.values(inv.defs).some(def => /Starved/.test(def.name)), false);
        if (!parts) continue;
        const rows = Object.values(inv.stacks).filter(stack => /^pack\.ersveil\//.test(stack.def));
        assert.ok(rows.length <= 2, 'one row per part');
        assert.equal(rows.reduce((sum, row) => sum + row.qty, 0), parts);
        checked += 1;
    }
    assert.ok(checked, 'some seed drops a pelt or a fang');
});

each('a drop of an item the chat already has joins its stack', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const { h } = withHero({ seed });
        h.capture({ op: '+', kind: 'item', name: 'Cellar Rat Tail', labels: { qty: '1' } });
        start(h, 'Cellar Rat', 'trivial');
        fightOut(h);
        const end = h.command('combat.end');
        const tails = end.receipt.data.loot?.items.find(item => item.name === 'Cellar Rat Tail')?.qty;
        if (!tails) continue;
        const rows = h.query('inventory.items').filter(row => row.name === 'Cellar Rat Tail');
        assert.deepEqual(rows.map(row => row.qty), [1 + tails]);
        return;
    }
    assert.fail('no seed dropped a tail');
});

test('[int] a fight\'s seed is the receipt\'s first die: its id comes from ctx.id\'s own stream', () => {
    const { h } = withHero({ seed: 9, host: 'int' });
    const r = start(h, '2 Wolves', 'even');
    const session = h.state().domains.combat.session;
    assert.match(session.id, /^fi_[0-9a-z]{8}$/);
    assert.equal(session.setup.seed, Math.floor(intRng(r.receipt.seed)() * 4294967296) >>> 0);
});
