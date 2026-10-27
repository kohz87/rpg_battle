// The messy-line corpus of GENERATIVE_OFFERS_SPEC §11.4 (fixtures/offer-corpus.json): 50 lines on Bluewatch 1.6.0, the PC at level 3, the world at
// tier 0, each with the outcome the matchers must settle. Pure: no host. The six deliberate probes (far out, no template teaches it, a duplicate) must
// come out as expected too; of the other 44, at least 95 % must become valid offers with exactly the expected outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchOffer } from '../../../src/v2/quests/offer-match.js';
import { matchTrainer } from '../../../src/v2/training/offer.js';
import { farLineOf } from '../../../src/v2/quests/offer-bands.js';
import { COPPER, CROWNS, env, lineOf } from './helpers/offer-env.js';

const corpus = JSON.parse(readFileSync(new URL('./fixtures/offer-corpus.json', import.meta.url), 'utf8'));
const slug = ref => String(ref).split('/')[1];

/** What the matchers settled for an entry, in the terms the corpus writes. */
function run(entry, currencyName = entry.currency, expect = entry.expect) {
    const currency = currencyName === 'crowns' ? CROWNS : COPPER;
    const en = env({ level: entry.level, currency, threads: entry.threads ?? [] });
    const line = lineOf(entry.line);
    const got = /^\+ trainer/.test(entry.line) ? matchTrainer(en, line) : matchOffer(en, line);
    const miss = [];
    const check = (what, actual, wanted) => { if (JSON.stringify(actual) !== JSON.stringify(wanted)) miss.push(`${what}: ${JSON.stringify(actual)} !== ${JSON.stringify(wanted)}`); };
    check('kind', got.kind, expect.kind);
    if (got.kind !== expect.kind) return { got, miss };
    if (expect.band !== undefined) check('band', got.band, expect.band);
    if (expect.why !== undefined) check('why', got.why, expect.why);
    if (expect.message !== undefined) check('message', got.message, expect.message);
    if (expect.line !== undefined) check('line', farLineOf(got, currency), expect.line);
    const s = got.settled;
    if (expect.slug !== undefined) check('template', slug(s?.template ?? got.binding?.template), expect.slug);
    if (s) {
        if (expect.rank !== undefined) check('rank', s.rank, expect.rank);
        if (Object.hasOwn(expect, 'count')) check('count', s.count ?? null, expect.count);
        if (expect.coin !== undefined) check('coin', s.coin, expect.coin);
        if (expect.xp !== undefined) check('xp', s.xp, expect.xp);
        if (expect.foe !== undefined) check('foe', s.foe?.name ?? null, expect.foe);
        if (expect.base !== undefined) check('base', slug(s.foe?.base ?? ''), expect.base);
        if (expect.item !== undefined) check('item', s.item?.name ?? null, expect.item);
        if (expect.goal !== undefined) check('goal', s.text, expect.goal);
        if (expect.giver !== undefined) check('giver', s.giver, expect.giver);
        if (expect.waived !== undefined) check('waived', s.waived, expect.waived);
        if (expect.tier !== undefined) check('tier', s.area.tier, expect.tier);
    }
    if (Object.hasOwn(expect, 'fee')) check('fee', got.fee?.value ?? null, expect.fee);
    if (expect.skills !== undefined) check('skills', got.binding?.skills?.length ?? 0, expect.skills);
    for (const note of expect.notes ?? []) if (!(got.notes ?? []).some(have => have.includes(note))) miss.push(`note "${note}" not in ${JSON.stringify(got.notes)}`);
    return { got, miss };
}

test('the corpus is 50 lines, six of them probes', () => {
    assert.equal(corpus.length, 50);
    assert.deepEqual(corpus.filter(entry => entry.probe).map(entry => entry.id), ['C22', 'G9', 'G16', 'G17', 'G12', 'G13']);
    assert.equal(new Set(corpus.map(entry => entry.id)).size, 50);
});

test('every probe comes out as expected: far out, no template teaches it, a duplicate', () => {
    for (const entry of corpus.filter(row => row.probe)) {
        const { miss } = run(entry);
        assert.deepEqual(miss, [], entry.id);
    }
});

test('of the 44 lines that are not probes at least 95 % become valid offers with the expected outcome (prototype: 44 of 44)', () => {
    const rows = corpus.filter(entry => !entry.probe);
    assert.equal(rows.length, 44);
    const misses = [];
    for (const entry of rows) {
        const { miss } = run(entry);
        if (miss.length) misses.push(`${entry.id} ${entry.line}\n    ${miss.join('\n    ')}`);
        if (entry.alt) {
            const again = run(entry, entry.alt.currency, entry.alt.expect);
            if (again.miss.length) misses.push(`${entry.id} (${entry.alt.currency}) ${entry.line}\n    ${again.miss.join('\n    ')}`);
        }
    }
    const rate = (rows.length - misses.length) / rows.length;
    assert.ok(rate >= 0.95, `${(rate * 100).toFixed(1)} % of the lines settle as expected; misses:\n${misses.join('\n')}`);
    // The prototype settled all of them, and so do we: a miss is worth reading even above the target.
    assert.deepEqual(misses, []);
});

test('of all 50 lines, 88 % or more settle as offers or as the expected probe outcome', () => {
    const done = corpus.filter(entry => run(entry).miss.length === 0).length;
    assert.ok(done / corpus.length >= 0.88, `${done} of ${corpus.length}`);
});

test('the matchers do not touch what they are given and answer the same twice', () => {
    for (const entry of corpus) {
        const en = env({ level: entry.level, threads: entry.threads ?? [] });
        const line = lineOf(entry.line);
        const before = JSON.stringify([line, en.pin, en.area, en.inputs, en.words]);
        const trainer = /^\+ trainer/.test(entry.line);
        const a = JSON.stringify(trainer ? matchTrainer(en, line) : matchOffer(en, line));
        const b = JSON.stringify(trainer ? matchTrainer(en, line) : matchOffer(en, line));
        assert.equal(a, b, entry.id);
        assert.equal(JSON.stringify([line, en.pin, en.area, en.inputs, en.words]), before, entry.id);
    }
});
