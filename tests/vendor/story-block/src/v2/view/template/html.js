// A small, tolerant HTML reader for screen templates (no DOM needed, so it runs in Node tests and never
// touches innerHTML in the page). It follows the browser where templates are likely to differ: void
// elements, raw text elements (`script`, `style`, `textarea`, …), entity decoding, attribute names
// lowercased in HTML and case-restored in SVG, `/>` closing only void and SVG elements, implicit ends
// for `p`, `li`, `option`, `tr`, `td`/`th`, `dt`/`dd`, and a `tbody` put in when a `tr` sits in a table.
// Full HTML5 tree building (foster parenting, adoption agency) is out of scope; the docs ask for
// well-formed templates.
//
// Nodes: `{ type: 'element', tag, svg, attrs: [[name, value]], children }` and `{ type: 'text', text }`.

export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
const RCDATA = new Set(['textarea', 'title']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);

const TABLE_SCOPE = new Set(['table', 'td', 'th', 'caption']);
const TABLE_TAGS = new Set(['table', 'caption', 'colgroup', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th']);
const SVG_TAGS = ['altGlyph', 'clipPath', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feOffset', 'foreignObject', 'linearGradient', 'radialGradient', 'textPath', 'animateMotion', 'animateTransform'];
const SVG_ATTRS = ['viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'patternUnits', 'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'pathLength', 'spreadMethod', 'textLength', 'lengthAdjust', 'stdDeviation', 'markerWidth', 'markerHeight', 'refX', 'refY', 'startOffset', 'baseFrequency', 'attributeName', 'repeatCount'];
const SVG_TAG_CASE = new Map(SVG_TAGS.map(name => [name.toLowerCase(), name]));
const SVG_ATTR_CASE = new Map(SVG_ATTRS.map(name => [name.toLowerCase(), name]));

const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', copy: '©', reg: '®', trade: '™',
    hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    middot: '·', bull: '•', times: '×', divide: '÷', deg: '°', plusmn: '±', larr: '←', rarr: '→', uarr: '↑',
    darr: '↓', harr: '↔', hearts: '♥', diams: '♦', clubs: '♣', spades: '♠', star: '☆', sect: '§', para: '¶',
    frac12: '½', frac14: '¼', frac34: '¾', le: '≤', ge: '≥', ne: '≠', minus: '−', infin: '∞', check: '✓',
    tab: '\t', newline: '\n', colon: ':', lpar: '(', rpar: ')', sol: '/', bsol: '\\', semi: ';', comma: ',',
    period: '.', excl: '!', quest: '?', num: '#', percnt: '%', equals: '=', grave: '`', lbrace: '{', rbrace: '}',
};

/** Decode character references (`&amp;`, `&#58;`, `&#x3A;`, also without the `;` for numbers). */
export function decodeEntities(text) {
    if (!text.includes('&')) return text;
    return text.replace(/&(?:#(\d{1,7});?|#[xX]([0-9a-fA-F]{1,6});?|([A-Za-z][A-Za-z0-9]{1,31});)/g, (match, dec, hex, name) => {
        if (dec || hex) {
            const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
            if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
            return String.fromCodePoint(code);
        }
        return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : match;
    });
}

/** Parse template HTML into nodes. */
export function parseHtml(source) {
    const html = String(source ?? '');
    const root = { type: 'element', tag: '#root', svg: false, attrs: [], children: [] };
    const stack = [root];
    const current = () => stack[stack.length - 1];
    const inSvg = () => stack.some(node => node.tag === 'svg');
    const pushText = text => {
        if (!text) return;
        const parent = current();
        const last = parent.children[parent.children.length - 1];
        if (last?.type === 'text') last.text += text;
        else parent.children.push({ type: 'text', text });
    };
    const closeTo = tag => {
        for (let i = stack.length - 1; i > 0; i -= 1) {
            if (stack[i].tag === tag) {
                stack.length = i;
                return true;
            }
            // An end tag does not reach out of a table cell, a table or an svg (an unmatched one is ignored).
            if (stack[i].tag === 'svg' || (TABLE_SCOPE.has(stack[i].tag) && !TABLE_TAGS.has(tag))) return false;
        }
        return false;
    };
    let at = 0;
    while (at < html.length) {
        const lt = html.indexOf('<', at);
        if (lt < 0) {
            pushText(decodeEntities(html.slice(at)));
            break;
        }
        if (lt > at) pushText(decodeEntities(html.slice(at, lt)));
        at = lt;
        const rest = html.slice(at, at + 2);
        if (html.startsWith('<!--', at)) {
            const end = html.indexOf('-->', at + 4);
            at = end < 0 ? html.length : end + 3;
            continue;
        }
        if (rest === '<!' || rest === '<?') {
            const cdata = html.startsWith('<![CDATA[', at) ? html.indexOf(']]>', at) : -1;
            const end = cdata >= 0 ? cdata + 2 : html.indexOf('>', at);
            at = end < 0 ? html.length : end + 1;
            continue;
        }
        if (rest === '</') {
            const match = /^<\/([A-Za-z][^\s/>]*)[^>]*>?/.exec(html.slice(at));
            if (!match) {
                // `</` not followed by a name: a bogus comment in HTML; skip to `>`.
                const end = html.indexOf('>', at);
                at = end < 0 ? html.length : end + 1;
                continue;
            }
            at += match[0].length;
            const name = match[1].toLowerCase();
            const tag = inSvg() ? SVG_TAG_CASE.get(name) ?? name : name;
            closeTo(tag);
            continue;
        }
        const open = /^<([A-Za-z][^\s/>]*)/.exec(html.slice(at));
        if (!open) {
            pushText('<');
            at += 1;
            continue;
        }
        at += open[0].length;
        const { attrs, selfClosing, end } = readAttributes(html, at);
        at = end;
        const lower = open[1].toLowerCase();
        const svg = inSvg() || lower === 'svg';
        const tag = svg ? SVG_TAG_CASE.get(lower) ?? lower : lower;
        const element = { type: 'element', tag, svg, attrs: fixAttrCase(attrs, svg), children: [] };
        if (!svg) implicitEnds(tag, stack);
        if (!svg && tag === 'tr' && current().tag === 'table') {
            const body = { type: 'element', tag: 'tbody', svg: false, attrs: [], children: [] };
            current().children.push(body);
            stack.push(body);
        }
        current().children.push(element);
        if (!svg && (RAW.has(tag) || RCDATA.has(tag))) {
            const close = new RegExp(`</${tag}(?=[\\s/>])[^>]*>|</${tag}$`, 'i').exec(html.slice(at));
            const body = close ? html.slice(at, at + close.index) : html.slice(at);
            if (body) element.children.push({ type: 'text', text: RCDATA.has(tag) ? decodeEntities(body) : body });
            at = close ? at + close.index + close[0].length : html.length;
            continue;
        }
        if ((VOID.has(tag) && !svg) || (selfClosing && svg)) continue;
        stack.push(element);
    }
    return root.children;
}

function implicitEnds(tag, stack) {
    const top = () => stack[stack.length - 1];
    if (CLOSES_P.has(tag) && stack.some(node => node.tag === 'p')) {
        for (let i = stack.length - 1; i > 0; i -= 1) {
            if (stack[i].tag === 'p') {
                stack.length = i;
                break;
            }
            if (!['span', 'b', 'i', 'em', 'strong', 'small', 'a', 'label', 'code'].includes(stack[i].tag)) break;
        }
    }
    if (tag === 'li' && top().tag === 'li') stack.pop();
    if ((tag === 'dt' || tag === 'dd') && ['dt', 'dd'].includes(top().tag)) stack.pop();
    if (tag === 'option' && top().tag === 'option') stack.pop();
    if (tag === 'optgroup') {
        if (top().tag === 'option') stack.pop();
        if (top().tag === 'optgroup') stack.pop();
    }
    if ((tag === 'td' || tag === 'th') && ['td', 'th'].includes(top().tag)) stack.pop();
    if (tag === 'tr') {
        if (['td', 'th'].includes(top().tag)) stack.pop();
        if (top().tag === 'tr') stack.pop();
    }
    if (['tbody', 'thead', 'tfoot'].includes(tag)) {
        if (['td', 'th'].includes(top().tag)) stack.pop();
        if (top().tag === 'tr') stack.pop();
        if (['tbody', 'thead', 'tfoot'].includes(top().tag)) stack.pop();
    }
}

function fixAttrCase(attrs, svg) {
    return attrs.map(([name, value]) => {
        if (!svg) return [name, value];
        if (name === 'xlink:href') return [name, value];
        return [SVG_ATTR_CASE.get(name) ?? name, value];
    });
}

/** Read attributes after a tag name; returns `{ attrs, selfClosing, end }` (end is after `>`). */
function readAttributes(html, start) {
    const attrs = [];
    const seen = new Set();
    let at = start;
    let selfClosing = false;
    while (at < html.length) {
        while (/[\s]/.test(html[at] ?? '')) at += 1;
        const char = html[at];
        if (char === undefined) break;
        if (char === '>') {
            at += 1;
            return { attrs, selfClosing, end: at };
        }
        if (char === '/') {
            at += 1;
            if (html[at] === '>') {
                selfClosing = true;
                at += 1;
                return { attrs, selfClosing, end: at };
            }
            continue;
        }
        const nameMatch = /^[^\s"'>/=]+|^=[^\s"'>/=]*/.exec(html.slice(at));
        const name = nameMatch[0].toLowerCase();
        at += nameMatch[0].length;
        while (/\s/.test(html[at] ?? '')) at += 1;
        let value = '';
        if (html[at] === '=') {
            at += 1;
            while (/\s/.test(html[at] ?? '')) at += 1;
            const quote = html[at];
            if (quote === '"' || quote === '\'') {
                const close = html.indexOf(quote, at + 1);
                value = html.slice(at + 1, close < 0 ? html.length : close);
                at = close < 0 ? html.length : close + 1;
            } else {
                const raw = /^[^\s>]*/.exec(html.slice(at))[0];
                value = raw;
                at += raw.length;
            }
        }
        if (!seen.has(name)) {
            seen.add(name);
            attrs.push([name, decodeEntities(value)]);
        }
    }
    return { attrs, selfClosing, end: html.length };
}

const escapeText = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const escapeAttr = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');

/** Nodes back to HTML text (escaped; void elements without an end tag). */
export function serializeHtml(nodes) {
    return nodes.map(node => {
        if (node.type === 'text') return escapeText(node.text);
        const attrs = node.attrs.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join('');
        if (VOID.has(node.tag) && !node.svg) return `<${node.tag}${attrs}>`;
        if (node.svg && !node.children.length) return `<${node.tag}${attrs}/>`;
        return `<${node.tag}${attrs}>${serializeHtml(node.children)}</${node.tag}>`;
    }).join('');
}
