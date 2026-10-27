// The Quests page writes the story's dates, coins and names as the story does (GENERATIVE_OFFERS_SPEC, Decisions): the dates from Story Director's calendar
// (this folder's own copy of its arithmetic, held to the real one here), the coins as the terms and the Adjustments log write them, the foes and items by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCalendar } from '../../../vendor/story-director/src/calendar.js';
import { calendarWriter, moneyText } from '../../../../src/v2/screens/rules/format.js';
import { questsView } from '../../../../src/v2/screens/rules/quests.js';
import { questsScreen } from '../../../../src/v2/screens/rules/screens.js';
import { money } from '../../../../src/v2/quests/parse.js';
import { PACK } from '../../quests/helpers/bluewatch.js';
import { c07 } from './fixtures.js';
import { drawOver, skip, text, viewOf } from './helpers.js';

const ERSVEIL = { era: 'CY', months: ['Frostwane', 'Goldwane', 'Seedtide', 'Rainfall', 'Brightmoon', 'Highsun', 'Embertide', 'Harvest', 'Mistfall', 'Duskwane', 'Emberfall', 'Deepwinter'].map(name => ({ name, days: 30 })), leapYears: false };
const CALENDARS = [
    makeCalendar('gregorian').config, makeCalendar({ ...ERSVEIL }).config, makeCalendar({ era: '', leapYears: true, months: [{ name: 'Sun', days: 10 }, { name: 'Moon', days: 7 }, { name: 'Star', days: 3 }] }).config,
    makeCalendar({ era: 'Age of Ash', months: [{ name: 'Only', days: 40 }] }).config,
];

test('the calendar writer gives the dates Story Director\'s own calendar gives: the era and year form and the short form, over many days of four calendars', () => {
    for (const config of CALENDARS) {
        const real = makeCalendar(config);
        const mine = calendarWriter(config);
        assert.ok(mine);
        for (const day of [-800, -366, -1, 0, 1, 27, 28, 29, 30, 58, 59, 60, 364, 365, 366, 367, 1000, 4000, 36524, 36525, 146097, 220091, 880000]) {
            for (const minutes of [day * 1440, day * 1440 + 1439]) {
                assert.equal(mine.date(minutes), real.format(minutes, { time: false }), `${config.preset} ${minutes}`);
                assert.equal(mine.date(minutes, { era: false }), real.format(minutes, { time: false, era: false }), `${config.preset} ${minutes} short`);
                assert.equal(mine.year(minutes), real.fromAbs(minutes).year);
            }
        }
    }
    assert.equal(calendarWriter(null), null);
    assert.equal(calendarWriter({ months: [] }), null);
    assert.equal(calendarWriter({ months: [{ name: 'A', days: 0 }] }), null);
});

test('moneyText is quests/parse.js money for the same currency: coins, one coin, a base display, nothing', () => {
    const coins = [{ name: 'copper', plural: 'copper', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }];
    for (const currency of [{ name: 'copper', coins }, { name: 'copper', coins, display: 'base' }, { name: 'crown', plural: 'crowns' }, { name: 'gil' }, null, 'gold']) {
        for (const amount of [0, 1, 5, 10, 11, 100, 400, 405, 12345]) assert.equal(moneyText(amount, currency), money(amount, currency), JSON.stringify([currency, amount]));
    }
    assert.equal(moneyText(400, { name: 'copper', coins }), '4 gold');
});

const GREGORIAN = makeCalendar('gregorian').config;
const COINS = { name: 'copper', coins: [{ name: 'copper', plural: 'copper', value: 1 }, { name: 'silver', plural: 'silver', value: 10 }, { name: 'gold', plural: 'gold', value: 100 }] };
const withWorld = (answers, extra = {}) => ({ ...answers, 'director.calendar': ERSVEIL, 'inventory.currency': COINS, ...extra });

test('the Quests page: the clock in the calendar, a deadline as "Due Goldwane 17, 06:00", the reward in coins, foes and items by name', { skip }, () => {
    const now = makeCalendar(ERSVEIL).toAbs({ year: 611, month: 1, day: 12, minutes: 400 });
    const due = makeCalendar(ERSVEIL).toAbs({ year: 611, month: 1, day: 17, minutes: 360 });
    const base = c07(now);
    const quest = { ...base.quest, state: 'active', settlement: null, ready: false, deadline: due, remainingMinutes: due - now, reward: { coin: 400, xp: 50, items: [{ def: 'pack.fixture/torch', qty: 2 }] },
        objectives: [{ id: 'o1', kind: 'kill', foe: 'pack.fixture/plague-rat', count: 8 }, { id: 'o2', kind: 'collect', def: 'pack.fixture/torch', count: 2, consume: true }] };
    const names = { 'pack.fixture/plague-rat': 'Plague Rat', 'pack.fixture/torch': 'Torch' };
    const table = withWorld({ ...base.answers, 'rules.quests': [quest], 'director.time': { minutes: now, text: 'CY 611, Goldwane 12, 06:40 am' }, 'rules.names': ({ refs }) => Object.fromEntries(refs.filter(ref => names[ref]).map(ref => [ref, names[ref]])) });
    const view = viewOf(questsView, table);
    assert.equal(view.clock.text, 'CY 611, Goldwane 12');
    const [row] = view.groups.flatMap(group => group.quests);
    assert.equal(row.deadlineText, 'Due Goldwane 17, 06:00', 'the same year as now: no era');
    assert.equal(row.reward, '4 gold, 50 XP, 2 × Torch');
    assert.deepEqual(row.objectives.map(item => item.text), ['Defeat 8 × Plague Rat', 'Collect 2 × Torch (handed in)']);
    const { drawn: page } = drawOver(questsScreen, table);
    assert.match(text(page.el.querySelector('.now')), /^Now: CY 611, Goldwane 12$/);
    assert.match(text(page.el), /Due Goldwane 17, 06:00/);
    assert.doesNotMatch(text(page.el), /\bcoin\b|Day \d{4,}|plague-rat/);
});

test('the Quests page: a deadline in another year says the era and year; a repeat says its date; a settled quest says its coins', { skip }, () => {
    const cal = makeCalendar(ERSVEIL);
    const now = cal.toAbs({ year: 611, month: 11, day: 28, minutes: 0 });
    const later = cal.toAbs({ year: 612, month: 0, day: 3, minutes: 720 });
    const base = c07(now);
    const quest = { ...base.quest, state: 'done', deadline: later, remainingMinutes: null, repeat: { cooldownMinutes: 1440, nextOfferAt: later },
        settlement: { ...(base.quest.settlement ?? {}), id: 'st_00000009', outcome: 'done', coinPaid: 405, xpPaid: 25, itemsPaid: [], claim: 'rb:ep_00000001:quest:th_job00001:1:settled' } };
    const [row] = viewOf(questsView, withWorld({ ...base.answers, 'rules.quests': [quest] })).groups.flatMap(group => group.quests);
    assert.equal(row.deadlineText, 'Due CY 612, Frostwane 3, 12:00');
    assert.equal(row.repeat.text, 'Repeats after a 1 day wait. Next offer CY 612, Frostwane 3, 12:00.');
    assert.equal(row.settled, 'Paid: 4 gold 5 copper, 25 XP.');
});

test('the Quests page without a calendar or coins keeps the plain counts (Story Block and Story Director alone, a chat with no calendar answer)', { skip }, () => {
    const base = c07(7199);
    const [row] = viewOf(questsView, { ...base.answers, 'rules.quests': [{ ...base.quest, reward: { coin: 400, xp: 0, items: [] } }] }).groups.flatMap(group => group.quests);
    assert.match(row.deadlineText, /^Due Day 5, 00:00$/);
    assert.equal(row.reward, '400 coin');
});


test('the Progress page writes a lesson\'s times in the calendar when the chat has one: across midnight, and the day it counts toward', { skip }, async () => {
    const { progressView } = await import('../../../../src/v2/screens/rules/progress.js');
    const { c06, MIDNIGHT } = await import('./fixtures.js');
    const answers = { ...c06('running').answers, 'director.calendar': GREGORIAN, 'inventory.currency': COINS };
    const calendar = makeCalendar(GREGORIAN);
    const running = viewOf(progressView, answers).members[0].training;
    assert.deepEqual(running.lines, [`From ${calendar.format(MIDNIGHT.start, { time: false, era: false })}, 23:30 to ${calendar.format(MIDNIGHT.end, { time: false, era: false })}, 00:30.`,
        `This crosses midnight into ${calendar.format(MIDNIGHT.end, { time: false, era: false })}.`, `Credit counts toward ${calendar.format(5 * 1440, { time: false, era: false })}'s limit.`]);
    assert.doesNotMatch(running.lines.join(' '), /Day \d/);
});
