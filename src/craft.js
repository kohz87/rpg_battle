// RPG Battle: crafting, gear made from the Inventory's materials (pure).
//
// (0.5.34) A material says what it would give: its rarity and an affinity, a stat by what part
// of a creature it is (a fang ATK, a pelt DEF, a skull MDEF) and an element by what it is made of
// (venom poison, ember fire), written in its note at the drop: `uncommon material · MDEF, poison`.
// The story crafts when the reader has someone make something; the reply says what was made from
// what, `<Crafted>Skull Charm from Brood-Mother Skull, 2 Fang</Crafted>`, and the numbers are the
// code's: the rarity is the best material's (one step up for enough of them), the stats come
// from the affinities, sized to that rarity and the crafter's level, and an element carries over.
// (0.5.36) An order (`| ready: Goldwane 14`) takes the materials now and waits under [On Order]
// with its numbers already set, so a skull handed over is still what the ring is made of; the
// line naming the piece alone (`<Crafted>Skull Charm</Crafted>`) collects it.

import { DEFAULT_RULES, RARITIES, rarityBudget } from './rules.js';
import { ELEMENTS, describeRow, itemSlot, mainStat, nameKey, parseInventory, slotFromWord } from './items.js';

// What part of a creature a material is, by a word in its name, and the stat it lends.
const PART_STATS = [
    [['fang', 'fangs', 'tooth', 'teeth', 'claw', 'claws', 'talon', 'talons', 'tusk', 'tusks', 'horn', 'horns', 'spike', 'spikes', 'stinger', 'barb', 'mandible'], 'ATK'],
    [['pelt', 'hide', 'skin', 'leather', 'scale', 'scales', 'shell', 'carapace', 'plate', 'chitin', 'fur', 'wool'], 'DEF'],
    [['skull', 'bone', 'bones', 'fetish', 'candle', 'antler', 'antlers', 'signet'], 'MDEF'],
    [['essence', 'ectoplasm', 'crystal', 'shard', 'dust', 'ichor', 'ash', 'star', 'godsblood', 'core', 'cores'], 'MATK'],
    [['feather', 'feathers', 'wing', 'wings', 'sinew', 'tendon', 'silk', 'tail', 'tails'], 'AGI'],
    [['eye', 'eyes', 'lens', 'lockpick'], 'DEX'],
    [['heart', 'blood', 'liver', 'marrow'], 'HP'],
    [['jelly', 'gland', 'sac', 'slime', 'ooze'], 'MP'],
    [['ear', 'ears', 'paw', 'foot', 'coin'], 'LUK'],
];
// What a material is made of, by a word in its name (or its creature's), and the element it carries.
const ELEMENT_WORDS = {
    fire: ['ember', 'embers', 'flame', 'fire', 'cinder', 'ash', 'salamander', 'magma', 'lava', 'brimstone', 'drake', 'dragon', 'dragonbone'],
    ice: ['frost', 'ice', 'snow', 'rime', 'glacier', 'winter', 'ectoplasm', 'wraith', 'ghost', 'spirit'],
    poison: ['venom', 'venomous', 'poison', 'toxic', 'toxin', 'plague', 'blight', 'spider', 'scorpion', 'wyvern', 'rat', 'rats', 'slime', 'viper', 'serpent'],
    holy: ['holy', 'blessed', 'relic', 'saint', 'saintly', 'angel', 'angelic', 'sun', 'sacred', 'hallowed'],
};
// The stats an affinity may name in a note.
const AFFINITY_STATS = ['ATK', 'MATK', 'DEF', 'MDEF', 'HP', 'MP', 'STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'];

const words = text => String(text ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);

/**
 * What a material would lend a crafted piece: { stat, element }, each null when nothing says.
 * Its note first (`uncommon material · MDEF, poison`), else its name (and `creature`, the
 * name of whoever dropped it): a material written before 0.5.34 is read by its name.
 */
export function materialAffinity(name, note = '', creature = '') {
    const noted = String(note ?? '');
    let stat = AFFINITY_STATS.find(candidate => new RegExp(`(?<![A-Za-z])${candidate}(?![A-Za-z]|\\s*[+-]?\\d)`).test(noted)) ?? null;
    let element = ELEMENTS.find(candidate => new RegExp(`\\b${candidate}\\b`, 'i').test(noted)) ?? null;
    const own = words(name);
    if (!stat) stat = PART_STATS.find(([list]) => own.some(word => list.includes(word)))?.[1] ?? null;
    if (!element) {
        const all = [...own, ...words(creature)];
        element = ELEMENTS.find(candidate => all.some(word => ELEMENT_WORDS[candidate].includes(word))) ?? null;
    }
    return { stat, element };
}

/**
 * <Crafted> lines: `Skull Charm from Brood-Mother Skull, 2 Fang | slot: worn`, one piece each
 * (a "2 Fang" or "Fang ×2" uses two). [{ name, materials: [{ name, qty }], slot }]; a line
 * without "from" or a material is skipped.
 */
export function parseCrafted(text) {
    const out = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
        if (!line) continue;
        if (/^(?:none|nothing|no\b)/i.test(line)) continue;
        const [main, ...options] = line.split('|');
        // (0.5.36) "Skull Ring — collected (from the bone-carver)": an order picked up.
        const picked = main.match(/^(.+?)\s+[—–-]\s+(?:collected|picked up|fetched|received|delivered|handed over)\b/i);
        if (picked) {
            out.push({ name: picked[1].replace(/^(?:an?|the)\s+/i, '').replace(/[*_`]/g, '').trim(), materials: [], slot: null, pickup: true });
            continue;
        }
        const match = main.match(/^(.+?)\s+(?:from|out of|using|with)\s+(.+)$/i);
        const option = word => options.join('|').match(new RegExp(`\\b(?:${word})\\s*:\\s*([^|]+)`, 'i'))?.[1]?.trim() ?? null;
        // (0.5.36) No materials: an order collected ("Skull Ring", "Skull Ring — collected").
        if (!match) {
            const collected = main.split(/\s+[—–-]\s+|:/)[0].replace(/^(?:an?|the)\s+/i, '').replace(/[*_`]/g, '').trim();
            if (collected) out.push({ name: collected, materials: [], slot: null, pickup: true });
            continue;
        }
        const name = match[1].replace(/^(?:an?|the)\s+/i, '').replace(/[*_`]/g, '').trim();
        const materials = match[2].split(/\s*(?:,|;|\+|&|\band\b)\s*/i).map(part => {
            const piece = part.replace(/[*_`.]/g, '').trim();
            const lead = piece.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
            const tail = piece.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
            const qty = lead ? Number(lead[1]) : tail ? Number(tail[2]) : 1;
            const bare = (lead ? lead[2] : tail ? tail[1] : piece).replace(/^(?:an?|the|one|some)\s+/i, '').trim();
            return { name: bare, qty: Math.max(1, qty) };
        }).filter(entry => entry.name);
        if (!name || !materials.length) continue;
        const slotWord = options.join('|').match(/\bslot\s*:\s*([a-z-]+)/i)?.[1];
        // (0.5.36) An order: made later, collected with its own line ("| ready: Goldwane 14").
        const ready = option('ready|due|on');
        out.push({ name, materials, slot: slotWord ? slotFromWord(slotWord) : null, ...(ready ? { ready } : {}) });
    }
    return out;
}

// A material row of the Inventory a crafted line names: by its name, else the one row whose
// name holds every word of it ("the skull" is the Brood-Mother Skull when it is the only one).
function findMaterial(items, wanted) {
    const key = nameKey(wanted);
    const materials = items.filter(item => !item.slot && !item.effect?.heal && !item.effect?.mp);
    const exact = materials.find(item => nameKey(item.name) === key);
    if (exact) return exact;
    const want = words(wanted).filter(word => !['the', 'a', 'an', 'of'].includes(word));
    const holding = materials.filter(item => want.length && want.every(word => words(item.name).some(other => other === word || other === `${word}s` || `${other}s` === word)));
    return holding.length === 1 ? holding[0] : null;
}

const bumpRarity = (rarity, steps) => RARITIES[Math.min(RARITIES.length - 1, Math.max(0, RARITIES.indexOf(rarity)) + steps)];

/**
 * What each <Crafted> line makes from the Inventory as it was before the reply (`inventory`):
 * [{ item: { name, rarity, stats, tags, slot }, used: [{ name, qty }] }]. A material the
 * Inventory does not hold counts as common and is not taken (the crafter's own, the story's
 * to say). `level`: the crafter's.
 */
export function craftPlan(inventory, crafted, { level = 1, rules = DEFAULT_RULES } = {}) {
    const items = parseInventory(inventory).items;
    const c = { ...DEFAULT_RULES.craft, ...(rules.craft ?? {}) };
    return (crafted ?? []).filter(entry => !entry.pickup && entry.materials?.length).map(entry => {
        const parts = entry.materials.map(material => {
            const row = findMaterial(items, material.name);
            const rarity = row ? describeRow(row).rarity : 'common';
            return { row, qty: material.qty, rarity, ...materialAffinity(row?.name ?? material.name, row?.note ?? '') };
        });
        const top = parts.reduce((best, part) => (RARITIES.indexOf(part.rarity) > RARITIES.indexOf(best) ? part.rarity : best), 'common');
        const atTop = parts.filter(part => part.rarity === top).reduce((sum, part) => sum + part.qty, 0);
        const rarity = atTop >= c.bumpAt ? bumpRarity(top, 1) : top;
        const named = [...new Set(parts.map(part => part.stat).filter(Boolean))].slice(0, c.maxStats);
        const slot = entry.slot ?? itemSlot(entry.name, named.length ? Object.fromEntries(named.map(stat => [stat, 1])) : {});
        const chosen = named.length ? named : [mainStat({ name: entry.name, slot })];
        const budget = rarityBudget(rarity, level, rules);
        const stats = Object.fromEntries(chosen.map(stat => [stat, Math.max(1, Math.floor(budget / chosen.length / (rules.statCost?.[stat] ?? 1)))]));
        const element = parts.find(part => part.element)?.element ?? null;
        const used = parts.filter(part => part.row).map(part => ({ name: part.row.name, qty: part.qty }));
        return { item: { name: entry.name, qty: 1, kind: 'equipment', rarity, stats, slot, ...(element ? { tags: [element] } : {}) }, used, ...(entry.ready ? { order: entry.ready } : {}) };
    });
}
