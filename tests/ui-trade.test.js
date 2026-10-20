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
        orders: [], pending: [],
        money: amount => `${amount}c`,
        buyerKind: name => (/carver/i.test(name) ? 'crafter' : 'general'),
        sellPrice: (name, kind) => (name === 'Rat Tail' ? (kind === 'crafter' ? 3 : kind === 'apothecary' ? 4 : 2) : 12),
        preview: ({ name }) => ({ name, note: 'uncommon · MDEF +4 · accessory', fee: 9, ready: 'Goldwane 14, 03:00 pm', when: 'Goldwane 14', span: 'two days' }),
        crafters: ['smith', 'crafter', 'apothecary'],
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
    // (0.5.43) How many: the row's − n + (Rat Tail, a stack of 5).
    pane.querySelectorAll('.rpg-trade-more')[0].click();
    pane.querySelectorAll('.rpg-trade-more')[0].click();
    assert.equal(texts(pane, '.rpg-trade-count')[0], '3');
    pane.querySelectorAll('.rpg-trade-sell')[0].click();
    assert.deepEqual(sold, [{ name: 'Rat Tail', qty: 3, each: 2, who: 'the general store', kind: 'general' }]);
    // The apothecary, with the story's name for her.
    pickTrader(pane, 'kind:apothecary');
    const name = pane.querySelector('.rpg-trade-name');
    name.value = 'Mother Greta';
    name.dispatch('input');
    name.dispatch('change');
    find(pane, '.rpg-trade-sell', '12c').click();
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
    pane.querySelectorAll('.rpg-trade-sell')[0].click();
    assert.equal(sold.at(-1).who, 'Elke');
});

test('a commission: only a crafter takes one; materials picked with Use; the crafter says when; no "made now" (0.5.44)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const made = [];
    renderTradeTab(pane, view(), { onCraft: request => made.push(request) });
    // The general store makes nothing: it says who does.
    assert.equal(pane.querySelector('.rpg-trade-craft'), null);
    assert.ok(texts(pane, '.rpg-trade-commission-who')[0].includes('a smith, a crafter'));
    pickTrader(pane, 'kind:crafter');
    assert.equal(pane.querySelector('.rpg-trade-when'), null, 'no made-now / order choice');
    assert.equal(pane.querySelectorAll('input[type="checkbox"]').length, 0, 'no checkboxes');
    assert.ok(pane.querySelector('.rpg-trade-craft').disabled, 'nothing named or picked yet');
    const piece = pane.querySelector('.rpg-trade-piece');
    piece.value = 'Skull Ring';
    piece.dispatch('input');
    piece.dispatch('change');
    const use = pane.querySelectorAll('.rpg-trade-pick')[1];
    assert.equal(use.getAttribute('aria-pressed'), 'false');
    use.click();
    assert.equal(pane.querySelectorAll('.rpg-trade-pick')[1].getAttribute('aria-pressed'), 'true');
    assert.ok(texts(pane, '.rpg-trade-preview')[0].includes('the bone-carver says two days, ready Goldwane 14 · fee 9c'));
    // A stack picked: its −/+ count sets how many go in.
    pane.querySelectorAll('.rpg-trade-pick')[0].click();
    pane.querySelectorAll('.rpg-trade-make .rpg-trade-more')[0].click();
    pane.querySelector('.rpg-trade-craft').click();
    assert.deepEqual(made, [{ name: 'Skull Ring', materials: [{ name: 'Brood-Mother Skull', qty: 1 }, { name: 'Rat Tail', qty: 2 }], slot: null, who: 'the bone-carver', kind: 'crafter' }]);
    // A fee the purse cannot pay: the button waits.
    resetTradeDraft();
    renderTradeTab(pane, view({ purse: 2 }), {});
    pickTrader(pane, 'kind:crafter');
    const again = pane.querySelector('.rpg-trade-piece');
    again.value = 'Skull Ring';
    again.dispatch('input');
    again.dispatch('change');
    pane.querySelectorAll('.rpg-trade-pick')[1].click();
    assert.ok(pane.querySelector('.rpg-trade-craft').disabled);
    assert.ok(texts(pane, '.rpg-battle-hint').some(line => line.includes('cannot pay')));
});

test('an order is collected once its time has come; until then the row says when (0.5.44)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    renderTradeTab(pane, view({ orders: [{ name: 'Skull Ring', note: 'uncommon · MDEF +4 · on order with the bone-carver, ready Goldwane 14, 03:00 pm', with: 'the bone-carver', due: false, ready: 'Goldwane 14, 03:00 pm' }] }), {});
    assert.equal(pane.querySelector('.rpg-trade-collect'), null);
    assert.deepEqual(texts(pane, '.rpg-trade-ready'), ['ready Goldwane 14, 03:00 pm']);
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

test('one line per thing: name, quiet note, a short price on the right; the full words for screen readers (0.5.43)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const sold = [];
    const stock = [{ name: 'Healing Draught', note: 'heal 30', price: 14, rarity: 'common' }];
    renderTradeTab(pane, view({ stock: () => stock, moneyShort: amount => `${amount} c` }), { onSell: sale => sold.push(sale) });
    const rows = pane.querySelectorAll('.rpg-trade-sell-list .rpg-trade-item.is-row');
    assert.equal(rows.length, 2);
    assert.equal(pane.querySelectorAll('.rpg-trade-item-head').filter(node => !node.className.includes('is-material') && node.parentNode?.className?.includes('is-row')).length, 0, 'no second line under the name');
    const first = rows[0];
    assert.equal(first.querySelector('.rpg-trade-item-name').textContent, 'Rat Tail');
    assert.equal(first.querySelector('.rpg-trade-note').textContent, '×5 · material');
    const sell = first.querySelector('.rpg-trade-sell');
    assert.equal(sell.textContent, '2 c', 'the short price, in the chat\'s coins');
    assert.equal(sell.getAttribute('aria-label'), 'Sell · 2c');
    // How many: the price follows the count, and the sale takes it.
    first.querySelector('.rpg-trade-more').click();
    pane.querySelectorAll('.rpg-trade-sell-list .rpg-trade-item.is-row')[0].querySelector('.rpg-trade-more').click();
    const again = pane.querySelectorAll('.rpg-trade-sell-list .rpg-trade-item.is-row')[0];
    assert.equal(again.querySelector('.rpg-trade-count').textContent, '3');
    assert.equal(again.querySelector('.rpg-trade-sell').textContent, '6 c');
    assert.equal(again.querySelector('.rpg-trade-sell').getAttribute('aria-label'), 'Sell 3 · 6c (2c each)');
    assert.equal(again.querySelector('.rpg-trade-less').disabled, false);
    again.querySelector('.rpg-trade-sell').click();
    assert.deepEqual(sold, [{ name: 'Rat Tail', qty: 3, each: 2, who: 'the general store', kind: 'general' }]);
    // A single thing has no count; a stack stops at its size.
    assert.equal(pane.querySelectorAll('.rpg-trade-sell-list .rpg-trade-item.is-row')[1].querySelector('.rpg-trade-stepper'), null);
    for (let i = 0; i < 5; i++) pane.querySelectorAll('.rpg-trade-more')[0].click();
    assert.equal(texts(pane, '.rpg-trade-count')[0], '5');
    assert.equal(pane.querySelectorAll('.rpg-trade-more')[0].disabled, true);
    // Buy rows the same way.
    const buy = pane.querySelector('.rpg-trade-buy-list .rpg-trade-item.is-row .rpg-trade-buy');
    assert.equal(buy.textContent, '14 c');
    assert.equal(buy.getAttribute('aria-label'), 'Buy · 14c');
});

test('a currency change shows at once: the rows ask the view for the short form every draw (0.5.43)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    renderTradeTab(pane, view({ moneyShort: amount => `${amount} c` }), {});
    assert.equal(texts(pane, '.rpg-trade-sell')[0], '2 c');
    renderTradeTab(pane, view({ moneyShort: amount => `${amount} sh` }), {});
    assert.equal(texts(pane, '.rpg-trade-sell')[0], '2 sh');
});

test('what the next reply is told: Undo on each line hands back its place; none when it cannot be exact (0.5.43)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const undone = [];
    renderTradeTab(pane, view({ pending: [{ text: 'sold 3 Rat Tail to Elke for 6 copper', undo: true }, { text: 'bought a Rope for 2 copper', undo: true }] }), { onUndo: index => undone.push(index) });
    assert.deepEqual(texts(pane, '.rpg-trade-told-text'), ['sold 3 Rat Tail to Elke for 6 copper', 'bought a Rope for 2 copper']);
    pane.querySelectorAll('.rpg-trade-undo')[1].click();
    assert.deepEqual(undone, [1]);
    renderTradeTab(pane, view({ pending: [{ text: 'sold 3 Rat Tail to Elke for 6 copper', undo: false }] }), { onUndo: () => {} });
    assert.equal(pane.querySelectorAll('.rpg-trade-undo').length, 0);
});

test('a wide pane lays the rows in two columns; a narrow one in one (0.5.43)', () => {
    resetTradeDraft();
    const wide = doc.createElement('div');
    wide.clientWidth = 600;
    renderTradeTab(wide, view(), {});
    assert.ok(wide.querySelector('.rpg-trade-tab').className.includes('is-wide'));
    assert.ok(wide.querySelector('.rpg-trade-list.is-rows'));
    const narrow = doc.createElement('div');
    narrow.clientWidth = 340;
    renderTradeTab(narrow, view(), {});
    assert.ok(!narrow.querySelector('.rpg-trade-tab').className.includes('is-wide'));
});

test('the trader\'s name on its own line, its hint short and whole (0.5.43)', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    renderTradeTab(pane, view(), {});
    const name = pane.querySelector('.rpg-trade-name-row .rpg-trade-name');
    assert.ok(name);
    assert.equal(name.getAttribute('placeholder'), 'their name (optional)');
    assert.match(name.getAttribute('aria-label'), /else the general store/);
});

// (0.5.46) The user's report: prices a player could set, "Purse: 0 copper" with coins in the
// Inventory, and trade open in a cellar.
test('the prices here are shown, never chosen on the page', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    renderTradeTab(pane, view());
    assert.equal(pane.querySelector('.rpg-trade-level'), null, 'no "Prices here" choice');
    assert.equal(texts(pane, '.rpg-trade-place')[0], 'Bluewatch Village | Guild Post · village prices: goods ×0.9, offers ×0.85');
    renderTradeTab(pane, view({ level: 'dear', prices: { tier: 'village', buy: 1.125, sell: 1.0625 } }));
    assert.equal(texts(pane, '.rpg-trade-place')[0], 'Bluewatch Village | Guild Post · dear prices (set in the settings): goods ×1.13, offers ×1.06');
});

test('no purse row at all is said so, never "0 copper"', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    renderTradeTab(pane, view({ purse: 0, purseText: '' }));
    assert.match(texts(pane, '.rpg-trade-purse')[0], /^Purse: none in the Inventory\. Money is a row like "Coin Pouch \| 1 \| 4 silver, 2 copper"/);
    renderTradeTab(pane, view({ purse: 0, purseText: '0 copper' }));
    assert.equal(texts(pane, '.rpg-trade-purse')[0], 'Purse: 0 copper');
});

test('no market here: no Buy, Sell or commission; orders read-only with their ready time', () => {
    resetTradeDraft();
    const pane = doc.createElement('div');
    const collected = [];
    const orders = [
        { name: 'Skull Charm', note: 'on order with the bone-carver', with: 'the bone-carver', due: true, ready: 'Goldwane 14' },
        { name: 'Wolf Cloak', note: 'on order', with: 'Elke', due: false, ready: 'Goldwane 16' },
    ];
    renderTradeTab(pane, view({ market: false, noMarket: 'No market here (Granary cellar). Trade in a settlement, or with a trader on the road.', place: 'Granary cellar', orders }), { onCollect: item => collected.push(item) });
    assert.deepEqual(texts(pane, '.rpg-trade-closed'), ['No market here (Granary cellar). Trade in a settlement, or with a trader on the road.']);
    for (const selector of ['.rpg-trade-who', '.rpg-trade-person', '.rpg-trade-sell-list', '.rpg-trade-sell', '.rpg-trade-buy-list', '.rpg-trade-make', '.rpg-trade-collect']) assert.equal(pane.querySelector(selector), null, selector);
    assert.equal(texts(pane, '.rpg-trade-purse')[0], 'Purse: 6 silver, 5 copper');
    assert.deepEqual(texts(pane, '.rpg-trade-ready'), ['ready since Goldwane 14', 'ready Goldwane 16']);
    assert.deepEqual(collected, []);
    // Back in a market: Collect again.
    renderTradeTab(pane, view({ orders }), { onCollect: item => collected.push(item) });
    pane.querySelector('.rpg-trade-collect').click();
    assert.deepEqual(collected.map(item => item.name), ['Skull Charm']);
});
