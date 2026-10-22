// The screens on Story Block's glass design (docs/dev/ui-and-screens.md "The look"): every button a screen
// draws is a glass button with its states in the sheet (rest from the block, hover, press and disabled here),
// no old `btn` class is left, and the lists a screen draws as listcard rows stop at the block's row limit,
// seen in the DOM. The drawing needs Story Block's template renderer (helpers/runtime.js); skipped without it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { screens, tradeScreen } from '../../../src/v2/screens/index.js';
import { renderer, rendererMissing } from './helpers/runtime.js';
import { makeState } from './helpers/state.js';

const skip = renderer ? false : rendererMissing;
const helpers = renderer ? await import('./helpers/render.js') : null;
const { all, draw } = helpers ?? {};

test('glass buttons: every button a screen draws has its hover, press and disabled states in the sheet; no old btn class', () => {
    for (const screen of screens) {
        assert.doesNotMatch(screen.template, /class="[^"]*\bbtn\b/, `${screen.id} still draws the old btn class`);
        if (!/ss-button/.test(screen.template)) continue;
        assert.match(screen.css, /\.ss-button:hover/, `${screen.id}: hover`);
        assert.match(screen.css, /\.ss-button:active/, `${screen.id}: press`);
        assert.match(screen.css, /\.ss-button:disabled/, `${screen.id}: disabled`);
    }
});

test('trade: a stock list draws at most 100 listcard rows (ss.listcard\'s row limit), seen in the DOM', { skip }, () => {
    const items = Array.from({ length: 130 }, (_, i) => ({ def: { id: `trade/d${i}`, name: `Item ${i}`, rarity: 'common' }, price: 3, note: '' }));
    const drawn = draw(tradeScreen, makeState(), { queries: { 'trade.stock': () => ({ shop: 'bluewatch village|general', items }) } });
    assert.deepEqual(drawn.warnings, []);
    const [first] = all(drawn.el, 'details.trader');
    assert.equal(all(first, 'li.ss-listcard-row').length, 100);
    assert.equal(first.querySelectorAll('button').length, 100, 'one Buy button a row');
});
