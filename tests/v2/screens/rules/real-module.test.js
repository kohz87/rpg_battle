// Track C on the real module.js + rulesParts, as in progress/real-module.test.js. Only pin/scene setup uses the
// existing test commands; screen queries and every reader action use the real public APIs. SD is the clock adapter
// from the progress tests: the unavailable peer contracts remain gaps, not pretend implementations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { realWorld, DAY } from '../../progress/helpers/world.js';
import { trainersPin, inputsPin, ref } from '../../progress/helpers/fixture.js';
import { createModule } from '../../../../src/v2/module.js';
import { rulesParts } from '../../../../src/v2/rules/index.js';
import { statLine } from '../../../../src/v2/screens/rules/roster.js';
import { rulesScreens, progressView, rosterView, linksView, setupView, classPickerView, questsView } from '../../../../src/v2/screens/rules/index.js';
import { createScreen } from '../../../../src/v2/creation/screen.js';
import { partyScreen } from '../../../../src/v2/screens/party.js';
import { draw, all, text, click } from '../helpers/render.js';
import { pressing, refusals } from './helpers.js';
import { seed } from './fixtures.js';

const ok = out => { assert.equal(out.ok, true, out.message); return out; };
const tools = w => ({ query: w.q });
const forbidden = new Proxy({}, { get() { throw new Error('a screen read private state'); } });
const model = (w, view, args = {}) => view(forbidden, args, tools(w));
function live(w, screen, extra = {}) {
    const names = new Set([...Object.keys(createModule().queries), ...rulesParts.flatMap(([, p]) => Object.keys(p.queries ?? {})),
        'inventory.items', 'inventory.definitions', 'director.time', 'atlas.canonical', 'world.areaTier', 'savepoint.list']);
    return draw(screen, w.head(), { ...extra, queries: { ...Object.fromEntries([...names].map(name => [name, args => w.q(name, args)])), ...(extra.queries ?? {}) }, result: extra.result ?? w.ui });
}
const screen = id => rulesScreens.find(s => s.id === `rpg-battle/${id}`);
const choice = async (d, ref) => {
    await click(all(d.el, 'button').find(b => b.getAttribute('data-choice') === ref));
    await click(all(d.el, 'button').find(b => b.classList.contains('rpg-pc-confirm')));
};
const stable = async w => {
    const snap = () => JSON.stringify({ party: w.q('rules.party'), progress: model(w, progressView), roster: model(w, rosterView),
        training: w.slice('training'), claims: w.head().meta.claims });
    assert.deepEqual(w.problems(), []);
    const before = snap();
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    assert.equal(snap(), before, 'reload preserves the screen projections and commands');
    w.host.store.rebuild();
    assert.equal(snap(), before, 'rebuild preserves the screen projections and commands');
    assert.deepEqual(w.problems(), []);
};

test('C01 real class refs: creation mounts a picker and finishes with exactly three zero-mastery skills', async t => {
    const w = await realWorld(t, { character: false, given: trainersPin(), sd: true });
    const picker = model(w, classPickerView);
    assert.equal(picker.classes.state, 'ready');
    assert.match(picker.classes.pick.options[0].sub, /s00.*s01.*s02/);
    const d = live(w, createScreen, { draft: { name: 'Astra', race: 'rpg-battle/human', talents: [], points: { STR: 4, VIT: 2, AGI: 2, DEX: 2 }, portrait: '', background: '', class: '', checkActor: null } });
    assert.ok(all(d.el, 'button').some(b => b.getAttribute('data-choice') === ref('c0')), 'the actual wizard mounts the class step');
    await click(all(d.el, 'button').find(b => b.getAttribute('data-choice') === ref('c0')));
    all(d.el, 'form')[0].dispatch('submit');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(d.commands[0].type, 'creation.finish');
    assert.equal(d.commands[0].payload.class, ref('c0'));
    assert.ok(w.q('party.pc'), text(d.el));
    const pc = w.q('rules.sheet');
    assert.equal(pc.level, 1);
    assert.deepEqual(pc.skills.map(s => s.mastery), [0, 0, 0]);
    assert.deepEqual(w.q('rules.identity'), { hash: trainersPin().rulesHash, packId: 'fixture', version: '2.0.0' });
    await stable(w);
});

test('C02–C05 real progress: blocked promotion, three-skill swap, waiting order and selected-parent path commands', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    ok(await w.internal('party.grantXp', { actor: w.pc, amount: 8900, claim: 'screen-levels' }));
    const seed = uses => ok(w.ui('test.seed', { actor: w.pc, uses }));
    seed(Object.fromEntries([0, 1, 2].map(n => [ref(`s0${n}-base`), n === 2 ? 34 : 35])));
    let p = model(w, progressView).members[0];
    assert.equal(p.promotions[0].open, false);
    assert.deepEqual(p.pathways.map(s => s.open), [undefined, undefined, undefined, undefined, undefined, undefined]);
    seed({ [ref('s02-base')]: 1 });
    let d = live(w, screen('progress'));
    assert.match(all(d.el, '.rpg-pc-sub')[0].textContent, /s10.*s11.*s12/, 'promotion resolves the real class skill refs');
    await choice(d, ref('c1'));
    assert.deepEqual(w.q('rules.sheet').skills.map(s => s.mastery), [0, 0, 0]);
    for (let tier = 1; tier < 3; tier += 1) {
        seed(Object.fromEntries([0, 1, 2].map(n => [ref(`s${tier}${n}-base`), 35])));
        d = live(w, screen('progress'));
        await choice(d, ref(`c${tier + 1}`));
    }
    seed(Object.fromEntries([0, 1, 2].map(n => [ref(`s3${n}-base`), 35])));
    d = live(w, screen('progress'));
    await choice(d, ref('s30-base-a'));
    seed({ [ref('s30-base-a')]: 35 });
    d = live(w, screen('progress'));
    await choice(d, ref('s30-base-a-g'));
    assert.equal(w.q('rules.sheet').skills[0].form, ref('s30-base-a-g'));
    assert.equal(w.q('rules.sheet').skills[0].mastery, 0);
    await stable(w);
});

test('C06 real training: request button, midnight completion and recorded interruption/refusal are rendered', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    const start = 4 * DAY + 1410;
    await w.say('Haven.', [`~ time ${start}`, '~ here pack.fixture/haven']);
    ok(w.ui('test.coin', { amount: 100 }));
    const d = live(w, screen('progress'));
    await click(pressing(d.el, 'Ask for training')[0]);
    assert.equal(w.q('rules.training', { actor: w.pc }).session.status, 'requested');
    await w.say('Lesson.', ['~ here pack.fixture/haven']);
    const session = w.q('rules.training', { actor: w.pc }).session;
    assert.equal(session.endMinute, 5 * DAY + 30, JSON.stringify(session));
    assert.ok(['completed', 'interrupted'].includes(session.status));
    const train = model(w, progressView).members[0].training;
    assert.equal(train.state, session.status);
    if (session.event?.template) assert.ok(train.lines.some(line => line.includes(session.event.template)));
    assert.deepEqual(w.problems(), []);
    await stable(w);
});

test('real training refusal remains visible and the next request is available', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    const offer = w.q('rules.training', { actor: w.pc }).offers[0];
    ok(w.ui('skill.train', offer.payload));
    ok(w.ui('skill.cancelTrain', { actor: w.pc, session: offer.session }));
    const train = model(w, progressView).members[0].training;
    assert.equal(train.state, 'refused');
    assert.match(train.headline, /Training refused/);
    assert.ok(train.lines.includes('The player withdrew the request.'));
    assert.ok(train.offers.length > 0);
    await stable(w);
});

test('real STALE training click shows the module\'s own refusal on the page, with the full payload sent', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    await w.say('Haven.', [`~ time ${4 * DAY + 600}`, '~ here pack.fixture/haven']);
    ok(w.ui('test.coin', { amount: 100 }));
    const offer = w.q('rules.training', { actor: w.pc }).offers[0];
    const d = live(w, screen('progress'));
    assert.deepEqual(refusals(d.el), []);
    // The page was drawn with this offer; the world moves on (asked for, then withdrawn) so the drawn session is out of date.
    ok(w.ui('skill.train', offer.payload));
    ok(w.ui('skill.cancelTrain', { actor: w.pc, session: offer.session }));
    const stale = w.ui('skill.train', offer.payload);
    assert.equal(stale.code, 'STALE');
    await click(pressing(d.el, 'Ask for training')[0]);
    assert.deepEqual(d.commands.at(-1), { type: 'skill.train', payload: offer.payload }, 'the whole payload, as the offer built it');
    assert.deepEqual(refusals(d.el), [stale.message], 'the real STALE answer is shown');
    assert.match(stale.message, /out of date/);
    assert.equal(w.q('rules.training', { actor: w.pc }).session?.status, 'refused', 'the refused click changed nothing');
    assert.deepEqual(w.problems(), []);
});

test('real refused quest click shows the host\'s own refusal (the quest commands are not in this build)', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    const quest = { ...seed.quest, state: 'offered', ready: false, blocked: [], remainingMinutes: null };
    // Story Director's threads and the host's own commands are real; only the quest list (Track A's query) is a stand-in.
    const asked = (name, args) => (name === 'rules.quests' ? [quest] : w.q(name, args));
    const d = live(w, screen('quests'), { queries: { 'rpg-battle.questsView': args => questsView(w.head(), args, { query: asked }) } });
    const refused = w.ui('quest.take', { id: quest.id });
    assert.equal(refused.ok, false);
    await click(pressing(d.el, 'Take')[0]);
    assert.deepEqual(d.commands, [{ type: 'quest.take', payload: { id: quest.id } }]);
    assert.deepEqual(refusals(d.el), [refused.message]);
    assert.ok(refused.message.length > 0);
});

test('C08 real party Accept carries a selected class; four companions give PC+2 and two reserves', async t => {
    const w = await realWorld(t, { reader: { 'party.maxCompanions': 4 } });
    await w.say('A companion offers to join.', ['+ join Lyra — ranger']);
    const d = live(w, partyScreen);
    assert.equal(w.q('party.offers').length, 1);
    await choice(d, ref('c0'));
    assert.equal(w.q('rules.party').active.length, 2);
    assert.equal(w.q('rules.party').active[1].class, ref('c0'));
    for (const name of ['Bram', 'Cass', 'Dov']) ok(await w.internal('party.addCompanion', { name, level: 1, class: ref('c0') }));
    let r = model(w, rosterView);
    assert.equal(r.active.length, 3);
    assert.equal(r.reserve.length, 2);
    ok(w.ui('test.unit', { id: 'ac_wolf0001', owner: w.pc }));
    ok(w.ui('test.unit', { id: 'ac_spark001', owner: w.pc, name: 'Spark', kind: 'pet' }));
    r = model(w, rosterView);
    assert.equal(r.temporary.length, 2);
    const dismiss = r.temporary[0].dismissButton;
    ok(w.ui(dismiss.command, dismiss.payload));
    assert.equal(model(w, rosterView).temporary.length, 1);
    const roster = live(w, screen('roster'));
    await click(all(roster.el, 'button').find(b => text(b) === 'Rest in reserve'));
    r = model(w, rosterView);
    const makeActive = r.reserve.at(-1).activateButton;
    ok(w.ui(makeActive.command, makeActive.payload));
    assert.equal(model(w, rosterView).active.length, 3);
    await stable(w);
});

test('C03 real mastered forms award zero while XP continues', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    ok(w.ui('test.seed', { actor: w.pc, uses: Object.fromEntries([0, 1, 2].map(n => [ref(`s0${n}-base`), 35])) }));
    await w.say('More practice.', ['~ time 14400', `! skill-use ${w.pc} | skill: ${ref('s00')} | form: ${ref('s00-base')}`]);
    assert.ok(Object.values(w.slice('progress').credits).some(c => c.award === 0 && c.reason === 'mastered'));
    ok(await w.internal('party.grantXp', { actor: w.pc, amount: 25, claim: 'screen-more-xp' }));
    const m = model(w, progressView).members[0];
    assert.deepEqual(m.skills.map(s => s.mastery), [5, 5, 5]);
    assert.match(m.xpText, /XP 25/);
    await stable(w);
});

test('C14 real deletion closes the screen promotion without a replacement', async t => {
    const w = await realWorld(t, { given: trainersPin(), sd: true });
    ok(w.ui('test.seed', { actor: w.pc, uses: Object.fromEntries([0, 1, 2].map(n => [ref(`s0${n}-base`), 35])) }));
    await w.say('The reward.');
    ok(await w.internal('party.grantXp', { actor: w.pc, amount: 900, claim: 'screen-promotion-xp' }));
    const at = w.host.ctx.chat.findIndex(m => !m.is_user && m.mes.includes('The reward.'));
    await w.say('The decision.');
    const d = live(w, screen('progress'));
    await choice(d, ref('c1'));
    assert.equal(w.q('rules.sheet').class, ref('c1'));
    await w.host.st.deleteMessage(at);
    await w.host.st.deleteMessage(at - 1);
    assert.equal(w.q('rules.sheet').class, ref('c0'));
    assert.equal(model(w, progressView).members[0].promotions.length, 0);
    assert.ok(w.problems().some(p => p.code === 'REPLAY_PREREQUISITE'));
});

test('C09 Roster reads inventory.items only, with poisoned state and real item definitions', async t => {
    const w = await realWorld(t, { given: inputsPin(), sd: true });
    ok(w.ui('test.packDefs'));
    ok(await w.internal('inventory.grant', { def: ref('sword'), qty: 1, to: 'party' }));
    const r = model(w, rosterView);
    assert.equal(r.active[0].bag[0].name, 'Iron Sword');
    assert.equal(r.active[0].bag[0].blocked.length > 0, true, 'missing track A plan is shown as a hold');
    assert.deepEqual(w.problems(), []);
});

test('Roster shows the real stats of a real equipped companion\'s sword (items.gear gives a record, not a string)', async t => {
    const w = await realWorld(t, { given: inputsPin(), sd: true, companions: ['Bram'] });
    const [bram] = w.mates;
    ok(w.ui('test.packDefs'));
    const granted = ok(await w.internal('inventory.grant', { def: ref('sword'), qty: 1, to: 'party' }));
    const stack = w.q('inventory.items').find(item => item.def === ref('sword')).stack;
    assert.ok(stack, JSON.stringify(granted.receipt?.data));
    ok(w.ui('item.equip', { stack, to: bram }));
    const worn = w.q('items.gear', { actor: bram }).counted.find(entry => entry.stack === stack);
    assert.deepEqual(worn.stats, { ATK: 3 }, 'the real answer is a record');
    const view = model(w, rosterView);
    const tile = view.active.find(member => member.id === bram).tiles.find(item => item.key === 'weapon');
    assert.deepEqual([tile.filled, tile.name, tile.stats], [true, 'Iron Sword', 'ATK +3']);
    const d = live(w, screen('roster'));
    const card = all(d.el, 'article.member')[view.active.findIndex(member => member.id === bram)];
    assert.match(text(card), /Iron Sword/);
    assert.deepEqual(all(card, '.rpg-eq-sub').map(text), ['ATK +3'], 'the equipment tile shows the stats');
    assert.deepEqual(d.problems, []);
    assert.deepEqual(d.warnings, []);
});

test('statLine formats a stat record as text: signs, zero and non-numbers dropped, a name with markup stays text, a string is cut', () => {
    assert.equal(statLine({ ATK: 3, DEF: -1, SPD: 0, BAD: 'x' }), 'ATK +3, DEF -1');
    assert.equal(statLine({}), '');
    assert.equal(statLine(null), '');
    assert.equal(statLine(undefined), '');
    assert.equal(statLine({ '<b>ATK</b>': 2 }), '<b>ATK</b> +2');
    assert.equal(statLine('ATK +9'), 'ATK +9');
    assert.equal(Array.from(statLine('x'.repeat(500))).length, 120);
    assert.equal(Array.from(statLine({ ['K'.repeat(300)]: 1 })).length, 120);
});

test('C13–C19 real queries: setup lists host saves, links reads actual flags/item rules; unavailable peers are visible', async t => {
    const w = await realWorld(t, { given: inputsPin(), sd: true });
    ok(w.ui('test.packDefs'));
    const setup = model(w, setupView);
    assert.equal(setup.saves.state, 'ready');
    const setupScreen = live(w, screen('setup'), { result: (type, payload) => w.host.sdk.command(type, payload) });
    await click(all(setupScreen.el, 'button').find(b => text(b) === 'Save now'));
    assert.ok(w.q('savepoint.list').some(p => p.kind === 'manual'), 'Setup sends the real SDK save command');
    assert.equal(setup.deps.ready, false, 'director.contract is not supplied by the training clock adapter');
    const links = model(w, linksView);
    assert.equal(links.inputs.flagsState, 'ready');
    assert.equal(links.checks.state, 'unavailable');
    assert.equal(links.world.state, 'unavailable');
    assert.deepEqual(w.q('rules.item', { def: ref('sword') }), { def: ref('sword'), allowedSlots: ['weapon'], hands: 1, requires: { STR: 3 }, weight: 5, unique: false });
    assert.equal('frozen' in w.q('rules.item', { def: ref('sword') }), false);
    for (const s of rulesScreens) {
        const d = live(w, s);
        assert.deepEqual(d.problems, [], s.id);
        assert.deepEqual(d.warnings, [], s.id);
    }
    await stable(w);
});

test('screen queries never reach into state, and their rendering uses safe DOM helpers', () => {
    for (const name of ['progress', 'roster', 'links', 'setup', 'widgets', 'class-step']) {
        const source = readFileSync(new URL(`../../../../src/v2/screens/rules/${name}.js`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /state\??\.domains|innerHTML|outerHTML|insertAdjacentHTML/);
    }
});
