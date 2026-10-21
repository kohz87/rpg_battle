// Rendering a compiled template (index.js) into an element. The first render builds the page from the
// compiled tree; later renders patch it: text, attributes, variables and classes are set only when their
// value changed, loop items are kept by key (the item's `id`, else its record key or index) and moved only
// when the order changed, `data-if` adds or removes its element, widgets are given new props only when
// they changed. So rendering again with the same scope changes nothing, and inputs keep their focus.
//
// Text is only ever set with textContent; attributes with setAttribute after the allow-list; URLs are
// checked again after binding. Event handlers are added by the renderer itself (click, input, change,
// submit), never from the template.

import { escapeKey } from '../../ops.js';
import {
    evalExpr, interpolate, isLoopName, isScope, makeScope, pathKeys, pointerOf, resolvePath, setIn, toText, valueAtKeys,
    withDraft, withItem,
} from '../bind.js';
import { cssVarValue } from '../css.js';

/** Set a value in a draft the host holds, creating records on the way (frozen ones are copied). */
function writeInPlace(target, keys, value) {
    if (keys.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) throw new Error(`"${keys.join('.')}" cannot be written.`);
    let node = target;
    for (const key of keys.slice(0, -1)) {
        const child = Object.hasOwn(node, key) ? node[key] : undefined;
        if (child && typeof child === 'object' && !Object.isFrozen(child)) node = child;
        else {
            node[key] = child && typeof child === 'object' ? (Array.isArray(child) ? [...child] : { ...child }) : {};
            node = node[key];
        }
    }
    node[keys[keys.length - 1]] = value;
}

function withItems(scope, names) {
    let next = scope;
    for (const [name, value] of Object.entries(names)) next = withItem(next, name, value);
    return next;
}
import { fillJson } from './json.js';
import { isUrlAttr, urlAllowed } from './sanitize.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWS = new WeakMap();
const SKIP = Symbol('skip');

/**
 * Render (or re-render) a compiled template into `el`. Options:
 * * `command(type, payload, { cause: 'ui' })` → promise of the command result (data-command, data-submit);
 * * `widgets` — `{ [name]: { render(el, props, api) } }`, a Map, or `name => def`;
 * * `evaluate(expr, scope)` — the condition language, for bindings that are not plain paths or helper calls;
 * * `onDraft(path, value, draft)` — told after an input changed the draft (the view re-renders itself);
 * * `onResult(result, { type, payload })` — told when a command finishes; `onWarn(message)`;
 * * `onSubmit(type, draft)` — when given, data-submit hands the draft here instead of running the command
 *   (a dialog that runs its own submit, e.g. "Next" on a wizard's earlier steps);
 * * `api` — extra widget api (`query`, `preview`, `commit`, `on`), `formatters` — for a scope built here.
 * `scope` is a scope from bind.js `makeScope`, or the fields makeScope takes (`{ state, q, draft, … }`);
 * a mount's scope `api` (`{ command, preview, commit, query, on }`) is used when `api` / `command` are not given.
 * Returns the view: `{ el, warnings, draft(), update(scope), destroy() }`.
 */
export function renderTemplate(el, compiled, scope, options = {}) {
    if (!el || typeof el !== 'object') throw new Error('renderTemplate needs an element to render into.');
    if (!compiled?.nodes) throw new Error('renderTemplate needs a template from compileTemplate.');
    let view = VIEWS.get(el);
    if (!view || view.compiled !== compiled) {
        view?.destroy();
        view = new View(el, compiled);
        VIEWS.set(el, view);
    }
    // The mounts hand their api in the scope (`scope.api`); explicit options win.
    const api = scope?.api && typeof scope.api === 'object' ? scope.api : null;
    const fromScope = api ? { api, command: typeof api.command === 'function' ? api.command.bind(api) : undefined } : {};
    view.options = { ...fromScope, ...Object.fromEntries(Object.entries(options ?? {}).filter(([, value]) => value !== undefined)) };
    view.update(scope);
    return view;
}

/** Take a rendered template out of `el` (widgets are told to clean up). */
export function destroyTemplate(el) {
    VIEWS.get(el)?.destroy();
}

class View {
    constructor(el, compiled) {
        this.el = el;
        this.compiled = compiled;
        this.options = {};
        this.doc = el.ownerDocument ?? globalThis.document;
        this.warnings = [...compiled.warnings];
        this.seen = new Set(this.warnings);
        this.seed = undefined;
        this.draftValue = {};
        this.base = null;
        this.blocks = null;
    }

    warn(message) {
        if (this.seen.has(message)) return;
        this.seen.add(message);
        this.warnings.push(message);
        try {
            this.options.onWarn?.(message);
        } catch { /* a host callback never breaks rendering */ }
    }

    draft() {
        return this.draftValue;
    }

    /** The scope a render uses: the host's, with the view's own draft. */
    scopeFor(scope) {
        const base = isScope(scope) ? scope : this.rawScope(scope);
        if (scope?.draft !== this.seed) {
            // A draft the host holds (the dialog's) is filled in place, so the host always has the
            // reader's input; a frozen or missing one is copied on write and kept by the view.
            this.seed = scope?.draft;
            const given = scope?.draft && typeof scope.draft === 'object' && !Array.isArray(scope.draft) ? scope.draft : null;
            this.inPlace = Boolean(given) && !Object.isFrozen(given);
            this.draftValue = given ?? {};
        }
        return base.draft === this.draftValue ? base : withDraft(base, this.draftValue);
    }

    /**
     * A scope from plain fields: `{ state, q, draft, settings, query, changed | changes | ops, formatters,
     * …names }` (the mounts pass `changes`, the carrier's JSON Pointers, and `mount`, `index`, `screenId`, `api`).
     */
    rawScope(fields) {
        const { state, q, draft, settings, query, changed, changes, ops, formatters, ...names } = fields ?? {};
        const scope = makeScope({ state, q, draft, settings, query, changed: changed ?? changes, ops, formatters: formatters ?? this.options.formatters });
        const extra = Object.fromEntries(Object.entries(names).filter(([name]) => isLoopName(name)));
        return Object.keys(extra).length ? withItems(scope, extra) : scope;
    }

    update(scope) {
        if (this.destroyed) return;
        this.base = scope;
        const current = this.scopeFor(scope);
        if (!this.blocks) {
            this.el.replaceChildren();
            this.blocks = this.compiled.nodes.map(node => makeBlock(node, this));
            for (const block of this.blocks) for (const node of block.nodes()) this.el.appendChild(node);
        }
        for (const block of this.blocks) block.update(current);
    }

    setDraft(keys, value) {
        if (this.inPlace) writeInPlace(this.draftValue, keys, value);
        else this.draftValue = setIn(this.draftValue, keys, value);
        try {
            this.options.onDraft?.(keys.join('.'), value, this.draftValue);
        } catch (error) {
            this.warn(`onDraft failed: ${error?.message ?? error}`);
        }
        this.update(this.base);
    }

    async run(type, payload, block) {
        const command = this.options.command;
        if (typeof command !== 'function') {
            this.warn(`No command runner is connected, so "${type}" cannot run here.`);
            return null;
        }
        let result;
        try {
            result = await command(type, payload, { cause: 'ui' });
        } catch (error) {
            result = { ok: false, code: 'FAILED', message: String(error?.message ?? error) };
        }
        try {
            this.options.onResult?.(result, { type, payload, element: block?.el ?? null });
        } catch { /* a host callback never breaks rendering */ }
        return result;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const block of this.blocks ?? []) block.destroy();
        this.blocks = null;
        if (VIEWS.get(this.el) === this) VIEWS.delete(this.el);
    }
}

function makeBlock(node, view) {
    if (node.kind === 'text') return new TextBlock(node, view);
    if (node.each) return new EachBlock(node, view);
    if (node.cond) return new IfBlock(node, view);
    return node.widget ? new WidgetBlock(node, view) : new ElementBlock(node, view);
}

/** The block for one item of a loop (or the element under an if). */
function itemBlock(node, view) {
    if (node.cond) return new IfBlock(node, view);
    return node.widget ? new WidgetBlock(node, view) : new ElementBlock(node, view);
}

// ---------------------------------------------------------------------------------------------------

class TextBlock {
    constructor(node, view) {
        this.node = node;
        this.view = view;
        this.text = node.parts ? '' : node.text;
        this.dom = view.doc.createTextNode(this.text);
    }
    nodes() { return [this.dom]; }
    update(scope) {
        if (!this.node.parts) return;
        const text = interpolate(this.node.parts, scope, this.view.options.evaluate, message => this.view.warn(message));
        if (text !== this.text) {
            this.text = text;
            this.dom.textContent = text;
        }
    }
    destroy() { this.dom.remove?.(); }
}

class IfBlock {
    constructor(node, view) {
        this.node = node;
        this.view = view;
        this.anchor = view.doc.createTextNode('');
        this.inner = null;
    }
    nodes() { return [...(this.inner ? this.inner.nodes() : []), this.anchor]; }
    update(scope) {
        const show = Boolean(evalExpr(this.node.cond, scope, this.view.options.evaluate, message => this.view.warn(message)));
        if (show && !this.inner) {
            this.inner = this.node.widget ? new WidgetBlock(this.node, this.view) : new ElementBlock(this.node, this.view);
            const parent = this.anchor.parentNode;
            for (const dom of this.inner.nodes()) parent?.insertBefore(dom, this.anchor);
        } else if (!show && this.inner) {
            this.inner.destroy();
            this.inner = null;
        }
        this.inner?.update(scope);
    }
    destroy() {
        this.inner?.destroy();
        this.inner = null;
        this.anchor.remove?.();
    }
}

class EachBlock {
    constructor(node, view) {
        this.node = node;
        this.view = view;
        this.anchor = view.doc.createTextNode('');
        this.items = new Map();
        this.order = [];
    }
    nodes() { return [...this.order.flatMap(key => this.items.get(key).nodes()), this.anchor]; }
    update(scope) {
        const { each } = this.node;
        const warn = message => this.view.warn(message);
        const list = evalExpr(each.list, scope, this.view.options.evaluate, warn);
        const entries = Array.isArray(list)
            ? list.map((item, index) => [index, item])
            : list && typeof list === 'object' ? Object.entries(list) : [];
        const listPointer = each.path ? pointerOf(scope, each.path) : null;
        const next = new Map();
        const order = [];
        for (const [entryKey, item] of entries) {
            const id = item && typeof item === 'object' && (typeof item.id === 'string' || Number.isFinite(item.id)) ? `id:${item.id}` : `k:${entryKey}`;
            let key = id;
            for (let n = 2; next.has(key); n += 1) key = `${id}#${n}`;
            const pointer = listPointer === null ? null : `${listPointer}/${escapeKey(entryKey)}`;
            const itemScope = withItem(scope, each.name, item, pointer, each.index, entryKey);
            let block = this.items.get(key);
            if (!block) {
                block = itemBlock(this.node, this.view);
                block.fresh = true;
            }
            next.set(key, block);
            order.push(key);
            block.scope = itemScope;
        }
        for (const [key, block] of this.items) if (!next.has(key)) block.destroy();
        const parent = this.anchor.parentNode;
        const moved = order.length !== this.order.length || order.some((key, index) => key !== this.order[index]);
        if (moved && parent) {
            for (const key of order) for (const dom of next.get(key).nodes()) parent.insertBefore(dom, this.anchor);
        }
        this.items = next;
        this.order = order;
        for (const key of order) {
            const block = next.get(key);
            block.fresh = false;
            block.update(block.scope);
        }
    }
    destroy() {
        for (const block of this.items.values()) block.destroy();
        this.items.clear();
        this.order = [];
        this.anchor.remove?.();
    }
}

// ---------------------------------------------------------------------------------------------------

function createElement(doc, node) {
    if (node.svg && typeof doc.createElementNS === 'function') return doc.createElementNS(SVG_NS, node.tag);
    return doc.createElement(node.tag);
}

const attrName = name => (name === 'xlink:href' ? 'href' : name);

class ElementBlock {
    constructor(node, view) {
        this.node = node;
        this.view = view;
        this.values = new Map();
        this.scope = null;
        const el = createElement(view.doc, node);
        this.el = el;
        for (const [name, value] of node.attrs) el.setAttribute(attrName(name), value);
        this.children = node.children.map(child => makeBlock(child, view));
        for (const child of this.children) for (const dom of child.nodes()) el.appendChild(dom);
        if (node.command) el.addEventListener('click', event => this.onCommand(event));
        if (node.submit) el.addEventListener(node.tag === 'form' ? 'submit' : 'click', event => this.onSubmit(event));
        if (node.draft) {
            const handler = () => this.onInput();
            el.addEventListener('input', handler);
            el.addEventListener('change', handler);
        }
    }
    nodes() { return [this.el]; }

    /** Set something only when its value changed since the last render. */
    changed(key, value) {
        if (this.values.has(key) && this.values.get(key) === value) return false;
        this.values.set(key, value);
        return true;
    }

    setAttr(name, value) {
        const { el, node } = this;
        if (value !== null && isUrlAttr(name) && !urlAllowed(node.tag, name, value)) {
            this.view.warn(`A bound ${name} on <${node.tag}> was not https: (or a data: image) and was left out.`);
            value = null;
        }
        if (!this.changed(`attr:${name}`, value)) return;
        if (value === null) el.removeAttribute(attrName(name));
        else el.setAttribute(attrName(name), value);
    }

    update(scope) {
        this.scope = scope;
        const { node, view, el } = this;
        const { evaluate } = view.options;
        const warn = message => view.warn(message);
        const read = expr => evalExpr(expr, scope, evaluate, warn);

        for (const { name, parts } of node.dynamicAttrs) this.setAttr(name, interpolate(parts, scope, evaluate, warn));
        for (const { name, expr, boolean } of node.bindAttrs) {
            const value = read(expr);
            if (boolean) {
                const on = Boolean(value);
                this.setAttr(name, on ? '' : null);
                if (name === 'checked' || name === 'selected' || name === 'disabled') el[name] = on;
            } else this.setAttr(name, value === null || value === undefined || value === false ? null : toText(value));
        }
        for (const { name, expr } of node.vars) {
            const value = cssVarValue(read(expr));
            if (this.changed(`var:${name}`, value)) el.style.setProperty(name, value);
        }
        for (const { name, expr } of node.classes) {
            const on = Boolean(read(expr));
            if (this.changed(`class:${name}`, on)) el.classList.toggle(name, on);
        }
        if (node.bindText) {
            const text = toText(read(node.bindText));
            if (this.changed('text', text)) el.textContent = text;
        }
        for (const child of this.children) child.update(scope);
        if (node.draft) this.showDraft(scope);
    }

    // --- forms -------------------------------------------------------------------------------------

    draftKeys(scope = this.scope) {
        const keys = pathKeys(scope, this.node.draft.path);
        if (!keys) this.view.warn(`data-draft="${this.node.draft.path.source}" names a key that is not there.`);
        return keys;
    }

    showDraft(scope) {
        const { el, node } = this;
        const keys = this.draftKeys(scope);
        if (!keys) return;
        const value = valueAtKeys(this.view.draftValue, keys);
        const { type } = node.draft;
        const list = this.isList();
        if (type === 'checkbox') {
            el.checked = list ? Array.isArray(value) && value.map(String).includes(this.inputValue()) : Boolean(value);
            return;
        }
        if (type === 'radio') {
            el.checked = value !== undefined && value !== null && String(value) === this.inputValue();
            return;
        }
        // Leave a field alone while the reader is typing in it.
        if (this.view.doc?.activeElement === el) return;
        const text = value === null || value === undefined ? '' : toText(value);
        if (el.value !== text) el.value = text;
    }

    /** A checkbox with a value (static or bound) collects a list; without one it is true/false. */
    isList() {
        const value = this.el.getAttribute('value');
        return this.node.draft.type === 'checkbox' && value !== null && value !== 'on';
    }

    inputValue() {
        const attr = this.el.getAttribute('value');
        return attr === null ? String(this.el.value ?? '') : attr;
    }

    readInput() {
        const { el, node } = this;
        const { type } = node.draft;
        const list = this.isList();
        if (type === 'checkbox') {
            if (!list) return Boolean(el.checked);
            const keys = this.draftKeys();
            const current = keys ? valueAtKeys(this.view.draftValue, keys) : undefined;
            const values = Array.isArray(current) ? current.filter(item => String(item) !== this.inputValue()) : [];
            return el.checked ? [...values, this.inputValue()] : values;
        }
        if (type === 'radio') return el.checked ? this.inputValue() : SKIP;
        if (type === 'number' || type === 'range') {
            const text = String(el.value ?? '').trim();
            if (text === '') return null;
            const number = Number(text);
            return Number.isFinite(number) ? number : SKIP;
        }
        return String(el.value ?? '');
    }

    onInput() {
        if (!this.scope) return;
        const keys = this.draftKeys();
        const value = this.readInput();
        if (!keys || value === SKIP) return;
        const before = valueAtKeys(this.view.draftValue, keys);
        if (before === value) return;
        this.view.setDraft(keys, value);
    }

    // --- commands ----------------------------------------------------------------------------------

    async busy(fn) {
        if (this.running) return;
        this.running = true;
        this.el.classList.add('ss-busy');
        this.el.setAttribute('aria-busy', 'true');
        try {
            await fn();
        } finally {
            this.running = false;
            this.el.classList.remove('ss-busy');
            this.el.removeAttribute('aria-busy');
        }
    }

    onCommand(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!this.scope || this.el.disabled) return undefined;
        const { node, view } = this;
        let payload = {};
        if (node.payload) {
            const filled = fillJson(node.payload, this.scope, view.options.evaluate, message => view.warn(message));
            if (!filled.ok) {
                view.warn(`The payload for ${node.command} could not be read: ${filled.error}`);
                return undefined;
            }
            payload = filled.value;
        }
        return this.busy(() => view.run(node.command, payload, this));
    }

    onSubmit(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!this.scope || this.el.disabled) return undefined;
        const draft = structuredClone(this.view.draftValue);
        const onSubmit = this.view.options.onSubmit;
        if (typeof onSubmit === 'function') {
            try {
                onSubmit(this.node.submit, draft);
            } catch (error) {
                this.view.warn(`onSubmit failed: ${error?.message ?? error}`);
            }
            return undefined;
        }
        return this.busy(() => this.view.run(this.node.submit, draft, this));
    }

    destroy() {
        for (const child of this.children) child.destroy();
        this.el.remove?.();
    }
}

// ---------------------------------------------------------------------------------------------------

function findWidget(widgets, name) {
    if (!widgets || !name) return null;
    if (typeof widgets === 'function') return widgets(name) ?? null;
    if (widgets instanceof Map) return widgets.get(name) ?? null;
    return Object.hasOwn(widgets, name) ? widgets[name] : null;
}

let unstable = 0;
function stable(value) {
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        unstable += 1;
        return `unstable:${unstable}`;   // props that cannot be compared always count as new
    }
}

/** `<ss-widget name="…" data-props='…'>`: the element is the widget's; the props come from the template. */
class WidgetBlock extends ElementBlock {
    constructor(node, view) {
        super({ ...node, children: [], draft: null, command: null, submit: null }, view);
        this.widgetNode = node;
        this.instance = null;
        this.key = null;
        this.def = undefined;
    }

    api() {
        const view = this.view;
        const block = this;
        return {
            ...(view.options.api ?? {}),
            command: (type, payload) => view.run(type, payload, block),
            /** Read a path in the scope the widget sits in. */
            resolve: path => resolvePath(block.scope, path),
            /** The dialog's draft: widgets inside a form (ss.stepper) read and write it here. */
            draft: {
                get: path => {
                    const keys = pathKeys(block.scope, String(path).replace(/^draft\./, ''));
                    return keys ? valueAtKeys(view.draftValue, keys) : undefined;
                },
                set: (path, value) => {
                    const keys = pathKeys(block.scope, String(path).replace(/^draft\./, ''));
                    if (keys) view.setDraft(keys, value);
                },
                value: () => view.draftValue,
            },
            /** ss.stepper's way to fill a draft field: `onDraft(name, value)`. */
            onDraft: (path, value) => {
                const keys = pathKeys(block.scope, String(path).replace(/^draft\./, ''));
                if (keys) view.setDraft(keys, value);
            },
        };
    }

    update(scope) {
        super.update(scope);
        const { view, el } = this;
        const { name, props: compiledProps } = this.widgetNode.widget;
        const def = findWidget(view.options.widgets, name);
        let props = {};
        if (compiledProps) {
            const filled = fillJson(compiledProps, scope, view.options.evaluate, message => view.warn(message));
            if (!filled.ok) return this.fail(`The props for ${name} could not be read: ${filled.error}`);
            props = filled.value;
        }
        if (typeof props.bind === 'string') props.value = evalExpr(props.bind, scope, view.options.evaluate, message => view.warn(message));
        if (!def || typeof def.render !== 'function') return this.fail(`There is no widget called "${name}".`);
        const key = stable(props);
        if (def === this.def && key === this.key) return undefined;
        const first = def !== this.def;
        this.def = def;
        this.key = key;
        el.classList.remove('ss-widget-missing');
        this.failed = null;
        try {
            if (!first && typeof this.instance?.update === 'function') this.instance.update(props);
            else {
                this.cleanup();
                el.replaceChildren();
                this.instance = def.render(el, props, this.api()) ?? null;
            }
        } catch (error) {
            this.fail(`The widget "${name}" failed: ${error?.message ?? error}`);
        }
        return undefined;
    }

    fail(message) {
        this.view.warn(message);
        this.cleanup();
        this.def = null;
        this.key = null;
        if (this.failed === message) return;
        this.failed = message;
        this.el.classList.add('ss-widget-missing');
        this.el.textContent = message;
    }

    cleanup() {
        try {
            this.instance?.destroy?.();
        } catch { /* a widget's cleanup never breaks rendering */ }
        this.instance = null;
    }

    destroy() {
        this.cleanup();
        super.destroy();
    }
}
