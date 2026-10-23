// The EQUIPMENT tiles' widget (src/v2/screens/equipment.js, UI 8f): a filled tile is marked by one tap (red, "Tap again to
// take off", aria-pressed), a second tap within ARM_MS takes the piece off (item.unequip { stack }); tapping elsewhere,
// Escape, leaving the tile or the timeout unmarks it; an empty tile is inert. The member's fold button is the second
// widget here: aria-expanded, a chevron, the card's data-open, kept per chat and member in localStorage.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
    ARM_MS, EQUIPMENT_HELP, EQUIPMENT_WIDGET, MEMBER_TOGGLE_WIDGET, equipmentWidget, memberToggleWidget,
    renderEquipment, renderMemberToggle,
} from '../../../src/v2/screens/equipment.js';
import { installDom } from './helpers/dom.js';

const filled = (overrides = {}) => ({
    key: 'weapon', group: 'weapon', label: 'Main hand', filled: true, empty: false, extra: false, stack: 's1',
    name: 'Iron Dagger +2', stats: 'ATK +3', why: '', cond: 'Worn 52/100', condTone: 'warn', condBroken: false,
    meter: true, cur: 52, max: 100, note: '', ...overrides,
});
const empty = (label = 'Off hand', note = '') => ({
    key: label.toLowerCase().replace(/\W+/g, '-'), group: 'offhand', label, filled: false, empty: true, extra: false, stack: '',
    name: '', stats: '', why: '', cond: '', condTone: '', condBroken: false, meter: false, cur: 0, max: 0, note,
});

function setup(tiles, props = {}) {
    const doc = installDom();
    const el = doc.createElement('ss-widget');
    doc.body.appendChild(el);
    const api = { command: (type, payload) => { commands.push({ type, payload }); } };
    const commands = [];
    const instance = renderEquipment(el, { value: tiles, label: 'Equipment of Ren', ...props }, api);
    return { doc, el, root: el.querySelector('.rpg-eq'), instance, commands, api };
}
const tileNodes = el => el.querySelectorAll('.rpg-eq-tile');
const filledNodes = el => el.querySelectorAll('button.rpg-eq-tile');
const live = el => el.querySelector('.rpg-eq-live').textContent;

test('equipment: one tile per slot, labelled as the card names them, with the help line under the grid', () => {
    const { el, root } = setup([filled(), empty('Off hand'), empty('Body'), empty('Worn'), empty('Accessory 1'), empty('Accessory 2')]);
    assert.equal(root.getAttribute('role'), 'group');
    assert.equal(root.getAttribute('aria-label'), 'Equipment of Ren');
    assert.deepEqual(tileNodes(el).map(node => node.querySelector('.rpg-eq-slot').textContent), ['Main hand', 'Off hand', 'Body', 'Worn', 'Accessory 1', 'Accessory 2']);
    assert.equal(el.querySelector('.rpg-eq-help').textContent, EQUIPMENT_HELP);
    assert.equal(EQUIPMENT_HELP, 'Tap a piece once to mark it, tap again to take it off. Equip from Inventory.');
    assert.equal(el.querySelector('.rpg-eq-live').getAttribute('aria-live'), 'polite');
});

test('equipment: a filled tile is a button with the slot, the name, the stats and the condition bar, and nothing else', () => {
    const { el } = setup([filled()]);
    const [node] = filledNodes(el);
    assert.equal(node.getAttribute('type'), 'button');
    assert.equal(node.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(node.children.map(child => child.className.split(' ')[0]), ['rpg-eq-slot', 'rpg-eq-name', 'rpg-eq-sub', 'rpg-eq-cond']);
    assert.equal(node.querySelector('.rpg-eq-name').textContent, 'Iron Dagger +2');
    assert.equal(node.querySelector('.rpg-eq-sub').textContent, 'ATK +3');
    const cond = node.querySelector('.rpg-eq-cond');
    assert.ok(cond.classList.contains('ss-tone-warn'));
    assert.equal(cond.getAttribute('title'), 'Worn 52/100');
    assert.equal(cond.querySelector('.rpg-eq-bar').getAttribute('style'), '--rpg-ratio: 0.52');
    assert.equal(node.querySelectorAll('button').length, 0, 'no buttons on a tile (no Take off, Give or Drop)');
});

test('equipment: a broken piece is red; a piece without wear has no condition bar; a worn-out count is clamped', () => {
    const { el } = setup([
        filled({ key: 'accessory-1', group: 'accessory', label: 'Accessory 1', stack: 'a1', condTone: 'bad', condBroken: true, cond: 'Broken 0/100', cur: 0 }),
        filled({ key: 'armour', group: 'armour', label: 'Body', stack: 'b1', meter: false, cond: '', condTone: '', condBroken: false, cur: 0, max: 0 }),
        filled({ key: 'worn-1', group: 'worn', label: 'Worn', stack: 'w1', cur: 150, max: 100 }),
    ]);
    const [broken, plain, over] = filledNodes(el);
    const cond = broken.querySelector('.rpg-eq-cond');
    assert.ok(cond.classList.contains('broken') && cond.classList.contains('ss-tone-bad'));
    assert.equal(plain.querySelector('.rpg-eq-cond'), null);
    assert.equal(over.querySelector('.rpg-eq-bar').getAttribute('style'), '--rpg-ratio: 1');
});

test('equipment: an empty tile reads Empty, muted, and is inert; a note (Two-handed) is its text', () => {
    const { el, commands } = setup([empty('Off hand', 'Two-handed'), empty('Body')]);
    const [off, body] = tileNodes(el);
    assert.equal(off.querySelector('.rpg-eq-name').textContent, 'Two-handed');
    assert.ok(off.classList.contains('note'));
    assert.equal(body.querySelector('.rpg-eq-name').textContent, 'Empty');
    assert.equal(off.tagName.toLowerCase(), 'div');
    assert.equal(off.getAttribute('aria-pressed'), null);
    off.dispatch('click');
    off.dispatch('click');
    assert.deepEqual(commands, [], 'an empty tile sends nothing');
    assert.equal(live(el), '');
    assert.equal(off.classList.contains('armed'), false);
});

test('equipment: a piece the rules do not count is dashed and says why in its title', () => {
    const { el } = setup([filled({ key: 'extra-h1', group: 'worn', label: 'Worn', stack: 'h1', extra: true, why: 'no worn pieces count' })]);
    const [node] = filledNodes(el);
    assert.ok(node.classList.contains('extra'));
    assert.equal(node.getAttribute('title'), 'no worn pieces count');
});

test('equipment: one tap marks a filled tile (red, "Tap again to take off", aria-pressed) and sends nothing yet', () => {
    const { el, commands } = setup([filled()]);
    const [node] = filledNodes(el);
    node.dispatch('click');
    assert.ok(node.classList.contains('armed'));
    assert.equal(filledNodes(el)[0], node, 'the same tile stays in place, so keyboard focus stays on it');
    assert.equal(node.getAttribute('aria-pressed'), 'true');
    assert.equal(node.querySelector('.rpg-eq-sub').textContent, 'Tap again to take off');
    assert.equal(live(el), 'Tap again to take Iron Dagger +2 off', 'the confirm text is announced');
    assert.deepEqual(commands, []);
});

test('equipment: a second tap within the window takes the piece off with item.unequip { stack }, the same payload as before', () => {
    const { el, commands } = setup([filled()]);
    const [node] = filledNodes(el);
    node.dispatch('click');
    node.dispatch('click');
    assert.deepEqual(commands, [{ type: 'item.unequip', payload: { stack: 's1' } }]);
    assert.equal(node.classList.contains('armed'), false);
    assert.equal(live(el), '');
});

test('equipment: the mark lapses after ARM_MS, so a later tap is a first tap again', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { el, commands } = setup([filled()]);
        const [node] = filledNodes(el);
        node.dispatch('click');
        mock.timers.tick(ARM_MS - 1);
        assert.ok(node.classList.contains('armed'), 'still marked just before the window ends');
        mock.timers.tick(1);
        assert.equal(node.classList.contains('armed'), false, 'unmarked when the window ends');
        assert.equal(live(el), '');
        node.dispatch('click');
        assert.ok(node.classList.contains('armed'), 'a tap after the lapse marks again');
        assert.deepEqual(commands, [], 'and takes nothing');
    } finally {
        mock.timers.reset();
    }
});

test('equipment: Escape unmarks the tile', () => {
    const { el, commands } = setup([filled()]);
    const [node] = filledNodes(el);
    node.dispatch('click');
    node.dispatch('keydown', { key: 'Escape' });
    assert.equal(node.classList.contains('armed'), false);
    node.dispatch('click');
    assert.deepEqual(commands, [], 'the next tap is a first tap');
});

test('equipment: a tap elsewhere on the page unmarks the tile', () => {
    const { doc, el, commands } = setup([filled()]);
    const [node] = filledNodes(el);
    node.dispatch('click');
    const elsewhere = doc.createElement('button');
    doc.body.appendChild(elsewhere);
    elsewhere.dispatch('pointerdown');
    assert.equal(node.classList.contains('armed'), false);
    assert.equal(live(el), '');
    assert.deepEqual(commands, []);
});

test('equipment: focus leaving the tile unmarks it; focus moving inside it does not', () => {
    const { el, commands } = setup([filled()]);
    const [node] = filledNodes(el);
    node.dispatch('click');
    node.dispatch('focusout', { relatedTarget: node.querySelector('.rpg-eq-name') });
    assert.ok(node.classList.contains('armed'), 'focus within the tile keeps the mark');
    node.dispatch('focusout', { relatedTarget: null });
    assert.equal(node.classList.contains('armed'), false);
    assert.deepEqual(commands, []);
});

test('equipment: an update that removes the marked piece clears the mark; one that keeps it keeps it', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { el, instance } = setup([filled()]);
        filledNodes(el)[0].dispatch('click');
        instance.update({ value: [filled({ name: 'Iron Dagger +2', cur: 40 })] });
        assert.ok(filledNodes(el)[0].classList.contains('armed'), 'the same piece stays marked');
        instance.update({ value: [empty('Main hand')] });
        assert.equal(filledNodes(el).length, 0);
        assert.equal(live(el), '');
        mock.timers.tick(ARM_MS);
    } finally {
        mock.timers.reset();
    }
});

test('equipment: destroy clears the window and leaves nothing behind', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { el, instance, commands } = setup([filled()]);
        filledNodes(el)[0].dispatch('click');
        instance.destroy();
        mock.timers.tick(ARM_MS * 2);
        assert.deepEqual(commands, []);
        assert.equal(el.querySelector('.rpg-eq'), null);
    } finally {
        mock.timers.reset();
    }
});

test('equipment: the widget validates its tiles as a list', () => {
    assert.deepEqual(equipmentWidget.validate({ value: [] }), []);
    assert.deepEqual(equipmentWidget.validate({}), []);
    assert.equal(equipmentWidget.validate({ value: 'x' }).length, 1);
    assert.equal(EQUIPMENT_WIDGET, 'rpg-battle.equipment');
});

// ---------------------------------------------------------------------------------------------------
// The member's fold button

// fn(storage, ctx): ctx.chat is the chat the viewer is in (SillyTavern's context), changed by the test as needed.
function withStorage(fn, { chat = 'chat-a', storage = new Map(), throws = false } = {}) {
    const saved = {
        storage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
        st: Object.getOwnPropertyDescriptor(globalThis, 'SillyTavern'),
    };
    const ctx = { chat };
    Object.defineProperty(globalThis, 'SillyTavern', { configurable: true, value: { getContext: () => ({ chatId: ctx.chat }) } });
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
            if (throws) throw new Error('storage is blocked');
            return {
                getItem: key => (storage.has(key) ? storage.get(key) : null),
                setItem: (key, value) => { storage.set(key, String(value)); },
            };
        },
    });
    try {
        return fn(storage, ctx);
    } finally {
        for (const [name, descriptor] of Object.entries({ localStorage: saved.storage, SillyTavern: saved.st })) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
}

function toggle(props) {
    const doc = installDom();
    const article = doc.createElement('article');
    article.className = 'actor';
    doc.body.appendChild(article);
    const head = doc.createElement('header');
    article.appendChild(head);
    const el = doc.createElement('ss-widget');
    head.appendChild(el);
    const instance = renderMemberToggle(el, props);
    return { article, button: el.querySelector('.rpg-toggle'), instance };
}

test('member toggle: a header button with aria-expanded, a chevron, and the card\'s data-open', () => withStorage(() => {
    const { article, button } = toggle({ actor: 'ac_ren', name: 'Ren', open: true });
    assert.equal(button.getAttribute('type'), 'button');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(button.getAttribute('aria-label'), 'Hide Ren');
    assert.equal(article.getAttribute('data-open'), 'true');
    assert.equal(button.querySelector('.rpg-toggle-chev').getAttribute('aria-hidden'), 'true');
    const folded = toggle({ actor: 'ac_lyra', name: 'Lyra', open: false });
    assert.equal(folded.button.getAttribute('aria-expanded'), 'false');
    assert.equal(folded.button.getAttribute('aria-label'), 'Show Lyra');
    assert.equal(folded.article.getAttribute('data-open'), 'false');
}));

test('member toggle: a tap folds or opens the card and keeps the choice for this chat and member only', () => withStorage((storage) => {
    const { article, button } = toggle({ actor: 'ac_ren', name: 'Ren', open: true });
    button.dispatch('click');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(article.getAttribute('data-open'), 'false');
    assert.equal(storage.get('rb.party.open:chat-a:ac_ren'), '0');
    // The same member in this chat opens folded now, whatever the default says.
    assert.equal(toggle({ actor: 'ac_ren', name: 'Ren', open: true }).button.getAttribute('aria-expanded'), 'false');
    // Another member, or the same member in another chat, keeps the default.
    assert.equal(toggle({ actor: 'ac_lyra', name: 'Lyra', open: false }).button.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle({ actor: 'ac_ren', name: 'Ren', open: true }).button.getAttribute('aria-expanded'), 'false');
    assert.equal(storage.has('rb.party.open:chat-a:ac_lyra'), false, 'nothing stored until a tap');
}, { chat: 'chat-a' }));

test('member toggle: another chat starts from the default', () => withStorage((storage, ctx) => {
    storage.set('rb.party.open:chat-a:ac_ren', '0');
    ctx.chat = 'chat-b';
    assert.equal(toggle({ actor: 'ac_ren', name: 'Ren', open: true }).button.getAttribute('aria-expanded'), 'true');
}, { chat: 'chat-a' }));

test('member toggle: with no storage the default holds and a tap still folds the card', () => withStorage(() => {
    const { article, button } = toggle({ actor: 'ac_ren', name: 'Ren', open: true });
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    button.dispatch('click');
    assert.equal(article.getAttribute('data-open'), 'false');
}, { throws: true }));

test('member toggle: update renames the button; the widget validates its open flag', () => withStorage(() => {
    const { button, instance } = toggle({ actor: 'ac_ren', name: 'Ren', open: false });
    instance.update({ name: 'Renn' });
    assert.equal(button.getAttribute('aria-label'), 'Show Renn');
    assert.deepEqual(memberToggleWidget.validate({ open: true }), []);
    assert.equal(memberToggleWidget.validate({ open: 'yes' }).length, 1);
    assert.equal(MEMBER_TOGGLE_WIDGET, 'rpg-battle.member-toggle');
}));
