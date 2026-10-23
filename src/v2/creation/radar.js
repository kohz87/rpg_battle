// The widget `rpg-battle.stat-radar` (creation's Stats step, MODULES §F12): the character's stats as a radar,
// drawn with SVG through DOM calls (createElementNS, setAttribute, textContent; never innerHTML). Its colours are
// the screen's classes, which read Story Block's tokens (`--ss-accent`, `--ss-border`, `--ss-text`, `--ss-muted`).
//
// The text alternative: the same values in a visually hidden list (`.cc-sr-only`), and the SVG's own name says them
// all, so a screen reader hears "Stats: STR 7, VIT 7, …" and can step through the list.
//
// props: axes ([{ label, value }] from creation.build: the stat ids and their final values), label (the accessible
// name), levels (rings, 1 to RADAR_RINGS_MAX). Built with createElement / createElementNS only.

export const STAT_RADAR_WIDGET = 'rpg-battle.stat-radar';
/** The SVG's square drawing area, in its own units (the widget scales it to the card). */
export const RADAR_VIEW = 240;
/** Space kept around the polygon for the stat labels. */
export const RADAR_MARGIN = 30;
/** The rings the grid draws, at most and by default. */
export const RADAR_RINGS_MAX = 6;
export const RADAR_RINGS_DEFAULT = 4;
/** The scale's least top value: a stat of this many fills the outer ring (a creation's stats rarely reach it). */
export const RADAR_SCALE_MIN = 10;
/** The stats drawn at most (the rules have seven; a pack's extra stat is not drawn past this). */
export const RADAR_AXES_MAX = 12;
export const RADAR_LABEL_MAX = 12;

const SVG_NS = 'http://www.w3.org/2000/svg';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cut = (value, max) => Array.from(typeof value === 'string' ? value : '').slice(0, max).join('');
const whole = (value, fallback) => (Number.isFinite(value) ? Math.trunc(value) : fallback);

/** The axes as the widget draws them: a label and a value >= 0, at most RADAR_AXES_MAX. */
export function radarAxes(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(isRecord).slice(0, RADAR_AXES_MAX).map(axis => ({
        label: cut(axis.label, RADAR_LABEL_MAX),
        value: Math.max(0, whole(Number(axis.value), 0)),
    })).filter(axis => axis.label);
}

/** The top value of the scale: the largest stat, and at least RADAR_SCALE_MIN. */
export function radarScale(axes) {
    return Math.max(RADAR_SCALE_MIN, ...axes.map(axis => axis.value));
}

/** The corner of a polygon for axis `index` of `count` at `fraction` (0 to 1) of the radius: the first axis points up. */
export function radarPoint(index, count, fraction) {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    const radius = (RADAR_VIEW / 2 - RADAR_MARGIN) * fraction;
    return [RADAR_VIEW / 2 + radius * Math.cos(angle), RADAR_VIEW / 2 + radius * Math.sin(angle)];
}

function make(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function svgNode(doc, tag, attrs = {}, className = '') {
    const node = doc.createElementNS(SVG_NS, tag);
    if (className) node.setAttribute('class', className);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    return node;
}

const pointsText = points => points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

/** render(el, props, api) → { update(nextProps), destroy() }. */
export function renderStatRadar(el, props = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'ss-w ss-w-stat-radar rpg-radar');
    el.append(root);
    let current = { ...props };

    function draw() {
        root.textContent = '';
        const axes = radarAxes(current.axes);
        const label = cut(current.label, 80) || 'Stats';
        if (!axes.length) {
            root.append(make(doc, 'p', 'rpg-radar-empty', 'No stats yet.'));
            return;
        }
        const levels = Math.min(RADAR_RINGS_MAX, Math.max(1, whole(Number(current.levels), RADAR_RINGS_DEFAULT)));
        const top = radarScale(axes);
        const count = axes.length;
        const spoken = axes.map(axis => `${axis.label} ${axis.value}`).join(', ');

        const svg = svgNode(doc, 'svg', {
            viewBox: `0 0 ${RADAR_VIEW} ${RADAR_VIEW}`,
            role: 'img',
            'aria-label': `${label}: ${spoken}`,
            focusable: 'false',
        });
        for (let ring = 1; ring <= levels; ring += 1) {
            const points = axes.map((_, i) => radarPoint(i, count, ring / levels));
            svg.append(svgNode(doc, 'polygon', { points: pointsText(points) }, 'rpg-radar-ring'));
        }
        axes.forEach((_, i) => {
            const [x, y] = radarPoint(i, count, 1);
            svg.append(svgNode(doc, 'line', { x1: RADAR_VIEW / 2, y1: RADAR_VIEW / 2, x2: x.toFixed(2), y2: y.toFixed(2) }, 'rpg-radar-spoke'));
        });
        const shape = axes.map((axis, i) => radarPoint(i, count, Math.min(1, axis.value / top)));
        svg.append(svgNode(doc, 'polygon', { points: pointsText(shape) }, 'rpg-radar-shape'));
        axes.forEach((axis, i) => {
            const [x, y] = radarPoint(i, count, 1.18);
            const text = svgNode(doc, 'text', { x: x.toFixed(2), y: y.toFixed(2) }, 'rpg-radar-label');
            text.textContent = axis.label;
            svg.append(text);
            const [vx, vy] = radarPoint(i, count, Math.min(1, axis.value / top) + 0.12);
            const value = svgNode(doc, 'text', { x: vx.toFixed(2), y: vy.toFixed(2) }, 'rpg-radar-value');
            value.textContent = String(axis.value);
            svg.append(value);
        });
        root.append(svg);

        // The same numbers for a screen reader (and for anyone who reads the page as text).
        const list = make(doc, 'ul', 'cc-sr-only');
        list.setAttribute('aria-label', `${label}, as a list`);
        for (const axis of axes) list.append(make(doc, 'li', '', `${axis.label} ${axis.value}`));
        root.append(list);
    }

    draw();
    return {
        update(next = {}) {
            current = { ...next };
            draw();
        },
        destroy() {
            root.remove();
        },
    };
}

export const statRadar = Object.freeze({
    props: Object.freeze({
        axes: Object.freeze({ type: 'array', required: false, default: [] }),
        label: Object.freeze({ type: 'string', required: false, default: 'Stats' }),
        levels: Object.freeze({ type: 'number', required: false, default: RADAR_RINGS_DEFAULT }),
    }),
    validate(props = {}) {
        const problems = [];
        if (props.axes !== undefined && !Array.isArray(props.axes)) problems.push('axes must be a list of stats.');
        return problems;
    },
    render: renderStatRadar,
});
