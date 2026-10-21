// B4-10: the balance claim of RB-A (qa/weak-foes.test.js: "a fresh level-1 fighter on auto beats
// weak foes the bestiary knows, every seed (as in v1)") measured with other seeds and the other
// presets. v2 does match v1 (both engines lose alike), but "weak" is not weak: six weak Giant Rats
// beat a fresh caster, healer, archer or skirmisher 73–90% of the time, and the fighter loses on
// some seeds. Numbers: <SP>/break/b4-combat/sim/balance-200.jsonl (200 seeds, 1000–1199).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withHero } from '../qa/helpers/harness.js';

function fight(words, tier, preset, seed) {
    const { h } = withHero({ seed, preset });
    const offered = h.capture({ op: '!', kind: 'encounter', name: words, text: '', labels: { tier } });
    assert.equal(offered.ok, true, offered.message);
    const offer = h.query('combat.offers').at(-1);
    assert.equal(h.command('combat.start', { offer: offer.id }).ok, true);
    for (let n = 0; n < 400 && h.query('combat.session').status === 'active'; n += 1) h.command('combat.act', { action: { type: 'auto' } });
    return h.query('combat.session').status;
}

test('B4-10a: the fighter beats six weak Giant Rats on every seed (the claim of qa/weak-foes), seed 258 included', () => {
    assert.equal(fight('6 Giant Rat', 'weak', 'fighter', 258), 'won');
});

test('B4-10b: every preset beats six weak Giant Rats at least 9 times in 10 (weak means weak for all builds)', () => {
    for (const preset of ['caster', 'healer', 'archer', 'skirmisher']) {
        let won = 0;
        for (let seed = 1000; seed < 1040; seed += 1) if (fight('6 Giant Rat', 'weak', preset, seed) === 'won') won += 1;
        assert.ok(won >= 36, `${preset}: ${won}/40 won against six weak Giant Rats`);
    }
});
