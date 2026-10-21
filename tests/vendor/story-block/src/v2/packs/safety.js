// The "data only" rule for packs (SPEC §9), checked before anything reads a pack's fields.
//
// A pack comes from a file someone shared or from a card's lorebook, so it is untrusted.
// It may hold only what JSON can hold, and no text that a renderer could turn into code:
// no script-like tags, no on* event attributes, no javascript: style URLs. Layouts and
// tabs still render every string as text; this check is the second wall, not the only one.

import { LIMITS } from './limits.js';

// Tags that run code or pull in other documents when a string reaches innerHTML (the
// SPEC §13.2 list, plus `style`: a screen's CSS goes in its own `css` field). Inline SVG and
// forms are allowed, a form's `action` is not.
const UNSAFE_TAG = /<\s*\/?\s*(?:script|iframe|frame|frameset|object|embed|applet|link|meta|style|base)\b|<\s*form\b[^>]*\saction\s*=/i;
// An event attribute inside a tag: `<img src=x onerror=…>`. The `(?!=)` keeps
// conditions like `a<b && online == 1` from counting as one.
const EVENT_ATTR = /<[a-z][^>]*?[\s"'/]on[a-z]+\s*=(?!=)/i;
// Schemes that run code. Checked after entities, whitespace and control characters
// are removed, because browsers ignore those inside a scheme (`java&#x09;script:`).
const CODE_SCHEME = /(?:java|vb|live)script:|data:text\/html|data:image\/svg/i;
// Keys whose value is a link or an image source: only https and plain image data URLs (§13.2).
const URL_KEYS = new Set(['src', 'href', 'url', 'image', 'img', 'background']);
const SAFE_URL = /^(?:https:\/\/[^\s"'<>]+|data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)$/i;
// Keys that hold a screen's template or CSS, allowed to be longer than other text.
const CODE_KEYS = new Set(['template', 'css']);
// Keys that would change an object's prototype when copied naively.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const ENTITIES = { colon: ':', tab: '', newline: '', lpar: '(', rpar: ')', sol: '/', bsol: '\\' };

function decodeEntities(text) {
    return text
        .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
        .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Math.min(Number(dec), 0x10ffff)))
        .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/** Why a string is unsafe for a pack, or '' when it is fine. */
export function unsafeText(text) {
    if (UNSAFE_TAG.test(text)) return 'has an HTML tag that can run code (script, iframe, style, form action …)';
    if (EVENT_ATTR.test(text)) return 'has an HTML event attribute (on…=)';
    const squeezed = decodeEntities(text).replace(/[\s\u0000-\u001f\u007f]+/g, '');
    if (CODE_SCHEME.test(squeezed)) return 'has a script link (javascript:, data:text/html …)';
    return '';
}

const describe = value => {
    if (typeof value === 'function') return 'a function';
    if (value === undefined) return 'undefined';
    if (typeof value === 'symbol') return 'a symbol';
    if (typeof value === 'bigint') return 'a bigint';
    if (typeof value === 'number') return String(value);
    return `a ${value?.constructor?.name ?? 'special'} object`;
};

const isPlainObject = value => {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

/**
 * Walks `value` and lists every way it is not plain, safe data:
 * `[{ code, path, message }]`, empty when fine. Stops after LIMITS.errors problems.
 * Codes: NOT_PLAIN, UNSAFE_KEY, UNSAFE_HTML, UNSAFE_URL, TOO_DEEP, TOO_LONG, TOO_MANY.
 */
export function checkPlain(value, limits = LIMITS) {
    const errors = [];
    const seen = new Set();
    const add = (code, path, message) => { if (errors.length < limits.errors) errors.push({ code, path, message: `${path || 'The pack'} ${message}.` }); };

    const visit = (node, path, depth, key) => {
        if (errors.length >= limits.errors) return;
        if (node === null || typeof node === 'boolean') return;
        if (typeof node === 'string') {
            const max = CODE_KEYS.has(key) ? limits.code : limits.string;
            if (node.length > max) return add('TOO_LONG', path, `is longer than ${max} characters`);
            const unsafe = unsafeText(node);
            if (unsafe) return add('UNSAFE_HTML', path, unsafe);
            if (URL_KEYS.has(key) && !SAFE_URL.test(node.trim())) add('UNSAFE_URL', path, 'must be an https link or a PNG, JPEG, GIF or WebP data URL');
            return;
        }
        if (typeof node === 'number') {
            if (!Number.isFinite(node)) add('NOT_PLAIN', path, `is ${describe(node)}, not a finite number`);
            return;
        }
        if (typeof node !== 'object') return add('NOT_PLAIN', path, `is ${describe(node)}; packs hold data only`);
        if (seen.has(node)) return add('NOT_PLAIN', path, 'refers back to itself');
        if (depth >= limits.depth) return add('TOO_DEEP', path, `is nested more than ${limits.depth} levels deep`);
        const isArray = Array.isArray(node);
        if (!isArray && !isPlainObject(node)) return add('NOT_PLAIN', path, `is ${describe(node)}; packs hold data only`);
        seen.add(node);
        const keys = Reflect.ownKeys(node);
        if (isArray) {
            if (node.length > limits.array) add('TOO_MANY', path, `has more than ${limits.array} entries`);
        } else if (keys.length > limits.keys) add('TOO_MANY', path, `has more than ${limits.keys} fields`);
        for (const name of keys) {
            if (isArray && name === 'length') continue;
            if (typeof name === 'symbol') { add('NOT_PLAIN', path, 'has a symbol key'); continue; }
            const at = isArray ? `${path}[${name}]` : path ? `${path}.${name}` : name;
            const descriptor = Object.getOwnPropertyDescriptor(node, name);
            // A getter would run code just by being read.
            if (descriptor.get || descriptor.set) { add('NOT_PLAIN', at, 'is a getter or setter; packs hold data only'); continue; }
            if (!isArray) {
                if (UNSAFE_KEYS.has(name)) { add('UNSAFE_KEY', at, 'is a reserved name'); continue; }
                if (name.length > limits.name) { add('TOO_LONG', at, `is a field name longer than ${limits.name} characters`); continue; }
                const unsafe = unsafeText(name);
                if (unsafe) { add('UNSAFE_HTML', at, unsafe); continue; }
            }
            visit(descriptor.value, at, depth + 1, isArray ? key : name);
        }
        seen.delete(node);
    };
    visit(value, '', 0, '');
    return errors;
}

/** UTF-8 length of a string. */
export const byteLength = text => new TextEncoder().encode(text).length;
