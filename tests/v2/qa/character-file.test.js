// QA: your character as a file (MODULES §F66). party.export writes it into its receipt's data;
// creation.import reads it into a new chat instead of the wizard, checked by that chat's rules
// (level cap, stat cap, the points a character of that level can have, the skills), and grants
// what was carried through inventory.grant. Through Story Block's real bus, on both hosts.
import assert from 'node:assert/strict';
import { bytes, createHarness, holdings, stacksOf, storyCoin, storyItem, withHero, each } from './helpers/harness.js';

/** A level-3 Ren with a worn sword, three draughts, coin, and a story-taught skill. */
function travelled() {
    const { h, pc } = withHero();
    const sword = storyItem(h, 'Iron Sword', 1, 'ATK +2');
    storyItem(h, 'Minor Healing Draught', 3);
    storyCoin(h, 120);
    assert.equal(h.command('item.equip', { stack: stacksOf(h, sword)[0].stack }).ok, true);
    assert.equal(h.command('party.grantXp', { xp: 250 }, { cause: 'story' }).ok, true);
    assert.equal(h.command('party.spend', { points: { STR: 2, AGI: 1 } }).ok, true);
    const taught = h.command('party.learnSkill', { name: 'Tide Cut', template: { type: 'physical', stat: 'AGI', target: 'one', element: 'ice', note: 'A cut like a cold current.' }, free: true });
    assert.equal(taught.ok, true, taught.message);
    return { h, pc };
}

function exported(h) {
    const r = h.command('party.export', {});
    assert.equal(r.ok, true, r.message);
    return r.receipt.data.character;
}

each('party.export: the file in the receipt\'s data; nothing in the state changes', () => {
    const { h, pc } = travelled();
    const domains = JSON.stringify(h.state().domains);
    const r = h.command('party.export', {});
    assert.equal(r.ok, true, r.message);
    assert.equal(JSON.stringify(h.state().domains), domains);
    const file = r.receipt.data.character;
    assert.equal(r.receipt.data.fileName, 'ren.rpg-battle.json');
    assert.equal(file.rpgBattleCharacter, 1);
    const me = h.state().domains.party.actors[pc];
    assert.deepEqual([file.name, file.level, file.xp, file.points], [me.name, me.level, me.xp, me.points]);
    assert.deepEqual(file.stats, me.stats);
    assert.deepEqual(file.skills.map(skill => skill.name), me.skills.map(skill => skill.name));
    assert.deepEqual(file.custom, [{ name: 'Tide Cut', type: 'physical', stat: 'AGI', target: 'one', element: 'ice', note: 'A cut like a cold current.' }]);
    assert.equal(Object.hasOwn(file, 'conditions'), false, 'no conditions');
    assert.deepEqual(file.items.map(entry => [entry.def.name, entry.qty, entry.equipped]).sort(), [['Iron Sword', 1, true], ['Minor Healing Draught', 3, false]]);
    assert.ok(file.items.every(entry => entry.def.value === undefined), 'no prices: the new chat prices things');
    assert.equal(file.purse, 120);
    assert.equal(file.currency, 'gold');
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(file))), JSON.stringify(file), 'plain JSON');
    const none = createHarness().command('party.export', {});
    assert.equal(none.code, 'NOT_FOUND');
});

each('creation.import: the same character in a new chat, rested, with their things, worn gear and purse', () => {
    const { h, pc } = travelled();
    const file = exported(h);
    const old = h.state().domains.party.actors[pc];
    const fresh = createHarness();
    const r = fresh.command('creation.import', { character: file, name: 'Ren', background: 'A fisher from the weir.' });
    assert.equal(r.ok, true, `${r.code}: ${r.message}`);
    assert.match(r.receipt.summary, /^Ren arrives from another story \(Level 3, carrying 4 things \(wearing Iron Sword\)\)\.$/);
    const party = fresh.state().domains.party;
    const me = party.actors[party.pc];
    assert.deepEqual([me.kind, me.control, me.level, me.xp, me.points, me.background], ['pc', 'player', old.level, old.xp, old.points, 'A fisher from the weir.']);
    assert.deepEqual(me.stats, old.stats);
    assert.deepEqual(me.skills, old.skills);
    assert.deepEqual(me.conditions, []);
    assert.deepEqual([me.hp.cur, me.mp.cur, me.sp.cur], [me.hp.max, me.mp.max, me.sp.max], 'rested');
    assert.equal(party.custom['Tide Cut'].type, 'physical');
    assert.equal(party.custom['Tide Cut'].description, 'A cut like a cold current.');
    const items = fresh.query('inventory.items');
    assert.deepEqual(items.map(row => [row.name, row.qty, row.owner, row.equipped]).sort(), [['Iron Sword', 1, 'party', 'weapon'], ['Minor Healing Draught', 3, 'party', null]]);
    assert.ok(items.every(row => row.from === r.receipt.id), 'granted by this receipt');
    assert.equal(holdings(fresh.state()).money, 120);
    // The new chat can generate: there is a character.
    assert.equal(fresh.command('creation.import', { character: file }).code, 'REFUSED', 'only once');
});

each('creation.import checks the file by this chat\'s rules; nothing is saved when it refuses', () => {
    const { h } = travelled();
    const file = exported(h);
    const cases = [
        [{ ...file, level: 5 }, { 'party.maxLevel': 4 }, 'REFUSED', /level cap is 4/],
        [file, { 'party.maxLevel': 2 }, 'REFUSED', /level cap is 2/],
        [file, { 'party.statCap': 8 }, 'REFUSED', /no stat can go higher than 8/],
        [{ ...file, stats: { ...file.stats, STR: file.stats.STR + 20 } }, {}, 'REFUSED', /add up to/],
        [{ ...file, points: file.points + 9 }, {}, 'REFUSED', /add up to/],
        [{ ...file, xp: 5000 }, {}, 'REFUSED', /more than level 3 holds/],
        [{ ...file, skills: [...file.skills, { name: 'Moon Song', level: 1, uses: 0, active: false }] }, {}, 'INVALID', /neither in the skill library nor described/],
        [{ ...file, stats: { ...file.stats, STR: 9.5 } }, {}, 'INVALID', /whole numbers/],
        [{ ...file, items: [{ def: { name: 'Gold Bar' }, qty: 0 }] }, {}, 'INVALID', /quantity/],
        [{ ...file, rpgBattleCharacter: 7 }, {}, 'INVALID', /version 7/],
        [{ hello: 'world' }, {}, 'INVALID', /not an RPG Battle character file/],
    ];
    for (const [character, settings, code, pattern] of cases) {
        const fresh = createHarness({ settings });
        const before = bytes(fresh.state());
        const r = fresh.command('creation.import', { character });
        assert.equal(r.ok, false, JSON.stringify(settings));
        assert.equal(r.code, code, r.message);
        assert.match(r.message, pattern);
        assert.equal(bytes(fresh.state()), before);
    }
    const blank = createHarness().command('creation.import', {});
    assert.equal(blank.code, 'INVALID');
});

each('party.import is creation\'s: a click cannot make a character from a file past the wizard', () => {
    const { h } = travelled();
    const file = exported(h);
    const fresh = createHarness();
    const r = fresh.command('party.import', { character: file });
    assert.equal(r.code, 'REFUSED');
});

each('a file made in a chat with more companions keeps only your character: companions do not travel', () => {
    const { h } = travelled();
    const lyra = h.command('party.addCompanion', { name: 'Lyra', role: 'archer' }, { cause: 'system' }).receipt.data.actor;
    const pelt = storyItem(h, 'Wolf Pelt', 2);
    assert.equal(h.command('item.give', { stack: stacksOf(h, pelt)[0].stack, to: lyra, qty: 2 }).ok, true);
    const file = exported(h);
    assert.equal(file.items.some(entry => entry.def.name === 'Wolf Pelt'), false);
    const fresh = createHarness();
    assert.equal(fresh.command('creation.import', { character: file }).ok, true);
    assert.equal(fresh.state().domains.party.order.length, 1);
});
