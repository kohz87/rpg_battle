import test from 'node:test';
import assert from 'node:assert/strict';
import { part } from '../../../src/v2/items/index.js';
import { capItem } from '../../../src/items.js';
import { DEFAULT_RULES } from '../../../src/rules.js';
import { installFakeDom } from '../../ui-fake-dom.js';
import { makeCtx } from './helpers/fake-ctx.js';
import { LYRA, PC, makeState } from './helpers/state.js';

const deepFreeze = value => {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
};

// ---------------------------------------------------------------------------------------
// Queries

test('items.usable lists what helps outside a fight, and whether a dose would help them now', () => {
    const state = deepFreeze(makeState());
    const ren = part.queries['items.usable'](state, { actor: PC });
    assert.deepEqual(ren.map(row => [row.stack, row.helps]), [['it_antidot1', false], ['it_draught1', true], ['it_tonic001', true]]);
    assert.deepEqual(ren[1], { stack: 'it_draught1', def: 'story/minor-healing-draught', name: 'Minor Healing Draught', qty: 2, owner: 'party', effect: { heal: 20, mp: 0, cure: [] }, helps: true });
    const lyra = part.queries['items.usable'](state, { actor: LYRA });
    assert.deepEqual(lyra.map(row => [row.stack, row.helps]), [['it_antidot1', true], ['it_draught1', false], ['it_lyradr01', false], ['it_tonic001', false]]);
    // Everyone's, without an actor; never the flask, the empty stack or a stranger's.
    assert.deepEqual(part.queries['items.usable'](state, {}).map(row => row.stack), ['it_antidot1', 'it_draught1', 'it_lyradr01', 'it_tonic001']);
    assert.deepEqual(part.queries['items.usable'](state, { actor: 'ac_nobody01' }), []);
});

test('items.gear: what is worn, capped at the wearer\'s level, one piece to a slot', () => {
    const state = makeState();
    state.domains.inventory.stacks.it_stars001.equipped = 'weapon';
    state.domains.inventory.stacks.it_charm001.equipped = 'accessory-1';
    deepFreeze(state);
    const gear = part.queries['items.gear'](state, { settings: {} });
    assert.equal(gear.actor, PC);
    assert.equal(gear.level, 3);
    const defs = state.domains.inventory.defs;
    // The first weapon by stack id counts: the Iron Dagger before the Starsteel Sword.
    assert.deepEqual(gear.counted.map(row => row.stack), ['it_dagger01', 'it_buckle01', 'it_boots001', 'it_charm001', 'it_ring0001']);
    assert.deepEqual(gear.unused.map(row => [row.stack, row.why]), [['it_ring0002', 'only 2 accessories count'], ['it_stars001', 'one weapon counts']]);
    const dagger = gear.counted[0];
    assert.deepEqual(dagger.stats, capItem({ name: 'Iron Dagger', slot: 'weapon', rarity: 'common', stats: defs['story/iron-dagger'].stats }, 3, DEFAULT_RULES).stats);
    assert.equal(gear.bonuses.ATK, dagger.stats.ATK);
    assert.equal(part.queries['items.gear'](state, { actor: LYRA, settings: {} }).counted.length, 0);
    assert.equal(part.queries['items.gear'](state, { actor: 'ac_nobody01', settings: {} }), null);
    // The eight slots fix what counts: a rules file's old `gear` numbers change nothing.
    assert.equal(part.queries['items.gear'](state, { settings: { gear: { accessories: 3 } } }).unused.length, 2);
});

test('after a command the queries see the new head state', () => {
    const h = makeCtx({ state: makeState(), handlers: part.commands, queries: part.queries });
    h.run('item.use', { stack: 'it_tonic001' });
    const state = h.state();
    assert.equal(part.queries['items.usable'](state, { actor: PC }).some(row => row.stack === 'it_tonic001'), false);
});

// ---------------------------------------------------------------------------------------
// The Items page (a minimal renderer; the screens are being redesigned)

function page(state = makeState()) {
    const doc = installFakeDom();
    const h = makeCtx({ state, handlers: part.commands, queries: part.queries });
    const sent = [];
    const api = {
        command: (type, payload, options) => {
            sent.push({ type, payload, options });
            return h.run(type, payload);
        },
        view: () => ({ state: h.state() }),
    };
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const [tab] = part.tabs;
    tab.render(el, { state: h.state() }, api);
    return { doc, el, h, api, sent };
}

const row = (el, stack) => el.querySelector(`.rb-item[data-stack="${stack}"]`);
const buttons = node => node.querySelectorAll('button').map(button => button.textContent);
const settle = () => new Promise(resolve => setImmediate(resolve));

test('the Items tab is registered as items / Items / fa-flask', () => {
    assert.equal(part.tabs.length, 1);
    const [tab] = part.tabs;
    assert.equal(tab.id, 'items');
    assert.equal(tab.title, 'Items');
    assert.equal(tab.icon, 'fa-flask');
    assert.equal(typeof tab.render, 'function');
});

test('Items page: a row per party thing with Equip or Take off, and Give; no Use (MODULES §F96)', () => {
    const { el } = page();
    assert.deepEqual(buttons(row(el, 'it_draught1')), ['Give']);
    assert.deepEqual(buttons(row(el, 'it_blade001')), ['Equip', 'Give']);
    assert.deepEqual(buttons(row(el, 'it_dagger01')), ['Take off', 'Give']);
    assert.deepEqual(buttons(row(el, 'it_rope0001')), ['Give']);
    assert.deepEqual(buttons(row(el, 'it_flask001')), ['Give']);
    assert.equal(row(el, 'it_draught1').querySelector('[data-act="item.use"]'), null);
    assert.equal(row(el, 'it_empty001'), null);
    assert.equal(row(el, 'it_npc00001'), null);
    assert.match(row(el, 'it_draught1').querySelector('.rb-item-name').textContent, /^Minor Healing Draught ×2 · shared$/);
    assert.match(row(el, 'it_lyradr01').textContent, /Lyra/);
    // Give among the others.
    assert.deepEqual(row(el, 'it_draught1').querySelector('.rb-item-to').querySelectorAll('option').map(option => option.value), [LYRA]);
    assert.deepEqual(row(el, 'it_lyradr01').querySelector('.rb-item-to').querySelectorAll('option').map(option => option.value), [PC]);
});

test('Items page: Equip and Give send their commands', async () => {
    const { el, sent } = page();
    row(el, 'it_blade001').querySelector('[data-act="item.equip"]').click();
    await settle();
    assert.deepEqual(sent[0].payload, { stack: 'it_blade001' });
    assert.deepEqual(buttons(row(el, 'it_blade001')), ['Take off', 'Give']);
    row(el, 'it_blade001').querySelector('[data-act="item.give"]').click();
    await settle();
    assert.deepEqual(sent[1], { type: 'item.give', payload: { stack: 'it_blade001', to: LYRA }, options: { cause: 'ui' } });
    assert.match(row(el, 'it_blade001').textContent, /· Lyra/);
});

test('Items page: an empty party bag says so; no host and no api says Story Block is not ready', async () => {
    const doc = installFakeDom();
    const el = doc.createElement('div');
    const state = makeState();
    state.domains.inventory.stacks = {};
    part.tabs[0].render(el, { state }, {});
    assert.equal(el.querySelector('.rb-items-empty').textContent, 'The party carries nothing to use, wear or give.');
    const full = makeState();
    part.tabs[0].render(el, { state: full }, {});
    row(el, 'it_blade001').querySelector('[data-act="item.equip"]').click();
    await settle();
    assert.equal(el.querySelector('.rb-items-status').textContent, 'Story Block is not ready.');
});
