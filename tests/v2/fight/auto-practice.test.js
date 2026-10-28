// An Auto fight on a pinned chat earns the skills it plays (rules v2): each form a party member can use and has not mastered is played at least once per fight,
// so its use is credited when the fight ends. Before, Auto cast an attack form only when its score was over 1, and a form of power 100 or less at mastery 0
// (Shield Bash of Bluewatch's militiaman) never was: nothing was played, so nothing was earned. A fight with no pinned ruleset is the fight it always was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRules } from '../../../src/rules.js';
import { act, startFight } from '../../../src/combat.js';
import { formSkill } from '../../../src/v2/fight/forms.js';
import '../../../src/v2/fight/interpret.js';
import { foe, hero } from './golden.js';
import { seeded } from '../integration/helpers/host.js';
import { bluewatch, ok } from '../quests/helpers/bluewatch.js';
import { realWorld } from '../progress/helpers/world.js';

const BRACE = 'pack.ersveil-bluewatch/brace-spear-base';
const BASH = 'pack.ersveil-bluewatch/shield-bash-base';
const GRIT = 'pack.ersveil-bluewatch/watchmans-grit-base';

/** Plays a fight with `line` on Auto to its end and settles it; → the session view and the attempts by form. */
async function autoFight(h, line = '! encounter 3 Cellar Rat Swarm | tier: weak', text = 'Rats.') {
    await h.say(text, [line]);
    ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
    for (let n = 0; n < 80 && h.q('combat.session')?.status === 'active'; n += 1) {
        const session = h.q('combat.session');
        ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: session.id, board: session.board }));
    }
    const session = h.q('combat.session');
    ok(await h.sdk.command('combat.end', { session: session.id }));
    return { session, uses: usesByForm(h) };
}
const usesByForm = h => {
    const out = {};
    for (const attempt of Object.values(h.head().domains.progress.attempts)) out[attempt.form] = (out[attempt.form] ?? 0) + 1;
    return out;
};

test('an Auto fight records a use of every form the character can pay for and has not mastered, not only the one the AI scores above 1', async t => {
    await seeded(9101, async () => {
        const h = await bluewatch(t);
        const { session, uses } = await autoFight(h);
        assert.equal(session.status, 'won');
        assert.ok(uses[BRACE] >= 1 && uses[BASH] >= 1 && uses[GRIT] >= 1, JSON.stringify(uses));
        assert.deepEqual(h.store.problems(), []);
    });
});

test('a form is played once as practice, and the rest of the fight is the AI\'s: the form it scores highest goes on being played', async t => {
    await seeded(9102, async () => {
        const h = await bluewatch(t);
        const { uses } = await autoFight(h);
        assert.equal(uses[BASH], 1);
        assert.equal(uses[GRIT], 1);
        assert.ok(uses[BRACE] > 1, JSON.stringify(uses));
    });
});

test('on the pure engine: a form that is mastered is not forced, one that is not is played once, and a heal waits until someone is hurt', () => {
    const exact = makeRules({ attack: { hitMin: 100, hitMax: 100, varianceLow: 1, varianceHigh: 1, critBase: 0, critPerDex: 0, critPerLuk: 0 }, initiative: { die: 1 } });
    const damage = (slug, power) => ({ id: `pack.t/${slug}-base`, skill: `pack.t/${slug}`, name: slug, type: 'physical', stat: 'STR', cost: { mp: 0, sp: 1, cooldown: 0 }, effects: [{ op: 'damage', target: 'one', power, element: 'none', damageType: 'physical' }] });
    const mend = { id: 'pack.t/mend-base', skill: 'pack.t/mend', name: 'mend', type: 'heal', stat: 'INT', cost: { mp: 2, sp: 0, cooldown: 0 }, effects: [{ op: 'heal', target: 'self', power: 50, element: 'none' }] };
    const run = (forms, over = {}, hp = 400, rule = 'practice') => {
        let f = startFight({ id: 'fx', seed: 'seed-x', ...(rule ? { autoRule: rule } : {}), party: [hero({ skills: forms.map(([form, mastery]) => formSkill(form, mastery)), ...over })], enemies: [foe('e1', { hp: { cur: hp, max: hp } })], rules: exact });
        for (let n = 0; n < 12 && f.status === 'active'; n += 1) f = act(f, { type: 'auto', id: `ca_${String(n + 1).padStart(8, '0')}` }, exact);
        return f.stats.uses.pc ?? {};
    };
    const weak = damage('weak', 50);
    const other = damage('other', 50);
    assert.deepEqual(run([[weak, 5], [other, 0]]), { 'pack.t/other-base': 1 }, 'the mastered form is not forced; the other is played once, though its score is under 1');
    assert.deepEqual(run([[weak, 0], [other, 0]], {}, 400, null), {}, 'a fight begun without the rule (stored before it) plays as it did: forms of little power are never played');
    assert.deepEqual(run([[weak, 5], [other, 5]]), {}, 'two mastered forms of little power: nothing is forced (Auto attacks, as it did)');
    assert.deepEqual(run([[mend, 0]], {}, 5), {}, 'a heal with nobody hurt would do nothing: it is not played');
    assert.deepEqual(run([[mend, 0]], { hp: { cur: 100, max: 160 } }, 5), { 'pack.t/mend-base': 1 }, 'with someone hurt it is played, once');
});

test('legacy: a fight with no pinned ruleset (v1 skills) is played exactly as before', async t => {
    await seeded(9103, async () => {
        const w = await realWorld(t, { pin: false });
        await w.say('The wolves come.', ['~ time 3000', '! encounter 3 Wolf — hungry | tier: even']);
        const [offer] = w.q('combat.offers', {});
        assert.equal(w.ui('combat.start', { offer: offer.id }).ok, true);
        for (let n = 0; n < 40 && w.q('combat.session', {}).status === 'active'; n += 1) {
            const v = w.q('combat.session', {});
            assert.equal(w.ui('combat.act', { action: { type: 'auto' }, session: v.id, board: v.board }).ok, true);
        }
        // The engine's golden traces (tests/v2/fight/golden.json, engine-unchanged.test.js) hold the rest; here: no form is played where there are none.
        assert.ok(w.q('combat.session', {}).log.every(entry => !/ (uses|casts) s\d\d/.test(entry.text)));
    });
});
