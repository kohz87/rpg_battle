// The `trainer` change line is in the prompt only while the chat pins a pack that has a trainer template (RB open trainers §4.1, §9): module.js
// ANDs the kind's `when` into `enabled` on the production path, so every other chat keeps its prompt byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { staticParts } from '../../vendor/story-block/src/v2/prompt.js';
import { drillsTemplate, openTrainerPack, trainerPack } from '../progress/helpers/fixture.js';
import { createModule } from '../../../src/v2/module.js';
import { LISTED_TEMPLATES, TRAINER_GRAMMAR, trainerGrammar, trainerKindOn } from '../../../src/v2/training/capture.js';
import { ok, openWorld } from './helpers/pinned.js';

// Every module's change-line grammar is in Story Suite's part of the prompt, RPG Battle's rules in its own: the whole static prompt.
const rbText = h => staticParts(h.registry).map(part => part.text).join('\n');
const trainerLines = text => text.split('\n').filter(line => line.includes('+ trainer'));
const templates = count => Array.from({ length: count }, (_, n) => drillsTemplate({ slug: `lessons-${n + 1}`, name: `Lessons ${n + 1}` }));

async function pinned(t, pack) {
    const h = await openWorld({ packs: [pack] });
    t.after(() => h.close());
    return h;
}

test('before a pack is pinned there is no trainer line, and a stray one is an unknown kind', async t => {
    const h = await pinned(t, openTrainerPack());
    assert.deepEqual(trainerLines(rbText(h)), []);
    assert.equal(h.registry.module('rpg-battle').capture.kinds.trainer.enabled, false);
    ok(await h.pin());
    assert.equal(h.registry.module('rpg-battle').capture.kinds.trainer.enabled, true);
});

test('pinned to a pack without templates: no trainer line, and the line is an unknown kind as it is in a legacy chat', async t => {
    const h = await pinned(t, trainerPack());
    ok(await h.pin());
    assert.deepEqual(trainerLines(rbText(h)), []);
    assert.equal(h.registry.module('rpg-battle').capture.kinds.trainer.enabled, false, 'the pack has trainers, none of them a template');
    ok(await h.sdk.command('creation.finish', { name: 'Astra', race: 'rpg-battle/human', talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: 'pack.fixture/c0', checkActor: null }));
    await h.say('A stranger.', ['~ here pack.fixture/haven', '+ trainer Old Reka | like: drills']);
    const mine = h.turn.problems().filter(item => /trainer/.test(item.line ?? ''));
    assert.equal(mine.length, 1);
    assert.equal(mine[0].code, 'UNKNOWN_KIND');
    assert.match(mine[0].message, /No module keeps "trainer"/);
    assert.deepEqual(h.q('training.openTemplates', {}), []);
});

test('pinned to a pack with a template: one trainer line, naming the templates, the same on every reply', async t => {
    const h = await pinned(t, openTrainerPack([drillsTemplate(), drillsTemplate({ slug: 'second', name: 'Second' })]));
    ok(await h.pin());
    const first = rbText(h);
    assert.deepEqual(trainerLines(first), ['+ trainer Name — what they teach | like: <template> [| teaches: <skill>, <skill>] (templates: drills, second). Code fixes the fee and the place.']);
    ok(await h.sdk.command('creation.finish', { name: 'Astra', race: 'rpg-battle/human', talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: 'pack.fixture/c0', checkActor: null }));
    await h.say('One.', ['~ time 7170', '~ here pack.fixture/haven']);
    await h.say('Two.', []);
    assert.equal(rbText(h), first, 'byte-identical reply to reply');
    assert.deepEqual(h.q('training.openTemplates', {}).map(entry => entry.id), [`pack.fixture/drills`, 'pack.fixture/second']);
});

test('the only difference a template makes to the static prompt is that one line', async t => {
    const without = await pinned(t, trainerPack());
    ok(await without.pin());
    const withOne = await pinned(t, openTrainerPack());
    ok(await withOne.pin());
    const plain = rbText(without);
    const lines = rbText(withOne).split('\n');
    const at = lines.findIndex(line => line.includes('+ trainer'));
    assert.ok(at > 0);
    assert.deepEqual([...lines.slice(0, at), ...lines.slice(at + 1)], plain.split('\n'));
});

test('the line lists at most sixteen templates, then "and N more"; no templates leaves the plain line', () => {
    const entries = count => templates(count).map(entry => ({ id: `pack.fixture/${entry.slug}` }));
    const upTo = n => Array.from({ length: n }, (_, k) => `lessons-${k + 1}`).join(', ');
    assert.equal(LISTED_TEMPLATES, 16);
    assert.equal(trainerGrammar([]), TRAINER_GRAMMAR);
    assert.equal(trainerGrammar(undefined), TRAINER_GRAMMAR);
    assert.match(trainerGrammar(entries(1)), /\(templates: lessons-1\)\./);
    assert.ok(trainerGrammar(entries(LISTED_TEMPLATES)).includes(`(templates: ${upTo(16)}). Code fixes`));
    assert.ok(trainerGrammar(entries(11)).includes(`(templates: ${upTo(11)}). Code fixes`), 'eleven are all named now');
    assert.ok(trainerGrammar(entries(19)).includes(`(templates: ${upTo(16)} and 3 more). Code fixes`));
    assert.equal(trainerGrammar(entries(19)).includes('\n'), false, 'one line');
});

test('a pack with nineteen templates: the real line names sixteen and "3 more", and every template still works by its slug', async t => {
    const h = await pinned(t, openTrainerPack(templates(19)));
    ok(await h.pin());
    const upTo = n => Array.from({ length: n }, (_, k) => `lessons-${k + 1}`).join(', ');
    assert.deepEqual(trainerLines(rbText(h)), [`+ trainer Name — what they teach | like: <template> [| teaches: <skill>, <skill>] (templates: ${upTo(16)} and 3 more). Code fixes the fee and the place.`]);
    assert.equal(h.q('training.openTemplates', {}).length, 19);
});

test('trainerKindOn: a template, or nothing; a query that cannot answer is no', () => {
    assert.equal(trainerKindOn(() => [{ id: 'pack.x/y' }]), true);
    assert.equal(trainerKindOn(() => []), false);
    assert.equal(trainerKindOn(() => null), false);
    assert.equal(trainerKindOn(() => { throw new Error('not pinned'); }), false);
});

test('module.js: the kind is declared once, with its when and grammarFor, and the unpinned bare module has no trainer kind', () => {
    const def = createModule();
    assert.equal(Object.hasOwn(def.capture.kinds, 'trainer'), false, 'the rules parts are not registered without a rules host');
    assert.equal(Object.hasOwn(def.commands, 'trainer.open'), false);
    assert.equal(Object.hasOwn(def.queries, 'training.openTemplates'), false);
});

test('the explicit activation path (a checked ruleset handed to createModule, no query callback): the kind is on exactly when the ruleset has a template', async t => {
    const { createHost } = await import('../../vendor/story-block/testkit/index.js');
    const { SD } = await import('../progress/helpers/world.js');
    const { openTrainersPin, trainersPin } = await import('../progress/helpers/fixture.js');
    const h = await createHost({ modules: [{ ...SD, version: '2.0.0' }] });
    t.after(() => h.close());
    const saved = globalThis.StoryBlock;
    delete globalThis.StoryBlock;
    t.after(() => { if (saved !== undefined) globalThis.StoryBlock = saved; });
    const preflight = h.sdk.preflight({ module: 'rpg-battle', rulesVersion: 2 });
    const kind = rules => createModule({ rules, preflight }).capture.kinds.trainer;
    const on = kind(openTrainersPin());
    assert.equal(on.enabled, true);
    assert.match(on.grammar, /\(templates: drills\)\./);
    assert.equal(kind(trainersPin()).enabled, false, 'a ruleset with trainers and no template');
});
