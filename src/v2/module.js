// RPG Battle v2: the one module definition Story Block registers (SPEC §6), merged from its
// parts (MODULES §A): party, creation (making your character, §F12, §F14), checks (pending d20
// checks, §F16), items, combat, board (the battle screen), return (in time after death, §F17)
// trade, craft (crafting from the story, §F102) and screens (the default screens: party, trade,
// crafting, HUD, status card), in that order.
//
// - domains, commands and queries are put together as they are; a name two parts claim is a
//   mistake, refused here before Story Block ever sees it.
// - rules preflight: a host with deferred activation reserves rules, progress and training without initializing them.
//   Their APIs (and the items part's pinnedQueries) stay absent until the reader pins a pack in Setup. Older hosts retain
//   the checked activation/resume gate. An unpinned chat keeps Story Block's own storage (§9); rules.sheet is rules' alone.
// - capture: every part's kinds, each line handed to the part that owns its kind. One kind is
//   taken over on purpose: `check` is the checks part's (a pending check the reader rolls), not
//   the party part's. Story Director alone owns the check kind and dice.
// - context: the statics joined in part order (each is fixed text, so the whole is byte-identical
//   every reply), the tails concatenated in part order, the budgets summed.
// - hooks: every part's functions of a name, called in part order (canGenerate: any "no" blocks,
//   the first one is the answer: create your character first, you died; item.define: each one's fields laid over the def; beforeGenerate: the lines and
//   commands of all; afterCapture: the commands of all, in part order; replayGuard: dispatched by kind, the first part
//   that answers is the answer). Any other hook two parts define keeps the last answer that is not undefined.
// - settings: each part's keys under its part id (`combat.hitBase`), so two parts can never clash,
//   labelled with the part's section title; a part still reads its own keys bare
//   (`ctx.settings().hitBase`), with the module's un-namespaced keys (a rules file's `rules`,
//   `xpRate`, `terms`, `gear`) under them. A few keys are handed on to a part that needs another's
//   (SHARED_SETTINGS: creation reads the Character points budget as `party.startPoints`).
// - terms (MODULES §F25, §F105): what a pack suggests for the level and XP names and the tier titles
//   (Story Block's `packs.content({ kind: 'terms' })`) goes under the reader's own `terms`, field
//   by field, wherever a part reads its settings through a ctx, a view or a query's tools; the
//   reader's own words always win: the Character part's XP word and Level word (`party.xpName`,
//   `party.levelName`, group Terms) are folded into `terms` for every part, and Story Block's Rank
//   ladder (its `packs.content` ranks with `reader: true`) is `terms.ranks`. The static part reads the
//   same words (the module's settings and, through `query`, the packs), so it changes only with them.
// - screens (SPEC §13.1) and widgets (names `rpg-battle.<name>`, §F9): every part's put together, a
//   name two parts claim refused. tabs: every part's, in part order, except a hand-built tab a
//   screen now covers (a screen `rpg-battle/<tab id>` with a tab mount): the screen is that tab.
//
// What a handler gets is Story Block's ctx (SPEC §3.2) with two things made the part's own: its
// settings, as above, and `ctx.rev` (MODULES §F2) worked out from the state when the host does not
// give it yet. Queries get `(state, args, tools)` (MODULES §F3); when the host calls one without
// tools (a command's ctx.query) the tools reach this module's own queries.

import { part as party } from './party/index.js';
import { part as creation } from './creation/index.js';
import { rulesParts, modifierPart, initialRules, pinRules, registerPackDefs, noteRead } from './rules/index.js';
import { compatibleHost, selectionPart } from './rules/selection.js';
import { part as quests } from './quests/index.js';
import { part as items } from './items/index.js';
import { part as combat } from './combat/index.js';
import { part as board } from './board/index.js';
import { part as returnPart } from './return/index.js';
import { part as trade } from './trade/index.js';
import { part as craft } from './craft/index.js';
import { part as screens } from './screens/index.js';
import { foldReaderTerms, ladderPreview, mergeTerms, packTerms, readerLadderBands, termsOf, withTerms } from '../terms.js';
import { LEVELS_PER_RANK_HELP, rulesFrom } from './party/sheets.js';

export { TERM_FIELDS, foldReaderTerms, mergeTerms, packTerms, readerRanks, withTerms } from '../terms.js';

export const MODULE_ID = 'rpg-battle';
export const MODULE_NAME = 'RPG Battle';
export const VERSION = '2.3.0';

/** The parts in their order: [part id, part]. */
export const PARTS = Object.freeze([
    ...rulesParts, ['modifiers', modifierPart], ['party', party], ['creation', creation], ['quests', quests], ['items', items], ['combat', combat],
    ['board', board], ['return', returnPart], ['trade', trade], ['craft', craft], ['screens', screens],
]);

// Settings a part reads from another part: part → { other part: [keys] }, handed on with the
// other part's prefix (`party.startPoints`), so they never mix with the part's own bare keys.
export const SHARED_SETTINGS = Object.freeze({ creation: Object.freeze({ party: Object.freeze(['startPoints', 'statCap']) }) });

// Change-line kinds a later part takes over from an earlier one: kind → the part that keeps it.
// (None since the checks flip: Story Director keeps the `check` kind, contract P09.)
export const KIND_OVERRIDES = Object.freeze({});

// The query a ctx without `rev` reads meta.rev through (the receipt's rev is one more).
export const REV_QUERY = `${MODULE_ID}.rev`;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// A wrapped command or query keeps the feature its part marked it with (MODULES §F100: Story Block
// refuses it, or answers null, while the reader has that feature off).
const withFeature = (wrapper, original) => (typeof original?.feature === 'string' ? Object.assign(wrapper, { feature: original.feature }) : wrapper);

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
    for (const [other, keys] of Object.entries(SHARED_SETTINGS[partId] ?? {})) {
        for (const key of keys) {
            const long = settingKey(other, key);
            if (isObject(all) && Object.hasOwn(all, long)) out[long] = all[long];
        }
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
export function createModule({ settings = null, query = null, parts = [], rules = null, preflight = null, readPreflight = () => preflight } = {}) {
    // Older hosts activate only from checked frozen rules or a surviving pin. New hosts also offer a deferred selection.
    const compatible = compatibleHost(preflight);
    const resumed = compatible && preflight.classification === 'current' && preflight.rulesVersion === 2
        && /^[0-9a-f]{64}$/.test(preflight.rulesHash ?? '');
    let activation = null;
    if (rules !== null) {
        const slice = initialRules();
        const problem = pinRules(slice, rules);
        if (problem) throw new Error(problem);
        if (!compatible || !(preflight.classification === 'empty' || resumed && preflight.rulesHash === slice.rulesHash)) {
            throw new Error('Rules v2 activation requires a compatible preflight and Story Director.');
        }
        activation = slice;
    }
    const ruleIds = new Set(rulesParts.map(([id]) => id));
    // A deferred declaration reserves the rules APIs without adding slices or receipts to an unpinned chat.
    const selectable = preflight?.deferredDomains === true && preflight.hostApi === 2
        && ['empty', 'legacy', 'current'].includes(preflight.classification);
    const rulesAvailable = Boolean(activation || resumed || selectable);
    const registered = [...PARTS.filter(([id]) => rulesAvailable || !ruleIds.has(id)),
        ...(selectable ? [['rules-selection', selectionPart({ preflight: readPreflight })]] : []), ...parts];
    const defaults = {};
    const schema = {};
    for (const [id, part] of registered) {
        const own = part.settings;
        if (!own) continue;
        const title = typeof own.section === 'string' && own.section.trim() ? own.section.trim() : id;
        for (const [key, value] of Object.entries(own.defaults ?? {})) defaults[settingKey(id, key)] = structuredClone(value);
        for (const [key, field] of Object.entries(own.schema ?? {})) {
            const long = typeof field === 'string' ? { type: field } : Array.isArray(field) ? { type: 'choice', options: field } : field;
            // A field with a group of its own (Terms) is drawn in that group, without the part's title.
            const grouped = typeof long.group === 'string' && long.group.trim();
            schema[settingKey(id, key)] = { ...long, label: grouped ? long.label ?? key : `${title}: ${long.label ?? key}` };
        }
    }

    const moduleSettings = () => {
        let value = null;
        try {
            value = typeof settings === 'function' ? settings() : globalThis.StoryBlock?.sdk?.settings?.(MODULE_ID);
        } catch {
            value = null;
        }
        return foldReaderTerms({ ...defaults, ...(isObject(value) ? value : {}) });
    };
    // The packs' words for the static part (no view there): the host's query, when it is up.
    const staticQuery = (name, args) => {
        const ask = typeof query === 'function' ? query : globalThis.StoryBlock?.sdk?.query;
        if (typeof ask !== 'function') throw new Error('no query');
        return ask(name, args);
    };
    const pinnedNow = () => {
        // The older explicit activation/resume API also works without a host query callback.
        if (typeof query !== 'function' && typeof globalThis.StoryBlock?.sdk?.query !== 'function') return Boolean(activation || resumed);
        try { return Boolean(staticQuery('rules.identity', {})); } catch { return false; }
    };
    // `extra()`: a kind's own `when` (the `trainer` line exists only while the ruleset has a template), ANDed in on every host path.
    const whilePinned = (entry, extra = null) => Object.defineProperty(entry, 'enabled', { enumerable: true, get() {
        return pinnedNow() && (extra === null || extra());
    } });
    // A part's query for `when` and `grammarFor`: the host's when it is up, else this module's own for the explicit activation's rules.
    const askOwn = (name, args) => {
        const ask = typeof query === 'function' ? query : globalThis.StoryBlock?.sdk?.query;
        if (typeof ask === 'function') return ask(name, args);
        if (activation && typeof queries[name] === 'function') return queries[name]({ domains: { rules: activation } }, args);
        throw new Error('no query');
    };
    const whenOf = spec => () => {
        try { return Boolean(spec.when(askOwn)); } catch { return false; }
    };
    // A view (tails, tabs, view hooks) whose settings are the part's.
    const viewFor = (view, partId) => {
        const raw = () => {
            const source = view?.settings;
            if (typeof source === 'function') {
                try { return foldReaderTerms({ ...defaults, ...(source(MODULE_ID) ?? {}) }); } catch { return moduleSettings(); }
            }
            return isObject(source) ? foldReaderTerms({ ...defaults, ...source }) : moduleSettings();
        };
        const query = typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null;
        return Object.freeze({ ...(view ?? {}), settings: () => withTerms(partSettings(raw(), partId), query) });
    };
    // Story Block's ctx with the part's settings and ctx.rev.
    const ctxFor = (ctx, partId) => {
        const out = { ...ctx };
        const query = typeof ctx.query === 'function' ? (name, args) => ctx.query(name, args) : null;
        out.settings = id => (id === undefined || id === null || id === MODULE_ID
            ? withTerms(partSettings(foldReaderTerms({ ...defaults, ...(ctx.settings() ?? {}) }), partId), query)
            : ctx.settings(id));
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
    const replayQueries = new Set();
    const kinds = {};
    const owners = { domain: {}, command: {}, query: {}, kind: {}, tab: {}, widget: {}, screen: {}, feature: {} };
    const hooks = {};
    const tabs = [];
    const cards = {};
    const widgets = {};
    const screens = [];
    const features = [];
    const statics = [];
    const contextParts = [];
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

    for (const [id, part] of registered) {
        for (const name of part.replayQueries ?? []) replayQueries.add(name);
        for (const [name, domain] of Object.entries(part.domains ?? {})) {
            claim(owners.domain, name, id, 'domain');
            domains[name] = name === 'rules' && activation ? { ...domain, initial: () => structuredClone(activation) }
                : selectable && !activation && ruleIds.has(id) ? { ...domain, deferred: true } : domain;
        }
        for (const [type, handler] of Object.entries(part.commands ?? {})) {
            claim(owners.command, type, id, 'command');
            commands[type] = withFeature((ctx, payload) => {
                const own = ctxFor(ctx, id);
                if (selectable && ['party.create', 'creation.finish', 'creation.import', 'party.import'].includes(type)) {
                    if (own.query('rules.selection', {}).state === 'offered') own.fail('REFUSED', 'Choose a rules pack in Setup before creating your character.');
                }
                if (rulesAvailable && ['party.create', 'creation.finish'].includes(type)) registerPackDefs(own);
                return handler(own, payload);
            }, handler);
            if (selectable && ruleIds.has(id)) whilePinned(commands[type]);
        }
        for (const [name, fn] of Object.entries(part.queries ?? {})) {
            // A query that answers only where rules v2 does (the items part's `rules.equipPlan`) is left out of a chat that pins none.
            if (!rulesAvailable && part.pinnedQueries?.includes(name)) continue;
            claim(owners.query, name, id, 'query');
            // The settings (with the terms, which ask the packs) are worked out only when the query reads them.
            queries[name] = withFeature((state, args, tools) => fn(state, args, tools ? lazySettings(tools, () => withTerms(partSettings(moduleSettings(), id), typeof tools.query === 'function' ? tools.query : null)) : localTools(state, id)), fn);
            if (selectable && (ruleIds.has(id) && name !== 'rules.identity' || part.pinnedQueries?.includes(name))) whilePinned(queries[name]);
        }
        for (const [kind, spec] of Object.entries(part.kinds ?? {})) {
            if (KIND_OVERRIDES[kind] && Object.hasOwn(owners.kind, kind) && KIND_OVERRIDES[kind] === id) delete owners.kind[kind];
            if (KIND_OVERRIDES[kind] && Object.hasOwn(owners.kind, kind) && KIND_OVERRIDES[kind] !== id) continue;
            claim(owners.kind, kind, id, 'change-line kind');
            kinds[kind] = { part: id, grammar: spec.grammar, apply: spec.apply, ...(spec.feature ? { feature: spec.feature } : {}), ...(typeof spec.grammarFor === 'function' ? { grammarFor: spec.grammarFor } : {}), ...(typeof spec.when === 'function' ? { when: spec.when } : {}) };
        }
        for (const [name, fn] of Object.entries(part.hooks ?? {})) {
            if (typeof fn === 'function') (hooks[name] ??= []).push({ part: id, fn });
        }
        for (const tab of part.tabs ?? []) {
            claim(owners.tab, tab.id, id, 'tab');
            tabs.push({ ...tab, render: (el, view, api) => tab.render(el, viewFor(view, id), api) });
        }
        // Cards under replies (Story Block's `cards` socket): { <id>: { for(state, message, ctx) } }, one id one part.
        for (const [name, card] of Object.entries(part.cards ?? {})) {
            claim(owners.card ??= {}, name, id, 'card');
            cards[name] = selectable && id === 'creation' && name === 'start' ? { ...card, for(state, message, ctx) {
                const value = card.for(state, message, ctx);
                if (!value || queries['rules.selection'](state, {}, { query: staticQuery }).state !== 'offered') return value;
                return { ...value, actions: value.actions.map(action => action.id === 'create' ? { ...action, open: 'rpg-battle/setup' } : action) };
            } } : card;
        }
        for (const [name, widget] of Object.entries(part.widgets ?? {})) {
            claim(owners.widget, name, id, 'widget');
            widgets[name] = widget;
        }
        for (const screen of part.screens ?? []) {
            claim(owners.screen, screen?.id, id, 'screen');
            screens.push(screen);
        }
        // Optional mechanics (MODULES §F100): every part's, an id two parts declare refused.
        for (const feature of part.features ?? []) {
            claim(owners.feature ??= {}, feature?.id, id, 'feature');
            features.push({ ...feature });
        }
        if (typeof part.context?.static === 'function') statics.push({ part: id, fn: part.context.static });
        if (typeof part.context?.tail === 'function') tails.push({ part: id, tail: part.context.tail });
        // Context parts under a feature (MODULES §F100): Story Block leaves one out while its feature is off.
        for (const piece of Array.isArray(part.context?.parts) ? part.context.parts : []) contextParts.push({ part: id, piece });
        budget += Number.isInteger(part.context?.budget) && part.context.budget > 0 ? part.context.budget : 0;
    }
    claim(owners.query, REV_QUERY, 'module', 'query');

    // A hand-built tab a screen now covers gives way to it (the screen shows as that tab).
    const covered = new Set(screens.filter(screen => (screen.mounts ?? []).includes('tab')).map(screen => screen.id));
    // The items part's hand-built Items tab is retired: Story Block's Inventory is the one bag (§F99).
    const shownTabs = tabs.filter(tab => !covered.has(`${MODULE_ID}/${tab.id}`) && !RETIRED_TABS.has(tab.id));
    queries[REV_QUERY] = state => (Number.isInteger(state?.meta?.rev) ? state.meta.rev : 0);

    const mergedHooks = {};
    for (const [name, list] of Object.entries(hooks)) {
        mergedHooks[name] = mergeHook(name, list, { viewFor, settings: id => partSettings(moduleSettings(), id) });
        // A hook that only one part defines keeps the feature its part marked it with (MODULES §F100: Story Block leaves it out while that feature is off).
        const feature = list.length === 1 ? list[0].fn.feature : undefined;
        if (typeof feature === 'string') Object.assign(mergedHooks[name], { feature });
    }
    // terms2 (MODULES §F105): the reader's rank ladder lines for Story Block, which answers
    // packs.content's ranks with them, so every module bands ranks the same way. Each line carries the
    // first level RPG Battle bands it at (readerLadderBands, B-a2-8): its level cap and tiers (the
    // reader's terms over the pack's; the ladder itself is this answer, so it is not asked for here).
    mergedHooks['ranks.reader'] = () => {
        const all = moduleSettings();
        const own = partSettings(all, 'party');
        // The pack's terms (its tiers) are asked for only when a ladder with no levels is spread by them.
        const tierSize = () => {
            let pack = null;
            try { pack = packTerms(staticQuery); } catch { pack = null; }
            return termsOf(rulesFrom(pack ? { ...own, terms: mergeTerms(own.terms, pack) } : own)).tiers?.size ?? null;
        };
        return readerLadderBands(all, { cap: termsOf(rulesFrom(own)).cap, tierSize });
    };
    // The Levels per rank field's help ends with a read-only preview of the ladder in use (its levels),
    // worked out each time the settings are drawn: "Soul Class I: Lv 1–10 · II: 11–20 · …".
    const perRank = schema['party.levelsPerRank'];
    if (perRank) {
        Object.defineProperty(perRank, 'help', {
            enumerable: true,
            configurable: true,
            get() {
                let preview = '';
                try { preview = ladderPreview(staticQuery('party.ranks', {})); } catch { preview = ''; }
                return preview ? `${LEVELS_PER_RANK_HELP} Now: ${preview}` : LEVELS_PER_RANK_HELP;
            },
        });
    }

    return {
        id: MODULE_ID,
        name: MODULE_NAME,
        version: VERSION,
        description: 'Your character and companions, fights played in code, items with rules, trade and crafting.',
        // The Story Block this needs (R2-b7-combos-1): carrier sids (ctx.carrier.sid) for claims, dice
        // and keyed bookkeeping, the F80 dice path, and replay that passes over a gone key's remove and
        // replays list appends at the end (B-b1r2-13) came in Story Block 2.0.0-alpha.2; the beta asks for
        // the beta host it was built and tested with (the Features switches, F100, among them).
        requires: { storyBlock: '>=2.0.0-beta.2', peers: { 'story-director': '>=2.0.0-beta.2' } },
        // What a pack's requires.capabilities may name that this module provides: the rules pack kind. Declared always, also
        // while the module waits for Story Director: installing a pack into the library does not depend on peers.
        capabilities: ['rb-rules-v2'],
        domains,
        commands,
        queries,
        replayQueries: [...replayQueries],
        capture: {
            kinds: Object.fromEntries(Object.entries(kinds).map(([kind, spec]) => {
                const entry = grammarOf(spec, () => withTerms(partSettings(moduleSettings(), spec.part), staticQuery), askOwn);
                const when = typeof spec.when === 'function' ? whenOf(spec) : null;
                if (selectable && ruleIds.has(spec.part)) whilePinned(entry, when);
                else if (when) Object.defineProperty(entry, 'enabled', { enumerable: true, get: when });
                return [kind, entry];
            })),
            apply(ctx, line) {
                const entry = kinds[line?.kind];
                if (!entry) return ctx.fail('INVALID', `RPG Battle does not read "${line?.kind}" lines.`);
                noteRead(ctx);
                return entry.apply(ctxFor(ctx, entry.part), line);
            },
        },
        context: {
            // Fixed text from every part, joined in part order: byte-identical every reply. A part's static
            // gets `{ settings }` (its settings with the terms), so it can name the world's words (§F105):
            // it changes only when a setting or a pack's terms do.
            static: () => statics.map(({ part, fn }) => String(fn({ settings: withTerms(partSettings(moduleSettings(), part), staticQuery) }) ?? '').trim()).filter(Boolean).join('\n'),
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
            ...(contextParts.length ? {
                parts: contextParts.map(({ part, piece }) => ({
                    ...(piece.feature ? { feature: piece.feature } : {}),
                    // A piece's static gets the part's settings with the terms and the host's query (the rules block is made from the pin and the installed pack).
                    ...(typeof piece.static === 'function' ? { static: () => piece.static({ settings: withTerms(partSettings(moduleSettings(), part), staticQuery), query: staticQuery }) } : {}),
                    ...(typeof piece.tail === 'function' ? { tail: view => piece.tail(viewFor(view, part)) } : {}),
                })),
            } : {}),
        },
        hooks: mergedHooks,
        ...(features.length ? { features } : {}),
        settings: { defaults, schema },
        tabs: shownTabs,
        ...(Object.keys(cards).length ? { cards } : {}),
        widgets,
        screens,
    };
}

/**
 * A capture kind as Story Block reads it: { grammar, feature?, enabled? }. A kind with `grammarFor(settings, query)` (the
 * world's words, §F105; the pinned ruleset through `query`) has its grammar worked out each time the prompt is built, from the part's
 * settings with the terms, so it changes only when they do; a throw gives the fixed `grammar`. A kind with `when(query)` is enabled
 * only while that says yes (and, in the rules parts, while a ruleset is pinned): a disabled kind is not in the prompt.
 */
function grammarOf(spec, settings, query = null) {
    const out = spec.feature ? { feature: spec.feature } : {};
    if (typeof spec.grammarFor !== 'function') return { grammar: spec.grammar, ...out };
    Object.defineProperty(out, 'grammar', {
        enumerable: true,
        get() {
            try {
                const line = spec.grammarFor(settings(), query);
                return typeof line === 'string' && line.trim() ? line : spec.grammar;
            } catch {
                return spec.grammar;
            }
        },
    });
    return out;
}

/** `tools` with a `settings` worked out by `make()` the first time it is read (then kept), frozen. */
function lazySettings(tools, make) {
    const out = { ...tools };
    let value;
    let made = false;
    Object.defineProperty(out, 'settings', {
        enumerable: true,
        get() {
            if (!made) {
                value = make();
                made = true;
            }
            return value;
        },
    });
    return Object.freeze(out);
}

// Hand-built tabs no longer shown (MODULES §F99: Story Block's Inventory is the one bag).
const RETIRED_TABS = new Set(['items']);

// Hooks that are given the view (SPEC §6) get the part's view.
const VIEW_HOOKS = new Set(['canGenerate', 'beforeGenerate']);

/** One hook from every part's functions of `name`, called in part order. */
function mergeHook(name, list, { viewFor, settings }) {
    if (name === 'canGenerate') {
        // MODULES §F12: the first part that says no is the answer.
        return async (view, ...rest) => {
            for (const { part, fn } of list) {
                const answer = await fn(viewFor(view, part), ...rest);
                if (answer === false || (isObject(answer) && answer.ok === false)) return answer;
            }
            return { ok: true };
        };
    }
    if (name === 'beforeGenerate') {
        // The host's second argument ({ type }: normal, swipe, regenerate, continue) is handed on,
        // so a part can tell a Continue (keep this reply's dice) from a new reply.
        return async (view, ...rest) => {
            const lines = [];
            const commands = [];
            for (const { part, fn } of list) {
                const out = await fn(viewFor(view, part), ...rest);
                if (Array.isArray(out)) lines.push(...out);
                else if (isObject(out)) {
                    lines.push(...(Array.isArray(out.lines) ? out.lines : []));
                    commands.push(...(Array.isArray(out.commands) ? out.commands : []));
                }
            }
            return { lines, commands };
        };
    }
    if (name === 'afterCapture') {
        // The steps after a reply's lines: every part's, concatenated in part order, so a later part never drops an earlier one's.
        return async (...args) => {
            const commands = [];
            for (const { fn } of list) {
                const out = await fn(...args);
                if (isObject(out) && Array.isArray(out.commands)) commands.push(...out.commands);
            }
            return { commands };
        };
    }
    if (name === 'replayGuard') {
        // A part answers only the guard kinds it owns (undefined for the rest): the first answer is the answer.
        return (...args) => {
            for (const { fn } of list) {
                const out = fn(...args);
                if (out !== undefined) return out;
            }
            return undefined;
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
