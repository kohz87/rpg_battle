// The stat radar of the creation wizard (src/v2/creation/radar.js): drawn with SVG through DOM calls, one axis per
// stat, a visually hidden list of the same values, and colours only from the screen's classes (tokens).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RADAR_AXES_MAX, RADAR_RINGS_MAX, RADAR_VIEW, radarAxes, radarPoint, radarScale, renderStatRadar, statRadar,
} from '../../../src/v2/creation/radar.js';
import { createScreen } from '../../../src/v2/creation/screen.js';
import { installDom } from '../screens/helpers/dom.js';

const all = (root, selector) => [...root.querySelectorAll(selector)];
const STATS = [
    { label: 'STR', value: 7 }, { label: 'VIT', value: 7 }, { label: 'AGI', value: 4 }, { label: 'DEX', value: 5 },
    { label: 'INT', value: 7 }, { label: 'LUK', value: 5 }, { label: 'CHA', value: 5 },
];

function draw(props) {
    const doc = installDom();
    const el = doc.createElement('div');
    doc.body.append(el);
    const handle = renderStatRadar(el, props);
    return { doc, el, handle, root: el.querySelector('.rpg-radar') };
}

test('the radar is registered with its name, and the list of stats is validated in words', () => {
    assert.equal(statRadar.render, renderStatRadar);
    assert.deepEqual(statRadar.validate({ axes: 'nope' }), ['axes must be a list of stats.']);
    assert.deepEqual(statRadar.validate({ axes: STATS }), []);
});

test('one axis per stat, the first pointing up; the values are the outer edge\'s share of the scale', () => {
    const { root } = draw({ axes: STATS, label: 'Your stats', levels: 4 });
    const svg = root.querySelector('svg');
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg', 'an SVG node, built with createElementNS');
    assert.equal(svg.getAttribute('viewBox'), `0 0 ${RADAR_VIEW} ${RADAR_VIEW}`);
    assert.equal(svg.getAttribute('role'), 'img');
    assert.equal(all(root, 'line.rpg-radar-spoke').length, STATS.length);
    assert.equal(all(root, 'polygon.rpg-radar-ring').length, 4, 'four rings');
    assert.deepEqual(all(root, 'text.rpg-radar-label').map(node => node.textContent), STATS.map(stat => stat.label));
    assert.deepEqual(all(root, 'text.rpg-radar-value').map(node => node.textContent), STATS.map(stat => String(stat.value)));
    // The first axis (STR) points straight up: its outer spoke ends at the top centre.
    const [x, y] = radarPoint(0, STATS.length, 1);
    assert.ok(Math.abs(x - RADAR_VIEW / 2) < 1e-9 && y < RADAR_VIEW / 2);
    const spoke = all(root, 'line.rpg-radar-spoke')[0];
    assert.equal(spoke.getAttribute('x2'), x.toFixed(2));
    // The shape has one corner per stat.
    const shape = root.querySelector('polygon.rpg-radar-shape');
    assert.equal(shape.getAttribute('points').split(' ').length, STATS.length);
});

test('the text alternative: a visually hidden list of every stat, and the SVG is named with the same values', () => {
    const { root } = draw({ axes: STATS, label: 'Your stats' });
    const list = root.querySelector('ul.cc-sr-only');
    assert.ok(list, 'the list is in the widget, hidden by the screen\'s .cc-sr-only class');
    assert.deepEqual(all(list, 'li').map(item => item.textContent), STATS.map(stat => `${stat.label} ${stat.value}`));
    assert.equal(list.getAttribute('aria-label'), 'Your stats, as a list');
    assert.equal(root.querySelector('svg').getAttribute('aria-label'), 'Your stats: STR 7, VIT 7, AGI 4, DEX 5, INT 7, LUK 5, CHA 5');
});

test('the scale is at least RADAR_SCALE_MIN and grows with the largest stat; rings are capped', () => {
    assert.equal(radarScale([{ label: 'A', value: 3 }]), 10);
    assert.equal(radarScale([{ label: 'A', value: 14 }, { label: 'B', value: 2 }]), 14);
    const { root } = draw({ axes: STATS, levels: 99 });
    assert.equal(all(root, 'polygon.rpg-radar-ring').length, RADAR_RINGS_MAX);
    // A stat at the top of the scale reaches the outer ring.
    const top = draw({ axes: [{ label: 'A', value: 14 }, { label: 'B', value: 14 }] }).root;
    const [ax, ay] = radarPoint(0, 2, 1);
    assert.ok(top.querySelector('polygon.rpg-radar-shape').getAttribute('points').startsWith(`${ax.toFixed(2)},${ay.toFixed(2)}`));
});

test('bad axes are dropped: no label, a negative or fractional value, and past the axes limit', () => {
    const many = Array.from({ length: RADAR_AXES_MAX + 3 }, (_, i) => ({ label: `S${i}`, value: i }));
    assert.equal(radarAxes(many).length, RADAR_AXES_MAX);
    assert.deepEqual(radarAxes([{ label: '', value: 3 }, { label: 'OK', value: -2 }, { label: 'Frac', value: 2.9 }, 'nope']), [{ label: 'OK', value: 0 }, { label: 'Frac', value: 2 }]);
});

test('no stats: the radar says so and draws nothing; a stats list update redraws', () => {
    const { root, handle } = draw({ axes: [] });
    assert.equal(root.querySelector('svg'), null);
    assert.equal(root.querySelector('.rpg-radar-empty').textContent, 'No stats yet.');
    handle.update({ axes: STATS });
    assert.equal(all(root, 'text.rpg-radar-label').length, STATS.length);
});

test('the wizard\'s own CSS has no literal colour and no SillyTavern theme variable; the radar\'s colours are its classes', () => {
    const css = createScreen.css;
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|--SmartTheme|menu_button/i);
    assert.match(css, /\.rpg-radar-shape \{ fill: color-mix\(in srgb, var\(--ss-accent\) 28%, transparent\); stroke: var\(--ss-accent\)/);
});
