// Track C fixture C13 (dependencies): missing or late Story Director, an unset clock, an unknown tier, and optional journal
// or social being off are distinct states, on the Setup page and in the banner the other pages carry. Required lines decide
// whether RPG Battle is ready; an unset clock and an unknown tier hold only what they touch; optional lines hold nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { progressScreen, setupScreen } from '../../../../src/v2/screens/rules/screens.js';
import { dependencyView } from '../../../../src/v2/screens/rules/deps.js';
import { depsBanner, setupView } from '../../../../src/v2/screens/rules/setup.js';
import { progressView } from '../../../../src/v2/screens/rules/progress.js';
import { C13, MISSING, answers } from './fixtures.js';
import { all, drawOver, skip, text, toolsOf, viewOf } from './helpers.js';

const lines = table => Object.fromEntries(dependencyView(toolsOf(table)).lines.map(line => [line.id, line]));
const states = table => Object.fromEntries(Object.entries(lines(table)).map(([id, line]) => [id, line.state]));

test('C13 dependencies: everything present is ready, and the six lines are in a fixed order', { skip }, () => {
    const view = dependencyView(toolsOf(C13.ready()));
    assert.deepEqual(view.lines.map(line => line.id), ['sd', 'save', 'clock', 'area', 'journal', 'social']);
    assert.deepEqual(states(C13.ready()), { sd: 'ready', save: 'ready', clock: 'ready', area: 'ready', journal: 'ready', social: 'ready' });
    assert.equal(view.ready, true);
    assert.equal(view.mode, 'ready');
    assert.deepEqual(view.held, []);
    assert.equal(view.headline, 'RPG Battle is ready.');
    assert.equal(lines(C13.ready()).area.text, 'Danger tier 2, set for the whole world.');
});

test('C13 dependencies: Story Director missing, disabled and incompatible are three different states, each dormant and each naming what is wrong', { skip }, () => {
    const missing = dependencyView(toolsOf(C13.missingSd()));
    assert.equal(missing.lines[0].state, 'missing');
    assert.match(missing.lines[0].text, /not answering \(not installed, switched off, or still starting\)/);
    assert.deepEqual([missing.ready, missing.mode, missing.blocking], [false, 'dormant', ['sd']]);
    assert.match(missing.headline, /Your story and the other modules keep working/);
    // What depends on it is unknown, not wrong.
    assert.deepEqual(['clock', 'area', 'journal'].map(id => missing.lines.find(line => line.id === id).state), ['unknown', 'unknown', 'unknown']);
    assert.deepEqual(missing.held, [], 'a dormant module holds nothing separately; it is all of it');

    const off = dependencyView(toolsOf(C13.disabledSd()));
    assert.equal(off.lines[0].state, 'disabled');
    assert.match(off.lines[0].text, /installed but switched off/);

    const partial = dependencyView(toolsOf(C13.incompatibleSd()));
    assert.equal(partial.lines[0].state, 'incompatible');
    assert.deepEqual(partial.lines[0].lacking, ['tiers', 'checks']);
    assert.match(partial.lines[0].text, /missing what RPG Battle needs: tiers, checks/);

    const wrong = dependencyView(toolsOf(C13.wrongApiSd()));
    assert.equal(wrong.lines[0].state, 'incompatible');
    assert.match(wrong.lines[0].text, /form this version of RPG Battle does not understand/);
    assert.equal(new Set([missing, off, partial, wrong].map(view => view.lines[0].state + view.lines[0].text)).size, 4);
});

test('C13 dependencies: a late Story Director is read again on the next view, with no reload', { skip }, () => {
    const table = C13.missingSd();
    assert.equal(dependencyView(toolsOf(table)).lines[0].state, 'missing');
    Object.assign(table, C13.ready());
    const later = dependencyView(toolsOf(table));
    assert.equal(later.ready, true);
    assert.equal(later.lines[0].state, 'ready');
    // On the page: the same drawing, redrawn after the module registers.
    const live = C13.missingSd();
    const { drawn: d } = drawOver(setupScreen, live);
    assert.equal(all(d.el, '.sect.status.dormant').length, 1);
    assert.equal(text(all(d.el, '.dep')[0].querySelector('.ss-pill')), 'missing');
    Object.assign(live, C13.ready());
    d.rerender();
    assert.equal(all(d.el, '.sect.status.dormant').length, 0);
    assert.equal(text(all(d.el, '.dep')[0].querySelector('.ss-pill')), 'ready');
});

test('C13 dependencies: save points missing or not ready stops RPG Battle too, as its own state', { skip }, () => {
    const gone = dependencyView(toolsOf(C13.noSavepoints()));
    assert.equal(gone.lines[1].state, 'missing');
    assert.equal(gone.ready, false);
    assert.deepEqual(gone.blocking, ['save']);
    const waiting = dependencyView(toolsOf(answers({ 'savepoint.contract': { api: 2, snapshots: true, retainedChatRestore: false, participantsReady: false } })));
    assert.equal(waiting.lines[1].state, 'not-ready');
    assert.deepEqual(waiting.lines[1].lacking, ['retainedChatRestore', 'participantsReady']);
    assert.equal(waiting.ready, false);
});

test('C13 dependencies: an unset clock holds timed actions only; RPG Battle stays ready and creation and views work', { skip }, () => {
    const view = dependencyView(toolsOf(C13.unsetClock()));
    assert.equal(view.ready, true);
    assert.equal(view.lines[2].state, 'unset');
    assert.equal(view.lines[2].tone, 'warn');
    assert.match(view.lines[2].text, /make characters and read these pages; training and quest deadlines wait/);
    assert.deepEqual(view.held, ['Timed actions (training, quest deadlines) wait for the story clock.']);
    assert.equal(view.lines[4].state, 'idle', 'no day to recap yet');
    // Other pages still draw their content, with the banner.
    const { drawn: d } = drawOver(progressScreen, C13.unsetClock());
    assert.equal(all(d.el, 'article.member').length, 1);
    assert.match(text(d.el.querySelector('.banner')), /ready, with a few things on hold/);
    assert.match(text(d.el.querySelector('.banner')), /story clock is not set/);
});

test('C13 dependencies: an unknown tier or place holds content for that place only', { skip }, () => {
    const tier = dependencyView(toolsOf(C13.unknownTier()));
    assert.deepEqual([tier.ready, tier.lines[3].state, tier.lines[3].tone], [true, 'unknown-tier', 'warn']);
    assert.match(tier.lines[3].text, /No danger tier is set for this place, its region or the world.*Nothing else is held/);
    assert.deepEqual(tier.held, ['Content for this place waits for a danger tier.']);
    const place = dependencyView(toolsOf(C13.unknownPlace()));
    assert.deepEqual([place.ready, place.lines[3].state], [true, 'unknown-place']);
    assert.notEqual(tier.lines[3].text, place.lines[3].text);
    assert.deepEqual(lines(C13.ready()).area.source, 'world');
});

test('C13 dependencies: optional journal and social being off or absent hold nothing and are three distinct, quiet states', { skip }, () => {
    const journal = dependencyView(toolsOf(C13.journalOff()));
    assert.deepEqual([journal.ready, journal.lines[4].state, journal.lines[4].tone, journal.held], [true, 'off', 'neutral', []]);
    assert.match(journal.lines[4].text, /Save points still keep their own recap/);
    const social = dependencyView(toolsOf(C13.socialOff()));
    assert.deepEqual([social.ready, social.lines[5].state, social.lines[5].tone], [true, 'off', 'neutral']);
    const absent = dependencyView(toolsOf(C13.nsdAbsent()));
    assert.deepEqual([absent.ready, absent.lines[5].state, absent.lines[5].tone], [true, 'absent', 'neutral']);
    assert.equal(new Set([journal.lines[4].text, social.lines[5].text, absent.lines[5].text]).size, 3);
    // None of the three raises the banner.
    for (const scenario of [C13.journalOff(), C13.socialOff(), C13.nsdAbsent(), C13.ready()]) assert.equal(depsBanner({}, {}, toolsOf(scenario)).show, false);
});

test('C13 dependencies: every state in every line is distinct for the reader (its own word, tone and sentence)', { skip }, () => {
    const texts = new Map();
    const tones = new Map();
    for (const make of Object.values(C13)) {
        for (const line of dependencyView(toolsOf(make())).lines) {
            const key = `${line.id}:${line.state}`;
            texts.set(key, (texts.get(key) ?? new Set()).add(line.text));
            tones.set(key, line.tone);
        }
    }
    const byLine = {};
    for (const key of texts.keys()) (byLine[key.split(':')[0]] ??= []).push(key.split(':')[1]);
    assert.deepEqual(byLine.sd.sort(), ['disabled', 'incompatible', 'missing', 'ready']);
    assert.deepEqual(byLine.save.sort(), ['missing', 'ready']);
    assert.deepEqual(byLine.clock.sort(), ['ready', 'unknown', 'unset']);
    assert.deepEqual(byLine.area.sort(), ['ready', 'unknown', 'unknown-place', 'unknown-tier']);
    assert.deepEqual(byLine.journal.sort(), ['idle', 'off', 'ready', 'unknown']);
    assert.deepEqual(byLine.social.sort(), ['absent', 'off', 'ready']);
    // No sentence is shared by two states of any line.
    const owner = new Map();
    for (const [key, set] of texts) for (const sentence of set) {
        const prior = owner.get(`${key.split(':')[0]}|${sentence}`);
        assert.ok(prior === undefined || prior === key, `"${sentence}" is the sentence of ${prior} and ${key}`);
        owner.set(`${key.split(':')[0]}|${sentence}`, key);
    }
    assert.equal(tones.get('sd:missing'), 'bad');
    assert.equal(tones.get('clock:unset'), 'warn');
    assert.equal(tones.get('journal:off'), 'neutral');
});

test('C13 dependencies: the Setup page draws all six lines with their states; the banner appears on other pages only when needed', { skip }, () => {
    const { drawn: d } = drawOver(setupScreen, C13.unknownTier());
    assert.deepEqual(d.warnings, []);
    assert.deepEqual(all(d.el, '.dep').map(row => text(row.querySelector('b'))), ['Story Director', 'Save points', 'Story clock', 'Danger here', 'Day recaps', 'Relationships']);
    assert.deepEqual(all(d.el, '.dep .ss-pill').map(text), ['ready', 'ready', 'ready', 'unknown-tier', 'ready', 'ready']);
    assert.equal(all(d.el, '.dep.warn').length, 1);
    assert.equal(all(d.el, '.held li').length, 1);

    const quiet = drawOver(progressScreen, C13.ready()).drawn;
    assert.equal(all(quiet.el, '.banner').length, 0, 'nothing wrong, no banner');
    const dormant = drawOver(progressScreen, { ...C13.missingSd(), 'rules.party': MISSING }).drawn;
    assert.equal(all(dormant.el, '.banner.dormant').length, 1);
    assert.match(text(dormant.el.querySelector('.banner')), /RPG Battle is waiting\. Your story and the other modules keep working\./);
    assert.match(text(dormant.el.querySelector('.state')), /rules are not answering/);
    assert.equal(all(dormant.el, 'article.member').length, 0);
});

test('C13 dependencies: queries that throw, answer null or answer nonsense are all handled, never an error', { skip }, () => {
    const weird = answers({ 'director.contract': () => null, 'savepoint.contract': () => 'yes', 'director.time': () => ({ text: 5 }), 'atlas.canonical': () => 7, 'world.areaTier': () => ({}), 'checks.policy': () => 3 });
    const view = dependencyView(toolsOf(weird));
    assert.equal(view.ready, false);
    assert.equal(view.lines.length, 6);
    assert.ok(view.lines.every(line => typeof line.state === 'string' && typeof line.text === 'string'));
    assert.doesNotThrow(() => setupView({}, {}, toolsOf({})));
    assert.equal(setupView({}, {}, toolsOf({})).deps.ready, false);
    assert.equal(viewOf(progressView, { 'rules.party': () => { throw new TypeError('boom'); } }).state, 'unavailable');
});
