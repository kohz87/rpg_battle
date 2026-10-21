// The wizard screen `rpg-battle/create` (SPEC §13.1, §13.2, §13.6) and its opener. The screen is
// checked by Story Block's screen validator and rendered by Story Block's template renderer, real
// condition language and real widgets, loaded from the vendored Story Block runtime
// (tests/vendor/story-block, `npm run sync-testkit`), with the screens tests' fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CREATE_SCREEN_ID, CREATE_STEPS, createScreen, onBlocked, openCreation, part, startDraft } from '../../../src/v2/creation/index.js';
import { makeHost, points } from './helpers/fake-host.js';
import { installDom } from '../screens/helpers/dom.js';
import { PACKS } from './helpers/packs.js';

const ROOTS = [fileURLToPath(new URL('../../vendor/story-block', import.meta.url))];
const has = (root, files) => files.every(file => existsSync(`${root}/${file}`));
const RENDER_FILES = ['src/v2/view/template/index.js', 'src/v2/view/bind.js', 'src/v2/view/css.js', 'src/v2/events/index.js', 'src/v2/view/widgets/index.js'];
const RENDERER = ROOTS.find(root => has(root, RENDER_FILES)) ?? null;
const SCREENS = ROOTS.find(root => has(root, ['src/v2/view/screens.js'])) ?? null;
const load = (root, file) => import(pathToFileURL(`${root}/${file}`).href);
const NO_RENDERER = RENDERER ? false : 'Story Block\'s template renderer (src/v2/view/template/) is not vendored: run npm run sync-testkit';

test('the screen definition: a dialog with five steps and the creation queries', () => {
    assert.equal(createScreen.id, CREATE_SCREEN_ID);
    assert.equal(CREATE_SCREEN_ID, 'rpg-battle/create');
    assert.deepEqual(createScreen.mounts, ['dialog']);
    assert.deepEqual(CREATE_STEPS.map(step => step.id), ['start', 'race', 'talents', 'stats', 'you']);
    assert.deepEqual(createScreen.data, { c: { query: 'creation.content' } });
    assert.ok(part.queries[createScreen.data.c.query]);
    assert.deepEqual(part.screens, [createScreen]);
    // Only the last step submits, and it submits creation.finish.
    assert.deepEqual(CREATE_STEPS.map(step => /data-submit="creation\.finish"/.test(step.template)), [false, false, false, false, true]);
    assert.ok(part.commands['creation.finish']);
    // No name or background inputs: both come from the persona (MODULES §F22).
    for (const step of CREATE_STEPS) assert.doesNotMatch(step.template, /data-draft="(?:name|background)"/);
    assert.ok(createScreen.css.length < 64 * 1024);
});

test('Story Block\'s screen validator accepts it', { skip: SCREENS ? false : 'Story Block\'s src/v2/view/screens.js is not vendored: run npm run sync-testkit' }, async () => {
    const { validateScreen } = await load(SCREENS, 'src/v2/view/screens.js');
    assert.deepEqual(validateScreen(JSON.parse(JSON.stringify(createScreen))), []);
});

// ---------------------------------------------------------------------------------------------------

async function renderer() {
    const [{ compileTemplate, renderTemplate }, { conditionEvaluator }, { scopeCss }, { compile, evaluate }, { standardWidgets }] = await Promise.all(
        RENDER_FILES.map(file => load(RENDERER, file)),
    );
    return { compileTemplate, renderTemplate, evaluate: conditionEvaluator({ compile, evaluate }), scopeCss, standardWidgets, installFakeDom: installDom };
}

/** Draws one step as the dialog would: q from the screen's data, the draft, the module's settings, and query. */
async function draw(stepId, { draft, settings = {}, host = makeHost({ settings }), onSubmit } = {}) {
    const r = await renderer();
    const doc = r.installFakeDom();
    doc.createElementNS ??= (_ns, tag) => doc.createElement(tag);   // the radar draws SVG
    const props = {};
    const widgets = Object.fromEntries(Object.entries({ ...r.standardWidgets, ...part.widgets }).map(([name, def]) => [name, {
        ...def,
        render(el, given, api) {
            (props[name] ??= []).push(given);
            return def.render(el, given, api);
        },
    }]));
    const step = CREATE_STEPS.find(entry => entry.id === stepId);
    const compiled = r.compileTemplate(step.template);
    assert.deepEqual(compiled.warnings, [], `${stepId}: template warnings`);
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const scope = { state: host.state, q: { c: host.query('creation.content', {}) }, draft, settings: { ...part.settings.defaults, ...settings }, query: (name, args) => host.query(name, args) };
    const view = r.renderTemplate(el, compiled, scope, { evaluate: r.evaluate, widgets, onSubmit });
    assert.deepEqual(view.warnings, [], `${stepId}: render warnings`);
    return { el, view, props, host, draft };
}

test('the steps and the one-page template compile, and the css scopes, without a warning', { skip: NO_RENDERER }, async () => {
    const r = await renderer();
    for (const template of [...CREATE_STEPS.map(step => step.template), createScreen.template]) assert.deepEqual(r.compileTemplate(template).warnings, []);
    assert.deepEqual(r.scopeCss(createScreen.css, CREATE_SCREEN_ID).warnings, []);
});

test('start step: the packs\' ready-made characters; choosing one fills race, talents and points, My own clears them', { skip: NO_RENDERER }, async () => {
    const draft = startDraft(null, { persona: { name: 'Wessel', background: 'A boatman.', avatar: '' } });
    const host = makeHost({ packs: PACKS });
    const { el, view } = await draw('start', { draft, host });
    const cards = el.querySelectorAll('.rpg-preset');
    assert.equal(cards.length, 1);
    assert.equal(el.querySelectorAll('.rpg-preset-name')[0].textContent, 'Wessel (kit)');
    assert.equal(el.querySelectorAll('.rpg-preset-skills')[0].textContent, 'Skills: Cane Draw, Shadow Cut');
    el.querySelectorAll('.rpg-preset-go')[0].dispatch('click');
    const after = view.draft();
    assert.equal(after.preset, 'pack.ersveil/wessel-kit');
    assert.equal(after.race, 'pack.ersveil/human');
    assert.deepEqual(after.talents, ['pack.ersveil/shadow-bent', 'pack.ersveil/river-born']);
    assert.deepEqual(after.points, points({ VIT: 1, AGI: 2, DEX: 3, INT: 1, LUK: 1 }));
    assert.equal(after.name, 'Wessel', 'the name stays the persona\'s');
    assert.equal(after.background, 'A boatman.');
    el.querySelector('.rpg-preset-own').dispatch('click');
    assert.equal(view.draft().preset, '');
    assert.deepEqual(view.draft().talents, []);
});

test('start step says so when no pack has ready-made characters', { skip: NO_RENDERER }, async () => {
    const draft = startDraft(null, { persona: { name: 'Ren', background: '', avatar: '' } });
    const { el } = await draw('start', { draft });
    assert.equal(el.querySelectorAll('.rpg-preset').length, 0);
    assert.match(el.querySelector('.cc-none').textContent, /no ready-made characters/);
});

test('race step: one card per race; picking fills draft.race', { skip: NO_RENDERER }, async () => {
    const draft = startDraft(null, { persona: { name: 'Ren', background: '', avatar: '' } });
    const { el, view } = await draw('race', { draft });
    const radios = el.querySelectorAll('input[type="radio"]');
    assert.equal(radios.length, 6);
    assert.equal(el.querySelectorAll('.cc-card-name').map(node => node.textContent).join(','), 'Human,Elf,Dwarf,Hearthling,Tuskborn,Starborn');
    radios[1].checked = true;
    radios[1].dispatch('change');
    assert.equal(view.draft().race, 'rpg-battle/elf');
});

test('race and talent steps say so when the story has none', { skip: NO_RENDERER }, async () => {
    const settings = { builtInChoices: false };
    const host = makeHost({ settings });
    const r = await renderer();
    const doc = r.installFakeDom();
    for (const id of ['race', 'talents']) {
        const el = doc.createElement('div');
        const scope = { state: host.state, q: { c: host.query('creation.content', { settings }) }, draft: startDraft(), settings, query: host.query };
        const view = r.renderTemplate(el, r.compileTemplate(CREATE_STEPS.find(step => step.id === id).template), scope, { evaluate: r.evaluate, widgets: r.standardWidgets });
        assert.deepEqual(view.warnings, []);
        assert.match(el.querySelector('.cc-none').textContent, /no (races|talents) to choose from/);
        assert.equal(el.querySelectorAll('input').length, 0);
    }
});

test('talents step: costs, the live points left, rolled talents kept and not offered twice', { skip: NO_RENDERER }, async () => {
    const host = makeHost();
    const roll = host.command('creation.rollTalent', {}, { seed: 9 });
    const rolled = roll.receipt.data.talent;
    const draft = { ...startDraft(), talents: ['rpg-battle/keen-eyes'], points: points({ STR: 2 }) };
    const { el, view } = await draw('talents', { draft, host });
    assert.equal(el.querySelectorAll('.cc-talent').length, 11, 'the rolled talent is listed as kept, not as a box');
    assert.equal(el.querySelectorAll('.cc-rolled li').length, 1);
    assert.match(el.querySelector('.cc-rolled li').textContent, new RegExp(roll.receipt.data.name));
    // 10 − 1 (Keen Eyes) − the rolled talent's cost − 2 on STR
    assert.equal(el.querySelector('.cc-left b').textContent, String(10 - 1 - roll.receipt.data.cost - 2));
    const box = el.querySelectorAll('.cc-talent input').find(input => input.getAttribute('value') === 'rpg-battle/iron-gut');
    box.checked = true;
    box.dispatch('change');
    assert.deepEqual(view.draft().talents, ['rpg-battle/keen-eyes', 'rpg-battle/iron-gut']);
    assert.equal(el.querySelector('.cc-left b').textContent, String(10 - 2 - roll.receipt.data.cost - 2));
    assert.notEqual(rolled, 'rpg-battle/iron-gut');
});

test('stats step: a stepper per stat under the live budget, and the radar of the final stats', { skip: NO_RENDERER }, async () => {
    const draft = { ...startDraft(), race: 'rpg-battle/dwarf', talents: ['rpg-battle/bookish'], points: points({ STR: 2 }) };
    const { el, props, view } = await draw('stats', { draft });
    const steppers = props['ss.stepper'];
    assert.deepEqual(steppers.map(p => p.name), ['points.STR', 'points.VIT', 'points.AGI', 'points.DEX', 'points.INT', 'points.LUK', 'points.CHA']);
    assert.deepEqual(steppers.map(p => p.budget), [7, 7, 7, 7, 7, 7, 7]);
    assert.equal(steppers[0].value, 2);
    assert.equal(steppers[0].max, 94);
    assert.deepEqual(props['ss.radar'][0].axes.map(axis => axis.value), [7, 7, 4, 5, 7, 5, 5]);
    // A stepper moving fills the draft; the budget everyone sees follows.
    el.querySelectorAll('.ss-w-stepper button').find(button => /Increase Vitality/.test(button.getAttribute('aria-label') ?? '')).click();
    assert.equal(view.draft().points.VIT, 1);
    assert.equal(el.querySelector('.cc-left b').textContent, '6');
});

test('you step: the persona\'s name and background shown, not edited; submit sends creation.finish', { skip: NO_RENDERER }, async () => {
    const persona = { name: 'Ren Avel', background: 'A ferryman\'s daughter from Bluewatch.', avatar: '/User Avatars/ren.png' };
    const draft = { ...startDraft(null, { persona }), race: 'rpg-battle/elf', talents: ['rpg-battle/keen-eyes'], points: points({ STR: 4, DEX: 5 }) };
    const sent = [];
    const host = makeHost();
    const { el, props } = await draw('you', { draft, host, onSubmit: (type, payload) => sent.push({ type, payload }) });
    assert.equal(el.querySelector('.cc-name b').textContent, 'Ren Avel');
    assert.match(el.querySelector('.cc-from').textContent, /Persona Management/);
    assert.equal(el.querySelector('.cc-background-text').textContent, persona.background);
    assert.equal(el.querySelectorAll('input').length, 1, 'only the portrait can be changed here');
    assert.equal(props['ss.portrait'][0].src, '/User Avatars/ren.png');
    assert.equal(el.querySelector('.cc-problem').textContent, '');
    el.querySelector('form').dispatch('submit');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'creation.finish');
    const out = host.command(sent[0].type, sent[0].payload);
    assert.equal(out.ok, true, out.message);
    assert.equal(host.state.domains.party.actors[host.state.domains.party.pc].background, persona.background);
});

test('you step: an unfinished draft shows the rule it breaks', { skip: NO_RENDERER }, async () => {
    const draft = { ...startDraft(null, { persona: { name: 'Ren' } }), race: 'rpg-battle/elf' };
    const { el } = await draw('you', { draft });
    assert.equal(el.querySelector('.cc-problem').textContent, 'Spend every point: 10 points left.');
});

// ---------------------------------------------------------------------------------------------------
// The opener

function fakeDialogApi({ state = null } = {}) {
    const opened = [];
    const api = {
        view: () => ({ state, persona: { name: 'Ren', background: 'From the river.', avatar: 'ren.png' } }),
        dialog: {
            current: () => opened.filter(entry => entry.isOpen()).at(-1) ?? null,
            open(screenId, opts) {
                const handle = { screenId, opts, draft: structuredClone(opts.draft), step: 0, open: true, isOpen() { return this.open; }, goTo(i) { this.step = i; } };
                opened.push(handle);
                return handle;
            },
        },
    };
    return { api, opened };
}

test('openCreation opens the wizard with the persona in the draft and Random on creation.rollTalent', () => {
    const { api, opened } = fakeDialogApi();
    const out = openCreation(api);
    assert.equal(out.ok, true);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].screenId, 'rpg-battle/create');
    assert.equal(opened[0].opts.random, 'creation.rollTalent');
    assert.deepEqual(opened[0].opts.draft, {
        name: 'Ren', background: 'From the river.', preset: '', race: '', talents: [],
        points: points(), portrait: '/thumbnail?type=persona&file=ren.png',
    });
    // Asked again while it is open: the same window.
    assert.equal(openCreation(api).handle, opened[0]);
    assert.equal(opened.length, 1);
    // A pack's ready-made character pre-fills race, talents, stats, never the name or background.
    opened[0].open = false;
    openCreation(api, { draft: { name: 'Wessel', background: 'Not yours.', race: 'rpg-battle/dwarf', talents: ['rpg-battle/stubborn'], points: { STR: 4, VIT: 6 } } });
    assert.equal(opened[1].opts.draft.name, 'Ren');
    assert.equal(opened[1].opts.draft.background, 'From the river.');
    assert.equal(opened[1].opts.draft.race, 'rpg-battle/dwarf');
    assert.deepEqual(opened[1].opts.draft.points, points({ STR: 4, VIT: 6 }));
});

test('openCreation: after a kept roll the wizard comes back at Talents with the same draft', async () => {
    const { api, opened } = fakeDialogApi();
    openCreation(api);
    opened[0].draft.race = 'rpg-battle/elf';
    opened[0].draft.points.STR = 3;
    opened[0].open = false;
    opened[0].opts.onDone({ ok: true, receipt: { type: 'creation.rollTalent', data: { talent: 'rpg-battle/iron-gut' } } });
    await Promise.resolve();
    assert.equal(opened.length, 2);
    assert.equal(opened[1].step, CREATE_STEPS.findIndex(step => step.id === 'talents'));
    assert.equal(opened[1].opts.draft.race, 'rpg-battle/elf');
    assert.equal(opened[1].opts.draft.points.STR, 3);
    // Finishing does not reopen it.
    opened[1].open = false;
    opened[1].opts.onDone({ ok: true, receipt: { type: 'creation.finish' } });
    await Promise.resolve();
    assert.equal(opened.length, 2);
});

test('openCreation refuses without a dialog or once there is a character; onBlocked uses the host sdk', () => {
    assert.equal(openCreation({}).code, 'NO_DIALOG');
    const withPc = { domains: { party: { pc: 'ac_aaaaaaaa', actors: { ac_aaaaaaaa: { id: 'ac_aaaaaaaa' } } } } };
    assert.equal(openCreation(fakeDialogApi({ state: withPc }).api).code, 'REFUSED');
    const { api, opened } = fakeDialogApi();
    const before = globalThis.StoryBlock;
    try {
        globalThis.StoryBlock = { sdk: api };
        onBlocked('Create your character first.', 'story-director');
        assert.equal(opened.length, 0, 'another module\'s block is not ours');
        onBlocked('Create your character first.', 'rpg-battle');
        assert.equal(opened.length, 1);
        globalThis.StoryBlock = { sdk: fakeDialogApi({ state: withPc }).api };
        onBlocked('Something else.', 'rpg-battle');
    } finally {
        globalThis.StoryBlock = before;
    }
    assert.doesNotThrow(() => onBlocked('x', 'rpg-battle'));
});
