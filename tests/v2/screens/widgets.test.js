// The screens part's own widgets (src/v2/screens/widgets.js): rpg-battle.item-detail, which Story Block's
// Inventory places in each row (MODULES §F99), and rpg-battle.character-file's save. Drawn into this
// folder's fake DOM; they build with createElement and textContent only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { itemDetail } from '../../../src/v2/screens/index.js';
import { ITEM_DETAIL_WIDGET, drawItemDetail, itemDetailWidget, renderItemDetail, saveTextFile, screenWidgets } from '../../../src/v2/screens/widgets.js';
import { installDom } from './helpers/dom.js';
import { makeState, toolsFor } from './helpers/state.js';

const text = el => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const condition = ({ stack }) => (stack === 'it_dagger01' ? { stack, band: 'broken', cur: 0, max: 100, refine: 3 } : null);

function apiFor(state, extra = {}) {
    return { query: (name, args) => toolsFor(state, undefined, extra).query(name, args) };
}

test('item-detail: a worn piece shows its slot and stats, the wearer, refinement and the condition band', () => {
    const doc = installDom();
    const el = doc.createElement('ss-widget');
    doc.body.appendChild(el);
    const state = makeState();
    renderItemDetail(el, { stack: 'it_dagger01' }, apiFor(state, { 'items.condition': condition }));
    const root = el.querySelector('.rpg-id');
    assert.equal(root.hidden, false);
    assert.equal(root.getAttribute('data-kind'), 'equipment');
    assert.deepEqual(root.querySelectorAll('.rpg-id-line').map(text), ['Weapon · ATK +3', 'Worn by Ren']);
    const refine = root.querySelector('.rpg-id-refine');
    assert.equal(text(refine), '+3');
    assert.equal(refine.getAttribute('aria-label'), 'Refined +3');
    const band = root.querySelector('.rpg-id-band');
    assert.equal(band.getAttribute('data-band'), 'broken');
    assert.equal(band.getAttribute('aria-label'), 'Condition: Broken · 0/100');
    assert.equal(band.querySelectorAll('.fa-heart-crack').length, 1);
    assert.equal(band.querySelector('.rpg-id-bar').styleProps['--rpg-ratio'], '0');
    // One base stylesheet for the document, however many are drawn.
    renderItemDetail(doc.createElement('div'), { stack: 'it_dagger01' }, apiFor(state));
    assert.equal(doc.head.querySelectorAll('style[data-rpg-screens]').length, 1);
});

test('item-detail: a draught says what it does and whom it would help; plain goods draw nothing', () => {
    const doc = installDom();
    const state = makeState();
    const el = doc.createElement('div');
    const handle = renderItemDetail(el, { stack: 'it_draught1' }, apiFor(state));
    const root = el.querySelector('.rpg-id');
    assert.equal(root.getAttribute('data-kind'), 'consumable');
    assert.deepEqual(root.querySelectorAll('.rpg-id-line').map(text), ['+20 HP · would help Ren']);
    handle.update({ stack: 'it_rope0001' });
    assert.equal(root.hidden, true);
    assert.equal(root.childNodes.length, 0);
    handle.update({ stack: 'it_gone' });
    assert.equal(root.hidden, true);
    handle.destroy();
    assert.equal(el.querySelector('.rpg-id'), null);
});

test('item-detail: a bound detail draws without asking; no query api, no stack, odd data: nothing, never an error', () => {
    const doc = installDom();
    const state = makeState();
    const root = doc.createElement('div');
    drawItemDetail(root, itemDetail(state, { stack: 'it_blade001' }, toolsFor(state, undefined, { 'items.condition': () => null })));
    assert.deepEqual(root.querySelectorAll('.rpg-id-line').map(text), ['Weapon · ATK +6, DEX +1']);
    assert.equal(root.querySelector('.rpg-id-band'), null, 'wear off: no band');
    for (const props of [{}, { stack: 'it_dagger01' }, { value: 'x' }, { stack: 7 }]) {
        const el = doc.createElement('div');
        assert.doesNotThrow(() => renderItemDetail(el, props, {}));
        assert.equal(el.querySelector('.rpg-id').hidden, true, JSON.stringify(props));
    }
    // A band name from data never becomes a class or attribute it does not know.
    drawItemDetail(root, { kind: 'equipment', slotLabel: 'Weapon', condition: { band: 'x" onclick="y', label: 'Odd' } });
    assert.equal(root.querySelector('.rpg-id-band'), null);
    assert.deepEqual(itemDetailWidget.validate({ stack: 3 }), ['stack must be a stack id (text).']);
    assert.ok(screenWidgets[ITEM_DETAIL_WIDGET]);
});

test('saveTextFile: a Blob link with the download name, clicked once and taken away', () => {
    const doc = installDom();
    const made = [];
    const revoked = [];
    let clicked = null;
    doc.defaultView = {
        Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts.type; made.push(this); } },
        URL: { createObjectURL: blob => `blob:${made.indexOf(blob)}`, revokeObjectURL: href => revoked.push(href) },
    };
    const original = doc.createElement.bind(doc);
    doc.createElement = tag => {
        const node = original(tag);
        if (tag === 'a') node.click = () => { clicked = { href: node.href, download: node.getAttribute('download'), inPage: Boolean(node.parentNode) }; };
        return node;
    };
    assert.equal(saveTextFile(doc, 'ren.rpg-battle.json', '{"v":1}'), true);
    assert.deepEqual(clicked, { href: 'blob:0', download: 'ren.rpg-battle.json', inPage: true });
    assert.deepEqual(made[0].parts, ['{"v":1}']);
    assert.equal(made[0].type, 'application/json');
    assert.equal(doc.body.querySelectorAll('a').length, 0, 'the link is gone again');
});
