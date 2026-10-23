// The widget `rpg-battle.skill-tree` (WIDGETS.md contract): a character's skills as a tree, drawn as tiers, with a line
// from each skill to the skill it requires, and a glass card with the chosen skill's detail. Phones get the same tree as
// an indented list, each line with "from <parent>".
//
// It is a view of a node list, not of the rules. The node list is the whole input:
//
//   { id, name, icon, tier, level, max, uses, state, requires: [ids], closedBy, hint,
//     inUse: true | false | null, kind, note, facts: [text] }
//
//   id        unique within the list (today: the skill's name)
//   tier      1 and up: the row a node sits in (starting, intermediate, expert); 0 is "taught by the story", last
//   level     the level it has (0 when not learned); max is the cap (the most levels)
//   uses      the uses toward the next level (for the detail)
//   state     locked | available | learned | maxed | closed (see NODE_STATES)
//   requires  ids of the nodes it grows from: its parent. Several nodes may share a parent (a branch); a line is
//             drawn from each required node to the node. The first required node that is in the list is the parent
//             for the layout and for "from <parent>".
//   closedBy  for a closed node, the id of the node on the path that was chosen instead; its name is said
//   hint      said under the name; a locked node says what unlocks it, a closed one what was chosen (both derived)
//   inUse     true (in use), false (set aside), null (no switch): Use / Set aside shows only when it is a boolean
//   kind, note, facts   the detail card's text (a type, a description, and short lines such as a cost)
//
// States: `locked` (its requirement is not at its cap; not a button), `available` (unlocked, no uses yet), `learned`
// (some uses), `maxed` (at its cap), `closed` (another path from the same parent was chosen; a button, for its detail).
//
// Today's skills are tier-1 nodes with no requires (no lines, no branches). The screen decides the node list; this widget
// only draws it. Nothing here changes what a skill can do: the commands are the screen's (party.setSkillActive).
//
// Layout: leaves (nodes with no children) take consecutive slots across the card; a parent sits at the mean of its
// children's slots, so each branch fans out under its parent and the lines do not cross. Above TREE_GRID_LEAVES_MAX
// leaves, or in a card narrower than the grid's container query (screens' sheet, 480 px), the list shows instead.
//
// Props: value (the bound node list; `nodes` is accepted too), selected (a node id to start on), columns (the tiles per row
// of today's flat tiers, 1 to 6, kept for compatibility), label (the accessible name), actor and setCommand (the Use /
// Set aside button of the detail card: `api.command(setCommand, { actor, name: id, active })`).
//
// Built with createElement / createElementNS and textContent only: nothing from data is read as markup.

export const SKILL_TREE_WIDGET = 'rpg-battle.skill-tree';
export const NODE_STATES = Object.freeze(['locked', 'available', 'learned', 'maxed', 'closed']);
/** A tile's spoken state word and its marker icon. */
export const STATE_WORDS = Object.freeze({ locked: 'locked', available: 'available', learned: 'learned', maxed: 'maxed', closed: 'closed' });
const STATE_ICONS = Object.freeze({ locked: 'fa-lock', available: 'fa-circle-dot', learned: 'fa-check', maxed: 'fa-star', closed: 'fa-ban' });
export const SKILL_TIERS_MAX = 12;
export const SKILL_TILES_MAX = 24;
export const TREE_COLUMNS_MAX = 6;
/** The most leaves the fanned-out grid draws; more than this is the indented list (a tile is about 100 px). */
export const TREE_GRID_LEAVES_MAX = 6;
export const NODE_ID_MAX = 120;
export const NODE_NAME_MAX = 80;
export const NODE_HINT_MAX = 60;
export const NODE_KIND_MAX = 30;
export const NODE_NOTE_MAX = 400;
export const NODE_FACTS_MAX = 6;
export const NODE_FACT_MAX = 80;
export const UNTIERED_TITLE = 'Taught by the story';
export const CLOSED_FALLBACK = 'Another path was chosen';

const SVG_NS = 'http://www.w3.org/2000/svg';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cut = (value, max) => Array.from(typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '').slice(0, max).join('');
const whole = (value, fallback = 0) => (Number.isInteger(value) ? value : Number.isFinite(value) ? Math.trunc(value) : fallback);
const SKILL_LIMIT = SKILL_TIERS_MAX * SKILL_TILES_MAX;

/**
 * The node list as the widget draws it: bad entries dropped, strings cut, a state it does not know read as
 * `available`, requires only of nodes in the list (never of itself), at most SKILL_TIERS_MAX × SKILL_TILES_MAX nodes.
 */
export function normalizeNodes(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const nodes = [];
    for (const raw of list) {
        if (!isRecord(raw)) continue;
        const id = cut(raw.id, NODE_ID_MAX);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const requires = Array.isArray(raw.requires)
            ? [...new Set(raw.requires.map(entry => cut(entry, NODE_ID_MAX)).filter(entry => entry && entry !== id))]
            : [];
        nodes.push({
            id,
            name: cut(raw.name, NODE_NAME_MAX) || id,
            icon: cut(raw.icon, 60),
            tier: Math.max(0, whole(raw.tier)),
            level: Math.max(0, whole(raw.level)),
            max: Math.max(0, whole(raw.max)),
            uses: Math.max(0, whole(raw.uses)),
            state: NODE_STATES.includes(raw.state) ? raw.state : 'available',
            requires,
            closedBy: cut(raw.closedBy, NODE_ID_MAX),
            hint: cut(raw.hint, NODE_HINT_MAX),
            inUse: typeof raw.inUse === 'boolean' ? raw.inUse : null,
            kind: cut(raw.kind, NODE_KIND_MAX),
            note: cut(raw.note, NODE_NOTE_MAX),
            facts: Array.isArray(raw.facts)
                ? raw.facts.map(entry => cut(entry, NODE_FACT_MAX)).filter(Boolean).slice(0, NODE_FACTS_MAX)
                : [],
        });
        if (nodes.length >= SKILL_LIMIT) break;
    }
    const ids = new Set(nodes.map(node => node.id));
    for (const node of nodes) {
        node.requires = node.requires.filter(id => ids.has(id));
        if (node.closedBy && !ids.has(node.closedBy)) node.closedBy = '';
    }
    return nodes;
}

/** The tiers the tree draws, top to bottom: tier 1 up, the story-taught (tier 0) last; at most SKILL_TIERS_MAX of them. */
export function tierGroups(nodes) {
    const tiers = [...new Set(nodes.map(node => node.tier))].sort((a, b) => (a || 99) - (b || 99)).slice(0, SKILL_TIERS_MAX);
    return tiers.map(tier => ({
        tier,
        title: tier ? `Tier ${tier}` : UNTIERED_TITLE,
        nodes: nodes.filter(node => node.tier === tier).slice(0, SKILL_TILES_MAX),
    }));
}

/** The parent a node grows from: its first required node that is in the list (the layout's and "from"'s parent). */
export function parentOf(node, byId) {
    return node.requires.find(id => byId.has(id)) ?? null;
}

/**
 * The layout of the tree (pure). `order`: every node once, depth-first from the roots (a node with no parent), with its
 * depth and parent; `x`: each node's place across the card as a fraction (0 to 1), leaves evenly, parents at the mean of
 * their children; `leaves`: how many leaves there are. A cycle in the data is cut where it closes (no node is lost).
 */
export function treeLayout(nodes) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const children = new Map(nodes.map(node => [node.id, []]));
    for (const node of nodes) {
        const parent = parentOf(node, byId);
        if (parent) children.get(parent).push(node.id);
    }
    const roots = nodes.filter(node => !parentOf(node, byId)).map(node => node.id);

    const order = [];
    const seen = new Set();
    const visit = (id, depth, parent) => {
        if (seen.has(id)) return;
        seen.add(id);
        order.push({ id, depth, parent });
        for (const child of children.get(id)) visit(child, depth + 1, id);
    };
    for (const id of roots) visit(id, 0, null);
    for (const node of nodes) if (!seen.has(node.id)) visit(node.id, 0, null);

    const slot = new Map();
    const busy = new Set();
    let leaves = 0;
    const place = id => {
        if (slot.has(id)) return slot.get(id);
        busy.add(id);
        const kids = children.get(id).filter(kid => !busy.has(kid));
        let value;
        if (!kids.length) {
            value = leaves + 0.5;
            leaves += 1;
        } else {
            const values = kids.map(place);
            value = values.reduce((sum, item) => sum + item, 0) / values.length;
        }
        busy.delete(id);
        slot.set(id, value);
        return value;
    };
    for (const id of roots) place(id);
    for (const node of nodes) if (!slot.has(node.id)) place(node.id);
    const total = Math.max(1, leaves);
    const x = new Map([...slot].map(([id, value]) => [id, value / total]));
    return { order, x, leaves: total };
}

/** The line a node's hint says. A locked node with a requirement says what unlocks it; a closed one what was chosen. */
export function nodeHint(node, byId = new Map()) {
    if (node.state === 'locked' && node.requires.length) {
        const first = node.requires.map(id => byId.get(id)).find(Boolean);
        return first ? `Unlocks when ${first.name} reaches its cap` : 'Locked';
    }
    if (node.state === 'closed') {
        const chosen = byId.get(node.closedBy);
        return chosen ? `${chosen.name} path chosen` : node.hint || CLOSED_FALLBACK;
    }
    return node.hint;
}

/**
 * What a screen reader says for a tile: "Fire Bolt, level 2 of 5, learned, in use"; a locked one says why:
 * "Death Strike, locked, Unlocks when Fire Bolt reaches its cap"; a closed one: "Ice Lance, closed: Fire path chosen".
 */
export function nodeLabel(node, byId = new Map()) {
    if (node.state === 'closed') return `${node.name}, closed: ${nodeHint(node, byId)}`;
    const parts = [node.name];
    if (node.state === 'locked') {
        parts.push(STATE_WORDS.locked);
        const hint = nodeHint(node, byId);
        if (hint) parts.push(hint);
        return parts.join(', ');
    }
    if (node.level > 0) parts.push(`level ${node.level} of ${node.max}`);
    parts.push(STATE_WORDS[node.state]);
    if (node.inUse === true) parts.push('in use');
    if (node.inUse === false) parts.push('set aside');
    return parts.join(', ');
}

/** The lines the tree draws: one from each required node to the node that requires it, with that node's state. */
export function treeLinks(nodes) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const links = [];
    for (const node of nodes) {
        for (const from of node.requires) if (byId.has(from)) links.push({ from, to: node.id, state: node.state });
    }
    return links;
}

function make(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

/** A Font Awesome glyph (a fixed class, decorative: the tile's label says the state). */
function icon(doc, name) {
    const glyph = make(doc, 'i', `fa-solid ${/^fa-[a-z0-9-]+$/.test(name) ? name : 'fa-star'}`);
    glyph.setAttribute('aria-hidden', 'true');
    return glyph;
}

function focusQuietly(node) {
    if (!node || typeof node.focus !== 'function') return;
    try { node.focus({ preventScroll: true }); } catch { /* not focusable */ }
}

/** render(el, props, api) → { update(nextProps), destroy() }. */
export function renderSkillTree(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const view = doc.defaultView ?? globalThis;
    const root = make(doc, 'div', 'ss-w ss-w-skill-tree rpg-tree');
    el.append(root);
    let current = { ...props };
    let nodes = [];
    let selected = '';
    let controls = new Map();
    let pending = null;

    const listNodes = () => normalizeNodes(Array.isArray(current.value) ? current.value : Array.isArray(current.nodes) ? current.nodes : []);

    /** Chooses a node and keeps the keyboard where it was: the same control (the tree or the list) is focused again. */
    function select(id, clicked) {
        selected = id;
        const inTree = Boolean(clicked?.closest?.(".rpg-tree-grid"));
        draw();
        const again = [...root.querySelectorAll("[data-id]")].find(node => node.getAttribute("data-id") === id && Boolean(node.closest(".rpg-tree-grid")) === inTree);
        focusQuietly(again);
    }

    function chooseDefault() {
        if (nodes.some(node => node.id === selected)) return;
        const first = tierGroups(nodes)[0]?.nodes[0]?.id ?? '';
        selected = typeof current.selected === 'string' && nodes.some(node => node.id === current.selected) ? current.selected : first;
    }

    /** A node's control: a button (its detail on a click) unless it is locked, which is a named group. */
    function controlOf(node, byId, className) {
        const locked = node.state === 'locked';
        const control = make(doc, locked ? 'div' : 'button', className);
        control.setAttribute('data-id', node.id);
        control.setAttribute('data-state', node.state);
        control.setAttribute('data-tier', String(node.tier));
        const spoken = nodeLabel(node, byId);
        if (locked) control.setAttribute('role', 'group');
        else {
            control.setAttribute('type', 'button');
            control.setAttribute('aria-pressed', node.id === selected ? 'true' : 'false');
            control.addEventListener('click', () => select(node.id, control));
        }
        control.setAttribute('aria-label', spoken);
        control.setAttribute('title', spoken);
        if (node.id === selected) control.classList.add('rpg-tree-selected');
        return control;
    }

    function tileOf(node, byId, slot) {
        const tile = controlOf(node, byId, `ss-tile rpg-tree-tile rpg-tree-${node.state}${node.inUse === false ? ' rpg-tree-aside' : ''}`);
        if (slot) {
            tile.classList.add('rpg-tree-slot');
            tile.style.setProperty('--rpg-x', String(slot.x));
            tile.style.setProperty('--rpg-w', `${100 / slot.leaves}%`);
        }
        const box = make(doc, 'span', 'ss-tile-box');
        const glyph = node.icon && /^fa-[a-z0-9-]+$/.test(node.icon) ? icon(doc, node.icon) : null;
        const symbol = make(doc, 'span', 'ss-tile-icon');
        symbol.setAttribute('aria-hidden', 'true');
        if (glyph) symbol.append(glyph);
        else symbol.textContent = Array.from(node.name)[0] ?? '';
        const count = make(doc, 'span', 'ss-tile-count', node.level > 0 ? String(node.level) : '–');
        count.setAttribute('aria-hidden', 'true');
        const mark = make(doc, 'span', 'ss-tile-mark');
        mark.setAttribute('aria-hidden', 'true');
        mark.append(icon(doc, STATE_ICONS[node.state]));
        box.append(symbol, count, mark);
        const label = make(doc, 'span', 'ss-tile-label', node.name);
        label.setAttribute('aria-hidden', 'true');
        tile.append(box, label);
        return tile;
    }

    /** The indented list's line for a node: depth as indentation, "from <parent>" under it. */
    function itemOf(node, byId, depth, parent) {
        const item = make(doc, 'li', `rpg-tree-item rpg-tree-${node.state}`);
        item.style.setProperty('--rpg-depth', String(depth));
        const row = controlOf(node, byId, 'rpg-tree-line');
        row.append(make(doc, 'span', 'rpg-tree-line-name', node.name));
        const status = node.state === 'closed' ? STATE_WORDS.closed : node.state === 'locked' ? STATE_WORDS.locked : node.level > 0 ? `Lv ${node.level} of ${node.max} · ${STATE_WORDS[node.state]}` : STATE_WORDS[node.state];
        row.append(make(doc, 'span', 'rpg-tree-line-state', status));
        const hint = nodeHint(node, byId);
        if (hint) row.append(make(doc, 'span', 'rpg-tree-line-hint', hint));
        if (parent && byId.has(parent)) row.append(make(doc, 'span', 'rpg-tree-line-from', `from ${byId.get(parent).name}`));
        item.append(row);
        return item;
    }

    function detailOf(node, byId) {
        const card = make(doc, 'section', 'rpg-tree-detail ss-glass');
        card.setAttribute('role', 'region');
        card.setAttribute('aria-label', `${node.name} details`);
        card.append(make(doc, 'p', 'rpg-tree-detail-name', node.name));
        const row = make(doc, 'p', 'rpg-tree-detail-row');
        const stateText = node.state === 'locked' ? STATE_WORDS.locked : node.state === 'closed' ? STATE_WORDS.closed : node.level > 0 ? `Lv ${node.level} of ${node.max} · ${STATE_WORDS[node.state]}` : STATE_WORDS[node.state];
        row.append(make(doc, 'span', 'ss-pill ss-pill-soft rpg-tree-detail-state', stateText));
        if (node.inUse !== null) row.append(make(doc, 'span', 'ss-pill ss-pill-outline', node.inUse ? 'In use' : 'Set aside'));
        card.append(row);
        const hint = nodeHint(node, byId);
        if (hint) card.append(make(doc, 'p', 'rpg-tree-detail-hint', hint));
        if (node.note) card.append(make(doc, 'p', 'rpg-tree-detail-note', node.note));
        const parent = parentOf(node, byId);
        const facts = [node.kind, ...node.facts, node.tier ? `Tier ${node.tier}` : '', parent ? `From ${byId.get(parent).name}` : ''].filter(Boolean);
        if (facts.length) {
            const list = make(doc, 'ul', 'rpg-tree-facts');
            for (const fact of facts) list.append(make(doc, 'li', '', fact));
            card.append(list);
        }
        const setCommand = typeof current.setCommand === 'string' ? current.setCommand.trim() : '';
        if (setCommand && node.inUse !== null && node.state !== 'locked' && node.state !== 'closed' && typeof api?.command === 'function') {
            const go = make(doc, 'button', `ss-button rpg-tree-go${node.inUse ? ' ss-button-quiet' : ''}`, node.inUse ? 'Set aside' : 'Use');
            go.setAttribute('type', 'button');
            go.addEventListener('click', () => {
                try {
                    const out = api.command(setCommand, { actor: String(current.actor ?? ''), name: node.id, active: !node.inUse });
                    Promise.resolve(out).catch(() => {});
                } catch { /* the host reports its own problems */ }
            });
            card.append(go);
        }
        return card;
    }

    function layoutLinks() {
        const svg = root.querySelector('.rpg-tree-links');
        const grid = root.querySelector('.rpg-tree-grid');
        if (!svg || !grid || typeof grid.getBoundingClientRect !== 'function') return;
        const box = grid.getBoundingClientRect();
        svg.setAttribute('viewBox', `0 0 ${Math.max(0, box.width)} ${Math.max(0, box.height)}`);
        for (const path of svg.querySelectorAll('path')) {
            const from = controls.get(path.getAttribute('data-from'));
            const to = controls.get(path.getAttribute('data-to'));
            if (!from || !to || typeof from.getBoundingClientRect !== 'function') continue;
            const a = from.getBoundingClientRect();
            const b = to.getBoundingClientRect();
            const x1 = a.left + a.width / 2 - box.left;
            const y1 = a.bottom - box.top;
            const x2 = b.left + b.width / 2 - box.left;
            const y2 = b.top - box.top;
            const mid = (y1 + y2) / 2;
            path.setAttribute('d', `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`);
        }
    }

    function schedule() {
        if (typeof view.requestAnimationFrame === 'function') {
            if (pending !== null) return;
            pending = view.requestAnimationFrame(() => { pending = null; layoutLinks(); });
        } else layoutLinks();
    }

    function draw() {
        root.textContent = '';
        controls = new Map();
        const byId = new Map(nodes.map(node => [node.id, node]));
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', cut(current.label, 80) || 'Skills');
        if (!nodes.length) return;
        const layout = treeLayout(nodes);
        root.setAttribute('data-grid', layout.leaves <= TREE_GRID_LEAVES_MAX ? 'yes' : 'no');
        root.setAttribute('data-leaves', String(layout.leaves));

        const grid = make(doc, 'div', 'rpg-tree-grid');
        const links = treeLinks(nodes);
        if (links.length) {
            const svg = doc.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('class', 'rpg-tree-links');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            for (const link of links) {
                const path = doc.createElementNS(SVG_NS, 'path');
                path.setAttribute('class', 'rpg-tree-link');
                path.setAttribute('data-from', link.from);
                path.setAttribute('data-to', link.to);
                path.setAttribute('data-state', link.state);
                svg.append(path);
            }
            grid.append(svg);
        }
        for (const group of tierGroups(nodes)) {
            const section = make(doc, 'section', 'rpg-tree-tier');
            section.setAttribute('data-tier', String(group.tier));
            section.append(make(doc, 'p', 'rpg-tree-tier-label', group.title));
            const row = make(doc, 'div', 'rpg-tree-row');
            row.style.setProperty('--rpg-cols', String(Math.min(TREE_COLUMNS_MAX, Math.max(1, whole(current.columns, 3)))));
            for (const node of group.nodes) {
                const tile = tileOf(node, byId, layout.leaves <= TREE_GRID_LEAVES_MAX ? { x: layout.x.get(node.id) ?? 0.5, leaves: layout.leaves } : null);
                controls.set(node.id, tile);
                row.append(tile);
            }
            section.append(row);
            grid.append(section);
        }
        root.append(grid);

        const list = make(doc, 'ol', 'rpg-tree-list');
        list.setAttribute('aria-label', cut(current.label, 80) || 'Skills');
        for (const entry of layout.order) {
            const node = byId.get(entry.id);
            if (!node) continue;
            const item = itemOf(node, byId, entry.depth, entry.parent);
            list.append(item);
        }
        root.append(list);

        const chosen = byId.get(selected);
        if (chosen) root.append(detailOf(chosen, byId));
        schedule();
    }

    const onResize = () => schedule();
    view.addEventListener?.('resize', onResize);

    nodes = listNodes();
    chooseDefault();
    draw();
    return {
        update(next = {}) {
            current = { ...next };
            nodes = listNodes();
            chooseDefault();
            draw();
        },
        destroy() {
            view.removeEventListener?.('resize', onResize);
            if (pending !== null) view.cancelAnimationFrame?.(pending);
            pending = null;
            root.remove();
        },
    };
}

export const skillTree = Object.freeze({
    props: Object.freeze({
        value: Object.freeze({ type: 'array', required: false, default: [] }),
        nodes: Object.freeze({ type: 'array', required: false, default: [] }),
        selected: Object.freeze({ type: 'string', required: false, default: '' }),
        columns: Object.freeze({ type: 'number', required: false, default: 3 }),
        label: Object.freeze({ type: 'string', required: false, default: 'Skills' }),
        actor: Object.freeze({ type: 'string', required: false, default: '' }),
        setCommand: Object.freeze({ type: 'string', required: false, default: '' }),
    }),
    validate(props = {}) {
        const problems = [];
        for (const key of ['value', 'nodes']) if (props[key] !== undefined && !Array.isArray(props[key])) problems.push(`${key} must be a list of skills.`);
        if (props.columns !== undefined && !Number.isInteger(Number(props.columns))) problems.push('columns must be a whole number.');
        return problems;
    },
    render: renderSkillTree,
});

/**
 * The widget's rules, for the Party screen's sheet (style.js sheet()). Every colour is a Story Block token; each state is
 * a class under `.rb` (two classes of weight), so it beats the building block's own tile rules. No opacity on a label: a
 * dimmed label falls below 4.5:1 on the glass. Each state has its own marker: locked a dashed ring and a lock; closed a
 * hatched box, a ban and a struck-through name; available an accent ring; learned a hairline; maxed a green ring and a star.
 */
export const SKILL_TREE_CSS = `
.rb .rpg-tree { display: grid; gap: var(--ss-space-3); min-width: 0; }
.rb .rpg-tree-tier { display: grid; gap: var(--ss-space-2); min-width: 0; }
.rb .rpg-tree-tier-label { display: flex; align-items: center; gap: var(--ss-space-2); margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ss-text); }
.rb .rpg-tree-tier-label::after { content: ""; flex: 1 1 auto; min-width: var(--ss-space-3); height: 1px; background: var(--ss-border); }
.rb .rpg-tree-grid { position: relative; display: grid; gap: var(--ss-space-3); min-width: 0; }
.rb .rpg-tree-links { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 0; }
.rb .rpg-tree-link { fill: none; stroke: var(--ss-border); stroke-width: 2; }
.rb .rpg-tree-link[data-state="learned"], .rb .rpg-tree-link[data-state="maxed"], .rb .rpg-tree-link[data-state="available"] { stroke: var(--ss-accent); }
.rb .rpg-tree-link[data-state="locked"], .rb .rpg-tree-link[data-state="closed"] { stroke-dasharray: 4 4; }
.rb .rpg-tree-row { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(var(--rpg-cols, 3), minmax(0, 1fr)); gap: var(--ss-space-2); min-width: 0; }
.rb .rpg-tree[data-grid="yes"] .rpg-tree-row { display: block; position: relative; height: 112px; }
.rb .rpg-tree-tile { appearance: none; margin: 0; min-width: 0; font: inherit; color: var(--ss-text); background: none; border: 0; padding: 0; cursor: pointer; display: grid; justify-items: center; gap: 4px; text-align: center; }
.rb .rpg-tree-tile[role="group"] { cursor: default; }
.rb .rpg-tree-tile.rpg-tree-slot { position: absolute; top: 0; left: calc(var(--rpg-x, 0.5) * 100%); width: calc(var(--rpg-w, 33%) - 8px); max-width: 112px; transform: translateX(-50%); }
.rb .rpg-tree-tile .ss-tile-label { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 100%; overflow-wrap: anywhere; font-size: 13px; line-height: 1.2; color: var(--ss-text); }
.rb .rpg-tree-tile .ss-tile-count { font-variant-numeric: tabular-nums; }
.rb .rpg-tree-tile .ss-tile-mark { color: var(--ss-text); }
.rb .rpg-tree-available .ss-tile-box { box-shadow: inset 0 0 0 2px var(--ss-accent); }
.rb .rpg-tree-available .ss-tile-mark { color: var(--ss-accent); }
.rb .rpg-tree-learned .ss-tile-box { box-shadow: inset 0 0 0 1px var(--ss-border); }
.rb .rpg-tree-maxed .ss-tile-box { box-shadow: inset 0 0 0 2px var(--ss-good); }
.rb .rpg-tree-maxed .ss-tile-mark { color: var(--ss-good); }
.rb .rpg-tree-locked .ss-tile-box { border-style: dashed; box-shadow: none; }
.rb .rpg-tree-locked .ss-tile-icon, .rb .rpg-tree-locked .ss-tile-mark { color: var(--ss-muted); }
.rb .rpg-tree-closed .ss-tile-box { background: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--ss-muted) 22%, transparent) 6px 7px), var(--ss-tile); box-shadow: inset 0 0 0 1px var(--ss-muted); }
.rb .rpg-tree-closed .ss-tile-label { text-decoration: line-through; }
.rb .rpg-tree-closed .ss-tile-mark { color: var(--ss-text); }
.rb .rpg-tree-aside .ss-tile-icon { opacity: 0.7; }
.rb .rpg-tree-tile.rpg-tree-selected { outline: 2px solid var(--ss-accent); outline-offset: 3px; border-radius: var(--ss-radius-m); }
.rb button.rpg-tree-tile:hover .ss-tile-box { background: color-mix(in srgb, var(--ss-accent) 18%, var(--ss-tile)); }
.rb button.rpg-tree-tile:active .ss-tile-box { background: color-mix(in srgb, var(--ss-accent) 30%, var(--ss-tile)); }
.rb button.rpg-tree-tile:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: 3px; border-radius: var(--ss-radius-m); }
.rb .rpg-tree-list { display: none; margin: 0; padding: 0; list-style: none; gap: var(--ss-space-2); }
.rb .rpg-tree-item { padding-left: calc(var(--rpg-depth, 0) * 16px); min-width: 0; }
.rb .rpg-tree-line { appearance: none; width: 100%; margin: 0; font: inherit; color: var(--ss-text); background: var(--ss-tile); border: 1px solid var(--ss-border); border-radius: var(--ss-radius-m); padding: 6px 10px; text-align: start; display: grid; gap: 2px; min-width: 0; cursor: pointer; }
.rb .rpg-tree-line[role="group"] { cursor: default; border-style: dashed; }
.rb .rpg-tree-line-name { font-weight: 700; overflow-wrap: anywhere; }
.rb .rpg-tree-line-state, .rb .rpg-tree-line-hint, .rb .rpg-tree-line-from { font-size: 13px; overflow-wrap: anywhere; color: var(--ss-text); }
.rb .rpg-tree-line-from { font-style: italic; }
.rb .rpg-tree-item.rpg-tree-closed .rpg-tree-line-name { text-decoration: line-through; }
.rb .rpg-tree-item.rpg-tree-available .rpg-tree-line { box-shadow: inset 0 0 0 1px var(--ss-accent); }
.rb .rpg-tree-item.rpg-tree-maxed .rpg-tree-line { box-shadow: inset 0 0 0 1px var(--ss-good); }
.rb .rpg-tree-item.rpg-tree-closed .rpg-tree-line { background: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--ss-muted) 22%, transparent) 6px 7px), var(--ss-tile); }
.rb .rpg-tree-line:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
.rb .rpg-tree-item .rpg-tree-line.rpg-tree-selected { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
@container rb-screen (max-width: 479.98px) {
  .rb .rpg-tree[data-grid] .rpg-tree-grid { display: none; }
  .rb .rpg-tree[data-grid] .rpg-tree-list { display: grid; }
}
.rb .rpg-tree[data-grid="no"] .rpg-tree-grid { display: none; }
.rb .rpg-tree[data-grid="no"] .rpg-tree-list { display: grid; }
.rb .rpg-tree-detail { display: grid; gap: var(--ss-space-2); min-width: 0; overflow-wrap: anywhere; }
.rb .rpg-tree-detail-name { font-size: 16px; font-weight: 800; color: var(--ss-text); }
.rb .rpg-tree-detail-row { display: flex; flex-wrap: wrap; gap: var(--ss-space-2); margin: 0; }
.rb .rpg-tree-detail-hint, .rb .rpg-tree-detail-note { margin: 0; color: var(--ss-text); }
.rb .rpg-tree-facts { margin: 0; padding-left: 1.2em; color: var(--ss-text); }
.rb .rpg-tree-go { justify-self: start; }
`;
