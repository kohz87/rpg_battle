// The HUD item's layout: the name and level sit 4px above the bars, and the bars can shrink inside a
// squeezed item (min-width 0), so the two columns do not run past it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hudScreen } from '../../../src/v2/screens/hud.js';

test('the HUD item: a 4px gap between name and bars; the bars grid can shrink (min-width 0)', () => {
    assert.match(hudScreen.css, /\.id \{ display: grid; gap: 4px; min-width: 0; \}/);
    assert.match(hudScreen.css, /\.bars \{ display: grid; grid-template-columns: repeat\(2, minmax\(6em, 1fr\)\); gap: 8px; min-width: 0; \}/);
    assert.doesNotMatch(hudScreen.css, /min-width: 14em/);
});

test('the HUD source says the strip item is capped at 64px (Story Block\'s max-height), not 48px', () => {
    const source = readFileSync(new URL('../../../src/v2/screens/hud.js', import.meta.url), 'utf8');
    assert.match(source, /capped at 64px/);
    assert.doesNotMatch(source, /at most 48px/);
});
