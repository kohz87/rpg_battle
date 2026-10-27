// Track C fixtures C07 (expiry) and C15 (neutral threads), and the Quests page: deadlines, repeat and chain as the QuestView
// says them, quest buttons that send only the id, and Story Block + Story Director alone listing goals with no buttons.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { questsScreen } from '../../../../src/v2/screens/rules/screens.js';
import { questsView } from '../../../../src/v2/screens/rules/quests.js';
import { failureLine } from '../../../../src/v2/screens/rules/format.js';
import { MISSING, QF, REPEAT_CHAIN, answers, c07, c15, c15Repeat, seed, thread } from './fixtures.js';
import { all, click, drawOver, pressing, refusals, names, settle, skip, text, toolsOf, viewOf } from './helpers.js';

const drawn = (table, options) => drawOver(questsScreen, table, options);
const rows = view => view.groups.flatMap(group => group.quests);

// ---- C07 expiry ------------------------------------------------------------------------------------------------------

test('C07 expiry: deadline 7200 is active at 7199 and expired at 7200, before any turn-in', { skip }, () => {
    const live = viewOf(questsView, c07(7199).answers);
    const [open] = rows(live);
    assert.equal(open.state, 'active');
    assert.equal(open.remainingText, '1 minute left');
    assert.equal(open.deadlineText, 'Due Day 5, 00:00');
    assert.equal(open.expired, false);
    assert.deepEqual(live.groups.map(group => [group.id, group.count]), [['offers', 0], ['active', 1], ['finished', 0]]);
    assert.equal(open.canAbandon, true);
    assert.equal(open.canFinish, false, 'not ready: the quest says what is missing');
    assert.deepEqual(open.blocked, ['Visit the mill first.']);

    const gone = viewOf(questsView, c07(7200).answers);
    const [dead] = rows(gone);
    assert.equal(dead.state, 'expired');
    assert.equal(dead.expired, true);
    assert.equal(dead.remainingText, 'Expired');
    assert.equal(dead.canFinish, false, 'no turn-in once expired');
    assert.equal(dead.canAbandon, false);
    assert.equal(dead.canTake, false);
    assert.match(dead.settled, /Expired before it was handed in\. Nothing was paid\./);
    assert.deepEqual(gone.groups.map(group => [group.id, group.count]), [['offers', 0], ['active', 0], ['finished', 1]]);
    // The contract fixture's own answer is what this draws.
    assert.deepEqual(QF.C07.queries['rules.quests'][0].remainingMinutes, 0);
});

test('C07 expiry: drawn, the expired quest has no buttons and the live one has Give up (and Hand in when ready)', { skip }, async () => {
    const { drawn: gone } = drawn(c07(7200).answers);
    assert.deepEqual(gone.warnings, []);
    assert.equal(all(gone.el, 'article.quest').length, 1);
    assert.ok(gone.el.querySelector('article.quest.expired'));
    assert.equal(all(gone.el, 'article.quest button').length, 0);
    assert.match(text(gone.el.querySelector('.line.due')), /Due Day 5, 00:00 · Expired/);

    const ready = c07(7199);
    ready.answers['rules.quests'] = [{ ...ready.quest, ready: true, blocked: [] }];
    const { drawn: live } = drawn(ready.answers);
    assert.deepEqual(all(live.el, 'article.quest button').map(text), ['Hand in', 'Give up']);
    pressing(live.el, 'Hand in')[0].dispatch('click');
    await settle();
    pressing(live.el, 'Give up')[0].dispatch('click');
    await settle();
    assert.deepEqual(live.commands, [{ type: 'quest.finish', payload: { id: 'th_job00001' } }, { type: 'quest.abandon', payload: { id: 'th_job00001' } }]);
});

test('C07 expiry: an expired quest offers no hand-in even if a stale answer still says ready', { skip }, () => {
    const expired = { ...c07(7200).quest, ready: true, blocked: [] };
    const [row] = rows(viewOf(questsView, answers({ 'rules.quests': [expired] })));
    assert.deepEqual([row.canFinish, row.canAbandon, row.canTake], [false, false, false]);
});

test('C07 expiry: repeat and chain are shown from the QuestView, with the next offer day', { skip }, () => {
    const table = answers({ 'rules.quests': [REPEAT_CHAIN] });
    const [row] = rows(viewOf(questsView, table));
    assert.equal(row.repeat.text, 'Repeats after a 1 day wait. Next offer Day 6, 00:00 (Day 6).');
    assert.equal(row.chain.text, 'Next: The next job.');
    assert.equal(row.settled, 'Paid: 30 coin, 25 XP.');
    const { drawn: d } = drawn(table);
    assert.match(text(d.el.querySelector('.line.repeat')), /Next offer Day 6/);
    assert.match(text(d.el.querySelector('.line.chain')), /Next: The next job\./);
    assert.match(text(d.el.querySelector('.line.settled')), /Paid: 30 coin, 25 XP\./);
});

test('C07: an offered quest is taken with just its id; a blocked one says why and cannot be taken', { skip }, async () => {
    const offered = { ...seed.quest, ready: false, blocked: [], remainingMinutes: null };
    const blocked = { ...seed.quest, id: 'th_job00003', title: 'Needs a rank', ready: false, blocked: ['Needs level 5.'], remainingMinutes: null };
    const table = answers({ 'rules.quests': [offered, blocked] });
    const view = viewOf(questsView, table);
    assert.deepEqual(rows(view).map(row => [row.id, row.canTake]), [['th_job00001', true], ['th_job00003', false]]);
    assert.equal(rows(view)[0].reward, '30 coin, 25 XP');
    assert.deepEqual(rows(view)[0].objectives.map(item => item.text), ['Visit Mill']);
    const { drawn: d } = drawn(table, { result: () => ({ ok: false, code: 'STALE', message: '' }) });
    assert.deepEqual(all(d.el, 'article.quest button').map(text), ['Take']);
    pressing(d.el, 'Take')[0].dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [{ type: 'quest.take', payload: { id: 'th_job00001' } }], 'no write id, hash or rpg payload from the page');
    assert.match(failureLine({ ok: false, code: 'STALE', message: '' }), /changed since it was drawn/);
    assert.deepEqual(refusals(d.el), [failureLine({ ok: false, code: 'STALE', message: '' })], 'the real STALE answer shows its words on the page');
});

test('C07: a refused or failed Take, Hand in or Give up shows its message (the answer\'s own words, else the code\'s)', { skip }, async () => {
    const offered = { ...seed.quest, id: 'th_job00005', ready: false, blocked: [], remainingMinutes: null, state: 'offered' };
    const live = { ...seed.quest, id: 'th_job00006', state: 'active', ready: true, blocked: [], remainingMinutes: 60 };
    const table = answers({ 'rules.quests': [offered, live] });
    const replies = [{ ok: false, code: 'STALE', message: '' }, { ok: false, code: 'REFUSED', message: 'The mill has not been visited.' }, { ok: false, code: 'NOT_FOUND', message: '' }];
    const { drawn: d } = drawn(table, { result: () => replies.shift() });
    assert.deepEqual(all(d.el, 'article.quest button').map(text), ['Take', 'Hand in', 'Give up']);
    for (const label of ['Take', 'Hand in', 'Give up']) {
        pressing(d.el, label)[0].dispatch('click');
        await settle();
    }
    assert.deepEqual(d.commands, [
        { type: 'quest.take', payload: { id: 'th_job00005' } }, { type: 'quest.finish', payload: { id: 'th_job00006' } }, { type: 'quest.abandon', payload: { id: 'th_job00006' } }]);
    assert.deepEqual(refusals(d.el), [failureLine({ code: 'STALE' }), 'The mill has not been visited.', failureLine({ code: 'NOT_FOUND' })]);
    assert.match(refusals(d.el)[0], /changed since it was drawn/);
});

// ---- C15 neutral threads -------------------------------------------------------------------------------------------------

test('C15 neutral threads: with Story Block and Story Director only, goals are listed as they are and there is nothing to press', { skip }, () => {
    for (const [stage, label, tone] of [['offered', 'Offered', 'accent'], ['accepted', 'In progress', 'info'], ['closed', 'Done', 'good']]) {
        const log = [];
        const view = viewOf(questsView, c15(stage).answers, {}, undefined, log);
        assert.equal(view.state, 'neutral', stage);
        assert.deepEqual(view.groups, []);
        assert.deepEqual(view.goals.map(goal => [goal.title, goal.stateLabel, goal.tone]), [['Find the lost bell', label, tone]]);
        // The page built the list from director.threads alone: the probe for RPG Battle found nothing, and no party or quest query was asked.
        assert.deepEqual(names(log).sort(), ['director.threads', 'director.time', 'rules.quests']);
        const { drawn: d } = drawn(c15(stage).answers);
        assert.deepEqual(d.warnings, []);
        assert.equal(all(d.el, 'article.goal').length, 1);
        assert.equal(all(d.el, 'button').length, 0, `${stage}: neutral acceptance has no buttons`);
        assert.match(text(d.el.querySelector('.goals .hint')), /accepted and closed in the story/);
    }
});

test('C15 neutral threads: hook offer, reader acceptance, generic progress and close are three states of the same thread id', { skip }, () => {
    const ids = ['offered', 'accepted', 'closed'].map(stage => viewOf(questsView, c15(stage).answers).goals[0].id);
    assert.deepEqual(ids, ['th_hook00001', 'th_hook00001', 'th_hook00001']);
    assert.equal(c15('accepted').threads[0].acceptance.source.sid, seed.source.sid, 'the acceptance proof is the reader\'s, kept with the thread');
    assert.equal(c15('accepted').threads[0].rpg, undefined, 'a neutral acceptance writes no rpg extension');
});

test('C15 neutral threads: a goal carrying rewards waits for RPG Battle when it is absent; neutral goals keep working beside it', { skip }, () => {
    const { done } = c15Repeat();
    const table = { 'director.time': { minutes: 14400, text: 'Day 10 start' }, 'director.threads': [thread(), { ...done, offer: true, status: 'active', ended: null }] };
    const view = viewOf(questsView, table);
    assert.deepEqual(view.goals.map(goal => [goal.id, goal.needsRpg]), [['th_hook00001', false], ['th_job00001', true]]);
    const { drawn: d } = drawn(table);
    assert.match(text(d.el.querySelector('.line.hold')), /waits for RPG Battle/);
    assert.equal(all(d.el, 'button').length, 0);
});

test('C15 neutral threads: a repeat or chain is a fresh th_ id beside the finished one, not the old one reopened', { skip }, async () => {
    const { done, again, quests } = c15Repeat();
    assert.notEqual(done.id, again.id);
    assert.equal(done.key, again.key, 'the display key may repeat once the first is over');
    const table = answers({ 'rules.quests': quests, 'director.threads': [done, again] });
    const view = viewOf(questsView, table);
    assert.deepEqual(rows(view).map(row => [row.id, row.state]), [['th_job00009', 'offered'], ['th_job00001', 'done']]);
    assert.equal(view.goals.length, 0, 'both are quests with rewards; nothing is listed twice');
    const { drawn: d } = drawn(table, { result: (type, payload) => (payload.id === 'th_job00009' ? { ok: false, code: 'STALE', message: 'This offer changed.' } : { ok: true }) });
    assert.equal(all(d.el, 'article.quest').length, 2);
    // Take the fresh offer: only that id is sent, and a refusal (stale hash inside RPG Battle's atomic accept) leaves the page as it was.
    const before = all(d.el, 'article.quest').map(text);
    pressing(d.el, 'Take')[0].dispatch('click');
    await settle();
    assert.deepEqual(d.commands, [{ type: 'quest.take', payload: { id: 'th_job00009' } }]);
    assert.deepEqual(refusals(d.el), ['This offer changed.'], 'the refusal is shown');
    d.rerender();
    assert.deepEqual(all(d.el, 'article.quest').map(text), [`${before[0]}This offer changed.`, before[1]], 'a refused accept changes nothing but the refusal shown');
    assert.equal(rows(viewOf(questsView, table))[0].state, 'offered');
});

test('Quests: neither module answering, and a malformed answer, are their own states', { skip }, () => {
    const none = { 'director.time': MISSING };
    assert.equal(viewOf(questsView, none).state, 'unavailable');
    assert.equal(viewOf(questsView, answers({ 'rules.quests': [{ nonsense: 1 }], 'director.threads': [thread()] })).state, 'neutral', 'a malformed RPG Battle answer falls back to the goals');
    const { drawn: d } = drawn(answers({ 'rules.quests': MISSING, 'director.threads': MISSING }));
    assert.match(text(d.el.querySelector('.state')), /Neither RPG Battle nor Story Director is answering/);
});

test('Quests: markup in titles, objectives and goal text stays text', { skip }, () => {
    const quest = { ...seed.quest, title: 'Fetch <b>x</b>', objectives: [{ id: 'ob_00000001', kind: 'story', text: 'Say <img src=x onerror=1>' }], ready: false, blocked: ['<i>no</i>'], remainingMinutes: null };
    const table = answers({ 'rules.quests': [quest], 'director.threads': [thread({ key: 'Goal <b>y</b>', summary: '<script>1</script>' })] });
    const { drawn: d } = drawn(table);
    assert.equal(all(d.el, 'b').filter(node => ['x', 'y'].includes(text(node))).length, 0);
    assert.equal(all(d.el, 'img').length, 0);
    assert.equal(all(d.el, 'script').length, 0);
    assert.equal(all(d.el, 'i').filter(node => node.tagName === 'I' && !node.classList.contains('fa-solid')).length, 0);
    assert.equal(d.el.querySelector('.nm').textContent, 'Fetch <b>x</b>');
    assert.ok(text(d.el).includes('Say <img src=x onerror=1>'));
});

// ---- Adjustments (GENERATIVE_OFFERS_SPEC §9.4) -----------------------------------------------------------------------

const adjustment = (n, over = {}) => ({
    id: `th_adj${String(n).padStart(5, '0')}`, kind: 'job', name: `Granary Vermin ${n}`, band: 'adjusted', bandLabel: 'Adjusted', reply: 14 + n, replyText: `reply ${14 + n}`,
    became: 'Hunt · kill 6 Culvert Rats · 5 silver · 50 XP · 7 days',
    changes: [{ k: 'reward', from: '12 crowns', to: '5 silver' }, { k: 'count', from: '', to: '6' }], dropped: '',
    wrote: 'giver: Hollis · type: cull · reward: 12 crowns', notes: ['reward "12 crowns" is not this chat\'s money; set to 5 silver', 'deadline set to 7 days'], where: 'Bluewatch Village', ...over,
});
const withAdjustments = rowsOf => ({ ...c07(100).answers, 'quest.adjustments': { count: rowsOf.length, rows: rowsOf } });

test('Adjustments: no section without rows, and none where RPG Battle does not answer', { skip }, () => {
    const { drawn: none } = drawn(withAdjustments([]));
    assert.equal(all(none.el, 'details.adj').length, 0);
    const missing = viewOf(questsView, { ...c07(100).answers, 'quest.adjustments': MISSING });
    assert.deepEqual(missing.adjustments, { count: 0, total: 0, recent: [], older: [], hasOlder: false, olderCount: 0, more: 0, moreText: '' });
});

test('Adjustments: a collapsed section with a count, a card per row with its band, changed terms and the raw labels behind a details element', { skip }, () => {
    const { drawn: page } = drawn(withAdjustments([adjustment(2), adjustment(1, { band: 'dropped', bandLabel: 'Dropped', changes: [], dropped: '50 gold is far above a rank F job (max 4 gold). The narrator was told once.' })]));
    assert.deepEqual(page.warnings, []);
    const section = page.el.querySelector('details.adj');
    assert.ok(section && !section.hasAttribute('open'), 'collapsed');
    assert.equal(text(section.querySelector('summary')), 'Adjustments (2)');
    const rows = all(section, 'li.adj-row');
    assert.equal(rows.length, 2);
    assert.equal(text(rows[0].querySelector('.nm')), 'Granary Vermin 2');
    assert.equal(text(rows[0].querySelector('.band')), 'Adjusted');
    assert.ok(rows[0].querySelector('.band').classList.contains('b-adjusted') && rows[1].querySelector('.band').classList.contains('b-dropped'));
    assert.equal(text(rows[0].querySelector('.reply')), 'reply 16');
    assert.equal(all(rows[0], '.cr').length, 2);
    assert.match(text(rows[0].querySelector('.cr')), /^reward\s*12 crowns→to5 silver$/);
    assert.match(text(all(rows[0], '.cr')[1]), /^count\s*not written—→to6$/, 'an unwritten term says so');
    assert.equal(text(rows[1].querySelector('.band')), 'Dropped');
    assert.match(text(rows[1].querySelector('.dropped')), /^Dropped: 50 gold is far above a rank F job/);
    assert.equal(all(rows[1], '.cr').length, 0);
    const details = rows[0].querySelector('details.nowrote');
    assert.equal(text(details.querySelector('summary')), 'What the narrator wrote');
    assert.equal(text(details.querySelector('.raw')), 'giver: Hollis · type: cull · reward: 12 crowns');
    assert.equal(all(details, 'li').length, 2);
});

test('Adjustments: ten rows show, the rest are behind a "Show older" button that opens them', { skip }, () => {
    const many = Array.from({ length: 13 }, (_, n) => adjustment(13 - n));
    const view = viewOf(questsView, withAdjustments(many));
    assert.deepEqual([view.adjustments.count, view.adjustments.recent.length, view.adjustments.older.length, view.adjustments.hasOlder], [13, 10, 3, true]);
    const { drawn: page } = drawn(withAdjustments(many));
    const section = page.el.querySelector('details.adj');
    assert.equal(all(section, 'li.adj-row').length, 13);
    assert.equal(all(section, 'ul.older-rows li.adj-row').length, 3);
    assert.equal(section.getAttribute('data-more'), 'closed');
    const [more] = all(section, 'button.rpg-sm');
    assert.equal(text(more), 'Show older (3)');
    assert.equal(more.getAttribute('aria-expanded'), 'false');
    assert.equal(all(section, 'details.older').length, 0, 'a button, not a details element');
    click(more);
    assert.equal(section.getAttribute('data-more'), 'open');
    assert.equal(text(more), 'Show fewer');
    click(more);
    assert.equal(section.getAttribute('data-more'), 'closed');
});

test('Adjustments: the band chips are filled, not outlined, and the sheet names no literal colour', { skip }, () => {
    const { drawn: page } = drawn(withAdjustments([adjustment(1)]));
    assert.ok(!page.el.querySelector('.band').classList.contains('ss-pill-outline'));
    assert.match(questsScreen.css ?? '', /\.band\.b-kept \{ background: color-mix/);
    assert.doesNotMatch(String(questsScreen.css ?? ''), /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test('Adjustments: when the log holds more than it lists, the summary counts them all and a line says how many older ones are not listed', { skip }, () => {
    const many = Array.from({ length: 50 }, (_, n) => adjustment(50 - n));
    const table = { ...c07(100).answers, 'quest.adjustments': { count: 50, rows: many, more: 10 } };
    const view = viewOf(questsView, table);
    assert.deepEqual([view.adjustments.count, view.adjustments.total, view.adjustments.more, view.adjustments.moreText], [50, 60, 10, '10 older adjustments are not listed.']);
    const { drawn: page } = drawn(table);
    assert.equal(text(page.el.querySelector('details.adj summary')), 'Adjustments (60)');
    assert.equal(text(page.el.querySelector('.adj-omitted')), '10 older adjustments are not listed.');
    const one = viewOf(questsView, { ...table, 'quest.adjustments': { count: 50, rows: many, more: 1 } });
    assert.equal(one.adjustments.moreText, '1 older adjustment is not listed.');
    const { drawn: none } = drawn({ ...table, 'quest.adjustments': { count: 50, rows: many } });
    assert.equal(none.el.querySelectorAll('.adj-omitted').length, 0);
});
