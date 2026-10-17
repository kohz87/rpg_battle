// A companion's starting kit: the words-only call's prompt and answer, the default kit from
// the library, and skills a <Joins> hint names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES as R } from '../src/rules.js';
import { DEFAULT_SKILLS, skillFromTemplate } from '../src/skills.js';
import { buildStats } from '../src/builds.js';
import { KIT_SYSTEM, fallbackKit, kitPrompt, kitTemplate, namedKit, parseKit, usableKit } from '../src/kit.js';

test('the prompt names the companion, their role, who they are and asks for words only', () => {
    const [system, user] = kitPrompt({ name: 'Lyra', role: 'healer', summary: 'A wandering cleric.', level: 'Level 6', focus: ['INT', 'VIT'] });
    assert.equal(system.role, 'system');
    assert.equal(system.content, KIT_SYSTEM);
    assert.match(KIT_SYSTEM, /never numbers/);
    assert.match(user.content, /Companion: Lyra\nRole: healer\nWho they are: A wandering cleric\.\nPower: Level 6\nStrongest stats: INT, VIT/);
});

test('the answer: names, words and known fields only; numbers dropped; at most three, unique', () => {
    const kit = parseKit([
        'Sure! Here are the skills:',
        '1. **Frost Lance** — a spear of ice | type: magic, stat: INT, target: one, effect: ice, power: 900',
        '- Mend — closes wounds, heals one friend | type: heal, stat: WIS',
        'mend — again',
        'Sun Ward: a ward of light 12 MP | type: buff, target: allies',
        'Fourth Thing — too many',
    ].join('\n'));
    assert.deepEqual(kit.map(spec => [spec.name, spec.type, spec.stat, spec.target, spec.element]), [
        ['Frost Lance', 'magic', 'INT', 'one', 'ice'],
        ['Mend', 'heal', 'INT', 'ally', 'none'],
        ['Sun Ward', 'buff', 'INT', 'allies', 'none'],
    ], 'chatter, repeats and a fourth skill dropped; an unknown stat guessed instead');
    const clean = parseKit('Frost Lance — a spear of ice | type: magic, effect: ice\nSun Ward: a ward of light, 12 MP | type: buff, target: allies');
    assert.deepEqual(clean.map(spec => [spec.name, spec.words, spec.type, spec.target]), [['Frost Lance', 'a spear of ice', 'magic', 'one'], ['Sun Ward', 'a ward of light, MP', 'buff', 'allies']]);
    assert.ok(usableKit(clean));
    assert.ok(!usableKit(parseKit('')));
    // Code sets every number: the template at the companion's level.
    const built = skillFromTemplate(kitTemplate(clean[0]), 6, R);
    assert.equal(built.name, 'Frost Lance');
    assert.deepEqual(built.effect, { slow: R.generated.effectRounds.slow });
});

test('the default kit: three library skills the built companion can take, the same every time', () => {
    const first = fallbackKit({ focus: ['INT', 'VIT', 'CHA'], level: 3, role: 'healer' }, DEFAULT_SKILLS, R);
    assert.equal(first.length, 3);
    assert.ok(first.every(spec => spec.library));
    assert.ok(first.some(spec => spec.type === 'heal'));
    assert.deepEqual(fallbackKit({ focus: ['INT', 'VIT', 'CHA'], level: 3, role: 'healer' }, DEFAULT_SKILLS, R), first);
    const stats = buildStats(['INT', 'VIT', 'CHA'], 3, R);
    for (const spec of first) {
        const skill = DEFAULT_SKILLS.find(entry => entry.name === spec.name);
        for (const [stat, need] of Object.entries(skill.requires ?? {})) assert.ok(stats[stat] >= need, spec.name);
    }
});

test('a Joins hint names the skills: library ones as they are, others guessed from their names', () => {
    const kit = namedKit(['fireball', 'Shadow Step', 'Mend', 'Fourth'], DEFAULT_SKILLS);
    assert.deepEqual(kit.map(spec => [spec.name, Boolean(spec.library)]), [['Fireball', true], ['Shadow Step', false], ['Mend', true]]);
    assert.equal(kit[1].type, 'magic', 'shadow reads as magic');
});
