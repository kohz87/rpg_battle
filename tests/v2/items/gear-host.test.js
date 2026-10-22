// Gear condition, repair and refinement on the real Story Block host (vendored testkit): the wear a
// fight leaves (armour by the blows taken, a weapon once a fight), the story's wear word (routed the
// way Story Block routes `~ item X | wear: tear` to item.wear; a test module stands in for that
// route here), its claim of one per piece per reply (by the reply's sid), the clamps, repair kits
// through the story's `! use`, the smith's repair price, refinement (+3 seeded: the same seed takes
// the same way), a break that costs a level, and that a repair or refinement never mints money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playOut, rpgHost, seeded } from '../integration/helpers/host.js';
import { STORY_WEAR } from '../../../src/v2/items/condition.js';

// Stands in for Story Block's route of `~ item X — … | wear: tear` to item.wear (as `- item … used` goes to item.use).
const WEAR_ROUTE = {
    id: 'gear-test-route',
    name: 'gear test route',
    version: '0.0.0',
    capture: {
        kinds: { testwear: { grammar: '~ testwear <piece> | wear: scuff|tear|ruin' } },
        apply: (ctx, line) => ctx.call('item.wear', { name: line.name, wear: line.labels?.wear ?? '', story: true }),
    },
};

const quiet = t => t.mock.method(console, 'warn', () => {});

async function hero(seed = 1, { lines = [] } = {}) {
    const host = await rpgHost({ modules: [WEAR_ROUTE] });
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('We set out.', host.reply('Bluewatch Town.', [
        '~ place Bluewatch Town | kind: settlement', '+ coin 900',
        '+ item Chain Shirt | note: armour DEF +3', '+ item Iron Sword | note: weapon ATK +4',
        '+ item Iron Ore | qty: 9', '+ item Repair Kit | qty: 3', ...lines,
    ]));
    for (const row of host.q('inventory.items', {}).filter(item => item.kind === 'equipment')) assert.equal((await host.cmd('item.equip', { stack: row.stack })).ok, true);
    host.stackOf = name => host.q('inventory.items', {}).find(item => item.name === name)?.stack;
    host.cond = name => host.q('items.condition', { stack: host.stackOf(name) });
    host.receipts = () => host.st.ctx.chat.at(-1).extra.storySuite.receipts;
    host.coin = () => host.q('inventory.wallet', { owner: 'party' }).coin ?? 0;
    void seed;
    return host;
}

const story = (host, ...lines) => host.send('go on', host.reply('The story goes on.', lines));

test('a fight wears the armour by the blows taken and the weapon once; told when a band changes', async t => {
    quiet(t);
    await seeded(3, async () => {
        const host = await hero();
        try {
            await story(host, '! encounter 2 Wolf — circling | tier: even');
            assert.equal((await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id })).ok, true);
            await playOut(host);
            const end = await host.cmd('combat.end');
            assert.equal(end.ok, true);
            const sword = host.cond('Iron Sword');
            const shirt = host.cond('Chain Shirt');
            assert.equal(sword.cur, 100 - 3, 'a weapon: 3 a fight');
            assert.ok(shirt.cur < 100 && shirt.cur >= 100 - 25, `armour by the blows (${shirt.cur})`);
            const data = host.st.ctx.chat.at(-1).extra.storySuite.receipts.find(r => r.type === 'combat.end').data;
            assert.deepEqual(data.wear.map(w => w.name).sort(), ['Chain Shirt', 'Iron Sword']);
            // From a screen, a fight's wear is refused (it is combat.end's).
            const ui = await host.cmd('item.fightWear', { fight: 'fi_xxxxxxxx', members: [] });
            assert.equal(ui.ok, false);
            assert.equal(ui.code, 'REFUSED');
        } finally {
            host.close();
        }
    });
});

test('the story\'s wear word: code\'s number, one per piece per reply (by sid), clamped at 0, told on a band change', async t => {
    quiet(t);
    await seeded(4, async () => {
        const host = await hero();
        try {
            await story(host, '~ testwear Chain Shirt | wear: tear', '~ testwear Chain Shirt | wear: ruin', '~ testwear Iron Sword | wear: scuff');
            assert.equal(host.cond('Chain Shirt').cur, 100 - STORY_WEAR.tear, 'the second word for the shirt in one reply is refused');
            assert.equal(host.cond('Iron Sword').cur, 100 - STORY_WEAR.scuff);
            const told = host.receipts().filter(r => r.type === 'capture.testwear');
            assert.equal(told.length, 2);
            assert.match(told[0].summary, /Chain Shirt is damaged \(85\/100, still good\)/);
            assert.equal(told[0].narrate, false);
            // The next reply is another sid: the shirt may wear again.
            await story(host, '~ testwear Chain Shirt | wear: ruin');
            assert.equal(host.cond('Chain Shirt').cur, 45);
            const moved = host.receipts().find(r => r.type === 'capture.testwear');
            assert.equal(moved.summary, "Ren's Chain Shirt is now worn.");
            assert.equal(moved.narrate, true);
            await story(host, '~ testwear Chain Shirt | wear: ruin');
            await story(host, '~ testwear Chain Shirt | wear: ruin');
            assert.equal(host.cond('Chain Shirt').cur, 0, 'never below 0');
            assert.equal(host.cond('Chain Shirt').band, 'broken');
            // A number is no wear word; a click is no story.
            await story(host, '~ testwear Iron Sword | wear: 90');
            assert.equal(host.cond('Iron Sword').cur, 95);
            const click = await host.cmd('item.wear', { name: 'Iron Sword', wear: 'ruin', story: true });
            assert.equal(click.ok, false);
            assert.equal(click.code, 'REFUSED');
            // A broken piece stays on, gives nothing, and the tail says so.
            const gear = host.q('items.gear', {});
            assert.equal(gear.counted.some(row => row.name === 'Chain Shirt'), false);
            assert.equal(gear.unused.find(row => row.name === 'Chain Shirt').why, 'broken');
            assert.equal(host.q('inventory.items', {}).find(item => item.name === 'Chain Shirt').equipped, 'armour');
            await story(host);
            assert.match(host.tails().at(-1), /\[Gear\] Not in good repair: Ren's Chain Shirt \(broken: gives nothing\)/);
        } finally {
            host.close();
        }
    });
});

test('a deleted reply takes exactly its own wear back; a later reply\'s wear stays; rebuilt equals live', async t => {
    quiet(t);
    await seeded(5, async () => {
        const host = await hero();
        try {
            await story(host, '~ testwear Chain Shirt | wear: ruin');
            await story(host, '~ testwear Chain Shirt | wear: tear');
            assert.equal(host.cond('Chain Shirt').cur, 45);
            const chat = host.st.ctx.chat;
            const users = chat.map((m, i) => (m.is_user ? i : -1)).filter(i => i >= 0);
            const middle = users.at(-2);
            await host.st.deleteMessage(middle + 1);
            await host.st.deleteMessage(middle);
            // The deleted reply's ruin goes; the later reply's tear still applies (each reply's own event).
            assert.equal(host.cond('Chain Shirt').cur, 85);
            assert.deepEqual(host.store.problems(), []);
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
            const last = host.st.ctx.chat.length - 1;
            await host.st.deleteMessage(last);
            await host.st.deleteMessage(last - 1);
            assert.equal(host.cond('Chain Shirt').cur, 100, 'with both wear replies gone, the shirt is as new');
        } finally {
            host.close();
        }
    });
});

test('a repair kit through `! use`: condition back, the maximum frays; refused (kit kept) when nothing needs it', async t => {
    quiet(t);
    await seeded(6, async () => {
        const host = await hero();
        try {
            await story(host, '! use Repair Kit | on: Chain Shirt');
            const kept = host.receipts().find(r => r.type === 'capture.use');
            assert.equal(kept.data.refused, true);
            assert.equal(host.q('inventory.items', {}).find(item => item.name === 'Repair Kit').qty, 3);
            await story(host, '~ testwear Chain Shirt | wear: ruin');
            await story(host, '! use Repair Kit | on: Ren');
            const patch = host.receipts().find(r => r.type === 'capture.use');
            assert.equal(patch.data.refused, false);
            assert.deepEqual([host.cond('Chain Shirt').cur, host.cond('Chain Shirt').max], [85, 95]);
            assert.equal(host.q('inventory.items', {}).find(item => item.name === 'Repair Kit').qty, 2);
            await story(host, '! use Repair Kit | on: Chain Shirt');
            assert.deepEqual([host.cond('Chain Shirt').cur, host.cond('Chain Shirt').max], [90, 90], 'held to the frayed maximum');
            await story(host, '! use Repair Kit | on: Chain Shirt');
            assert.equal(host.receipts().find(r => r.type === 'capture.use').data.refused, true, 'at its maximum a patch gives nothing');
            assert.equal(host.q('inventory.items', {}).find(item => item.name === 'Repair Kit').qty, 1);
        } finally {
            host.close();
        }
    });
});

test('a smith\'s repair: fee = missing × worth × prices, back to full; refused without a market or a smith', async t => {
    quiet(t);
    await seeded(7, async () => {
        const host = await hero();
        try {
            const stack = host.stackOf('Chain Shirt');
            const none = host.q('trade.quote', { type: 'repair', stack });
            assert.equal(none.ok, false, 'nothing to repair');
            await story(host, '~ testwear Chain Shirt | wear: ruin');
            await story(host, '! use Repair Kit | on: Chain Shirt');
            const quote = host.q('trade.quote', { type: 'repair', stack, at: 'smith' });
            assert.equal(quote.ok, true, quote.message);
            const worth = host.q('inventory.items', {}).find(item => item.name === 'Chain Shirt').value
                ?? host.head().domains.inventory.defs['story/chain-shirt'].value;
            // Patched to 85, but it had been at 60: the smith redoes 40.
            assert.equal(quote.missing, 40);
            // Bluewatch Town prices goods at 1×: 40% of its worth (under 90% of its price new).
            assert.equal(quote.fee, Math.max(1, Math.ceil(40 / 100 * worth - 1e-9)));
            assert.equal(host.q('trade.quote', { type: 'repair', stack, at: 'apothecary' }).ok, false, 'an apothecary does not repair gear');
            const before = host.coin();
            await story(host, '! repair Chain Shirt | at: tailor');
            assert.equal(host.coin(), before - quote.fee);
            assert.deepEqual([host.cond('Chain Shirt').cur, host.cond('Chain Shirt').max], [100, 100]);
            assert.match(host.receipts().find(r => r.type === 'capture.repair').summary, /^Ren has the tailor repair the Chain Shirt for \d+ gold/);
            await story(host, '~ place Old Ruins | kind: wild');
            await story(host, '~ testwear Chain Shirt | wear: tear');
            assert.equal(host.q('trade.quote', { type: 'repair', stack }).ok, false, 'no market in the wilds');
            const broke = await host.cmd('trade.repair', { stack });
            assert.equal(broke.ok, false);
        } finally {
            host.close();
        }
    });
});

async function refineToTwo(host) {
    await story(host, '! refine Iron Sword | at: smith');
    await story(host, '! refine Iron Sword | at: smith | with: Iron Ore x2');
    assert.equal(host.cond('Iron Sword').refine, 2);
}

test('refinement +1 and +2 always take, one per piece per reply; the name and stats show it; rarity stays', async t => {
    quiet(t);
    await seeded(8, async () => {
        const host = await hero();
        try {
            const ore = () => host.q('inventory.items', {}).find(item => item.name === 'Iron Ore')?.qty ?? 0;
            const plain = host.q('items.gear', {}).counted.find(row => row.name === 'Iron Sword').stats.ATK;
            await story(host, '! refine Iron Sword | at: smith', '! refine Iron Sword | at: smith');
            assert.equal(host.cond('Iron Sword').refine, 1, 'a second refinement in one reply is refused');
            assert.equal(ore(), 8);
            await story(host, '! refine Iron Sword | at: smith | with: Iron Ore x2');
            assert.equal(ore(), 6);
            const row = host.q('items.gear', {}).counted.find(entry => entry.stack === host.stackOf('Iron Sword'));
            assert.equal(row.name, 'Iron Sword +2');
            assert.equal(row.stats.ATK, plain >= 5 ? Math.max(Math.round(plain * 1.16), plain + 1) : Math.round(plain * 1.16));
            assert.equal(row.rarity, 'common');
            assert.equal(host.head().domains.inventory.defs['story/iron-sword'].name, 'Iron Sword', 'the def is not renamed');
            // A refinement needs fit materials and fair repair.
            const cloth = await host.cmd('trade.refine', { stack: host.stackOf('Iron Sword'), materials: [{ name: 'Repair Kit', qty: 3 }] });
            assert.equal(cloth.ok, false);
            await story(host, '~ testwear Iron Sword | wear: ruin');
            await story(host, '~ testwear Iron Sword | wear: ruin');
            const torn = host.q('trade.quote', { type: 'refine', stack: host.stackOf('Iron Sword') });
            assert.equal(torn.ok, false);
            assert.match(torn.message, /tattered: have it repaired/);
        } finally {
            host.close();
        }
    });
});

async function lastAttempt(seed) {
    return seeded(seed, async () => {
        const host = await hero();
        try {
            await refineToTwo(host);
            const before = host.coin();
            const oreBefore = host.q('inventory.items', {}).find(item => item.name === 'Iron Ore').qty;
            await story(host, '! refine Iron Sword | at: smith');
            const receipt = host.receipts().find(r => r.type === 'capture.refine');
            return {
                took: receipt.data.took, level: host.cond('Iron Sword').refine, paid: before - host.coin(),
                ore: oreBefore - host.q('inventory.items', {}).find(item => item.name === 'Iron Ore').qty, summary: receipt.summary,
            };
        } finally {
            host.close();
        }
    });
}

test('the +3 attempt is seeded: the same seed takes the same way; a failure burns the materials and keeps the piece', async t => {
    quiet(t);
    const outcomes = [];
    for (let seed = 1; seed <= 8; seed += 1) {
        const first = await lastAttempt(seed);
        const again = await lastAttempt(seed);
        assert.deepEqual(again, first, `seed ${seed} replays the same`);
        outcomes.push(first);
    }
    const fail = outcomes.find(entry => !entry.took);
    const took = outcomes.find(entry => entry.took);
    assert.ok(fail && took, 'both outcomes among the seeds');
    assert.equal(took.level, 3);
    assert.equal(fail.level, 2, 'the piece is kept at +2');
    assert.equal(fail.ore, 3, 'the materials are burned');
    assert.ok(fail.paid > 0);
    assert.match(fail.summary, /the work fails/);
});

test('a refined piece that breaks may lose a level (seeded); a refused attempt changes nothing', async t => {
    quiet(t);
    const levels = new Set();
    for (let seed = 1; seed <= 8; seed += 1) {
        await seeded(seed, async () => {
            const host = await hero();
            try {
                await story(host, '! refine Iron Sword | at: smith');
                await story(host, '~ testwear Iron Sword | wear: ruin');
                await story(host, '~ testwear Iron Sword | wear: ruin');
                await story(host, '~ testwear Iron Sword | wear: ruin');
                assert.equal(host.cond('Iron Sword').band, 'broken');
                levels.add(host.cond('Iron Sword').refine);
                const head = JSON.stringify(host.head());
                const refused = await host.cmd('trade.refine', { stack: host.stackOf('Iron Sword') });
                assert.equal(refused.ok, false);
                assert.equal(JSON.stringify(host.head()), head);
            } finally {
                host.close();
            }
        });
    }
    assert.deepEqual([...levels].sort(), [0, 1], 'some breaks cost the level, some do not');
});

test('conservation: repairing or refining then selling never brings more money than selling as it was', async t => {
    quiet(t);
    await seeded(9, async () => {
        for (const buyer of ['general', 'smith', 'fence']) {
            const host = await hero();
            try {
                const stack = host.stackOf('Chain Shirt');
                await host.cmd('item.unequip', { stack });
                await story(host, '~ testwear Chain Shirt | wear: ruin');
                await story(host, '~ testwear Chain Shirt | wear: tear');
                const asIs = host.q('trade.quote', { type: 'sell', stack, qty: 1, kind: buyer });
                assert.equal(asIs.ok, true, asIs.message);
                const start = host.coin();
                assert.equal((await host.cmd('trade.repair', { stack, at: 'smith' })).ok, true);
                const refine = await host.cmd('trade.refine', { stack, at: 'smith' });
                assert.equal(refine.ok, true, refine.message);
                const sold = await host.cmd('trade.sell', { stack, qty: 1, kind: buyer });
                assert.equal(sold.ok, true, sold.message);
                const gained = host.coin() - start;
                assert.ok(gained <= asIs.total, `${buyer}: repair + refine + sale brought ${gained}, a sale as it was ${asIs.total}`);
            } finally {
                host.close();
            }
        }
    });
});

test('resale follows condition: a worn piece sells for less; a field patch does not raise it', async t => {
    quiet(t);
    await seeded(10, async () => {
        const host = await hero();
        try {
            const stack = host.stackOf('Chain Shirt');
            await host.cmd('item.unequip', { stack });
            const fresh = host.q('trade.quote', { type: 'sell', stack, qty: 1 }).each;
            await story(host, '~ testwear Chain Shirt | wear: ruin');
            const worn = host.q('trade.quote', { type: 'sell', stack, qty: 1 }).each;
            assert.equal(worn, Math.max(1, Math.floor(fresh * 0.6)));
            await story(host, '! use Repair Kit | on: Chain Shirt');
            assert.equal(host.q('trade.quote', { type: 'sell', stack, qty: 1 }).each, worn);
        } finally {
            host.close();
        }
    });
});

test('features off (MODULES §F100): no wear, no repair or refinement, stats as written, the static line gone; on again brings it back', async t => {
    quiet(t);
    await seeded(11, async () => {
        const host = await hero();
        try {
            await story(host, '~ testwear Chain Shirt | wear: ruin');
            assert.equal(host.cond('Chain Shirt').cur, 60);
            const scaled = host.q('items.gear', {}).counted.find(row => row.name === 'Chain Shirt').stats;
            host.features.set('rpg-battle.wear', false);
            host.features.set('rpg-battle.refine', false);
            assert.equal(host.q('items.condition', { stack: host.stackOf('Chain Shirt') }), null);
            const plain = host.q('items.gear', {}).counted.find(row => row.name === 'Chain Shirt');
            assert.equal(plain.band, 'good');
            assert.ok(plain.stats.DEF >= scaled.DEF);
            await story(host, '~ testwear Chain Shirt | wear: ruin', '! repair Chain Shirt | at: smith', '! refine Iron Sword | at: smith');
            assert.equal(host.receipts().filter(r => /testwear|repair|refine/.test(r.type)).length, 0, 'nothing ran');
            const repair = await host.cmd('trade.repair', { stack: host.stackOf('Chain Shirt') });
            assert.equal(repair.code, 'FEATURE_OFF');
            assert.doesNotMatch(host.statics().at(-1), /a repair kit is used with/);
            assert.doesNotMatch(host.statics().at(-1), /! repair/);
            // A fight wears nothing while it is off.
            await story(host, '! encounter 1 Wolf — alone | tier: weak');
            await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id });
            await playOut(host);
            assert.equal((await host.cmd('combat.end')).ok, true);
            host.features.set('rpg-battle.wear', true);
            assert.equal(host.cond('Chain Shirt').cur, 60, 'its state was kept, untouched');
            assert.equal(host.cond('Iron Sword').cur, 100);
            await story(host);
            assert.match(host.statics().at(-1), /a repair kit is used with/);
            // The story's `| wear:` word is asked for exactly when the host's inventory reads it.
            const reads = host.sdk.modules().some(entry => entry.commands.includes('inventory.wear'));
            assert.equal(/~ item <piece> — what happened/.test(host.statics().at(-1)), reads);
        } finally {
            host.close();
        }
    });
});

test('a repair never costs more than 90% of the piece new here; what it adds to the resale never passes its fee (repair cheap, sell dear)', async t => {
    quiet(t);
    await seeded(12, async () => {
        const host = await hero();
        try {
            const stack = host.stackOf('Chain Shirt');
            await host.cmd('item.unequip', { stack });
            for (let n = 0; n < 3; n += 1) await story(host, '~ testwear Chain Shirt | wear: ruin');
            assert.equal(host.cond('Chain Shirt').cur, 0);
            const worth = host.head().domains.inventory.defs['story/chain-shirt'].value;
            const quote = host.q('trade.quote', { type: 'repair', stack });
            assert.equal(quote.fee, Math.max(1, Math.ceil(0.9 * worth - 1e-9)), 'held to 90% of its price new, not its whole worth');
            // Repair in a cheap village, sell to a smith in the capital: never more than selling it broken there plus the fee.
            await story(host, '~ place Little Ford Village | kind: settlement');
            const cheap = host.q('trade.quote', { type: 'repair', stack });
            assert.ok(cheap.fee < quote.fee, 'village prices are lower');
            await story(host, '~ place Royal Capital | kind: settlement');
            const broken = host.q('trade.quote', { type: 'sell', stack, qty: 1, kind: 'smith' }).total;
            await story(host, '~ place Little Ford Village | kind: settlement');
            const start = host.coin();
            assert.equal((await host.cmd('trade.repair', { stack })).ok, true);
            await story(host, '~ place Royal Capital | kind: settlement');
            assert.equal((await host.cmd('trade.sell', { stack, qty: 1, kind: 'smith' })).ok, true);
            assert.ok(host.coin() - start <= broken, `repair + sale ${host.coin() - start} ≤ the sale as it was ${broken}`);
        } finally {
            host.close();
        }
    });
});

test('items.slots and items.canWear on the host: two accessories and one worn piece by default', async t => {
    quiet(t);
    await seeded(13, async () => {
        const host = await hero();
        try {
            assert.deepEqual(host.q('items.slots'), { accessory: 2, worn: 1 });
            const pc = host.q('party.pc').id;
            assert.deepEqual(host.q('items.canWear', { actor: pc, stack: host.stackOf('Chain Shirt') }), { ok: true });
            assert.equal(host.q('items.canWear', { actor: pc, stack: host.stackOf('Iron Ore') }).ok, false);
        } finally {
            host.close();
        }
    });
});
