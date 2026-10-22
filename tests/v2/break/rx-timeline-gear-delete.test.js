// rx-timeline (beta rolling attack), RB-gear: a piece's record is written whole by every later write
// (`<stack>#<rev>` holding cond, max, low and refine, older writes removed), so a later reply's write
// carries what an earlier reply did. Deleting that earlier reply gives back what it cost (coin and
// materials rebase, SPEC §2.2) but keeps what it bought: a refinement, a smith's repair, a patch, or
// keeps the wear it did. WAVE_BRIEF rule 2 / invariant #2 (and #3: a free refinement or repair).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';

// Stands in for Story Block's route of `~ item X | wear: tear` to item.wear (as fuzz-delete does).
const WEAR_ROUTE = {
    id: 'rx-wear-route',
    name: 'rx wear route',
    version: '0.0.0',
    capture: {
        kinds: { testwear: { grammar: '~ testwear <piece> | wear: scuff|tear|ruin' } },
        apply: (ctx, line) => ctx.call('item.wear', { name: line.name, wear: line.labels?.wear ?? '', story: true }),
    },
};

async function setUp(host) {
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('We set out.', host.reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement', '+ coin 50', '+ item Iron Sword | note: weapon ATK +4', '+ item Iron Ore | qty: 6']));
    for (let n = 0; n < 3; n += 1) await host.send('Work.', host.reply('Paid.', ['+ coin 50']));
    const sword = (host.q('inventory.items', {}) ?? []).find(row => row.kind === 'equipment').stack;
    assert.equal((await host.cmd('item.equip', { stack: sword })).ok, true);
    return sword;
}

const deleteExchange = async (host, userText) => {
    const at = host.ctx.chat.findIndex(message => message.is_user && message.mes === userText);
    await host.st.deleteMessage(at + 1);
    await host.st.deleteMessage(at);
};
const coin = host => host.head().domains.inventory.wallets.party.coin;

test('deleting the reply that paid for a refinement takes the refinement back too', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(41, async () => {
        const host = await rpgHost({ modules: [WEAR_ROUTE] });
        try {
            const sword = await setUp(host);
            const before = { coin: coin(host), refine: host.q('items.condition', { stack: sword }).refine };
            await host.send('Refine it.', host.reply('The smith works the blade.', ['! refine Iron Sword | at: smith']));
            assert.equal(host.q('items.condition', { stack: sword }).refine, 1, 'the refinement was made');
            assert.ok(coin(host) < before.coin, 'and paid for');
            // A later reply writes the piece again (any wear does).
            await host.send('On.', host.reply('A nick in the blade.', ['~ testwear Iron Sword | wear: scuff']));
            await deleteExchange(host, 'Refine it.');
            assert.equal(coin(host), before.coin, 'the fee came back');
            assert.equal(host.q('items.condition', { stack: sword }).refine, before.refine, 'so the sword is no longer refined');
        } finally {
            host.close();
        }
    });
});

test('deleting the reply that tore a piece takes its wear back (a later wear stays)', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(42, async () => {
        const host = await rpgHost({ modules: [WEAR_ROUTE] });
        try {
            const sword = await setUp(host);
            await host.send('Fight.', host.reply('The blade cracks.', ['~ testwear Iron Sword | wear: tear']));
            await host.send('On.', host.reply('Ruined on a rock.', ['~ testwear Iron Sword | wear: ruin']));
            assert.equal(host.q('items.condition', { stack: sword }).cur, 45);
            await deleteExchange(host, 'Fight.');
            // As if the tear never happened: 100 - 40.
            assert.equal(host.q('items.condition', { stack: sword }).cur, 60);
        } finally {
            host.close();
        }
    });
});

test('deleting the reply with a smith repair gives the fee back and the wear with it', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(43, async () => {
        const host = await rpgHost({ modules: [WEAR_ROUTE] });
        try {
            const sword = await setUp(host);
            await host.send('Rocks.', host.reply('Ruined on a rock.', ['~ testwear Iron Sword | wear: ruin']));
            const worn = { coin: coin(host), cur: host.q('items.condition', { stack: sword }).cur };
            await host.send('Repair it.', host.reply('The smith mends it.', ['! repair Iron Sword | at: smith']));
            assert.ok(coin(host) < worn.coin, 'the repair was paid');
            await host.send('On.', host.reply('A nick in the blade.', ['~ testwear Iron Sword | wear: scuff']));
            await deleteExchange(host, 'Repair it.');
            assert.equal(coin(host), worn.coin, 'the fee came back');
            assert.equal(host.q('items.condition', { stack: sword }).cur, worn.cur - 5, 'so the repair is gone (ruined, then scuffed)');
        } finally {
            host.close();
        }
    });
});
