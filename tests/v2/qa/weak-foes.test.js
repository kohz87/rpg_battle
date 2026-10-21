// QA: the weak-foe path (the Ersveil test, QA #75: six weak cellar rat swarms beat a fresh level-1
// character on auto, two rats did not). v2's encounter → offer → setup path must give the foes
// v1 gives for the same words: the tier words as v1's threat words (trivial stays trivial),
// v1's levels and below-level-1 scales, v1's counts for swarms and packs, and the same
// projected creatures; and the prompt's example teaches single foes, as v1's did.
import assert from 'node:assert/strict';
import { DEFAULT_RULES, suggestRank } from '../../../src/rules.js';
import { parseEncounter, resolveThreats } from '../../../src/story.js';
import { DEFAULT_BESTIARY, findCreature } from '../../../src/enemies.js';
import { DEFAULT_SKILLS } from '../../../src/skills.js';
import { enemiesFromRows, engagements } from '../../../src/party.js';
import { makeRng } from '../../../src/rng.js';
import { readEncounter } from '../../../src/v2/combat/encounter.js';
import { part as combat } from '../../../src/v2/combat/index.js';
import { bestiaryList, unpackSetup } from '../../../src/v2/combat/stored.js';
import { combinedBestiary } from '../../../src/templates.js';
import { fightOut, withHero, each } from './helpers/harness.js';

const r = DEFAULT_RULES;

/** v1's rows for an <Encounter> text, as v1.js encounterParts + rankedRows make them for a level-1 character. */
function v1Rows(text, level = 1) {
    const rows = resolveThreats(parseEncounter(text, DEFAULT_BESTIARY, r), level, r);
    const fair = suggestRank(level, r);
    return rows.map(row => {
        const lv = Number(row.level) >= 1 ? Math.round(Number(row.level)) : null;
        const rank = lv ? null : row.rank || (findCreature(DEFAULT_BESTIARY, row.name) ? null : fair);
        return { ...row, level: lv, rank };
    });
}

/** v2's offer and fight for the same foes written as a change line with a tier label. */
function v2Fight(name, tier, seed) {
    const { h } = withHero({ seed });
    const offered = h.capture({ op: '!', kind: 'encounter', name, text: '', labels: { tier } });
    assert.equal(offered.ok, true, offered.message);
    const offer = h.query('combat.offers').at(-1);
    const start = h.command('combat.start', { offer: offer.id });
    assert.equal(start.ok, true, start.message);
    return { h, offer, setup: unpackSetup(h.state().domains.combat.session.setup) };
}

const numbers = enemy => ({ name: enemy.name, level: enemy.level, hp: enemy.hp, mp: enemy.mp, patk: enemy.patk, matk: enemy.matk, pdef: enemy.pdef, mdef: enemy.mdef, stats: enemy.stats, skills: enemy.skills.map(skill => skill.name), xpLevel: enemy.xpLevel ?? null });

for (const [words, tier] of [['6 Giant Rat', 'weak'], ['2 Giant Rat', 'weak'], ['3 Wolf', 'weak'], ['Giant Rat Swarm', 'weak'], ['a pack of wolves', 'weak'], ['3 Giant Rat', 'trivial'], ['2 Wolf', 'even']]) {
    each(`"${words}" (${tier}): v2's foes are v1's, number for number`, () => {
        const { h, offer, setup } = v2Fight(words, tier, 5);
        // A name no bestiary knows was made up for the fight and kept in the chat's (as v1 keeps it).
        const bestiary = combinedBestiary(bestiaryList(h.state().domains.bestiary), DEFAULT_BESTIARY);
        const v1 = v1Rows(`${words} (${tier})`);
        // The offer: v1's names, counts and threat word.
        assert.deepEqual(offer.foes.map(foe => [foe.name, foe.count, foe.tier]), v1.map(row => [row.name, row.count, row.threat]));
        // The fight: v1's projection of those rows with the fight's own seed.
        const expected = engagements(enemiesFromRows(v1, { bestiary, library: DEFAULT_SKILLS, rules: r, rng: makeRng(`${setup.seed}:enemies`) })).enemies;
        assert.deepEqual(setup.enemies.map(numbers), expected.map(numbers));
    });
}

each('trivial is v1\'s trivial (two steps down), not weak', () => {
    assert.equal(readEncounter({ op: '!', name: 'Giant Rat', labels: { tier: 'feeble' } }, { bestiary: DEFAULT_BESTIARY }).foes[0].tier, 'trivial');
    const trivial = v2Fight('Giant Rat', 'trivial', 2).setup.enemies[0];
    const weak = v2Fight('Giant Rat', 'weak', 2).setup.enemies[0];
    assert.ok(trivial.hp.max < weak.hp.max, `${trivial.hp.max} < ${weak.hp.max}`);
    assert.equal(trivial.xpLevel, resolveThreats([{ name: 'Giant Rat', count: 1, threat: 'trivial' }], 1, r)[0].xpLevel);
});

each('the encounter example in the prompt is single foes, as v1\'s "3 wolf (weak)"', () => {
    const grammar = combat.kinds.encounter.grammar;
    const name = grammar.replace(/^! encounter\s+/, '').split(/\s+—\s+/)[0];
    const rows = parseEncounter(name, DEFAULT_BESTIARY, r);
    assert.deepEqual(rows.map(row => [row.name, row.count]), [['Wolf', 3]]);
    assert.doesNotMatch(grammar, /swarm/i);
    assert.match(grammar, /tier: trivial\|weak\|even\|strong\|deadly/);
});

each('a fresh level-1 fighter on auto beats weak foes the bestiary knows, every seed (as in v1)', () => {
    for (const words of ['6 Giant Rat', '3 Wolf', 'Giant Rat Swarm']) {
        for (let seed = 1; seed <= 8; seed++) {
            const { h } = v2Fight(words, 'weak', seed);
            if (h.query('combat.session').status === 'active') assert.equal(h.command('combat.act', { action: { type: 'auto' } }).ok, true);
            fightOut(h);
            assert.equal(h.state().domains.combat.session.status, 'won', `${words}, seed ${seed}`);
        }
    }
});
