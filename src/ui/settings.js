// RPG Battle's panel under Extensions: the on/off switch, the money, and the block tags.
//
// Small on purpose: everything about a character happens in the Battle tab. Money follows the
// reader's world (DESIGN §8.3): copper/silver/gold, one coin, or their own names and rates.

const CURRENCY_MODES = [
    { value: 'tiers', label: 'Copper / silver / gold, or your own coins' },
    { value: 'single', label: 'One coin' },
];

function el(tag, { className, text, attrs } = {}, children = []) {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
    for (const child of children) if (child) node.append(child);
    return node;
}

function input(id, value, placeholder = '') {
    const node = el('input', { className: 'text_pole rpg-battle-settings-input', attrs: { id, type: 'text' } });
    node.value = value ?? '';
    if (placeholder) node.placeholder = placeholder;
    return node;
}

function row(label, hint, control, id) {
    return el('div', { className: 'rpg-battle-settings-row' }, [
        el('label', { className: 'rpg-battle-settings-label', text: label, attrs: id ? { for: id } : {} }),
        hint ? el('small', { className: 'rpg-battle-settings-hint', text: hint }) : null,
        control,
    ]);
}

/** "copper=1, silver=10, gold=10" ⇄ [{ name, rate }]. */
export function tiersToText(tiers) {
    return (tiers ?? []).map(tier => `${tier.name}=${tier.rate}`).join(', ');
}

export function textToTiers(text) {
    const tiers = String(text ?? '').split(/[,;\n]/).map(part => {
        const match = /^\s*([^=]+?)\s*=\s*(\d+(?:\.\d+)?)\s*$/.exec(part) ?? /^\s*(\S.*?)\s*$/.exec(part);
        if (!match) return null;
        const rate = match[2] === undefined ? 1 : Math.max(1, Math.round(Number(match[2])));
        return { name: match[1].trim(), rate };
    }).filter(tier => tier && tier.name);
    if (tiers.length) tiers[0] = { ...tiers[0], rate: 1 };
    return tiers;
}

export function renderSettings(container, { settings, version = '', status = '', onChange } = {}) {
    let current = structuredClone(settings ?? {});
    const commit = change => {
        change(current);
        onChange?.(structuredClone(current));
    };

    const enabled = el('input', { attrs: { id: 'rpg_battle_enabled', type: 'checkbox' } });
    enabled.checked = current.enabled !== false;
    enabled.addEventListener('change', () => commit(next => { next.enabled = enabled.checked; }));

    const mode = el('select', { className: 'text_pole rpg-battle-settings-input', attrs: { id: 'rpg_battle_currency_mode' } },
        CURRENCY_MODES.map(option => {
            const node = el('option', { text: option.label });
            node.value = option.value;
            return node;
        }));
    mode.value = current.currency?.mode === 'single' ? 'single' : 'tiers';
    const tiers = input('rpg_battle_currency_tiers', tiersToText(current.currency?.tiers), 'copper=1, silver=10, gold=10');
    const single = input('rpg_battle_currency_single', current.currency?.single, 'coins');
    const moneyRow = input('rpg_battle_currency_row', current.currency?.row, 'Coins');
    const tiersRow = row('Coins', 'Smallest first; each rate is how many of the one before make one of this.', tiers, 'rpg_battle_currency_tiers');
    const singleRow = row('Coin name', '', single, 'rpg_battle_currency_single');
    const sync = () => {
        tiersRow.hidden = mode.value !== 'tiers';
        singleRow.hidden = mode.value !== 'single';
    };
    mode.addEventListener('change', () => {
        sync();
        commit(next => { next.currency = { ...next.currency, mode: mode.value }; });
    });
    tiers.addEventListener('change', () => {
        const parsed = textToTiers(tiers.value);
        if (!parsed.length) return;
        tiers.value = tiersToText(parsed);
        commit(next => { next.currency = { ...next.currency, tiers: parsed }; });
    });
    single.addEventListener('change', () => commit(next => { next.currency = { ...next.currency, single: single.value.trim() || 'coins' }; }));
    moneyRow.addEventListener('change', () => commit(next => { next.currency = { ...next.currency, row: moneyRow.value.trim() || 'Coins' }; }));

    const tag = (id, key, label, hint) => {
        const node = input(id, current[key]);
        node.addEventListener('change', () => commit(next => { next[key] = node.value.trim() || next[key]; }));
        return row(label, hint, node, id);
    };
    const returnMessage = input('rpg_battle_return', current.returnMessage);
    returnMessage.addEventListener('change', () => commit(next => { next.returnMessage = returnMessage.value; }));

    const root = el('div', { className: 'rpg-battle-settings' }, [
        el('div', { className: 'inline-drawer' }, [
            el('div', { className: 'inline-drawer-toggle inline-drawer-header' }, [
                el('b', {}, [globalThis.document.createTextNode('RPG Battle'), version ? el('span', { className: 'rpg-battle-version', text: ` ${version}` }) : null]),
                el('div', { className: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }),
            ]),
            el('div', { className: 'inline-drawer-content' }, [
                status ? el('div', { className: 'rpg-battle-settings-status', text: status }) : null,
                el('label', { className: 'checkbox_label', attrs: { for: 'rpg_battle_enabled' } }, [enabled, el('span', { text: 'Battles on (the Battle tab in Story Block)' })]),
                el('div', { className: 'rpg-battle-settings-head', text: 'Money' }),
                row('Currency', 'Loot is written in it.', mode, 'rpg_battle_currency_mode'),
                tiersRow,
                singleRow,
                row('Inventory row', 'The Inventory row that holds your money.', moneyRow, 'rpg_battle_currency_row'),
                el('div', { className: 'rpg-battle-settings-head', text: 'Blocks' }),
                tag('rpg_battle_character_tag', 'characterTag', 'Character tag', 'The kept block with your sheet.'),
                tag('rpg_battle_party_tag', 'partyTag', 'Party tag', 'The kept block with your companions.'),
                tag('rpg_battle_inventory_tag', 'inventoryTag', 'Inventory tag', 'Your Story Block inventory (equipment, consumables, loot).'),
                row('Return to story', 'Sent for you after a fight so the narration comes straight away. Empty: send nothing.', returnMessage, 'rpg_battle_return'),
            ]),
        ]),
    ]);
    sync();
    container.replaceChildren(root);
    return { update(next) { current = structuredClone(next); } };
}
