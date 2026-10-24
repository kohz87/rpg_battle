// RPG Battle v2, screen `rpg-battle/party` (UI 8f): the EQUIPMENT tiles and the member's collapse control, two custom
// widgets (WIDGETS.md: render(el, props, api) → { update, destroy }).
//
//   rpg-battle.equipment      one member's tiles (paperdoll.js). A filled tile is marked by a tap (it turns red and says
//                             "Tap again to take off"); a second tap within ARM_MS takes the piece off (item.unequip
//                             { stack }, the items part's command). Tapping elsewhere, Escape, leaving the tile or the
//                             timeout unmarks it. Enter marks, Enter again takes it off (a button's own click). An
//                             empty tile is inert. Escape with a mark only unmarks (a second Escape goes on to the page).
//                             A tile is rebuilt only when what it shows changes, so a tap that lands as another tile's
//                             mark clears is not lost. The live region says what was taken off, and keyboard focus stays
//                             on the slot (now empty) instead of dropping to the page; Story Block draws a screen again
//                             from nothing when the state changes, so both are handed to the member's next drawing (below).
//                             Props: value (the tiles), label, actor.
//   rpg-battle.member-toggle  the header button that folds a member's card to its compact card (the hero) and back:
//                             aria-expanded, a chevron, and the card's data-open (the screen's CSS hides the rest). The
//                             state is the viewer's own, kept per chat and member in localStorage (never game state).
//
// Built with createElement and textContent only: nothing from data is read as markup.

export const EQUIPMENT_WIDGET = 'rpg-battle.equipment';
export const MEMBER_TOGGLE_WIDGET = 'rpg-battle.member-toggle';
/** How long a mark stays before it is cleared (a second tap after this is a first tap again). */
export const ARM_MS = 4000;
export const EQUIPMENT_HELP = 'Tap a piece once to mark it, tap again to take it off. Equip from Inventory.';

const make = (doc, tag, className = '', text = '') => {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
};
const isArray = value => Array.isArray(value);

// Story Block draws the screen again from nothing when the state changes, and a take-off is a state change: the widget
// that was tapped is gone before its command answers. What the viewer was in the middle of is kept here, per member, for
// the next drawing: the newest instance's way to announce (the answer goes to it), and the slot to give the focus back to.
const FOCUS_HOLD_MS = 4000;
const announcers = new Map();
let pendingFocus = null;

/** The tiles' props as the widget reads them (a missing list is no tiles). */
const tilesOf = props => (isArray(props?.value) ? props.value.filter(tile => tile && typeof tile === 'object') : []);

/** Draws one member's EQUIPMENT tiles into `el`; `api.command` sends the unequip. */
export function renderEquipment(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'rpg-eq');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', String(props?.label ?? 'Equipment'));
    const grid = make(doc, 'div', 'rpg-eq-grid');
    const live = make(doc, 'span', 'rpg-eq-live');
    live.setAttribute('aria-live', 'polite');
    root.append(grid, make(doc, 'p', 'rpg-eq-help', EQUIPMENT_HELP), live);
    el.append(root);

    let tiles = tilesOf(props);
    let armed = '';
    let timer = null;
    const who = String(props?.actor ?? '');
    let settleTimer = null;
    // One node per slot, kept while the slot's kind (filled or empty) and piece stay the same: a tap then changes the
    // tile in place, so the focused tile stays focused (Enter marks, Enter again takes it off).
    const slots = new Map();
    const say = text => { live.textContent = text; };
    const armedTile = () => tiles.find(tile => tile.filled && tile.stack === armed) ?? null;

    function clearTimer() {
        if (timer !== null) globalThis.clearTimeout(timer);
        timer = null;
    }
    function disarm() {
        clearTimer();
        if (!armed) return;
        armed = '';
        paint();
        say('');
    }
    function arm(tile) {
        pendingFocus = null;
        clearTimer();
        armed = tile.stack;
        timer = globalThis.setTimeout(() => { timer = null; disarm(); }, ARM_MS);
        paint();
        say(`Tap again to take ${tile.name} off`);
    }
    function take(tile) {
        const node = slots.get(tile.key)?.node ?? null;
        disarm();
        pendingFocus = null;
        if (node && doc.activeElement === node) {
            const mine = { who, key: tile.key, stack: tile.stack };
            pendingFocus = mine;
            globalThis.setTimeout(() => { if (pendingFocus === mine) pendingFocus = null; }, FOCUS_HOLD_MS);
        }
        if (typeof api?.command !== 'function') return;
        // The answer comes after the screen was drawn again: it is said by the member's newest tiles, not by this one.
        const announce = text => (announcers.get(who) ?? say)(text);
        const failed = () => announce(`Could not take ${tile.name} off`);
        Promise.resolve(api.command('item.unequip', { stack: tile.stack })).then(result => (result?.ok === false ? failed() : announce(`${tile.name} taken off`)), failed);
    }

    /** Gives the focus back to the slot a piece was just taken off, where a keyboard viewer left it (the next piece may now sit there). */
    function settle() {
        settleTimer = null;
        if (!pendingFocus || pendingFocus.who !== who) return;
        const entry = slots.get(pendingFocus.key);
        // not off yet: wait for the next drawing
        if (entry && entry.tile.filled && entry.tile.stack === pendingFocus.stack) return;
        // a first drawing may not be on the page yet: try again once it is
        if (grid.isConnected === false) { settleTimer = globalThis.setTimeout(settle, 0); return; }
        // the slot is gone (an extra piece): the first piece that can be tapped instead
        const target = entry?.node ?? [...grid.children].find(node => node.tagName === 'BUTTON') ?? null;
        pendingFocus = null;
        if (!target) return;
        if (target.tagName !== 'BUTTON') target.setAttribute('tabindex', '-1');
        target.focus?.();
    }

    /** Sets a tile's content and state from its props. */
    function fill(node, tile) {
        if (!tile.filled) {
            node.className = `rpg-eq-tile empty${tile.note ? ' note' : ''}`;
            node.replaceChildren(make(doc, 'span', 'rpg-eq-slot', tile.label), make(doc, 'span', 'rpg-eq-name', tile.note || 'Empty'));
            return;
        }
        const isArmed = armed === tile.stack;
        node.className = `rpg-eq-tile filled${isArmed ? ' armed' : ''}${tile.extra ? ' extra' : ''}`;
        node.setAttribute('aria-pressed', isArmed ? 'true' : 'false');
        if (tile.why) node.setAttribute('title', String(tile.why));
        else node.removeAttribute('title');
        const parts = [make(doc, 'span', 'rpg-eq-slot', tile.label), make(doc, 'span', 'rpg-eq-name', tile.name)];
        if (isArmed) parts.push(make(doc, 'span', 'rpg-eq-sub', 'Tap again to take off'));
        else if (tile.stats) parts.push(make(doc, 'span', 'rpg-eq-sub', tile.stats));
        if (tile.meter || tile.cond) {
            const cond = make(doc, 'span', `rpg-eq-cond${tile.condTone ? ` ss-tone-${tile.condTone}` : ''}${tile.condBroken ? ' broken' : ''}`);
            if (tile.cond) cond.setAttribute('title', String(tile.cond));
            const bar = make(doc, 'span', 'rpg-eq-bar');
            if (tile.meter && tile.max > 0) bar.setAttribute('style', `--rpg-ratio: ${Math.max(0, Math.min(1, tile.cur / tile.max))}`);
            bar.append(make(doc, 'span'));
            cond.append(bar);
            parts.push(cond);
        }
        node.replaceChildren(...parts);
    }

    /** The slot's entry for a tile: its node, made once and kept while the slot stays the same kind of tile. */
    function slotFor(tile) {
        const kind = tile.filled ? 'filled' : 'empty';
        const stack = tile.stack || '';
        let entry = slots.get(tile.key);
        if (!entry || entry.kind !== kind || entry.stack !== stack) {
            entry = { kind, stack, tile, node: make(doc, tile.filled ? 'button' : 'div', 'rpg-eq-tile') };
            if (tile.filled) {
                entry.node.setAttribute('type', 'button');
                entry.node.addEventListener('click', () => {
                    const current = entry.tile;
                    if (armed === current.stack) take(current);
                    else arm(current);
                });
                entry.node.addEventListener('focusout', event => {
                    if (armed && armed === entry.tile.stack && !entry.node.contains(event?.relatedTarget ?? null)) disarm();
                });
            }
            slots.set(tile.key, entry);
        }
        entry.tile = tile;
        // Rebuilt only when it shows something new: a tile replaced between a press and its release never gets the click.
        const shown = JSON.stringify([tile, armed === tile.stack]);
        if (entry.shown !== shown) {
            entry.shown = shown;
            fill(entry.node, tile);
        }
        return entry;
    }

    function paint() {
        const keep = new Set();
        const nodes = tiles.map(tile => {
            keep.add(tile.key);
            return slotFor(tile).node;
        });
        for (const [key, entry] of [...slots]) {
            if (!keep.has(key)) {
                entry.node.remove();
                slots.delete(key);
            }
        }
        nodes.forEach((node, index) => {
            if (grid.children[index] !== node) grid.insertBefore(node, grid.children[index] ?? null);
        });
        while (grid.children.length > nodes.length) grid.children[grid.children.length - 1].remove();
        if (pendingFocus && settleTimer === null) settle();
    }

    // Escape, and a tap outside the widget, unmark it.
    const onKey = event => {
        if (event?.key !== 'Escape' || !armed) return;
        disarm();
        event.stopPropagation?.();
    };
    const onDown = event => { if (armed && !root.contains(event?.target ?? null)) disarm(); };
    const outside = doc.addEventListener ? doc : doc.body;
    root.addEventListener('keydown', onKey);
    outside?.addEventListener?.('pointerdown', onDown);

    function apply(next = {}) {
        tiles = tilesOf(next);
        if (armed && !armedTile()) { clearTimer(); armed = ''; say(''); }
        paint();
    }
    announcers.set(who, say);
    apply(props);
    return {
        update(next = {}) {
            if (next.label !== undefined) root.setAttribute('aria-label', String(next.label));
            apply(next);
        },
        destroy() {
            clearTimer();
            if (settleTimer !== null) globalThis.clearTimeout(settleTimer);
            if (announcers.get(who) === say) announcers.delete(who);
            outside?.removeEventListener?.('pointerdown', onDown);
            root.remove();
        },
    };
}

export const equipmentWidget = Object.freeze({
    props: Object.freeze({
        value: Object.freeze({ type: 'array', required: false, default: [] }),
        actor: Object.freeze({ type: 'string', required: false, default: '' }),
        label: Object.freeze({ type: 'string', required: false, default: 'Equipment' }),
    }),
    validate(props = {}) {
        return props.value !== undefined && !isArray(props.value) ? ['value must be the list of equipment tiles.'] : [];
    },
    render: renderEquipment,
});

// ---------------------------------------------------------------------------------------------------
// The member's collapse control

/** The chat the viewer is in (the key their open and closed cards are kept under); 'chat' without one. */
function chatKey() {
    try {
        return String(globalThis.SillyTavern?.getContext?.()?.chatId ?? 'chat');
    } catch {
        return 'chat';
    }
}
const keyFor = actor => `rb.party.open:${chatKey()}:${actor}`;
function storedOpen(actor) {
    try {
        const value = globalThis.localStorage?.getItem(keyFor(actor));
        return value === '1' ? true : value === '0' ? false : null;
    } catch {
        return null;
    }
}
function storeOpen(actor, open) {
    try {
        globalThis.localStorage?.setItem(keyFor(actor), open ? '1' : '0');
    } catch { /* a browser without storage keeps the default */ }
}

/** Draws the header button of a member's card; `props.open` is the default (the lead's card opens, the others fold). */
export function renderMemberToggle(el, props = {}) {
    const doc = el.ownerDocument;
    const actor = String(props?.actor ?? '');
    let name = String(props?.name ?? '');
    let open = storedOpen(actor) ?? Boolean(props?.open);
    const button = make(doc, 'button', 'rpg-toggle');
    button.setAttribute('type', 'button');
    const chevron = make(doc, 'i', 'fa-solid fa-chevron-down rpg-toggle-chev');
    chevron.setAttribute('aria-hidden', 'true');
    button.append(chevron);
    el.append(button);
    const card = el.closest?.('article') ?? null;
    const paint = () => {
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${name}`.trim());
        if (card) card.setAttribute('data-open', open ? 'true' : 'false');
    };
    button.addEventListener('click', () => {
        open = !open;
        storeOpen(actor, open);
        paint();
    });
    paint();
    return {
        update(next = {}) {
            name = String(next?.name ?? name);
            paint();
        },
        destroy() {
            button.remove();
        },
    };
}

export const memberToggleWidget = Object.freeze({
    props: Object.freeze({
        actor: Object.freeze({ type: 'string', required: false, default: '' }),
        name: Object.freeze({ type: 'string', required: false, default: '' }),
        open: Object.freeze({ type: 'boolean', required: false, default: false }),
    }),
    validate(props = {}) {
        return props.open !== undefined && typeof props.open !== 'boolean' ? ['open must be true or false.'] : [];
    },
    render: renderMemberToggle,
});

/** The widget sheet's rules for the two (inside the Party screen's sheet, every colour a Story Block token). */
export const EQUIPMENT_CSS = `
.rb .rpg-eq { display: grid; gap: 8px; min-width: 0; }
.rb .rpg-eq-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; min-width: 0; }
.rb .rpg-eq-tile { min-height: 72px; min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px; padding: 8px 10px;
  border-radius: 14px; border: 1px solid var(--ss-border); background: var(--ss-tile); color: var(--ss-text); text-align: left; font: inherit; margin: 0; }
.rb button.rpg-eq-tile { cursor: pointer; }
.rb button.rpg-eq-tile:focus-visible, .rb .rpg-eq-tile.empty:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
.rb .rpg-eq-tile.empty { background: none; border-style: solid; }
.rb .rpg-eq-tile.extra { border-style: dashed; }
/* the red has a fallback: the Follow SillyTavern look does not define --ss-bad yet */
.rb .rpg-eq-tile.armed { border-color: var(--ss-bad, #e5484d); background: color-mix(in srgb, var(--ss-bad, #e5484d) 14%, var(--ss-tile)); box-shadow: inset 0 0 0 1px var(--ss-bad, #e5484d); }
.rb .rpg-eq-slot { font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: var(--ss-text); }
.rb .rpg-eq-name { font-size: 14px; font-weight: 700; line-height: 1.2; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.rb .rpg-eq-tile.empty .rpg-eq-name { font-weight: 600; color: var(--ss-muted); }
.rb .rpg-eq-tile.note .rpg-eq-name { font-weight: 600; color: var(--ss-muted); }
.rb .rpg-eq-sub { font-size: 12px; color: var(--ss-text); overflow-wrap: anywhere; }
.rb .rpg-eq-tile.armed .rpg-eq-sub { color: var(--ss-text); font-weight: 700; }
.rb .rpg-eq-cond { display: block; margin-top: auto; padding-top: 4px; }
.rb .rpg-eq-bar { display: block; height: 4px; border-radius: 999px; overflow: hidden; background: var(--ss-track); }
.rb .rpg-eq-bar > span { display: block; height: 100%; width: calc(var(--rpg-ratio, 1) * 100%); background: var(--ss-good); }
.rb .rpg-eq-cond.ss-tone-warn .rpg-eq-bar > span { background: var(--ss-warn); }
.rb .rpg-eq-cond.ss-tone-bad .rpg-eq-bar > span { background: var(--ss-bad, #e5484d); }
.rb .rpg-eq-help { margin: 0; font-size: 12px; color: var(--ss-muted); }
.rb .rpg-eq-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.rb .rpg-toggle { flex: none; width: 44px; height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; margin: 0;
  border-radius: 12px; border: 1px solid var(--ss-border); background: none; color: var(--ss-text); cursor: pointer; font: inherit; }
.rb .rpg-toggle:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
.rb .rpg-toggle-chev { transition: transform var(--ss-motion, 0.2s) ease; }
.rb .rpg-toggle[aria-expanded="true"] .rpg-toggle-chev { transform: rotate(180deg); }
`;
