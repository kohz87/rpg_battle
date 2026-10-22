// rx-ui (beta rolling break, Crafting screen with huge data): the Crafting screen's query works out each
// recipe's check modifiers from scratch, and each time asks for the whole creation content (every pack's
// races and talents, copied by the host's query) and the check modifiers again. A pack may hold 1000
// recipes; with 600 `known` ones, one draw of the Crafting screen took ~2 s here (most of it
// structuredClone of the creation content), and it runs again on every head change while the screen is
// open. The work per crafter should not grow with the number of recipes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { craftHost, PACK } from '../craft/helpers.js';

const N = 300;
const bigPack = () => {
    const items = [...PACK.content.items];
    const recipes = [...PACK.content.recipes];
    for (let i = 0; i < N; i += 1) {
        items.push({ name: `Thing ${i}`, kind: 'consumable', rarity: 'common', value: 5, effect: { heal: 1 } });
        recipes.push({ name: `Thing ${i}`, makes: `thing-${i}`, materials: [{ item: 'iron-ore', qty: 1 }], craft: ['smithing', 'alchemy', 'cooking'][i % 3], known: true, minutes: 10 });
    }
    return { ...PACK, content: { ...PACK.content, items, recipes } };
};

test('one craft.view (the query behind the Crafting screen) asks for the creation content and modifiers a bounded number of times, not once per recipe', async () => {
    const host = await craftHost({ pack: bigPack() });
    try {
        const calls = new Map();
        const original = host.registry.query.bind(host.registry);
        host.registry.query = name => {
            calls.set(name, (calls.get(name) ?? 0) + 1);
            return original(name);
        };
        const view = host.q('craft.view', {});
        host.registry.query = original;
        assert.ok(view.people.some(person => person.count > 0), 'recipes are listed');
        const heavy = [...calls].filter(([, n]) => n > 50);
        assert.deepEqual(heavy, [], `queries run per recipe: ${heavy.map(([name, n]) => `${name} ×${n}`).join(', ')}`);
    } finally {
        host.close();
    }
});
