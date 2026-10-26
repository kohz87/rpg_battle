// Story Director v2: the module definition (MODULES §A, §C). The parts (tracker, quests, time,
// atlas, chronicle, world, arc, screens) are merged here into the one `sdk.registerModule` definition of module
// `story-director`:
//
// - domains, commands, queries: the parts' own, each name owned by one part (a clash throws);
// - capture: every part's kinds with their one-line grammar; `apply` dispatches by `line.kind`
//   to the part that owns the kind;
// - context: statics joined in part order (the same bytes every reply for one set of modules), tails
//   concatenated in part order, budgets summed. Parts are told `{ fights }` (statics, kinds whose
//   grammar is a function, and `view.fights` / `ctx.fights`): whether a module runs fights, learnt
//   before each reply (fightRunner), so Story Director alone asks for no encounters (WAVE rule 11);
//   the parts' `context.parts` (static or tail text under a feature) are passed on as the module's;
// - hooks: every part's function of a name, called in part order;
// - settings: each part's keys are namespaced under its part id (`tracker.dormantReplies`; a part's
//   `section(el, api)` function, the arc's planner prompt editor, is the module's custom panel), a
//   `group` field is flattened into dotted keys (`tracker.calendar.months`) because the Story
//   Suite overlay shows flat fields. A part reads its own settings back as it wrote them: the
//   ctx, view and api handed to it have `settings()` → that part's values, un-namespaced. A part's
//   `settings.reads: { key: '<part>.<key>' }` hands it another part's setting under its own name
//   when it has none (the time part reads `tracker.calendar` as `calendar`); the tracker's calendar
//   is handed over as the chat uses it (the reader's, else the enabled pack's, else Gregorian);
// - queries: called (state, args, tools) with the host's tools plus `tools.settings()` (the part's
//   own settings: the host's tools.settings when it passes one, else Story Block's
//   `sdk.settings('story-director')`, else the defaults) and `tools.substitute(text)` ({{user}} and
//   {{char}} through Story Block's `sdk.substitute` when it is there). The atlas's trip queries get
//   the reader's map settings as `map` when the caller gives none;
// - tabs: the parts' tabs in part order (none now: the screens show quests, threads and the map);
// - screens: every part's `screens`, in part order; widgets: every part's `widgets`. A screen id
//   or widget name in two parts throws;
// - features (MODULES §F100): every part's `features`, in part order (an id in two parts throws); a
//   command's or query's `feature` tag is kept on its wrapper. Kinds, screens and context keep theirs.
// Parts never import each other; they talk through commands and queries (ctx.call, ctx.query).

import { part as tracker } from './tracker/index.js';
import { part as time } from './time/index.js';
import { part as atlas } from './atlas/index.js';
import { part as chronicle } from './chronicle/index.js';
import { part as world } from './world/index.js';
import { part as arc } from './arc/index.js';
import { part as checks } from './checks/index.js';
import { part as screens } from './screens/index.js';
import { calendarConfig, packCalendarOf } from './tracker/time.js';
import { fightsAmong } from './fights.js';

export const MODULE_ID = 'story-director';
export const MODULE_NAME = 'Story Director';
export const VERSION = '2.0.0-beta.2';

/** The Story Block versions this module runs on (`requires.storyBlock`). */
export const STORY_BLOCK_RANGE = '>=2.0.0-beta.2';

/** The parts in their fixed order: [id, part]. The order is the static prompt's and the tail's order. */
export const PARTS = Object.freeze([['tracker', tracker], ['time', time], ['atlas', atlas], ['chronicle', chronicle], ['world', world], ['arc', arc], ['checks', checks], ['screens', screens]]);

// Story Block's sdk when it is up (SillyTavern): what queries are handed when the host's tools lack it.
function liveSdk() {
    try {
        return globalThis.StoryBlock?.sdk ?? null;
    } catch {
        return null;
    }
}
const tryLive = (fn, fallback) => {
    try {
        return fn() ?? fallback;
    } catch {
        return fallback;
    }
};
const LIVE_HOST = Object.freeze({
    settings: id => tryLive(() => liveSdk()?.settings?.(id), null),
    substitute: text => tryLive(() => liveSdk()?.substitute?.(text), undefined),
});

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

import { CALENDAR_KEYS, liveCalendarSettings } from './tracker/calendar-settings.js';

// ---- settings --------------------------------------------------------------------------------

/** A schema field as the overlay knows it: `choices` is `options`. */
function overlayField(field) {
    if (!isObject(field)) return field;
    const { choices, ...rest } = field;
    return field.type === 'choice' && rest.options === undefined && Array.isArray(choices) ? { ...rest, options: choices } : rest;
}

/**
 * One part's settings, namespaced: `{ defaults, schema }` with keys `<ns>.<key>` and a group's
 * fields `<ns>.<group>.<field>` (labels "Group: Field"). Defaults of a group that the schema has
 * no field for (v1 calendar details) are kept under the same dotted keys.
 */
export function namespaced(ns, settings = {}) {
    const defaults = {};
    const schema = {};
    const groups = new Set();
    for (const [key, field] of Object.entries(settings.schema ?? {})) {
        if (isObject(field) && field.type === 'group') {
            groups.add(key);
            for (const [sub, inner] of Object.entries(field.fields ?? {})) {
                const label = [field.label, inner?.label].filter(Boolean).join(': ');
                schema[`${ns}.${key}.${sub}`] = overlayField(label ? { ...inner, label } : inner);
            }
        } else schema[`${ns}.${key}`] = overlayField(field);
    }
    for (const [key, value] of Object.entries(settings.defaults ?? {})) {
        if (groups.has(key) && isObject(value)) for (const [sub, inner] of Object.entries(value)) defaults[`${ns}.${key}.${sub}`] = structuredClone(inner);
        else defaults[`${ns}.${key}`] = structuredClone(value);
    }
    return { defaults, schema };
}

/** A part's own settings out of the module's (namespaced) values: dotted keys made nested again. */
export function partSettings(ns, values) {
    const out = {};
    const prefix = `${ns}.`;
    for (const [key, value] of Object.entries(isObject(values) ? values : {})) {
        if (!key.startsWith(prefix)) continue;
        const path = key.slice(prefix.length).split('.');
        let at = out;
        for (const name of path.slice(0, -1)) {
            if (!isObject(at[name])) at[name] = {};
            at = at[name];
        }
        at[path.at(-1)] = structuredClone(value);
    }
    return out;
}

// A setting handed to another part through `reads`, as the chat uses it: the tracker's calendar
// setting becomes the chat's calendar (its `pack` preset resolved against the packs' calendar).
const READ_AS_USED = {
    'tracker.calendar': (value, query) => calendarConfig({ calendar: value ?? null }, packCalendarOf(query)),
};

/** A part's `reads` as [key, part id, path inside that part's settings, what the path names]. */
function readsOf(settings) {
    const reads = isObject(settings?.reads) ? settings.reads : {};
    return Object.entries(reads).filter(([, path]) => typeof path === 'string' && path.includes('.'))
        .map(([key, path]) => {
            const [from, ...rest] = path.split('.');
            return [key, from, rest, path];
        });
}

// `settings(id?)` for a part: no id (or this module's) → the part's values (its defaults under the
// module's values, then what it reads from other parts); another id → as given. `query` resolves
// settings read as the chat uses them.
function settingsFor(ns, base, { defaults = {}, reads = [], query = null } = {}) {
    return (id) => {
        if (id !== undefined && id !== null && id !== MODULE_ID) return (typeof base === 'function' ? base(id) : null) ?? {};
        const given = typeof base === 'function' ? base(MODULE_ID) : base;
        const values = { ...defaults, ...(isObject(given) ? given : {}) };
        const own = partSettings(ns, values);
        for (const [key, from, path, name] of reads) {
            if (own[key] !== undefined) continue;
            let value = partSettings(from, values);
            for (const step of path) value = isObject(value) ? value[step] : undefined;
            if (READ_AS_USED[name]) value = READ_AS_USED[name](value, query);
            if (value !== undefined) own[key] = value;
        }
        return own;
    };
}

// The handler ctx a part sees: the host's, with settings() reading the part's own, and `fights`
// (whether a module runs fights, see fightRunner).
function partCtx(ns, ctx, shared) {
    const own = shared(ns);
    return Object.freeze({ ...ctx, fights: own.env.fights, settings: settingsFor(ns, id => ctx.settings(id), { ...own, query: ctx.query }) });
}

// The view a part's tail, tab or hook sees: the host's, with settings() reading the part's own.
function partView(ns, view, shared) {
    if (!isObject(view)) return view;
    const base = typeof view.settings === 'function'
        ? id => view.settings(id)
        : id => (id === undefined || id === null || id === MODULE_ID ? view.settings : {});
    const own = shared(ns);
    return Object.freeze({ ...view, fights: own.env.fights, settings: settingsFor(ns, base, { ...own, query: view.query }) });
}

// ---- stand-alone (WAVE rule 11) ----------------------------------------------------------------

// Queries only a fight runner answers (RPG Battle's combat part, MODULES §B3).
const FIGHT_QUERIES = ['combat.foesBeaten', 'combat.session', 'combat.offers'];
const UNANSWERED = /no module answers|no query called|there is no query/i;

/**
 * Whether another module runs fights: one registers a `combat.*` command (Story Block's live
 * `sdk.modules()`), else answers a `combat.*` query through the view (`view.query`). Null when
 * neither can be asked. Story Director stands alone (WAVE rule 11): without a fight runner its prompt
 * asks for no encounters and tells no beat as a fight.
 *
 * On a host with a module lifecycle (its `sdk.modules()` entries carry `status`) the module must be
 * `ready`: a dormant one (its peer is missing or off), or any module while a restore is pending, is
 * not a fight runner, and nothing falls back to asking a query then. Older hosts have no status; the
 * command probe is kept as it was.
 */
export function fightRunner(view = null) {
    const modules = tryLive(() => liveSdk()?.modules?.(), null);
    if (Array.isArray(modules)) return fightsAmong(modules, MODULE_ID);
    if (typeof view?.query !== 'function') return null;
    return FIGHT_QUERIES.some(name => {
        try {
            view.query(name, {});
            return true;
        } catch (error) {
            return !UNANSWERED.test(String(error?.message ?? error));
        }
    });
}

// The tools a part's query sees: the host's (`query`, `receipts`, …) plus settings() and substitute().
function partTools(ns, tools, shared, host) {
    const base = typeof tools === 'function' ? { query: tools } : isObject(tools) ? tools : {};
    const settings = typeof base.settings === 'function' ? id => base.settings(id) : id => host.settings(id);
    const substitute = typeof base.substitute === 'function' ? base.substitute : host.substitute;
    return Object.freeze({
        ...base,
        settings: settingsFor(ns, settings, { ...shared(ns), query: base.query ?? null }),
        substitute: text => {
            let out;
            try { out = substitute?.(text); } catch { out = undefined; }
            return typeof out === 'string' ? out : String(text ?? '');
        },
    });
}

// Queries whose args take a part setting when the caller leaves it out: { query: { arg: setting } }.
const SETTING_ARGS = {
    'atlas.routes': { map: 'map' },
    'atlas.travel': { map: 'map' },
};

function withSettingArgs(name, args, tools) {
    const fill = SETTING_ARGS[name];
    if (!fill) return args;
    const out = isObject(args) ? { ...args } : {};
    let settings = null;
    for (const [arg, key] of Object.entries(fill)) {
        if (out[arg] !== undefined && out[arg] !== null) continue;
        settings ??= tools.settings();
        if (settings[key] !== undefined) out[arg] = settings[key];
    }
    return out;
}

// ---- merging ---------------------------------------------------------------------------------

function own(table, name, ns, what) {
    if (Object.hasOwn(table, name)) throw new Error(`Story Director: ${what} "${name}" is in two parts (${table[name]} and ${ns}).`);
    table[name] = ns;
}

const linesOf = value => (Array.isArray(value) ? value.filter(line => typeof line === 'string') : []);

// A wrapped handler or query keeps the part's `feature` tag (MODULES §F100: a function with a `feature`
// property), so Story Block can leave it out while the reader has that feature off.
const withFeature = (fn, from) => (typeof from?.feature === 'string' ? Object.assign(fn, { feature: from.feature }) : fn);

// Several parts' functions under one hook name, called in part order. beforeGenerate and afterCapture
// answers (string[] | { lines, commands }) are joined; canGenerate gives the first refusal; any other
// hook gives the last answer that is not undefined.
function mergeHook(name, entries, shared) {
    const partView_ = (ns, view) => partView(ns, view, shared);
    if (entries.length === 1) {
        const [[ns, fn]] = entries;
        return (view, ...rest) => fn(partView_(ns, view), ...rest);
    }
    return async (view, ...rest) => {
        if (name === 'beforeGenerate' || name === 'afterCapture') {
            const lines = [];
            const commands = [];
            for (const [ns, fn] of entries) {
                const out = await fn(partView_(ns, view), ...rest);
                lines.push(...linesOf(Array.isArray(out) ? out : out?.lines));
                if (Array.isArray(out?.commands)) commands.push(...out.commands);
            }
            return { lines, commands };
        }
        let answer;
        for (const [ns, fn] of entries) {
            const out = await fn(partView_(ns, view), ...rest);
            if (name === 'canGenerate' && (out === false || (isObject(out) && out.ok === false))) return out;
            if (out !== undefined) answer = out;
        }
        return answer;
    };
}

// The settings panel's own part (`settings.section(el, api)`): a part's function, keeping its `feature`
// tag (one part has one now); several are drawn one after another, untagged.
function sectionOf(list) {
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    return (el, api) => { for (const fn of list) fn(el, api); };
}

/**
 * The module definition for `sdk.registerModule` (SPEC §6) from `parts` ([id, part], in order;
 * default: tracker, quests, time, atlas, chronicle, screens). `host` (tests): `{ settings(id), substitute(text) }`
 * for queries whose host tools lack them; by default Story Block's live sdk.
 */
export function createModule({ parts = PARTS, host = LIVE_HOST } = {}) {
    const owners = { domain: {}, command: {}, query: {}, kind: {}, tab: {}, screen: {}, widget: {}, feature: {} };
    const features = [];
    const screenList = [];
    const widgets = {};
    const readsByPart = {};
    // What the parts are told of the module set: `fights`, whether a fight runner is there (true until
    // it is known; worked out before each reply's prompt, so the static part is the same bytes for
    // one set of modules).
    // It starts from what fightRunner says now (a dormant fight runner is none), true where that cannot be known.
    const env = { fights: fightRunner() ?? true };
    const learn = view => {
        const found = fightRunner(view);
        if (typeof found === 'boolean') env.fights = found;
    };
    const shared = ns => ({ defaults, reads: readsByPart[ns] ?? [], env });
    const domains = {};
    const commands = {};
    const queries = {};
    const kinds = {};
    const appliers = {};
    const hooks = {};
    const tabs = [];
    const defaults = {};
    const schema = {};
    const statics = [];
    const tails = [];
    // Context parts under a feature (`context.parts: [{ feature, static?, tail? }]`, MODULES §F100): Story
    // Block adds their static and tail only while the feature is on.
    const contextParts = [];
    const sections = [];
    let budget = 0;

    for (const [ns, part] of parts) {
        for (const [name, domain] of Object.entries(part.domains ?? {})) {
            own(owners.domain, name, ns, 'the domain');
            domains[name] = domain;
        }
        for (const [type, handler] of Object.entries(part.commands ?? {})) {
            own(owners.command, type, ns, 'the command');
            commands[type] = withFeature((ctx, payload) => handler(partCtx(ns, ctx, shared), payload), handler);
        }
        for (const [name, query] of Object.entries(part.queries ?? {})) {
            own(owners.query, name, ns, 'the query');
            queries[name] = withFeature((state, args, tools) => {
                const own = partTools(ns, tools, shared, host);
                return query(state, withSettingArgs(name, args, own), own);
            }, query);
        }
        for (const feature of part.features ?? []) {
            own(owners.feature, feature?.id, ns, 'the feature');
            features.push({ ...feature });
        }
        for (const [kind, spec] of Object.entries(part.kinds ?? {})) {
            own(owners.kind, kind, ns, 'the change-line kind');
            // A part's grammar may depend on the module set (`spec.grammar(env)`): read when the prompt is built.
            const grammar = spec.grammar;
            kinds[kind] = {
                get grammar() { return typeof grammar === 'function' ? grammar({ fights: env.fights }) : grammar; },
                ...(spec.aliases ? { aliases: spec.aliases } : {}),
            };
            appliers[kind] = (ctx, line) => spec.apply(partCtx(ns, ctx, shared), line);
            for (const alias of spec.aliases ?? []) appliers[alias] = appliers[kind];
        }
        if (typeof part.context?.static === 'function') statics.push(part.context.static);
        if (typeof part.context?.tail === 'function') tails.push([ns, part.context.tail]);
        for (const extra of Array.isArray(part.context?.parts) ? part.context.parts : []) contextParts.push({ ...extra });
        if (Number.isInteger(part.context?.budget) && part.context.budget > 0) budget += part.context.budget;
        for (const [name, fn] of Object.entries(part.hooks ?? {})) {
            if (typeof fn !== 'function') continue;
            (hooks[name] ??= []).push([ns, fn]);
        }
        if (part.settings) {
            const named = namespaced(ns, part.settings);
            Object.assign(defaults, named.defaults);
            Object.assign(schema, named.schema);
            readsByPart[ns] = readsOf(part.settings);
            if (typeof part.settings.section === 'function') sections.push(part.settings.section);
        }
        for (const tab of part.tabs ?? []) {
            own(owners.tab, tab.id, ns, 'the tab');
            tabs.push({ ...tab, render: (el, view, api) => tab.render(el, partView(ns, view, shared), api) });
        }
        for (const screen of part.screens ?? []) {
            own(owners.screen, screen?.id, ns, 'the screen');
            screenList.push(screen);
        }
        for (const [name, widget] of Object.entries(part.widgets ?? {})) {
            own(owners.widget, name, ns, 'the widget');
            widgets[name] = widget;
        }
    }

    // The Calendar settings show the calendar in use (tracker/calendar-settings.js): with `pack`, the
    // pack's, and Custom starts from it. Read from Story Block's live queries when the settings are drawn.
    const askLive = name => tryLive(() => (typeof host.query === 'function' ? host.query(name, {}) : liveSdk()?.query?.(name, {})), null);
    const liveView = () => {
        const stored = tryLive(() => host.settings(MODULE_ID), null);
        return { calendar: packCalendarOf(name => askLive(name)), list: askLive('packs.list'), preset: stored?.[CALENDAR_KEYS.preset] };
    };
    liveView.calendar = () => packCalendarOf(name => askLive(name));
    liveCalendarSettings(defaults, schema, liveView);
    const def = {
        id: MODULE_ID,
        name: MODULE_NAME,
        version: VERSION,
        // The Story Block this needs (B-b7r2-1): the beta asks for the beta host it was built and tested
        // with (arc planning's sdk.callModel among it, arc/controller.js ARC_NEEDS_STORY_BLOCK). Story Block
        // before 2.0.0-alpha.2 compares without the pre-release tag, so it reads this as ">=2.0.0" and
        // still loads the module.
        requires: { storyBlock: STORY_BLOCK_RANGE },
        domains,
        commands,
        queries,
        replayQueries: ['director.thread'].filter(name => Object.hasOwn(queries, name)),
        context: {
            // The same bytes every reply: each part's static is fixed text.
            static: () => statics.map(fn => String(fn({ fights: env.fights }) ?? '').trim()).filter(Boolean).join('\n'),
            tail(view) {
                learn(view);
                const lines = [];
                const optional = [];
                for (const [ns, tail] of tails) {
                    const out = tail(partView(ns, view, shared)) ?? {};
                    lines.push(...linesOf(out.lines));
                    optional.push(...linesOf(out.optional));
                }
                return { lines, optional };
            },
            budget: budget || 1,
            ...(contextParts.length ? { parts: contextParts } : {}),
        },
        hooks: Object.fromEntries(Object.entries(hooks).map(([name, entries]) => {
            const merged = mergeHook(name, entries, shared);
            // Before each reply: what the module set is, before the prompt is assembled.
            return [name, name === 'beforeGenerate' ? (view, ...rest) => { learn(view); return merged(view, ...rest); } : merged];
        })),
        settings: { defaults, schema, ...(sectionOf(sections) ? { section: sectionOf(sections) } : {}) },
        tabs,
        screens: screenList,
    };
    if (Object.keys(widgets).length) def.widgets = widgets;
    if (features.length) def.features = features;
    if (Object.keys(kinds).length) {
        def.capture = {
            kinds,
            apply(ctx, line) {
                const apply = appliers[line?.kind] ?? appliers[String(line?.word ?? '').toLowerCase()];
                if (!apply) return ctx.fail('INVALID', `Story Director does not keep "${line?.kind}" lines.`);
                return apply(ctx, line);
            },
        };
    }
    return def;
}

/** The module, built once. */
export const storyDirectorModule = createModule();
