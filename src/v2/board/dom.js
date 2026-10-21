// Small DOM and prop helpers for the battle board, in the shapes of Story Block's standard widgets
// (src/v2/view/widgets/dom.js and props.js there; WIDGETS.md).
//
// Everything is built with createElement and textContent: names, log lines and loot come from story
// data (and so, at one remove, from the model), so none of it is ever parsed as markup. Data never
// picks a class name: kinds and sides go into `data-*` attributes, cleaned to a short slug.

import { boardCss } from './styles.js';

/** The document an element lives in (a widget may be drawn into another window's document). */
export function docOf(el) {
    return el?.ownerDocument ?? globalThis.document;
}

/** An HTML element with an optional class and text. */
export function h(doc, tag, className = '', text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
    return node;
}

/** A Font Awesome icon from a fixed name in this file's code (never from data); decorative. */
export function icon(doc, name) {
    const node = h(doc, 'i', `rpg-bb-icon fa-solid ${name}`);
    node.setAttribute('aria-hidden', 'true');
    return node;
}

/** A finite number, or the fallback (numeric strings count, as `{{ }}` interpolation makes them). */
export function num(value, fallback = 0) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** A display string from a text-ish value ('' for null, undefined and objects). */
export function str(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/** A number for display: at most one decimal, no "-0" ("63.5", "12"). */
export function tidy(value) {
    const rounded = Math.round(num(value) * 10) / 10;
    return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** A short lower-case slug for a `data-*` value ("On guard" → "on-guard"); '' for nothing. */
export function slug(value) {
    return str(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

/** Up to two initials from a name ("Cellar Rat B" → "CB"); '?' when there is no name. */
export function initials(name) {
    const words = str(name).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = Array.from(words[0])[0];
    const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
    return `${first}${last}`.toUpperCase();
}

export const isPlain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const list = value => (Array.isArray(value) ? value : []);

/** A widget from `api.widgets` (an object, a Map or `name => def`), or null. */
export function findWidget(widgets, name) {
    if (!widgets) return null;
    let def = null;
    if (typeof widgets === 'function') def = widgets(name) ?? null;
    else if (widgets instanceof Map) def = widgets.get(name) ?? null;
    else if (typeof widgets === 'object' && Object.hasOwn(widgets, name)) def = widgets[name];
    return def && typeof def.render === 'function' ? def : null;
}

/** Adds the board's stylesheet to a document once (every rule in :where(), so screen CSS wins). */
export function ensureStyles(doc) {
    const head = doc?.head;
    if (!head || head.querySelector('style[data-rpg-bb]')) return;
    const style = doc.createElement('style');
    style.setAttribute('data-rpg-bb', '');
    style.textContent = boardCss;
    head.appendChild(style);
}

// --- props (WIDGETS.md: plain JSON; a number or boolean also takes its string form) --------------

function coerce(type, value) {
    if (value === undefined || value === null) return undefined;
    switch (type) {
        case 'number':
            if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
            if (typeof value === 'string' && /^\s*-?(?:\d+\.?\d*|\.\d+)\s*$/.test(value)) return Number(value);
            return undefined;
        case 'string':
            if (typeof value === 'string') return value;
            return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
        case 'boolean':
            if (typeof value === 'boolean') return value;
            return value === 'true' ? true : value === 'false' ? false : undefined;
        case 'array':
            return Array.isArray(value) ? value : undefined;
        case 'object':
            return isPlain(value) ? value : undefined;
        default:
            return value;
    }
}

/** Every declared prop, coerced to its type or set to its default (a wrong type falls back too). */
export function resolveProps(schema, input) {
    const source = isPlain(input) ? input : {};
    const out = {};
    for (const [name, spec] of Object.entries(schema)) {
        const value = coerce(spec.type, source[name]);
        out[name] = value !== undefined ? value : (spec.default ?? null);
    }
    return out;
}

/** Plain-words problems with a props object's types ([] when fine). */
export function propProblems(schema, input) {
    const source = isPlain(input) ? input : {};
    const problems = [];
    for (const [name, spec] of Object.entries(schema)) {
        const value = source[name];
        if (value === undefined || value === null) continue;
        if (coerce(spec.type, value) === undefined) {
            problems.push(`The "${name}" setting should be ${({ array: 'a list', object: 'an object' })[spec.type] ?? `a ${spec.type}`}.`);
        }
    }
    return problems;
}
