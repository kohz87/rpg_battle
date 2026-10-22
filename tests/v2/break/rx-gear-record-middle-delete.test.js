// rx-combat (RB #88 gear): a piece's record is written whole (`<stack>#<rev>` = { cond, max, low,
// refine }) and every write removes the older ones. A later reply that wears the piece writes a
// record that already holds an earlier reply's repair or refinement; deleting that earlier reply
// from the middle takes its fee and materials back (their ops are deltas on the wallet and stacks)
// but the later whole record keeps the repair / the +2 (SPEC §2.2: "keyed by id with add-only ops;
// never replace of another reply's fields" — the record is the shared, replaced field here).
// The reader gets a repair or a refinement for nothing; invariant 2 (a delete restores the line).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';

const WEAR_ROUTE = {
    id: 'rx-wear-route', name: 'rx wear route', version: '0.0.0',
    capture: {
        kinds: { testwear: { grammar: '~ testwear <piece> | wear: scuff|tear|ruin' } },
        apply: (ctx, line) => ctx.call('item.wear', { name: line.name, wear: line.labels?.wear ?? '', story: true }),
    },
};

async function hero(lines) {
    const h = await rpgHost({ modules: [WEAR_ROUTE] });
    assert.equal((await h.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await h.send('We set out.', h.reply('Bluewatch Town.', ['~ place Bluewatch Town | kind: settlement', '+ coin 900', ...lines]));
    for (const row of h.q('inventory.items', {}).filter(item => item.kind === 'equipment')) assert.equal((await h.cmd('item.equip', { stack: row.stack })).ok, true);
    h.stackOf = name => h.q('inventory.items', {}).find(item => item.name === name || item.name.startsWith(`${name} +`))?.stack;
    h.coin = () => h.q('inventory.wallet', { owner: 'party' }).coin;
    h.deleteReply = async pattern => h.st.deleteMessage(h.st.ctx.chat.findLastIndex(message => pattern.test(message.mes)));
    return h;
}

test('rx-combat: deleting the reply that paid for a repair takes the repair back too', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(21, async () => {
        const h = await hero(['+ item Chain Shirt | note: armour DEF +3']);
        try {
            const stack = h.stackOf('Chain Shirt');
            await h.send('Brambles.', h.reply('Torn.', ['~ testwear Chain Shirt | wear: ruin']));
            await h.send('Thorns.', h.reply('Torn again.', ['~ testwear Chain Shirt | wear: ruin']));
            const worn = h.q('items.condition', { stack }).cur;
            const coin = h.coin();
            await h.send('To the smith.', h.reply('At the smithy.', []));
            assert.equal((await h.cmd('trade.repair', { stack, at: 'smith' })).ok, true);
            await h.send('On the road.', h.reply('A scratch.', ['~ testwear Chain Shirt | wear: scuff']));
            await h.deleteReply(/At the smithy/);
            assert.equal(h.coin(), coin, 'the fee came back with the deleted reply');
            assert.ok(h.q('items.condition', { stack }).cur <= worn, `the repair stayed: ${h.q('items.condition', { stack }).cur}/100 (it was ${worn} before the repair), fee refunded`);
        } finally {
            h.close();
        }
    });
});

test('rx-combat: deleting the reply that paid for a refinement takes the refinement back too', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(21, async () => {
        const h = await hero(['+ item Iron Sword | note: weapon ATK +4', '+ item Iron Ore | qty: 9']);
        try {
            const stack = h.stackOf('Iron Sword');
            const coin = h.coin();
            await h.send('To the smith.', h.reply('At the smithy.', []));
            assert.equal((await h.cmd('trade.refine', { stack, at: 'smith' })).ok, true);
            assert.equal((await h.cmd('trade.refine', { stack, at: 'smith' })).ok, true);
            assert.equal(h.q('items.condition', { stack }).refine, 2);
            await h.send('On the road.', h.reply('A nick.', ['~ testwear Iron Sword | wear: scuff']));
            await h.deleteReply(/At the smithy/);
            assert.equal(h.coin(), coin, 'the fees came back with the deleted reply');
            assert.equal(h.q('items.condition', { stack }).refine, 0, `the sword kept +${h.q('items.condition', { stack }).refine} after its refinements' reply was deleted (fees and ore refunded)`);
        } finally {
            h.close();
        }
    });
});
