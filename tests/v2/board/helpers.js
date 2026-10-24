// Shared set-up for the board tests: a live fight on the combat part's fake bus (the combat tests'
// fake ctx: v1 startFight through combat.start, v1 replay for every view), and the board mounted in
// the v1 fake DOM with an api whose commands run on that bus and redraw the board, as a host would.
import assert from 'node:assert/strict';
import { installFakeDom } from '../../ui-fake-dom.js';
import { actor, baseDomains, createWorld, it, line } from '../combat/helpers/fake-ctx.js';
import { battleBoard, boardView } from '../../../src/v2/board/index.js';

export const hero = (over = {}) => actor(1, {
    level: 6,
    hp: { cur: 220, max: 220 }, mp: { cur: 60, max: 60 }, sp: { cur: 60, max: 60 },
    stats: { STR: 16, VIT: 14, AGI: 14, DEX: 14, INT: 8, LUK: 8, CHA: 8 },
    ...over,
});

const POTION = 'story/minor-healing-draught';

/** A world with a fight under way against `foes` (an encounter name), the hero carrying two potions. */
// (RB-fix1: even, not weak: three even foes keep v1's numbers under the headcount budget, B-b4-11,
// so the fixture's fight is the one these tests were written for.)
export function liveFight(foes = '3 Cellar Rats', labels = { tier: 'even' }, { actors = [hero()] } = {}) {
    const defs = { [POTION]: { id: POTION, name: 'Minor Healing Draught', kind: 'consumable', rarity: 'common', value: 5, stack: true, slot: null, stats: {}, effect: { heal: 20 }, tags: [], note: '' } };
    const stacks = { [it(1)]: { id: it(1), def: POTION, qty: 2, owner: 'party', equipped: null, note: '', from: '' } };
    const world = createWorld({ domains: baseDomains({ actors, defs, stacks }) });
    const captured = world.capture(line('!', 'encounter', foes, 'out of the dark', labels));
    assert.equal(captured.ok, true, captured.message);
    const started = world.run('combat.start', { offer: Object.values(world.state.domains.combat.offers)[0].id });
    assert.equal(started.ok, true, started.message);
    return world;
}

/** The board's view of a world's head state (the query as the module runs it: with tools). */
export function boardOf(world, state = world.state) {
    const tools = { query: (name, args) => (name === 'inventory.currency' ? { name: 'gold', short: 'g' } : world.query(name, args, state)) };
    return boardView(state, {}, tools);
}

/**
 * The board drawn into a fresh fake document. `view(world)` picks what it is given (default: the
 * combat.board view); every command runs on the world, then the board gets the new view.
 */
export function mount(world, { view = boardOf, extraApi = {}, withHead = true } = {}) {
    const doc = installFakeDom();
    if (withHead) doc.head = doc.createElement('head');
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const sent = [];
    let handle = null;
    const api = {
        command(type, payload) {
            sent.push([type, structuredClone(payload)]);
            const result = world ? world.run(type, payload) : { ok: true };
            if (world && result.ok) handle.update({ value: view(world) });
            return result;
        },
        ...extraApi,
    };
    handle = battleBoard.render(el, { value: world ? view(world) : null }, api);
    return { doc, el, sent, api, handle, root: () => el.querySelector('.rpg-bb') };
}

export const buttons = el => el.querySelectorAll('button');
export const labels = el => buttons(el).map(node => node.textContent);
export const byAct = (el, kind) => el.querySelector(`[data-act="${kind}"]`);
export const byText = (el, text) => buttons(el).find(node => node.textContent === text);
export const enemyCards = el => el.querySelectorAll('.rpg-bb-card[data-side="enemy"]');
