// The Trade screen's layout (UI 8d), by DOM order and classes: each section has Story Block's section label with its
// note on the right; in a sell or buy row the price is a pill in the name line, beside the name (left-aligned), and the
// buttons are a column after the text (Sell, then All), so the buttons line up across rows. Needs Story Block's
// template renderer (helpers/runtime.js); skipped with the reason otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tradeScreen } from '../../../src/v2/screens/index.js';
import { renderer, rendererMissing } from './helpers/runtime.js';
import { makeState } from './helpers/state.js';

const skip = renderer ? false : rendererMissing;
const helpers = renderer ? await import('./helpers/render.js') : null;
const { all, draw, text } = helpers ?? {};

// A child's name for the layout: its semantic class (`price`, `acts`, `namerow`, ...) when it has one, else its first class.
const KINDS = ['namerow', 'price', 'acts', 'ss-listcard-main', 'ss-listcard-title'];
const kindOf = child => KINDS.find(kind => child.className.split(' ').includes(kind)) ?? child.className.split(' ').filter(Boolean)[0] ?? child.tagName.toLowerCase();
const kidsOf = el => [...el.children].map(kindOf);
// Every priced row of a list: a row with a name line (`.namerow`).
const pricedRows = root => all(root, 'li.ss-listcard-row').filter(row => row.querySelector('.namerow'));

test('trade layout: each section label is Story Block\'s section label, the sell note comes after its text', { skip }, () => {
    const drawn = draw(tradeScreen, makeState());
    const labels = all(drawn.el, 'h4.ss-section-label');
    assert.deepEqual(labels.map(label => text(label).trim()), ['Sell to the general store', 'Buy', 'Commission', 'On order']);
    const sell = labels[0];
    const note = sell.querySelector('.sec-note');
    assert.equal(text(note), 'to the general store');
    // the note is the label's last text, after the title's words (its rule, a CSS ::after, fills the gap before it)
    assert.equal(sell.children.at(-1), note);
    assert.equal(sell.querySelector('.sec-note').tagName, 'SMALL');
});

test('trade layout: a sell row has the price in the name line, beside the name, and the buttons after the text', { skip }, () => {
    const drawn = draw(tradeScreen, makeState());
    const sellSection = all(drawn.el, 'section.block').find(section => all(section, 'h4.ss-section-label').some(label => label.querySelector('.sec-note')));
    const rows = pricedRows(sellSection);
    assert.ok(rows.length >= 2, 'the fixture has several things to sell');
    for (const row of rows) {
        const item = row.querySelector('.ss-listcard-item');
        assert.deepEqual(kidsOf(item), ['ss-listcard-main', 'acts'], 'the name block, then the buttons');
        const line = item.querySelector('.ss-listcard-main').children[0];
        assert.equal(line.className, 'namerow');
        assert.deepEqual(kidsOf(line), ['ss-listcard-title', 'price'], 'the name, then its price pill');
        assert.equal(item.querySelector('.acts .price'), null, 'no price in the buttons column');
    }
});

test('trade layout: the sell buttons are Sell then All, in fixed positions, and a row with one thing has Sell alone', { skip }, () => {
    const drawn = draw(tradeScreen, makeState());
    const sellSection = all(drawn.el, 'section.block').find(section => all(section, 'h4.ss-section-label').some(label => label.querySelector('.sec-note')));
    const rows = pricedRows(sellSection);
    const withAll = rows.filter(row => row.querySelector('button.all'));
    const alone = rows.filter(row => !row.querySelector('button.all'));
    assert.ok(withAll.length >= 1 && alone.length >= 1, 'the fixture has a stack of two and a single thing');
    for (const row of rows) {
        const acts = row.querySelector('.acts');
        const buttons = [...acts.children];
        assert.equal(buttons[0].tagName, 'BUTTON');
        assert.deepEqual(buttons[0].className.split(' '), ['ss-button', 'act', 'sell'], 'Sell is always the first column');
        assert.equal(buttons[0].getAttribute('data-command'), 'trade.sell');
        assert.equal(text(buttons[0]), 'Sell');
        if (buttons.length > 1) {
            assert.deepEqual(buttons[1].className.split(' '), ['ss-button', 'ss-button-quiet', 'act', 'all'], 'All is the second column');
            assert.equal(text(buttons[1]), 'All');
        }
    }
});

test('trade layout: a buy row has the price beside its name and Buy in the first column of the button column', { skip }, () => {
    const drawn = draw(tradeScreen, makeState());
    const trader = all(drawn.el, 'details.trader')[0];
    const rows = pricedRows(trader);
    assert.ok(rows.length >= 1);
    for (const row of rows) {
        assert.deepEqual(kidsOf(row.querySelector('.ss-listcard-item')), ['ss-listcard-main', 'acts']);
        assert.deepEqual(kidsOf(row.querySelector('.namerow')), ['ss-listcard-title', 'price']);
        const buttons = [...row.querySelector('.acts').children];
        assert.equal(buttons.length, 1);
        assert.deepEqual(buttons[0].className.split(' '), ['ss-button', 'act', 'buy']);
    }
});
