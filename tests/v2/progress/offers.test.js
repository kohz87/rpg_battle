// progress/offers.js and derive.js: what is offered and what is allowed (fixtures C01-C05, the contract's
// ProgressView fixtures, the selected-parent rule). Pure over a pinned golden ruleset and built progress slices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { progressView, evaluateClass, evaluatePath, standing } from '../../../src/v2/progress/offers.js';
import { deriveActor, choicesOf, skillViews } from '../../../src/v2/progress/derive.js';
import { ACTOR, basic, golden, promo, promoted, ref, slice, step } from './helpers/states.js';

const ix = golden();
const mastered = (...forms) => Object.fromEntries(forms.map(form => [form, 35]));
const view = (progress, level) => progressView(ix, progress, ACTOR, level);

test('C01 fresh: the basic class gives a level-1 character exactly three skills at 0/5', () => {
    const progress = slice({ choices: [basic(ACTOR, 'c0')] });
    const out = view(progress, 1);
    assert.equal(out.level, 1);
    assert.equal(out.class, ref('c0'));
    assert.equal(out.tier, 0);
    assert.equal(out.checklist.length, 3);
    assert.deepEqual(out.checklist, ['s00', 's01', 's02'].map(s => ({ skill: ref(s), form: ref(`${s}-base`), mastery: 0, needed: 5 })));
    assert.deepEqual(out.promotions, []);
    assert.deepEqual(out.pathways, []);
    const skills = standing(ix, progress, ACTOR).skills;
    assert.equal(skills.length, 3);
    for (const skill of skills) assert.deepEqual([skill.mastery, skill.uses, skill.nextAt, skill.steps], [0, 0, 1, 0]);
});

test('no basic class yet, no view', () => {
    assert.equal(view(slice(), 5), null);
    assert.equal(view(slice({ choices: [basic('ac_00000009', 'c0')] }), 5), null);
});

test('C02 promotion: level 10 with 5/5, 5/5, 4/5 blocks; the last credit enables the child; the swap is three skills at once', () => {
    const base = ['s00-base', 's01-base', 's02-base'];
    const blocked = view(slice({ choices: [basic(ACTOR, 'c0')], uses: { 's00-base': 35, 's01-base': 35, 's02-base': 22 } }), 10);
    assert.deepEqual(blocked.checklist.map(item => item.mastery), [5, 5, 4]);
    assert.equal(blocked.promotions.length, 1);
    assert.equal(blocked.promotions[0].milestone, 10);
    assert.equal(blocked.promotions[0].eligible, false);
    assert.deepEqual(blocked.promotions[0].choices, [ref('c1')]);
    assert.deepEqual(blocked.promotions[0].why, ['s02 is 4/5.']);
    const open = view(slice({ choices: [basic(ACTOR, 'c0')], uses: mastered(...base) }), 10);
    assert.deepEqual(open.promotions, [{ milestone: 10, eligible: true, choices: [ref('c1')], why: [] }]);
    // Level 9 lists nothing: the milestone is not reached.
    assert.deepEqual(view(slice({ choices: [basic(ACTOR, 'c0')], uses: mastered(...base) }), 9).promotions, []);

    const progress = slice({ choices: [basic(ACTOR, 'c0'), promo(ACTOR, 10, 'c0', 'c1')], uses: mastered(...base) });
    const after = view(progress, 10);
    assert.equal(after.class, ref('c1'));
    assert.equal(after.tier, 1);
    assert.deepEqual(after.checklist, ['s10', 's11', 's12'].map(s => ({ skill: ref(s), form: ref(`${s}-base`), mastery: 0, needed: 5 })), 'all three swapped at once, nothing inherited: 0/5');
    assert.deepEqual(after.promotions, [], 'promotion 10 is taken; 20 is not reached');
    // The old skills keep their uses on the ledger (caps, history) but are no longer held.
    assert.equal(standing(ix, progress, ACTOR).skills.length, 3);
});

test('C03 max mastery: all 5/5 shows the top step and nothing more to reach', () => {
    const progress = slice({ choices: [basic(ACTOR, 'c0')], uses: mastered('s00-base', 's01-base', 's02-base') });
    for (const skill of standing(ix, progress, ACTOR).skills) {
        assert.deepEqual([skill.mastery, skill.uses, skill.nextAt], [5, 35, null]);
        assert.deepEqual(skill.formMastery, { [skill.form]: { uses: 35, mastery: 5 } });
    }
});

test('a skill view reads like the contract\'s SkillView, and keeps the history of the forms it has had', () => {
    const progress = slice({ choices: [...promoted(), step(ACTOR, 40, 's30', 's30-base', 's30-base-a', 1)], uses: { ...mastered('s31-base', 's32-base'), 's30-base': 35, 's30-base-a': 6 } });
    const [first] = standing(ix, progress, ACTOR).skills;
    assert.equal(first.skill, ref('s30'));
    assert.equal(first.form, ref('s30-base-a'));
    assert.equal(first.name, 's30-base-a');
    assert.deepEqual([first.mastery, first.uses, first.nextAt, first.steps], [2, 6, 12, 1]);
    assert.deepEqual(first.formMastery, { [ref('s30-base')]: { uses: 35, mastery: 5 }, [ref('s30-base-a')]: { uses: 6, mastery: 2 } });
});

test('C04 waiting: level 90 on a basic class offers only promotion 10, then the others wait in order, then six paths, nothing picked', () => {
    const progress = slice({ choices: [basic(ACTOR, 'c0')], uses: mastered('s00-base', 's01-base', 's02-base') });
    const out = view(progress, 90);
    assert.equal(out.level, 90);
    assert.deepEqual(out.promotions.map(p => [p.milestone, p.eligible]), [[10, true], [20, false], [30, false]]);
    assert.deepEqual(out.promotions[0].choices, [ref('c1')]);
    assert.deepEqual(out.promotions[1].choices, [], 'a later promotion names no class until the earlier one is taken');
    assert.match(out.promotions[1].why[0], /10 promotion comes first/);
    assert.match(out.promotions[2].why[0], /10 promotion comes first/);
    assert.deepEqual(out.pathways.map(p => [p.milestone, p.eligible]), [40, 50, 60, 70, 80, 90].map(m => [m, false]));
    for (const path of out.pathways) {
        assert.deepEqual(path.skills, []);
        assert.ok(path.why.length > 0);
    }
    assert.match(out.pathways[0].why[0], /10 promotion comes first/);
    // Nothing was chosen: the choices are what they were.
    assert.deepEqual(Object.keys(progress.choices), [`${ACTOR}|0`]);
});

test('C04: after the promotions, the paths are still waiting until the advanced class is held and a skill is 5/5', () => {
    const progress = slice({ choices: promoted(), uses: mastered('s30-base', 's31-base') });
    const out = view(progress, 90);
    assert.deepEqual(out.promotions, []);
    assert.equal(out.pathways[0].milestone, 40);
    assert.equal(out.pathways[0].eligible, true, 'two of three skills are 5/5: a step may be taken on one of them');
    assert.equal(out.pathways.length, 6);
    assert.deepEqual(out.pathways.slice(1).map(p => p.eligible), [false, false, false, false, false]);
    const none = view(slice({ choices: promoted() }), 90);
    assert.equal(none.pathways[0].eligible, false);
    assert.deepEqual(none.pathways[0].why, ['s30 is 0/5.', 's31 is 0/5.', 's32 is 0/5.']);
});

test('a class with no further class shows why', () => {
    const progress = slice({ choices: promoted(), uses: mastered('s30-base') });
    assert.equal(view(progress, 30).promotions.length, 0);
    const odd = slice({ choices: [basic(ACTOR, 'c0')] });
    assert.deepEqual(view(odd, 10).promotions[0].why, ['s00 is 0/5.', 's01 is 0/5.', 's02 is 0/5.']);
});

test('C05 selected parent: the step-1 form chosen at 40 gives its own g/a/b at 50; the other skills still start at the base', () => {
    const forms = ['s30-base-a', 's31-base', 's32-base'];
    const progress = slice({ choices: [...promoted(), step(ACTOR, 40, 's30', 's30-base', 's30-base-a', 1)], uses: mastered(...forms) });
    const out = view(progress, 50);
    assert.deepEqual(out, {
        actor: ACTOR, level: 50, class: ref('c3'), tier: 3, promotions: [],
        checklist: [0, 1, 2].map(n => ({ skill: ref(`s3${n}`), form: ref(`s3${n}-base${n === 0 ? '-a' : ''}`), mastery: 5, needed: 5 })),
        pathways: [{
            milestone: 50, eligible: true, why: [],
            skills: [0, 1, 2].map(n => {
                const f = `s3${n}-base${n === 0 ? '-a' : ''}`;
                return { skill: ref(`s3${n}`), fromForm: ref(f), step: n === 0 ? 2 : 1, options: ['g', 'a', 'b'].map(c => ref(`${f}-${c}`)) };
            }),
        }],
    });
});

test('C05: the choice at 50 is legal from the form the skill holds, from no other, and a skill takes at most two steps', () => {
    const base = [...promoted(), step(ACTOR, 40, 's30', 's30-base', 's30-base-a', 1)];
    const progress = slice({ choices: base, uses: mastered('s30-base-a', 's31-base', 's32-base') });
    const st = standing(ix, progress, ACTOR);
    const ask = (over = {}) => evaluatePath(ix, st, { milestone: 50, skill: ref('s30'), fromForm: ref('s30-base-a'), option: ref('s30-base-a-g'), ...over }, 50);
    assert.equal(ask().ok, true);
    assert.equal(ask().step, 2);
    assert.deepEqual(ask({ option: ref('s30-base-a-a') }).ok, true);
    assert.deepEqual(ask({ option: ref('s30-base-a-b') }).ok, true);
    // The first step's parent is no longer the form the skill holds: stale.
    assert.deepEqual([ask({ fromForm: ref('s30-base'), option: ref('s30-base-g') }).ok, ask({ fromForm: ref('s30-base'), option: ref('s30-base-g') }).code], [false, 'STALE']);
    // The sibling's children are not this form's.
    assert.equal(ask({ option: ref('s30-base-b-g') }).code, 'REFUSED');
    assert.equal(ask({ option: ref('s30-base-g') }).code, 'REFUSED');
    // Another skill starts at its base.
    const other = evaluatePath(ix, st, { milestone: 50, skill: ref('s31'), fromForm: ref('s31-base'), option: ref('s31-base-b') }, 50);
    assert.deepEqual([other.ok, other.step], [true, 1]);
    assert.equal(evaluatePath(ix, st, { milestone: 50, skill: ref('s31'), fromForm: ref('s31-base-a'), option: ref('s31-base-a-a') }, 50).code, 'STALE');
    assert.equal(evaluatePath(ix, st, { milestone: 50, skill: ref('s00'), fromForm: ref('s00-base'), option: ref('s00-base-g') }, 50).code, 'REFUSED', 'not one of the three skills');
});

test('a step-2 form takes no third step; six steps fill the three skills exactly', () => {
    const choices = [...promoted(),
        step(ACTOR, 40, 's30', 's30-base', 's30-base-a', 1), step(ACTOR, 50, 's30', 's30-base-a', 's30-base-a-g', 2),
        step(ACTOR, 60, 's31', 's31-base', 's31-base-g', 1), step(ACTOR, 70, 's31', 's31-base-g', 's31-base-g-b', 2),
        step(ACTOR, 80, 's32', 's32-base', 's32-base-b', 1)];
    const progress = slice({ choices, uses: mastered('s30-base-a-g', 's31-base-g-b', 's32-base-b') });
    const out = view(progress, 90);
    assert.deepEqual(out.pathways.map(p => p.milestone), [90]);
    assert.deepEqual(out.pathways[0].skills.map(item => [item.skill, item.step]), [[ref('s32'), 2]], 'only the skill with a step left');
    const st = standing(ix, progress, ACTOR);
    assert.equal(evaluatePath(ix, st, { milestone: 90, skill: ref('s30'), fromForm: ref('s30-base-a-g'), option: ref('s30-base-a-g-g') }, 90).code, 'REFUSED');
    const done = slice({ choices: [...choices, step(ACTOR, 90, 's32', 's32-base-b', 's32-base-b-a', 2)], uses: mastered('s30-base-a-g', 's31-base-g-b', 's32-base-b-a') });
    assert.deepEqual(view(done, 99).pathways, []);
    assert.deepEqual(standing(ix, done, ACTOR).skills.map(s => s.steps), [2, 2, 2]);
});

test('a missing parent step invalidates the choice built on it (the selected-parent rule in the derived record)', () => {
    const without40 = [...promoted(), step(ACTOR, 50, 's30', 's30-base-a', 's30-base-a-g', 2)];
    const derived = deriveActor(ix, choicesOf(slice({ choices: without40 }), ACTOR));
    assert.deepEqual(derived.broken, [50]);
    assert.deepEqual(derived.skills.map(s => [s.skill, s.form, s.steps]), [0, 1, 2].map(n => [ref(`s3${n}`), ref(`s3${n}-base`), 0]), 'the skill is still on its base form');
    assert.equal(derived.taken.has(50), false);
    const full = deriveActor(ix, choicesOf(slice({ choices: [...without40, step(ACTOR, 40, 's30', 's30-base', 's30-base-a', 1)] }), ACTOR));
    assert.deepEqual(full.broken, []);
    assert.equal(full.skills[0].form, ref('s30-base-a-g'));
});

test('the oldest milestone first: a later one is refused while an earlier one is open', () => {
    const progress = slice({ choices: [basic(ACTOR, 'c0')], uses: mastered('s00-base', 's01-base', 's02-base') });
    const st = standing(ix, progress, ACTOR);
    assert.equal(st.open, 10);
    assert.equal(evaluateClass(ix, st, { milestone: 20, class: ref('c2'), expectedClass: ref('c0') }, 90).code, 'REFUSED');
    assert.match(evaluateClass(ix, st, { milestone: 20, class: ref('c2'), expectedClass: ref('c0') }, 90).why, /10 promotion comes first/);
    assert.equal(evaluatePath(ix, st, { milestone: 40, skill: ref('s00'), fromForm: ref('s00-base'), option: ref('s00-base-g') }, 90).code, 'REFUSED');
    assert.equal(evaluateClass(ix, st, { milestone: 10, class: ref('c1'), expectedClass: ref('c0') }, 90).ok, true);
});

test('evaluateClass: level, direct child, stale class, mastery, taken milestone, odd milestone', () => {
    const progress = slice({ choices: [basic(ACTOR, 'c0')], uses: { ...mastered('s00-base', 's01-base'), 's02-base': 12 } });
    const st = standing(ix, progress, ACTOR);
    const ask = (over = {}, level = 10) => evaluateClass(ix, st, { milestone: 10, class: ref('c1'), expectedClass: ref('c0'), ...over }, level);
    assert.match(ask({}).why, /Every skill must be 5\/5: s02 is 3\/5/);
    const ready = standing(ix, slice({ choices: [basic(ACTOR, 'c0')], uses: mastered('s00-base', 's01-base', 's02-base') }), ACTOR);
    const go = (over = {}, level = 10) => evaluateClass(ix, ready, { milestone: 10, class: ref('c1'), expectedClass: ref('c0'), ...over }, level);
    assert.equal(go().ok, true);
    assert.deepEqual(go().skills, [ref('s10'), ref('s11'), ref('s12')]);
    assert.deepEqual(go({}, 9), { ok: false, code: 'REFUSED', why: 'Level 10 is needed (this character is level 9).' });
    assert.equal(go({ class: ref('c2') }).code, 'REFUSED', 'only a direct child');
    assert.equal(go({ class: ref('c3') }).code, 'REFUSED');
    assert.equal(go({ class: ref('c0') }).code, 'REFUSED');
    assert.equal(go({ expectedClass: ref('c1') }).code, 'STALE');
    assert.equal(go({ milestone: 15 }).code, 'INVALID');
    assert.equal(go({ milestone: 40 }).code, 'INVALID', 'a path level is not a promotion');
    const taken = standing(ix, slice({ choices: [basic(ACTOR, 'c0'), promo(ACTOR, 10, 'c0', 'c1')] }), ACTOR);
    assert.equal(evaluateClass(ix, taken, { milestone: 10, class: ref('c1'), expectedClass: ref('c1') }, 10).code, 'REFUSED');
    assert.equal(evaluateClass(ix, standing(ix, slice(), ACTOR), { milestone: 10, class: ref('c1'), expectedClass: ref('c0') }, 10).code, 'NOT_FOUND');
});

test('the facts a guard hashes name what the choice depended on and not the raw level or uses', () => {
    const progress = slice({ choices: [basic(ACTOR, 'c0')], uses: mastered('s00-base', 's01-base', 's02-base') });
    const st = standing(ix, progress, ACTOR);
    const a = evaluateClass(ix, st, { milestone: 10, class: ref('c1'), expectedClass: ref('c0') }, 10);
    const b = evaluateClass(ix, st, { milestone: 10, class: ref('c1'), expectedClass: ref('c0') }, 57);
    assert.deepEqual(a.facts, b.facts);
    assert.deepEqual(Object.keys(a.facts).sort(), ['first', 'held', 'levelReached', 'mastered', 'previous', 'tier']);
    const more = standing(ix, slice({ choices: [basic(ACTOR, 'c0')], uses: { ...mastered('s00-base', 's01-base', 's02-base'), 's00-base-x': 0 } }), ACTOR);
    assert.deepEqual(evaluateClass(ix, more, { milestone: 10, class: ref('c1'), expectedClass: ref('c0') }, 10).facts, a.facts);
});
