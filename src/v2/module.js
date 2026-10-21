// RPG Battle v2: the one module definition Story Block registers (SPEC §6), merged from its
// parts (MODULES §A): party, items, combat, return (in time after death, §F17) and trade, in that
// order.
//
// - domains, commands and queries are put together as they are; a name two parts claim is a
//   mistake, refused here before Story Block ever sees it.
// - capture: every part's kinds, each line handed to the part that owns its kind.
// - context: the statics joined in part order (each is fixed text, so the whole is byte-identical
//   every reply), the tails concatenated in part order, the budgets summed.
// - hooks: every part's functions of a name, called in part order (canGenerate: any "no" blocks,
//   the first one is the answer: create your character first, you died; item.define: each one's fields laid over the def; beforeGenerate: the lines and
//   commands of all).
// - settings: each part's keys under its part id (`combat.hitBase`), so two parts can never clash,
//   labelled with the part's section title; a part still reads its own keys bare
//   (`ctx.settings().hitBase`), with the module's un-namespaced keys (a rules file's `rules`,
//   `xpRate`, `terms`, `gear`) under them.
// - tabs: every part's, in part order; widgets (names `rpg-battle.<name>`, §F9) put together.
//
// What a handler gets is Story Block's ctx (SPEC §3.2) with two things made the part's own: its
// settings, as above, and `ctx.rev` (MODULES §F2) worked out from the state when the host does not
// give it yet. Queries get `(state, args, tools)` (MODULES §F3); when the host calls one without
// tools (a command's ctx.query) the tools reach this module's own queries.

import { part as party } from './party/index.js';
import { part as items } from './items/index.js';
import { part as combat } from './combat/index.js';
import { part as returnPart } from './return/index.js';
import { part as trade } from './trade/index.js';

export const MODULE_ID = 'rpg-battle';
export const MODULE_NAME = 'RPG Battle';
export const VERSION = '2.0.0-alpha.1';

/** The parts in their order: [part id, part]. */
export const PARTS = Object.freeze([['party', party], ['items', items], ['combat', combat], ['return', returnPart], ['trade', trade]]);

// The query a ctx without `rev` reads meta.rev through (the receipt's rev is one more).
export const REV_QUERY = `${MODULE_ID}.rev`;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A namespaced settings key: `combat.hitBase`. */
export const settingKey = (partId, key) => `${partId}.${key}`;

/**
 * One part's settings from the module's (flat, namespaced) settings: the module's own keys that
 * belong to no part, then the part's keys with their prefix taken off.
 */
export function partSettings(all, partId) {
    const out = {};
    const prefix = `${partId}.`;
    const parts = PARTS.map(([id]) => `${id}.`);
    for (const [key, value] of Object.entries(isObject(all) ? all : {})) {
        if (!parts.some(start => key.startsWith(start))) out[key] = value;
    }
    for (const [key, value] of Object.entries(isObject(all) ? all : {})) {
        if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
    }
    return out;
}

function claim(table, name, partId, what) {
    if (Object.hasOwn(table, name)) throw new Error(`RPG Battle: the ${what} "${name}" is in two parts (${table[name]} and ${partId}).`);
    table[name] = partId;
}

/**
 * The module definition for `sdk.registerModule`. `settings()` → this module's settings as Story
 * Block keeps them (`sdk.settings('rpg-battle')`); without it, the host's when it is up, else the
 * defaults. Used where no ctx or view carries them (queries, the item.define hook).
 */
export function createModule({ settings = null } = {}) {
    const defaults = {};
    const schema = {};
    for (const [id, part] of PARTS) {
        const own = part.settings;
        if (!own) continue;
        const title = typeof own.section === 'string' && own.section.trim() ? own.section.trim() : id;
        for (const [key, value] of Object.entries(own.defaults ?? {})) defaults[settingKey(id, key)] = structuredClone(value);
        for (const [key, field] of Object.entries(own.schema ?? {})) {
            const long = typeof field === 'string' ? { type: field } : Array.isArray(field) ? { type: 'choice', options: field } : field;
            schema[settingKey(id, key)] = { ...long, label: `${title}: ${long.label ?? key}` };
        }
    }

    const moduleSettings = () => {
        let value = null;
        try {
            value = typeof settings === 'function' ? settings() : globalThis.StoryBlock?.sdk?.settings?.(MODULE_ID);
        } catch {
            value = null;
        }
        return { ...defaults, ...(isObject(value) ? value : {}) };
    };
    // A view (tails, tabs, view hooks) whose settings are the part's.
    const viewFor = (view, partId) => {
        const raw = () => {
            const source = view?.settings;
            if (typeof source === 'function') {
                try { return { ...defaults, ...(source(MODULE_ID) ?? {}) }; } catch { return moduleSettings(); }
            }
            return isObject(source) ? { ...defaults, ...source } : moduleSettings();
        };
        return Object.freeze({ ...(view ?? {}), settings: () => partSettings(raw(), partId) });
    };
    // Story Block's ctx with the part's settings and ctx.rev.
    const ctxFor = (ctx, partId) => {
        const out = { ...ctx };
        out.settings = id => (id === undefined || id === null || id === MODULE_ID ? partSettings({ ...defaults, ...(ctx.settings() ?? {}) }, partId) : ctx.settings(id));
        if (!Number.isInteger(ctx.rev)) {
            let rev;
            Object.defineProperty(out, 'rev', {
                enumerable: true,
                get() {
                    if (rev === undefined) {
                        const now = ctx.query(REV_QUERY);
                        rev = (Number.isInteger(now) ? now : 0) + 1;
                    }
                    return rev;
                },
            });
        }
        return Object.freeze(out);
    };

    const domains = {};
    const commands = {};
    const queries = {};
    const kinds = {};
    const owners = { domain: {}, command: {}, query: {}, kind: {}, tab: {}, widget: {} };
    const hooks = {};
    const tabs = [];
    const widgets = {};
    const statics = [];
    const tails = [];
    let budget = 0;

    // This module's queries for a state, as the tools a query gets when the host gives none.
    const localTools = (state, partId) => Object.freeze({
        query: (name, args) => {
            const fn = queries[name];
            if (!fn) throw new Error(`RPG Battle: no query called "${name}" here.`);
            return fn(state, args);
        },
        settings: partSettings(moduleSettings(), partId),
    });

    for (const [id, part] of PARTS) {
        for (const [name, domain] of Object.entries(part.domains ?? {})) {
            claim(owners.domain, name, id, 'domain');
            domains[name] = domain;
        }
        for (const [type, handler] of Object.entries(part.commands ?? {})) {
            claim(owners.command, type, id, 'command');
            commands[type] = (ctx, payload) => handler(ctxFor(ctx, id), payload);
        }
        for (const [name, fn] of Object.entries(part.queries ?? {})) {
            claim(owners.query, name, id, 'query');
            queries[name] = (state, args, tools) => fn(state, args, tools
                ? Object.freeze({ ...tools, settings: partSettings(moduleSettings(), id) })
                : localTools(state, id));
        }
        for (const [kind, spec] of Object.entries(part.kinds ?? {})) {
            claim(owners.kind, kind, id, 'change-line kind');
            kinds[kind] = { part: id, grammar: spec.grammar, apply: spec.apply };
        }
        for (const [name, fn] of Object.entries(part.hooks ?? {})) {
            if (typeof fn === 'function') (hooks[name] ??= []).push({ part: id, fn });
        }
        for (const tab of part.tabs ?? []) {
            claim(owners.tab, tab.id, id, 'tab');
            tabs.push({ ...tab, render: (el, view, api) => tab.render(el, viewFor(view, id), api) });
        }
        for (const [name, widget] of Object.entries(part.widgets ?? {})) {
            claim(owners.widget, name, id, 'widget');
            widgets[name] = widget;
        }
        if (typeof part.context?.static === 'function') statics.push(part.context.static);
        if (typeof part.context?.tail === 'function') tails.push({ part: id, tail: part.context.tail });
        budget += Number.isInteger(part.context?.budget) && part.context.budget > 0 ? part.context.budget : 0;
    }
    claim(owners.query, REV_QUERY, 'module', 'query');
    queries[REV_QUERY] = state => (Number.isInteger(state?.meta?.rev) ? state.meta.rev : 0);

    const mergedHooks = {};
    for (const [name, list] of Object.entries(hooks)) mergedHooks[name] = mergeHook(name, list, { viewFor, settings: id => partSettings(moduleSettings(), id) });

    return {
        id: MODULE_ID,
        name: MODULE_NAME,
        version: VERSION,
        description: 'Your character and companions, fights played in code, items with rules, trade and crafting.',
        domains,
        commands,
        queries,
        capture: {
            kinds: Object.fromEntries(Object.entries(kinds).map(([kind, spec]) => [kind, { grammar: spec.grammar }])),
            apply(ctx, line) {
                const entry = kinds[line?.kind];
                if (!entry) return ctx.fail('INVALID', `RPG Battle does not read "${line?.kind}" lines.`);
                return entry.apply(ctxFor(ctx, entry.part), line);
            },
        },
        context: {
            // Fixed text from every part, joined in part order: byte-identical every reply.
            static: () => statics.map(fn => String(fn() ?? '').trim()).filter(Boolean).join('\n'),
            tail(view) {
                const lines = [];
                const optional = [];
                for (const { part, tail } of tails) {
                    let out;
                    try {
                        out = tail(viewFor(view, part));
                    } catch (error) {
                        console.warn(`[RPG Battle] the ${part} notes could not be built`, error);
                        continue;
                    }
                    lines.push(...(Array.isArray(out?.lines) ? out.lines : []));
                    optional.push(...(Array.isArray(out?.optional) ? out.optional : []));
                }
                return { lines, optional };
            },
            budget: budget || 1,
        },
        hooks: mergedHooks,
        settings: { defaults, schema },
        tabs,
        widgets,
    };
}

// Hooks that are given the view (SPEC §6) get the part's view.
const VIEW_HOOKS = new Set(['canGenerate', 'beforeGenerate']);

/** One hook from every part's functions of `name`, called in part order. */
function mergeHook(name, list, { viewFor, settings }) {
    if (name === 'canGenerate') {
        // MODULES §F12: the first part that says no is the answer.
        return async view => {
            for (const { part, fn } of list) {
                const answer = await fn(viewFor(view, part));
                if (answer === false || (isObject(answer) && answer.ok === false)) return answer;
            }
            return { ok: true };
        };
    }
    if (name === 'beforeGenerate') {
        return async view => {
            const lines = [];
            const commands = [];
            for (const { part, fn } of list) {
                const out = await fn(viewFor(view, part));
                if (Array.isArray(out)) lines.push(...out);
                else if (isObject(out)) {
                    lines.push(...(Array.isArray(out.lines) ? out.lines : []));
                    commands.push(...(Array.isArray(out.commands) ? out.commands : []));
                }
            }
            return { lines, commands };
        };
    }
    if (name === 'item.define') {
        // Each part's fields laid over the def in turn (Story Block merges the result once more).
        return (def, info = {}) => {
            let current = def;
            for (const { part, fn } of list) {
                const out = fn(current, { ...(info ?? {}), settings: settings(part) });
                if (isObject(out)) current = { ...current, ...out };
            }
            return current;
        };
    }
    return (...args) => {
        let last;
        for (const { part, fn } of list) {
            const out = VIEW_HOOKS.has(name) ? fn(viewFor(args[0], part), ...args.slice(1)) : fn(...args);
            if (out !== undefined) last = out;
        }
        return last;
    };
}

/** The module with the host's settings read through `globalThis.StoryBlock.sdk` (tests, tools). */
export const rpgBattleModule = createModule();
