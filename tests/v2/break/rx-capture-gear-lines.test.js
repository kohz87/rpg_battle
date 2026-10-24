// rx-capture (beta rolling attack) on RB #88 (gear): what the static prompt and the story's lines do on
// the real Story Block host (vendored testkit, no stand-in route module).
// Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';
import { STATIC_KEY } from '../../vendor/story-block/src/v2/turn.js';

const quiet = t => t.mock.method(console, 'warn', () => {});

async function hero({ settings = null } = {}) {
    const host = await rpgHost(settings ? { settings } : {});
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('We set out.', host.reply('Bluewatch Town.', [
        '~ place Bluewatch Town | kind: settlement', '+ item Chain Shirt | note: armour DEF +3', '+ item Repair Kit | qty: 3',
    ]));
    for (const row of host.q('inventory.items', {}).filter(item => item.kind === 'equipment')) assert.equal((await host.cmd('item.equip', { stack: row.stack })).ok, true);
    host.stackOf = name => host.q('inventory.items', {}).find(item => item.name === name)?.stack;
    host.lastStatic = () => host.st.promptLog.filter(entry => entry.key === STATIC_KEY && entry.value).at(-1)?.value ?? '';
    return host;
}

// RX-cap-2: WEAR_STATIC told the model to write `~ item <piece> — what happened | wear: scuff|tear|ruin`,
// but on this host (Story Block v2 as vendored) nothing routes that line to item.wear: the line is
// refused ("changes nothing") or, with a dash text, rewrites the item's note. The prompt asked for a
// line no code reads. Fixed (RB #88): the static part asks for it only on a host whose inventory reads
// it (one answering `inventory.wear`, which comes with the route); here it does not.
test('rx-capture: the static prompt asks for the wear line only on a host that reads it, and there it wears the piece', async t => {
    quiet(t);
    const host = await hero();
    try {
        const reads = host.sdk.modules().some(entry => entry.commands.includes('inventory.wear'));
        await host.send('Brambles.', host.reply('The brambles rip at Ren.', ['~ item Chain Shirt — torn by brambles | wear: tear']));
        assert.ok(host.lastStatic().includes('a repair kit is used with'), 'the rest of the gear line stays');
        assert.equal(host.lastStatic().includes('| wear: scuff|tear|ruin'), reads, 'the wear line is asked for exactly when the host reads it');
        if (reads) {
            const cond = host.q('items.condition', { stack: host.stackOf('Chain Shirt') });
            assert.equal(cond.cur, 85, 'the line the prompt asks for wears the piece by code\'s number');
        }
    } finally { host.close(); }
});

// RX-cap-3: with rpg-battle.wear off, `! use Repair Kit` is refused with a narrated receipt that names
// the switched-off mechanic ("Gear wear is turned off in this chat"), so the next prompt tells the model
// about a feature the reader turned off, once per line (MODULES §F100: off means fully off).
test('rx-capture: with gear wear off, a repair-kit line does not tell the story about the switch', async t => {
    quiet(t);
    const host = await hero({ settings: { features: { 'rpg-battle.wear': false } } });
    try {
        await host.send('Mend it.', host.reply('Ren fiddles with the kit.', ['! use Repair Kit | on: Chain Shirt', '! use Repair Kit | on: Ren']));
        const receipts = host.st.ctx.chat.at(-1).extra.storySuite.receipts;
        const told = receipts.filter(receipt => receipt.narrate !== false && /turned off/i.test(String(receipt.summary)));
        assert.deepEqual(told.map(receipt => receipt.summary), [], 'narrated receipts mention the switched-off feature');
    } finally { host.close(); }
});
