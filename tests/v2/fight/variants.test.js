import test from 'node:test';
import assert from 'node:assert/strict';
import { foeVariant, foeStatBudget, matchesFoe } from '../../../src/v2/fight/foes.js';
import { foesPin } from '../progress/helpers/fixture.js';
import { killSource, killClaim } from '../../../src/v2/quests/objectives.js';
import { indexOf } from '../../../src/v2/rules/graph.js';
import { seal } from '../../../src/v2/fight/batch.js';
const ix = indexOf(foesPin()); const base = ix.foe('pack.fixture/wolf');
const area = { tier: 2, allowedFoes: [base.id], allowedTags: ['beast', 'forest'] };
test('variant numbers derive only from base and recorded area; copied skills, loot and tags, stable identity', () => {
    const before = JSON.stringify(base);
    const a = foeVariant(base, 'Ash Wolf', area); const b = foeVariant(base, 'Ash Wolf', structuredClone(area));
    assert.equal(a.ok, true, a.why); assert.deepEqual(a, b);
    assert.equal(a.foe.id, 'pack.fixture/wolf~ash-wolf'); assert.equal(a.foe.level, 11);
    assert.ok(Object.values(a.foe.stats).reduce((x,y) => x+y, 0) <= foeStatBudget(11));
    for (const key of ['skills', 'loot', 'loreTags']) assert.deepEqual(a.foe[key], base[key]);
    assert.equal(JSON.stringify(base), before);
});
for (const [label, foe, place, code] of [
    ['unknown area', base, { ...area, tier: null }, 'AREA'],
    ['level cannot fit', base, { ...area, tier: 0 }, 'LEVEL'],
    ['base budget', { ...base, stats: Object.fromEntries(Object.keys(base.stats).map(k => [k, 7])) }, area, 'BUDGET'],
    ['rounding cannot fit', { ...base, stats: { STR: 9, VIT: 6, AGI: 6, DEX: 6, INT: 6, LUK: 6, CHA: 6 } }, area, 'BUDGET'],
    ['forbidden base', base, { ...area, allowedFoes: ['pack.fixture/warlord'] }, 'FOE_NOT_ALLOWED'],
    ['forbidden tag', base, { ...area, allowedTags: ['beast'] }, 'TAG_NOT_ALLOWED'],
]) test(`variant refused without clamping: ${label}`, () => { const before = JSON.stringify(foe); assert.equal(foeVariant(foe, 'Ash Wolf', place).code, code); assert.equal(JSON.stringify(foe), before); });
test('sealed variant kills match only exact ref, or an explicitly permitted base; claim cannot be spent via both', () => {
    const ref = `${base.id}~ash-wolf`;
    assert.equal(matchesFoe({ foe: base.id }, ref), false); assert.equal(matchesFoe({ foe: base.id, allowVariants: true }, ref), true);
    const batch = seal({ kind: 'fight', fight: 'fi_00000001', outcome: 'victory', enemies: [{ id: 'fo_00000001', name: 'Ash Wolf', foe: ref, gone: 'down' }] });
    const facts = { ix, quest: { acceptedCursor: { rev: 1 } }, combat: { beaten: { fi_00000001: { won: true, rev: 2 } } }, progress: { batches: { br_00000001: batch } } };
    assert.equal(killSource(facts, { foe: ref }, 'fi_00000001').count, 1);
    assert.equal(killSource(facts, { foe: base.id }, 'fi_00000001').ok, false);
    assert.equal(killSource(facts, { foe: base.id, allowVariants: true }, 'fi_00000001').count, 1);
    assert.equal(killClaim('ep_00000000','br_00000001',ref),killClaim('ep_00000000','br_00000001',base.id));
});

test('a declared variant name remains literal rather than becoming a guessed bestiary identity', async () => {
    const { readEncounter } = await import('../../../src/v2/combat/encounter.js');
    const line = { op: '!', name: 'The Wolves and the Ash', labels: { like: 'wolf' } };
    const read = readEncounter(line, { literal: true });
    assert.equal(read.ok, true); assert.equal(read.foes.length, 1); assert.equal(read.foes[0].name, line.name);
    assert.equal(read.foes[0].count, 1);
});
