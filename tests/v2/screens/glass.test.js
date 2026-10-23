// The screens on Story Block's glass design (docs/dev/ui-and-screens.md "The look"): every button a screen
// draws is a glass button with its states in the sheet (rest from the block, hover, press and disabled here),
// no old `btn` class is left, and the lists a screen draws as listcard rows stop at the block's row limit,
// seen in the DOM. The drawing needs Story Block's template renderer (helpers/runtime.js); skipped without it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { screens, tradeScreen } from '../../../src/v2/screens/index.js';
import { TRADERS } from '../../../src/v2/screens/view.js';
import { fightScreen } from '../../../src/v2/board/index.js';
import { renderer, rendererMissing } from './helpers/runtime.js';
import { makeState } from './helpers/state.js';

const skip = renderer ? false : rendererMissing;
const helpers = renderer ? await import('./helpers/render.js') : null;
const { all, draw } = helpers ?? {};

test('glass buttons: the hover, press and disabled states are Story Block\'s (its sheet); no screen copies them', () => {
    // Story Block's glass.css (the vendored copy) draws the states of button.ss-button, at 0,5,0 (as SillyTavern's menu button's).
    const block = readFileSync(new URL('../../vendor/story-block/src/v2/view/glass.css', import.meta.url), 'utf8');
    assert.match(block, /button\.ss-button:not\(:disabled\)[^{]*:hover\s*[,{]/, 'Story Block draws the hover');
    assert.match(block, /button\.ss-button:not\(:disabled\)[^{]*:active\s*[,{]/, 'Story Block draws the press');
    assert.match(block, /button\.ss-button:disabled/, 'Story Block draws the disabled look');
    for (const screen of [...screens, fightScreen]) {
        assert.doesNotMatch(screen.template, /class="[^"]*\bbtn\b/, `${screen.id} still draws the old btn class`);
        assert.doesNotMatch(screen.css, /ss-button:(hover|active|disabled)/, `${screen.id} copies a button state (Story Block's now)`);
    }
});

test('trade: a long stock list draws every row (the template rows have no cap), seen in the DOM', { skip }, () => {
    const items = Array.from({ length: 130 }, (_, i) => ({ def: { id: `trade/d${i}`, name: `Item ${i}`, rarity: 'common' }, price: 3, note: '' }));
    // One trader holds the long list (the template draws at most 5000 elements a screen; six long lists would hit it).
    const drawn = draw(tradeScreen, makeState(), { queries: { 'trade.stock': ({ kind }) => ({ shop: 'bluewatch village|general', items: kind === TRADERS[0].kind ? items : [] }) } });
    assert.deepEqual(drawn.warnings, []);
    const [first] = all(drawn.el, 'details.trader');
    assert.equal(all(first, 'li.ss-listcard-row').length, 130);
    assert.equal(first.querySelectorAll('button').length, 130, 'one Buy button a row');
});
