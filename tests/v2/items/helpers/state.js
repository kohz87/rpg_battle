// A small head state for the items part's tests: Ren (the main character), Lyra (a companion)
// and the party's things, with defs made the way the item.define hook makes them.

import { defineItem } from '../../../../src/v2/items/define.js';

const def = (slug, name, note) => defineItem({ id: `story/${slug}`, name, kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '' }, { note, settings: {} });

const DEFS = [
    def('minor-healing-draught', 'Minor Healing Draught', ''),
    def('mana-tonic', 'Mana Tonic', 'mp 20'),
    def('antidote', 'Antidote', 'cure poison'),
    def('ember-flask', 'Ember Flask', 'fire 25, all enemies'),
    def('rope', 'Rope', 'coiled'),
    def('iron-dagger', 'Iron Dagger', 'common · ATK +3'),
    def('steel-blade', 'Steel Blade', 'uncommon · ATK +6, DEX +1'),
    def('starsteel-sword', 'Starsteel Sword', 'epic · ATK +20, crit +4%'),
    def('greatsword', 'Greatsword', 'rare · ATK +9, two-handed'),
    def('oak-buckler', 'Oak Buckler', 'common · DEF +2'),
    def('silver-ring', 'Silver Ring', 'uncommon · LUK +2'),
    def('jade-ring', 'Jade Ring', 'uncommon · LUK +2'),
    def('bone-charm', 'Bone Charm', 'uncommon · MDEF +2, slot: accessory'),
    def('leather-boots', 'Leather Boots', 'common · DEF +1'),
    def('iron-helm', 'Iron Helm', 'common · DEF +2'),
];

const stack = (id, defId, qty, owner = 'party', equipped = null) => ({ id, def: `story/${defId}`, qty, owner, equipped, note: '', from: 'rc_seed0001' });

export const PC = 'ac_ren00001';
export const LYRA = 'ac_lyra0001';

export function makeState() {
    return {
        v: 2,
        meta: { rev: 7, claims: {} },
        domains: {
            inventory: {
                defs: Object.fromEntries(DEFS.map(entry => [entry.id, entry])),
                stacks: Object.fromEntries([
                    stack('it_draught1', 'minor-healing-draught', 2),
                    stack('it_tonic001', 'mana-tonic', 1),
                    stack('it_antidot1', 'antidote', 1),
                    stack('it_flask001', 'ember-flask', 1),
                    stack('it_rope0001', 'rope', 1),
                    stack('it_dagger01', 'iron-dagger', 1, 'party', 'weapon'),
                    stack('it_blade001', 'steel-blade', 1),
                    stack('it_stars001', 'starsteel-sword', 1),
                    stack('it_great001', 'greatsword', 1),
                    stack('it_buckle01', 'oak-buckler', 1, 'party', 'offhand'),
                    stack('it_ring0001', 'silver-ring', 1, 'party', 'accessory'),
                    stack('it_ring0002', 'jade-ring', 1, 'party', 'accessory'),
                    stack('it_charm001', 'bone-charm', 1),
                    stack('it_boots001', 'leather-boots', 1, 'party', 'worn'),
                    stack('it_helm0001', 'iron-helm', 1),
                    stack('it_lyradr01', 'minor-healing-draught', 1, LYRA),
                    stack('it_empty001', 'minor-healing-draught', 0),
                    stack('it_npc00001', 'minor-healing-draught', 1, 'ac_stranger'),
                ].map(entry => [entry.id, entry])),
                wallets: { party: { copper: 140 } },
                aliases: Object.fromEntries(DEFS.map(entry => [entry.name.toLowerCase(), entry.id])),
            },
            party: {
                pc: PC,
                order: [PC, LYRA],
                actors: {
                    [PC]: {
                        id: PC, name: 'Ren', kind: 'pc', control: 'player', role: '', level: 3, xp: 0, points: 0,
                        hp: { cur: 57, max: 82 }, mp: { cur: 30, max: 40 }, sp: { cur: 20, max: 20 },
                        stats: { STR: 7, VIT: 7, AGI: 6, DEX: 6, INT: 5, LUK: 5, CHA: 5 }, skills: [], conditions: [], npc: null,
                    },
                    [LYRA]: {
                        id: LYRA, name: 'Lyra', kind: 'companion', control: 'auto', role: 'ranger', level: 2, xp: 0, points: 0,
                        hp: { cur: 60, max: 60 }, mp: { cur: 25, max: 25 }, sp: { cur: 18, max: 18 },
                        stats: { STR: 5, VIT: 6, AGI: 8, DEX: 8, INT: 5, LUK: 5, CHA: 5 }, skills: [], conditions: [{ kind: 'poisoned', stacks: 1 }], npc: null,
                    },
                },
                custom: {},
            },
        },
    };
}
