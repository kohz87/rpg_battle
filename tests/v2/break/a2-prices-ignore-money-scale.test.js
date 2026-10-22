// Breaker a2 (final cell): RPG Battle's built-in prices do not follow the money scale (MODULES §F104).
// PACKS.md "The money scale": "The built-in defaults that come from no pack are gold-scale: Story Block's
// story coin budget of 1000 × level, Story Director's default ranks, RPG Battle's default loot, coin and
// prices. … Every built-in default money number is multiplied by it." Story Block's budget does follow it
// (1000 at scale 1, 8000 at 8, 100 at 0.1), but RPG Battle's generic shop stock (trade/core.js stockDef →
// v1 itemWorth) and the worth the item.define hook gives a story-made thing (items/define.js → itemWorth)
// are the same at every scale. In the Ersveil chat (scale 8) a spear is 135 marks at Bluewatch's Gate Forge
// (the pack's) and 18 marks at any smith off the pack's map; a story-made "Short Sword" is worth 20 marks, so
// the reply's goods budget (worth, 2 × 400 marks) lets the story hand out eight times the gear it should.
// Drop into rpg_battle/tests/v2/break/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';

async function pricesAt(t, scale) {
    const host = await rpgHost({ settings: { modules: { 'story-block': { economyScale: scale } } } });
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    await host.send('In.', host.reply('Thornwick Village.', ['~ place Thornwick Village | kind: settlement', '+ item Short Sword | note: weapon, ATK +3']));
    assert.equal(host.q('inventory.economy').scale, Number(scale));
    const stock = host.q('trade.stock', { kind: 'smith' });
    const gear = stock.items.find(item => item.def.kind === 'equipment');
    const story = host.q('inventory.items', {}).find(item => item.name === 'Short Sword');
    return { budget: host.q('inventory.storyBudget').budget, shop: gear.price, story: story.value };
}

test('a2-2: RPG Battle\'s built-in shop prices and story-made item worth follow the money scale, as the budget does', async t => {
    t.mock.method(console, 'warn', () => {});
    const one = await pricesAt(t, '1');
    const eight = await pricesAt(t, '8');
    assert.equal(eight.budget, one.budget * 8, 'Story Block\'s fallback budget follows the scale');
    assert.ok(eight.shop >= one.shop * 7, `a smith's gear: ${one.shop} at scale 1, ${eight.shop} at scale 8`);
    assert.ok(eight.story >= one.story * 7, `a story-made Short Sword is worth ${one.story} at scale 1, ${eight.story} at scale 8`);
});
