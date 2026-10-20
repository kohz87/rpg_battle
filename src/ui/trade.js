// RPG Battle's Trade tab (0.5.37): buying, selling, commissioning (0.5.44), collecting what was ordered.
//
// `renderTradeTab(pane, view, handlers)` draws it; like the Party and Battle tabs it owns no
// game state. Every price and every preview comes from the glue (`view.sellPrice`,
// `view.preview`, worked out by trade.js and craft.js), and every choice leaves through a
// handler, which writes the latest reply's Inventory and queues the line the next reply is
// told. What it keeps is the reader's half-made choice (who they trade with, the piece being
// planned), in a module-level draft, because the tab is redrawn on every chat event.
//
// Drawn like the Party tab: quiet section labels, hairlines, SillyTavern's menu_buttons, and
// every node filled through textContent (names and notes are the model's).
// (0.5.43) Buy, Sell and On order are one line per thing: the name in its rarity's colour, the
// note quiet in the middle (cut short; a tap shows it whole), a stack's −/+ count, and a small
// price button on the right, so the prices line up. Each trade is made at once, per row; every
// line under "Told in your next reply" can be undone. A wide pane lays the rows in two columns.

import { button, el, section, select, sub } from './dom.js';

const SLOT_CHOICES = [['', 'by its kind'], ['weapon', 'weapon'], ['offhand', 'off-hand'], ['armour', 'armour'], ['worn', 'worn'], ['accessory', 'accessory']];
const KIND_LABELS = { general: 'merchant', guild: 'guild buyer', apothecary: 'apothecary', smith: 'smith', crafter: 'crafter', fence: 'fence' };
const SOMEONE = '\u0000someone';

let draft = null;
let last = null;

function textInput(className, value, { placeholder = '', label = '' } = {}) {
    const node = el('input', { className: `text_pole ${className}`, attrs: { type: 'text', placeholder, 'aria-label': label || placeholder } });
    node.value = value ?? '';
    return node;
}

// (0.5.38) A name in its rarity's colour: grey, green, blue, purple, gold (style.css --rb-rarity-*).
const RARITY_CLASSES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary']);
function itemName(name, rarity) {
    const known = RARITY_CLASSES.has(String(rarity ?? '').toLowerCase()) ? String(rarity).toLowerCase() : 'common';
    // (0.5.41) Story Block's shared rarity class too, past common (common keeps the text colour).
    return el('span', { className: `rpg-trade-item-name rpg-rarity${known === 'common' ? '' : ' story-block-rarity'} is-${known}`, text: name });
}

function redraw() {
    if (last) renderTradeTab(...last);
}

// (0.5.43) An amount the short way for a row's button ('2 c', '1 g 3 s': the chat's own coins),
// the long way for its label and title.
const shortMoney = (view, amount) => (view.moneyShort ?? view.money)?.(amount) ?? String(amount);
const longMoney = (view, amount) => view.money?.(amount) ?? String(amount);

// The note in the middle of a row: one line, cut short; its whole text on hover, and a tap opens
// the row to show it.
function rowNote(text) {
    if (!text) return null;
    const node = el('span', { className: 'rpg-trade-note', text, attrs: { title: text } });
    node.addEventListener('click', () => node.parentNode?.classList?.toggle('is-open'));
    return node;
}

// A stack's how-many: − n +, from 1 to the stack.
function stepper(name, value, max, onChange) {
    const set = next => onChange(Math.max(1, Math.min(max, next)));
    const less = button('', 'rpg-trade-less', { iconName: 'fa-minus', title: `One fewer ${name}`, disabled: value <= 1, onClick: () => set(value - 1) });
    const more = button('', 'rpg-trade-more', { iconName: 'fa-plus', title: `One more ${name}`, disabled: value >= max, onClick: () => set(value + 1) });
    return el('span', { className: 'rpg-trade-stepper', attrs: { role: 'group', 'aria-label': `How many ${name}` } }, [
        less,
        el('span', { className: 'rpg-trade-count', text: String(value), attrs: { 'aria-live': 'polite' } }),
        more,
    ]);
}

// One line: the name, the note, an optional control, the action on the right.
function tradeRow(item, { note, control = null, action }) {
    // A long name is cut short on a narrow pane; its whole self on hover.
    const name = itemName(item.name, item.rarity);
    name.setAttribute('title', item.name);
    return el('li', { className: 'rpg-trade-item is-row' }, [name, rowNote(note), control, action]);
}

// The row's button: a short price and an icon; its full words for the title and screen readers.
function priceButton(className, iconName, short, full, { disabled = false, why = '', onClick } = {}) {
    const node = button(short, `rpg-trade-price-button ${className}`, { iconName, title: why || full, disabled, onClick });
    node.setAttribute('aria-label', full);
    return node;
}

// (0.5.38) Who you trade with: a kind of trader at this place (the general store, the
// apothecary…), with a name if you like, or someone present, or anyone you name. Nobody needs to
// be in the scene: the place has its traders.
const TRADER_KINDS = ['general', 'apothecary', 'smith', 'crafter', 'fence', 'guild'];
const TRADER_LABELS = { general: 'General store', apothecary: 'Apothecary', smith: 'Smith', crafter: 'Crafter (bone-carver, tanner…)', fence: 'Fence', guild: 'Guild buyer' };
const TRADER_WHO = { general: 'the general store', apothecary: 'the apothecary', smith: 'the smith', crafter: 'the bone-carver', fence: 'a fence', guild: 'the guild' };

const freshDraft = view => ({ chatId: view.chatId ?? null, trader: 'kind:general', names: {}, name: '', kind: '', sell: {}, piece: '', picks: {}, slot: '' });

function whoSection(view, handlers) {
    const people = view.people ?? [];
    const choices = [
        ...TRADER_KINDS.map(kind => [`kind:${kind}`, TRADER_LABELS[kind]]),
        ...people.map(name => [`person:${name}`, `${name} (here)`]),
        [SOMEONE, 'someone else…'],
    ];
    const trader = select('rpg-trade-person', 'Trading with', choices, draft.trader);
    trader.addEventListener('change', () => { draft.trader = trader.value; draft.kind = ''; redraw(); });
    const kindPick = draft.trader.startsWith('kind:') ? draft.trader.slice(5) : null;
    // A trader kind may have a name of the story's ("Mother Greta"); someone else needs one.
    const nameBox = kindPick || draft.trader === SOMEONE
        ? textInput('rpg-trade-name', kindPick ? draft.names[kindPick] ?? '' : draft.name, { placeholder: kindPick ? 'their name (optional)' : 'who, e.g. the bone-carver', label: kindPick ? `Their name (optional; else ${TRADER_WHO[kindPick]})` : 'Their name' })
        : null;
    nameBox?.addEventListener('input', () => {
        if (kindPick) draft.names[kindPick] = nameBox.value;
        else draft.name = nameBox.value;
    });
    nameBox?.addEventListener('change', redraw);
    // A person's trade is guessed from their name and can be changed; a kind is what it is.
    const guessed = view.buyerKind?.(tradingWith()) ?? 'general';
    const kind = kindPick ? null : select('rpg-trade-kind', 'Their trade', Object.entries(KIND_LABELS), draft.kind || guessed);
    kind?.addEventListener('change', () => { draft.kind = kind.value; redraw(); });
    const prices = view.prices ?? { tier: 'town', buy: 1, sell: 1 };
    // (0.5.46) The prices here, read-only: the place's own, or the reader's word for it from the
    // settings (Trade). No longer a choice on this page: a player could pick their own prices.
    const priced = view.level ? `${view.level} prices (set in the settings)` : `${prices.tier} prices`;
    return section('rpg-trade-who', [
        sub('Trading with', 'fa-handshake'),
        // (0.5.43) The name on its own line under the trader, so its hint is never cut.
        el('div', { className: 'rpg-trade-row' }, [trader, kind]),
        nameBox ? el('div', { className: 'rpg-trade-row rpg-trade-name-row' }, [nameBox]) : null,
        kind && !draft.kind && tradingWith() ? el('p', { className: 'rpg-battle-hint rpg-trade-guess', text: `Their trade, by the name: ${KIND_LABELS[guessed] ?? guessed}.` }) : null,
        el('p', { className: 'rpg-battle-hint rpg-trade-place', text: `${view.place || 'Somewhere'} · ${priced}: goods ×${round(prices.buy)}, offers ×${round(prices.sell)}` }),
    ]);
}

const NO_PURSE = 'Purse: none in the Inventory. Money is a row like "Coin Pouch | 1 | 4 silver, 2 copper" or "Coins | 42".';

const round = value => String(Math.round(Number(value) * 100) / 100);

function tradingWith() {
    if (draft.trader.startsWith('kind:')) {
        const kind = draft.trader.slice(5);
        return String(draft.names[kind] ?? '').trim() || TRADER_WHO[kind] || 'the trader';
    }
    if (draft.trader.startsWith('person:')) return draft.trader.slice(7);
    return draft.name.trim();
}

function tradeKind(view) {
    if (draft.trader.startsWith('kind:')) return draft.trader.slice(5);
    return draft.kind || view.buyerKind?.(tradingWith()) || 'general';
}

function sellSection(view, handlers) {
    const rows = view.sellable ?? [];
    const kind = tradeKind(view);
    // (0.5.40) Whose items: yours, or a party member's (their Inventory section).
    const owners = view.owners ?? [];
    const whose = owners.length > 1 ? select('rpg-trade-owner', 'Whose items', owners.map(owner => [owner.id, owner.id === 'pc' ? `${owner.name} (you)` : owner.name]), view.owner ?? 'pc') : null;
    whose?.addEventListener('change', () => handlers.onOwner?.(whose.value));
    const items = rows.map(item => {
        const qty = Math.max(1, Math.min(Number(draft.sell[item.name] ?? 1), item.qty));
        const each = view.sellPrice?.(item.name, kind) ?? 0;
        const control = item.qty > 1 ? stepper(item.name, qty, item.qty, next => { draft.sell[item.name] = next; redraw(); }) : null;
        // The price once: the total for how many; each one's price in the words.
        const full = `Sell${qty > 1 ? ` ${qty}` : ''} · ${longMoney(view, each * qty)}${qty > 1 ? ` (${longMoney(view, each)} each)` : ''}`;
        return tradeRow(item, {
            note: [item.qty > 1 ? `×${item.qty}` : '', item.note].filter(Boolean).join(' · '),
            control,
            action: priceButton('rpg-trade-sell', 'fa-coins', shortMoney(view, each * qty), full, {
                disabled: !tradingWith(),
                why: tradingWith() ? '' : 'Say who you trade with first.',
                onClick: () => handlers.onSell?.({ name: item.name, qty, each, who: tradingWith(), kind }),
            }),
        });
    });
    return section('rpg-trade-sell-list', [
        sub('Sell', 'fa-coins', rows.length),
        whose ? el('div', { className: 'rpg-trade-row' }, [el('span', { className: 'rpg-battle-label', text: 'Whose items' }), whose]) : null,
        rows.length ? el('ul', { className: 'rpg-trade-list is-rows' }, items) : el('p', { className: 'rpg-battle-empty', text: 'Nothing to sell: what you wear and what is on order stays.' }),
    ]);
}

// (0.5.38) What the trader has for sale today, at what; Buy when the purse can pay.
function buySection(view, handlers) {
    const who = tradingWith();
    if (!who || typeof view.stock !== 'function') return null;
    const kind = tradeKind(view);
    const items = view.stock(kind) ?? [];
    return section('rpg-trade-buy-list', [
        sub(`Buy from ${who}`, 'fa-store', items.length),
        items.length ? el('ul', { className: 'rpg-trade-list is-rows' }, items.map(item => tradeRow(item, {
            note: item.note,
            action: priceButton('rpg-trade-buy', 'fa-cart-shopping', shortMoney(view, item.price), `Buy · ${longMoney(view, item.price)}`, {
                disabled: item.price > (view.purse ?? 0),
                why: item.price > (view.purse ?? 0) ? 'Your purse cannot pay for it.' : '',
                onClick: () => handlers.onBuy?.({ name: item.name, who, kind }),
            }),
        }))) : el('p', { className: 'rpg-battle-empty', text: `${who} has nothing left to sell today.` }),
    ]);
}

// (0.5.44) Commission: the piece is made by the crafter you trade with, always as an order, and
// when it is ready is theirs to say (the glue works it out). Materials are one line each, picked
// with Use (a stack's −/+ once picked); no "made now" choice.
const CRAFTER_WORDS = 'a smith, a crafter (bone-carver, tanner…) or an apothecary';

function commissionSection(view, handlers) {
    const kind = tradeKind(view);
    const crafters = view.crafters ?? ['smith', 'crafter', 'apothecary'];
    if (!crafters.includes(kind)) {
        return section('rpg-trade-make', [
            sub('Commission', 'fa-hammer'),
            el('p', { className: 'rpg-battle-hint rpg-trade-commission-who', text: `To have a piece made, trade with ${CRAFTER_WORDS}: they say how long it takes.` }),
        ]);
    }
    const materials = view.materials ?? [];
    const piece = textInput('rpg-trade-piece', draft.piece, { placeholder: 'e.g. Skull Ring', label: 'What to have made' });
    piece.addEventListener('input', () => { draft.piece = piece.value; });
    piece.addEventListener('change', redraw);
    const rows = materials.map(item => {
        const chosen = Math.max(0, Math.min(Number(draft.picks[item.name] ?? 0), item.qty));
        const use = button(chosen ? 'Using' : 'Use', `rpg-trade-pick${chosen ? ' is-picked' : ''}`, {
            iconName: chosen ? 'fa-check' : 'fa-plus',
            title: chosen ? `Leave ${item.name} out` : `Make it from ${item.name}`,
            onClick: () => { draft.picks[item.name] = chosen ? 0 : 1; redraw(); },
        });
        use.setAttribute('aria-pressed', chosen ? 'true' : 'false');
        const control = chosen && item.qty > 1 ? stepper(item.name, chosen, item.qty, next => { draft.picks[item.name] = next; redraw(); }) : null;
        return tradeRow(item, { note: [item.qty > 1 ? `×${item.qty}` : '', item.note].filter(Boolean).join(' · '), control, action: use });
    });
    const slot = select('rpg-trade-slot', 'Where it is worn', SLOT_CHOICES, draft.slot);
    slot.addEventListener('change', () => { draft.slot = slot.value; redraw(); });
    const chosen = Object.entries(draft.picks).filter(([, qty]) => qty > 0).map(([name, qty]) => ({ name, qty }));
    const preview = draft.piece.trim() && chosen.length ? view.preview?.({ name: draft.piece.trim(), materials: chosen, slot: draft.slot || null, kind }) : null;
    const who = tradingWith();
    const afford = preview ? preview.fee <= (view.purse ?? 0) : false;
    const why = !draft.piece.trim() ? 'Name the piece first.' : !chosen.length ? 'Pick what it is made from.' : !who ? 'Say who makes it first.' : !afford ? 'Your purse cannot pay the fee.' : '';
    return section('rpg-trade-make', [
        sub('Commission', 'fa-hammer'),
        el('div', { className: 'rpg-trade-row' }, [piece]),
        materials.length ? el('ul', { className: 'rpg-trade-list is-rows' }, rows) : el('p', { className: 'rpg-battle-empty', text: 'No materials in the Inventory.' }),
        el('div', { className: 'rpg-trade-row' }, [el('span', { className: 'rpg-battle-label', text: 'Worn as' }), slot]),
        preview ? el('p', { className: 'rpg-trade-preview', text: `${preview.name}: ${preview.note} · ${who} says ${preview.span}${preview.when && !/^in\b/i.test(preview.when) ? `, ready ${preview.when}` : ''} · fee ${longMoney(view, preview.fee)}` }) : null,
        button('Commission it', 'rpg-trade-craft', {
            iconName: 'fa-hammer',
            disabled: Boolean(why),
            title: why || `Have ${who} make ${draft.piece.trim()}: they say when it is ready; your next reply tells it.`,
            onClick: () => {
                handlers.onCraft?.({ name: draft.piece.trim(), materials: chosen, slot: draft.slot || null, who, kind });
                draft = { ...draft, piece: '', picks: {} };
            },
        }),
        why ? el('p', { className: 'rpg-battle-hint', text: why }) : null,
    ]);
}

function ordersSection(view, handlers) {
    const orders = view.orders ?? [];
    if (!orders.length) return null;
    const open = view.market !== false;
    return section('rpg-trade-orders', [
        sub('On order', 'fa-clock', orders.length),
        // (0.5.44) Collect once the story clock has reached the ready time; until then, when.
        // (0.5.46) Away from a market, read-only: ready, to collect where there is one.
        el('ul', { className: 'rpg-trade-list is-rows' }, orders.map(item => tradeRow(item, {
            note: item.note ?? '',
            action: item.due === false
                ? el('span', { className: 'rpg-trade-ready', text: `ready ${item.ready || 'later'}`, attrs: { title: `${item.with || 'The crafter'} is still at it: ready ${item.ready || 'later'}.` } })
                : !open
                ? el('span', { className: 'rpg-trade-ready', text: item.ready ? `ready since ${item.ready}` : 'ready', attrs: { title: `Ready: collect ${item.name} where there is a market.` } })
                : button('Collect', 'rpg-trade-price-button rpg-trade-collect', { iconName: 'fa-box-open', title: `Collect ${item.name}: your next reply tells it.`, onClick: () => handlers.onCollect?.({ name: item.name, who: item.with || tradingWith() }) }),
        }))),
    ]);
}

// (0.5.43) Each trade waiting to be told, with Undo: it takes exactly that trade back out of the
// Inventory and the purse (the glue replays the others). `pending`: [{ text, undo }] (or text).
function pendingSection(view, handlers) {
    const lines = (view.pending ?? []).map(line => (typeof line === 'string' ? { text: line, undo: false } : line));
    if (!lines.length) return null;
    const undoable = typeof handlers.onUndo === 'function';
    return section('rpg-trade-pending', [
        sub('Told in your next reply', 'fa-feather', lines.length),
        el('ul', { className: 'rpg-trade-told' }, lines.map((line, index) => el('li', { className: 'rpg-trade-told-line' }, [
            el('span', { className: 'rpg-trade-told-text', text: line.text }),
            undoable && line.undo ? button('Undo', 'rpg-trade-undo', { iconName: 'fa-rotate-left', title: `Take back: ${line.text}`, onClick: () => handlers.onUndo(index) }) : null,
        ]))),
        el('p', { className: 'rpg-battle-hint', text: 'Already in the Inventory. Undo one, or delete or swipe the latest reply to take them all back.' }),
    ]);
}

// (0.5.43) Two columns of rows on a wide pane (tablet landscape, a wide sidebar), one on a narrow.
const WIDE = 480;
const watched = new WeakSet();
function fitWidth(pane, root) {
    const width = pane.getBoundingClientRect?.().width || pane.clientWidth || 0;
    root.classList.toggle('is-wide', width >= WIDE);
    if (watched.has(pane) || typeof globalThis.ResizeObserver !== 'function') return;
    watched.add(pane);
    new globalThis.ResizeObserver(entries => {
        const box = entries[0]?.contentRect?.width ?? 0;
        pane.querySelector('.rpg-trade-tab')?.classList.toggle('is-wide', box >= WIDE);
    }).observe(pane);
}

/**
 * Draws the Trade tab. `view`: { chatId, ready, reason, place, prices, level, (0.5.46) market
 * (false: no market here, with `noMarket` saying so), people,
 * purse, purseText, sellable, materials, orders ({ name, note, rarity, with, due, ready }), pending,
 * crafters (the trader kinds that take commissions), money(amount),
 * sellPrice(name, kind), preview({ name, materials, slot, kind }) → { name, note, fee, ready,
 * when, span } | null, buyerKind(name), stock(kind) → [{ name, note, price, rarity }] (0.5.38) }.
 * (0.5.40) owners: [{ id, name }] and owner (whose items Sell lists).
 * (0.5.43) moneyShort(amount) for the rows' buttons; pending: [{ text, undo }].
 * `handlers`: onBuy, onSell, onCraft, onCollect, onOwner, (0.5.43) onUndo(index).
 */
export function renderTradeTab(pane, view = {}, handlers = {}) {
    if (!pane) return;
    last = [pane, view, handlers];
    if (!draft || draft.chatId !== (view.chatId ?? null)) draft = freshDraft(view);
    // Someone no longer here: back to the general store.
    if (draft.trader.startsWith('person:') && !(view.people ?? []).includes(draft.trader.slice(7))) draft.trader = 'kind:general';
    const root = el('div', { className: 'rpg-battle-tab rpg-trade-tab' });
    if (!view.ready) {
        root.append(el('p', { className: 'rpg-battle-empty', text: view.reason || 'Nothing to trade yet.' }));
        pane.replaceChildren(root);
        return;
    }
    // The purse first, and kept in view while the lists scroll. (0.5.46) No purse row at all is
    // said so, never "0 copper" (the coins are somewhere the Inventory does not name as money).
    root.append(el('p', { className: 'rpg-trade-purse', text: view.purseText ? `Purse: ${view.purseText}` : NO_PURSE }));
    // (0.5.46) No market here (the wilds, a cellar, no trader present): no Buy, Sell or
    // commission; orders stay in view, read-only.
    if (view.market === false) {
        root.append(el('p', { className: 'rpg-battle-empty rpg-trade-closed', text: view.noMarket || 'No market here.' }));
        root.append(...[pendingSection(view, handlers), ordersSection(view, handlers)].filter(Boolean));
    } else {
        root.append(...[whoSection(view, handlers), pendingSection(view, handlers), buySection(view, handlers), sellSection(view, handlers), commissionSection(view, handlers), ordersSection(view, handlers)].filter(Boolean));
    }
    pane.replaceChildren(root);
    fitWidth(pane, root);
}

/** Forget the half-made choice (a new chat). */
export function resetTradeDraft() {
    draft = null;
}
