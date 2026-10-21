// creation.finish and creation.rollTalent (MODULES §F12, §F14, §F22; SPEC §13.6) against a small
// stand-in of Story Block's bus with the real party part: the budget, the race and talent
// bonuses, the stat cap, the talent limit, the no-content flow, the persona's name and
// background, nothing saved on any refusal, and the rolled talent kept through preview/commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHost, pcOf, points } from './helpers/fake-host.js';
import { BUILT_IN_TALENTS, buildCharacter, contentQuery, creationContent, creationRules } from '../../../src/v2/creation/index.js';

const elf = { name: 'Ren', race: 'elf', talents: ['keen-eyes'], points: points({ STR: 4, DEX: 5 }) };

/** Runs a command that must be refused and checks nothing changed. */
function refused(host, type, payload, code, pattern) {
    const before = JSON.stringify(host.state);
    const out = host.command(type, payload);
    assert.equal(out.ok, false, `${type} should be refused`);
    assert.equal(out.code, code, out.message);
    if (pattern) assert.match(out.message, pattern);
    assert.equal(JSON.stringify(host.state), before, 'nothing is saved on a refusal');
    return out;
}

test('finish: race and talent bonuses go on after the points; party.create gets the origin', () => {
    const host = makeHost();
    const out = host.command('creation.finish', { ...elf, background: 'A ferryman\'s daughter.', portrait: '/thumbnail?type=persona&file=ren.png' });
    assert.equal(out.ok, true, out.message);
    const pc = pcOf(host.state);
    // start 5 + points, then Elf (+2 DEX, +1 INT, −1 VIT) and Keen Eyes (+1 DEX)
    assert.deepEqual(pc.stats, { STR: 9, VIT: 4, AGI: 5, DEX: 13, INT: 6, LUK: 5, CHA: 5 });
    assert.deepEqual(pc.origin, { race: { id: 'elf', name: 'Elf' }, talents: [{ id: 'keen-eyes', name: 'Keen Eyes' }] });
    assert.equal(pc.name, 'Ren');
    assert.equal(pc.background, 'A ferryman\'s daughter.');
    assert.equal(pc.portrait, '/thumbnail?type=persona&file=ren.png');
    assert.equal(pc.hp.cur, pc.hp.max);
    assert.equal(out.receipt.summary, 'Ren (Elf; Keen Eyes) is ready.');
    assert.deepEqual(out.receipt.data.stats, pc.stats);
});

test('finish: the budget is v1 startPoints, talents paid from it first, spent exactly', () => {
    const host = makeHost();
    refused(host, 'creation.finish', { ...elf, points: points({ STR: 5, DEX: 5 }) }, 'REFUSED', /10 points spent on stats, 9 points to spend after the talents \(1\)/);
    refused(host, 'creation.finish', { ...elf, points: points({ STR: 4, DEX: 4 }) }, 'REFUSED', /Spend every point: 1 point left/);
    refused(host, 'creation.finish', { ...elf, points: { STR: 4, DEX: 5, MAG: 1 } }, 'INVALID', /"MAG" is not a stat/);
    refused(host, 'creation.finish', { ...elf, points: { STR: 4.5, DEX: 5 } }, 'INVALID', /whole number/);
    refused(host, 'creation.finish', { ...elf, points: { STR: -1, DEX: 10 } }, 'INVALID');
    refused(host, 'creation.finish', { ...elf, points: [1, 2] }, 'INVALID');
    // The reader's own startPoints (the party part's Character setting).
    const rich = makeHost({ settings: { startPoints: 12 } });
    assert.equal(rich.command('creation.finish', { ...elf, points: points({ STR: 6, DEX: 5 }) }).ok, true);
});

test('finish: two-point talents cost two points', () => {
    const host = makeHost();
    const out = host.command('creation.finish', { name: 'Ada', race: 'human', talents: ['silver-tongue', 'lucky-star'], points: points({ VIT: 6 }) });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(pcOf(host.state).stats, { STR: 6, VIT: 11, AGI: 5, DEX: 5, INT: 5, LUK: 7, CHA: 8 });
});

test('finish: no stat ends above the stat cap or below 0', () => {
    const capped = makeHost({ settings: { statCap: 10 } });
    // 5 + 5 = 10 is the cap; the Elf's +2 DEX would take it to 12.
    refused(capped, 'creation.finish', { name: 'Ren', race: 'elf', points: points({ DEX: 5, STR: 5 }) }, 'REFUSED', /DEX would be 12; no stat can go higher than 10/);
    assert.equal(capped.command('creation.finish', { name: 'Ren', race: 'elf', points: points({ DEX: 3, STR: 5, AGI: 2 }) }).ok, true);
    const packs = { races: [{ id: 'pack.x/brittle', slug: 'brittle', pack: 'x', name: 'Brittle', stats: { VIT: -6 } }], talents: [] };
    const host = makeHost({ packs });
    refused(host, 'creation.finish', { name: 'Ren', race: 'pack.x/brittle', points: points({ STR: 10 }) }, 'REFUSED', /VIT would be -1; no stat can go below 0/);
});

test('finish: talents at most maxTalents, once each, from the choices', () => {
    const host = makeHost();
    refused(host, 'creation.finish', { ...elf, talents: ['keen-eyes', 'iron-gut', 'bookish'], points: points({ STR: 7 }) }, 'REFUSED', /2 talents at most/);
    refused(host, 'creation.finish', { ...elf, talents: ['keen-eyes', 'keen-eyes'], points: points({ STR: 8 }) }, 'INVALID', /only once/);
    refused(host, 'creation.finish', { ...elf, talents: ['flying'] }, 'NOT_FOUND', /"flying" is not one of the talents/);
    refused(host, 'creation.finish', { ...elf, talents: 'keen-eyes,iron-gut' }, 'NOT_FOUND');
    refused(host, 'creation.finish', { ...elf, talents: [3] }, 'INVALID');
    const none = makeHost({ settings: { maxTalents: 0 } });
    refused(none, 'creation.finish', elf, 'REFUSED', /Talents are switched off/);
    const three = makeHost({ settings: { maxTalents: 3 } });
    assert.equal(three.command('creation.finish', { ...elf, talents: ['keen-eyes', 'iron-gut', 'bookish'], points: points({ STR: 7 }) }).ok, true);
});

test('finish: a race is required when there are races, and must be one of them', () => {
    const host = makeHost();
    refused(host, 'creation.finish', { ...elf, race: '' }, 'INVALID', /Choose a race/);
    refused(host, 'creation.finish', { ...elf, race: 'dragon' }, 'NOT_FOUND', /not one of the choices/);
    refused(host, 'creation.finish', { ...elf, race: 7 }, 'INVALID');
});

test('finish: the name is the persona\'s; portrait and background are checked', () => {
    const host = makeHost();
    refused(host, 'creation.finish', { ...elf, name: '  ' }, 'INVALID', /Persona Management/);
    refused(host, 'creation.finish', { ...elf, name: 'x'.repeat(41) }, 'INVALID', /40 characters/);
    refused(host, 'creation.finish', { ...elf, portrait: 'javascript:alert(1)' }, 'INVALID', /portrait/);
    refused(host, 'creation.finish', { ...elf, portrait: 'http://example.com/a.png' }, 'INVALID');
    refused(host, 'creation.finish', { ...elf, portrait: '//evil.example/a.png' }, 'INVALID');
    refused(host, 'creation.finish', { ...elf, background: { text: 'x' } }, 'INVALID', /background must be text/);
    const long = host.command('creation.finish', { ...elf, background: 'b'.repeat(2500), portrait: 'https://img.example/ren.png' });
    assert.equal(long.ok, true, long.message);
    assert.equal(pcOf(host.state).background.length, 2000);
});

test('finish: refused once there is a character, and by party.create\'s own rules', () => {
    const host = makeHost();
    assert.equal(host.command('creation.finish', elf).ok, true);
    refused(host, 'creation.finish', { ...elf, name: 'Ada' }, 'REFUSED', /already have a character/);
    refused(host, 'creation.rollTalent', {}, 'REFUSED', /already have a character/);
});

test('no races or talents anywhere: a name and points, through the party part as it is', () => {
    const host = makeHost({ settings: { builtInChoices: false }, party: 'real' });
    const content = host.query('creation.content', { settings: { builtInChoices: false } });
    assert.equal(content.hasRaces, false);
    assert.equal(content.hasTalents, false);
    refused(host, 'creation.finish', { ...elf }, 'NOT_FOUND', /no races/);
    refused(host, 'creation.finish', { name: 'Ren', talents: ['keen-eyes'], points: points({ STR: 10 }) }, 'NOT_FOUND', /no talents/);
    refused(host, 'creation.rollTalent', {}, 'NOT_FOUND', /no talents to roll/);
    const out = host.command('creation.finish', { name: 'Ren', points: points({ STR: 4, DEX: 6 }) });
    assert.equal(out.ok, true, out.message);
    const pc = pcOf(host.state);
    assert.deepEqual(pc.stats, { STR: 9, VIT: 5, AGI: 5, DEX: 11, INT: 5, LUK: 5, CHA: 5 });
    assert.equal(pc.origin, undefined);
    assert.equal(out.receipt.summary, 'Ren is ready.');
});

test('a party.create that ignores the origin or background is caught, not saved', () => {
    const host = makeHost({ party: 'plain' });
    refused(host, 'creation.finish', { ...elf, talents: [], points: points({ STR: 5, DEX: 5 }) }, 'FAILED', /race and talents: VIT came out 5, not 4/);
    const bare = makeHost({ settings: { builtInChoices: false }, party: 'plain' });
    refused(bare, 'creation.finish', { name: 'Ren', background: 'From the hills.', points: points({ STR: 10 }) }, 'FAILED', /background/);
});

test('packs replace the built-in choices kind by kind', () => {
    const packs = {
        races: [{ id: 'pack.river/otterkin', slug: 'otterkin', pack: 'river', name: 'Otterkin', note: 'River folk.', stats: { AGI: 2, HP: 9 }, tags: ['river'] }],
    };
    const host = makeHost({ packs });
    const content = host.query('creation.content', {});
    assert.deepEqual(content.races.map(race => race.id), ['pack.river/otterkin']);
    assert.deepEqual(content.races[0].stats, { AGI: 2 }, 'stats other than the seven are left out');
    assert.equal(content.races[0].source, 'packs');
    assert.equal(content.talents.length, BUILT_IN_TALENTS.length, 'no pack talents: the built-in ones');
    refused(host, 'creation.finish', elf, 'NOT_FOUND');
    assert.equal(host.command('creation.finish', { ...elf, race: 'pack.river/otterkin' }).ok, true);
    assert.equal(pcOf(host.state).stats.AGI, 7);
});

test('creation.build: the live budget and preview the wizard shows', () => {
    const host = makeHost();
    const start = host.query('creation.build', { draft: { race: 'dwarf', talents: ['bookish'], points: points({ STR: 2 }) } });
    assert.equal(start.ok, false);
    assert.equal(start.left, 7);
    assert.equal(start.cost, 1);
    assert.deepEqual(start.axes.map(axis => axis.value), [7, 7, 4, 5, 7, 5, 5]);
    assert.ok(start.axes.every(axis => axis.before === 5));
    const done = host.query('creation.build', { race: 'dwarf', talents: ['bookish'], points: points({ STR: 9 }), settings: { startPoints: 10 } });
    assert.equal(done.ok, true);
    assert.equal(done.left, 0);
    // The settings ride in the args (queries are not given them).
    assert.equal(host.query('creation.build', { draft: {}, settings: { startPoints: 14 } }).left, 14);
});

test('rollTalent: the receipt seed decides; preview stores nothing; commit keeps that talent', () => {
    const host = makeHost();
    const draft = { race: 'elf', talents: ['keen-eyes'], points: points({ STR: 3 }) };
    const first = host.preview('creation.rollTalent', draft, { seed: 42 });
    const again = host.preview('creation.rollTalent', draft, { seed: 42 });
    assert.equal(first.ok, true, first.message);
    assert.equal(first.receipt.data.talent, again.receipt.data.talent, 'same seed, same talent');
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(seed => host.preview('creation.rollTalent', draft, { seed }).receipt.data.talent));
    assert.ok(seen.size > 1, 'other seeds roll other talents');
    assert.ok(!seen.has('keen-eyes'), 'a talent already taken is never rolled');
    assert.deepEqual(host.state.domains.creation.rolled, [], 'a preview saves nothing');

    const kept = host.commit(first.token);
    assert.equal(kept.ok, true);
    assert.equal(kept.receipt.data.talent, first.receipt.data.talent, 'the roll shown is the roll kept');
    assert.deepEqual(host.state.domains.creation.rolled, [first.receipt.data.talent]);
    assert.match(kept.receipt.summary, /^Rolled talent: .+ \(\d points?/);
    assert.equal(host.commit(first.token).code, 'NOT_FOUND', 'a token commits once');

    // The rolled talent is part of the character: it counts for the limit and the budget.
    const talent = host.query('creation.content', {}).rolled[0];
    const content = host.query('creation.content', {});
    assert.equal(content.talents.find(entry => entry.id === talent.id).rolled, true);
    const spend = 10 - 1 - talent.cost;
    refused(host, 'creation.finish', { ...elf, talents: ['keen-eyes', 'iron-gut'], points: points({ STR: spend - 1 }) }, 'REFUSED', /2 talents at most/);
    const out = host.command('creation.finish', { ...elf, points: points({ STR: spend }) });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(pcOf(host.state).origin.talents.map(entry => entry.id), [talent.id, 'keen-eyes']);
    assert.deepEqual(host.state.domains.creation.rolled, [], 'finish clears the rolls');
});

test('rollTalent: a preview goes stale when the head moves; refusals change nothing', () => {
    const host = makeHost();
    const preview = host.preview('creation.rollTalent', {}, { seed: 3 });
    assert.equal(host.command('creation.rollTalent', {}, { seed: 4 }).ok, true);
    assert.equal(host.commit(preview.token).code, 'STALE');
    // One rolled: one more fits the limit of 2, then no more.
    assert.equal(host.command('creation.rollTalent', {}, { seed: 5 }).ok, true);
    refused(host, 'creation.rollTalent', {}, 'REFUSED', /already have 2 talents/);

    const broke = makeHost();
    refused(broke, 'creation.rollTalent', { points: points({ STR: 10 }) }, 'REFUSED', /No points are left/);
    // 1 point left after a two-point pick and 7 on stats: only one-point talents can come up.
    const tight = makeHost({ settings: { maxTalents: 3 } });
    for (let seed = 1; seed <= 12; seed++) {
        const roll = tight.preview('creation.rollTalent', { talents: ['lucky-star'], points: points({ STR: 7 }) }, { seed });
        assert.equal(roll.receipt.data.cost, 1);
    }
    refused(tight, 'creation.rollTalent', { talents: ['nope'] }, 'NOT_FOUND');
    refused(tight, 'creation.rollTalent', { points: { XYZ: 1 } }, 'INVALID');
});

test('the creation domain\'s validator', async () => {
    const { validateCreation, initialCreation } = await import('../../../src/v2/creation/index.js');
    assert.deepEqual(validateCreation(initialCreation()), []);
    assert.deepEqual(validateCreation({ rolled: ['keen-eyes', 'pack.x/y'] }), []);
    assert.equal(validateCreation(null).length, 1);
    assert.match(validateCreation({ rolled: ['a', 'a'] }).join(' '), /twice/);
    assert.match(validateCreation({ rolled: [1] }).join(' '), /talent ids/);
    assert.match(validateCreation({ rolled: [], extra: 1 }).join(' '), /not a field/);
    assert.match(validateCreation({ rolled: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).join(' '), /more than 6/);
});

test('buildCharacter never throws on junk and reports the first problem', () => {
    const content = creationContent(null);
    const rules = creationRules(null);
    for (const junk of [null, 42, 'x', [], { points: 'lots' }, { talents: {} }]) {
        const out = buildCharacter(junk, content, rules);
        assert.equal(out.ok, false);
        assert.equal(typeof out.message, 'string');
    }
});

test('settings: a part\'s own keys bare, or the module\'s namespaced ones (src/v2/module.js)', () => {
    assert.deepEqual(creationRules({ startPoints: 12, statCap: 20, maxTalents: 3, builtInChoices: false }), { startPoints: 12, statCap: 20, startStat: 5, maxTalents: 3, builtInChoices: false });
    assert.deepEqual(creationRules({ 'party.startPoints': 14, 'party.statCap': 0, 'creation.maxTalents': 1 }), { startPoints: 14, statCap: 0, startStat: 5, maxTalents: 1, builtInChoices: true });
    assert.deepEqual(creationRules(() => ({ startPoints: 999 })).startPoints, 60, 'kept in v1\'s range');
    const host = makeHost();
    assert.equal(host.query('creation.content', { settings: { 'party.startPoints': 8 } }).rules.startPoints, 8);
    // module.js hands a query its part's settings as tools.settings.
    const tools = { query: () => [], settings: { maxTalents: 4 } };
    assert.equal(contentQuery(host.state, {}, tools).rules.maxTalents, 4);
});
