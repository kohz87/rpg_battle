// The Ersveil pack's seven recipes and two crafts (Story Block examples/packs/ersveil-bluewatch, pack
// 1.2.0, copied into fixtures/ at Story Block v2 cb2d70e): every one is known or taught as the pack
// says, worked at the station it names in Bluewatch (its shops: an apothecary's alchemy table, the Gate
// Forge's workbench; a campfire made for the stew), and crafted end to end on the real host with the
// pack's craft table (alchemy on INT+DEX, fieldcraft anywhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { craftHost, qtyOf, replyWhen } from './helpers.js';

const ERSVEIL = JSON.parse(readFileSync(new URL('./fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8'));

const GOODS = [
    ['Coarse Salt', 5], ['Burlap Sack', 2], ['Lamp Oil', 2], ['Trail Rations', 1], ['Coarse Bread', 1],
    ['Bluecap Moss', 5], ['Cleansing Spirits', 1], ['Iron Filings', 1], ['Crag Wolf Pelt', 3],
];

// recipe → [what it makes, how many, line extras]
const CRAFTS = [
    ['Leech-salt Pouch', 'Leech-salt Pouch', 2, ''],
    ['Pitch Torches', 'Torch', 2, ''],
    ['Camp Stew', 'Hot Meal', 2, ' | at: campfire'],
    ['Healing Salve', 'Healing Salve', 1, ''],
    ['Minor Healing Draught', 'Minor Healing Draught', 1, ''],
    ['Completion Salts', 'Completion Salts', 1, ''],
    ['Wolf-pelt Mantle', 'Wolf-pelt Mantle', 1, ''],
];

test('Ersveil: all seven recipes are learned as the pack says and crafted end to end in Bluewatch', { timeout: 120000 }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await craftHost({ pack: ERSVEIL, place: '~ place Bluewatch Village | kind: settlement' });
    try {
        // The goods, one kind a reply (each reply's story goods are held to a budget).
        for (const [name, qty] of GOODS) await host.send(`We find ${name}.`, host.reply('Found.', [`+ item ${name} | qty: ${qty}`]));
        for (const [name, qty] of GOODS) assert.equal(qtyOf(host, name), qty, `${name} in the bag`);

        const known = () => host.q('craft.known').map(recipe => recipe.name).sort();
        assert.deepEqual(known(), ['Camp Stew', 'Healing Salve', 'Leech-salt Pouch', 'Pitch Torches'], 'the four basics');
        // The taught ones, only from who the pack says teaches them.
        await host.send('Marrit shows me.', host.reply('No.', ['+ recipe Minor Healing Draught | from: Marrit']));
        assert.equal(known().length, 4);
        await host.send('The sealer and the smith teach me.', host.reply('They do.', [
            '+ recipe Minor Healing Draught | from: the lay sealer',
            '+ recipe Completion Salts | from: the lay sealer at the yard',
            '+ recipe Wolf-pelt Mantle | from: the Watch smith',
        ]));
        assert.equal(known().length, 7);

        const table = Object.fromEntries(host.q('packs.crafts').map(craft => [craft.craft, craft]));
        assert.deepEqual(table.alchemy.stats, ['INT', 'DEX'], 'the pack\'s alchemy');
        assert.deepEqual(table.fieldcraft.stations, [], 'fieldcraft anywhere');
        const ren = host.q('craft.view').people[0];
        for (const recipe of ren.recipes.filter(entry => entry.name !== 'Camp Stew')) assert.equal(recipe.ready, true, `${recipe.name}: ${recipe.why ?? ''}`);
        const salve = ren.recipes.find(recipe => recipe.name === 'Healing Salve');
        assert.deepEqual(salve.station, { name: 'an alchemy table', here: true }, 'the Salt-and-Ash Dispensary\'s');
        const stew = ren.recipes.find(recipe => recipe.name === 'Camp Stew');
        assert.deepEqual(stew.station, { name: 'a campfire', here: false }, 'Bluewatch has an inn, but the stew wants a campfire: one is made for it below');

        for (const [recipe, makes, count, extra] of CRAFTS) {
            const before = host.q('craft.log').length;
            // A natural 20 is a masterwork whatever the DC: every recipe is made.
            await replyWhen(host, `I make ${recipe}.`, die => die === 20, () => [`! craft ${recipe} | roll: 1 | result: masterwork${extra}`]);
            const made = host.q('craft.log').at(-1);
            assert.equal(host.q('craft.log').length, before + 1, `${recipe} was crafted`);
            assert.equal(made.recipeName, recipe);
            assert.equal(made.quality, 'masterwork');
            assert.equal(made.mismatch, '');
            assert.equal(qtyOf(host, `Masterwork ${makes}`), count, `${count} Masterwork ${makes}`);
        }
        for (const [name] of GOODS) assert.equal(qtyOf(host, name), 0, `every ${name} went into a craft`);
        const alchemy = host.q('craft.log').find(entry => entry.recipeName === 'Healing Salve');
        assert.equal(alchemy.modifiers[0].reason, 'INT+DEX', 'the pack\'s alchemy stats');
        assert.equal(alchemy.craft, 'alchemy');
        assert.equal(host.q('craft.log').find(entry => entry.recipeName === 'Wolf-pelt Mantle').craft, 'leather');
    } finally { host.close(); }
});
