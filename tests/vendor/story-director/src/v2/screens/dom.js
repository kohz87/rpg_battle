// Story Director v2, part screens: the few DOM helpers its widgets share. Text only ever goes in as text
// (textContent), never as markup (WAVE rule 7).

/** `make(doc)(tag, className?, text?, attrs?)`: an element with its class, text and attributes. */
export const maker = doc => (tag, className = '', text = undefined, attrs = {}) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    for (const [name, value] of Object.entries(attrs)) if (value !== undefined && value !== null && value !== false) node.setAttribute(name, String(value));
    return node;
};

/** A button with a Font Awesome icon and its label; `onClick` runs on a click. */
export function button(make, label, className, icon, onClick) {
    const node = make('button', `ss-button sd-btn ${className}`.trim(), undefined, { type: 'button' });
    if (icon) node.append(make('i', `fa-solid ${icon}`, undefined, { 'aria-hidden': 'true' }), ' ');
    node.append(make('span', '', label));
    node.addEventListener('click', event => {
        event?.stopPropagation?.();
        onClick?.(event);
    });
    return node;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Nodes with a space between each, so the text reads (and copies) as words, not run together. */
export const spaced = nodes => nodes.flatMap((node, at) => (at ? [' ', node] : [node]));
