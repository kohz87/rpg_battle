// Seeded random command sequences for the QA fuzz tests: valid and invalid payloads for every
// RPG Battle command (and the story's change lines), run through the real bus. Each step
// returns what the invariant checks need: the type, the payload, the result, and the state
// before and after. Deterministic: the same seed gives the same sequence and the same states.

import { rng as makeRng } from '../vendor/src/v2/rng.js';
import { withHero } from './harness.js';
import { DIRECTOR_CLOCK } from '../../integration/helpers/peer.js';
import { lastOf, sessionOf } from '../../../../src/v2/combat/stored.js';

const STATS = ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA', 'XYZ'];
const ODD_NUMBERS = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2', 1e9, null, undefined, 2 ** 53];
const NAMES = ['Lyra', 'Kael', 'Mira', 'Ren', '', '  ', 'A'.repeat(90), 'Lyra the Bold'];
const ITEMS = ['Minor Healing Draught', 'Healing Draught', 'Antidote', 'Mana Tonic', 'Wolf Pelt', 'Cellar Rat Tail', 'Iron Sword', 'Silver Ring', 'Leather Boots', 'Greatsword', 'Wooden Shield', 'Rope', 'Gold Coins'];
const NOTES = { 'Iron Sword': 'ATK +2', 'Silver Ring': 'a ring of LUK +2', 'Leather Boots': 'AGI +1', Greatsword: 'ATK +5, two-handed', 'Wooden Shield': 'DEF +2' };
const FOES = ['Cellar Rat', '2 Cellar Rats', 'Bandit', 'Wolf', '3 Goblins', 'the Shadow', 'Skeleton'];
const TIERS = ['weak', 'weak', 'even', 'strong', 'deadly', 'bogus'];
const SKILLS = ['Power Strike', 'Sweep', 'Firebolt', 'Mend', 'Shadow Cut', 'Nonexistent Art'];
const PLACES = [{ name: 'Bluewatch Village', kind: 'settlement' }, { name: 'The Deep Wood', kind: 'wild' }, { name: 'Harrowgate', kind: 'settlement' }];

export function createPicker(seed) {
    const random = makeRng(seed >>> 0);
    const int = n => Math.floor(random() * n);
    const pick = list => list[int(list.length)];
    const chance = p => random() < p;
    return { random, int, pick, chance };
}

/** The ids a payload may name: real ones mostly, nonsense sometimes. */
function pools(h, p) {
    const state = h.state();
    const stacks = Object.keys(state.domains.inventory.stacks);
    const actors = state.domains.party.order;
    const offers = Object.values(state.domains.combat.offers).map(offer => offer.id);
    const orders = Object.keys(state.domains.trade.orders);
    const stack = () => (stacks.length && p.chance(0.85) ? p.pick(stacks) : p.pick(['it_zzzzzzzz', 42, null, '', 'party']));
    const actor = () => (actors.length && p.chance(0.85) ? p.pick(actors) : p.pick(['ac_zzzzzzzz', 'party', 7, null]));
    const qty = () => (p.chance(0.8) ? 1 + p.int(3) : p.pick(ODD_NUMBERS));
    return { stacks, actors, offers, orders, stack, actor, qty };
}

/** One random step: [type, payload] for a command, or ['capture', line]. */
export function nextStep(h, p) {
    const ids = pools(h, p);
    // A fight under way is mostly played on, and a finished one mostly settled, so that sequences
    // reach combat.end often; a hurt party drinks more often.
    const session = sessionOf(h.state().domains.combat);
    if (session?.status === 'active' && p.chance(0.6)) {
        const view = h.query('combat.session');
        const target = view?.actions?.targets?.enemies?.[0];
        const skill = view?.actions?.skills?.find(entry => entry && entry.usable !== false)?.name;
        if (target) {
            const action = p.chance(0.7) ? { type: 'attack', target }
                : skill && p.chance(0.6) ? { type: 'skill', skill, target }
                    : { type: 'item', item: 'Minor Healing Draught', target: ids.actor() };
            return ['combat.act', { action }];
        }
    }
    if (session && session.status !== 'active' && p.chance(0.5)) return ['combat.end', {}];
    // The last fight folded before a later reply (beforeGenerate's system step), sometimes by a click (refused) or a stale rev.
    const last = lastOf(h.state().domains.combat);
    if (!session && last && p.chance(0.1)) return ['combat.fold', { rev: p.chance(0.85) ? last.rev : -3 }, p.chance(0.85) ? 'system' : 'ui'];
    const hurt = Object.values(h.state().domains.party.actors).some(actor => actor.hp.cur < actor.hp.max || actor.mp.cur < actor.mp.max);
    if (hurt && p.chance(0.15)) {
        const inv = h.state().domains.inventory;
        const doses = Object.values(inv.stacks).filter(stack => inv.defs[stack.def]?.kind === 'consumable').map(stack => stack.id);
        if (doses.length && p.chance(0.7)) return ['item.use', { stack: p.pick(doses), ...(p.chance(0.5) ? { target: ids.actor() } : {}) }];
        return ['party.restore', { actor: ids.actor(), mp: 1 + p.int(10) }];
    }
    const roll = p.int(100);
    if (roll < 8) return ['item.use', { stack: ids.stack(), ...(p.chance(0.5) ? { target: ids.actor() } : {}) }];
    // targetSlot on about a third of the equips: a canonical slot, or a word that is no slot (old words are never accepted in a
    // command). Taken from the stack id, so the stream of random draws is the one it was before.
    if (roll < 14) {
        const stack = ids.stack();
        const code = typeof stack === 'string' ? stack.charCodeAt(stack.length - 1) : 0;
        const slots = ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2', 'worn', 'armour'];
        return ['item.equip', { stack, ...(code % 3 === 0 ? { targetSlot: slots[code % slots.length] } : {}) }];
    }
    if (roll < 17) return ['item.unequip', { stack: ids.stack() }];
    if (roll < 22) return ['item.give', { stack: ids.stack(), to: ids.actor(), ...(p.chance(0.6) ? { qty: ids.qty() } : {}) }];
    if (roll < 28) return ['trade.sell', { stack: ids.stack(), qty: ids.qty() }];
    if (roll < 34) {
        const stock = h.query('trade.stock', { kind: p.pick(['general', 'apothecary', 'smith', 'fence']) });
        const def = stock.items.length && p.chance(0.85) ? p.pick(stock.items).def.id : 'trade/nothing';
        return ['trade.buy', { shop: p.chance(0.9) ? stock.shop : 'elsewhere|general', def, qty: ids.qty() }];
    }
    if (roll < 37) return ['craft.commission', { piece: p.pick(['Pelt Cloak', 'Bone Charm', '']), materials: [{ stack: ids.stack(), qty: ids.qty() }], crafter: p.pick(['the tanner', 'smith', 'baker', '']) }];
    if (roll < 39) return ['craft.collect', { order: ids.orders.length && p.chance(0.8) ? p.pick(ids.orders) : 'or_zzzzzzzz' }];
    if (roll < 42) return ['party.rest', { kind: p.pick(['short', 'long', 'nap']) }];
    if (roll < 44) return ['party.spend', { points: { [p.pick(STATS)]: p.chance(0.7) ? 1 + p.int(3) : p.pick(ODD_NUMBERS) } }];
    if (roll < 46) return ['party.heal', { actor: ids.actor(), hp: p.chance(0.7) ? p.int(40) : p.pick(ODD_NUMBERS), cure: p.chance(0.3) ? ['poisoned'] : [] }];
    if (roll < 47) return ['party.restore', { actor: ids.actor(), mp: p.chance(0.7) ? p.int(20) : p.pick(ODD_NUMBERS) }];
    if (roll < 49) return ['party.grantXp', { ...(p.chance(0.5) ? { actor: ids.actor() } : {}), amount: p.chance(0.7) ? p.int(300) : p.pick(ODD_NUMBERS) }];
    if (roll < 51) return ['party.addCompanion', { name: p.pick(NAMES), role: p.pick(['archer', 'fighter', '']), ...(p.chance(0.5) ? { level: p.chance(0.7) ? 1 + p.int(5) : p.pick(ODD_NUMBERS) } : {}) }];
    if (roll < 52) return ['party.removeCompanion', { actor: ids.actor() }];
    if (roll < 53) return ['party.learnSkill', { name: p.pick(SKILLS), free: p.chance(0.3) }];
    if (roll < 55) return ['check.resolve', { skill: p.pick(['stealth', 'athletics', 'lore', '']), dc: p.pick(['easy', 'hard', 12, 0, 99, 'bogus']) }];
    if (roll < 58) return ['combat.start', { offer: ids.offers.length && p.chance(0.9) ? p.pick(ids.offers) : 'en_zzzzzzzz' }];
    if (roll < 68) {
        const view = h.query('combat.session');
        const target = view?.actions?.targets?.enemies?.[0];
        const action = p.chance(0.85) && target ? { type: 'attack', target } : p.pick([{ type: 'defend' }, { type: 'flee' }, { type: 'attack', target: 'fo_zzzzzzzz' }, { type: 'dance' }, null, { type: 'item', item: 'Minor Healing Draught', target: ids.actor() }]);
        return ['combat.act', { action }];
    }
    if (roll < 70) return ['combat.flee', {}];
    if (roll < 74) return ['combat.end', {}];
    if (roll < 75) return ['combat.dismiss', { offer: ids.offers.length ? p.pick(ids.offers) : 'en_zzzzzzzz' }];
    if (roll < 76) return ['wallet.pay', { owner: 'party', amount: ids.qty() * 3 }];
    if (roll < 77) return ['inventory.grant', { name: p.pick(ITEMS), qty: ids.qty(), owner: 'party' }];
    if (roll < 78) return ['scene.place', p.pick(PLACES)];
    // Open trainers (RPG Battle 2.2.0): a chat that pins no rules has no trainer kind, command or query, so both are refused and change nothing.
    if (roll < 79) {
        return p.chance(0.5)
            ? ['trainer.open', { name: p.pick(NAMES), template: p.pick(['drills', 'nothing', '']), ...(p.chance(0.3) ? { skills: [p.pick(['pack.fixture/s00', 'x'])] } : {}) }]
            : ['capture', { op: p.pick(['+', '+', '-']), kind: 'trainer', name: p.pick(NAMES), text: 'drills', labels: { like: p.pick(['drills', 'nothing']), ...(p.chance(0.3) ? { teaches: 's00' } : {}) } }];
    }
    // The story's change lines.
    const kind = p.pick(['item', 'item', 'item', 'coin', 'coin', 'encounter', 'encounter', 'wound', 'join', 'check', 'rest']);
    if (kind === 'item') {
        const name = p.pick(ITEMS);
        const op = p.pick(['+', '+', '-']);
        return ['capture', { op, kind, name, labels: { qty: String(p.chance(0.85) ? 1 + p.int(3) : p.pick(['0', '-2', 'many', '1.5'])), ...(op === '+' && NOTES[name] ? { note: NOTES[name] } : {}) } }];
    }
    if (kind === 'coin') return ['capture', { op: p.pick(['+', '+', '-']), kind, name: p.pick(['30', '5 silver', '1,200', 'lots', '0', '-4', '2.5']), labels: {} }];
    if (kind === 'encounter') return ['capture', { op: '!', kind, name: p.pick(FOES), text: 'out of the dark', labels: { tier: p.pick(TIERS), stakes: p.pick(['normal', 'normal', 'death']) } }];
    if (kind === 'wound') return ['capture', { op: '~', kind, name: p.pick(['Ren', 'Lyra', 'Nobody']), text: 'a blow', labels: p.chance(0.5) ? { harm: p.pick(['scratch', 'wound', 'grave', 'bogus']) } : { heal: p.pick(['scratch', 'wound']) } }];
    if (kind === 'join') return ['capture', { op: '+', kind, name: p.pick(NAMES), text: 'a wanderer', labels: { level: p.pick(['2', '0', 'x', '7']), role: 'ranger' } }];
    if (kind === 'check') return ['capture', { op: '?', kind, name: p.pick(['stealth', 'lore']), text: 'trying', labels: { dc: p.pick(['easy', 'hard', '45']) } }];
    return ['capture', { op: '!', kind: 'rest', name: p.pick(['short', 'long', 'nap']), text: 'at the inn', labels: {} }];
}

/**
 * Runs one sequence: a hero in a market village with some things and coins, then `steps` random
 * steps. `onStep({ type, payload, result, before, after, h })` checks each one.
 */
export function runSequence(seed, steps, onStep, options = {}) {
    const { h } = withHero({ seed: seed + 1, modules: [DIRECTOR_CLOCK], ...options });
    const setup = [
        ['capture', { op: '+', kind: 'item', name: 'Minor Healing Draught', labels: { qty: '2' } }],
        ['capture', { op: '+', kind: 'item', name: 'Wolf Pelt', labels: { qty: '4' } }],
        ['capture', { op: '+', kind: 'item', name: 'Iron Sword', labels: { qty: '1', note: 'ATK +2' } }],
        ['capture', { op: '+', kind: 'coin', name: '200', labels: {} }],
    ];
    const p = createPicker(seed * 7919 + 13);
    const run = ([type, payload, cause]) => (type === 'capture' ? h.capture(payload) : h.command(type, payload, cause ? { cause } : undefined));
    for (const step of setup) run(step);
    for (let n = 0; n < steps; n++) {
        const [type, payload, cause] = nextStep(h, p);
        const before = h.state();
        const result = run([type, payload, cause]);
        onStep({ type: type === 'capture' ? `capture.${payload.kind}` : type, payload, result, before, after: h.state(), h, n });
    }
    return h;
}
