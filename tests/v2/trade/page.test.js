// The plain v2 Trade page (src/v2/trade/page.js) against the fake DOM: what it lists, and the
// command each button sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { part } from '../../../src/v2/trade/index.js';
import { DAY } from '../../../src/v2/trade/core.js';
import { baseState, createHost } from './helpers/fake-ctx.js';

const doc = installFakeDom();
const tab = part.tabs[0];

function draw(host) {
    const sent = [];
    const pane = doc.createElement('div');
    const api = { command: (type, payload) => { sent.push({ type, payload }); return host.command(type, payload); } };
    tab.render(pane, host.view(), api);
    return { pane, sent, api };
}

const find = (root, selector, text) => root.querySelectorAll(selector).find(node => node.textContent.includes(text));

test('page: at a market, the place and its prices, Buy rows with short prices, Sell rows', () => {
    const host = createHost(part, { state: baseState() });
    const { pane } = draw(host);
    assert.match(pane.querySelector('.rpg-trade-place').textContent, /^Bluewatch Village · village prices$/);
    const stock = host.query('trade.stock', { kind: 'general' });
    const names = texts(pane, '.rpg-trade-name');
    for (const item of stock.items) assert.ok(names.includes(item.def.name), item.def.name);
    // One line each; the price button short ('9 c', '1 s 2 c').
    for (const label of texts(pane, '.rpg-trade-action').filter(text => /\d/.test(text))) assert.match(label, /^(\d+ [a-z]+ ?)+$/);
    assert.ok(names.includes('Rat Tail') && names.includes('Rope'));
    assert.ok(!names.includes('Iron Sword'), 'what is worn is not for sale');
    assert.ok(!names.includes('Old Letter'), 'a quest item is not for sale');
    assert.equal(pane.querySelector('.rpg-trade-commission'), null, 'the general store takes no commissions');
});

test('page: Buy and Sell send their commands', () => {
    const host = createHost(part, { state: baseState() });
    const { pane, sent } = draw(host);
    const stock = host.query('trade.stock', { kind: 'general' });
    const first = stock.items[0];
    pane.querySelectorAll('.rpg-trade-action').find(node => node.title.startsWith(`Buy ${first.def.name}`)).click();
    assert.deepEqual(sent[0], { type: 'trade.buy', payload: { shop: stock.shop, def: first.def.id, qty: 1 } });
    pane.querySelectorAll('.rpg-trade-action').find(node => node.title.startsWith('Sell one Rat Tail')).click();
    assert.deepEqual(sent[1], { type: 'trade.sell', payload: { stack: 'it_00000001', qty: 1, kind: 'general' } });
    assert.equal(host.state.domains.inventory.stacks.it_00000001.qty, 4);
});

test('page: a crafter offers Commission from the materials', () => {
    const host = createHost(part, { state: baseState() });
    const { pane, sent } = draw(host);
    const pick = pane.querySelector('.rpg-trade-kind');
    pick.value = 'crafter';
    pick.dispatch('change');
    const section = pane.querySelector('.rpg-trade-commission');
    assert.ok(section, 'commission section for a crafter');
    const labels = texts(section, '.rpg-trade-material');
    assert.ok(labels.some(text => text.includes('Wolf Fang')));
    assert.ok(!labels.some(text => text.includes('Rope')), 'rope is no material');
    section.querySelector('.rpg-trade-piece').value = 'Fang Charm';
    const box = section.querySelectorAll('input').find(node => node.value === 'it_00000002');
    box.checked = true;
    find(section, '.rpg-trade-action', 'Commission it').click();
    assert.deepEqual(sent.at(-1), { type: 'craft.commission', payload: { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' } });
    assert.equal(Object.keys(host.state.domains.trade.orders).length, 1);
});

test('page: no market says so; orders stay in view without Collect', () => {
    const host = createHost(part, { state: baseState({ minutes: DAY }), time: DAY });
    host.command('craft.commission', { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' });
    host.state.domains.scene.place = { name: 'Darkwood Hollow', kind: 'wild' };
    const { pane } = draw(host);
    assert.match(pane.querySelector('.rpg-trade-place').textContent, /^No market here \(Darkwood Hollow\)/);
    assert.equal(pane.querySelector('.rpg-trade-kind'), null);
    assert.deepEqual(texts(pane, '.rpg-trade-ready'), ['not ready yet']);
    assert.equal(find(pane, '.rpg-trade-action', 'Collect'), undefined);
});

test('page: a ready order at a market has Collect', () => {
    const host = createHost(part, { state: baseState() });
    const id = host.command('craft.commission', { piece: 'Fang Charm', materials: [{ stack: 'it_00000002', qty: 1 }], crafter: 'crafter' }).receipt.data.order;
    const { pane, sent } = draw(host);
    find(pane, '.rpg-trade-action', 'Collect').click();
    assert.deepEqual(sent.at(-1), { type: 'craft.collect', payload: { order: id } });
    assert.equal(host.state.domains.trade.orders[id], undefined);
});
