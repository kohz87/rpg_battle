// Crafting on the real Story Block host (MODULES §F102): recipes learned from the packs and the
// story and forgotten, per member; `! craft` rolled with the reply's own dice by place (F80); every
// quality band; what a fail and a natural 1 cost; the station rule; the clock; craft skill growth;
// the mismatch flag; no value made from nothing (the trade part's resale cap); the money scale (F104);
// the tail only when crafting is likely; never from a screen; a swipe takes it all back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTOR, PACK, craftHost, itemsNamed, personOf, qtyOf, replyWhen } from './helpers.js';
import { part } from '../../../src/v2/craft/index.js';
import { tail } from '../../../src/v2/craft/queries.js';

const ORE = ['+ item Iron Ore | qty: 3', '+ item Ember Salt'];
const quiet = t => t.mock.method(console, 'warn', () => {});

async function withSword(t, options = {}) {
    quiet(t);
    const host = await craftHost({ goods: ORE, ...options });
    await host.send('Hollis teaches me.', host.reply('He shows you the folds.', ['+ recipe Iron Sword | from: Hollis']));
    return host;
}

const lastCraft = host => host.q('craft.log', {}).at(-1);
const knownNames = (host, actor) => host.q('craft.known', actor ? { actor } : {}).map(recipe => recipe.name).sort();

// ---------------------------------------------------------------------------------------
// Learning and forgetting

test('a pack\'s basic recipes are known from the start; another is learned from the story by its name, with where and when', async t => {
    quiet(t);
    const host = await craftHost();
    try {
        assert.deepEqual(knownNames(host), ['Bone Charm', 'Grilled Fish', 'Healing Draught']);
        await host.send('Hollis teaches me.', host.reply('He shows you.', ['+ recipe Iron Sword | from: Hollis']));
        assert.deepEqual(knownNames(host), ['Bone Charm', 'Grilled Fish', 'Healing Draught', 'Iron Sword']);
        const [entry] = Object.values(host.head().domains.craft.known);
        assert.equal(entry.recipe, 'pack.crafty/iron-sword');
        assert.equal(entry.from, 'Hollis');
        assert.ok(Number.isInteger(entry.rev) && entry.rev > 0);
        assert.equal(Object.keys(host.head().domains.craft.known)[0], `${host.q('party.pc').id}|pack.crafty/iron-sword`, 'kept under member and recipe');
        // Learned again: refused, nothing changes.
        const before = JSON.stringify(host.head().domains.craft);
        await host.send('Again.', host.reply('Again.', ['+ recipe Iron Sword | from: Hollis']));
        assert.equal(JSON.stringify(host.head().domains.craft), before);
    } finally { host.close(); }
});

test('a recipe whose `teaches` names who may teach it is learned only from them; a name the packs lack needs makes and with', async t => {
    quiet(t);
    const host = await craftHost();
    try {
        await host.send('A stranger.', host.reply('A stranger shows you.', ['+ recipe Iron Sword | from: a passing tinker', '+ recipe Moon Blade | from: Hollis']));
        assert.deepEqual(knownNames(host), ['Bone Charm', 'Grilled Fish', 'Healing Draught']);
        await host.send('The book.', host.reply('You read it.', ['+ recipe Iron Sword | from: the Smithing Primer']));
        assert.ok(knownNames(host).includes('Iron Sword'), '"the Smithing Primer" is one of its teachers');
    } finally { host.close(); }
});

test('a story-taught recipe is kept for this chat, with code\'s DC from its item\'s rarity (the materials\') or a rank', async t => {
    quiet(t);
    const host = await craftHost();
    try {
        await host.send('Mira shows me.', host.reply('Mira shows you.', [
            '+ recipe Ember Tonic | makes: Ember Tonic | with: Ember Salt x2, Healing Herb | craft: alchemy | from: Mira',
            '+ recipe Rank Brew | makes: Rank Brew | with: Healing Herb | craft: brewing | rank: B',
            '+ recipe Odd Thing | makes: Odd Thing | with: Healing Herb | craft: juggling',
        ]));
        const taught = host.head().domains.craft.taught;
        assert.deepEqual(Object.keys(taught).sort(), ['story/ember-tonic', 'story/rank-brew'], 'an unknown craft is refused');
        assert.equal(taught['story/ember-tonic'].craft, 'alchemy');
        assert.equal(taught['story/ember-tonic'].dc, 12, 'uncommon materials (two Ember Salt): an uncommon tonic, DC 12');
        assert.deepEqual(taught['story/ember-tonic'].materials, [{ name: 'Ember Salt', qty: 2 }, { name: 'Healing Herb', qty: 1 }]);
        assert.equal(taught['story/rank-brew'].craft, 'alchemy', 'brewing is alchemy');
        assert.equal(taught['story/rank-brew'].dc, 16, 'rank B is higher than a common brew');
        const recipe = host.q('craft.recipes').find(entry => entry.name === 'Ember Tonic');
        assert.equal(recipe.source, 'story');
        assert.ok(knownNames(host).includes('Ember Tonic'));
    } finally { host.close(); }
});

test('a story-taught recipe\'s name is flattened: invisible characters dropped, the same recipe when taught again (B-rxui-6)', async t => {
    quiet(t);
    const host = await craftHost();
    try {
        await host.send('Taught.', host.reply('A salve.', ['+ recipe \u202eSalve\u200b | from: Hollis | makes: Salve Jar | with: Healing Herb x2 | craft: cooking']));
        await host.send('Again.', host.reply('Again.', ['+ recipe Salve | from: Hollis | makes: Salve Jar | with: Healing Herb x2 | craft: cooking']));
        assert.deepEqual(Object.keys(host.head().domains.craft.taught), ['story/salve']);
        assert.equal(host.head().domains.craft.taught['story/salve'].name, 'Salve');
        assert.ok(knownNames(host).includes('Salve'));
    } finally { host.close(); }
});

test('`- recipe` forgets: a learned one goes, a basic one stays forgotten until learned again; a swipe undoes a learn', async t => {
    const host = await withSword(t);
    try {
        await host.send('I forget.', host.reply('Gone.', ['- recipe Iron Sword', '- recipe Healing Draught']));
        assert.deepEqual(knownNames(host), ['Bone Charm', 'Grilled Fish']);
        const pc = host.q('party.pc').id;
        assert.deepEqual(Object.keys(host.head().domains.craft.forgot), [`${pc}|pack.crafty/healing-draught`]);
        assert.deepEqual(host.head().domains.craft.known, {});
        await host.send('I relearn.', host.reply('Back.', ['+ recipe Healing Draught | from: an old book']));
        assert.ok(knownNames(host).includes('Healing Draught'));
        assert.deepEqual(host.head().domains.craft.forgot, {});
        // Forgetting what one never knew is refused.
        const before = JSON.stringify(host.head().domains.craft);
        await host.send('Hm.', host.reply('Hm.', ['- recipe Iron Sword']));
        assert.equal(JSON.stringify(host.head().domains.craft), before);
        // A swipe takes the learning back.
        await host.send('Teach me.', host.reply('Learned.', ['+ recipe Iron Sword | from: Hollis']));
        assert.ok(knownNames(host).includes('Iron Sword'));
        await host.swipe('Nothing is taught.');
        assert.ok(!knownNames(host).includes('Iron Sword'));
    } finally { host.close(); }
});

test('companions learn and craft with their own stats', async t => {
    const host = await withSword(t);
    try {
        await host.send('Lyra?', host.reply('Lyra asks to come.', ['+ join Lyra — a traveller | role: ranger']));
        const offer = host.q('party.offers')[0];
        assert.equal((await host.cmd('party.acceptOffer', { offer: offer.id })).ok, true);
        const lyra = host.q('party.actor', { name: 'Lyra' });
        await host.send('Teach Lyra.', host.reply('Hollis teaches her.', ['+ recipe Iron Sword | from: Hollis | who: Lyra']));
        assert.ok(knownNames(host, lyra.id).includes('Iron Sword'));
        await replyWhen(host, 'Lyra forges.', () => true, () => ['! craft Iron Sword | by: Lyra | roll: 1 | result: made']);
        const made = lastCraft(host);
        assert.equal(made.actor, lyra.id);
        const strength = host.q('checks.modifiers', { actor: lyra.id, skill: 'craft smithing', stat: 'STR' })[0].amount;
        assert.equal(made.modifiers[0].amount, strength, 'Lyra\'s own STR');
        assert.equal(made.modifiers[0].reason, 'STR');
    } finally { host.close(); }
});

// ---------------------------------------------------------------------------------------
// The dice

test('a craft takes the reply\'s roll by its place among the reply\'s checks and crafts (F80); naming another is noted', async t => {
    const host = await withSword(t);
    try {
        // (Roll 2 is not a 1: a 1 is also "Roll 1" by its value, and then nothing needs noting.)
        const die = await replyWhen(host, 'I sneak, then forge.', die => die !== 1, () => [
            '? check stealth — slipping in | dc: easy | roll: 1 | result: success',
            '! craft Iron Sword | roll: 1 | result: made',
        ], { place: 2 });
        const made = lastCraft(host);
        assert.equal(made.roll, 2, 'the second uncertain attempt takes Roll 2');
        assert.equal(made.die, die);
        assert.match(made.note, /named Roll 1.*Roll 2 taken/);
        assert.deepEqual(host.q('craft.rollsUsed', { carrier: made.carrier }), [2]);
    } finally { host.close(); }
});

test('a check after a craft in the same reply takes the next roll: one positional counter both ways (F80, B-b4-2)', async t => {
    quiet(t);
    const host = await craftHost({ goods: ['+ item River Fish | qty: 3'] });
    try {
        await replyWhen(host, 'I cook, then look around.', () => true, () => [
            '! craft Grilled Fish | roll: 1',
            '? check perception — spot the thief | dc: normal | roll: 1 | result: success',
        ]);
        const rolls = replyWhen.rolls;
        assert.equal(lastCraft(host).roll, 1);
        assert.equal(lastCraft(host).die, rolls[0]);
        const check = host.q('checks.log').at(-1);
        assert.equal(check.roll, 2, 'the check is the second uncertain attempt');
        assert.equal(check.die, rolls[1]);
        assert.match(check.note, /Roll 2 taken/);
        // Two crafts and two checks: Rolls 1 and 2 by place, the rest rolled by code.
        await replyWhen(host, 'Busy.', () => true, () => [
            '! craft Grilled Fish | roll: 1',
            '? check stealth — slip by | dc: normal | roll: 2 | result: success',
            '! craft Grilled Fish | roll: 2',
            '? check perception — look | dc: normal | roll: 2 | result: success',
        ]);
        const crafts = host.q('craft.last').results.map(result => host.q('craft.log').find(entry => entry.id === result.id));
        const checks = host.q('checks.last').results.map(result => host.q('checks.log').find(entry => entry.id === result.id));
        assert.deepEqual(crafts.map(entry => entry.roll), [1, 0]);
        assert.deepEqual(checks.map(entry => entry.roll), [2, 0]);
        assert.match(crafts[1].note, /every roll handed over was used: code rolled/);
        assert.match(checks[1].note, /every roll handed over was used: code rolled/);
        assert.deepEqual(host.q('craft.rollsUsed', { carrier: crafts[0].carrier }), [1, 0]);
    } finally { host.close(); }
});

test('a story-taught tonic is a consumable, its heal held to its rarity\'s draught; gear only when it names a slot', async t => {
    quiet(t);
    const host = await craftHost({ place: '~ place Riverside Camp | kind: wild', goods: ['+ item Healing Herb | qty: 4', '+ item Iron Ore | qty: 3'] });
    try {
        await host.send('The hermit teaches me.', host.reply('He shows you.', [
            '+ recipe Healing Tonic | from: the hermit | makes: Healing Tonic | with: Healing Herb x2 | craft: cooking',
            '+ recipe Camp Knife | from: the hermit | makes: Camp Knife | with: Iron Ore x3 | craft: leatherwork | slot: weapon',
        ]));
        await replyWhen(host, 'I brew the tonic.', die => die > 1, () => ['! craft Healing Tonic | roll: 1']);
        const made = lastCraft(host);
        const def = host.head().domains.inventory.defs[made.item?.def];
        if (made.quality !== 'fail') {
            assert.equal(def.kind, 'consumable', 'drunk, not worn');
            assert.equal(def.slot, null);
            assert.deepEqual(def.stats, {});
            assert.ok(def.effect.heal > 0 && def.effect.heal <= 30, `a common tonic heals at most 20 (×1.5): ${def.effect.heal}`);
        }
        await replyWhen(host, 'I make a knife.', die => die > 1, () => ['! craft Camp Knife | roll: 1']);
        const knife = lastCraft(host);
        assert.equal(knife.recipeName, 'Camp Knife');
        if (knife.item) {
            const def = host.head().domains.inventory.defs[knife.item.def];
            assert.equal(def.kind, 'equipment', 'a slot was written: gear');
            assert.ok(def.value <= 18, 'worth no more than 1.5× its three ore');
        }
    } finally { host.close(); }
});

test('without Story Director\'s clock a craft takes no story time, and its receipt says so', async t => {
    quiet(t);
    const host = await craftHost({ goods: ['+ item River Fish'] });
    try {
        await host.send('I cook.', host.reply('Fish.', ['! craft Grilled Fish | roll: 1']));
        const receipt = host.store.receipts().map(entry => entry.receipt ?? entry).filter(entry => entry.type === 'capture.craft').at(-1);
        assert.ok(receipt, 'the craft\'s receipt');
        assert.match(receipt.summary, /No story time passes/);
        assert.equal(receipt.data?.clock ?? false, false);
    } finally { host.close(); }
});

test('at most two crafts count in one reply; the third is refused and costs nothing', async t => {
    quiet(t);
    const host = await craftHost({ goods: ['+ item River Fish | qty: 3'] });
    try {
        await host.send('Cook three.', host.reply('Fish.', ['! craft Grilled Fish | roll: 1', '! craft Grilled Fish | roll: 2', '! craft Grilled Fish | roll: 2']));
        assert.equal(host.q('craft.log').length, 2);
        assert.equal(qtyOf(host, 'River Fish'), 1, 'the third fish was not used');
        assert.deepEqual(host.q('craft.log').map(entry => entry.roll), [1, 2]);
    } finally { host.close(); }
});

// ---------------------------------------------------------------------------------------
// Quality bands (Ren the fighter: STR +2 against the Iron Sword's DC 12)

const BANDS = [
    ['fail', die => die >= 2 && die <= 9],
    ['normal', die => die >= 10 && die <= 14],
    ['fine', die => die >= 15 && die <= 19],
    ['masterwork', die => die === 20],
    ['ruined', die => die === 1],
];

for (const [quality, wanted] of BANDS) {
    test(`quality band: ${quality}`, async t => {
        const host = await withSword(t);
        try {
            const die = await replyWhen(host, 'I forge.', wanted, () => ['! craft Iron Sword | with: Iron Ore x3, Ember Salt | roll: 1 | result: made']);
            const made = lastCraft(host);
            assert.equal(made.quality, quality);
            assert.equal(made.die, die);
            assert.equal(made.total, die + 2);
            assert.equal(made.dc, 12);
            if (quality === 'normal') assert.equal(qtyOf(host, 'Iron Sword'), 1);
            if (quality === 'fine') {
                const [row] = itemsNamed(host, 'Fine Iron Sword');
                assert.equal(host.head().domains.inventory.defs[row.def].stats.ATK, 6, '×1.2');
            }
            if (quality === 'masterwork') {
                const [row] = itemsNamed(host, 'Masterwork Iron Sword');
                const def = host.head().domains.inventory.defs[row.def];
                assert.equal(def.stats.ATK, 8, '×1.5');
                assert.ok(def.tags.includes('fire'), 'the Ember Salt\'s element');
                assert.equal(made.refine, 1);
            }
            if (quality === 'normal' || quality === 'fine' || quality === 'masterwork') {
                assert.equal(qtyOf(host, 'Iron Ore'), 0);
                assert.equal(qtyOf(host, 'Ember Salt'), 0);
            }
            if (quality === 'fail') {
                // Half of the 4 units: 2 of the 3 ore (the salt kept); nothing made.
                assert.equal(qtyOf(host, 'Iron Ore'), 1);
                assert.equal(qtyOf(host, 'Ember Salt'), 1);
                assert.equal(made.item, null);
                assert.deepEqual(made.lost, [{ name: 'Iron Ore', qty: 2 }]);
            }
            if (quality === 'ruined') {
                assert.equal(qtyOf(host, 'Iron Ore'), 0, 'a natural 1 loses every material');
                assert.equal(qtyOf(host, 'Ember Salt'), 0);
                const [row] = itemsNamed(host, 'Botched Iron Sword');
                const def = host.head().domains.inventory.defs[row.def];
                assert.deepEqual(def.stats, { ATK: -1 }, 'junk with a small debuff');
                assert.equal(def.value, 0);
            }
        } finally { host.close(); }
    });
}

test('masterwork by DC + 10 without a natural 20 (Grilled Fish, DC 10, DEX +1: a 19)', async t => {
    quiet(t);
    const host = await craftHost({ goods: ['+ item River Fish'] });
    try {
        await replyWhen(host, 'I cook.', die => die === 19, () => ['! craft Grilled Fish | roll: 1 | result: masterwork']);
        const made = lastCraft(host);
        assert.equal(made.total, 20);
        assert.equal(made.quality, 'masterwork');
        assert.equal(made.mismatch, '');
        const [row] = itemsNamed(host, 'Masterwork Grilled Fish');
        assert.equal(host.head().domains.inventory.defs[row.def].effect.heal, 15, '10 × 1.5');
        assert.equal(made.refine, 0, 'refinement is for gear');
    } finally { host.close(); }
});

test('a story quality the dice do not give is flagged on the card (craft.last) and told to the next reply', async t => {
    const host = await withSword(t);
    try {
        await replyWhen(host, 'I forge.', die => die >= 10 && die <= 14, () => ['! craft Iron Sword | roll: 1 | result: masterwork']);
        const card = host.q('craft.last');
        assert.equal(card.results.length, 1);
        assert.equal(card.results[0].quality, 'normal');
        assert.equal(card.results[0].mismatch, 'narrated as masterwork, the dice say made');
        assert.equal(qtyOf(host, 'Iron Sword'), 1, 'code\'s quality is what is made');
        assert.equal(qtyOf(host, 'Masterwork Iron Sword'), 0);
    } finally { host.close(); }
});

// ---------------------------------------------------------------------------------------
// The station rule

test('stations: smithing needs a forge and alchemy a bench; cooking any fire; refused with nothing taken', async t => {
    quiet(t);
    const host = await craftHost({ place: '~ place Deep Woods | kind: wild', goods: [...ORE, '+ item River Fish', '+ item Healing Herb | qty: 2'] });
    try {
        await host.send('Hollis wrote it down.', host.reply('A note.', ['+ recipe Iron Sword | from: Hollis']));
        await host.send('I forge and brew and cook.', host.reply('Out here?', ['! craft Iron Sword | roll: 1', '! craft Healing Draught | roll: 2']));
        assert.equal(host.q('craft.log').length, 0);
        assert.equal(qtyOf(host, 'Iron Ore'), 3);
        assert.equal(qtyOf(host, 'Healing Herb'), 2);
        const sword = personOf(host).recipes.find(recipe => recipe.name === 'Iron Sword');
        assert.deepEqual(sword.station, { name: 'a forge', here: false });
        assert.equal(sword.ready, false);
        await host.send('I cook.', host.reply('No fire.', ['! craft Grilled Fish | roll: 1']));
        assert.equal(host.q('craft.log').length, 0, 'no fire in the woods');
        await host.send('I make a fire and cook.', host.reply('A fire.', ['! craft Grilled Fish | roll: 1 | at: campfire']));
        assert.equal(host.q('craft.log').length, 1, 'a campfire made on the spot');
        await host.send('To the smithy.', host.reply('There.', ['~ place Hollis\'s Smithy | kind: settlement']));
        assert.equal(personOf(host).recipes.find(recipe => recipe.name === 'Iron Sword').ready, true);
        assert.equal(personOf(host).recipes.find(recipe => recipe.name === 'Healing Draught').station.here, false);
    } finally { host.close(); }
});

// ---------------------------------------------------------------------------------------
// The clock, skill growth

test('the clock moves on by the recipe\'s minutes through Story Director\'s command; without it nothing breaks', async t => {
    const host = await withSword(t, { modules: [DIRECTOR] });
    try {
        assert.equal(host.q('director.time').minutes, 600);
        await replyWhen(host, 'I forge.', die => die > 1, () => ['! craft Iron Sword | roll: 1']);
        assert.equal(host.q('director.time').minutes, 720, 'two hours at the anvil');
        // Two crafts in one reply each take their time (a cause per craft: Story Director moves once per cause a reply).
        await host.send('More ore.', host.reply('Ore.', ['+ item Iron Ore | qty: 3', '+ item Ember Salt']));
        await host.send('Fish.', host.reply('Fish.', ['+ item River Fish | qty: 2']));
        await replyWhen(host, 'I forge and cook.', die => die > 1, () => ['! craft Iron Sword | roll: 1', '! craft Grilled Fish | roll: 2']);
        assert.equal(host.q('director.time').minutes, 720 + 120 + 30);
        assert.equal(host.q('craft.log').find(entry => entry.recipeName === 'Iron Sword').minutes, 120);
    } finally { host.close(); }
    const plain = await withSword(t);
    try {
        await replyWhen(plain, 'I forge.', () => true, () => ['! craft Iron Sword | roll: 1']);
        assert.equal(plain.q('craft.log').length, 1);
    } finally { plain.close(); }
});

test('each craft is a use of the craft; ranks grow like skills and add to the roll', async t => {
    quiet(t);
    const host = await craftHost({ goods: ['+ item River Fish | qty: 8'] });
    try {
        const cooking = () => personOf(host).skills.find(skill => skill.craft === 'cooking');
        assert.equal(cooking().rank, 0);
        await host.send('I cook.', host.reply('Fish.', ['! craft Grilled Fish | roll: 1']));
        assert.equal(cooking().rank, 1, 'the first use makes rank 1');
        assert.equal(cooking().uses, 1);
        const fish = () => personOf(host).recipes.find(recipe => recipe.name === 'Grilled Fish');
        assert.equal(fish().mod, 2, 'DEX +1, cooking rank 1');
        for (let n = 0; n < 3; n += 1) await host.send('More fish.', host.reply('Fish.', ['! craft Grilled Fish | roll: 1', '! craft Grilled Fish | roll: 2']));
        assert.equal(cooking().uses, 7);
        assert.equal(cooking().rank, 2, '1 use, then 5 more');
        assert.equal(fish().mod, 3);
        assert.ok(lastCraft(host).modifiers.some(entry => entry.source === 'rank' && entry.amount === 2));
    } finally { host.close(); }
});

// ---------------------------------------------------------------------------------------
// Value

test('no value from nothing: a crafted piece is worth its materials and never sells for more than they would fetch', async t => {
    const host = await withSword(t);
    try {
        await replyWhen(host, 'I forge.', die => die >= 10 && die <= 19, () => ['! craft Iron Sword | roll: 1']);
        const row = host.q('inventory.items').find(entry => /Iron Sword/.test(entry.name));
        const def = host.head().domains.inventory.defs[row.def];
        assert.equal(def.value, 22, '3 Iron Ore (4) and an Ember Salt (10), not the pack sword\'s 900');
        assert.ok(Object.keys(host.head().domains.trade.paid).some(key => key.startsWith(`${row.def}#`)), 'the trade part\'s resale cap is set');
        for (const kind of ['general', 'smith', 'fence']) {
            const quote = host.q('trade.quote', { type: 'sell', stack: row.stack, qty: 1, kind });
            assert.equal(quote.ok, true, quote.message);
            assert.ok(quote.total <= 11, `${kind} pays ${quote.total}: no more than the materials fetch`);
        }
    } finally { host.close(); }
});

test('F104: a material with no value of its own is priced by code times the pack\'s money scale (inventory.economy)', async t => {
    quiet(t);
    const charmValue = async pack => {
        const host = await craftHost({ goods: ['+ item Bone Chip | qty: 2'], pack });
        try {
            await replyWhen(host, 'I carve.', die => die >= 5 && die < 19, () => ['! craft Bone Charm | roll: 1']);
            const row = host.q('inventory.items').find(entry => /Bone Charm$/.test(entry.name));
            return host.head().domains.inventory.defs[row.def].value;
        } finally { host.close(); }
    };
    const plain = await charmValue(PACK);
    const scaled = await charmValue({ ...PACK, economy: { scale: 10 } });
    assert.ok(plain >= 2);
    assert.equal(scaled, Math.max(1, Math.round(plain / 2 * 10)) * 2);
});

// ---------------------------------------------------------------------------------------
// The tail, the screen, the feature

test('the tail has a crafting line only when crafting is likely: at a station, or when the reader speaks of it', async t => {
    quiet(t);
    const host = await craftHost({ place: '~ place Deep Woods | kind: wild' });
    try {
        await host.send('We walk on.', host.reply('Trees.'));
        assert.ok(!host.tails().at(-1).includes('[Crafting]'));
        await host.send('Can I cook something here?', host.reply('Maybe.'));
        assert.match(host.tails().at(-1), /\[Crafting\] Ren: .*Grilled Fish \(cooking\) \+1 vs DC 10/);
        await host.send('On to the smithy.', host.reply('There.', ['~ place Hollis\'s Smithy | kind: settlement']));
        await host.send('We rest.', host.reply('Rest.'));
        assert.match(host.tails().at(-1), /\[Crafting\]/);
        const statics = host.statics();
        assert.ok(statics.at(-1).includes('! craft Recipe'), 'the grammar is in the fixed part');
        assert.equal(new Set(statics).size, 1, 'and the fixed part never changes');
    } finally { host.close(); }
    assert.deepEqual(tail({ feature: () => false, chat: { lastUser: 'I forge a sword' } }), { lines: [], optional: [] }, 'nothing while the feature is off');
});

test('craft.view: per member, recipes with materials had and missing and code\'s chances', async t => {
    quiet(t);
    const host = await craftHost({ goods: ['+ item Iron Ore | qty: 2'] });
    try {
        await host.send('Teach me.', host.reply('Taught.', ['+ recipe Iron Sword | from: Hollis']));
        const ren = personOf(host);
        assert.equal(ren.you, true);
        const sword = ren.recipes.find(recipe => recipe.name === 'Iron Sword');
        assert.deepEqual(sword.materials, [{ name: 'Iron Ore', need: 3, have: 2 }, { name: 'Ember Salt', need: 1, have: 0 }]);
        assert.deepEqual(sword.chances, { fail: 45, normal: 25, fine: 25, masterwork: 5 });
        assert.equal(sword.dc, 12);
        assert.equal(sword.ready, false);
        assert.match(sword.why, /Missing 1 Iron Ore, 1 Ember Salt/);
        assert.equal(sword.from, 'Hollis');
    } finally { host.close(); }
});

test('the feature is declared on by default; the kinds, commands and queries carry it; crafting is never a click', async t => {
    assert.deepEqual(part.features.map(feature => [feature.id, feature.default]), [['rpg-battle.crafting', true]]);
    for (const spec of Object.values(part.kinds)) assert.equal(spec.feature, 'rpg-battle.crafting');
    for (const fn of [...Object.values(part.commands), ...Object.values(part.queries)]) assert.equal(fn.feature, 'rpg-battle.crafting');
    const host = await withSword(t);
    try {
        for (const type of ['craft.make', 'craft.learn', 'craft.forget']) {
            const out = await host.cmd(type, { name: 'Iron Sword' });
            assert.equal(out.ok, false);
            assert.equal(out.code, 'REFUSED');
        }
        assert.equal(qtyOf(host, 'Iron Ore'), 3);
    } finally { host.close(); }
});

test('a swipe of the crafting reply gives the materials back and takes the item, the use and the card away', async t => {
    const host = await withSword(t);
    try {
        await replyWhen(host, 'I forge.', die => die > 1, () => ['! craft Iron Sword | roll: 1']);
        assert.equal(host.q('craft.log').length, 1);
        await host.swipe('You think better of it.');
        assert.equal(host.q('craft.log').length, 0);
        assert.equal(qtyOf(host, 'Iron Ore'), 3);
        assert.equal(qtyOf(host, 'Ember Salt'), 1);
        assert.equal(host.q('inventory.items').filter(row => /Iron Sword/.test(row.name)).length, 0);
        assert.equal(personOf(host).skills.find(skill => skill.craft === 'smithing').uses, 0);
        assert.equal(host.q('craft.last'), null);
    } finally { host.close(); }
});
