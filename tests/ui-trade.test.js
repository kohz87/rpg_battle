// The Trade tab against the fake DOM (src/ui/trade.js, 0.5.37): what it shows from `view`,
// and what each button hands to its handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from './ui-fake-dom.js';

const doc = installFakeDom();
const { renderTradeTab, resetTradeDraft } = await import('../src/ui/trade.js');

function view(over = {}) {
    return {
        ready: true, chatId: 'c1', place: 'Bluewatch Village | Guild Post', prices: { tier: 'village', buy: 0.9, sell: 0.85 }, level: null,
        people: ['Elke'], purse: 65, purseText: '6 silver, 5 copper',
        sellable: [{ name: 'Rat Tail', qty: 5, note: 'material' }, { name: 'Brood-Mother Skull', qty: 1, note: 'uncommon material' }],
        materials: [{ name: 'Rat Tail', qty: 5, note: 'material' }, { name: 'Brood-Mother Skull', qty: 1, note: 'uncommon material' }],
        orders: [], pending: [], orderDays: 2,
        money: amount => `${amount}c`,
        buyerKind: name => (/carver/i.test(name) ? 'crafter' : 'general'),
        sellPrice: (name, kind) => (name === 'Rat Tail' ? (kind === 'crafter' ? 3 : kind === 'apothecary' ? 4 : 2) : 12),
        preview: ({ name, days }) => ({ name, note: 'uncommon · MDEF +4 · accessory', fee: 9, ready: days ? 'Goldwane 14' : '' }),
        ...over,
    };
}

const find = (root, selector, text) => root.querySelectorAll(selector).find(node => node.textContent.includes(text));

test('not ready: says why', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    renderTradeTab(pane, { ready: false, reason: 'Make your character first (Party tab).' });
    assert.deepEqual(texts(pane, '.rpg-battle-empty'), ['Make your character first (Party tab).']);
});

const pickTrader = (pane, value) => {
    const picker = pane.querySelector('.rpg-trade-person');
    picker.value = value;
    picker.dispatch('change');
};

test('trading with a kind of trader at this place: no one need be here; a name is optional (0.5.38)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const sold = [];
    renderTradeTab(pane, view(), { onSell: sale => sold.push(sale) });
    assert.ok(texts(pane, '.rpg-trade-place')[0].includes('village prices'));
    assert.deepEqual(texts(pane, '.rpg-trade-person option').slice(0, 6), ['General store', 'Apothecary', 'Smith', 'Crafter (bone-carver, tanner…)', 'Fence', 'Guild buyer']);
    assert.ok(texts(pane, '.rpg-trade-person option').includes('Elke (here)'), 'who is here, as extra choices');
    const qty = pane.querySelectorAll('.rpg-trade-qty')[0];
    qty.value = '3';
    qty.dispatch('change');
    find(pane, '.rpg-trade-sell', 'Sell 3').click();
    assert.deepEqual(sold, [{ name: 'Rat Tail', qty: 3, each: 2, who: 'the general store', kind: 'general' }]);
    // The apothecary, with the story's name for her.
    pickTrader(pane, 'kind:apothecary');
    const name = pane.querySelector('.rpg-trade-name');
    name.value = 'Mother Greta';
    name.dispatch('input');
    name.dispatch('change');
    find(pane, '.rpg-trade-sell', '4c').click();
    assert.deepEqual(sold.at(-1), { name: 'Rat Tail', qty: 3, each: 4, who: 'Mother Greta', kind: 'apothecary' }, 'how many is kept across traders');
});

test('someone present or named: their trade is guessed from the name and can be changed', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const sold = [];
    renderTradeTab(pane, view(), { onSell: sale => sold.push(sale) });
    pickTrader(pane, '\u0000someone');
    const name = pane.querySelector('.rpg-trade-name');
    name.value = 'the bone-carver';
    name.dispatch('input');
    name.dispatch('change');
    assert.equal(pane.querySelector('.rpg-trade-kind').value, 'crafter');
    assert.match(texts(pane, '.rpg-trade-guess')[0], /by the name: crafter/);
    find(pane, '.rpg-trade-sell', '3c').click();
    assert.equal(sold[0].who, 'the bone-carver');
    pickTrader(pane, 'person:Elke');
    find(pane, '.rpg-trade-sell', 'Sell').click();
    assert.equal(sold.at(-1).who, 'Elke');
});

test('ordering a piece: materials picked, the preview with its fee and day, the order handed over', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const made = [];
    renderTradeTab(pane, view(), { onCraft: request => made.push(request) });
    assert.ok(pane.querySelector('.rpg-trade-craft').disabled, 'nothing named or picked yet');
    const piece = pane.querySelector('.rpg-trade-piece');
    piece.value = 'Skull Ring';
    piece.dispatch('input');
    piece.dispatch('change');
    pane.querySelectorAll('.rpg-trade-pick')[1].checked = true;
    pane.querySelectorAll('.rpg-trade-pick')[1].dispatch('change');
    const when = pane.querySelector('.rpg-trade-when');
    when.value = 'order';
    when.dispatch('change');
    assert.ok(texts(pane, '.rpg-trade-preview')[0].includes('ready Goldwane 14 · fee 9c'));
    pane.querySelector('.rpg-trade-craft').click();
    assert.deepEqual(made, [{ name: 'Skull Ring', materials: [{ name: 'Brood-Mother Skull', qty: 1 }], slot: null, days: 2, who: 'the general store', kind: 'general' }]);
    // A fee the purse cannot pay: the button waits.
    resetTradeDraft();
    renderTradeTab(pane, view({ purse: 2 }), {});
    const again = pane.querySelector('.rpg-trade-piece');
    again.value = 'Skull Ring';
    again.dispatch('input');
    again.dispatch('change');
    pane.querySelectorAll('.rpg-trade-pick')[1].checked = true;
    pane.querySelectorAll('.rpg-trade-pick')[1].dispatch('change');
    assert.ok(pane.querySelector('.rpg-trade-craft').disabled);
    assert.ok(texts(pane, '.rpg-battle-hint').some(line => line.includes('cannot pay')));
});

test('orders to collect, and what the next reply will be told', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const collected = [];
    renderTradeTab(pane, view({ orders: [{ name: 'Skull Ring', note: 'uncommon · MDEF +4 · on order with the bone-carver, ready Goldwane 14', with: 'the bone-carver' }], pending: ['sold 3 Rat Tail to Elke for 6 copper'] }), { onCollect: order => collected.push(order) });
    assert.deepEqual(texts(pane, '.rpg-trade-told li'), ['sold 3 Rat Tail to Elke for 6 copper']);
    pane.querySelector('.rpg-trade-collect').click();
    assert.deepEqual(collected, [{ name: 'Skull Ring', who: 'the bone-carver' }]);
});

test('buying from the trader: their stock with prices in rarity colours; Buy waits for the purse (0.5.38)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const bought = [];
    const stock = [{ name: 'Healing Draught', note: 'heal 30', price: 14, rarity: 'common' }, { name: 'Belt', note: 'rare · DEF +6', price: 135, rarity: 'rare' }];
    renderTradeTab(pane, view({ stock: () => stock }), { onBuy: request => bought.push(request) });
    const buttons = pane.querySelectorAll('.rpg-trade-buy');
    assert.equal(buttons.length, 2);
    assert.equal(buttons[1].disabled, true, 'the purse holds 65');
    assert.ok(pane.querySelector('.rpg-trade-buy-list .rpg-rarity.is-rare'));
    // (0.5.41) Story Block's shared rarity class past common, so its colours apply; common keeps the text colour.
    assert.ok(pane.querySelector('.rpg-trade-buy-list .story-block-rarity.is-rare'));
    assert.equal(pane.querySelector('.rpg-trade-buy-list .story-block-rarity.is-common'), null);
    buttons[0].click();
    assert.deepEqual(bought, [{ name: 'Healing Draught', who: 'the general store', kind: 'general' }]);
});

test('the purse first, each price once (0.5.38)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    renderTradeTab(pane, view(), {});
    const root = pane.querySelector('.rpg-trade-tab');
    assert.ok(root.childNodes[0].className.includes('rpg-trade-purse'));
    assert.equal(pane.querySelectorAll('.rpg-trade-price').length, 0);
    assert.ok(texts(pane, '.rpg-trade-sell').every(label => (label.match(/\dc/g) ?? []).length === 1), 'one price on a single sale');
    assert.equal(pane.querySelectorAll('.rpg-trade-kind').length, 0, 'a trader kind is what it is');
});

test('whose items: with a companion who carries things, Sell lists yours or theirs (0.5.40)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const picked = [];
    renderTradeTab(pane, view({ owners: [{ id: 'pc', name: 'Ren' }, { id: 'm1', name: 'Lyra' }], owner: 'pc' }), { onOwner: id => picked.push(id) });
    const whose = pane.querySelector('.rpg-trade-owner');
    assert.deepEqual(texts(pane, '.rpg-trade-owner option'), ['Ren (you)', 'Lyra']);
    whose.value = 'm1';
    whose.dispatch('change');
    assert.deepEqual(picked, ['m1']);
    renderTradeTab(pane, view({ owners: [{ id: 'pc', name: 'Ren' }] }), {});
    assert.equal(pane.querySelector('.rpg-trade-owner'), null, 'only you: no choice');
});
