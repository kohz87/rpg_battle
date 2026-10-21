// RB re-break round 2 fixes (b3-economy r2-4): what a character file brings is held to a worth,
// not only a count. Σ worth × qty of its things is at most worthCap(level) = 2 × purseCap(level),
// each piece priced as this chat prices it (the item.define hook, or the chat's own def); the
// worn pieces count first; identical defs in the file are folded into one. Over the cap the
// excess things are left behind, and the summary says so (as for the count and the purse).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';
import { MAX_THINGS, purseCap, readCharacter, worthCap } from '../../../src/v2/party/portable.js';
import { makeRules } from '../../../src/rules.js';
import { show } from './helpers/econ.js';

const FILE = {
    rpgBattleCharacter: 1, name: 'Trader', role: '', level: 1, xp: 0, points: 0,
    stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [], custom: [], purse: 0,
};
const sword = { name: 'Epic Sword', kind: 'equipment', rarity: 'epic', slot: 'weapon', stats: { ATK: 999 } };

/** Σ value × qty of what the party holds, and the defs named `name`. */
function holding(host, name) {
    const inv = host.head().domains.inventory;
    const total = Object.values(inv.stacks).reduce((sum, stack) => sum + (inv.defs[stack.def]?.value ?? 0) * stack.qty, 0);
    return { total, defs: Object.values(inv.defs).filter(def => def.name === name), inv };
}

test('r2-4: 200 identical file defs are one def, and what comes in is worth at most worthCap(level)', async () => {
    const host = await rpgHost();
    try {
        const items = Array.from({ length: 200 }, () => ({ def: structuredClone(sword), qty: 1 }));
        const r = await host.cmd('creation.import', { character: { ...structuredClone(FILE), items } });
        assert.equal(r.ok, true, show(r));
        const { total, defs } = holding(host, 'Epic Sword');
        assert.equal(defs.length, 1, `one def, not ${defs.length}`);
        assert.ok(total <= worthCap(1), `worth ${total} > ${worthCap(1)}`);
        assert.ok(r.receipt.data.cut.worth > 0);
        assert.equal(r.receipt.data.cut.things, 0);
        assert.match(r.receipt.summary, new RegExp(`${r.receipt.data.cut.worth} things stayed behind: more than a character of that level brings\\.$`));
    } finally { host.close(); }
});

test('r2-4: priced as this chat prices it: goods named for a potion and many kinds still fit worthCap', async () => {
    for (const level of [1, 3]) {
        const host = await rpgHost();
        try {
            const items = [
                { def: { name: 'Grand Elixir', kind: 'goods', rarity: 'epic' }, qty: 40 },
                { def: { name: 'Ruby', kind: 'goods', rarity: 'epic' }, qty: 90 },
                ...Array.from({ length: 30 }, (_, n) => ({ def: { name: `Blade ${n}`, kind: 'equipment', rarity: 'rare', slot: 'weapon', stats: { ATK: 50 } }, qty: 1 })),
            ];
            const r = await host.cmd('creation.import', { character: { ...structuredClone(FILE), level, items } });
            assert.equal(r.ok, true, show(r));
            const { total } = holding(host, '');
            assert.ok(total <= worthCap(level), `level ${level}: worth ${total} > ${worthCap(level)}`);
        } finally { host.close(); }
    }
});

test('r2-4: the worn pieces count first, so a full bag never leaves your weapon behind', async () => {
    const host = await rpgHost();
    try {
        const items = [
            { def: { name: 'Ruby', kind: 'goods', rarity: 'epic' }, qty: 200 },
            { def: { name: 'Oak Staff', kind: 'equipment', rarity: 'uncommon', slot: 'weapon', stats: { MATK: 3 } }, qty: 1, equipped: true },
        ];
        const r = await host.cmd('creation.import', { character: { ...structuredClone(FILE), items } });
        assert.equal(r.ok, true, show(r));
        assert.deepEqual(r.receipt.data.equipped, ['Oak Staff']);
        assert.ok(r.receipt.data.cut.worth > 0, 'some rubies stay behind');
    } finally { host.close(); }
});

test('r2-4 (pure): readCharacter folds defs that differ only in stat order, then cuts count, worth and purse', () => {
    const rules = makeRules({});
    const items = [
        { def: { name: 'Plate', kind: 'equipment', rarity: 'common', slot: 'armour', stats: { DEF: 2, MDEF: 1 } }, qty: 2 },
        { def: { name: 'Plate', kind: 'equipment', rarity: 'common', slot: 'armour', stats: { MDEF: 1, DEF: 2 } }, qty: 3, equipped: true },
        { def: { name: 'Gem', kind: 'goods' }, qty: MAX_THINGS },
    ];
    const read = readCharacter({ ...FILE, items, purse: 1000 }, { rules, worth: def => (def.name === 'Plate' ? 50 : 2) });
    assert.equal(read.ok, true, read.message);
    const { items: kept, cut, purse } = read.character;
    assert.deepEqual(kept.map(entry => [entry.def.name, entry.qty, entry.equipped]), [['Plate', 5, true], ['Gem', 125]].map(([n, q, e = false]) => [n, q, e]));
    assert.deepEqual(cut, { things: 5, worth: MAX_THINGS - 5 - 125, purse: 1000 - purseCap(1) });
    assert.equal(purse, purseCap(1));
});
