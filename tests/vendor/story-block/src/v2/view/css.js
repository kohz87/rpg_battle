// Screen stylesheets (SPEC §13.3). A screen's `css` is scoped to its root, `[data-ss-screen="<id>"]`, so a
// card's or a pack's styles can never reach SillyTavern's page or another screen:
// * every selector gets the scope in front, inside `@media`, `@supports`, `@container` and `@layer` too;
//   `:root`, `html`, `body`, `:host` and `:scope` become the scope itself;
// * `@keyframes` names get a per-screen prefix, and `animation` / `animation-name` use the prefixed names;
// * `@import`, `@charset`, `@namespace`, `@page` and unknown at-rules are dropped;
// * `position: fixed`, `behavior`, `-moz-binding`, `expression(…)`, `javascript:`/`vbscript:` and any
//   `url()` that is not `data:` or `https:` drop their declaration; `@font-face` stays with those URLs;
// * more than 64 KB is refused whole.
// Returns `{ css, warnings }`; warnings are plain sentences for the overlay. Pure.

export const MAX_CSS_BYTES = 64 * 1024;

const SCOPE_ALIASES = /^(?::root|html|body|:host|:scope)(?![\w-])/i;
const GROUPS = new Set(['media', 'supports', 'container', 'layer', 'document']);
const DROPPED = new Set(['import', 'charset', 'namespace', 'page']);

/** The attribute selector for a screen id. */
export function screenSelector(id) {
    return `[data-ss-screen="${String(id).replace(/["\\]/g, '\\$&')}"]`;
}

/** The prefix a screen's keyframes get (`ss-rpg-battle-party-`). */
export function keyframePrefix(id) {
    return `ss-${String(id).replace(/[^A-Za-z0-9_-]+/g, '-')}-`;
}

/** UTF-8 length of a string. */
function bytes(text) {
    return new TextEncoder().encode(text).length;
}

// ---------------------------------------------------------------------------------------------------
// Reading CSS

/** Drop comments, keeping strings intact. */
function stripComments(text) {
    let out = '';
    let quote = null;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quote) {
            out += char;
            if (char === '\\' && i + 1 < text.length) out += text[++i];
            else if (char === quote) quote = null;
        } else if (char === '"' || char === '\'') {
            quote = char;
            out += char;
        } else if (char === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 1;
            out += ' ';
        } else out += char;
    }
    return out;
}

/**
 * Split a block of CSS into items: `{ type: 'rule', prelude, body }` for `x { … }` and
 * `{ type: 'statement', prelude }` for `x;`. Braces inside strings and parentheses are respected.
 */
function readItems(text) {
    const items = [];
    let at = 0;
    while (at < text.length) {
        let quote = null;
        let paren = 0;
        let i = at;
        for (; i < text.length; i += 1) {
            const char = text[i];
            if (quote) {
                if (char === '\\') i += 1;
                else if (char === quote) quote = null;
            } else if (char === '"' || char === '\'') quote = char;
            else if (char === '(') paren += 1;
            else if (char === ')') paren = Math.max(0, paren - 1);
            else if (paren === 0 && (char === '{' || char === ';' || char === '}')) break;
        }
        const prelude = text.slice(at, i).trim();
        if (i >= text.length) {
            if (prelude) items.push({ type: 'statement', prelude });
            break;
        }
        if (text[i] === ';' || text[i] === '}') {
            if (prelude) items.push({ type: 'statement', prelude });
            at = i + 1;
            continue;
        }
        // Find the matching close brace.
        let depth = 1;
        let j = i + 1;
        quote = null;
        for (; j < text.length && depth > 0; j += 1) {
            const char = text[j];
            if (quote) {
                if (char === '\\') j += 1;
                else if (char === quote) quote = null;
            } else if (char === '"' || char === '\'') quote = char;
            else if (char === '{') depth += 1;
            else if (char === '}') depth -= 1;
        }
        items.push({ type: 'rule', prelude, body: text.slice(i + 1, depth === 0 ? j - 1 : j) });
        at = j;
    }
    return items;
}

/** Split at a separator outside strings and brackets. */
function splitTop(text, separator) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current = '';
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quote) {
            if (char === '\\' && i + 1 < text.length) {
                current += char + text[++i];
                continue;
            }
            if (char === quote) quote = null;
        } else if (char === '"' || char === '\'') quote = char;
        else if (char === '(' || char === '[') depth += 1;
        else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
        else if (char === separator && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    parts.push(current);
    return parts;
}

/** CSS escapes decoded (`\75 rl(` → `url(`), so checks see what the browser will. */
function decodeEscapes(text) {
    return text.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([^\n])/g, (_, hex, char) => {
        if (char !== undefined) return char;
        const code = parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
    });
}

// ---------------------------------------------------------------------------------------------------
// Values

/** True for a URL a screen may load: `https:` or `data:` (control characters and spaces ignored). */
export function isSafeCssUrl(url) {
    const flat = String(url).replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
    return flat.startsWith('https:') || flat.startsWith('data:');
}

/**
 * Why a declaration value is refused, or '' when it is fine. Looks at the decoded value: script URLs,
 * `expression(`, `url()` that is not data:/https:, `image-set()`/`image()` strings that are not either.
 */
export function valueProblem(value) {
    const plain = decodeEscapes(String(value));
    const flat = plain.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
    if (flat.includes('javascript:') || flat.includes('vbscript:')) return 'a script URL';
    if (flat.includes('expression(')) return 'expression()';
    if (/[<>]/.test(plain) && /<\/?style|<\/?script/i.test(plain)) return 'markup';
    for (const match of plain.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
        const url = match[1] ?? match[2] ?? match[3] ?? '';
        if (!isSafeCssUrl(url)) return `the URL "${url.trim().slice(0, 60)}"`;
    }
    if (/url\(/i.test(plain) && !/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/i.test(plain)) return 'an unclosed url(';
    for (const match of plain.matchAll(/(?:-webkit-)?image(?:-set)?\(([^)]*)\)/gi)) {
        for (const string of match[1].matchAll(/"([^"]*)"|'([^']*)'/g)) {
            const url = string[1] ?? string[2];
            if (!isSafeCssUrl(url)) return `the URL "${url.slice(0, 60)}"`;
        }
    }
    return '';
}

/**
 * Filter a declaration list (a rule's body or a `style` attribute). Returns `{ text, warnings }` with
 * the declarations kept, `prop: value` joined by `; `. `keyframes` maps names to their prefixed form.
 */
export function filterDeclarations(body, { keyframes = null, where = 'style' } = {}) {
    const kept = [];
    const warnings = [];
    for (const raw of splitTop(stripComments(String(body ?? '')), ';')) {
        const text = raw.trim();
        if (!text) continue;
        const colon = text.indexOf(':');
        if (colon <= 0) {
            warnings.push(`Dropped "${text.slice(0, 60)}" in ${where}: not a declaration.`);
            continue;
        }
        const prop = text.slice(0, colon).trim();
        let value = text.slice(colon + 1).trim();
        if (!value) continue;
        const name = decodeEscapes(prop).toLowerCase();
        if (!/^-{0,2}[a-z][a-z0-9-]*$/i.test(prop) || /[{}]/.test(value.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ''))) {
            warnings.push(`Dropped "${text.slice(0, 60)}" in ${where}: not a declaration.`);
            continue;
        }
        if (name === 'behavior' || name === '-moz-binding') {
            warnings.push(`Dropped ${prop} in ${where}: it can run code.`);
            continue;
        }
        if (name === 'position' && /^fixed\b/i.test(decodeEscapes(value).trim())) {
            warnings.push(`Dropped position: fixed in ${where}: screens stay inside their place.`);
            continue;
        }
        const problem = valueProblem(value);
        if (problem) {
            warnings.push(`Dropped ${prop} in ${where}: ${problem} is not allowed (only data: and https: URLs).`);
            continue;
        }
        if (keyframes?.size && (name === 'animation' || name === 'animation-name')) {
            value = value.replace(/-?[A-Za-z_][\w-]*/g, word => keyframes.get(word) ?? word);
        }
        kept.push(`${prop}: ${value}`);
    }
    return { text: kept.join('; '), warnings };
}

// ---------------------------------------------------------------------------------------------------
// Selectors

function scopeSelector(selector, scope) {
    const text = selector.trim();
    if (!text) return '';
    const alias = SCOPE_ALIASES.exec(text);
    if (alias) return `${scope}${text.slice(alias[0].length)}`;
    return `${scope} ${text}`;
}

function scopeSelectorList(prelude, scope) {
    return splitTop(prelude, ',').map(part => scopeSelector(part, scope)).filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------------------------------
// Scoping

/**
 * Scope a screen's stylesheet. Returns `{ css, warnings }`; `css` is '' when nothing is usable or the
 * sheet is over 64 KB.
 */
export function scopeCss(source, screenId) {
    const warnings = [];
    const text = String(source ?? '');
    if (bytes(text) > MAX_CSS_BYTES) {
        return { css: '', warnings: [`The stylesheet is ${Math.ceil(bytes(text) / 1024)} KB; screens allow 64 KB. It was not used.`] };
    }
    const scope = screenSelector(screenId);
    const prefix = keyframePrefix(screenId);
    const clean = stripComments(text);
    if (/<\/?style|<\/?script/i.test(clean)) warnings.push('Markup inside the stylesheet was ignored.');
    const keyframes = new Map();
    collectKeyframes(readItems(clean), prefix, keyframes);
    const css = scopeItems(readItems(clean), { scope, keyframes, warnings }).join('\n');
    return { css, warnings };
}

function collectKeyframes(items, prefix, keyframes) {
    for (const item of items) {
        if (item.type !== 'rule' || item.prelude[0] !== '@') continue;
        const at = /^@(-webkit-|-moz-)?keyframes\s+(-?[A-Za-z_][\w-]*)/i.exec(item.prelude);
        if (at) keyframes.set(at[2], `${prefix}${at[2]}`);
        else if (GROUPS.has(atName(item.prelude))) collectKeyframes(readItems(item.body), prefix, keyframes);
    }
}

function atName(prelude) {
    return (/^@(-webkit-|-moz-)?([\w-]+)/.exec(prelude)?.[2] ?? '').toLowerCase();
}

const indent = block => block.split('\n').map(line => `  ${line}`).join('\n');

function scopeItems(items, context) {
    const { scope, keyframes, warnings } = context;
    const out = [];
    for (const item of items) {
        if (item.prelude[0] === '@') {
            const name = atName(item.prelude);
            const vendor = /^@(-webkit-|-moz-)?/.exec(item.prelude)[1] ?? '';
            if (DROPPED.has(name)) {
                warnings.push(`Dropped @${name}: screens load nothing from outside and keep one page setup.`);
                continue;
            }
            if (item.type === 'statement') {
                if (name === 'layer') out.push(`${item.prelude};`);
                else warnings.push(`Dropped "${item.prelude.slice(0, 60)}".`);
                continue;
            }
            if (name === 'keyframes') {
                const original = /^@(?:-webkit-|-moz-)?keyframes\s+(-?[A-Za-z_][\w-]*)/i.exec(item.prelude)?.[1];
                if (!original) {
                    warnings.push(`Dropped "${item.prelude.slice(0, 60)}": keyframes need a plain name.`);
                    continue;
                }
                const frames = readItems(item.body).filter(frame => frame.type === 'rule').map(frame => {
                    const filtered = filterDeclarations(frame.body, { where: `@keyframes ${original}` });
                    warnings.push(...filtered.warnings);
                    return `  ${frame.prelude} { ${filtered.text} }`;
                });
                out.push(`@${vendor}keyframes ${keyframes.get(original)} {\n${frames.join('\n')}\n}`);
                continue;
            }
            if (name === 'font-face') {
                const filtered = filterDeclarations(item.body, { where: '@font-face' });
                warnings.push(...filtered.warnings);
                if (filtered.text) out.push(`@font-face { ${filtered.text} }`);
                continue;
            }
            if (GROUPS.has(name)) {
                const condition = item.prelude.slice(1 + vendor.length + name.length).trim();
                if (valueProblem(condition)) {
                    warnings.push(`Dropped @${name} ${condition.slice(0, 60)}: it names a URL.`);
                    continue;
                }
                const inner = scopeItems(readItems(item.body), context);
                if (inner.length) out.push(`@${vendor}${name}${condition ? ` ${condition}` : ''} {\n${inner.map(indent).join('\n')}\n}`);
                continue;
            }
            warnings.push(`Dropped @${name}: not allowed in a screen.`);
            continue;
        }
        if (item.type !== 'rule') {
            warnings.push(`Dropped "${item.prelude.slice(0, 60)}": not a rule.`);
            continue;
        }
        if (/[<>]\s*\/?\s*(?:style|script)/i.test(item.prelude) || valueProblem(item.prelude)) {
            warnings.push(`Dropped the rule "${item.prelude.slice(0, 60)}".`);
            continue;
        }
        const selector = scopeSelectorList(item.prelude, scope);
        const filtered = filterDeclarations(item.body, { keyframes, where: item.prelude.slice(0, 60) });
        warnings.push(...filtered.warnings);
        if (selector && filtered.text) out.push(`${selector} { ${filtered.text} }`);
    }
    return out;
}

/**
 * A screen's `theme` as custom properties to set on its root: `[[name, value]]`, names `--x` only,
 * values passing the same checks as declarations. Returns `{ vars, warnings }`.
 */
export function themeVars(theme) {
    const vars = [];
    const warnings = [];
    for (const [name, raw] of Object.entries(theme && typeof theme === 'object' ? theme : {})) {
        const value = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : typeof raw === 'string' ? raw.trim() : null;
        if (!/^--[A-Za-z0-9_-]+$/.test(name)) warnings.push(`Theme key "${name}" is not a custom property (--name).`);
        else if (value === null || /[;{}]/.test(value)) warnings.push(`Theme value for ${name} is not a single CSS value.`);
        else {
            const problem = valueProblem(value);
            if (problem) warnings.push(`Theme value for ${name}: ${problem} is not allowed.`);
            else vars.push([name, value]);
        }
    }
    return { vars, warnings };
}

/** A value for a CSS custom property from data (data-bind-var): numbers as written, safe strings, else ''. */
export function cssVarValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (text.length > 2000 || /[;{}<>\\]/.test(text) || valueProblem(text)) return '';
    return text;
}
