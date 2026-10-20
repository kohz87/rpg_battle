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
        sellPrice: (name, kind) => (name === 'Rat Tail' ? (kind === 'crafter' ? 3 : 2) : 12),
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

test('selling to someone present: price each, how many, and the sale handed over', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const sold = [];
    const handlers = { onSell: sale => sold.push(sale) };
    renderTradeTab(pane, view(), handlers);
    assert.ok(texts(pane, '.rpg-trade-place')[0].includes('village prices'));
    assert.ok(texts(pane, '.rpg-trade-purse')[0].includes('6 silver, 5 copper'));
    const qty = pane.querySelectorAll('.rpg-trade-qty')[0];
    qty.value = '3';
    qty.dispatch('change');
    find(pane, '.rpg-trade-sell', 'Sell 3').click();
    assert.deepEqual(sold, [{ name: 'Rat Tail', qty: 3, each: 2, who: 'Elke', kind: 'general' }]);
});

test('someone named: their trade is guessed from the name and prices follow it', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const sold = [];
    renderTradeTab(pane, view(), { onSell: sale => sold.push(sale) });
    const person = pane.querySelector('.rpg-trade-person');
    person.value = person.querySelectorAll('option').at(-1).value;
    person.dispatch('change');
    const name = pane.querySelector('.rpg-trade-name');
    name.value = 'the bone-carver';
    name.dispatch('input');
    name.dispatch('change');
    assert.equal(pane.querySelector('.rpg-trade-kind').value, 'crafter');
    find(pane, '.rpg-trade-sell', '3c').click();
    assert.equal(sold[0].who, 'the bone-carver');
    assert.equal(sold[0].each, 3);
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
    assert.deepEqual(made, [{ name: 'Skull Ring', materials: [{ name: 'Brood-Mother Skull', qty: 1 }], slot: null, days: 2, who: 'Elke', kind: 'general' }]);
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
