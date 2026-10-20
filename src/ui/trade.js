// RPG Battle's Trade tab (0.5.37): selling, making and ordering, and collecting what was ordered.
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

const SLOT_CHOICES = [['', 'by its kind'], ['weapon', 'weapon'], ['offhand', 'off-hand'], ['armour', 'armour'], ['worn', 'worn'], ['accessory', 'accessory']];
const KIND_LABELS = { general: 'merchant', guild: 'guild buyer', apothecary: 'apothecary', smith: 'smith', crafter: 'crafter', fence: 'fence' };
const SOMEONE = '\u0000someone';

let draft = null;
let last = null;

function el(tag, { className, text, title, attrs } = {}, children = []) {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (title) {
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, String(value));
    for (const child of children) if (child) node.append(child);
    return node;
}

function icon(name) {
    return el('i', { className: `fa-solid ${name}`, attrs: { 'aria-hidden': 'true' } });
}

function button(label, className, { iconName, title, onClick, disabled = false } = {}) {
    const node = el('button', { className: `menu_button rpg-battle-button ${className}`.trim(), title });
    node.type = 'button';
    if (iconName) node.append(icon(iconName));
    if (label) node.append(el('span', { className: 'rpg-battle-button-label', text: label }));
    if (onClick) node.addEventListener('click', onClick);
    node.disabled = Boolean(disabled);
    return node;
}

function sub(label, iconName, count = null) {
    return el('div', { className: 'rpg-battle-sub' }, [
        icon(iconName),
        el('span', { text: label }),
        count === null ? null : el('span', { className: 'rpg-battle-count', text: String(count) }),
    ]);
}

function section(className, children) {
    return el('section', { className: `rpg-battle-section ${className}` }, children);
}

function option(value, label = value) {
    const node = el('option', { text: label });
    node.value = value;
    return node;
}

function select(className, label, choices, value) {
    const node = el('select', { className: `text_pole rpg-battle-select ${className}`, attrs: { 'aria-label': label } },
        choices.map(choice => (Array.isArray(choice) ? option(choice[0], choice[1]) : option(choice))));
    node.value = value;
    return node;
}

function textInput(className, value, { placeholder = '', label = '' } = {}) {
    const node = el('input', { className: `text_pole ${className}`, attrs: { type: 'text', placeholder, 'aria-label': label || placeholder } });
    node.value = value ?? '';
    return node;
}

function numberInput(className, value, { min = 1, max = 99, label = '' } = {}) {
    const node = el('input', { className: `text_pole ${className}`, attrs: { type: 'number', min, max, 'aria-label': label } });
    node.value = String(value);
    return node;
}

function qtyChoices(max) {
    return Array.from({ length: Math.max(1, Math.min(99, max)) }, (_, i) => [String(i + 1), String(i + 1)]);
}

// (0.5.38) A name in its rarity's colour: grey, green, blue, purple, gold (style.css --rb-rarity-*).
const RARITY_CLASSES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary']);
function itemName(name, rarity) {
    const known = RARITY_CLASSES.has(String(rarity ?? '').toLowerCase()) ? String(rarity).toLowerCase() : 'common';
    return el('span', { className: `rpg-trade-item-name rpg-rarity is-${known}`, text: name });
}

function redraw() {
    if (last) renderTradeTab(...last);
}

// (0.5.38) Who you trade with: a kind of trader at this place (the general store, the
// apothecary…), with a name if you like, or someone present, or anyone you name. Nobody needs to
// be in the scene: the place has its traders.
const TRADER_KINDS = ['general', 'apothecary', 'smith', 'crafter', 'fence', 'guild'];
const TRADER_LABELS = { general: 'General store', apothecary: 'Apothecary', smith: 'Smith', crafter: 'Crafter (bone-carver, tanner…)', fence: 'Fence', guild: 'Guild buyer' };
const TRADER_WHO = { general: 'the general store', apothecary: 'the apothecary', smith: 'the smith', crafter: 'the bone-carver', fence: 'a fence', guild: 'the guild' };

const freshDraft = view => ({ chatId: view.chatId ?? null, trader: 'kind:general', names: {}, name: '', kind: '', sell: {}, piece: '', picks: {}, slot: '', when: 'now', days: view.orderDays ?? 2, ready: '' });

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
        ? textInput('rpg-trade-name', kindPick ? draft.names[kindPick] ?? '' : draft.name, { placeholder: kindPick ? `name (optional), else ${TRADER_WHO[kindPick]}` : 'who, e.g. the bone-carver', label: 'Their name' })
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
    const level = select('rpg-trade-level', 'Prices here', [['', `as the place reads (${prices.tier})`], ['cheap', 'cheap'], ['fair', 'fair'], ['dear', 'dear']], view.level ?? '');
    level.addEventListener('change', () => handlers.onLevel?.(level.value || null));
    return section('rpg-trade-who', [
        sub('Trading with', 'fa-handshake'),
        el('div', { className: 'rpg-trade-row' }, [trader, nameBox, kind]),
        kind && !draft.kind && tradingWith() ? el('p', { className: 'rpg-battle-hint rpg-trade-guess', text: `Their trade, by the name: ${KIND_LABELS[guessed] ?? guessed}.` }) : null,
        el('p', { className: 'rpg-battle-hint rpg-trade-place', text: `${view.place || 'Somewhere'} · ${prices.tier} prices: goods ×${round(prices.buy)}, offers ×${round(prices.sell)}` }),
        el('div', { className: 'rpg-trade-row' }, [el('span', { className: 'rpg-battle-label', text: 'Prices here' }), level]),
    ]);
}

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
    const items = rows.map(item => {
        const qty = Math.min(Number(draft.sell[item.name] ?? 1), item.qty);
        const each = view.sellPrice?.(item.name, kind) ?? 0;
        const picker = item.qty > 1 ? select('rpg-trade-qty', `How many ${item.name}`, qtyChoices(item.qty), String(qty)) : null;
        picker?.addEventListener('change', () => { draft.sell[item.name] = Number(picker.value); redraw(); });
        return el('li', { className: 'rpg-trade-item' }, [
            el('div', { className: 'rpg-trade-item-head' }, [
                itemName(item.name, item.rarity),
                el('span', { className: 'rpg-battle-hint', text: `×${item.qty}${item.note ? ` · ${item.note}` : ''}` }),
            ]),
            el('div', { className: 'rpg-trade-item-actions' }, [
                picker,
                // The price once: the total, and what each fetches when it is more than one.
                button(`Sell${qty > 1 ? ` ${qty}` : ''} · ${view.money?.(each * qty) ?? each * qty}${qty > 1 ? ` (${view.money?.(each) ?? each} each)` : ''}`, 'rpg-trade-sell', {
                    iconName: 'fa-coins',
                    disabled: !tradingWith(),
                    title: tradingWith() ? `Sell to ${tradingWith()}: your next reply tells it.` : 'Say who you trade with first.',
                    onClick: () => handlers.onSell?.({ name: item.name, qty, each, who: tradingWith(), kind }),
                }),
            ]),
        ]);
    });
    return section('rpg-trade-sell-list', [
        sub('Sell', 'fa-coins', rows.length),
        rows.length ? el('ul', { className: 'rpg-trade-list' }, items) : el('p', { className: 'rpg-battle-empty', text: 'Nothing to sell: what you wear and what is on order stays.' }),
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
        items.length ? el('ul', { className: 'rpg-trade-list' }, items.map(item => el('li', { className: 'rpg-trade-item' }, [
            el('div', { className: 'rpg-trade-item-head' }, [itemName(item.name, item.rarity), item.note ? el('span', { className: 'rpg-battle-hint', text: item.note }) : null]),
            el('div', { className: 'rpg-trade-item-actions' }, [
                button(`Buy · ${view.money?.(item.price) ?? item.price}`, 'rpg-trade-buy', {
                    iconName: 'fa-cart-shopping',
                    disabled: item.price > (view.purse ?? 0),
                    title: item.price > (view.purse ?? 0) ? 'Your purse cannot pay for it.' : `Buy from ${who}: your next reply tells it.`,
                    onClick: () => handlers.onBuy?.({ name: item.name, who, kind }),
                }),
            ]),
        ]))) : el('p', { className: 'rpg-battle-empty', text: `${who} has nothing left to sell today.` }),
    ]);
}

function makeSection(view, handlers) {
    const materials = view.materials ?? [];
    const piece = textInput('rpg-trade-piece', draft.piece, { placeholder: 'what to make, e.g. Skull Ring', label: 'What to make' });
    piece.addEventListener('input', () => { draft.piece = piece.value; });
    piece.addEventListener('change', redraw);
    const picks = materials.map(item => {
        const chosen = Number(draft.picks[item.name] ?? 0);
        const box = el('input', { className: 'rpg-trade-pick', attrs: { type: 'checkbox', 'aria-label': `Use ${item.name}` } });
        box.checked = chosen > 0;
        box.addEventListener('change', () => { draft.picks[item.name] = box.checked ? 1 : 0; redraw(); });
        const many = chosen > 0 && item.qty > 1 ? select('rpg-trade-qty', `How many ${item.name}`, qtyChoices(item.qty), String(chosen)) : null;
        many?.addEventListener('change', () => { draft.picks[item.name] = Number(many.value); redraw(); });
        return el('li', { className: 'rpg-trade-item is-material' }, [
            el('label', { className: 'rpg-trade-item-head' }, [box, itemName(item.name, item.rarity), el('span', { className: 'rpg-battle-hint', text: `×${item.qty}${item.note ? ` · ${item.note}` : ''}` })]),
            many,
        ]);
    });
    const slot = select('rpg-trade-slot', 'Where it is worn', SLOT_CHOICES, draft.slot);
    slot.addEventListener('change', () => { draft.slot = slot.value; redraw(); });
    const when = select('rpg-trade-when', 'When', [['now', 'made now'], ['order', 'ordered, ready later']], draft.when);
    when.addEventListener('change', () => { draft.when = when.value; redraw(); });
    const days = draft.when === 'order' ? numberInput('rpg-trade-days', draft.days, { min: 1, max: 60, label: 'Ready in days' }) : null;
    days?.addEventListener('change', () => { draft.days = Math.max(1, Number(days.value) || 1); redraw(); });
    const chosen = Object.entries(draft.picks).filter(([, qty]) => qty > 0).map(([name, qty]) => ({ name, qty }));
    const preview = draft.piece.trim() && chosen.length ? view.preview?.({ name: draft.piece.trim(), materials: chosen, slot: draft.slot || null, days: draft.when === 'order' ? draft.days : 0, kind: tradeKind(view) }) : null;
    const who = tradingWith();
    const afford = preview ? preview.fee <= (view.purse ?? 0) : false;
    const why = !draft.piece.trim() ? 'Name the piece first.' : !chosen.length ? 'Pick what it is made from.' : !who ? 'Say who makes it first.' : !afford ? 'Your purse cannot pay the fee.' : '';
    const order = draft.when === 'order';
    return section('rpg-trade-make', [
        sub('Make or order', 'fa-hammer'),
        el('div', { className: 'rpg-trade-row' }, [piece]),
        materials.length ? el('ul', { className: 'rpg-trade-list' }, picks) : el('p', { className: 'rpg-battle-empty', text: 'No materials in the Inventory.' }),
        el('div', { className: 'rpg-trade-row' }, [el('span', { className: 'rpg-battle-label', text: 'Worn as' }), slot]),
        el('div', { className: 'rpg-trade-row' }, [el('span', { className: 'rpg-battle-label', text: 'When' }), when, days, days ? el('span', { className: 'rpg-battle-hint', text: 'days' }) : null]),
        preview ? el('p', { className: 'rpg-trade-preview', text: `${preview.name}: ${preview.note}${preview.ready ? ` · ready ${preview.ready}` : ''} · fee ${view.money?.(preview.fee) ?? preview.fee}` }) : null,
        button(order ? 'Order it' : 'Make it', 'rpg-trade-craft', {
            iconName: order ? 'fa-clock' : 'fa-hammer',
            disabled: Boolean(why),
            title: why || `${order ? 'Order' : 'Have'} ${draft.piece.trim()} ${order ? 'from' : 'made by'} ${who}: your next reply tells it.`,
            onClick: () => {
                handlers.onCraft?.({ name: draft.piece.trim(), materials: chosen, slot: draft.slot || null, days: order ? draft.days : 0, who, kind: tradeKind(view) });
                draft = { ...draft, piece: '', picks: {} };
            },
        }),
        why ? el('p', { className: 'rpg-battle-hint', text: why }) : null,
    ]);
}

function ordersSection(view, handlers) {
    const orders = view.orders ?? [];
    if (!orders.length) return null;
    return section('rpg-trade-orders', [
        sub('On order', 'fa-clock', orders.length),
        el('ul', { className: 'rpg-trade-list' }, orders.map(item => el('li', { className: 'rpg-trade-item' }, [
            el('div', { className: 'rpg-trade-item-head' }, [itemName(item.name, item.rarity), el('span', { className: 'rpg-battle-hint', text: item.note ?? '' })]),
            el('div', { className: 'rpg-trade-item-actions' }, [
                button('Collect', 'rpg-trade-collect', { iconName: 'fa-box-open', title: `Collect ${item.name}: your next reply tells it.`, onClick: () => handlers.onCollect?.({ name: item.name, who: item.with || tradingWith() }) }),
            ]),
        ]))),
    ]);
}

function pendingSection(view) {
    const lines = view.pending ?? [];
    if (!lines.length) return null;
    return section('rpg-trade-pending', [
        sub('Told in your next reply', 'fa-feather', lines.length),
        el('ul', { className: 'rpg-trade-told' }, lines.map(line => el('li', { text: line }))),
        el('p', { className: 'rpg-battle-hint', text: 'Already in the Inventory. Delete or swipe the latest reply to take it back.' }),
    ]);
}

/**
 * Draws the Trade tab. `view`: { chatId, ready, reason, place, prices, level, people,
 * purse, purseText, sellable, materials, orders, pending, orderDays, money(amount),
 * sellPrice(name, kind), preview({ name, materials, slot, days, kind }) → { name, note, fee,
 * ready } | null, buyerKind(name), stock(kind) → [{ name, note, price, rarity }] (0.5.38) }.
 * `handlers`: onBuy, onSell, onCraft, onCollect, onLevel.
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
    // The purse first, and kept in view while the lists scroll.
    root.append(el('p', { className: 'rpg-trade-purse', text: `Purse: ${view.purseText || 'nothing'}` }));
    root.append(...[whoSection(view, handlers), pendingSection(view), buySection(view, handlers), sellSection(view, handlers), makeSection(view, handlers), ordersSection(view, handlers)].filter(Boolean));
    pane.replaceChildren(root);
}

/** Forget the half-made choice (a new chat). */
export function resetTradeDraft() {
    draft = null;
}
