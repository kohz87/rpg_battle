// Story Director v2, part **arc**: its settings (module.js namespaces them as `arc.<key>`) and the
// planner prompt's editor with Reset (the settings panel's `section`). Every field is the arc feature's
// (MODULES §F100): with Arc planning off they leave the overlay, and their values are kept.

import { FEATURE } from './domain.js';
import { DEFAULT_LOW_THREADS, DEFAULT_PLANNER_PROMPT, DEFAULT_STALL_DAYS } from './plan.js';

export const PROMPT_MAX = 12000;
const NS = 'arc.';

export const DEFAULTS = Object.freeze({
    profile: '',
    trigger: 'manual',
    autoAccept: false,
    genre: '',
    note: '',
    keepNote: false,
    prompt: '',
    recent: 40,
    maxTokens: 1500,
    stallDays: DEFAULT_STALL_DAYS,
    lowThreads: DEFAULT_LOW_THREADS,
});

const field = spec => Object.freeze({ ...spec, feature: FEATURE });

export const SCHEMA = Object.freeze({
    // A Connection Manager profile's name ('' = the chat's own connection); Story Block draws the dropdown.
    profile: field({ type: 'profile', label: 'Arc planning: Planner connection', help: 'The model that plans arcs. Same as chat uses the chat\'s own connection.' }),
    trigger: field({ type: 'choice', label: 'Arc planning: When to plan', options: [{ value: 'manual', label: 'When I press Plan arc' }, { value: 'auto', label: 'By itself (no arc, arc played out, stalled, running low)' }] }),
    // Off by default: a plan waits for the reader's review. On, it is accepted through the same strict reading and commands.
    autoAccept: field({ type: 'bool', label: 'Arc planning: Accept planned arcs automatically', help: 'A planned arc (yours or one planned by itself) is accepted without review; the Director tab notes that an arc began, without naming it while behind the scenes is hidden.' }),
    genre: field({ type: 'text', label: 'Arc planning: Genre and tone', max: 200 }),
    note: field({ type: 'text', label: 'Arc planning: Director\'s note (used for one arc)', multiline: true, max: 1000 }),
    keepNote: field({ type: 'bool', label: 'Arc planning: Keep the note for every plan' }),
    recent: field({ type: 'int', label: 'Arc planning: Messages the planner reads', min: 4, max: 200 }),
    maxTokens: field({ type: 'int', label: 'Arc planning: Longest plan (tokens)', min: 300, max: 8000 }),
    stallDays: field({ type: 'int', label: 'Arc planning: Stalled after story days without a beat', min: 1, max: 365 }),
    lowThreads: field({ type: 'int', label: 'Arc planning: Running low below open threads (0: never)', min: 0, max: 20 }),
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const int = (value, min, max, fallback) => (Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value)) : fallback);

/** The arc settings out of the module's values (`arc.*` keys, or a part's own un-namespaced ones). */
export function arcSettings(values) {
    const given = isRecord(values) ? values : {};
    const get = key => (Object.hasOwn(given, `${NS}${key}`) ? given[`${NS}${key}`] : given[key]);
    const text = (key, max) => (typeof get(key) === 'string' ? get(key).slice(0, max) : DEFAULTS[key]);
    return {
        profile: text('profile', 100).trim(),
        trigger: get('trigger') === 'auto' ? 'auto' : 'manual',
        autoAccept: get('autoAccept') === true,
        genre: text('genre', 200),
        note: text('note', 1000),
        keepNote: get('keepNote') === true,
        prompt: text('prompt', PROMPT_MAX),
        recent: int(get('recent'), 4, 200, DEFAULTS.recent),
        maxTokens: int(get('maxTokens'), 300, 8000, DEFAULTS.maxTokens),
        stallDays: int(get('stallDays'), 1, 365, DEFAULTS.stallDays),
        lowThreads: int(get('lowThreads'), 0, 20, DEFAULTS.lowThreads),
    };
}

/**
 * The planner prompt's editor (Story Block's settings `section(el, api)`, api = { get, set, values }): a
 * text box holding the reader's prompt (or the default), saved as they type, and Reset, which brings the
 * default back. The default is stored as '' so a newer default reaches readers who never changed it.
 * `needs` (text): shown instead when Story Block cannot make the call.
 */
export function promptSection(el, api, { needs = '' } = {}) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = (tag, className, text) => {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const wrap = make('div', 'sd-arc-prompt');
    if (needs) wrap.append(make('p', 'sd-arc-needs', needs));
    const label = make('label', 'sd-arc-prompt-label', 'Arc planning: Planner prompt');
    const area = make('textarea', 'text_pole sd-arc-prompt-text');
    area.rows = 12;
    area.spellcheck = false;
    area.setAttribute('aria-label', 'Planner prompt');
    const stored = String(api?.get?.(`${NS}prompt`) ?? '');
    area.value = stored.trim() ? stored : DEFAULT_PLANNER_PROMPT;
    const hint = make('p', 'sd-arc-prompt-hint', 'Macros: {{genre}}, {{now}}, {{place}}, {{note}}, {{previous_arc}}, {{tracker}}, {{recent}}, {{fights}}, {{user}}, {{char}}. Code reads only the plan lines the default asks for.');
    const state = make('span', 'sd-arc-prompt-state');
    const show = () => { state.textContent = area.value.trim() && area.value !== DEFAULT_PLANNER_PROMPT ? 'Your own prompt.' : 'The default prompt.'; };
    area.addEventListener('input', () => {
        const value = area.value.slice(0, PROMPT_MAX);
        api?.set?.(`${NS}prompt`, value === DEFAULT_PLANNER_PROMPT || !value.trim() ? '' : value);
        show();
    });
    const reset = make('button', 'menu_button sd-arc-prompt-reset', 'Reset');
    reset.type = 'button';
    reset.addEventListener('click', () => {
        area.value = DEFAULT_PLANNER_PROMPT;
        api?.set?.(`${NS}prompt`, '');
        show();
    });
    show();
    label.append(area);
    const row = make('div', 'sd-arc-prompt-row');
    row.append(reset, state);
    wrap.append(label, hint, row);
    el.append(wrap);
    return wrap;
}
