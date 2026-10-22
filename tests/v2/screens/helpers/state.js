// Fixture states for the screens tests, in the shapes the v2 parts keep (SPEC §7 inventory and scene,
// MODULES §B1 party, §B4 trade, §C1 director time, §F1 one currency, §F80 checks): Ren (your character, level 3,
// 3 points to spend, poisoned for 3 turns, five skills over two tiers and a story-taught one) and Lyra
// (a companion at full health), at a settlement market, with consumables, gear, materials and two
// orders. `query(state)` is the `tools.query` a query gets (MODULES §F3), over the real RPG Battle
// parts' queries and stand-ins for Story Block's inventory and scene queries.

import { defineItem } from '../../../../src/v2/items/define.js';
import { part as itemsPart } from '../../../../src/v2/items/index.js';
import { part as checksPart } from '../../../../src/v2/checks/index.js';
import { part as partyPart } from '../../../../src/v2/party/index.js';
import { part as tradePart } from '../../../../src/v2/trade/index.js';
import { part as screensPart } from '../../../../src/v2/screens/index.js';
import { part as returnPart } from '../../../../src/v2/return/index.js';

export const PC = 'ac_ren00001';
export const LYRA = 'ac_lyra0001';

const def = (slug, name, note, extra = {}) => ({
    ...defineItem({ id: `story/${slug}`, name, kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' }, { note, settings: {} }),
    ...extra,
});

const DEFS = [
    def('minor-healing-draught', 'Minor Healing Draught', ''),
    def('mana-tonic', 'Mana Tonic', 'mp 20'),
    def('antidote', 'Antidote', 'cure poison'),
    def('rope', 'Rope', 'coiled'),
    def('iron-dagger', 'Iron Dagger', 'common · ATK +3'),
    def('steel-blade', 'Steel Blade', 'uncommon · ATK +6, DEX +1'),
    def('wolf-pelt', 'Wolf Pelt', 'material'),
    def('<b>odd</b>', 'Odd <b>Name</b>', 'material'),
];

const stack = (id, defId, qty, owner = 'party', equipped = null) => ({ id, def: `story/${defId}`, qty, owner, equipped, note: '', from: 'rc_seed0001' });

const actor = (fields) => ({
    kind: 'companion', control: 'auto', role: '', level: 1, xp: 0, points: 0,
    hp: { cur: 50, max: 50 }, mp: { cur: 20, max: 20 }, sp: { cur: 15, max: 15 },
    stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [], conditions: [], npc: null,
    ...fields,
});

export function makeState() {
    return {
        v: 2,
        meta: { rev: 12, claims: {} },
        domains: {
            scene: { place: { name: 'Bluewatch Village', kind: 'village', region: 'Weirlands' }, present: ['Hesk'] },
            director: { time: { minutes: 3 * 1440 + 600 } },
            inventory: {
                defs: Object.fromEntries(DEFS.map(entry => [entry.id, entry])),
                stacks: Object.fromEntries([
                    stack('it_draught1', 'minor-healing-draught', 2),
                    stack('it_tonic001', 'mana-tonic', 1),
                    stack('it_antidot1', 'antidote', 1, LYRA),
                    stack('it_rope0001', 'rope', 1),
                    stack('it_dagger01', 'iron-dagger', 1, 'party', 'weapon'),
                    stack('it_blade001', 'steel-blade', 1),
                    stack('it_pelt0001', 'wolf-pelt', 3),
                    stack('it_odd00001', '<b>odd</b>', 1),
                    stack('it_empty001', 'minor-healing-draught', 0),
                ].map(entry => [entry.id, entry])),
                wallets: { party: { coin: 140 } },
                aliases: {},
            },
            party: {
                pc: PC,
                order: [PC, LYRA],
                actors: {
                    [PC]: actor({
                        id: PC, name: 'Ren', kind: 'pc', control: 'player', role: 'sellsword', level: 3, xp: 40, points: 3,
                        hp: { cur: 57, max: 82 }, mp: { cur: 30, max: 40 }, sp: { cur: 20, max: 24 },
                        stats: { STR: 9, VIT: 7, AGI: 6, DEX: 6, INT: 5, LUK: 5, CHA: 4 },
                        skills: [
                            { name: 'Power Strike', level: 2, uses: 3, active: true },
                            { name: 'Quick Stab', level: 1, uses: 0, active: true },
                            { name: 'Firebolt', level: 1, uses: 0, active: false },
                            { name: 'Rending Strike', level: 1, uses: 1, active: true },
                            { name: 'Shadow Cut', level: 1, uses: 0, active: true },
                        ],
                        conditions: [{ kind: 'poisoned', stacks: 3 }, { kind: 'bleeding', stacks: 1 }],
                        portrait: 'https://example.org/ren.png',
                    }),
                    [LYRA]: actor({ id: LYRA, name: 'Lyra', role: 'ranger', level: 2, hp: { cur: 60, max: 60 }, mp: { cur: 25, max: 25 } }),
                },
                custom: { 'Shadow Cut': { name: 'Shadow Cut', type: 'physical', stat: 'AGI', mp: 5 } },
                offers: {},
            },
            // Keyed by the reply and by check id (B-b1r2-13); the card shows the entries its reply added.
            checks: {
                prepared: { '11:0': { for: 12, rolls: [12, 5], rev: 11 } },
                log: {
                    ck_aaaaaaaa: {
                        id: 'ck_aaaaaaaa', actor: PC, name: 'Ren', skill: 'stealth', stat: 'DEX', dc: 20, word: 'hard', what: 'slipping past the guard', rev: 12,
                        carrier: '12:0', roll: 1, die: 12, modifiers: [{ source: 'stat', amount: 0, reason: 'DEX' }], mod: 0, total: 12,
                        outcome: 'fail', outcomeText: 'fail', said: 'success', mismatch: 'narrated as success, the dice say fail', note: '',
                        text: 'stealth (slipping past the guard): Roll 1 = 12 + 0 = 12 against 20 (hard)',
                    },
                },
            },
            trade: {
                orders: {
                    or_aaaaaaaa: { id: 'or_aaaaaaaa', piece: { id: 'craft/aaaaaaaa', name: 'Skull Ring' }, materials: [], fee: 12, ready: 3 * 1440, crafter: 'Hesk', place: 'Bluewatch Village' },
                    or_bbbbbbbb: { id: 'or_bbbbbbbb', piece: { id: 'craft/bbbbbbbb', name: 'Pelt Cloak' }, materials: [], fee: 30, ready: 9 * 1440, crafter: 'the smith', place: 'Bluewatch Village' },
                },
                shops: {},
            },
        },
    };
}

/** A state with nobody in the party yet (before character creation). */
export function emptyState() {
    const state = makeState();
    state.domains.party = { pc: null, order: [], actors: {}, custom: {}, offers: {} };
    state.domains.inventory.stacks = {};
    state.domains.checks = { prepared: {}, log: {} };
    return state;
}

// Stand-ins for Story Block's own queries (SPEC §7, MODULES §F1) over the given state.
const storyBlockQueries = {
    'inventory.currency': () => ({ name: 'gold', short: 'g' }),
    'inventory.wallet': (state, args = {}) => ({ ...(state?.domains?.inventory?.wallets?.[args?.owner ?? 'party'] ?? {}) }),
    'scene.place': state => ({ ...(state?.domains?.scene?.place ?? { name: '', kind: '' }) }),
    'scene.present': state => [...(state?.domains?.scene?.present ?? [])],
};

export const QUERIES = { ...storyBlockQueries, ...partyPart.queries, ...checksPart.queries, ...itemsPart.queries, ...tradePart.queries, ...screensPart.queries, ...returnPart.queries };

/**
 * `tools.query` over `state`: every query gets (state, args, tools), as the host calls them; `settings` are
 * the module's. `extra` ({ name: (args, tools) → value }) stands in for other parts' queries this build
 * may not have yet, laid over the real ones (and reached from inside them too).
 */
export function toolsFor(state, settings = undefined, extra = {}) {
    const tools = {
        ...(settings === undefined ? {} : { settings }),
        query(name, args = {}) {
            if (Object.hasOwn(extra, name)) return extra[name](args ?? {}, tools);
            const fn = QUERIES[name];
            if (typeof fn !== 'function') throw new Error(`No query called "${name}".`);
            return fn(state, args ?? {}, tools);
        },
    };
    return tools;
}

/** The host's `query(name, args, state)` as the mounts call it. */
export const runQuery = (name, args, state, settings) => toolsFor(state, settings).query(name, args);
