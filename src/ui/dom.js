// RPG Battle's small DOM helpers, shared by its tabs (0.5.39): every node filled through
// textContent, SillyTavern's menu_buttons, the quiet section labels. Names and notes come from
// the model, so nothing here ever takes HTML.

export function el(tag, { className, text, title, attrs } = {}, children = []) {
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

export function icon(name) {
    return el('i', { className: `fa-solid ${name}`, attrs: { 'aria-hidden': 'true' } });
}

export function button(label, className, { iconName, title, onClick, disabled = false } = {}) {
    const node = el('button', { className: `menu_button rpg-battle-button ${className}`.trim(), title });
    node.type = 'button';
    if (iconName) node.append(icon(iconName));
    if (label) node.append(el('span', { className: 'rpg-battle-button-label', text: label }));
    if (onClick) node.addEventListener('click', onClick);
    node.disabled = Boolean(disabled);
    return node;
}

/** The quiet section label: an icon, then the name in small capitals. */
export function sub(label, iconName, count = null) {
    return el('div', { className: 'rpg-battle-sub' }, [
        icon(iconName),
        el('span', { text: label }),
        count === null ? null : el('span', { className: 'rpg-battle-count', text: String(count) }),
    ]);
}

export function section(className, children) {
    return el('section', { className: `rpg-battle-section ${className}` }, children);
}

export function option(value, label = value) {
    const node = el('option', { text: label });
    node.value = value;
    return node;
}

export function select(className, label, choices, value) {
    const node = el('select', { className: `text_pole rpg-battle-select ${className}`, attrs: { 'aria-label': label } },
        choices.map(choice => (Array.isArray(choice) ? option(choice[0], choice[1]) : option(choice))));
    node.value = value;
    return node;
}
