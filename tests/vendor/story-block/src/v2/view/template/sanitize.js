// The template allow-list (SPEC §13.2). Every template goes through it, after the host's DOMPurify when
// there is one, so the rules hold the same with or without DOMPurify:
// * elements: layout, text, lists, tables, forms (without `action`), images and inline SVG, plus
//   `ss-widget`. `script`, `style`, `iframe`, `object`, `embed`, `link`, `meta`, `base`, `template`,
//   `noscript`, `foreignObject`, SVG animation elements and MathML are dropped with their content; other
//   unknown elements are dropped and their children kept;
// * attributes: an allow-list per element plus `data-*` (not `data-ss-*`) and `aria-*`; never `on*`,
//   `action`, `formaction`, `srcdoc`, `srcset`, `ping`;
// * URLs: `src` (images) `https:` or `data:image/…`; links `https:` or `#…`; SVG `href` `#…` (and on an
//   SVG `<image>`, images as above); anything else drops the attribute;
// * `style` attributes are filtered like screen CSS (css.js), and `{{ }}` is never read inside them;
// * inputs keep safe types (`password`, `file`, `image` become text or go); links that open a new tab get
//   `rel="noopener noreferrer"`.
// `strictSanitize(html)` is the DOMPurify-shaped fallback (string in, string out).

import { filterDeclarations } from '../css.js';
import { parseHtml, serializeHtml } from './html.js';

const HTML_TAGS = new Set([
    'a', 'abbr', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'button', 'caption', 'cite', 'code',
    'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'fieldset', 'figcaption',
    'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'input', 'ins',
    'kbd', 'label', 'legend', 'li', 'main', 'mark', 'meter', 'nav', 'ol', 'optgroup', 'option', 'output', 'p',
    'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'select', 'small', 'span', 'strong',
    'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'time', 'tr', 'u',
    'ul', 'var', 'wbr', 'ss-widget',
]);
const SVG_TAGS = new Set([
    'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'text', 'tspan', 'textPath',
    'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'symbol', 'use', 'title',
    'desc', 'image', 'marker',
]);
/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base',
    'template', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext', 'title', 'head', 'math', 'foreignObject',
    'animate', 'animateMotion', 'animateTransform', 'set', 'handler', 'listener', 'portal', 'param', 'audio',
    'video', 'source', 'track', 'canvas', 'dialog', 'slot',
]);

const GLOBAL_ATTRS = new Set(['class', 'id', 'title', 'role', 'lang', 'dir', 'hidden', 'tabindex', 'style', 'translate']);
const ATTRS = {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    input: ['type', 'name', 'value', 'placeholder', 'min', 'max', 'step', 'checked', 'disabled', 'readonly', 'required', 'maxlength', 'minlength', 'size', 'autocomplete', 'inputmode'],
    select: ['name', 'disabled', 'required', 'size'],
    option: ['value', 'selected', 'disabled', 'label'],
    optgroup: ['label', 'disabled'],
    textarea: ['name', 'rows', 'cols', 'placeholder', 'maxlength', 'minlength', 'disabled', 'readonly', 'required', 'wrap'],
    button: ['type', 'name', 'value', 'disabled'],
    form: ['name', 'novalidate', 'autocomplete'],
    fieldset: ['disabled', 'name'],
    label: ['for'],
    output: ['for', 'name'],
    td: ['colspan', 'rowspan', 'headers'],
    th: ['colspan', 'rowspan', 'headers', 'scope', 'abbr'],
    col: ['span'],
    colgroup: ['span'],
    ol: ['start', 'reversed', 'type'],
    li: ['value'],
    progress: ['value', 'max'],
    meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
    time: ['datetime'],
    data: ['value'],
    details: ['open'],
    del: ['datetime'],
    ins: ['datetime'],
    'ss-widget': ['name'],
};
const SVG_ATTRS = new Set([
    'viewBox', 'width', 'height', 'xmlns', 'preserveAspectRatio', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'fill-opacity',
    'stroke-opacity', 'fill-rule', 'clip-rule', 'transform', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1',
    'x2', 'y2', 'dx', 'dy', 'fx', 'fy', 'points', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits',
    'gradientTransform', 'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform', 'clipPathUnits',
    'maskUnits', 'maskContentUnits', 'clip-path', 'mask', 'text-anchor', 'dominant-baseline', 'alignment-baseline',
    'font-size', 'font-weight', 'font-family', 'font-style', 'letter-spacing', 'pathLength', 'textLength',
    'lengthAdjust', 'rotate', 'startOffset', 'vector-effect', 'visibility', 'display', 'href', 'xlink:href',
    'marker-start', 'marker-mid', 'marker-end', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
    'shape-rendering', 'paint-order',
]);
const INPUT_TYPES = new Set(['text', 'number', 'range', 'checkbox', 'radio', 'search', 'color', 'hidden', 'submit', 'reset', 'button', 'email', 'tel', 'date', 'time']);

/** The DOMPurify options Story Block passes (`sanitize(html, PURIFY_CONFIG)`); the allow-list runs after. */
export const PURIFY_CONFIG = Object.freeze({
    ADD_TAGS: ['ss-widget'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'template', 'foreignObject', 'math'],
    FORBID_ATTR: ['action', 'formaction', 'srcdoc', 'srcset', 'ping', 'background'],
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP: /^(?:https:|data:image\/|#)/i,
    SAFE_FOR_TEMPLATES: false,
    WHOLE_DOCUMENT: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
});

/** A URL with control characters and spaces removed, lowercased: what a browser would act on. */
const flatUrl = url => String(url).replace(/[\u0000- \u007f]+/g, '').toLowerCase();

/** `https:` or `data:image/…` (not `data:image/svg+xml` with script-y content is still inert in <img>). */
export const isImageUrl = url => {
    const flat = flatUrl(url);
    return flat.startsWith('https:') || flat.startsWith('data:image/');
};
/** `https:` or a same-page `#fragment`. */
export const isLinkUrl = url => {
    const flat = flatUrl(url);
    return flat.startsWith('https:') || flat.startsWith('#');
};

/**
 * Whether an attribute (already allowed by name) may carry this value, for the element. URL attributes
 * are checked here; the template renderer calls it again for every bound value.
 */
export function urlAllowed(tag, name, value) {
    if (name === 'src') return isImageUrl(value);
    if (name === 'href' || name === 'xlink:href') {
        if (tag === 'a') return isLinkUrl(value);
        if (tag === 'image') return isImageUrl(value) || flatUrl(value).startsWith('#');
        return flatUrl(value).startsWith('#');
    }
    return true;
}

/** True for attribute names whose value is a URL. */
export const isUrlAttr = name => name === 'src' || name === 'href' || name === 'xlink:href';

/** Whether an element may have an attribute of this name (values are checked separately). */
export function attrAllowed(tag, svg, name) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on') || ['action', 'formaction', 'srcdoc', 'srcset', 'ping', 'background', 'is', 'xmlns:xlink'].includes(lower)) return false;
    if (lower.startsWith('data-ss-')) return false;
    if (lower.startsWith('data-')) return /^data-[a-z0-9-]+$/.test(lower);
    if (lower.startsWith('aria-')) return /^aria-[a-z]+$/.test(lower);
    if (GLOBAL_ATTRS.has(lower)) return true;
    if (svg) return SVG_ATTRS.has(name);
    return (ATTRS[tag] ?? []).includes(lower);
}

/** Filter parsed nodes through the allow-list. Returns `{ nodes, warnings }`. */
export function filterNodes(nodes, warnings = []) {
    const out = [];
    for (const node of nodes) {
        if (node.type === 'text') {
            out.push({ type: 'text', text: node.text });
            continue;
        }
        const { tag, svg } = node;
        if (DROP_WITH_CONTENT.has(tag) && !(svg && tag === 'title')) {
            warnings.push(`Removed <${tag}>: not allowed in a screen.`);
            continue;
        }
        const known = svg ? SVG_TAGS.has(tag) : HTML_TAGS.has(tag);
        const children = filterNodes(node.children, warnings).nodes;
        if (!known) {
            warnings.push(`Removed <${tag}> (its content kept): not an allowed element.`);
            out.push(...children);
            continue;
        }
        out.push({ type: 'element', tag, svg, attrs: filterAttrs(tag, svg, node.attrs, warnings), children });
    }
    return { nodes: out, warnings };
}

function filterAttrs(tag, svg, attrs, warnings) {
    const out = [];
    for (const [name, value] of attrs) {
        if (!attrAllowed(tag, svg, name)) {
            warnings.push(`Removed ${name} from <${tag}>.`);
            continue;
        }
        if (isUrlAttr(name) && !urlAllowed(tag, name, value)) {
            warnings.push(`Removed ${name} from <${tag}>: only https: (and data: images) are allowed.`);
            continue;
        }
        if (name === 'style') {
            if (value.includes('{{')) warnings.push(`<${tag}> style is not bound: use data-bind-var and CSS variables.`);
            const filtered = filterDeclarations(value.replace(/\{\{[\s\S]*?\}\}/g, ''), { where: `<${tag}> style` });
            warnings.push(...filtered.warnings);
            if (filtered.text) out.push([name, filtered.text]);
            continue;
        }
        if (tag === 'input' && name === 'type') {
            const type = value.trim().toLowerCase();
            if (type === 'image' || type === 'file') {
                warnings.push(`Removed <input type="${type}">'s type.`);
                continue;
            }
            out.push([name, INPUT_TYPES.has(type) ? type : 'text']);
            continue;
        }
        if (tag === 'button' && name === 'type') {
            const type = value.trim().toLowerCase();
            out.push([name, ['button', 'submit', 'reset'].includes(type) ? type : 'button']);
            continue;
        }
        if (tag === 'a' && name === 'target') {
            if (value.trim() === '_blank') out.push([name, '_blank']);
            continue;
        }
        if (tag === 'a' && name === 'rel') continue;
        out.push([name, value]);
    }
    if (tag === 'a' && out.some(([name]) => name === 'target')) out.push(['rel', 'noopener noreferrer']);
    return out;
}

/** Parse and filter template HTML: `{ nodes, warnings }`. */
export function sanitizeNodes(html) {
    return filterNodes(parseHtml(html));
}

/** The strict allow-list as a DOMPurify-shaped function: HTML text in, safe HTML text out. */
export function strictSanitize(html) {
    return serializeHtml(sanitizeNodes(html).nodes);
}
