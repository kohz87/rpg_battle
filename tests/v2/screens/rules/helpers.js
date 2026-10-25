// Helpers for the track C screen tests: query answers as tools, and the screens drawn with Story Block's template renderer
// against them (the screens tests' own harness, ../helpers/render.js).

import { MISSING } from './fixtures.js';
import { rulesQueries } from '../../../../src/v2/screens/rules/index.js';
import { QUERIES, makeState } from '../helpers/state.js';
import { renderer, rendererMissing } from '../helpers/runtime.js';

export const skip = renderer ? false : rendererMissing;
export const harness = renderer ? await import('../helpers/render.js') : null;
export const { all, click, draw, propsOf, text } = harness ?? {};

/**
 * Tools over an answers table ({ name: value | (args) => value | MISSING }), like the host's: a name that is not in the
 * table throws "No query called" (an unregistered query), and every name asked is recorded in `log` with its arguments.
 */
export function toolsOf(table, log = []) {
    return {
        log,
        query(name, args = {}) {
            log.push({ name, args });
            if (!Object.hasOwn(table, name) || table[name] === MISSING) throw new Error(`No query called "${name}".`);
            const answer = table[name];
            return typeof answer === 'function' ? answer(args ?? {}) : structuredClone(answer);
        },
    };
}

/**
 * The `queries` table the drawing harness takes: the answers, and every other query RPG Battle's real parts have (but the
 * rpg-battle.* views) blocked, so nothing a fixture does not mention can be answered by the old code by accident.
 */
export function blocked(table, log = [], state = makeState()) {
    const out = {};
    for (const name of Object.keys(QUERIES)) if (!name.startsWith('rpg-battle.')) out[name] = () => { throw new Error(`No query called "${name}".`); };
    // This folder's own view queries, so the pages draw whether or not the screens part has registered them yet.
    for (const [name, view] of Object.entries(rulesQueries)) out[name] = (args, tools) => view(state, args ?? {}, tools);
    // Looked up when asked, so a test can change an answer and draw again (a re-read, a late module).
    for (const name of Object.keys(table)) {
        out[name] = (args = {}) => {
            log.push({ name, args });
            const answer = table[name];
            if (answer === MISSING || answer === undefined) throw new Error(`No query called "${name}".`);
            return typeof answer === 'function' ? answer(args ?? {}) : structuredClone(answer);
        };
    }
    return out;
}

/** Draws `screen` over `table`; `log` records the queries asked (by the views and by the drawing alike). */
export function drawOver(screen, table, options = {}) {
    const log = options.log ?? [];
    const state = options.state ?? makeState();
    return { log, drawn: draw(screen, state, { ...options, queries: blocked(table, log, state) }) };
}

/** Runs a view query (state, args, tools) over the table, the way the host does. */
export const viewOf = (view, table, args = {}, state = makeState(), log = []) => view(state, args, toolsOf(table, log));

/** The buttons under `root` whose label is `label` (every command button on these pages is the command-button widget, which carries no data-command). */
export const pressing = (root, label) => all(root, 'button').filter(button => text(button) === label);
/** What the command-button widgets under `root` say went wrong (a refusal's words), one entry per visible message. */
export const refusals = root => all(root, '.rpg-cb-problem').map(text).filter(Boolean);
export const widgetsIn = (root, name) => all(root, 'ss-widget').filter(el => el.getAttribute('name') === name);
export const names = log => [...new Set(log.map(entry => entry.name))];
export const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** Runs `fn` with a host whose sdk.modules() says `modules` (Story Block's module status), then puts the globals back. */
export function withHost(modules, fn) {
    const before = Object.getOwnPropertyDescriptor(globalThis, 'StoryBlock');
    globalThis.StoryBlock = { sdk: { modules: () => structuredClone(modules) } };
    try { return fn(); } finally {
        if (before) Object.defineProperty(globalThis, 'StoryBlock', before); else delete globalThis.StoryBlock;
    }
}
