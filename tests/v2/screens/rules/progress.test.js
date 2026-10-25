// Track C fixtures C01-C06 (and the progress side of C14): the Progress page and the basic-class step, drawn with Story
// Block's template renderer over the contract's projections. Each case asserts the view query's output, the commands the
// buttons send (exact payloads) and what is drawn. No query answers by the old code: see helpers.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { progressScreen } from '../../../../src/v2/screens/rules/screens.js';
import { progressView } from '../../../../src/v2/screens/rules/progress.js';
import { CLASS_STEP_ID, CLASS_STEP_TEMPLATE, classPickerView } from '../../../../src/v2/screens/rules/class-step.js';
import { renderClassPick } from '../../../../src/v2/screens/rules/widgets.js';
import { clockLabel, failureLine } from '../../../../src/v2/screens/rules/format.js';
import { installDom } from '../helpers/dom.js';
import {
    C01, MIDNIGHT, MISSING, NAMES, PC, CONTRACTS, QF, SHIPPED_QUERIES, answers, c02, c03, c04, c05, c06, companionOf, partyOf, progressOf, ref, sheetOf, skillView, skillsOf, trainOffer, trainingOf, LYRA, H,
} from './fixtures.js';
import { all, drawOver, names, pressing, refusals, settle, skip, text, toolsOf, viewOf, widgetsIn } from './helpers.js';

const drawn = (table, options) => drawOver(progressScreen, table, options);
const skillsShown = el => all(el, '.skill');
const choiceOf = (el) => widgetsIn(el, 'rpg-battle.permanent-choice');
const pressOption = async (widget, id) => {
    widget.querySelector(`.rpg-pc-option[data-choice="${id}"]`).dispatch('click');
    await settle();
};
const confirmOf = widget => widget.querySelector('.rpg-pc-confirm');

// ---- C01 fresh ------------------------------------------------------------------------------------------------------

test('C01 fresh: before a character, the basic classes are listed (tier 0 only, three skills each) and nothing is chosen for you', { skip }, () => {
    const log = [];
    const view = viewOf(progressView, C01.none(), {}, undefined, log);
    assert.equal(view.state, 'no-character');
    assert.deepEqual(view.members, []);
    assert.deepEqual(view.picker.classes.map(item => item.id), [ref('c0'), ref('c0x')], 'only the basic classes');
    assert.equal(view.picker.classes[0].label, 'Wayfarer');
    assert.equal(view.picker.classes[0].sub.split(' · ').length, 3, 'its three skills');
    assert.deepEqual(log.find(entry => entry.name === 'rules.classes').args, { tier: 0 });

    const { drawn: d } = drawn(C01.none());
    assert.deepEqual(d.warnings, []);
    assert.equal(all(d.el, '.class-tile').length, 2);
    assert.equal(widgetsIn(d.el, 'rpg-battle.create-character').length, 1, 'the wizard opens from the button');
    assert.equal(all(d.el, '.member').length, 0);
    assert.deepEqual(d.commands, [], 'drawing sends nothing');
});

test('C01 fresh: the class step writes the draft only when pressed, and creation.finish carries the class', { skip }, () => {
    const view = viewOf(classPickerView, answers());
    assert.equal(view.classes.state, 'ready');
    assert.deepEqual(view.classes.pick.options.map(item => item.id), [ref('c0'), ref('c0x')]);
    assert.equal(view.classes.pick.field, 'class');
    assert.deepEqual(view.checks.pick.options.map(item => item.id), ['ca_00000001', 'ca_00000002']);
    assert.equal(view.checks.fallback, 'If you choose none, Astra (the default) is used.');
    assert.equal(viewOf(classPickerView, answers({ 'checks.policy': MISSING })).checks.state, 'unavailable');

    // The step as the wizard would draw it: nothing pressed at the start.
    const step = { id: CLASS_STEP_ID, title: 'Class', mounts: ['dialog'], data: { c: { query: 'rpg-battle.classPicker' } }, template: CLASS_STEP_TEMPLATE, css: '' };
    const { drawn: d } = drawOver(step, answers(), { draft: { class: '', checkActor: '' } });
    assert.deepEqual(d.warnings, []);
    assert.deepEqual(all(d.el, '.rpg-cp-card').map(card => card.getAttribute('data-choice')), [ref('c0'), ref('c0x'), 'ca_00000001', 'ca_00000002']);
    assert.equal(all(d.el, '.rpg-cp-card').filter(card => card.getAttribute('aria-pressed') === 'true').length, 0, 'no auto-pick');

    // Pressing writes the draft field and nothing else.
    const doc = installDom();
    const host = doc.createElement('div');
    doc.body.append(host);
    const writes = [];
    renderClassPick(host, { value: view.classes.pick, picked: '' }, { draft: { set: (path, value) => writes.push([path, value]) } });
    host.querySelector(`.rpg-cp-card[data-choice="${ref('c0')}"]`).dispatch('click');
    host.querySelector(`.rpg-cp-card[data-choice="${ref('c0')}"]`).dispatch('click');
    assert.deepEqual(writes, [['class', ref('c0')], ['class', '']], 'pressing again clears it');
    // The wizard sends the draft as the finish payload (a required class; the check actor only when chosen).
    assert.deepEqual({ name: 'Astra', class: writes[0][1] }, C01.finishPayload);
    assert.deepEqual(Object.keys(C01.finishWithCheckActor).sort(), ['checkActor', 'class', 'name']);
});

test('C01 fresh: the created character is level 1 with exactly three skills at 0 / 5', { skip }, () => {
    const table = C01.created();
    const view = viewOf(progressView, table);
    assert.equal(view.state, 'ready');
    const [astra] = view.members;
    assert.equal(astra.level, 1);
    assert.equal(astra.skills.length, 3);
    assert.deepEqual(astra.skills.map(item => item.text), ['0 / 5', '0 / 5', '0 / 5']);
    assert.deepEqual(astra.skills.map(item => item.mastered), [false, false, false]);

    const { drawn: d } = drawn(table);
    assert.deepEqual(d.warnings, []);
    assert.equal(skillsShown(d.el).length, 3, 'exactly three skills are visible');
    assert.deepEqual(all(d.el, '.skill-name').map(text), ['Wayfarer Strike', 'Wayfarer Guard', 'Wayfarer Feint']);
    const bars = d.widgets.filter(item => item.name === 'ss.bar');
    assert.deepEqual(bars.map(item => [item.props.value, item.props.max, item.props.text]), [['0', '5', '0 / 5'], ['0', '5', '0 / 5'], ['0', '5', '0 / 5']]);
    assert.equal(widgetsIn(d.el, 'rpg-battle.create-character').length, 0);
});

test('C01: a character with two or four skills is a rules mismatch, never a short or long list', { skip }, () => {
    for (const skills of [skillsOf(0).slice(0, 2), [...skillsOf(0), skillView('s03', 's03-base')]]) {
        const sheet = sheetOf({ skills });
        const table = answers({ 'rules.party': partyOf({ active: [sheet] }) });
        assert.equal(viewOf(progressView, table).state, 'mismatch');
        const { drawn: d } = drawn(table);
        assert.equal(skillsShown(d.el).length, 0);
        assert.match(text(all(d.el, '.state')[0]), /exactly three skills/);
    }
});

// ---- C02 promotion --------------------------------------------------------------------------------------------------

test('C02 promotion: level 10 with 5/5, 5/5, 4/5 is blocked and says why; no choice is offered', { skip }, () => {
    const { answers: table } = c02({ uses: [35, 35, 22] });
    const view = viewOf(progressView, table);
    const [astra] = view.members;
    assert.deepEqual(astra.skills.map(item => item.text), ['5 / 5', '5 / 5', '4 / 5']);
    assert.equal(astra.checklistText, '2 of 3 forms at 5 / 5');
    assert.equal(view.party[0].text, '2 of 3 forms at 5 / 5');
    assert.equal(view.party[0].complete, false);
    assert.equal(astra.promotions[0].eligible, false);
    assert.equal(astra.promotions[0].open, false);
    assert.equal(astra.promotions[0].pick, null);

    const { drawn: d } = drawn(table);
    assert.equal(choiceOf(d.el).length, 0);
    assert.match(text(all(d.el, '.promotions .why')[0]), /Needs all three forms at 5 \/ 5 \(2 of 3\)/);
    assert.equal(all(d.el, '.promotions .ss-pill').map(text).join(','), 'Waiting');
    assert.deepEqual(d.commands, []);
});

test('C02 promotion: the last credit opens the child; choosing sends exactly class.choose and swaps all three skills', { skip }, async () => {
    const fixture = c02({ uses: [35, 35, 35] });
    const view = viewOf(progressView, fixture.answers);
    const pick = view.members[0].promotions[0].pick;
    assert.equal(pick.command, 'class.choose');
    assert.deepEqual(pick.options, [{ id: ref('c1'), label: 'Duelist', sub: 'Duelist Strike · Duelist Guard · Duelist Feint' }]);
    assert.deepEqual(pick.base, { actor: PC, milestone: 10, expectedClass: ref('c0'), rulesHash: H });

    const { drawn: d } = drawn(fixture.answers, { result: () => fixture.receipt });
    const [widget] = choiceOf(d.el);
    assert.ok(widget, 'the permanent choice is drawn');
    assert.equal(confirmOf(widget).disabled, true, 'Confirm waits for the reader');
    assert.equal(widget.querySelectorAll('.rpg-pc-option').filter(node => node.getAttribute('aria-pressed') === 'true').length, 0, 'nothing is preselected');
    assert.match(text(widget.querySelector('.rpg-pc-warning')), /cannot be undone/);
    await pressOption(widget, ref('c1'));
    assert.equal(confirmOf(widget).disabled, false);
    assert.deepEqual(d.commands, [], 'choosing is not confirming');
    confirmOf(widget).dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [{ type: fixture.command[0], payload: fixture.command[1] }]);
    assert.deepEqual(d.commands[0], { type: 'class.choose', payload: QF.C02.command[1] }, 'the contract fixture\'s own payload');
    assert.match(text(widget.querySelector('.rpg-pc-status')), /Promoted to Duelist\. All three skills were swapped; each starts at 0 \/ 5\./);
});

test('C02 promotion: after the swap exactly three skills of the new class show at 0 / 5, none of the old class', { skip }, () => {
    const fixture = c02({ afterSwap: true });
    assert.deepEqual(fixture.receipt.receipt.data.v2.result.skills.length, 3, 'the receipt names three');
    const view = viewOf(progressView, fixture.answers);
    const [astra] = view.members;
    assert.equal(astra.className, 'Duelist');
    assert.equal(astra.tierLabel, 'Tier 1');
    assert.equal(astra.skills.length, 3);
    assert.deepEqual(astra.skills.map(item => item.skill), [ref('s10'), ref('s11'), ref('s12')]);
    assert.deepEqual(astra.skills.map(item => item.text), ['0 / 5', '0 / 5', '0 / 5']);
    assert.ok(astra.skills.every(item => !item.skill.includes('s0')));
    const { drawn: d } = drawn(fixture.answers);
    assert.equal(skillsShown(d.el).length, 3);
    assert.equal(choiceOf(d.el).length, 0, 'the next promotions wait for their levels');
    assert.equal(all(d.el, '.promotions .step').length, 2);
});

// ---- C03 max mastery -----------------------------------------------------------------------------------------------

test('C03 max mastery: all 5/5 reads Mastered; a further use awards zero but XP still moves', { skip }, () => {
    assert.deepEqual(QF.C03.attempt, { expectedAward: 0, reason: 'mastered' });
    const before = c03({ xp: 0 });
    const after = c03({ xp: 25 });
    const a = viewOf(progressView, before.answers).members[0];
    const b = viewOf(progressView, after.answers).members[0];
    assert.deepEqual(a.skills.map(item => item.text), ['5 / 5', '5 / 5', '5 / 5']);
    assert.deepEqual(b.skills.map(item => item.text), a.skills.map(item => item.text), 'mastery does not move');
    assert.deepEqual(b.skills.map(item => item.nextText), ['Mastered', 'Mastered', 'Mastered']);
    assert.equal(a.allMastered, true);
    assert.notEqual(b.xpText, a.xpText, 'XP does');
    assert.equal(b.xpText, 'XP 25. 75 to the next level.');
    assert.ok(a.training.lines.includes('No mastery gained: already mastered. XP still counts.'));
    assert.ok(a.training.lines.includes('Credits: 0 of 2.'));
    const { drawn: d } = drawn(before.answers);
    assert.match(text(all(d.el, '.mastered-note')[0]), /More uses add no mastery; XP still counts\./);
});

// ---- C04 waiting ---------------------------------------------------------------------------------------------------

test('C04 waiting: level 90 on a basic class offers promotion 10 only, then the others and six paths wait, with no auto-picks', { skip }, () => {
    const fixture = c04();
    const [astra] = viewOf(progressView, fixture.answers).members;
    assert.deepEqual(astra.promotions.map(item => [item.milestone, item.eligible, item.open]), [[10, true, true], [20, false, false], [30, false, false]]);
    assert.deepEqual(astra.pathways.map(item => [item.milestone, item.waiting, item.skills.length]), [40, 50, 60, 70, 80, 90].map(m => [m, true, 0]));

    const { drawn: d } = drawn(fixture.answers);
    assert.deepEqual(all(d.el, '.promotions .step-head b').map(text), ['Promotion at level 10', 'Promotion at level 20', 'Promotion at level 30']);
    assert.deepEqual(all(d.el, '.pathways .step-head b').map(text), [40, 50, 60, 70, 80, 90].map(m => `Path step at level ${m}`));
    assert.equal(all(d.el, '.pathways .ss-pill-outline').length, 6, 'six waiting paths');
    assert.equal(all(d.el, '.promotions .ss-pill-outline').length, 2);
    assert.equal(choiceOf(d.el).length, 1, 'only promotion 10 can be chosen');
    assert.equal(all(d.el, '[aria-pressed="true"]').length, 0, 'nothing is picked for the reader');
    assert.deepEqual(d.commands, [], 'and nothing is sent');
    assert.match(text(all(d.el, '.pathways .why')[0]), /Needs an advanced class first\./);
    assert.equal(astra.xpText, 'XP 0. Top level.');
});

// ---- C05 selected parent --------------------------------------------------------------------------------------------

test('C05 selected parent: step 2 opens from the written step-1 form with its own [generated, A, B]; the others are at step 1', { skip }, async () => {
    const fixture = c05();
    const view = viewOf(progressView, fixture.answers);
    const [row] = view.members[0].pathways;
    assert.deepEqual(row.skills.map(item => item.step), [2, 1, 1]);
    assert.equal(row.skills[0].fromForm, ref('s30-base-a'));
    assert.deepEqual(row.skills[0].pick.options.map(item => [item.label, item.id]), [
        ['Generated', ref('s30-base-a-g')], ['Path A', ref('s30-base-a-a')], ['Path B', ref('s30-base-a-b')]]);
    assert.deepEqual(row.skills[1].pick.options.map(item => item.id), ['g', 'a', 'b'].map(c => ref(`s31-base-${c}`)));
    assert.deepEqual(view.members[0].skills.map(item => item.stepText), ['Path step 1 of 2', '', '']);

    const { drawn: d } = drawn(fixture.answers);
    assert.deepEqual(all(d.el, '.path-head small').map(text).map(line => line.replace(/\s+/g, ' ')), [
        `Step 2 of 2, from ${NAMES[ref('s30-base-a')]}`, `Step 1 of 2, from ${NAMES[ref('s31-base')]}`, `Step 1 of 2, from ${NAMES[ref('s32-base')]}`]);
    const [first] = choiceOf(d.el);
    await pressOption(first, ref('s30-base-a-g'));
    confirmOf(first).dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [{ type: 'path.choose', payload: fixture.command[1] }]);
    assert.deepEqual(fixture.command[0], 'path.choose');
});

test('C05 selected parent: a missing parent invalidates the choice, and a stale send is refused in plain words with nothing chosen in its place', { skip }, async () => {
    const gone = c05({ missingParent: true });
    const [row] = viewOf(progressView, gone.answers).members[0].pathways;
    assert.equal(row.eligible, false);
    assert.deepEqual(row.skills, []);
    const { drawn: d } = drawn(gone.answers);
    assert.equal(choiceOf(d.el).length, 0);
    assert.match(text(all(d.el, '.pathways .why')[0]), /step 1 choice for this skill was removed.*Nothing was chosen in its place/);

    // A page drawn before the removal sends the old parent: the command's refusal is shown as it is.
    const stale = c05();
    const { drawn: late } = drawn(stale.answers, { result: () => QF.C14.result });
    const [widget] = choiceOf(late.el);
    await pressOption(widget, ref('s30-base-a-g'));
    confirmOf(widget).dispatch('click');
    await settle();
    assert.equal(late.commands.length, 1);
    assert.equal(text(widget.querySelector('.rpg-pc-problem')), 'The earlier prerequisite was removed.');
    assert.equal(text(widget.querySelector('.rpg-pc-status')), '', 'no success line');
    assert.equal(confirmOf(widget).disabled, false, 'the reader may look again; nothing retried by itself');
    // Without the command's own words the code still reads plainly.
    const { drawn: bare } = drawn(stale.answers, { result: () => ({ ok: false, code: 'REPLAY_PREREQUISITE', message: '' }) });
    const [bareWidget] = choiceOf(bare.el);
    await pressOption(bareWidget, ref('s30-base-a-a'));
    confirmOf(bareWidget).dispatch('click');
    await settle();
    assert.match(text(bareWidget.querySelector('.rpg-pc-problem')), /earlier step this depended on was removed/);
});

// ---- C06 training across midnight -----------------------------------------------------------------------------------

test('C06 training midnight: day 4 minute 1410 runs to day 5 minute 30, the cap is day 5, and a re-read removes jump, completion and event', { skip }, () => {
    assert.equal(clockLabel(MIDNIGHT.start), 'Day 4, 23:30');
    assert.equal(clockLabel(MIDNIGHT.end), 'Day 5, 00:30');
    const train = stage => viewOf(progressView, c06(stage).answers).members[0].training;

    const running = train('running');
    assert.equal(running.state, 'running');
    assert.deepEqual(running.lines, ['From Day 4, 23:30 to Day 5, 00:30.', 'This crosses midnight into Day 5.', 'Credit counts toward Day 5\'s limit.']);

    const done = train('completed');
    assert.ok(done.lines.includes('Credits: 2 of 2.'));
    assert.ok(done.lines.includes('Counted on Day 5.'));
    assert.equal(done.caps, 'Limits: Day 5 · this skill 2 / 10 · all skills 2 / 30.');

    const capped = train('capped');
    assert.ok(capped.lines.includes('Credits: 0 of 2.'));
    assert.ok(capped.lines.includes('No mastery gained: the daily limit was reached.'));
    assert.equal(capped.caps, 'Limits: Day 5 · this skill 10 / 10 · all skills 10 / 30.');

    // Re-read: the session is back to a request. No jump, no completion, no event, no cap day.
    const reread = train('requested');
    assert.equal(reread.state, 'requested');
    assert.deepEqual(reread.lines, ['It starts when the story time next moves. Nothing is paid until then.']);
    assert.equal(reread.caps, 'Limits: this skill 0 / 10 · all skills 0 / 30.');
    const everything = JSON.stringify(reread);
    assert.doesNotMatch(everything, /midnight|Counted on|Something happened|Day 5/);
});

test('C06 training midnight: drawn, the same session moves from running to completed to re-read on redraws, event text stays text', { skip }, () => {
    const table = c06('running').answers;
    const { drawn: d } = drawn(table);
    const lines = () => all(d.el, '.train-lines li').map(text);
    assert.deepEqual(lines(), ['From Day 4, 23:30 to Day 5, 00:30.', 'This crosses midnight into Day 5.', 'Credit counts toward Day 5\'s limit.']);
    Object.assign(table, c06('interrupted').answers);
    d.rerender();
    assert.ok(lines().includes('Training event: A <b>storm</b> ended the lesson early.'));
    assert.equal(all(d.el, 'b').filter(node => node.parentNode.classList.contains('train-lines')).length, 0, 'no element from the marker');
    Object.assign(table, c06('requested').answers);
    d.rerender();
    assert.deepEqual(lines(), ['It starts when the story time next moves. Nothing is paid until then.']);
});

test('C06: a training request carries the actor, skill, form, trainer and session; an unset clock holds it', { skip }, async () => {
    const offer = trainOffer();
    const table = answers({ 'rules.training': ({ actor }) => (actor === PC ? trainingOf({ offers: [offer] }) : null) });
    const view = viewOf(progressView, table);
    assert.deepEqual(view.members[0].training.offers[0].payload, { actor: PC, skill: ref('s00'), form: ref('s00-base'), trainer: ref('mentor'), session: 'tr_00000001' });
    const { drawn: d } = drawn(table);
    const [send] = pressing(d.el, 'Ask for training');
    send.dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [{ type: 'skill.train', payload: view.members[0].training.offers[0].payload }], 'a request only: no fee or time at the page');

    const unset = answers({ 'director.time': { minutes: null, text: '' }, 'rules.training': ({ actor }) => (actor === PC ? trainingOf({ offers: [offer] }) : null) });
    const held = viewOf(progressView, unset).members[0].training;
    assert.equal(held.held, true);
    assert.equal(held.offers[0].canAsk, false);
    const { drawn: u } = drawn(unset);
    assert.equal(pressing(u.el, 'Ask for training').length, 0);
    assert.match(text(all(u.el, '.hold')[0]), /clock is not set/);
});

test('C06: a refused training request shows its message (the answer\'s own words, else the STALE words) and keeps the full payload', { skip }, async () => {
    const offer = trainOffer();
    const table = answers({ 'rules.training': ({ actor }) => (actor === PC ? trainingOf({ offers: [offer] }) : null) });
    const payload = viewOf(progressView, table).members[0].training.offers[0].payload;
    for (const [reply, shown] of [
        [{ ok: false, code: 'STALE', message: '' }, failureLine({ code: 'STALE' })],
        [{ ok: false, code: 'REFUSED', message: 'The trainer is busy today.' }, 'The trainer is busy today.'],
        [{ ok: false, code: 'FAILED' }, failureLine({ code: 'FAILED' })],
    ]) {
        const { drawn: d } = drawOver(progressScreen, table, { result: () => reply });
        pressing(d.el, 'Ask for training')[0].dispatch('click');
        await settle();
        assert.deepEqual(d.commands, [{ type: 'skill.train', payload }]);
        assert.deepEqual(refusals(d.el), [shown], JSON.stringify(reply));
    }
    assert.match(failureLine({ code: 'STALE' }), /changed since it was drawn/);
    const { drawn: ok } = drawOver(progressScreen, table, { result: () => ({ ok: true }) });
    pressing(ok.el, 'Ask for training')[0].dispatch('click');
    await settle();
    assert.deepEqual(refusals(ok.el), [], 'a request that went through shows no refusal');
});

// ---- the page as a whole -----------------------------------------------------------------------------------------------

test('Progress: your character leads, companions are collapsible cards, the party checklist lists everyone', { skip }, () => {
    const astra = sheetOf({ level: 10, skills: skillsOf(0, [35, 35, 22]) });
    const lyra = companionOf(LYRA, 'Lyra <b>x</b>', { level: 9, skills: skillsOf(0, [35, 35, 35]) });
    const table = answers({
        'rules.party': partyOf({ active: [astra, lyra] }),
        'rules.progress': ({ actor }) => progressOf(actor === PC ? astra : lyra),
        'rules.training': () => null,
    });
    const view = viewOf(progressView, table);
    assert.deepEqual(view.members.map(item => [item.name, item.you, item.open]), [['Astra', true, true], ['Lyra <b>x</b>', false, false]]);
    assert.deepEqual(view.party.map(item => [item.name, item.done, item.total, item.complete]), [['Astra', 2, 3, false], ['Lyra <b>x</b>', 3, 3, true]]);
    const { drawn: d } = drawn(table);
    assert.equal(all(d.el, 'article.member').length, 2);
    assert.equal(widgetsIn(d.el, 'rpg-battle.member-toggle').length, 2);
    assert.equal(all(d.el, 'article.member')[1].querySelector('.nm').textContent, 'Lyra <b>x</b>');
    assert.equal(all(d.el, 'b').filter(node => text(node) === 'x').length, 0, 'markup in a name is text');
    assert.equal(all(d.el, '.party-row').length, 2);
    assert.equal(all(d.el, '.party-row.complete').length, 1);
    assert.equal(all(d.el, '.skill').length, 6, 'three each');
});

test('Progress: the rules not answering, or answering in a form this version does not know, says so in its own state', { skip }, () => {
    const missing = answers({ 'rules.party': MISSING });
    assert.equal(viewOf(progressView, missing).state, 'unavailable');
    assert.equal(viewOf(progressView, answers({ 'rules.party': { nonsense: true } })).state, 'mismatch');
    assert.equal(viewOf(progressView, answers({ 'rules.party': () => null })).state, 'unavailable');
    const { drawn: d } = drawn(missing);
    assert.match(text(all(d.el, '.state')[0]), /rules are not answering/);
    // Without the identity query a choice cannot carry its hash, so it is not offered (and says why).
    const noHash = c02({ uses: [35, 35, 35] }).answers;
    noHash['rules.identity'] = MISSING;
    const view = viewOf(progressView, noHash);
    assert.equal(view.members[0].promotions[0].open, false);
    assert.match(view.members[0].promotions[0].note, /rules identity is not available/);
});

test('Progress: queries asked are only the contract\'s public ones', { skip }, () => {
    const log = [];
    drawn(c05().answers, { log });
    const allowed = new Set([...Object.keys(CONTRACTS), ...SHIPPED_QUERIES]);
    const asked = names(log).filter(name => !name.startsWith('rpg-battle.'));
    assert.deepEqual(asked.filter(name => !allowed.has(name)), [], 'every query is one the contract names');
    assert.ok(asked.includes('rules.progress') && asked.includes('rules.party'));
    assert.ok(!asked.some(name => name.startsWith('party.') || name.startsWith('quest.')), 'the old party and quest queries are not read');
});
