// Story Block's core module (§6, §7): the `scene` and `inventory` domains as one plain module
// definition for `sdk.registerModule`. Pure: no SillyTavern, no DOM outside the tab renderers.
//
// The handler ctx (§3.2) has no hooks accessor, so the `item.define` hooks (rules for items the
// story introduces) come in through the factory, and so do this module's settings for the places
// that have no ctx (queries, the tail, the tabs; handlers use ctx.settings()):
//   registry.register(createCoreModule({ hooks: name => registry.hooks(name), settings: () => sdk.settings('story-block') }))
// createCorePart gives the same thing as a MODULES.md part, for a host that merges parts.

import { createInventoryCommands, createInventoryQueries, captureCoin, captureItem, initialInventory, inventoryTail, validateInventory } from './inventory.js';
import { capturePlace, capturePresent, initialScene, sceneCommands, sceneQueries, sceneTail, validateScene } from './scene.js';
import { DEFAULT_CURRENCY, currencyOf } from './money.js';
import { renderInventoryTab } from '../ui/inventory-tab.js';
import { renderSceneTab } from '../ui/scene-tab.js';

export const CORE_MODULE_ID = 'story-block';
export const CORE_BUDGET = 400;

// One line for the static prompt part: no names, counts or coins, so it is byte-identical every reply.
export const CORE_STATIC = 'Code keeps the inventory, the wallet, the place and who is present: use or pay only what the '
    + 'lists below hold, and write a change line for every item or coin gained, used or lost and every arrival, departure or move.';

export const CORE_KINDS = Object.freeze({
    item: Object.freeze({ grammar: '+ item Name | qty: 1 | note: short detail (- item Name | qty: 1 when used up or lost; ~ item Name | note: … when it changes)' }),
    coin: Object.freeze({ grammar: '+ coin 30 | from: who (- coin 5 | to: who when paid; one number, in the wallet\'s currency)' }),
    place: Object.freeze({ grammar: '~ place Name | kind: settlement|wild|dungeon|… | region: wider area' }),
    present: Object.freeze({ grammar: '+ present Name when someone arrives, - present Name when they leave' }),
});

// The chat's one currency (MODULES.md F1): its name, renamable by the reader, never a second one.
export const CORE_SETTINGS = Object.freeze({
    section: 'Story Block',
    defaults: Object.freeze({ currency: DEFAULT_CURRENCY.name, currencyShort: '' }),
    schema: Object.freeze({
        currency: Object.freeze({ type: 'text', label: 'Currency', max: 24 }),
        currencyShort: Object.freeze({ type: 'text', label: 'Currency, short form (blank: its first letter)', max: 6 }),
    }),
});

/**
 * The core part in MODULES.md A's shape ({ domains, commands, queries, kinds, context, settings,
 * tabs }), for a host that merges parts. `hooks(name) → fn[]` in module-id order (the registry's
 * `hooks`); `settings()` → this module's settings. Without them no hooks run and the currency is gold.
 */
export function createCorePart({ hooks = () => [], settings = () => ({}) } = {}) {
    const hookList = name => {
        const fns = hooks(name);
        return Array.isArray(fns) ? fns.filter(fn => typeof fn === 'function') : [];
    };
    const env = { hooks: hookList, settings: () => settings() ?? {} };
    const currency = () => currencyOf(env.settings());
    const kind = (grammar, apply) => ({ grammar, apply });
    return {
        domains: {
            scene: { initial: initialScene, validate: slice => validateScene(slice) },
            inventory: { initial: initialInventory, validate: slice => validateInventory(slice) },
        },
        commands: { ...createInventoryCommands(env), ...sceneCommands },
        queries: { ...createInventoryQueries(env), ...sceneQueries },
        kinds: {
            item: kind(CORE_KINDS.item.grammar, (ctx, line) => captureItem(ctx, line, env)),
            coin: kind(CORE_KINDS.coin.grammar, (ctx, line) => captureCoin(ctx, line, env)),
            place: kind(CORE_KINDS.place.grammar, (ctx, line) => capturePlace(ctx, line)),
            present: kind(CORE_KINDS.present.grammar, (ctx, line) => capturePresent(ctx, line)),
        },
        context: {
            static: () => CORE_STATIC,
            // Half the budget for the lines that always go, half for the optional overflow.
            tail(view) {
                const chars = CORE_BUDGET * 4;
                const scene = sceneTail(view?.state);
                const used = scene.reduce((sum, line) => sum + line.length + 1, 0);
                const inventory = inventoryTail(view?.state, { currency: currency(), chars: chars / 2 - used, optionalChars: chars / 2 });
                return { lines: [...scene, ...inventory.lines], optional: inventory.optional };
            },
            budget: CORE_BUDGET,
        },
        settings: CORE_SETTINGS,
        tabs: [
            { id: 'inventory', title: 'Inventory', icon: 'fa-box-open', render: (el, view, api) => renderInventoryTab(el, view, api, { currency: currency() }) },
            { id: 'scene', title: 'Scene', icon: 'fa-map-location-dot', render: (el, view, api) => renderSceneTab(el, view, api) },
        ],
    };
}

/** The core module definition for `sdk.registerModule` (§6), built from the core part. */
export function createCoreModule({ hooks = () => [], settings = () => ({}), version = '2.0.0-alpha.1' } = {}) {
    const part = createCorePart({ hooks, settings });
    return {
        id: CORE_MODULE_ID,
        name: 'Story Block',
        version,
        domains: part.domains,
        commands: part.commands,
        queries: part.queries,
        capture: {
            kinds: CORE_KINDS,
            apply(ctx, line) {
                const kind = part.kinds[line?.kind];
                if (!kind) return ctx.fail('INVALID', `Story Block does not handle "${line?.kind}" lines.`);
                return kind.apply(ctx, line);
            },
        },
        context: part.context,
        settings: { defaults: CORE_SETTINGS.defaults, schema: CORE_SETTINGS.schema },
        tabs: part.tabs,
    };
}
