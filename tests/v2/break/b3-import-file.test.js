// B-b3-15: creation.import checks a character file's level, stats and skills, but not its purse or
// items: a level-1 file with a purse of 9,007,199,254,740,000, 9999 legendary draughts and a worn
// "Godblade" ATK +9999 imports as it is (and the near-MAX_SAFE purse then refuses every later
// coin: sales, loot and quest pay all fail with INVALID).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';
import { coin, show } from './helpers/econ.js';

const FILE = {
    rpgBattleCharacter: 1, name: 'Cheater', role: 'rogue', level: 1, xp: 0, points: 0,
    stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [], custom: [],
    items: [
        { def: { name: 'Elixir of Ages', kind: 'consumable', rarity: 'legendary', stack: true, slot: null, effect: { heal: 999999 } }, qty: 9999, equipped: false },
        { def: { name: 'Godblade', kind: 'equipment', rarity: 'legendary', stack: false, slot: 'weapon', stats: { ATK: 9999 } }, qty: 1, equipped: true },
    ],
    purse: 9007199254740000,
};

test('a character file cannot bring an unbounded purse', async () => {
    const host = await rpgHost();
    try {
        const r = await host.cmd('creation.import', { character: structuredClone(FILE) });
        if (r.ok) assert.ok(coin(host) < 1e9, `imported purse: ${coin(host)}`);
    } finally { host.close(); }
});

test('a character file\'s items are held to this chat\'s rules (stats capped, prices from capped stats)', async () => {
    const host = await rpgHost();
    try {
        const r = await host.cmd('creation.import', { character: { ...structuredClone(FILE), purse: 0 } });
        assert.equal(r.ok, true, show(r));
        const inv = host.head().domains.inventory;
        const blade = Object.values(inv.defs).find(def => def.name === 'Godblade');
        assert.ok(!blade || blade.stats.ATK < 100, `Godblade kept ATK ${blade?.stats?.ATK}, worth ${blade?.value}`);
        const elixir = Object.values(inv.defs).find(def => def.name === 'Elixir of Ages');
        assert.ok(!elixir || elixir.value < 10000, `Elixir of Ages worth ${elixir?.value} each, ×9999`);
    } finally { host.close(); }
});
