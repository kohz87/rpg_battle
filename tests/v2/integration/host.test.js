// RPG Battle on the real Story Block v2 host (SPEC §10): Story Block's core module and RPG
// Battle's merged module (src/v2/module.js) on the vendored runtime, driven the way SillyTavern
// drives it: generations through the interceptor, replies with <Changes> blocks, UI commands
// through the sdk, swipes and deletes. Seeds come from a seeded crypto (helpers/host.js), so each
// fight plays the same way every run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playOut, rpgHost, seeded } from './helpers/host.js';
import { MODULE_ID } from '../../../src/v2/module.js';

const WEIR = '~ wound Ren — fell into the weir | harm: wound';

/** A host with Ren made and a first reply that puts the party in Bluewatch Village. */
async function started(options = {}) {
    const host = await rpgHost(options);
    const made = await host.cmd('party.create', { name: 'Ren', preset: 'fighter' });
    assert.equal(made.ok, true, made.message);
    await host.send('We walk into the village.', host.reply('Bluewatch Village, at dusk.', ['~ place Bluewatch Village | kind: settlement']));
    return host;
}

/** `started`, then a reply with an encounter line, the fight played out and settled. */
async function fought(options = {}) {
    const host = await started(options);
    const out = await host.send('We go down to the cellar.', host.reply('Rats boil out of the bins.', ['! encounter 2 Cellar Rat — boiling out of the bins | tier: weak']));
    const offer = host.q('combat.offers')[0];
    assert.ok(offer, 'the encounter line became an offer');
    const begun = await host.cmd('combat.start', { offer: offer.id });
    assert.equal(begun.ok, true, begun.message);
    const status = await playOut(host);
    const ended = await host.cmd('combat.end');
    assert.equal(ended.ok, true, ended.message);
    return { host, reply: out.index, offer, status, ended };
}

test('character creation is mandatory: no story reply until party.create (MODULES §F12)', async () => {
    const host = await rpgHost();
    try {
        const before = host.st.ctx.chat.length;
        const held = await host.send('Hello?', 'This reply must not be written.');
        assert.equal(held.aborted, true);
        assert.deepEqual(host.st.notices, [{ reason: 'Create your character first.', moduleId: MODULE_ID }]);
        assert.equal(host.st.ctx.chat.length, before + 1, 'only the reader\'s message is in the chat');
        assert.equal(host.q('party.pc'), null);

        const made = await host.cmd('party.create', { name: 'Ren', preset: 'fighter' });
        assert.equal(made.ok, true, made.message);
        const pc = host.q('party.pc');
        assert.equal(pc.name, 'Ren');
        assert.match(pc.id, /^ac_[0-9a-z]{8}$/);
        const again = await host.cmd('party.create', { name: 'Ren Again', preset: 'fighter' });
        assert.equal(again.code, 'REFUSED');

        const sent = await host.st.generate('normal', { reply: 'The story begins in earnest.' });
        assert.notEqual(sent.aborted, true);
        assert.equal(host.st.ctx.chat.at(-1).mes, 'The story begins in earnest.');
    } finally {
        host.close();
    }
});

test('a reply\'s encounter line → offer → combat.start/act/end: loot and XP land in inventory and party', async () => {
    await seeded(7, async () => {
        const { host, status, ended, offer } = await fought();
        try {
            assert.equal(offer.foes[0].name, 'Cellar Rat');
            assert.equal(offer.place, 'Bluewatch Village');
            assert.equal(status, 'won');
            const data = ended.receipt.data;
            assert.equal(data.outcome, 'won');
            assert.deepEqual(data.foes, [{ name: 'Cellar Rat', count: 2 }]);
            // XP through party.grantXp.
            const pc = host.q('party.pc');
            assert.equal(pc.xp, data.xp[pc.id]);
            assert.ok(pc.xp > 0);
            // HP as the fight left it, through party.applyResult.
            assert.ok(pc.hp.cur < pc.hp.max);
            // Loot through inventory.grant: the rules' numbers from RPG Battle's item.define hook.
            const items = host.q('inventory.items', {});
            assert.ok(data.loot.items.length, 'this fight drops loot');
            for (const drop of data.loot.items) {
                const row = items.find(item => item.name === drop.name);
                assert.ok(row, `${drop.name} is in the inventory`);
                assert.equal(row.qty, drop.qty);
                assert.equal(row.owner, 'party');
                assert.ok(Number.isInteger(row.value) && row.value > 0, `${drop.name} has a price`);
                assert.equal(host.head().domains.inventory.stacks[row.stack].from, ended.receipt.id);
            }
            // A draught among the drops (the seed decides) has v1's effect.
            const draught = host.head().domains.inventory.defs['story/minor-healing-draught'];
            if (draught) {
                assert.equal(draught.kind, 'consumable');
                assert.equal(draught.effect.heal, 20);
            }
            for (const drop of data.loot.items) assert.ok(items.find(item => item.name === drop.name).kind, drop.name);
            // The fight is gone; its result waits to be told; Story Director's quests can count it.
            assert.equal(host.q('combat.session'), null);
            assert.deepEqual(host.q('combat.foesBeaten', { sinceRev: 0 }).map(entry => entry.foes), [[{ name: 'Cellar Rat', count: 2 }]]);
            assert.equal(ended.receipt.narrate, true);
            assert.match(ended.receipt.summary, /^Victory/);
            // Settled once: a second end has nothing to settle.
            assert.equal((await host.cmd('combat.end')).code, 'NOT_FOUND');
        } finally {
            host.close();
        }
    });
});

test('the next reply tells the fight once; its swipe tells it again without settling it again', async () => {
    await seeded(7, async () => {
        const { host, ended } = await fought();
        try {
            const xp = host.q('party.pc').xp;
            await host.send('What now?', 'We catch our breath among the bins.');
            const told = host.tails().at(-1);
            assert.match(told, /^\[Happened\]/);
            assert.ok(told.includes(ended.receipt.summary.slice(0, 40)));
            await host.swipe('Another telling of the same moment.');
            assert.ok(host.tails().at(-1).includes(ended.receipt.summary.slice(0, 40)), 'the swipe is told it too');
            assert.equal(host.q('party.pc').xp, xp, 'nothing was settled twice');
            await host.send('Onwards.', 'We climb the stairs.');
            assert.ok(!host.tails().at(-1).includes(ended.receipt.summary.slice(0, 40)), 'told once on this line of history');
        } finally {
            host.close();
        }
    });
});

test('item.use through a command heals from a draught; full HP is refused and nothing is saved', async () => {
    const host = await started();
    try {
        await host.send('I search the cart.', host.reply('A stoppered vial rolls out.', ['+ item Minor Healing Draught | qty: 2 | note: heal 20', WEIR]));
        assert.deepEqual(host.turn.problems(), []);
        const pc = host.q('party.pc');
        assert.ok(pc.hp.cur < pc.hp.max, 'the weir hurt Ren');
        const draught = host.q('items.usable', { actor: pc.id })[0];
        assert.equal(draught.name, 'Minor Healing Draught');
        assert.equal(draught.helps, true);

        const used = await host.cmd('item.use', { stack: draught.stack, target: pc.id });
        assert.equal(used.ok, true, used.message);
        assert.equal(host.q('party.pc').hp.cur, Math.min(pc.hp.max, pc.hp.cur + 20));
        assert.equal(host.q('inventory.items', {}).find(item => item.stack === draught.stack).qty, 1);
        assert.equal(used.receipt.narrate, true);
        assert.match(used.receipt.summary, /\(now \d+\/\d+ HP\)\.$/);

        // Until HP is full; then the draught is refused and kept, and nothing is saved.
        while (host.q('party.pc').hp.cur < host.q('party.pc').hp.max) {
            const next = await host.cmd('item.use', { stack: draught.stack });
            if (!next.ok) break;
        }
        await host.store.flush();
        const rev = host.head().meta.rev;
        const saves = host.st.saves.length;
        const left = host.q('inventory.items', {}).find(item => item.def === 'story/minor-healing-draught')?.qty ?? 0;
        if (left) {
            const refused = await host.cmd('item.use', { stack: host.q('inventory.items', {}).find(item => item.def === 'story/minor-healing-draught').stack });
            assert.equal(refused.code, 'REFUSED');
            assert.match(refused.message, /does not need/);
            await host.store.flush();
            assert.equal(host.head().meta.rev, rev);
            assert.equal(host.st.saves.length, saves);
            assert.equal(host.q('inventory.items', {}).find(item => item.def === 'story/minor-healing-draught').qty, left);
        }
        // Not a thing to use: refused, not malformed.
        assert.equal((await host.cmd('item.use', { stack: 'it_nothere0' })).code, 'NOT_FOUND');
    } finally {
        host.close();
    }
});

test('one blow per person per reply (ctx.carrier); a swipe of that reply is its own reply', async () => {
    const host = await started();
    try {
        await host.send('Careful on the bank.', host.reply('Ren slips twice.', [WEIR, '~ wound Ren — a branch | harm: scratch']));
        const problems = host.turn.problems(MODULE_ID);
        assert.equal(problems.length, 1);
        assert.equal(problems[0].code, 'CLAIMED');
        const hurt = host.q('party.pc').hp.cur;
        await host.swipe(host.reply('Ren slips once.', [WEIR]));
        assert.equal(host.q('party.pc').hp.cur, hurt, 'the swipe takes the first blow back and gives its own');
        assert.equal(host.turn.problems(MODULE_ID).length, 1, 'no new problem: a different reply');
    } finally {
        host.close();
    }
});

test('a story\'s poison is the party\'s "poisoned" and enters a fight as the fight\'s poison', async () => {
    const host = await started();
    try {
        await host.send('The spider!', host.reply('A bite on the wrist.', ['~ wound Ren — poisoned: a spider bite']));
        assert.deepEqual(host.q('party.pc').conditions, [{ kind: 'poisoned', stacks: 1 }]);
        await host.send('More of them.', host.reply('Something skitters.', ['! encounter 1 Cave Spider — out of the dark | tier: weak']));
        const begun = await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id });
        assert.equal(begun.ok, true, begun.message);
        const fighter = host.head().domains.combat.session.setup.party[0];
        assert.deepEqual(fighter.conditions.map(entry => entry.name), ['poison']);
        assert.ok(host.q('combat.session').combatants[0].conditions.includes('poisoned'));
    } finally {
        host.close();
    }
});

test('trade at a settlement: sell the loot, buy a supply; nothing to trade in the wild', async () => {
    await seeded(7, async () => {
        const { host } = await fought();
        try {
            const tails = host.q('inventory.items', {}).find(item => item.name === 'Cellar Rat Tail');
            const sold = await host.cmd('trade.sell', { stack: tails.stack, qty: tails.qty });
            assert.equal(sold.ok, true, sold.message);
            const coin = host.q('inventory.wallet', { owner: 'party' }).coin;
            assert.equal(coin, sold.receipt.data.total);
            assert.ok(Number.isInteger(coin) && coin > 0);
            assert.match(sold.receipt.summary, new RegExp(`for ${coin} gold\\.$`));
            assert.equal(host.q('inventory.items', {}).some(item => item.name === 'Cellar Rat Tail'), false);

            const stock = host.q('trade.stock', { kind: 'general' });
            const cheap = stock.items.filter(entry => entry.def.kind !== 'equipment' && entry.price <= coin).sort((a, b) => a.price - b.price)[0];
            assert.ok(cheap, 'something on the shelf is affordable');
            const bought = await host.cmd('trade.buy', { shop: stock.shop, def: cheap.def.id, qty: 1 });
            assert.equal(bought.ok, true, bought.message);
            assert.equal(host.q('inventory.wallet', { owner: 'party' }).coin, coin - cheap.price);
            const row = host.q('inventory.items', {}).find(item => item.def === cheap.def.id);
            assert.equal(row.qty, 1);
            assert.equal(host.head().domains.inventory.stacks[row.stack].from, bought.receipt.id);
            // Too dear: NOT_ENOUGH, nothing saved.
            const dear = stock.items.find(entry => entry.price > coin);
            if (dear) assert.equal((await host.cmd('trade.buy', { shop: stock.shop, def: dear.def.id, qty: 1 })).code, 'NOT_ENOUGH');

            await host.send('We head out.', host.reply('The road runs into the woods.', ['~ place Darkwood Hollow | kind: wild']));
            const refused = await host.cmd('trade.sell', { stack: row.stack, qty: 1 });
            assert.equal(refused.code, 'REFUSED');
            assert.match(refused.message, /No market here/);
        } finally {
            host.close();
        }
    });
});

test('swipe and delete roll back: the offer, the fight, its loot and XP go with their reply', async () => {
    await seeded(7, async () => {
        const host = await started();
        try {
            const before = structuredClone(host.head());
            const out = await host.send('Down we go.', host.reply('Rats boil out.', ['! encounter 2 Cellar Rat — boiling out of the bins | tier: weak']));
            assert.equal(host.q('combat.offers').length, 1);
            // A swipe without the encounter: no offer.
            await host.swipe('The cellar is quiet.');
            assert.deepEqual(host.q('combat.offers'), []);
            // Back to the first swipe: its offer is back.
            await host.st.swipeTo(out.index, 0);
            assert.equal(host.q('combat.offers').length, 1);
            // Fight it there: everything lands on that reply.
            await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id });
            await playOut(host);
            const ended = await host.cmd('combat.end');
            assert.equal(ended.ok, true, ended.message);
            assert.ok(host.q('party.pc').xp > 0);
            assert.ok(host.q('inventory.items', {}).length > 0);
            // Replay equals rebuild: the head rebuilt from what is stored is the same state.
            const head = structuredClone(host.head());
            host.store.rebuild();
            assert.deepEqual(host.head(), head);
            // Deleting the reply takes the fight back with it.
            await host.store.flush();
            await host.st.deleteMessage(out.index);
            assert.deepEqual(host.head().domains, before.domains);
            assert.equal(host.q('party.pc').xp, 0);
            assert.deepEqual(host.q('inventory.items', {}), []);
            assert.deepEqual(host.q('combat.foesBeaten', { sinceRev: 0 }), []);
        } finally {
            host.close();
        }
    });
});

test('the static prompt is byte-identical across replies while the state changes', async () => {
    await seeded(7, async () => {
        const { host } = await fought();
        try {
            await host.send('We rest a moment.', host.reply('Ren binds the bites.', [WEIR]));
            await host.send('And go on.', host.reply('Night falls.', ['! rest long — a night at the inn']));
            const statics = host.statics();
            assert.ok(statics.length >= 4);
            for (const text of statics) assert.equal(text, statics[0]);
            // Every kind's grammar and every part's rules are in it, and no names or numbers of this chat.
            for (const kind of ['! encounter', '~ wound', '+ join', '+ skill', '? check', '! rest']) assert.ok(statics[0].includes(kind), kind);
            assert.ok(statics[0].includes('stop at the first blow'));
            assert.ok(statics[0].includes('Party numbers (HP, MP, SP, XP, levels) are set by code'));
            assert.ok(!statics[0].includes('Ren'));
            // The tail is where the state shows, and it changes.
            const tails = host.tails();
            assert.ok(tails.some(text => /Party: Ren \(you\): /.test(text)));
            assert.notEqual(tails.at(-1), tails.at(-2));
        } finally {
            host.close();
        }
    });
});

test('settings are namespaced per part; each part reads its own (combat.hitBase reaches the fight)', async () => {
    const host = await rpgHost({ settings: { modules: { [MODULE_ID]: { 'combat.hitBase': 60, 'party.autoSpend': false } } } });
    try {
        const def = host.registry.settingsDefs().find(entry => entry.moduleId === MODULE_ID);
        for (const key of ['party.startPoints', 'party.autoSpend', 'combat.hitBase', 'combat.turnOrder', 'trade.placePrices']) assert.ok(def.schema[key], key);
        assert.equal(def.schema['combat.hitBase'].label, 'Combat: Hit chance base %');
        assert.equal(def.defaults['combat.hitBase'], 75);
        assert.deepEqual(Object.keys(def.schema).filter(key => !key.includes('.')), []);
        assert.equal(host.sdk.settings(MODULE_ID)['party.autoSpend'], false);
        assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
        await host.send('Rats.', host.reply('Rats!', ['! encounter 1 Cellar Rat — out of a crate | tier: weak']));
        const begun = await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id });
        assert.equal(begun.ok, true, begun.message);
        assert.equal(host.head().domains.combat.session.setup.hit.base, 60);
    } finally {
        host.close();
    }
});

test('one currency: Story Block\'s name words trade and loot; amounts are whole numbers of it', async () => {
    await seeded(7, async () => {
        const { host } = await fought({ settings: { modules: { 'story-block': { currency: 'crowns' } } } });
        try {
            assert.deepEqual(host.q('inventory.currency'), { name: 'crowns', short: 'c' });
            const tails = host.q('inventory.items', {}).find(item => item.name === 'Cellar Rat Tail');
            const sold = await host.cmd('trade.sell', { stack: tails.stack, qty: 1 });
            assert.match(sold.receipt.summary, / crowns?\.$/);
            assert.doesNotMatch(sold.receipt.summary, /copper|silver|gold/);
            await host.send('Count it.', host.reply('Coins clink.', ['+ coin 30 | from: the reeve']));
            assert.equal(host.q('inventory.wallet', { owner: 'party' }).coin, sold.receipt.data.total + 30);
        } finally {
            host.close();
        }
    });
});

test('a fight to the death that is lost stops the story (return part); deleting that reply brings Ren back', async () => {
    await seeded(1, async () => {
        const host = await started();
        try {
            const out = await host.send('Into the crypt.', host.reply('It wakes.', ['! encounter 3 Grave Wight — out of the dark | tier: deadly | stakes: death']));
            const begun = await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id });
            assert.equal(begun.ok, true, begun.message);
            assert.equal(begun.receipt.data.place, 'Bluewatch Village');
            assert.equal(await playOut(host), 'lost');
            const ended = await host.cmd('combat.end');
            assert.equal(ended.ok, true, ended.message);
            assert.equal(ended.receipt.data.outcome, 'lost');
            assert.equal(ended.receipt.data.stakes, 'death');
            assert.deepEqual(host.q('party.pc').conditions, [{ kind: 'dead', stacks: 1 }]);

            const held = await host.send('Hello?', 'This reply must not be written.');
            assert.equal(held.aborted, true);
            assert.equal(host.st.notices.at(-1).reason, 'You died. Return in time, or swipe/delete back.');

            // Swipe/delete back: the reply that held the fight goes, and the fight with it.
            await host.store.flush();
            await host.st.deleteMessage(host.st.ctx.chat.length - 1);
            await host.st.deleteMessage(out.index);
            assert.deepEqual(host.q('party.pc').conditions, []);
            const again = await host.st.generate('normal', { reply: 'Ren stands at the crypt door, alive.' });
            assert.notEqual(again.aborted, true);
        } finally {
            host.close();
        }
    });
});

test('a check line waits for the reader (checks part takes the check kind); unrolled checks roll before the next reply', async () => {
    await seeded(3, async () => {
        const host = await started();
        try {
            await host.send('I sneak past.', host.reply('The guard turns away.', ['? check stealth — slipping past the guard | dc: hard', '? check climb — up the wall | dc: easy']));
            assert.deepEqual(host.turn.problems(), []);
            const pending = host.q('checks.pending');
            assert.deepEqual(pending.map(check => [check.skill, check.dc]), [['stealth', 20], ['climb', 10]]);
            assert.equal(host.registry.captureOwner('check'), MODULE_ID);
            const rolled = await host.cmd('check.roll', { id: pending[0].id });
            assert.equal(rolled.ok, true, rolled.message);
            assert.match(rolled.receipt.summary, /^Ren tries stealth \(slipping past the guard\): d20 \d+/);
            // The climb is still waiting when the reader sends on: it is rolled first, and both are told.
            await host.send('On we go.', 'They reach the yard.');
            const told = host.tails().at(-1);
            assert.ok(told.includes(rolled.receipt.summary));
            assert.match(told, /Ren tries climb \(up the wall\): d20 \d+/);
            assert.deepEqual(host.q('checks.pending'), []);
            assert.equal(host.q('checks.log').length, 2);
        } finally {
            host.close();
        }
    });
});
