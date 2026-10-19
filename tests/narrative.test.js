// The State line's words (src/narrative.js): the HP and MP bands of rules.narrative at their
// edges, the portrayal hints, when MP is left out, and how conditions are named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, makeRules } from '../src/rules.js';
import { stateWords } from '../src/narrative.js';

const R = DEFAULT_RULES;

function sheet(hp, mp = [30, 30], conditions = []) {
    return { hp: { cur: hp[0], max: hp[1] }, mp: { cur: mp[0], max: mp[1] }, conditions };
}

test('the default bands ship in the rules', () => {
    assert.deepEqual(R.narrative.hpBands, [[0.9, 'unhurt'], [0.7, 'bruised'], [0.45, 'hurt'], [0.2, 'badly hurt'], [0.01, 'barely standing']]);
    assert.deepEqual(R.narrative.mpBands, [[0.6, 'fresh'], [0.25, 'tired']]);
    assert.equal(R.narrative.mpQuietBelow, 10);
});

test('HP words at each band edge: at or above a share gets its word; 0 HP is down', () => {
    const word = (cur, max = 100) => stateWords(sheet([cur, max]), R).hp;
    assert.equal(word(100), 'unhurt');
    assert.equal(word(90), 'unhurt');
    assert.equal(word(89), 'bruised');
    assert.equal(word(70), 'bruised');
    assert.equal(word(69), 'hurt');
    assert.equal(word(45), 'hurt');
    assert.equal(word(44), 'badly hurt');
    assert.equal(word(20), 'badly hurt');
    assert.equal(word(19), 'barely standing');
    assert.equal(word(1), 'barely standing');
    assert.equal(word(1, 1000), 'barely standing', 'still standing below the last share');
    assert.equal(word(0), 'down');
    assert.equal(word(-5), 'down');
});

test('the worse HP words carry a portrayal hint; the lighter ones stand alone', () => {
    const text = cur => stateWords(sheet([cur, 100]), R).text;
    assert.equal(text(95), 'unhurt');
    assert.equal(text(80), 'bruised');
    assert.equal(text(50), 'hurt (aching, favouring a wound)');
    assert.equal(text(30), 'badly hurt (bleeding, slow to move)');
    assert.equal(text(5), 'barely standing (staggering, could fall at any moment)');
    assert.equal(text(0), 'down (unconscious or unable to fight)');
});

test('MP is mentioned only when not fresh, never for a tiny pool or someone down', () => {
    const at = (cur, max = 100, hp = 100) => stateWords(sheet([hp, 100], [cur, max]), R);
    assert.equal(at(60).mp, 'fresh');
    assert.equal(at(60).text, 'unhurt');
    assert.equal(at(59).mp, 'tired');
    assert.equal(at(59).text, 'unhurt · tired of magic');
    assert.equal(at(25).mp, 'tired');
    assert.equal(at(24).mp, 'drained');
    assert.equal(at(0).text, 'unhurt · drained of magic');
    // A max MP under 10 is no caster's pool: the word is still worked out, never shown.
    assert.equal(at(0, 9).mp, 'drained');
    assert.equal(at(0, 9).text, 'unhurt');
    assert.equal(at(0, 10).text, 'unhurt · drained of magic');
    assert.equal(at(0, 0).text, 'unhurt');
    assert.equal(at(0, 100, 0).text, 'down (unconscious or unable to fight)');
});

test('conditions in words: fight names become adjectives, others as written, no repeats', () => {
    const names = ['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'exhausted'].map(name => ({ name, rounds: 2 }));
    assert.deepEqual(stateWords(sheet([100, 100], [30, 30], names), R).conditions,
        ['poisoned', 'burned', 'bleeding', 'stunned', 'slowed', 'weakened', 'exhausted']);
    const mixed = [{ name: 'Poison', rounds: 1 }, { name: 'poisoned', rounds: null }, { name: 'Cursed by the Witch', rounds: null }, { name: '  ' }, { name: 'shield', rounds: 1 }];
    assert.deepEqual(stateWords(sheet([100, 100], [30, 30], mixed), R).conditions, ['poisoned', 'Cursed by the Witch', 'shield']);
});

test('the text joins HP, MP and conditions with " · "', () => {
    const state = stateWords(sheet([20, 98], [3, 32], [{ name: 'poison', rounds: 2 }]), R);
    assert.deepEqual(state, {
        hp: 'badly hurt',
        mp: 'drained',
        conditions: ['poisoned'],
        text: 'badly hurt (bleeding, slow to move) · drained of magic · poisoned',
    });
    assert.equal(stateWords(sheet([0, 98], [3, 32], [{ name: 'bleed', rounds: 2 }]), R).text, 'down (unconscious or unable to fight) · bleeding');
});

test('bands come from rules.json; missing or odd input never throws', () => {
    const rules = makeRules({ narrative: { hpBands: [[0.5, 'fine'], [0.1, 'wounded']], mpBands: [[0.5, 'full'], [0.1, 'low']] } });
    assert.equal(stateWords(sheet([50, 100], [40, 100]), rules).text, 'fine · low of magic');
    assert.equal(stateWords(sheet([5, 100], [5, 100]), rules).text, 'wounded · drained of magic', 'a renamed band has no hint');
    assert.equal(stateWords(sheet([5, 100]), { ...R, narrative: undefined }).hp, 'barely standing', 'rules without narrative use the defaults');
    assert.deepEqual(stateWords({}, R), { hp: 'down', mp: 'fresh', conditions: [], text: 'down (unconscious or unable to fight)' });
    assert.equal(stateWords(null).text, 'down (unconscious or unable to fight)');
    assert.equal(stateWords({ hp: { cur: 10, max: 0 } }, R).hp, 'unhurt');
});

// index.js is SillyTavern glue and cannot be imported here, so its kept-block notes are read
// from the source: Story Block refuses a promptNote over 300 characters.
// 0.4: one Party block, one note for your character and the companions.
test('the Party prompt note points at the State lines and fits Story Block', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /const CHARACTER_NOTE/, 'no separate Character note any more');
    for (const name of ['PARTY_NOTE']) {
        const match = source.match(new RegExp(`const ${name} = '((?:[^'\\\\]|\\\\.)*)';`));
        assert.ok(match, `${name} is a plain string`);
        const note = match[1].replace(/\\'/g, '\'');
        assert.ok(note.length <= 300, `${name} is ${note.length} characters`);
        assert.match(note, /State line/);
        assert.doesNotMatch(note, /\{\{/, 'no placeholders: Story Block does not fill them in');
    }
    assert.match(source, /const PARTY_NOTE = '.*\(you\).*Visible Condition must agree/);
});

test('a character killed in a fight to the death reads "dead" and nothing else', () => {
    assert.deepEqual(stateWords({ hp: { cur: 0, max: 50 }, mp: { cur: 3, max: 30 }, conditions: [{ name: 'Dead', rounds: null }, { name: 'poison', rounds: 2 }] }, R), { hp: 'dead', mp: '', conditions: [], text: 'dead' });
});

test('stamina in words (0.5.29): nothing while fresh, then breathing hard, then winded; never for someone down', () => {
    const at = (cur, hp = [90, 100]) => stateWords({ hp: { cur: hp[0], max: hp[1] }, mp: { cur: 30, max: 30 }, sp: { cur, max: 40 } }, R);
    assert.equal(at(40).text, 'unhurt');
    assert.equal(at(12).text, 'unhurt · breathing hard');
    assert.equal(at(4).text, 'unhurt · winded');
    assert.equal(at(4).sp, 'winded');
    assert.equal(at(0, [0, 100]).text, 'down (unconscious or unable to fight)');
});
