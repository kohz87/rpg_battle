// RPG Battle v2, items part: the Items page (MODULES §B2), a plain list for now. The screens are
// being redesigned (declarative layouts), so this is a minimal renderer with no styling: one row
// per thing the party holds, with Use (a target to pick), Equip or Take off, and Give. Every
// click is one command; the page stays as it is and re-renders from the new head state, so a
// second click is a second dose.

import { helpsOutside, inventoryOf, partyOf, stackIds } from './shared.js';

function node(doc, tag, { className = '', text = '', data = {} } = {}) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    for (const [key, value] of Object.entries(data)) el.setAttribute(`data-${key}`, value);
    return el;
}

function actorSelect(doc, party, ids, className) {
    const select = node(doc, 'select', { className });
    for (const id of ids) {
        const option = node(doc, 'option', { text: party.actors[id]?.name ?? id });
        option.value = id;
        select.appendChild(option);
    }
    select.value = ids[0] ?? '';
    return select;
}

/** The party's people in display order (pc first), then anyone the order leaves out. */
function peopleOf(party) {
    const order = (party.order ?? []).filter(id => party.actors?.[id]);
    return [...order, ...Object.keys(party.actors ?? {}).sort().filter(id => !order.includes(id))];
}

function sendCommand(api, type, payload) {
    const send = typeof api?.command === 'function' ? api.command.bind(api) : globalThis.StoryBlock?.sdk?.command?.bind(globalThis.StoryBlock.sdk);
    if (!send) return Promise.resolve({ ok: false, message: 'Story Block is not ready.' });
    return Promise.resolve(send(type, payload, { cause: 'ui' }));
}

/** Renders the Items page into `el` from `view.state`; `api.command` sends the clicks. */
export function renderItems(el, view, api = {}, status = '') {
    const doc = el.ownerDocument ?? globalThis.document;
    const state = view?.state;
    const inventory = inventoryOf(state);
    const party = partyOf(state);
    const people = peopleOf(party);
    const holders = ['party', ...people];
    const rows = stackIds(inventory)
        .map(id => inventory.stacks[id])
        .filter(stack => stack.qty > 0 && holders.includes(stack.owner) && inventory.defs?.[stack.def]?.kind !== 'money')
        .sort((a, b) => holders.indexOf(a.owner) - holders.indexOf(b.owner));

    const root = node(doc, 'div', { className: 'rb-items' });
    const line = node(doc, 'div', { className: 'rb-items-status', text: status });
    if (!rows.length) root.appendChild(node(doc, 'div', { className: 'rb-items-empty', text: 'The party carries nothing to use, wear or give.' }));
    for (const stack of rows) {
        const def = inventory.defs[stack.def];
        const row = node(doc, 'div', { className: 'rb-item', data: { stack: stack.id } });
        const who = stack.owner === 'party' ? 'shared' : party.actors[stack.owner]?.name ?? '';
        row.appendChild(node(doc, 'span', { className: 'rb-item-name', text: `${def.name}${stack.qty > 1 ? ` ×${stack.qty}` : ''}${stack.equipped ? ' (worn)' : ''}${who ? ` · ${who}` : ''}` }));
        const act = (type, payload) => {
            const button = node(doc, 'button', { className: 'rb-item-act', text: { 'item.use': 'Use', 'item.equip': 'Equip', 'item.unequip': 'Take off', 'item.give': 'Give' }[type], data: { act: type } });
            button.addEventListener('click', () => sendCommand(api, type, payload()).then(result => {
                const told = result?.ok ? result.receipt?.summary ?? 'Done.' : result?.message ?? 'That did not work.';
                const next = typeof api?.view === 'function' ? api.view() : null;
                if (next) renderItems(el, next, api, told);
                else line.textContent = told;
            }));
            return button;
        };
        if (def.kind === 'consumable' && helpsOutside(def.effect) && people.length) {
            const target = actorSelect(doc, party, people, 'rb-item-target');
            row.append(target, act('item.use', () => ({ stack: stack.id, target: target.value })));
        }
        if (def.kind === 'equipment') {
            row.appendChild(stack.equipped ? act('item.unequip', () => ({ stack: stack.id })) : act('item.equip', () => ({ stack: stack.id })));
        }
        const others = people.filter(id => id !== (stack.owner === 'party' ? party.pc : stack.owner));
        if (others.length) {
            const to = actorSelect(doc, party, others, 'rb-item-to');
            row.append(to, act('item.give', () => ({ stack: stack.id, to: to.value })));
        }
        root.appendChild(row);
    }
    root.appendChild(line);
    el.replaceChildren(root);
    return root;
}

export const itemsTab = Object.freeze({ id: 'items', title: 'Items', icon: 'fa-flask', render: (el, view, api) => renderItems(el, view, api) });
