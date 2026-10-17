// The story's offers: one message's hidden blocks as offers keyed by message and line, names by
// full or first name, your character's waiting for one to exist, quests from Story Director.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES as R, xpToNext } from '../src/rules.js';
import { DEFAULT_SKILLS } from '../src/skills.js';
import { newSheet } from '../src/sheet.js';
import { newCompanion } from '../src/party.js';
import { questOffers, storyOffers } from '../src/offers.js';

const ren = newSheet({ name: 'Ren Aldane', stats: { STR: 5, VIT: 5 } }, R);
const lyra = newCompanion({ name: 'Lyra Vance', role: 'healer', focus: ['INT'], skills: ['Mend'] }, { rules: R });

const texts = {
    joins: 'Bram — old soldier, level 3\nLyra — healer',
    leaves: 'Lyra: returned to her village\nGareth: rode off',
    learned: 'Lyra — Frost Lance: ice magic, hits all\nLyra — Mend: again\nYou — Shadow Step: dash behind a foe | type: physical, stat: AGI, effect: stun\nGareth — Fireball: fire',
    xp: 'major: rescued the caravan',
    rest: 'long: slept at the inn',
};

test('one reply: joins, leaves, learned, xp and rest offers, keyed by message, kind and line', () => {
    const offers = storyOffers({ index: 7, texts, pc: ren, members: [lyra], rules: R, library: DEFAULT_SKILLS });
    assert.deepEqual(offers.map(offer => [offer.kind, offer.text]), [
        ['joins', 'Bram joined. Add as companion?'],
        ['leaves', 'Lyra Vance left the party. Remove?'],
        ['learned', 'Lyra Vance learned Frost Lance. Add it?'],
        ['learned', 'Ren Aldane learned Shadow Step. Add it?'],
        ['xp', `XP +${Math.round(0.25 * xpToNext(1, R))}: rescued the caravan. Award?`],
        ['rest', 'Rest (long): slept at the inn. Recover?'],
    ], 'Lyra is in the party already, knows Mend; Gareth is nobody');
    assert.equal(offers[0].key, '7:joins:Bram — old soldier, level 3');
    assert.deepEqual(offers[0].data, { name: 'Bram', role: 'old soldier', level: 3, focus: ['STR', 'VIT'], skills: [], free: false });
    assert.deepEqual(offers[1].data, { memberId: 'lyra-vance' });
    assert.deepEqual(offers[2].data, { memberId: 'lyra-vance', prefill: { name: 'Frost Lance', words: 'ice magic, hits all', type: 'magic', stat: 'INT', target: 'all', element: 'ice', free: false } });
    assert.deepEqual(offers[3].data.prefill, { name: 'Shadow Step', words: 'dash behind a foe', type: 'physical', stat: 'AGI', target: 'one', element: 'lightning', free: false });
    assert.deepEqual(offers[4].data, { share: 0.25 });
});

test('the narrating reply gives no XP or rest; a result waiting gives no rest; a library skill keeps its own shape', () => {
    const kinds = over => storyOffers({ index: 3, texts, pc: ren, members: [lyra], rules: R, library: DEFAULT_SKILLS, ...over }).map(offer => offer.kind);
    assert.ok(!kinds({ narrating: true }).includes('xp') && !kinds({ narrating: true }).includes('rest'));
    assert.ok(kinds({ pending: true }).includes('xp') && !kinds({ pending: true }).includes('rest'));
    const [offer] = storyOffers({ index: 1, texts: { learned: 'Ren — fireball: a ball of flame' }, pc: ren, rules: R, library: DEFAULT_SKILLS });
    assert.deepEqual(offer.data.prefill, { name: 'Fireball', words: 'a ball of flame', type: 'magic', stat: 'INT', target: 'all', element: 'none', free: false });
});

test('the opening message: yours wait until there is a character, by "You" or the persona\'s name; Joins and theirs come at once', () => {
    const opening = { learned: 'You — Shadow Step: dash | type: physical\nRen — Sweep: a wide swing', joins: 'Lyra — healer, level 3 | focus: INT, VIT | skills: Frost Lance, Mend', xp: 'minor: a start' };
    const before = storyOffers({ index: 0, texts: opening, pc: null, members: [], persona: 'Ren', rules: R, library: DEFAULT_SKILLS, opening: true });
    assert.deepEqual(before.map(offer => offer.kind), ['joins'], 'your skills and XP wait');
    assert.deepEqual(before[0].data, { name: 'Lyra', role: 'healer', level: 3, focus: ['INT', 'VIT'], skills: ['Frost Lance', 'Mend'], free: true });
    const made = newSheet({ name: 'Ren', stats: { STR: 10 } }, R);
    const after = storyOffers({ index: 0, texts: opening, pc: made, members: [], persona: 'Ren', rules: R, library: DEFAULT_SKILLS, opening: true });
    assert.deepEqual(after.map(offer => [offer.kind, offer.text]), [
        ['joins', 'Lyra joined. Add as companion?'],
        ['learned', 'Ren learned Shadow Step. Add it?'],
        ['learned', 'Ren learned Sweep. Add it?'],
        ['xp', `XP +${Math.round(0.1 * xpToNext(1, R))}: a start. Award?`],
    ]);
    assert.equal(after[1].data.prefill.free, true, 'the opening message\'s skills come without stat requirements');
    assert.equal(after[1].key, '0:learned:You — Shadow Step: dash | type: physical');
});

test('quests done in a reply: XP by difficulty; none without a character', () => {
    const offers = questOffers({ index: 9, quests: [{ id: 'q1', name: 'The Lost Caravan', difficulty: 'hard' }, { id: 'q2', name: 'Rats', difficulty: '' }, { name: '' }], pc: ren, rules: R });
    assert.deepEqual(offers.map(offer => [offer.key, offer.text, offer.data.share]), [
        ['9:quest:q1', `Quest done: The Lost Caravan (hard). Award XP +${Math.round(0.15 * xpToNext(1, R))}?`, 0.15],
        ['9:quest:q2', `Quest done: Rats (normal). Award XP +${Math.round(0.1 * xpToNext(1, R))}?`, 0.1],
    ]);
    assert.deepEqual(questOffers({ index: 9, quests: [{ name: 'X' }], pc: null }), []);
    assert.deepEqual(questOffers({ index: 9, quests: 'nonsense', pc: ren }), []);
});
