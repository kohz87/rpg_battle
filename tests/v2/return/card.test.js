// The widget rpg-battle.return-card against the fake DOM: hidden while your character lives;
// while dead, what happened, where Return goes and a button that rewinds and tells the cue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom, texts } from '../../ui-fake-dom.js';
import { aliveState, createHost, FIGHT, killed } from './helpers/fake-host.js';
import { isDead } from '../../../src/v2/return/index.js';

const doc = installFakeDom();
const settle = () => new Promise(resolve => setImmediate(resolve));

function deadHost(options) {
    const host = createHost(options).greeting(aliveState());
    host.user().reply('Rats.');
    host.receipt('combat.start', { session: FIGHT, offer: 'en_bbbbbbbb', made: [] });
    host.receipt('combat.end', { session: FIGHT, outcome: 'lost' }, { state: killed(host.head) });
    return host;
}

const widgetOf = host => host.part.widgets['rpg-battle.return-card'];

test('dead: what happened, the return point and Return; the click rewinds and tells the cue', async () => {
    const host = deadHost();
    const pane = doc.createElement('div');
    const api = { query: host.sdk.query, command: host.sdk.command, rewind: host.sdk.rewind };
    const handle = widgetOf(host).render(pane, {}, api);
    assert.equal(pane.children.length, 1, 'one root');
    assert.deepEqual(texts(pane, '.rpg-return-title'), ['You died']);
    assert.deepEqual(texts(pane, '.rpg-return-what'), ['Ren fell in a fight to the death at the Old Weir. The story cannot go on from here.']);
    assert.match(texts(pane, '.rpg-return-where')[0], /message #2, the moment before the fight began/);
    const go = pane.querySelector('.rpg-return-go');
    go.click();
    go.click(); // a second click while the first runs does nothing
    await settle();
    await settle();
    assert.deepEqual(host.calls.rewind, [{ index: 2, beforeRev: 2 }]);
    assert.equal(host.calls.command.length, 1);
    assert.equal(isDead(host.head), false);
    assert.deepEqual(texts(pane, '.rpg-return-status'), ['']);
    // Redrawn on the new branch: nothing to show.
    handle.update({});
    assert.equal(pane.querySelector('.rpg-return-card').hidden, true);
    assert.equal(pane.querySelector('.rpg-return-go'), null);
    handle.destroy();
    assert.equal(pane.children.length, 0);
});

test('the api without rewind: Return goes through the part\'s sdk; a refusal is shown', async () => {
    const host = deadHost({ rewindAnswer: { ok: false, code: 'FAILED', message: 'The branch could not be made.' } });
    const pane = doc.createElement('div');
    widgetOf(host).render(pane, {}, { query: host.sdk.query, command: host.sdk.command });
    pane.querySelector('.rpg-return-go').click();
    await settle();
    assert.equal(host.calls.rewind.length, 1);
    assert.deepEqual(texts(pane, '.rpg-return-status'), ['The branch could not be made.']);
    assert.equal(pane.querySelector('.rpg-return-go').disabled, false, 'can be tried again');
});

test('alive: hidden and empty; dead with no point: the way out without a button', () => {
    const alive = createHost().greeting(aliveState());
    const pane = doc.createElement('div');
    widgetOf(alive).render(pane, {}, { query: alive.sdk.query });
    assert.equal(pane.querySelector('.rpg-return-card').hidden, true);
    assert.equal(pane.querySelector('.rpg-return-card').children.length, 0);

    const dead = deadHost();
    const other = doc.createElement('div');
    widgetOf(dead).render(other, { point: null }, { query: name => (name === 'return.point' ? null : dead.sdk.query(name)) });
    assert.deepEqual(texts(other, '.rpg-return-where'), ['No moment before the fight was found. Swipe or delete back instead.']);
    assert.equal(other.querySelector('.rpg-return-go'), null);

    // A point given in props is used as it is; a broken one is no point.
    const given = doc.createElement('div');
    widgetOf(dead).render(given, { point: { index: 4, beforeRev: 9, place: 'Bluewatch', fight: FIGHT } }, { query: dead.sdk.query });
    assert.match(texts(given, '.rpg-return-where')[0], /message #4/);
    assert.match(texts(given, '.rpg-return-what')[0], /at Bluewatch\./);
    const widget = widgetOf(dead);
    assert.deepEqual(widget.validate({ point: { index: 4, beforeRev: 9, place: '', fight: FIGHT } }), []);
    assert.equal(widget.validate({ point: { index: -1 } }).length, 1);
    // No api at all: nothing thrown, nothing shown.
    const bare = doc.createElement('div');
    widget.render(bare, undefined, undefined);
    assert.equal(bare.querySelector('.rpg-return-card').hidden, true);
});

test('the card builds its DOM with createElement and textContent only', () => {
    const source = readFileSync(new URL('../../../src/v2/return/card.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|\.html\(|setAttribute\(\s*['"]on|\.on[a-z]+\s*=[^=]/);
});
