// Minimal fake DOM for the UI tests (no jsdom, no dependencies). Extends Inventory
// Block's FakeElement with what the card needs: real tree moves (insertBefore/before
// detach from the old parent), text nodes, capture/bubble click dispatch, inline
// style, and a small selector engine (compound selectors, descendant and child
// combinators, :scope, :not(), [attr="value"], comma lists).

function splitTop(source, isSeparator) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current = '';
    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        if (quote) {
            current += char;
            if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === '\'') quote = char;
        else if (char === '[' || char === '(') depth += 1;
        else if (char === ']' || char === ')') depth -= 1;
        const separator = depth === 0 && isSeparator(char);
        if (separator) {
            parts.push(current);
            parts.push(char);
            current = '';
        } else current += char;
    }
    parts.push(current);
    return parts;
}

function parseCompound(source) {
    const compound = { tag: null, classes: [], ids: [], attrs: [], nots: [], scope: false };
    let rest = source;
    while (rest) {
        let match;
        if ((match = /^\*/.exec(rest))) { /* any */ } else if ((match = /^[a-zA-Z][\w-]*/.exec(rest))) compound.tag = match[0].toUpperCase();
        else if ((match = /^\.([\w-]+)/.exec(rest))) compound.classes.push(match[1]);
        else if ((match = /^#([\w-]+)/.exec(rest))) compound.ids.push(match[1]);
        else if ((match = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) compound.attrs.push([match[1], match[2]]);
        else if ((match = /^:scope/.exec(rest))) compound.scope = true;
        else if (rest.startsWith(':not(')) {
            let depth = 0;
            let end = 4;
            for (; end < rest.length; end += 1) {
                if (rest[end] === '(') depth += 1;
                else if (rest[end] === ')' && --depth === 0) break;
            }
            compound.nots.push(parseCompound(rest.slice(5, end)));
            rest = rest.slice(end + 1);
            continue;
        } else throw new Error(`fake DOM: unsupported selector "${source}"`);
        rest = rest.slice(match[0].length);
    }
    return compound;
}

function parseComplex(source) {
    const tokens = splitTop(source.trim(), char => char === ' ' || char === '>');
    const parts = [];
    let combinator = ' ';
    for (const token of tokens) {
        if (token === '>') combinator = '>';
        else if (token === ' ' || token === '') continue;
        else {
            parts.push({ compound: parseCompound(token), combinator });
            combinator = ' ';
        }
    }
    return parts;
}

function parseSelector(selector) {
    return splitTop(selector, char => char === ',').filter(part => part !== ',' && part.trim()).map(parseComplex);
}

function matchCompound(node, compound, scope) {
    if (node.nodeType !== 1) return false;
    if (compound.tag && node.tagName !== compound.tag) return false;
    if (compound.scope && node !== scope) return false;
    if (!compound.classes.every(name => node.classList.contains(name))) return false;
    if (!compound.ids.every(id => node.id === id)) return false;
    if (!compound.attrs.every(([name, value]) => (value === undefined ? node.hasAttribute(name) : node.getAttribute(name) === value))) return false;
    return compound.nots.every(not => !matchCompound(node, not, scope));
}

function matchComplex(node, parts, index, scope) {
    if (!matchCompound(node, parts[index].compound, scope)) return false;
    if (index === 0) return true;
    if (parts[index].combinator === '>') return Boolean(node.parentElement) && matchComplex(node.parentElement, parts, index - 1, scope);
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (matchComplex(ancestor, parts, index - 1, scope)) return true;
    }
    return false;
}

const dataKey = name => name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
const dataName = key => `data-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`;

class FakeNode {
    constructor(doc) {
        this.ownerDocument = doc;
        this.parentNode = null;
    }
    get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    get isConnected() {
        let node = this;
        while (node.parentNode) node = node.parentNode;
        return node === this.ownerDocument.body;
    }
    remove() {
        if (!this.parentNode) return;
        const siblings = this.parentNode.childNodes;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentNode = null;
    }
    before(...nodes) {
        const parent = this.parentNode;
        for (const node of nodes) parent.insertBefore(node, this);
    }
}

export class FakeText extends FakeNode {
    constructor(doc, text) {
        super(doc);
        this.nodeType = 3;
        this.data = String(text);
    }
    get textContent() { return this.data; }
    set textContent(value) { this.data = String(value); }
}

export class FakeElement extends FakeNode {
    constructor(doc, tag) {
        super(doc);
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.childNodes = [];
        this.attributes = {};
        this.dataset = {};
        this.listeners = [];
        this.styleProps = {};
        const element = this;
        this.style = {
            display: '',
            width: '',
            setProperty(name, value) { element.styleProps[name] = String(value); },
            getPropertyValue(name) { return element.styleProps[name] ?? ''; },
        };
        this.className = '';
        this.id = '';
        this.value = '';
        this.open = false;
        this.scrollTop = 0;
        this.scrollLeft = 0;
        this.offsetLeft = 0;
        this.html = '';
        this.classList = {
            add: (...names) => names.forEach(name => { if (!element.classes().includes(name)) element.className = `${element.className} ${name}`.trim(); }),
            remove: (...names) => { element.className = element.classes().filter(item => !names.includes(item)).join(' '); },
            toggle: (name, force) => {
                const on = force === undefined ? !element.classes().includes(name) : Boolean(force);
                if (on) element.classList.add(name);
                else element.classList.remove(name);
                return on;
            },
            contains: name => element.classes().includes(name),
        };
    }
    classes() { return String(this.className).split(/\s+/).filter(Boolean); }
    // Failed assertions print elements; the real graph is circular and huge.
    [Symbol.for('nodejs.util.inspect.custom')]() {
        return `<${this.tagName.toLowerCase()}${this.className ? ` class="${this.className}"` : ''}${this.dataset.tabId ? ` data-tab-id="${this.dataset.tabId}"` : ''}>`;
    }
    get children() { return this.childNodes.filter(node => node.nodeType === 1); }
    get firstElementChild() { return this.children[0] ?? null; }
    get nextElementSibling() {
        const siblings = this.parentNode?.children ?? [];
        return siblings[siblings.indexOf(this) + 1] ?? null;
    }
    set textContent(value) {
        this.childNodes.forEach(node => { node.parentNode = null; });
        this.childNodes = [];
        const text = String(value ?? '');
        if (text) this.appendChild(new FakeText(this.ownerDocument, text));
    }
    get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
    // innerHTML is only used by the simulated NPC State Delta bridge; markup is kept as a string.
    set innerHTML(value) {
        this.textContent = '';
        this.html = String(value);
    }
    get innerHTML() { return this.html || this.childNodes.map(child => child.textContent).join(''); }

    getAttribute(name) {
        if (name.startsWith('data-')) return this.dataset[dataKey(name)] ?? null;
        if (name === 'id') return this.id || null;
        if (name === 'class') return this.className;
        return name in this.attributes ? this.attributes[name] : null;
    }
    setAttribute(name, value) {
        if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value);
        else if (name === 'id') this.id = String(value);
        else if (name === 'class') this.className = String(value);
        else this.attributes[name] = String(value);
    }
    hasAttribute(name) { return this.getAttribute(name) !== null; }
    removeAttribute(name) {
        if (name.startsWith('data-')) delete this.dataset[dataKey(name)];
        else delete this.attributes[name];
    }
    attributeNames() { return [...Object.keys(this.attributes), ...Object.keys(this.dataset).map(dataName)]; }

    insertBefore(node, reference) {
        if (node === reference) return node;
        node.remove();
        const index = reference ? this.childNodes.indexOf(reference) : -1;
        node.parentNode = this;
        if (index < 0) this.childNodes.push(node);
        else this.childNodes.splice(index, 0, node);
        return node;
    }
    appendChild(node) { return this.insertBefore(node, null); }
    append(...nodes) { nodes.forEach(node => this.appendChild(typeof node === 'string' ? new FakeText(this.ownerDocument, node) : node)); }
    prepend(node) { this.insertBefore(node, this.childNodes[0] ?? null); }
    replaceChildren(...nodes) {
        this.childNodes.forEach(node => { node.parentNode = null; });
        this.childNodes = [];
        this.html = '';
        this.append(...nodes);
    }

    addEventListener(type, fn, options) {
        const capture = options === true || Boolean(options?.capture);
        this.listeners.push({ type, fn, capture });
    }
    removeEventListener(type, fn) { this.listeners = this.listeners.filter(entry => entry.type !== type || entry.fn !== fn); }
    dispatch(type, init = {}) {
        const event = {
            type,
            target: this,
            currentTarget: null,
            defaultPrevented: false,
            stopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.stopped = true; },
            ...init,
        };
        const path = [];
        for (let node = this; node; node = node.parentNode) path.push(node);
        const run = (node, capture) => {
            event.currentTarget = node;
            for (const entry of [...node.listeners]) {
                if (entry.type === type && entry.capture === capture) entry.fn.call(node, event);
            }
        };
        for (const node of [...path].reverse().slice(0, -1)) {
            run(node, true);
            if (event.stopped) return event;
        }
        // At target: capture and bubble listeners both run, in registration order.
        event.currentTarget = this;
        for (const entry of [...this.listeners]) if (entry.type === type) entry.fn.call(this, event);
        if (event.stopped) return event;
        for (const node of path.slice(1)) {
            run(node, false);
            if (event.stopped) break;
        }
        return event;
    }
    click() { return this.dispatch('click'); }
    focus() { this.ownerDocument.activeElement = this; }
    blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }

    contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    matches(selector) { return parseSelector(selector).some(parts => matchComplex(this, parts, parts.length - 1, this)); }
    closest(selector) {
        for (let node = this; node && node.nodeType === 1; node = node.parentNode) if (node.matches(selector)) return node;
        return null;
    }
    querySelectorAll(selector) {
        const lists = parseSelector(selector);
        return this.descendants().filter(node => lists.some(parts => matchComplex(node, parts, parts.length - 1, this)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

/** Fresh document installed on globalThis (document, CSS). */
export function installFakeDom() {
    const doc = {
        activeElement: null,
        createElement: tag => new FakeElement(doc, tag),
        createElementNS: (namespace, tag) => new FakeElement(doc, tag),
        createTextNode: text => new FakeText(doc, text),
        querySelectorAll: selector => doc.body.querySelectorAll(selector),
        querySelector: selector => doc.body.querySelector(selector),
    };
    doc.body = new FakeElement(doc, 'body');
    globalThis.document = doc;
    globalThis.CSS = { escape: value => String(value).replace(/"/g, '\\"') };
    return doc;
}

/** `div.mes[mesid] > div.mes_block > div.mes_text`, attached to the body. */
export function makeMessage(doc, id = 1) {
    const message = doc.createElement('div');
    message.className = 'mes';
    message.setAttribute('mesid', String(id));
    const block = doc.createElement('div');
    block.className = 'mes_block';
    const text = doc.createElement('div');
    text.className = 'mes_text';
    text.textContent = 'Story text.';
    block.appendChild(text);
    message.appendChild(block);
    doc.body.appendChild(message);
    return message;
}

// Identity, not structure: two different panes can look alike.
export function same(actual, expected, message) {
    if (actual !== expected) throw new Error(`${message ?? 'not the same node'}`);
}
export const sameList = (actual, expected, message) => {
    if (actual.length !== expected.length || actual.some((node, index) => node !== expected[index])) throw new Error(message ?? 'node lists differ');
};

export const texts = (root, selector) => root.querySelectorAll(selector).map(node => node.textContent);
export const visible = node => node.style.display !== 'none';
