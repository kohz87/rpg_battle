// rules/pin.js: the ruleset pinned to the timeline, the stored shape this code reads, and xpPerLevel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRules, pinOf, pinRules, rulesProblems, xpPerLevelProblem, RULES_VERSION, ENGINE } from '../../../src/v2/rules/index.js';
import { RULES_V2_CONSTANTS, validateRulesPack } from '../../vendor/story-block/src/v2/packs/rules-v2.js';
import { fixturePin, smallRulesPack } from '../progress/helpers/fixture.js';

const pinned = (given = fixturePin()) => {
    const slice = initialRules();
    const problem = pinRules(slice, given);
    return { slice, problem };
};

test('a fresh rules slice is marked rules v2 with nothing pinned, and holds', () => {
    const slice = initialRules();
    assert.deepEqual(slice, { schema: 2, rulesVersion: RULES_VERSION, rulesHash: null, pin: null, flags: {}, generated: {} });
    assert.equal(RULES_VERSION, 2);
    assert.deepEqual(rulesProblems(slice), []);
    assert.equal(pinOf({ domains: { rules: slice } }), null);
});

test('pinning the golden ruleset keeps what the checker gave, immutably, once', () => {
    const { slice, problem } = pinned();
    assert.equal(problem, '');
    assert.deepEqual(rulesProblems(slice), []);
    assert.equal(slice.rulesHash, fixturePin().rulesHash);
    assert.equal(slice.pin.identity.engine, ENGINE);
    assert.equal(slice.pin.identity.schema, 2);
    assert.deepEqual(slice.pin.resolved.constants, fixturePin().resolved.constants);
    assert.equal(Object.keys(slice.pin.resolved.forms).length, 48);
    // The same ruleset again changes nothing; another one is refused (a running timeline keeps its rules).
    assert.equal(pinRules(slice, fixturePin()), '');
    const other = validateRulesPack(smallRulesPack(), { constants: { xpPerLevel: 200 } });
    assert.equal(other.ok, true);
    assert.match(pinRules(slice, { ...fixturePin(), resolved: other.resolved, rulesHash: other.rulesHash }), /keeps its rules/);
    assert.equal(slice.rulesHash, fixturePin().rulesHash);
    assert.equal(slice.pin.resolved.constants.xpPerLevel, 100);
    // pinOf reads it back with its hash.
    assert.equal(pinOf({ domains: { rules: slice } }).rulesHash, fixturePin().rulesHash);
});

test('a pin is a copy: changing what was given afterwards does not move the timeline', () => {
    const given = structuredClone(fixturePin());
    const { slice } = pinned(given);
    given.resolved.constants.xpPerLevel = 999;
    given.progression.maxMastery = 9;
    assert.equal(slice.pin.resolved.constants.xpPerLevel, 100);
    assert.equal(slice.pin.progression.maxMastery, 5);
});

test('a legacy chat (no rules slice, or an old party-only chat) has no pin', () => {
    assert.equal(pinOf(null), null);
    assert.equal(pinOf({}), null);
    assert.equal(pinOf({ domains: {} }), null);
    assert.equal(pinOf({ domains: { rules: { schema: 1 } } }), null);
});

test('xpPerLevel: 100 and 1010 hold; 1001, fractions, overflow and the rest are refused, as Story Block\'s checker refuses them', () => {
    const good = [10, 100, 1010, 5000, 10000];
    const bad = [1001, 15.5, 5, 0, -10, 10001, 10010, 1e21, 2 ** 53, Number.MAX_SAFE_INTEGER, '100', null, true, Infinity, NaN];
    for (const value of good) assert.equal(xpPerLevelProblem(value), '', `${value} is allowed`);
    for (const value of bad) assert.notEqual(xpPerLevelProblem(value), '', `${String(value)} is refused`);
    // The same verdict as the checker, value by value (a value JSON cannot carry is refused before it gets there).
    for (const value of [...good, ...bad.filter(v => typeof v === 'number' && Number.isFinite(v))]) {
        const checked = validateRulesPack(smallRulesPack(), { constants: { ...RULES_V2_CONSTANTS, xpPerLevel: value } });
        assert.equal(checked.ok, xpPerLevelProblem(value) === '', `${value}: the checker and the runtime agree`);
    }
});

test('xpPerLevel 100 and 1010 round-trip through the pin unchanged', () => {
    for (const value of [100, 1010]) {
        const checked = validateRulesPack(smallRulesPack(), { constants: { xpPerLevel: value } });
        assert.equal(checked.ok, true);
        const { slice, problem } = pinned({ ...fixturePin(), resolved: checked.resolved, rulesHash: checked.rulesHash });
        assert.equal(problem, '');
        assert.equal(slice.pin.resolved.constants.xpPerLevel, value);
    }
});

test('a pin with a constant the code relies on gone wrong is refused, not pinned', () => {
    const break_ = mutate => {
        const given = structuredClone(fixturePin());
        mutate(given);
        return pinned(given).problem;
    };
    assert.match(break_(g => { g.resolved.constants.xpPerLevel = 1001; }), /divisible by 10/);
    assert.match(break_(g => { g.resolved.constants.masteryAt = [1, 5, 12, 22]; }), /mastery steps/);
    assert.match(break_(g => { g.resolved.constants.masteryAt = [1, 5, 5, 22, 35]; }), /rising/);
    assert.match(break_(g => { g.resolved.constants.usePerSkillReply = 0; }), /usePerSkillReply/);
    assert.match(break_(g => { g.resolved.constants.promotionMilestones = [10, 20]; }), /one promotion milestone/);
    assert.match(break_(g => { g.resolved.constants.pathMilestones = [40, 50]; }), /one path milestone/);
    assert.match(break_(g => { g.resolved.manifest.classes[1].skills = g.resolved.manifest.classes[1].skills.slice(0, 2); }), /exactly 3/);
    assert.match(break_(g => { g.resolved.manifest.classes[1].parent = 'pack.fixture/nope'; }), /parent that is not pinned/);
    assert.match(break_(g => { delete g.resolved.forms['pack.fixture/s00-base']; }), /no base form/);
    assert.match(break_(g => { g.resolved.forms['pack.fixture/s00-base'].id = 'pack.fixture/other'; }), /not whole/);
    assert.match(break_(g => { g.packHash = 'nope'; }), /hash/);
    assert.match(break_(g => { g.progression.maxMastery = 4; }), /disagree/);
    assert.match(break_(g => { g.rulesHash = null; }), /rulesHash/);
});

test('a stored slice is held to the same shape', () => {
    const { slice } = pinned();
    assert.deepEqual(rulesProblems(slice), []);
    assert.notEqual(rulesProblems({ ...slice, rulesHash: null }).length, 0);
    assert.notEqual(rulesProblems({ ...slice, schema: 1 }).length, 0);
    assert.notEqual(rulesProblems({ ...initialRules(), rulesHash: 'a'.repeat(64) }).length, 0);
    assert.notEqual(rulesProblems(null).length, 0);
    assert.notEqual(rulesProblems({ ...slice, pin: { ...slice.pin, identity: { ...slice.pin.identity, engine: 'x' } } }).length, 0);
});

test('the rules, progress and training parts come together: all three ids in order, each domain with its owner, no query or command in two parts', async () => {
    const { rulesParts } = await import('../../../src/v2/rules/index.js');
    assert.deepEqual(rulesParts.map(([id]) => id), ['rules', 'progress', 'training']);
    const [[, rules], [, progress], [, training]] = rulesParts;
    assert.deepEqual(Object.keys(rules.domains), ['rules']);
    assert.deepEqual(Object.keys(progress.domains), ['progress']);
    assert.deepEqual(Object.keys(training.domains), ['training']);
    assert.ok(rules.commands['rules.settle'] && progress.commands['class.choose'] && progress.hooks.replayGuard && training.commands['skill.train']);
    assert.ok(training.queries['rules.training'] && rules.queries['rules.sheet'] && rules.queries['rules.flags']);
    // A name in two parts would be refused by the host when they are merged into the module.
    for (const kind of ['commands', 'queries', 'domains']) {
        const names = rulesParts.flatMap(([, part]) => Object.keys(part[kind] ?? {}));
        assert.equal(new Set(names).size, names.length, `a ${kind} name is in two parts`);
    }
    assert.throws(() => { rulesParts.push(['x', {}]); }, TypeError, 'the list is frozen');
});
