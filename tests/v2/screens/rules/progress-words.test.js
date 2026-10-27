// The Progress page's and the Adjustments log's words as the approved mockups draw them (RPG Battle 2.3.0): how mastery grows (one muted line from the pin's
// constants), the uses held for the story clock, a promotion that asks less than the top (header, waiting lines, the done border, bars still out of the
// top), the 13-option promotion grid, and a refused rest as an Adjustments row. DOM tests on the drawn pages.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { progressScreen, questsScreen } from '../../../../src/v2/screens/rules/screens.js';
import { progressView } from '../../../../src/v2/screens/rules/progress.js';
import { RULES_WIDGET_CSS } from '../../../../src/v2/screens/rules/widgets.js';
import { adjustments } from '../../../../src/v2/quests/offer-log.js';
import { PC, answers, c02, c07, partyOf, progressOf, ref, sheetOf, skillsOf, MISSING } from './fixtures.js';
import { all, drawOver, skip, text, viewOf, widgetsIn } from './helpers.js';

const drawn = (table, options) => drawOver(progressScreen, table, options).drawn;
const PACE = { top: 5, usesForTop: 35, perReply: 2, perDay: 10 };
const sentence = pace => `Each skill needs ${pace.usesForTop} uses for ${pace.top} / ${pace.top}. Uses come from fights (Auto too, up to ${pace.perReply} per skill a fight), training and story skill uses — up to ${pace.perDay} a day per skill.`;

// ---- A: how mastery grows, and the uses waiting for the clock -------------------------------------------------------------

test('A: one muted line under the Skills label says how mastery grows, with the numbers from the pin\'s constants', { skip }, () => {
    const sheet = sheetOf({ level: 1 });
    const table = pace => answers({ 'rules.party': partyOf({ active: [sheet] }), 'rules.pace': pace });
    const { el } = drawn(table(PACE));
    const hint = all(el, '.skills .hint.how');
    assert.equal(hint.length, 1);
    assert.equal(text(hint[0]), 'Each skill needs 35 uses for 5 / 5. Uses come from fights (Auto too, up to 2 per skill a fight), training and story skill uses — up to 10 a day per skill.');
    // Not literals: another pin's numbers are the line's numbers.
    const other = { top: 4, usesForTop: 22, perReply: 3, perDay: 6 };
    assert.equal(text(all(drawn(table(other)).el, '.skills .hint.how')[0]), sentence(other));
    // Under the label, before the list.
    const block = all(el, '.block.skills')[0];
    assert.deepEqual([...block.children].map(node => (node.tagName === 'UL' ? 'list' : node.classList.contains('hint') ? 'hint' : 'label')), ['label', 'hint', 'list']);
    // Where the query does not answer, no line.
    assert.equal(all(drawn(table(MISSING)).el, '.skills .hint.how').length, 0);
    assert.equal(viewOf(progressView, table(MISSING)).members[0].howText, '');
});

test('A: "N uses waiting for the story clock" on a skill with uses held, singular for one, with the clock icon; "Next mastery at 1 use"', { skip }, () => {
    const sheet = sheetOf({ level: 1 });
    const [first, second] = sheet.skills;
    const progress = progressOf(sheet);
    progress.checklist = progress.checklist.map((row, n) => (n === 0 ? { ...row, waiting: 2 } : n === 1 ? { ...row, waiting: 1 } : row));
    const table = answers({ 'rules.party': partyOf({ active: [sheet] }), 'rules.progress': ({ actor }) => (actor === PC ? progress : null), 'rules.pace': PACE });
    const view = viewOf(progressView, table).members[0];
    assert.deepEqual(view.skills.map(row => row.waitText), ['2 uses waiting for the story clock', '1 use waiting for the story clock', '']);
    const { el } = drawn(table);
    const cards = all(el, 'li.skill');
    const waits = cards.map(card => all(card, '.skill-wait').map(text));
    assert.deepEqual(waits, [['2 uses waiting for the story clock'], ['1 use waiting for the story clock'], []]);
    const icon = cards[0].querySelector('.skill-wait i');
    assert.ok(icon.classList.contains('fa-clock'), 'the small clock');
    assert.equal(icon.getAttribute('aria-hidden'), 'true');
    assert.equal(text(cards[0].querySelector('.skill-note')), '0 uses · Next mastery at 1 use');
    assert.deepEqual([first.nextAt, second.nextAt], [1, 1]);
    // After a use: "5 uses" stays plural, one use is "1 use".
    const used = sheetOf({ level: 1, skills: skillsOf(0, [1, 5, 12]) });
    const { el: after } = drawn(answers({ 'rules.party': partyOf({ active: [used] }), 'rules.progress': ({ actor }) => (actor === PC ? progressOf(used) : null) }));
    assert.deepEqual(all(after, '.skill-note').map(text), ['1 use · Next mastery at 5 uses', '5 uses · Next mastery at 12 uses', '12 uses · Next mastery at 22 uses']);
});

// ---- B: a promotion that asks less than the top ---------------------------------------------------------------------------

const asking = (need, uses, choices = []) => {
    const sheet = sheetOf({ level: 10, skills: skillsOf(0, uses) });
    const progress = progressOf(sheet, {
        checklist: sheet.skills.map(s => ({ skill: s.skill, form: s.form, mastery: s.mastery, needed: need })),
        promotions: [{ milestone: 10, eligible: choices.length > 0, choices, why: choices.length ? [] : sheet.skills.filter(s => s.mastery < need).map(s => `${s.name} is ${s.mastery} / ${need}.`) }],
    });
    return answers({ 'rules.party': partyOf({ active: [sheet] }), 'rules.progress': ({ actor }) => (actor === PC ? progress : null), 'rules.pace': PACE });
};

test('B: with a promotion that wants 3 of 5 the headers say "forms at 3 / 5", the waiting lines "Strike is 1 / 3.", and the bars stay out of 5', { skip }, () => {
    const table = asking(3, [1, 0, 0]);
    const view = viewOf(progressView, table);
    assert.equal(view.partyText, 'forms at 3 / 5');
    assert.equal(view.members[0].checklistText, '0 of 3 forms at 3 / 5');
    assert.equal(view.party[0].text, '0 of 3 forms at 3 / 5');
    const { el } = drawn(table);
    assert.equal(text(all(el, '.party-check .ss-label small')[0]), 'forms at 3 / 5');
    assert.equal(text(all(el, '.party-row small')[0]), '0 of 3 forms at 3 / 5');
    assert.equal(text(all(el, '.skills .ss-label small')[0]), '0 of 3 forms at 3 / 5');
    const names = view.members[0].skills.map(row => row.name);
    assert.deepEqual(all(el, '.promotions .why li').map(text), [`${names[0]} is 1 / 3.`, `${names[1]} is 0 / 3.`, `${names[2]} is 0 / 3.`]);
    // Bars: mastery out of the top, whatever the promotion asks.
    assert.deepEqual(view.members[0].skills.map(row => [row.text, row.needed, row.need]), [['1 / 5', 5, 3], ['0 / 5', 5, 3], ['0 / 5', 5, 3]]);
    assert.deepEqual(all(el, 'li.skill').map(card => card.classList.contains('done')), [false, false, false]);
});

test('B: the "done" border follows the requirement: three skills at 3 of 5 are done when the promotion asks 3, not when it asks 5', { skip }, () => {
    const three = asking(3, [12, 12, 12], [ref('c1')]);
    const view = viewOf(progressView, three).members[0];
    assert.deepEqual(view.skills.map(row => [row.text, row.done]), [['3 / 5', true], ['3 / 5', true], ['3 / 5', true]]);
    assert.equal(view.checklistText, '3 of 3 forms at 3 / 5');
    assert.deepEqual(all(drawn(three).el, 'li.skill').map(card => card.classList.contains('done')), [true, true, true]);
    const five = asking(5, [12, 12, 12]);
    assert.deepEqual(all(drawn(five).el, 'li.skill').map(card => card.classList.contains('done')), [false, false, false]);
    assert.equal(viewOf(progressView, five).members[0].checklistText, '0 of 3 forms at 5 / 5');
    // A mix: only the skills that have the mastery are done.
    const mixed = asking(3, [12, 5, 12]);
    assert.deepEqual(all(drawn(mixed).el, 'li.skill').map(card => card.classList.contains('done')), [true, false, true]);
});

test('B: the 13-option promotion shows all 13 as buttons in a grid of 3 columns on a desktop card and 2 on a phone, and the warning is unchanged', { skip }, () => {
    const choices = Array.from({ length: 13 }, (_, n) => ref(`c${n + 1}`));
    const table = asking(3, [12, 12, 12], choices);
    const { el } = drawn(table);
    const [widget] = widgetsIn(el, 'rpg-battle.permanent-choice');
    assert.equal(widget.querySelectorAll('.rpg-pc-option').length, 13);
    assert.equal(text(widget.querySelector('.rpg-pc-warning')), 'All three skills are swapped for the new class and start at 0 / 5. This cannot be undone.');
    assert.equal(widget.querySelectorAll('button.rpg-pc-confirm').length, 1);
    // The grid is the one rule: columns of at least 11em (14px type) that share the card, 8px apart.
    const rule = /\.rpg-pc-options, \.rpg-cp \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 11em\), 1fr\)\);/.exec(RULES_WIDGET_CSS);
    assert.ok(rule, 'auto-fill columns of 11em');
    assert.match(RULES_WIDGET_CSS, /\.rpg-pc-options, \.rpg-cp \{ display: grid; gap: var\(--ss-space-2\);/);
    const columns = width => Math.max(1, Math.floor((width + 8) / (11 * 14 + 8)));
    assert.equal(columns(520), 3, 'a desktop card (two cards in 1280px)');
    assert.equal(columns(346), 2, 'a phone card (390px)');
});

// ---- C: a refused rest in the Adjustments log -----------------------------------------------------------------------------

const slice = (...records) => ({ domains: { rules: Object.fromEntries(records.map(([n, record]) => [`rest.rs_${String(n).padStart(12, '0')}`, record])) } });
const rest = (over = {}) => ({ v: 1, sid: 'sr_00000001', kind: 'long', needed: 360, moved: 0, place: 'The Stray Oar', said: { kind: 'long' }, ...over });
const rowsOf = (state, receipts = []) => adjustments(state, {}, { receipts: () => receipts }).rows;

test('C: a long rest that no story time paid for is a Dropped row titled "Long rest at <place>", with the mockup\'s words', () => {
    const [row] = rowsOf(slice([1, rest()]));
    assert.equal(row.name, 'Long rest at The Stray Oar');
    assert.deepEqual([row.band, row.bandLabel], ['dropped', 'Dropped']);
    assert.equal(row.became, 'Rest · long · The Stray Oar · not taken');
    assert.equal(row.dropped, 'No story time passed in that reply; a long rest needs 6 hours (e.g. ! time +8h). Nothing was healed.');
    assert.equal(row.wrote, 'rest: long · place: The Stray Oar');
});

test('C: a short rest says one hour and +1h; some time that was not enough says how much passed; no place leaves the place out', () => {
    const [short] = rowsOf(slice([1, rest({ kind: 'short', needed: 60, said: { kind: 'short' } })]));
    assert.equal(short.name, 'Short rest at The Stray Oar');
    assert.equal(short.became, 'Rest · short · The Stray Oar · not taken');
    assert.equal(short.dropped, 'No story time passed in that reply; a short rest needs 1 hour (e.g. ! time +1h). Nothing was healed.');
    const [some] = rowsOf(slice([1, rest({ moved: 120 })]));
    assert.equal(some.dropped, 'Only 2 hours of story time passed in that reply; a long rest needs 6 hours (e.g. ! time +8h). Nothing was healed.');
    const { place, ...bare } = rest();
    const [none] = rowsOf(slice([1, bare]));
    assert.equal(none.name, 'Long rest');
    assert.equal(none.became, 'Rest · long · not taken');
    assert.equal(none.wrote, 'rest: long');
    assert.equal(none.where, '');
    const [told] = rowsOf(slice([1, rest({ said: { kind: 'long', text: 'a night at the inn' } })]));
    assert.equal(told.wrote, 'rest: long · place: The Stray Oar · a night at the inn');
});

test('C: the Quests page draws the rest row as an Adjustments row: title, Dropped chip, Became, the why and the raw line behind "What the narrator wrote"', { skip }, () => {
    const rows = rowsOf(slice([1, rest()]), [{ index: 34, receipt: { data: { record: 'rs_000000000001' } } }]);
    assert.equal(rows[0].replyText, 'reply 34');
    const table = { ...c07(100).answers, 'quest.adjustments': { count: rows.length, rows } };
    const { el } = drawOver(questsScreen, table).drawn;
    const [row] = all(el, 'li.adj-row');
    assert.equal(text(row.querySelector('.nm')), 'Long rest at The Stray Oar');
    assert.equal(text(row.querySelector('.band')), 'Dropped');
    assert.ok(row.querySelector('.band').classList.contains('b-dropped'));
    assert.equal(text(row.querySelector('.reply')), 'reply 34');
    assert.equal(text(row.querySelector('.became')), 'Rest · long · The Stray Oar · not taken');
    assert.equal(text(row.querySelector('.dropped')), 'Dropped: No story time passed in that reply; a long rest needs 6 hours (e.g. ! time +8h). Nothing was healed.');
    assert.equal(text(row.querySelector('details.nowrote .raw')), 'rest: long · place: The Stray Oar');
    assert.equal(all(row, '.cr').length, 0);
});
