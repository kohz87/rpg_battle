// Track C fixture C13 (dependencies): missing or late Story Director, an unset clock, an unknown tier, and optional journal
// or social being off are distinct states, on the Setup page and in the banner the other pages carry. Required lines decide
// whether RPG Battle is ready; an unset clock and an unknown tier hold only what they touch; optional lines hold nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { progressScreen, setupScreen } from '../../../../src/v2/screens/rules/screens.js';
import { dependencyView } from '../../../../src/v2/screens/rules/deps.js';
import { depsBanner, setupView } from '../../../../src/v2/screens/rules/setup.js';
import { progressView } from '../../../../src/v2/screens/rules/progress.js';
import { C13, HOST, MISSING, answers, rbDormantAnswers } from './fixtures.js';
import { setupActive, rulesActive } from '../../../../src/v2/screens/rules/screens.js';
import { all, drawOver, skip, text, toolsOf, viewOf, withHost } from './helpers.js';

const lines = table => Object.fromEntries(dependencyView(toolsOf(table)).lines.map(line => [line.id, line]));
const states = table => Object.fromEntries(Object.entries(lines(table)).map(([id, line]) => [id, line.state]));

test('C13 dependencies: everything present is ready, and the seven lines are in a fixed order', { skip }, () => {
    const view = dependencyView(toolsOf(C13.ready()));
    assert.deepEqual(view.lines.map(line => line.id), ['sd', 'save', 'clock', 'area', 'journal', 'social', 'rb']);
    assert.deepEqual(states(C13.ready()), { sd: 'ready', save: 'ready', clock: 'ready', area: 'ready', journal: 'ready', social: 'ready', rb: 'unknown' });
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

test('C13 dependencies: the Setup page draws all seven lines with their states; the banner appears on other pages only when needed', { skip }, () => {
    const { drawn: d } = drawOver(setupScreen, C13.unknownTier());
    assert.deepEqual(d.warnings, []);
    assert.deepEqual(all(d.el, '.dep').map(row => text(row.querySelector('b'))), ['Story Director', 'Save points', 'Story clock', 'Danger here', 'Day recaps', 'Relationships', 'RPG Battle']);
    assert.deepEqual(all(d.el, '.dep .ss-pill').map(text), ['ready', 'ready', 'ready', 'unknown-tier', 'ready', 'ready', 'unknown']);
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
    assert.equal(view.lines.length, 7);
    assert.ok(view.lines.every(line => typeof line.state === 'string' && typeof line.text === 'string'));
    assert.doesNotThrow(() => setupView({}, {}, toolsOf({})));
    assert.equal(setupView({}, {}, toolsOf({})).deps.ready, false);
    assert.equal(viewOf(progressView, { 'rules.party': () => { throw new TypeError('boom'); } }).state, 'unavailable');
});

test('C13 dependencies: with RPG Battle dormant, Setup is still offered and still draws every line, reason included', { skip }, () => {
    const table = rbDormantAnswers();
    // None of the rules queries answers, so the old gate would hide the page; the host's module status keeps it.
    const ctx = { query: name => { if (Object.hasOwn(table, name) && table[name] !== MISSING) return table[name]; throw new Error(`No query called "${name}".`); } };
    assert.deepEqual(rulesActive(null, ctx), { on: false });
    assert.deepEqual(withHost(HOST.rbDormant(), () => setupActive(null, ctx)), { on: true });
    assert.deepEqual(withHost(HOST.restoring(), () => setupActive(null, ctx)), { on: true });
    assert.deepEqual(withHost(HOST.ready(), () => setupActive(null, ctx)), { on: false }, 'a ready module without rules queries (an old save) shows nothing new');
    assert.deepEqual(setupActive(null, ctx), { on: false }, 'a host without module status shows nothing new');
    // A legacy chat: the host answers the registered query with null. Only a dormant or restoring module keeps Setup.
    const legacy = { query: () => null };
    assert.deepEqual(withHost(HOST.ready(), () => setupActive(null, legacy)), { on: false }, 'a ready module on a legacy chat shows nothing new');
    assert.deepEqual(withHost(HOST.rbDormant(), () => setupActive(null, legacy)), { on: true });
    assert.deepEqual(withHost(HOST.restoring(), () => setupActive(null, legacy)), { on: true });
    assert.deepEqual(withHost(HOST.ready(), () => setupActive(null, { query: () => ({ pc: null, active: [], reserve: [], temporary: [], activeLimit: 3 }) })), { on: true }, 'a valid rules answer');

    withHost(HOST.rbDormant(), () => {
        const view = dependencyView(toolsOf(table));
        const rb = view.lines.find(line => line.id === 'rb');
        assert.deepEqual([rb.state, rb.tone, rb.required, rb.reason], ['dormant', 'bad', true, 'waiting for story-director']);
        assert.deepEqual([view.ready, view.mode], [false, 'dormant']);
        assert.deepEqual(view.blocking.sort(), ['rb', 'sd']);
        assert.match(view.headline, /RPG Battle is waiting \(waiting for story-director\)\. Your story and the other modules keep working\./);
        const { drawn: d } = drawOver(setupScreen, table);
        assert.deepEqual(d.warnings, []);
        assert.equal(all(d.el, '.dep').length, 7, 'every line is still drawn');
        assert.equal(all(d.el, '.sect.status.dormant').length, 1);
        assert.deepEqual(all(d.el, '.dep .ss-pill').map(text), ['missing', 'ready', 'unknown', 'unknown', 'unknown', 'ready', 'dormant']);
        assert.match(text(all(d.el, '.dep')[6]), /RPG Battle is dormant: waiting for story-director\./);
        // The other pages say the same in their banner, and the Save now button still works (Story Block's own command).
        assert.equal(all(d.el, '.saves .rpg-cb-go').length, 1);
    });
});

test('C13 dependencies: Story Block\'s module status tells a waiting Story Director from a missing or an old one, and restoring from dormant', { skip }, () => {
    const down = answers({ 'director.contract': MISSING });
    const sdState = modules => withHost(modules, () => dependencyView(toolsOf(down)).lines.find(line => line.id === 'sd'));
    assert.equal(sdState(HOST.rbDormant()).state, 'missing', 'not in the module list at all');
    const waiting = sdState(HOST.rbDormantSdWaiting());
    assert.equal(waiting.state, 'dormant');
    assert.match(waiting.text, /installed but waiting: waiting for a peer\./);
    assert.equal(sdState(HOST.sdOld()).state, 'incompatible', 'running, but offers no contract');
    assert.match(sdState(HOST.sdOld()).text, /may be too old/);
    const restoring = withHost(HOST.restoring(), () => dependencyView(toolsOf(answers())));
    assert.equal(restoring.lines.find(line => line.id === 'rb').state, 'restore-pending');
    assert.equal(restoring.ready, false);
    assert.equal(withHost(HOST.ready(), () => dependencyView(toolsOf(answers()))).ready, true);
    assert.equal(withHost(HOST.ready(), () => dependencyView(toolsOf(answers()))).lines.find(line => line.id === 'rb').state, 'ready');
    // A host whose sdk.modules() throws or lacks it reads as unknown, never an error.
    const broken = Object.getOwnPropertyDescriptor(globalThis, 'StoryBlock');
    globalThis.StoryBlock = { sdk: { modules: () => { throw new Error('boom'); } } };
    try { assert.equal(dependencyView(toolsOf(answers())).lines.find(line => line.id === 'rb').state, 'unknown'); } finally { if (broken) Object.defineProperty(globalThis, 'StoryBlock', broken); else delete globalThis.StoryBlock; }
});
