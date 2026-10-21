// RB-fix1: the fixes of the b1/b3/b4/b5b break rounds that the copied break tests do not pin down on
// their own: the rebuilt fight equals a rebuild from scratch (B-b4-8), a stale board's click
// (B-b4-3), loot left behind over the carry limit (F39), the internal party commands refused from a
// click, character files (B-b4-9, B-b3-15), persona names (B-b4-14), story lines cut to size
// (B-b5b-robust-13), waiting offers and join levels (B1-12, B-b3-16), a wound mid-fight (B-b4-6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, offerAndStart, playOut, rpgHost, seeded, started } from './helpers.js';
import { MODULE_ID } from '../../../src/v2/module.js';
import { clearRebuilt, rebuild } from '../../../src/v2/combat/view.js';
import { CHARACTER_FILE_VERSION, MAX_THINGS, purseCap } from '../../../src/v2/party/portable.js';
import { MAX_OFFERS_PER_KIND } from '../../../src/v2/party/commands.js';
import { LINE_LIMITS, clipLine } from '../../../src/v2/lines.js';

const DRAUGHT = 'Minor Healing Draught';

test('B-b4-8: the cached fight is the fight rebuilt from scratch, action by action, stock cuts included', async () => {
    await seeded(21, async () => {
        const host = await started();
        try {
            await host.send('I search the cart.', host.reply('Three vials.', [`+ item ${DRAUGHT} | qty: 3 | note: heal 20`]));
            const { start } = await offerAndStart(host, '! encounter 3 Wolf | tier: even');
            assert.equal(start.ok, true, start.message);
            const stack = host.q('inventory.items', {}).find(item => item.name === DRAUGHT);
            assert.equal((await host.cmd('inventory.drop', { stack: stack.stack, qty: 2 })).ok, true);
            let cut = false;
            for (let n = 0; n < 40 && host.q('combat.session')?.status === 'active'; n += 1) {
                assert.equal((await host.cmd('combat.act', { action: { type: n % 3 ? 'defend' : 'attack', ...(n % 3 ? {} : { target: host.q('combat.session').actions.targets.enemies[0] }) } })).ok, true);
                const session = structuredClone(host.head().domains.combat.session);
                cut ||= session.actions.some(action => action.stock?.length);
                const cached = hash(rebuild(session).fight);
                assert.equal(cached, hash(rebuild(session, { fresh: true }).fight), `action ${n + 1}: the cached fight differs from a rebuild from scratch`);
                clearRebuilt();
                assert.equal(hash(rebuild(session).fight), cached, `action ${n + 1}: a cold rebuild differs`);
            }
            assert.ok(cut, 'an action recorded what the inventory still held');
            // Another line of history of the same length (a swipe): never the cached fight.
            const session = structuredClone(host.head().domains.combat.session);
            if (session.actions.length > 1) {
                rebuild(session);
                const other = { ...session, actions: [...session.actions.slice(0, -1), { type: 'flee' }] };
                let fresh = null;
                try { fresh = hash(rebuild(other, { fresh: true }).fight); } catch { fresh = 'throws'; }
                let cached = null;
                try { cached = hash(rebuild(other).fight); } catch { cached = 'throws'; }
                assert.equal(cached, fresh);
            }
        } finally {
            host.close();
        }
    });
});

test('B-b4-3: an action chosen on a board that has moved on (its log length) is refused; the right one plays', async () => {
    await seeded(11, async () => {
        const host = await started();
        try {
            await offerAndStart(host, '! encounter 2 Bandit | tier: even');
            const view = host.q('combat.session');
            const before = host.head().domains.combat.session.actions.length;
            const stale = await host.cmd('combat.act', { session: view.id, logLength: view.logLength + 3, action: { type: 'defend' } });
            assert.equal(stale.ok, false);
            assert.match(stale.message, /moved on/);
            assert.equal(host.head().domains.combat.session.actions.length, before);
            const played = await host.cmd('combat.act', { session: view.id, logLength: view.logLength, action: { type: 'defend' } });
            assert.equal(played.ok, true, played.message);
            const again = await host.cmd('combat.act', { session: view.id, logLength: view.logLength, action: { type: 'defend' } });
            assert.equal(again.ok, false, 'a double click on the same board plays one turn');
            await playOut(host);
            assert.equal((await host.cmd('combat.end', { session: 'fi_zzzzzzzz' })).ok, false, 'another fight\'s Finish');
            assert.equal((await host.cmd('combat.end', { session: view.id })).ok, true);
        } finally {
            host.close();
        }
    });
});

test('F39: combat.end asks items.carry before each loot drop; what the party cannot carry is left behind and told', async () => {
    let checked = false;
    for (let seed = 1; seed <= 30 && !checked; seed += 1) {
        await seeded(seed, async () => {
            const host = await started({ settings: { modules: { [MODULE_ID]: { 'items.carrySize': 10 } } } });
            try {
                // The bag is already over what the party can carry (the story's own things are not weighed).
                await host.send('We pick up the anvils.', host.reply('Heavy.', ['+ item Anvil | qty: 5']));
                await offerAndStart(host, '! encounter 3 Wolf | tier: trivial');
                if (await playOut(host) !== 'won') return;
                const end = await host.cmd('combat.end');
                assert.equal(end.ok, true, end.message);
                const { loot } = end.receipt.data;
                if (!loot.left?.length) return;
                checked = true;
                assert.deepEqual(loot.items, [], 'nothing granted over the limit');
                const names = host.q('inventory.items', {}).map(item => item.name);
                for (const item of loot.left) assert.ok(!names.includes(item.name), `${item.name} was granted`);
                assert.match(end.receipt.summary, /Left behind, too heavy to carry: /);
            } finally {
                host.close();
            }
        });
    }
    assert.ok(checked, 'no seed gave loot to leave behind');
});

test('the party\'s internal commands are refused from a click, nothing saved; from another part they run', async () => {
    await seeded(5, async () => {
        const host = await started();
        try {
            const pc = host.q('party.pc');
            const head = hash(host.head().domains);
            for (const [type, payload] of [
                ['party.grantXp', { amount: 100 }],
                ['party.applyResult', { result: { party: [{ memberId: pc.id, hp: { cur: 1 } }], xp: {}, uses: {} } }],
                ['party.heal', { actor: pc.id, hp: 5 }],
                ['party.restore', { actor: pc.id, mp: 5 }],
                ['party.addCompanion', { name: 'Brann', level: 1 }],
            ]) {
                const r = await host.cmd(type, payload);
                assert.equal(r.ok, false, type);
                assert.equal(r.code, 'REFUSED', type);
            }
            assert.equal(hash(host.head().domains), head);
            assert.equal((await host.internal('party.grantXp', { amount: 10 })).ok, true);
            const brann = await host.internal('party.addCompanion', { name: 'Brann', level: 50 });
            assert.equal(brann.receipt.data.level, pc.level + 2, 'two levels above your character at most');
        } finally {
            host.close();
        }
    });
});

test('a join line\'s level is held near your character\'s; at most 10 offers of a kind wait', async () => {
    await seeded(5, async () => {
        const host = await started();
        try {
            await host.send('Who comes?', host.reply('A veteran.', ['+ join Lyra — a veteran archer | level: 60 | role: ranger']));
            assert.equal(host.head().domains.party.offers.at(-1).level, host.q('party.pc').level + 2);
            const lines = Array.from({ length: 15 }, (_, n) => `+ join Stranger${n} — a traveller`);
            await host.send('Everyone?', host.reply('A crowd.', lines));
            assert.equal(host.head().domains.party.offers.filter(offer => offer.kind === 'join').length, MAX_OFFERS_PER_KIND);
        } finally {
            host.close();
        }
    });
});

test('B-b4-6: a story wound while a fight runs is refused (a Problem): the fight\'s HP stays the party\'s', async () => {
    await seeded(101, async () => {
        const host = await started();
        try {
            await offerAndStart(host, '! encounter 2 Wolf | tier: weak');
            const was = host.q('party.pc').hp.cur;
            await host.send('Look out!', host.reply('A rock falls on you.', ['~ wound Ren — a falling rock | harm: grievous']));
            const record = host.st.ctx.chat.at(-1).extra.storySuite;
            assert.equal(record.receipts.filter(r => r.type === 'capture.wound').length, 0);
            assert.equal(host.q('party.pc').hp.cur, was);
        } finally {
            host.close();
        }
    });
});

const FILE = { rpgBattleCharacter: CHARACTER_FILE_VERSION, name: 'Ren', level: 1, xp: 0, points: 0, stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [] };

test('B-b4-9: a stat below the start value is refused, unless the file\'s race takes it there', async () => {
    await seeded(5, async () => {
        const low = await rpgHost();
        try {
            const r = await low.cmd('creation.import', { character: { ...FILE, stats: { ...FILE.stats, VIT: 4, STR: 6 } } });
            assert.equal(r.ok, false);
            assert.match(r.message, /VIT is 4; every stat starts at 5/);
        } finally {
            low.close();
        }
        const elf = await rpgHost();
        try {
            const r = await elf.cmd('creation.import', { character: { ...FILE, stats: { ...FILE.stats, VIT: 4, DEX: 7, INT: 6 }, origin: { race: { id: 'rpg-battle/elf', name: 'Elf' }, talents: [] } } });
            assert.equal(r.ok, true, r.message);
            assert.equal(elf.q('party.pc').stats.VIT, 4);
        } finally {
            elf.close();
        }
    });
});

test('B-b3-15: a character file brings at most purseCap(level) and MAX_THINGS things, and says what stayed behind', async () => {
    await seeded(5, async () => {
        const host = await rpgHost();
        try {
            const items = [{ def: { id: 'pack.nowhere/elixir', name: 'Elixir of Ages', kind: 'consumable', rarity: 'legendary', effect: { heal: 999999 } }, qty: MAX_THINGS + 50 }];
            const r = await host.cmd('creation.import', { character: { ...FILE, items, purse: 1e9 } });
            assert.equal(r.ok, true, r.message);
            assert.deepEqual(r.receipt.data.cut, { things: 50, purse: 1e9 - purseCap(1) });
            assert.match(r.receipt.summary, /50 things and \d+ of the purse stayed behind/);
            const inv = host.head().domains.inventory;
            const elixir = Object.values(inv.defs).find(def => def.name === 'Elixir of Ages');
            assert.ok(!elixir.id.startsWith('pack.'), 'a def id this chat does not have is dropped');
            assert.equal(elixir.rarity, 'epic');
            assert.ok(elixir.effect.heal <= 250);
            assert.equal(inv.wallets.party.coin, purseCap(1));
        } finally {
            host.close();
        }
    });
});

test('B-b4-14: a persona name is cleaned before it is checked; macros never make a name', async () => {
    for (const [written, expected] of [['(Ren)', null], ['{{user}}', null], ['<USER>', null], ['| — |', null], ['Ren {{char}}', 'Ren'], ['Mira (the bard)', 'Mira']]) {
        await seeded(5, async () => {
            const host = await rpgHost();
            try {
                const content = host.q('creation.content', {});
                const made = await host.cmd('creation.finish', { name: written, race: content.races?.[0]?.id, points: { STR: 4, VIT: 3, AGI: 1, DEX: 2 } });
                if (expected === null) {
                    assert.equal(made.ok, false, written);
                    assert.match(made.message, /rename the persona/, written);
                } else {
                    assert.equal(made.ok, true, `${written}: ${made.message}`);
                    assert.equal(host.q('party.pc').name, expected);
                }
            } finally {
                host.close();
            }
        });
    }
});

test('B-b5b-robust-13: a change line reaches a part cut to size', () => {
    const line = clipLine({ op: '+', kind: 'join', name: `Brecht${' '.repeat(5000)}x`, text: 'y'.repeat(5000), labels: Object.fromEntries(Array.from({ length: 50 }, (_, n) => [`k${n}`, ` ${'z'.repeat(5000)}`])), raw: 'r'.repeat(9000) });
    assert.ok(line.name.length <= LINE_LIMITS.name);
    assert.ok(line.text.length <= LINE_LIMITS.text);
    assert.equal(Object.keys(line.labels).length, LINE_LIMITS.labels);
    assert.ok(Object.values(line.labels).every(value => value.length === LINE_LIMITS.label));
    assert.equal(line.raw.length, LINE_LIMITS.raw);
});

test('B-b2-timeline-10: a per-reply claim is keyed by the reply\'s record id when the host gives one', async () => {
    const { replyOf } = await import('../../../src/v2/party/util.js');
    assert.equal(replyOf({ carrier: { index: 4, swipe: 1, sid: 'rec_abc' } }, {}), 'sid:rec_abc');
    assert.equal(replyOf({ carrier: { index: 4, swipe: 1 } }, {}), '4:1');
    assert.equal(replyOf({}, {}), null);
});
