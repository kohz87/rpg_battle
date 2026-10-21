// A small fake DOM for the screens tests (no jsdom, no dependencies): HTML and SVG elements, attributes
// (data-* included), class lists, inline custom properties, text, events that bubble, `value` /
// `checked` / `disabled` / `open` as properties, and a selector engine for what the tests ask
// (tag, #id, .class, [attr], [attr="value"], descendant and child combinators, lists with commas).
// Enough for Story Block's template renderer and its standard widgets (meter, badge, portrait,
// radar, skill-tree, stepper). Setting innerHTML throws: nothing here may parse markup.

const HTML_NS = 'http://www.w3.org/1999/xhtml';

class Node {
    constructor(doc) {
        this.ownerDocument = doc;
        this.parentNode = null;
    }
    get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    get nextSibling() {
        const list = this.parentNode?.childNodes ?? [];
        return list[list.indexOf(this) + 1] ?? null;
    }
    remove() {
        if (!this.parentNode) return;
        const list = this.parentNode.childNodes;
        list.splice(list.indexOf(this), 1);
        this.parentNode = null;
    }
}

class Text extends Node {
    constructor(doc, text) {
        super(doc);
        this.nodeType = 3;
        this.data = String(text);
    }
    get textContent() { return this.data; }
    set textContent(value) { this.data = String(value ?? ''); }
}

class Element extends Node {
    constructor(doc, tag, namespaceURI = HTML_NS) {
        super(doc);
        this.nodeType = 1;
        this.namespaceURI = namespaceURI;
        this.localName = namespaceURI === HTML_NS ? String(tag).toLowerCase() : String(tag);
        this.tagName = namespaceURI === HTML_NS ? this.localName.toUpperCase() : this.localName;
        this.childNodes = [];
        this.attrs = new Map();
        this.listeners = [];
        this.styleProps = {};
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.open = false;
        const element = this;
        this.style = {
            setProperty(name, value) { element.styleProps[name] = String(value); },
            removeProperty(name) { delete element.styleProps[name]; },
            getPropertyValue(name) { return element.styleProps[name] ?? ''; },
        };
        this.classList = {
            add: (...names) => element.setClasses([...element.classes(), ...names]),
            remove: (...names) => element.setClasses(element.classes().filter(name => !names.includes(name))),
            toggle: (name, force) => {
                const on = force === undefined ? !element.classes().includes(name) : Boolean(force);
                if (on) element.classList.add(name);
                else element.classList.remove(name);
                return on;
            },
            contains: name => element.classes().includes(name),
        };
    }
    classes() { return String(this.attrs.get('class') ?? '').split(/\s+/).filter(Boolean); }
    setClasses(list) {
        const unique = [...new Set(list)];
        if (unique.length) this.attrs.set('class', unique.join(' '));
        else this.attrs.delete('class');
    }
    get className() { return this.attrs.get('class') ?? ''; }
    set className(value) { this.attrs.set('class', String(value)); }
    get id() { return this.attrs.get('id') ?? ''; }
    set id(value) { this.attrs.set('id', String(value)); }
    get type() { return this.attrs.get('type') ?? ''; }
    set type(value) { this.attrs.set('type', String(value)); }
    get children() { return this.childNodes.filter(node => node.nodeType === 1); }
    get firstChild() { return this.childNodes[0] ?? null; }
    get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
    set textContent(value) {
        for (const node of this.childNodes) node.parentNode = null;
        this.childNodes = [];
        const text = String(value ?? '');
        if (text) this.appendChild(new Text(this.ownerDocument, text));
    }
    set innerHTML(_value) { throw new Error('fake DOM: innerHTML is not allowed'); }
    insertAdjacentHTML() { throw new Error('fake DOM: insertAdjacentHTML is not allowed'); }

    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    hasAttribute(name) { return this.attrs.has(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    attributeNames() { return [...this.attrs.keys()]; }

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
    append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? new Text(this.ownerDocument, node) : node); }
    prepend(node) { this.insertBefore(node, this.childNodes[0] ?? null); }
    replaceChildren(...nodes) {
        for (const node of this.childNodes) node.parentNode = null;
        this.childNodes = [];
        this.append(...nodes);
    }

    addEventListener(type, fn, options) { this.listeners.push({ type, fn, capture: options === true || Boolean(options?.capture) }); }
    removeEventListener(type, fn) { this.listeners = this.listeners.filter(entry => entry.type !== type || entry.fn !== fn); }
    dispatch(type, init = {}) {
        const event = {
            type, target: this, currentTarget: null, defaultPrevented: false, stopped: false, button: 0,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.stopped = true; },
            ...init,
        };
        for (let node = this; node && !event.stopped; node = node.parentNode) {
            event.currentTarget = node;
            for (const entry of [...(node.listeners ?? [])]) if (entry.type === type) entry.fn.call(node, event);
        }
        return event;
    }
    dispatchEvent(event) { return this.dispatch(event.type, event); }
    click() { return this.dispatch('click'); }
    focus() { this.ownerDocument.activeElement = this; }
    blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
    contains(node) {
        for (let at = node; at; at = at.parentNode) if (at === this) return true;
        return false;
    }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    matches(selector) { return parseSelector(selector).some(chain => matchChain(this, chain, chain.length - 1)); }
    closest(selector) {
        for (let node = this; node?.nodeType === 1; node = node.parentNode) if (node.matches(selector)) return node;
        return null;
    }
    querySelectorAll(selector) {
        const chains = parseSelector(selector);
        return this.descendants().filter(node => chains.some(chain => matchChain(node, chain, chain.length - 1)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

// --- selectors ---------------------------------------------------------------------------------------

// "a .b > c[d='e'], f" → [[{ tag, id, classes, attrs, combinator }…], …]
function parseSelector(source) {
    return String(source).split(',').map(part => {
        const chain = [];
        let combinator = ' ';
        const tokens = part.trim().match(/>|[^\s>]+/g) ?? [];
        for (const token of tokens) {
            if (token === '>') {
                combinator = '>';
                continue;
            }
            chain.push({ ...compound(token), combinator });
            combinator = ' ';
        }
        return chain;
    });
}

function compound(token) {
    const out = { tag: null, id: null, classes: [], attrs: [] };
    const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
    let match;
    while ((match = re.exec(token))) {
        if (match[1]) out.tag = match[1].toLowerCase();
        else if (match[2]) out.id = match[2];
        else if (match[3]) out.classes.push(match[3]);
        else out.attrs.push({ name: match[4], value: match[5] ?? match[6] ?? match[7] ?? null });
    }
    return out;
}

function matchOne(node, part) {
    if (node?.nodeType !== 1) return false;
    if (part.tag && node.localName.toLowerCase() !== part.tag) return false;
    if (part.id && node.id !== part.id) return false;
    if (part.classes.some(name => !node.classList.contains(name))) return false;
    return part.attrs.every(({ name, value }) => (value === null ? node.hasAttribute(name) : node.getAttribute(name) === value));
}

// As in a browser, ancestors anywhere above the node count, not only those under the element asked.
function matchChain(node, chain, index) {
    if (!matchOne(node, chain[index])) return false;
    if (index === 0) return true;
    for (let up = node.parentNode; up; up = up.parentNode) {
        if (matchChain(up, chain, index - 1)) return true;
        if (chain[index].combinator === '>') return false;
    }
    return false;
}

/** A fresh document, installed on globalThis.document (with head and body). */
export function installDom() {
    const doc = {
        activeElement: null,
        defaultView: {},
        createElement: tag => new Element(doc, tag),
        createElementNS: (ns, tag) => new Element(doc, tag, ns),
        createTextNode: text => new Text(doc, text),
        querySelector: selector => doc.documentElement.querySelector(selector),
        querySelectorAll: selector => doc.documentElement.querySelectorAll(selector),
    };
    doc.documentElement = new Element(doc, 'html');
    doc.head = new Element(doc, 'head');
    doc.body = new Element(doc, 'body');
    doc.documentElement.append(doc.head, doc.body);
    globalThis.document = doc;
    return doc;
}
