// Draws a screen the way Story Block's mounts do (src/v2/view/mounts/common.js drawScreen): its
// `data` queries resolved against the given state, then the template rendered into a fake element
// with the scope { state, q, draft, settings, changes, mount }. Widgets are stand-ins that keep the
// props they were given (`propsOf(el)`), so the tests see exactly what each ss.* widget would draw
// from; buttons' commands are recorded instead of run.

import { installDom } from './dom.js';
import { renderer, resolveData, widgets as standard } from './runtime.js';
import { runQuery } from './state.js';

export const WIDGET_NAMES = ['ss.meter', 'ss.radar', 'ss.map', 'ss.skill-tree', 'ss.portrait', 'ss.badge', 'ss.timeline', 'ss.stepper'];

const kept = new WeakMap();
/** The props the widget in `el` (an <ss-widget>) was last drawn with. */
export const propsOf = el => kept.get(el) ?? null;

function stubWidgets(log) {
    return Object.fromEntries(WIDGET_NAMES.map(name => [name, {
        render(el, props, api) {
            kept.set(el, props);
            log.push({ name, props, api });
            const root = el.ownerDocument.createElement('div');
            root.className = `ss-w ss-w-${name.slice(3)}`;
            el.appendChild(root);
            return {
                update(next) { kept.set(el, next); log.push({ name, props: next, api }); },
                destroy() { root.remove(); },
            };
        },
    }]));
}

/**
 * draw(screen, state, { mount, changes, settings, draft, result, real }) →
 * { el, view, q, problems, commands, widgets, warnings, rerender(state?, changes?) }.
 * `result(type, payload)` answers the recorded commands (default: ok). With `real`, Story Block's own
 * standard widgets draw instead of the stand-ins.
 */
export function draw(screen, state, { mount = screen.mounts[0], changes = [], settings = {}, draft = null, result = () => ({ ok: true }), real = false } = {}) {
    const doc = installDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    el.setAttribute('data-ss-screen', screen.id);
    el.setAttribute('data-ss-mount', mount);
    const compiled = renderer.compileTemplate(screen.template);
    const commands = [];
    const widgets = [];
    const warnings = [...compiled.warnings];
    const evaluate = renderer.conditionEvaluator({ compile: renderer.events.compile, evaluate: renderer.events.evaluate });
    const options = {
        evaluate,
        widgets: real ? standard.standardWidgets : stubWidgets(widgets),
        command: (type, payload) => {
            commands.push({ type, payload });
            return result(type, payload);
        },
        onWarn: message => warnings.push(message),
    };
    let data = null;
    const scopeFor = (current, currentChanges) => {
        data = resolveData(screen.data, (name, args) => runQuery(name, args, current));
        if (!data.ok) throw new Error(data.message);
        return { state: current, q: data.q, draft, settings, changes: [...currentChanges], mount, index: 0, screenId: screen.id, api: {} };
    };
    const view = renderer.renderTemplate(el, compiled, scopeFor(state, changes), options);
    return {
        el, view, commands, widgets, warnings, compiled,
        get q() { return data.q; },
        get problems() { return data.problems; },
        rerender(next = state, nextChanges = changes) { renderer.renderTemplate(el, compiled, scopeFor(next, nextChanges), options); },
    };
}

/** Every element under `root` matching `selector` (the fake DOM's selector engine). */
export const all = (root, selector) => root.querySelectorAll(selector);

/** The text of an element with runs of white space made one. */
export const text = el => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Clicks and waits for the command it starts. */
export async function click(el) {
    el.dispatch('click');
    await new Promise(resolve => setTimeout(resolve, 0));
}
