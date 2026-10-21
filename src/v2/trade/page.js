// RPG Battle v2, trade part: the Trade page, plain (the UI is being redesigned; this is the
// minimal working page until the coordinator's UI spec). One line per thing, short prices in
// the chat's coins (v1 formatMoneyShort), every action a command through `api.command`.
// Rendered from the head state only; it never reads message text. Nodes are filled through
// textContent: names and notes may be the story's.

import { formatMoneyShort } from '../../items.js';
import { COMMISSIONERS, isMaterial } from '../../trade.js';
import { TRADER_KINDS, TRADER_WHO, legacyItem, marketOf, money, ordersOf, planSell, stockOf, worldFromState } from './core.js';

// The trader chosen on each pane, kept while the page is redrawn.
const chosen = new WeakMap();

function node(tag, text = null, className = '') {
    const out = globalThis.document.createElement(tag);
    if (className) out.className = className;
    if (text !== null) out.textContent = String(text);
    return out;
}

function actionButton(label, title, onClick, disabled = false) {
    const out = node('button', label, 'menu_button rpg-trade-action');
    out.type = 'button';
    out.title = title;
    out.setAttribute('aria-label', title);
    out.disabled = Boolean(disabled);
    out.addEventListener('click', onClick);
    return out;
}

function row(name, note, action) {
    const out = node('li', null, 'rpg-trade-row');
    out.append(node('span', name, 'rpg-trade-name'));
    if (note) out.append(node('span', ` · ${note}`, 'rpg-trade-note'));
    if (action) out.append(action);
    return out;
}

function list(title, rows, empty) {
    const out = node('section', null, 'rpg-trade-section');
    out.append(node('h4', title));
    if (rows.length) {
        const ul = node('ul', null, 'rpg-trade-list');
        ul.append(...rows);
        out.append(ul);
    } else out.append(node('p', empty, 'rpg-trade-empty'));
    return out;
}

// A command from a button: the reader sees why when it is refused.
function send(api, pane, type, payload) {
    const run = typeof api?.command === 'function' ? api.command(type, payload, { cause: 'ui' }) : null;
    Promise.resolve(run).then(result => {
        if (result && result.ok === false) {
            const said = pane.querySelector?.('.rpg-trade-problem');
            if (said) said.textContent = result.message ?? 'That could not be done.';
        }
    }).catch(() => {});
}

/**
 * Draws the Trade page into `pane` from `view` ({ state, settings, query }); `api.command(type,
 * payload)` runs trade.buy / trade.sell / craft.commission / craft.collect.
 */
export function renderTradePage(pane, view = {}, api = {}) {
    if (!pane) return;
    const world = worldFromState(view.state, { settings: view.settings, query: view.query ?? null });
    const market = marketOf(world);
    const root = node('div', null, 'rpg-trade-page');
    const where = market.place || 'Somewhere';
    root.append(node('p', market.open ? `${where} · ${market.level ? `${market.level} prices` : `${market.tier} prices`}` : `No market here (${where}). Trade in a settlement, or with a trader on the road.`, 'rpg-trade-place'));
    root.append(node('p', '', 'rpg-trade-problem'));
    const short = amount => formatMoneyShort(amount, world.currency);

    if (market.open) {
        const kind = chosen.get(pane) ?? 'general';
        const pick = node('select', null, 'text_pole rpg-trade-kind');
        pick.setAttribute('aria-label', 'Trading with');
        for (const each of TRADER_KINDS) {
            const option = node('option', TRADER_WHO[each]);
            option.value = each;
            pick.append(option);
        }
        pick.value = kind;
        pick.addEventListener('change', () => {
            chosen.set(pane, pick.value);
            renderTradePage(pane, view, api);
        });
        root.append(pick);

        const stock = stockOf(world, kind);
        root.append(list(`Buy from ${TRADER_WHO[kind]}`, stock.items.map(item => row(item.def.name, item.note,
            actionButton(short(item.price), `Buy ${item.def.name} · ${money(world, item.price)}`, () => send(api, pane, 'trade.buy', { shop: stock.shop, def: item.def.id, qty: 1 })))), 'Nothing left to sell today.'));

        const stacks = Object.values(world.inventory.stacks).filter(stack => stack.qty > 0 && !stack.equipped && world.inventory.defs[stack.def] && !['money', 'quest'].includes(world.inventory.defs[stack.def].kind));
        const quote = stack => {
            const plan = planSell(world, { stack: stack.id, qty: 1, kind });
            return plan.ok ? plan.each : null;
        };
        root.append(list('Sell', stacks.map(stack => {
            const def = world.inventory.defs[stack.def];
            const each = quote(stack);
            return row(def.name, stack.qty > 1 ? `×${stack.qty}` : def.note,
                actionButton(each === null ? 'Sell' : short(each), `Sell one ${def.name}${each === null ? '' : ` · ${money(world, each)}`}`, () => send(api, pane, 'trade.sell', { stack: stack.id, qty: 1, kind })));
        }), 'Nothing to sell: what is worn stays.'));

        if (COMMISSIONERS.includes(kind)) {
            const materials = stacks.filter(stack => isMaterial(legacyItem(world.inventory.defs[stack.def])));
            const section = node('section', null, 'rpg-trade-section rpg-trade-commission');
            section.append(node('h4', 'Commission'));
            const name = node('input', null, 'text_pole rpg-trade-piece');
            name.type = 'text';
            name.setAttribute('placeholder', 'what to have made, e.g. Skull Ring');
            section.append(name);
            const boxes = materials.map(stack => {
                const label = node('label', null, 'rpg-trade-material');
                const box = node('input');
                box.type = 'checkbox';
                box.value = stack.id;
                label.append(box, node('span', ` ${world.inventory.defs[stack.def].name}`));
                section.append(label);
                return box;
            });
            if (!materials.length) section.append(node('p', 'No materials in the inventory.', 'rpg-trade-empty'));
            section.append(actionButton('Commission it', `Have ${TRADER_WHO[kind]} make it: they say when it is ready.`, () => {
                const picked = boxes.filter(box => box.checked).map(box => ({ stack: box.value, qty: 1 }));
                send(api, pane, 'craft.commission', { piece: name.value, materials: picked, crafter: kind });
            }, !materials.length));
            root.append(section);
        }
    }

    const orders = ordersOf(world);
    if (orders.length) {
        root.append(list('On order', orders.map(order => row(order.piece?.name ?? 'A piece', order.crafter,
            order.due && market.open
                ? actionButton('Collect', `Collect ${order.piece?.name ?? 'it'}`, () => send(api, pane, 'craft.collect', { order: order.id }))
                : node('span', order.due ? 'ready: collect at a market' : 'not ready yet', 'rpg-trade-ready'))), ''));
    }
    pane.replaceChildren(root);
}
