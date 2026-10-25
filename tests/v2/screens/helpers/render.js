// Draws a screen the way Story Block's mounts do (src/v2/view/mounts/common.js drawScreen): its
// `data` queries resolved against the given state, then the template rendered into a fake element
// with the scope { state, q, draft, settings, changes, mount }. Widgets are stand-ins that keep the
// props they were given (`propsOf(el)`), so the tests see exactly what each ss.* widget would draw
// from; buttons' commands are recorded instead of run.

import { installDom } from './dom.js';
import { renderer, resolveData, widgets as standard } from './runtime.js';
import { toolsFor } from './state.js';
import { screenWidgets } from '../../../../src/v2/screens/widgets.js';
import { rulesWidgets } from '../../../../src/v2/screens/rules/widgets.js';
import { CREATE_BUTTON_WIDGET, createButton } from '../../../../src/v2/creation/create-button.js';
import { part as returnPart, WIDGET as RETURN_WIDGET } from '../../../../src/v2/return/index.js';

export const WIDGET_NAMES = ['ss.meter', 'ss.radar', 'ss.map', 'ss.skill-tree', 'ss.portrait', 'ss.badge', 'ss.timeline', 'ss.stepper', 'ss.hero', 'ss.tiers', 'ss.bar', 'ss.status'];

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
 * The tools over `state` with `extra` queries ({ name: (args, tools) → value }) laid over the real
 * ones: stand-ins for other parts' queries this build may not have yet (party.effects, items.condition…).
 */
export const toolsWith = (state, settings, extra = {}) => toolsFor(state, settings, extra);

/**
 * draw(screen, state, { mount, changes, settings, draft, result, real, queries, preview }) →
 * { el, view, q, problems, commands, widgets, warnings, rerender(state?, changes?) }.
 * `result(type, payload)` answers the recorded commands (default: ok). With `real`, Story Block's own
 * standard widgets draw instead of the stand-ins; RPG Battle's own widgets (screens/widgets.js) always
 * draw for real, with a widget api whose `query` reads the drawn state and whose `preview` is the
 * option's (recorded in `previews`), and `dialog` the option's (a dialog api: { open, current? }). `queries` are stand-ins for other parts' queries (toolsWith).
 */
export function draw(screen, state, { mount = screen.mounts[0], changes = [], settings = {}, draft = null, result = () => ({ ok: true }), real = false, queries = {}, preview = null, dialog = null } = {}) {
    const doc = installDom();
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    el.setAttribute('data-ss-screen', screen.id);
    el.setAttribute('data-ss-mount', mount);
    const compiled = renderer.compileTemplate(screen.template);
    const commands = [];
    const previews = [];
    const widgets = [];
    let current = state;
    const warnings = [...compiled.warnings];
    const evaluate = renderer.conditionEvaluator({ compile: renderer.events.compile, evaluate: renderer.events.evaluate });
    const options = {
        evaluate,
        widgets: { ...(real ? standard.standardWidgets : stubWidgets(widgets)), ...screenWidgets, ...rulesWidgets, [CREATE_BUTTON_WIDGET]: createButton, [RETURN_WIDGET]: returnPart.widgets[RETURN_WIDGET] },
        api: {
            ...(dialog ? { dialog } : {}),
            query: (name, args) => toolsWith(current, settings, queries).query(name, args),
            preview: async (type, payload) => {
                previews.push({ type, payload });
                return typeof preview === 'function' ? preview(type, payload) : { ok: false, code: 'NO_PREVIEW', message: 'No preview here.' };
            },
        },
        command: (type, payload) => {
            commands.push({ type, payload });
            return result(type, payload);
        },
        onWarn: message => warnings.push(message),
    };
    let data = null;
    const scopeFor = (next, currentChanges) => {
        current = next;
        data = resolveData(screen.data, (name, args) => toolsWith(next, settings, queries).query(name, args));
        if (!data.ok) throw new Error(data.message);
        return { state: next, q: data.q, draft, settings, changes: [...currentChanges], mount, index: 0, screenId: screen.id, api: {} };
    };
    const view = renderer.renderTemplate(el, compiled, scopeFor(state, changes), options);
    return {
        el, view, commands, previews, widgets, warnings, compiled,
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
