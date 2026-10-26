// RPG Battle capture findings from the b1-capture break round (B-b1-capture-5, -6, -12, -3b).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';
import { DEFAULT_TAIL_BUDGET, estimateTokens } from '../../vendor/story-block/src/v2/prompt.js';

async function started(t) {
    t.mock.method(console, 'warn', () => {});
    const host = await rpgHost();
    t.after(() => host.close());
    const made = await host.cmd('party.create', { name: 'Ren', preset: 'fighter' });
    assert.equal(made.ok, true, made.message);
    await host.send('We walk into the village.', host.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement']));
    return host;
}
const stackOf = (host, name) => {
    const inv = host.head().domains.inventory;
    return Object.values(inv.stacks).find(stack => inv.defs[stack.def].name === name);
};
const sellEach = (host, name) => host.q('trade.quote', { type: 'sell', stack: stackOf(host, name).id, qty: 1 }).each;

// B-b1-capture-5: the item.define hook takes the numbers the story wrote in a note as the item's
// rules (v1 describeRow): "heals 999999 HP" is a 999999 heal worth 500000, "ATK +9999" a weapon
// worth 699930. Equip caps the stats, but the worth is not capped, so `+ item … | note: …` and
// trade.sell mint coin from model text (invariant 3).
test('a potion whose note says "heals 999999 HP" heals and sells no more than the biggest built-in potion', async t => {
    const host = await started(t);
    await host.send('I search the shelf.', host.reply('Two flasks.', [
        '+ item Superior Healing Potion',
        '+ item Elixir | note: potion, heals 999999 HP',
    ]));
    const elixir = host.head().domains.inventory.defs['story/elixir'];
    const superior = host.head().domains.inventory.defs['story/superior-healing-potion'];
    assert.ok(elixir.effect.heal <= superior.effect.heal, `the Elixir heals ${elixir.effect.heal}`);
    assert.ok(sellEach(host, 'Elixir') <= sellEach(host, 'Superior Healing Potion'), `the Elixir sells for ${sellEach(host, 'Elixir')}`);
});

// (Fixed in RB-fix1: the plain piece is now a sword. "Old Legend" read as goods, not a weapon, so it
// was no measure; and a story's words make nothing legendary any more, both are epic.)
test('a weapon whose note says "ATK +9999" sells for no more than a plain legendary weapon', async t => {
    const host = await started(t);
    await host.send('I search the armoury.', host.reply('Two blades.', [
        '+ item Old Legend Sword | note: legendary weapon',
        '+ item Blade of Doom | note: legendary weapon, ATK +9999',
    ]));
    const defs = Object.values(host.head().domains.inventory.defs);
    assert.deepEqual(defs.filter(def => /Old Legend|Doom/.test(def.name)).map(def => [def.kind, def.rarity]), [['equipment', 'epic'], ['equipment', 'epic']], 'story words make nothing legendary');
    assert.ok(sellEach(host, 'Blade of Doom') <= sellEach(host, 'Old Legend Sword'), `the Blade sells for ${sellEach(host, 'Blade of Doom')} (plain legendary: ${sellEach(host, 'Old Legend Sword')})`);
});

// B-b1-capture-6: MODULES F32 says up to 2 checks per reply; a reply may open up to 20
// (MAX_PENDING), each rolled and narrated before the next reply. (RB-fix1: since F80 a check rolls
// in its own reply and there is no pending list; the third and later are refused, so the reply's
// checks are counted in the log.)
test('a reply with five ? check lines rolls each distinct check through SD', async t => {
    const host = await started(t);
    await host.send('I try everything.', host.reply('You try.', [
        '? check stealth — sneak | dc: normal',
        '? check athletics — climb | dc: normal',
        '? check STR — lift | dc: normal',
        '? check perception — look | dc: easy',
        '? check persuasion — talk | dc: hard',
    ]));
    const log = Object.values(host.head().domains.checks.log);
    assert.equal(log.length, 5, 'SD rolls all five distinct checks; practice caps are applied separately');
    assert.deepEqual(host.turn.problems(), []);
});

// B-b1-capture-12: party.offers has no limit: every `+ join` / `+ skill` line with a new name is
// one more offer the reader has to dismiss, and the list is in every later state.
test('one reply with 300 join and skill lines does not leave 300 offers waiting', async t => {
    const host = await started(t);
    const lines = [];
    for (let i = 0; i < 150; i += 1) lines.push(`+ join Stranger${i} — a traveller`, `+ skill Ren — Trick${i}: a trick`);
    await host.send('Everyone wants to join.', host.reply('A crowd.', lines));
    assert.ok(Object.values(host.head().domains.party.offers).length <= 20, `${Object.values(host.head().domains.party.offers).length} offers wait`);
});

// B-b1-capture-3 (RPG Battle side): `! rest` is narrated and has no per-reply limit, so a reply
// that repeats it 150 times puts 150 [Happened] lines in the next tail, past the tail budget.
test('150 ! rest lines in one reply do not push the next tail past its budget', async t => {
    const host = await started(t);
    await host.send('We rest.', host.reply('You rest, and rest, and rest.', Array.from({ length: 150 }, () => '! rest short — by the fire')));
    await host.send('And then?', 'Morning.');
    const tail = host.tails().at(-1);
    assert.ok(estimateTokens(tail) <= DEFAULT_TAIL_BUDGET, `the tail is ${estimateTokens(tail)} tokens`);
});
