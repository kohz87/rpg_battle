// The skill tree widget (src/v2/screens/skill-tree.js): a view of a node list. A branching tree (1 → 3 → 2 each),
// with mixed states, is drawn as tiers with a line from each parent to its children, and as an indented list
// with "from <parent>" on a phone. Its states, labels, locked and closed hints, the detail card and the Use /
// Set aside button are checked in the DOM. Nothing here decides what a skill can do.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NODE_NAME_MAX, NODE_STATES, SKILL_TREE_CSS, TREE_GRID_LEAVES_MAX, normalizeNodes, nodeHint, nodeLabel, renderSkillTree, skillTree, tierGroups, treeLayout, treeLinks,
} from '../../../src/v2/screens/skill-tree.js';
import { installDom } from './helpers/dom.js';

const all = (root, selector) => [...root.querySelectorAll(selector)];
const text = node => node?.textContent ?? '';

/** The fixture: Focus (tier 1, maxed) → Fire (learned), Ice (closed: Fire chosen), Wind (available); each with two children. */
function branchingTree() {
    return [
        { id: 'focus', name: 'Focus', icon: 'fa-bullseye', tier: 1, level: 5, max: 5, uses: 5, state: 'maxed', requires: [], hint: 'Lv 5 · top level', inUse: true, kind: 'magic', facts: ['Costs 4 MP'] },
        { id: 'fire', name: 'Fire', icon: 'fa-fire', tier: 2, level: 2, max: 5, uses: 3, state: 'learned', requires: ['focus'], hint: 'Lv 2 · 2/5 uses to Lv 3', inUse: true },
        { id: 'ice', name: 'Ice', icon: 'fa-snowflake', tier: 2, level: 0, max: 5, uses: 0, state: 'closed', requires: ['focus'], closedBy: 'fire', inUse: null },
        { id: 'wind', name: 'Wind', icon: 'fa-wind', tier: 2, level: 0, max: 5, uses: 0, state: 'available', requires: ['focus'], hint: 'Unlocked, not used yet', inUse: false },
        { id: 'inferno', name: 'Inferno', icon: 'fa-fire-flame-curved', tier: 3, level: 0, max: 5, uses: 0, state: 'locked', requires: ['fire'], inUse: null },
        { id: 'pyre', name: 'Pyre', icon: 'fa-fire', tier: 3, level: 0, max: 5, uses: 0, state: 'locked', requires: ['fire'], inUse: null },
        { id: 'ice-lance', name: 'Ice Lance', icon: 'fa-icicles', tier: 3, level: 0, max: 5, uses: 0, state: 'closed', requires: ['ice'], closedBy: 'fire', inUse: null },
        { id: 'frost-nova', name: 'Frost Nova', icon: 'fa-snowflake', tier: 3, level: 0, max: 5, uses: 0, state: 'closed', requires: ['ice'], closedBy: 'fire', inUse: null },
        { id: 'gale', name: 'Gale', icon: 'fa-wind', tier: 3, level: 0, max: 5, uses: 0, state: 'locked', requires: ['wind'], inUse: null },
        { id: 'storm', name: 'Storm', icon: 'fa-cloud-bolt', tier: 3, level: 0, max: 5, uses: 0, state: 'locked', requires: ['wind'], inUse: null },
    ];
}

function mount(props, api = {}) {
    const doc = installDom();
    const el = doc.createElement('div');
    doc.body.append(el);
    const handle = renderSkillTree(el, props, api);
    return { doc, el, handle, root: el.querySelector('.rpg-tree') };
}

test('the widget is registered under its own name, and its node list is the bound value', () => {
    assert.equal(skillTree.render, renderSkillTree);
    assert.deepEqual(skillTree.validate({ value: 'nope' }), ['value must be a list of skills.']);
    assert.deepEqual(skillTree.validate({ value: [] }), []);
    assert.deepEqual(NODE_STATES, ['locked', 'available', 'learned', 'maxed', 'closed']);
});

test('normalizeNodes: bad entries dropped, an unknown state read as available, requires only of listed nodes, never of itself', () => {
    const nodes = normalizeNodes([
        { id: 'a', name: 'A', tier: 1, state: 'weird', requires: ['a', 'ghost'] },
        { id: 'a', name: 'A again' },
        'nonsense',
        { id: 'b', tier: 2, state: 'closed', requires: ['a'], closedBy: 'ghost' },
    ]);
    assert.deepEqual(nodes.map(node => node.id), ['a', 'b']);
    assert.equal(nodes[0].state, 'available');
    assert.deepEqual(nodes[0].requires, []);
    assert.deepEqual(nodes[1].requires, ['a']);
    assert.equal(nodes[1].closedBy, '', 'a chosen path that is not in the list is dropped');
    assert.equal(normalizeNodes([{ id: 'x'.repeat(300), name: 'n'.repeat(300) }])[0].name.length, 80);
});

test('treeLayout: a 1 → 3 → 2-each tree has six leaves, each parent sits over its children, and the root over all of them', () => {
    const nodes = normalizeNodes(branchingTree().filter(node => node.id !== 'ice-lance' && node.id !== 'frost-nova'));
    const shape = [
        { id: 'a', name: 'a', tier: 1, requires: [] }, { id: 'b', name: 'b', tier: 2, requires: ['a'] }, { id: 'c', name: 'c', tier: 2, requires: ['a'] }, { id: 'd', name: 'd', tier: 2, requires: ['a'] },
        { id: 'e', name: 'e', tier: 3, requires: ['b'] }, { id: 'f', name: 'f', tier: 3, requires: ['b'] }, { id: 'g', name: 'g', tier: 3, requires: ['c'] }, { id: 'h', name: 'h', tier: 3, requires: ['c'] },
        { id: 'i', name: 'i', tier: 3, requires: ['d'] }, { id: 'j', name: 'j', tier: 3, requires: ['d'] },
    ].map(node => ({ ...node, level: 0, max: 5, uses: 0, state: 'locked', inUse: null }));
    const layout = treeLayout(normalizeNodes(shape));
    assert.equal(layout.leaves, 6);
    const x = id => layout.x.get(id);
    assert.ok(Math.abs((x('e') + x('f')) / 2 - x('b')) < 1e-9, 'b sits over e and f');
    assert.ok(Math.abs((x('g') + x('h')) / 2 - x('c')) < 1e-9, 'c sits over g and h');
    assert.ok(Math.abs((x('i') + x('j')) / 2 - x('d')) < 1e-9, 'd sits over i and j');
    assert.ok(Math.abs((x('b') + x('c') + x('d')) / 3 - x('a')) < 1e-9, 'a sits over its three branches');
    const xs = ['e', 'f', 'g', 'h', 'i', 'j'].map(x);
    assert.deepEqual(xs, [...xs].sort((p, q) => p - q), 'the leaves go left to right in branch order: no crossing');
    assert.deepEqual(layout.order.map(entry => [entry.id, entry.depth]), [['a', 0], ['b', 1], ['e', 2], ['f', 2], ['c', 1], ['g', 2], ['h', 2], ['d', 1], ['i', 2], ['j', 2]]);
});

test('treeLayout and treeLinks: a cycle in the data is cut, no node is lost, and a flat list has no lines', () => {
    const cycle = normalizeNodes([{ id: 'p', tier: 1, requires: ['q'] }, { id: 'q', tier: 2, requires: ['p'] }]);
    const layout = treeLayout(cycle);
    assert.equal(layout.order.length, 2);
    assert.ok(layout.leaves >= 1);
    assert.deepEqual(treeLinks(normalizeNodes([{ id: 'x', tier: 1 }, { id: 'y', tier: 1 }])), []);
});

test('the fan-out is drawn: one line from each parent to each child, with the child\'s state; the states are visibly named', () => {
    const { root } = mount({ value: branchingTree(), label: 'Skills of Ren', actor: 'ac_ren00001', setCommand: 'party.setSkillActive' }, { command: () => ({ ok: true }) });
    assert.equal(root.getAttribute('data-grid'), 'yes', 'six leaves fit the grid');
    const paths = all(root, 'path.rpg-tree-link').map(path => [path.getAttribute('data-from'), path.getAttribute('data-to'), path.getAttribute('data-state')]);
    assert.equal(paths.length, 9, 'three from Focus, two from each of Fire, Ice and Wind');
    assert.deepEqual(paths.filter(([from]) => from === 'focus').map(([, to]) => to), ['fire', 'ice', 'wind']);
    assert.deepEqual(paths.filter(([from]) => from === 'fire').map(([, to]) => to), ['inferno', 'pyre']);
    assert.deepEqual(paths.filter(([from]) => from === 'ice').map(([, to]) => to), ['ice-lance', 'frost-nova']);
    assert.deepEqual(paths.filter(([from]) => from === 'wind').map(([, to]) => to), ['gale', 'storm']);
    assert.ok(all(root, '.rpg-tree-links').every(svg => svg.namespaceURI === 'http://www.w3.org/2000/svg'), 'the lines are SVG nodes, built with createElementNS');
    assert.equal(all(root, '.rpg-tree-links')[0].getAttribute('aria-hidden'), 'true');

    const label = id => all(root, '.rpg-tree-grid [data-id]').find(node => node.getAttribute('data-id') === id).getAttribute('aria-label');
    assert.equal(label('focus'), 'Focus, level 5 of 5, maxed, in use');
    assert.equal(label('fire'), 'Fire, level 2 of 5, learned, in use');
    assert.equal(label('wind'), 'Wind, available, set aside');
    assert.equal(label('ice'), 'Ice, closed: Fire path chosen');
    assert.equal(label('ice-lance'), 'Ice Lance, closed: Fire path chosen', 'the example from the design: closed names the path that was chosen');
    assert.equal(label('inferno'), 'Inferno, locked, Unlocks when Fire reaches its cap');
});

test('each state has its own class, and a closed tile is not a locked one', () => {
    const { root } = mount({ value: branchingTree() });
    const tile = id => all(root, '.rpg-tree-grid [data-id]').find(node => node.getAttribute('data-id') === id);
    assert.ok(tile('focus').classList.contains('rpg-tree-maxed'));
    assert.ok(tile('fire').classList.contains('rpg-tree-learned'));
    assert.ok(tile('wind').classList.contains('rpg-tree-available'));
    assert.ok(tile('inferno').classList.contains('rpg-tree-locked'));
    assert.ok(tile('ice').classList.contains('rpg-tree-closed'));
    assert.ok(!tile('ice').classList.contains('rpg-tree-locked'));
    assert.equal(tile('inferno').getAttribute('role'), 'group', 'a locked tile is a named group, not a button');
    assert.equal(tile('ice').getAttribute('type'), 'button', 'a closed tile is a button (its detail says what was chosen)');
    assert.equal(tile('ice').getAttribute('aria-pressed'), 'false');
    assert.equal(tile('focus').getAttribute('aria-pressed'), 'true', 'the first tier\'s first node starts chosen');
});

test('the locked hint and the closed hint are in the list line and in the detail card, as text', () => {
    const { root } = mount({ value: branchingTree(), setCommand: 'party.setSkillActive', actor: 'ac_ren00001' }, { command: () => ({ ok: true }) });
    const line = id => all(root, '.rpg-tree-list .rpg-tree-line').find(node => node.getAttribute('data-id') === id);
    assert.equal(text(line('inferno').querySelector('.rpg-tree-line-hint')), 'Unlocks when Fire reaches its cap');
    assert.equal(text(line('ice-lance').querySelector('.rpg-tree-line-hint')), 'Fire path chosen');
    assert.equal(text(line('inferno').querySelector('.rpg-tree-line-from')), 'from Fire');
    all(root, '.rpg-tree-grid [data-id]').find(node => node.getAttribute('data-id') === 'ice').click();
    assert.equal(text(root.querySelector('.rpg-tree-detail-name')), 'Ice');
    assert.equal(text(root.querySelector('.rpg-tree-detail-hint')), 'Fire path chosen');
    assert.equal(text(root.querySelector('.rpg-tree-detail-state')), 'closed');
    assert.equal(root.querySelector('.rpg-tree-go'), null, 'a closed skill has no Use / Set aside');
});

test('choosing a tile opens its detail; Use / Set aside sends the existing command with the skill\'s name', () => {
    const sent = [];
    const { root } = mount({ value: branchingTree(), actor: 'ac_ren00001', setCommand: 'party.setSkillActive' }, { command: (type, payload) => { sent.push([type, payload]); return { ok: true }; } });
    all(root, '.rpg-tree-grid [data-id]').find(node => node.getAttribute('data-id') === 'fire').click();
    assert.equal(text(root.querySelector('.rpg-tree-detail-name')), 'Fire');
    assert.equal(text(root.querySelector('.rpg-tree-detail-hint')), 'Lv 2 · 2/5 uses to Lv 3');
    assert.equal(root.querySelector('.rpg-tree-detail').getAttribute('aria-label'), 'Fire details');
    assert.equal(all(root, '.rpg-tree-grid [data-id]').find(node => node.getAttribute('data-id') === 'fire').getAttribute('aria-pressed'), 'true');
    root.querySelector('.rpg-tree-go').click();
    assert.deepEqual(sent, [['party.setSkillActive', { actor: 'ac_ren00001', name: 'fire', active: false }]]);
    const wind = all(root, '.rpg-tree-grid [data-id]').find(node => node.getAttribute('data-id') === 'wind');
    wind.click();
    assert.equal(text(root.querySelector('.rpg-tree-go')), 'Use');
    root.querySelector('.rpg-tree-go').click();
    assert.deepEqual(sent[1], ['party.setSkillActive', { actor: 'ac_ren00001', name: 'wind', active: true }]);
});

test('a phone gets the indented list with "from <parent>" and depth; the same nodes, in tree order', () => {
    const { root } = mount({ value: branchingTree() });
    const items = all(root, '.rpg-tree-list .rpg-tree-item');
    assert.deepEqual(items.map(item => item.querySelector('.rpg-tree-line-name').textContent), ['Focus', 'Fire', 'Inferno', 'Pyre', 'Ice', 'Ice Lance', 'Frost Nova', 'Wind', 'Gale', 'Storm']);
    assert.deepEqual(items.map(item => item.style.getPropertyValue('--rpg-depth')), ['0', '1', '2', '2', '1', '2', '2', '1', '2', '2']);
    assert.equal(items[0].querySelector('.rpg-tree-line-from'), null, 'the root has no parent line');
    assert.equal(text(items[7].querySelector('.rpg-tree-line-from')), 'from Focus');
});

test('a tree wider than the grid (more leaves than TREE_GRID_LEAVES_MAX) is the list only', () => {
    const many = [{ id: 'root', tier: 1, state: 'available' }];
    for (let i = 0; i < TREE_GRID_LEAVES_MAX + 1; i += 1) many.push({ id: `leaf${i}`, tier: 2, requires: ['root'], state: 'available' });
    const { root } = mount({ value: many });
    assert.equal(root.getAttribute('data-grid'), 'no');
    assert.equal(all(root, '.rpg-tree-link').length, TREE_GRID_LEAVES_MAX + 1, 'one line per child; CSS hides the grid on this tree (data-grid=no)');
});

test('today\'s skills (flat tiers, no requires) draw tier rows with no lines and no branches', () => {
    const flat = [
        { id: 'Power Strike', name: 'Power Strike', tier: 1, level: 2, max: 5, uses: 1, state: 'learned', requires: [], inUse: true },
        { id: 'Quick Stab', name: 'Quick Stab', tier: 1, level: 1, max: 5, uses: 0, state: 'available', requires: [], inUse: true },
        { id: 'Shadow Cut', name: 'Shadow Cut', tier: 0, level: 3, max: 5, uses: 2, state: 'learned', requires: [], inUse: false },
    ];
    const { root } = mount({ value: flat, label: 'Skills of Ren' });
    assert.equal(all(root, 'path').length, 0);
    assert.equal(all(root, '.rpg-tree-tier').length, 2, 'tier 1, then the story-taught one');
    assert.equal(text(all(root, '.rpg-tree-tier-label')[1]), 'Taught by the story');
    assert.equal(root.getAttribute('aria-label'), 'Skills of Ren');
    assert.equal(all(root, '.rpg-tree-link').length, 0);
});

test('a redraw of the same actor\'s tree (the screen draws it again after a command) keeps the chosen skill', () => {
    const props = { value: branchingTree(), actor: 'ac_keep_choice', label: 'Skills of Keep', setCommand: 'party.setSkillActive' };
    const first = mount(props);
    all(first.root, '.rpg-tree-grid [data-id]').find(node => node.getAttribute('data-id') === 'fire').click();
    const again = mount(props);
    assert.equal(text(again.root.querySelector('.rpg-tree-detail-name')), 'Fire', 'the new widget starts on the skill chosen before');
    const other = mount({ ...props, actor: 'ac_other_actor' });
    assert.equal(text(other.root.querySelector('.rpg-tree-detail-name')), 'Focus', 'another actor starts on its first skill');
});

test('an update keeps the chosen node when it is still there, and the list follows it', () => {
    const { root, handle } = mount({ value: branchingTree() });
    all(root, '.rpg-tree-grid [data-id]').find(node => node.getAttribute('data-id') === 'wind').click();
    handle.update({ value: branchingTree().map(node => (node.id === 'wind' ? { ...node, state: 'learned', uses: 1 } : node)) });
    assert.equal(text(root.querySelector('.rpg-tree-detail-name')), 'Wind');
    assert.equal(all(root, '.rpg-tree-grid [data-id]').find(node => node.getAttribute('data-id') === 'wind').getAttribute('aria-label'), 'Wind, learned, set aside');
});

test('the tiers are the bound list\'s, tier 1 up and the story-taught last, and the caps are named', () => {
    const groups = tierGroups(normalizeNodes(branchingTree()));
    assert.deepEqual(groups.map(group => group.title), ['Tier 1', 'Tier 2', 'Tier 3']);
    assert.deepEqual(tierGroups(normalizeNodes([{ id: 'a', tier: 0 }, { id: 'b', tier: 2 }]))[1].title, 'Taught by the story');
    assert.deepEqual(NODE_STATES.map(state => nodeLabel({ name: 'N', state, level: 0, max: 5, requires: [], inUse: null, hint: '' }, new Map())), ['N, locked', 'N, available', 'N, learned', 'N, maxed', 'N, closed: Another path was chosen']);
    assert.equal(nodeHint({ state: 'locked', requires: ['x'], hint: '' }, new Map([['x', { name: 'Fire' }]])), 'Unlocks when Fire reaches its cap');
});

test('the stylesheet marks each state with a class under the screen root (two classes of weight), and no colour is a literal', () => {
    for (const state of ['available', 'learned', 'maxed', 'locked', 'closed']) assert.ok(SKILL_TREE_CSS.includes(`.rb .rpg-tree-${state}`), state);
    assert.match(SKILL_TREE_CSS, /\.rb \.rpg-tree-closed \.ss-tile-label \{ text-decoration: line-through; \}/);
    assert.match(SKILL_TREE_CSS, /@container rb-screen \(max-width: 479\.98px\)/);
    const literal = SKILL_TREE_CSS.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi);
    assert.equal(literal, null, 'every colour comes from a token');
});

test('a 96-character skill name is cut at NODE_NAME_MAX in the tile, its label and the list; the tile\'s label wraps in the sheet', () => {
    const long = 'Supercalifragilisticexpialidocious'.repeat(3);
    const [node] = normalizeNodes([{ id: 'long', name: long, tier: 1, level: 1, max: 5, state: 'learned' }]);
    assert.equal(node.name.length, NODE_NAME_MAX);
    const { root } = mount({ value: [{ id: 'long', name: long, tier: 1, level: 1, max: 5, state: 'learned' }] });
    assert.equal(all(root, '.ss-tile-label')[0].textContent, long.slice(0, NODE_NAME_MAX));
    assert.equal(all(root, '.rpg-tree-line-name')[0].textContent, long.slice(0, NODE_NAME_MAX));
    assert.match(SKILL_TREE_CSS, /\.rpg-tree-tile \.ss-tile-label \{[^}]*overflow-wrap: anywhere;/);
    assert.match(SKILL_TREE_CSS, /\.rpg-tree-line-name \{ font-weight: 700; overflow-wrap: anywhere; \}/);
});

test('the tree\'s limits: 12 tiers of 24 tiles at most, the story-taught last', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, tier: 1, state: 'learned' }));
    const tiers = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, tier: i + 1, state: 'learned' }));
    assert.equal(tierGroups(normalizeNodes(many))[0].nodes.length, 24);
    assert.equal(tierGroups(normalizeNodes(tiers)).length, 12);
    assert.equal(tierGroups(normalizeNodes([{ id: 'a', tier: 0 }, { id: 'b', tier: 2 }])).at(-1).title, 'Taught by the story');
    assert.equal(tierGroups(normalizeNodes([{ id: 'a', tier: 1 }]))[0].title, 'Tier 1');
});
