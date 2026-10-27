// The open-quest line of the prompt names the pack's open quest templates, so `| like:` can be written (the trainer line does the same for
// trainer templates): at most sixteen, then "and N more", and only for a pin whose pack has one. Every other pin keeps the line it always had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRulesPack } from '../../vendor/story-block/src/v2/packs/rules-v2.js';
import { questTail } from '../../../src/v2/quests/prompt.js';
import { LISTED_TEMPLATES, templateList } from '../../../src/v2/lines.js';
import { trainerGrammar } from '../../../src/v2/training/capture.js';

const OLD = 'Open quest: + quest Name | like: <open template slug> | text: <objective text> [| foe: <canonical ref>] [| place: <canonical ref>] [| item: <canonical ref>]. Code fixes rewards. Variant fight: ! encounter Variant name | like: <pack foe slug>.';
const withQuests = quests => ({ state: { domains: { rules: { rulesHash: 'a'.repeat(64), pin: { resolved: { quests } } } } } });
const open = slug => ({ id: `pack.x/${slug}`, slug, name: slug.toUpperCase(), open: true });
const closed = slug => ({ id: `pack.x/${slug}`, slug, name: slug, open: false });
const line = view => questTail(view).lines[0];

test('no pin: no open quest line at all', () => {
    assert.deepEqual(questTail({ state: { domains: {} } }).lines, []);
    assert.deepEqual(questTail({}).lines, []);
});

test('a pin whose pack has no open quest template keeps the line byte for byte', () => {
    for (const quests of [undefined, [], {}, [closed('hunt'), closed('fetch')], { a: closed('hunt') }]) assert.equal(line(withQuests(quests)), OLD, JSON.stringify(quests));
    assert.equal(line({ state: { domains: { rules: { rulesHash: 'a'.repeat(64) } } } }), OLD, 'a pin without its resolved ruleset in the view');
});

test('open quest templates are named after the placeholder, in the pack\'s order, closed ones left out', () => {
    const view = withQuests([closed('hunt'), open('open-hunt-c'), open('open-delivery-c')]);
    assert.equal(line(view), OLD.replace('<open template slug>', '<open template slug> (templates: open-hunt-c, open-delivery-c)'));
    const keyed = withQuests({ one: open('first'), two: closed('x'), three: open('second') });
    assert.match(line(keyed), /like: <open template slug> \(templates: first, second\) \| text:/);
});

test('at most sixteen are named, then "and N more", exactly as the trainer line does', () => {
    const slugs = Array.from({ length: 19 }, (_, n) => `t${n + 1}`);
    const upTo = n => slugs.slice(0, n).join(', ');
    assert.equal(LISTED_TEMPLATES, 16);
    assert.ok(line(withQuests(slugs.map(open))).includes(`(templates: ${upTo(16)} and 3 more) | text:`));
    assert.ok(line(withQuests(slugs.slice(0, 16).map(open))).includes(`(templates: ${upTo(16)}) | text:`));
    assert.ok(line(withQuests(slugs.slice(0, 12).map(open))).includes(`(templates: ${upTo(12)}) | text:`), 'twelve are all named');
    assert.equal(templateList(slugs), `templates: ${upTo(16)} and 3 more`);
    assert.equal(templateList([]), '');
    assert.equal(trainerGrammar(slugs.map(slug => ({ id: `pack.x/${slug}` }))).includes(`(${templateList(slugs)})`), true, 'the two lines read alike');
    assert.equal(line(withQuests(slugs.map(open))).includes('\n'), false, 'one line');
});

test('Ersveil: Bluewatch Starter 1.5.0 (the pack the fight tests keep) has 12 open quest templates: every slug is named, with no "more"', () => {
    const pack = JSON.parse(readFileSync(new URL('../fight/fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8'));
    const checked = validateRulesPack(pack);
    assert.equal(checked.ok, true);
    const view = { state: { domains: { rules: { rulesHash: checked.rulesHash, pin: { resolved: checked.resolved } } } } };
    assert.equal(line(view), 'Open quest: + quest Name | like: <open template slug> (templates: open-delivery-c, open-delivery-d, open-delivery-e, open-delivery-f, open-hunt-c, open-hunt-d, open-hunt-e, open-hunt-f, open-story-task-c, open-story-task-d, open-story-task-e, open-story-task-f) | text: <objective text> [| foe: <canonical ref>] [| place: <canonical ref>] [| item: <canonical ref>]. Code fixes rewards. Variant fight: ! encounter Variant name | like: <pack foe slug>.');
});
