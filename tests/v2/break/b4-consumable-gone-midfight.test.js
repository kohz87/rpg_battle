// B4-1: a draught sold or dropped while a fight is under way is still drunk by a member on auto:
// the fight heals with it although nothing left the inventory (combat.act reports `missing`), and
// a sold draught pays its price and heals too. Invariant 3 (code sets numbers; no HP from nothing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerAndStart, seeded, started } from './helpers.js';

const DRAUGHT = 'Minor Healing Draught';

async function fightWithoutTheDraughts(remove) {
    const host = await started();
    await host.send('I search the cart.', host.reply('Three vials.', [`+ item ${DRAUGHT} | qty: 3 | note: heal 20`]));
    const { start } = await offerAndStart(host, '! encounter 3 Wolf | tier: even');
    assert.equal(start.ok, true, start.message);
    const stack = host.q('inventory.items', {}).find(item => item.name === DRAUGHT);
    const gone = await remove(host, stack);
    if (!gone.ok) return { host, refused: gone, drunk: 0, missing: 0 };
    assert.equal(host.q('inventory.items', {}).find(item => item.name === DRAUGHT), undefined, 'no draught is left');
    let drunk = 0;
    let missing = 0;
    for (let n = 0; n < 300; n += 1) {
        const session = host.q('combat.session');
        if (!session || session.status !== 'active') break;
        const r = await host.cmd('combat.act', { action: { type: 'auto' } });
        assert.equal(r.ok, true, r.message);
        drunk += r.receipt.data.log.filter(text => text.includes(`uses ${DRAUGHT}`)).length;
        missing += (r.receipt.data.missing ?? []).reduce((sum, entry) => sum + entry.qty, 0);
    }
    return { host, drunk, missing };
}

test('B4-1a: a draught dropped mid-fight is not drunk afterwards (no HP from an empty bag)', async () => {
    await seeded(21, async () => {
        const { host, drunk, missing, refused } = await fightWithoutTheDraughts((h, stack) => h.cmd('inventory.drop', { stack: stack.stack, qty: 3 }));
        try {
            if (refused) return;   // dropping mid-fight refused: also a fix
            assert.equal(missing, 0, 'combat.act took no draught that was not there');
            assert.equal(drunk, 0, `the fight healed ${drunk} times from draughts that were dropped`);
        } finally {
            host.close();
        }
    });
});

test('B4-1b: a draught sold mid-fight is either refused for sale or not drunk afterwards (no coin and HP for one vial)', async () => {
    await seeded(21, async () => {
        const { host, drunk, missing, refused } = await fightWithoutTheDraughts((h, stack) => h.cmd('trade.sell', { stack: stack.stack, qty: 3 }));
        try {
            if (refused) return;   // selling mid-fight refused: also a fix
            assert.equal(missing, 0, 'combat.act took no draught that was not there');
            assert.equal(drunk, 0, `sold draughts were also drunk ${drunk} times`);
        } finally {
            host.close();
        }
    });
});
