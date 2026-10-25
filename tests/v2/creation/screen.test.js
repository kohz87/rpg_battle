// The wizard screen `rpg-battle/create` (SPEC §13.1, §13.2, §13.6) and its opener. The screen is
// checked by Story Block's screen validator and rendered by Story Block's template renderer, real
// condition language and real widgets, loaded from the vendored Story Block runtime
// (tests/vendor/story-block, `npm run sync-testkit`), with the screens tests' fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    CREATED_EVENT, CREATE_SCREEN_ID, DRAFT_START_WIDGET, renderDraftStart, CREATE_STEPS, FILE_LIMIT, cardImage, characterFrom, createScreen, createdNotice, creationContent, onBlocked, openCreation, part, startDraft, toggled,
} from '../../../src/v2/creation/index.js';
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
    assert.deepEqual(createScreen.data, { c: { query: 'creation.content' }, k: { query: 'rpg-battle.classPicker' } });
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
async function draw(stepId, { draft, settings = {}, host = makeHost({ settings }), onSubmit, command = null, apiExtra = {} } = {}) {
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
    // The wizard's widgets get the dialog's api: preview and commit on the host, commands recorded
    // (or run by `command`), and the draft (the renderer adds it).
    const sent = [];
    const api = { preview: (type, payload) => host.preview(type, payload), commit: token => host.commit(token), ...apiExtra };
    const run = (type, payload) => {
        sent.push({ type, payload });
        return command ? command(type, payload) : host.command(type, payload);
    };
    const view = r.renderTemplate(el, compiled, scope, { evaluate: r.evaluate, widgets, onSubmit, api, command: run });
    assert.deepEqual(view.warnings, [], `${stepId}: render warnings`);
    return { el, view, props, host, draft, sent, r, compiled, scope, widgets };
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

test('race step: one button per race; a click picks it, a second click on it clears it', { skip: NO_RENDERER }, async () => {
    const draft = startDraft(null, { persona: { name: 'Ren', background: '', avatar: '' } });
    const { el, view } = await draw('race', { draft });
    const cards = () => el.querySelectorAll('button.cc-card');
    assert.equal(cards().length, 6);
    assert.equal(el.querySelectorAll('input').length, 0, 'no radios: SillyTavern\'s sanitiser drops their type');
    assert.equal(el.querySelectorAll('.cc-card img').length, 0, 'no picture box for a race without a real image (the registration card\'s portrait is the persona\'s)');
    assert.equal(el.querySelectorAll('.cc-card-name').map(node => node.textContent).join(','), 'Human,Elf,Dwarf,Hearthling,Tuskborn,Starborn');
    assert.ok(cards().every(card => card.getAttribute('aria-pressed') === 'false'));
    cards()[1].click();
    assert.equal(view.draft().race, 'rpg-battle/elf');
    assert.deepEqual(cards().map(card => card.getAttribute('aria-pressed')), ['false', 'true', 'false', 'false', 'false', 'false']);
    cards()[2].click();
    assert.equal(view.draft().race, 'rpg-battle/dwarf', 'another card moves the pick');
    cards()[2].click();
    assert.equal(view.draft().race, '', 'the picked card again: back to no race');
    assert.ok(cards().every(card => card.getAttribute('aria-pressed') === 'false'));
    assert.doesNotMatch(el.textContent, /rpg-battle\//, 'never a raw id on the page');
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
    assert.equal(el.querySelectorAll('.cc-talent-list button.cc-card').length, 11, 'the rolled talent is listed as kept, not as a card');
    assert.equal(el.querySelectorAll('.cc-rolled li').length, 1);
    assert.match(el.querySelector('.cc-rolled li').textContent, new RegExp(roll.receipt.data.name));
    // 10 − 1 (Keen Eyes) − the rolled talent's cost − 2 on STR
    assert.equal(el.querySelector('.cc-left b').textContent, String(10 - 1 - roll.receipt.data.cost - 2));
    const card = id => el.querySelectorAll('.cc-talent-list button.cc-card').find(node => node.getAttribute('data-choice') === id);
    assert.equal(card('rpg-battle/keen-eyes').getAttribute('aria-pressed'), 'true');
    card('rpg-battle/iron-gut').click();
    assert.deepEqual(view.draft().talents, ['rpg-battle/keen-eyes', 'rpg-battle/iron-gut']);
    assert.equal(card('rpg-battle/iron-gut').getAttribute('aria-pressed'), 'true');
    assert.equal(el.querySelector('.cc-left b').textContent, String(10 - 2 - roll.receipt.data.cost - 2));
    // A second click takes it off again, and the points come back.
    card('rpg-battle/keen-eyes').click();
    assert.deepEqual(view.draft().talents, ['rpg-battle/iron-gut']);
    assert.equal(card('rpg-battle/keen-eyes').getAttribute('aria-pressed'), 'false');
    assert.equal(el.querySelector('.cc-left b').textContent, String(10 - 1 - roll.receipt.data.cost - 2));
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
    assert.deepEqual(props['rpg-battle.stat-radar'][0].axes.map(axis => axis.value), [7, 7, 4, 5, 7, 5, 5]);
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
                const listeners = [];
                const root = {
                    addEventListener(type, fn) { listeners.push({ type, fn }); },
                    dispatch(type, init = {}) { for (const entry of listeners) if (entry.type === type) entry.fn({ type, ...init }); },
                };
                const handle = {
                    screenId, opts, root, draft: structuredClone(opts.draft), step: 0, open: true,
                    isOpen() { return this.open; }, goTo(i) { this.step = i; }, close(result) { this.open = false; this.closedWith = result; },
                };
                opened.push(handle);
                return handle;
            },
        },
    };
    return { api, opened };
}

test('openCreation opens the wizard with the persona in the draft, and no Random in the dialog\'s footer', () => {
    const { api, opened } = fakeDialogApi();
    const out = openCreation(api);
    assert.equal(out.ok, true);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].screenId, 'rpg-battle/create');
    // Random is the Talents step's own widget, so the footer (on every step) has none.
    assert.equal(opened[0].opts.random, undefined);
    assert.deepEqual(CREATE_STEPS.map(step => step.template.includes('rpg-battle.talent-roll')), [false, false, true, false, false]);
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

test('openCreation: an import that made the character closes the wizard; nothing else does', () => {
    const { api, opened } = fakeDialogApi();
    openCreation(api);
    const handle = opened[0];
    assert.equal(handle.closedWith, undefined);
    handle.root.dispatch('click');
    assert.equal(handle.open, true);
    handle.root.dispatch(CREATED_EVENT, { detail: { result: { ok: true } } });
    assert.equal(handle.open, false);
    assert.deepEqual(handle.closedWith, { ok: true });
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

// ---------------------------------------------------------------------------------------------------
// Random on the Talents step, Points left once, Import character on the Start step

test('talents step: Random talent previews creation.rollTalent with the draft; Keep commits that roll and the step shows it kept', { skip: NO_RENDERER }, async () => {
    const draft = { ...startDraft(null, { persona: { name: 'Ren', background: '', avatar: '' } }), talents: ['rpg-battle/keen-eyes'], points: points({ STR: 2 }) };
    const host = makeHost();
    const { el, view } = await draw('talents', { draft, host });
    const go = el.querySelector('.rpg-roll-go');
    assert.equal(go.textContent, 'Random talent');
    assert.equal(el.querySelector('.rpg-roll-keep').hidden, true);
    go.dispatch('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    const shown = el.querySelector('.rpg-roll-result').textContent;
    assert.match(shown, /^Rolled talent: .+ \(\d+ points?/);
    assert.equal(el.querySelector('.rpg-roll-keep').hidden, false);
    assert.equal(go.textContent, 'Roll again');
    assert.deepEqual(host.state.domains.creation.rolled, [], 'a preview stores nothing');
    el.querySelector('.rpg-roll-keep').dispatch('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(host.state.domains.creation.rolled.length, 1, 'Keep commits the previewed roll');
    const kept = host.state.domains.creation.rolled[0];
    assert.ok(shown.includes(host.query('creation.content', {}).talents.find(talent => talent.id === kept).name), 'the talent kept is the one shown');
    assert.deepEqual(view.draft().talents, ['rpg-battle/keen-eyes'], 'the draft keeps its picks (written back to redraw)');
    // Drawn again from the new head, the step lists it as rolled and kept.
    const again = await draw('talents', { draft: view.draft(), host });
    assert.match(again.el.querySelector('.cc-rolled li').textContent, /rolled, kept/);
});

test('talents step: a refused roll says why and offers nothing to keep', { skip: NO_RENDERER }, async () => {
    // Every point is spent: no talent can be paid for.
    const draft = { ...startDraft(null, { persona: { name: 'Ren', background: '', avatar: '' } }), points: points({ STR: 10 }) };
    const { el } = await draw('talents', { draft });
    el.querySelector('.rpg-roll-go').dispatch('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(el.querySelector('.rpg-roll-result').textContent, /No points are left for a talent/);
    assert.equal(el.querySelector('.rpg-roll-keep').hidden, true);
});

test('Random shows only on the Talents step; the other steps have no roll button', { skip: NO_RENDERER }, async () => {
    for (const step of CREATE_STEPS) {
        const draft = startDraft(null, { persona: { name: 'Ren', background: '', avatar: '' } });
        const { el } = await draw(step.id, { draft });
        assert.equal(el.querySelectorAll('.rpg-roll-go').length, step.id === 'talents' ? 1 : 0, step.id);
    }
});

test('Points left is said once per step: the lead line; the stat steppers\' own notes are hidden', { skip: NO_RENDERER }, async () => {
    for (const id of ['talents', 'stats']) {
        const template = CREATE_STEPS.find(step => step.id === id).template;
        assert.equal((template.match(/Points left/g) ?? []).length, 1, id);
    }
    assert.match(createScreen.css, /\.cc-stat \.ss-w-stepper-budget \{ display: none; \}/);
    // The steppers still get the budget (it stops + when the points are spent).
    const { props } = await draw('stats', { draft: { ...startDraft(), points: points({ STR: 2 }) } });
    assert.ok(props['ss.stepper'].every(p => p.budget === 8));
});

test('start step: an empty draft is filled with the persona of the moment; a draft with anything in it is left alone', () => {
    const persona = { name: 'Mara', background: 'A cartographer.', avatar: 'mara.png' };
    const withDraft = draft => ({ draft: { value: () => draft }, view: () => ({ persona }) });
    const empty = {};
    const handle = renderDraftStart({}, {}, withDraft(empty));
    assert.deepEqual(empty, startDraft(null, { persona: { name: 'Mara', background: 'A cartographer.', avatar: '/thumbnail?type=persona&file=mara.png' } }));
    assert.equal(typeof handle.destroy, 'function');
    const opened = { ...startDraft(null, { persona: { name: 'Ren' } }), race: 'rpg-battle/elf' };
    const before = structuredClone(opened);
    renderDraftStart({}, {}, withDraft(opened));
    assert.deepEqual(opened, before, 'openCreation\'s draft is not touched');
    assert.doesNotThrow(() => renderDraftStart({}, {}, {}), 'no draft api: nothing happens');
    assert.doesNotThrow(() => renderDraftStart({}, {}, withDraft(Object.freeze({}))));
    assert.ok(part.widgets[DRAFT_START_WIDGET], 'the creation part registers it');
    assert.match(CREATE_STEPS.find(step => step.id === 'start').template, /<ss-widget[^>]*name="rpg-battle.draft-start"/, 'first on the Start step');
});

test('start step: an import closes the wizard and says "<Name> is ready" once, whether openCreation or the start card opened it', { skip: NO_RENDERER }, async () => {
    const character = { v: 1, kind: 'rpg-battle/character', name: 'Ren of Elsewhere', level: 4 };
    const file = { name: 'ren.json', size: 200, text: async () => JSON.stringify(character) };
    // The widget on the Start step, with the dialog api it gets; `forward` carries its bubbling event to the handle's own root
    // (the fake DOM's events lose `detail`, so the result is handed over as it is).
    const pick = async ({ dialog, draft, forward = null }) => {
        const result = { ok: true, receipt: { summary: 'Ren arrives from another story (Lv 4).' } };   // a result is told once: one per import
        const { el } = await draw('start', { draft, command: () => result, apiExtra: { dialog } });
        if (forward) el.addEventListener(CREATED_EVENT, () => forward.root.dispatch(CREATED_EVENT, { detail: { result } }));
        const input = el.querySelector('input.rpg-import-file');
        input.files = [file];
        input.dispatch('change');
        await new Promise(resolve => setTimeout(resolve, 0));
        return result;
    };
    const savedToastr = globalThis.toastr;
    try {
        // Opened by openCreation (its notify): its listener on the event closes and tells; the widget adds no second toast.
        const toasts = [];
        globalThis.toastr = { success: (text, title) => toasts.push({ title, text }) };
        const told = [];
        const viaOpen = fakeDialogApi();
        openCreation(viaOpen.api, { notify: (title, text) => told.push({ title, text }) });
        const wizard = viaOpen.opened[0];
        const result = await pick({ dialog: viaOpen.api.dialog, draft: wizard.draft, forward: wizard });
        assert.equal(wizard.open, false, 'closed');
        assert.equal(wizard.closedWith, result);
        assert.deepEqual(told.map(note => note.title), ['Ren is ready'], 'told once, through notify');
        assert.equal(toasts.length, 0, 'and not a second time through the toast');

        // Opened by openCreation, but the widget's event never reaches its listener: the widget closes and tells itself.
        const alone = fakeDialogApi();
        openCreation(alone.api);
        await pick({ dialog: alone.api.dialog, draft: alone.opened[0].draft });
        assert.equal(alone.opened[0].open, false);
        assert.deepEqual(toasts.map(toast => toast.title), ['Ren is ready']);

        // Opened as Story Block's start card does (no openCreation, no onDone, no event listener): same result.
        toasts.length = 0;
        const viaCard = fakeDialogApi();
        const handle = viaCard.api.dialog.open(CREATE_SCREEN_ID, { draft: startDraft(null, { persona: { name: 'Ren' } }) });
        const carded = await pick({ dialog: viaCard.api.dialog, draft: handle.draft });
        assert.equal(handle.open, false);
        assert.equal(handle.closedWith, carded);
        assert.deepEqual(toasts.map(toast => toast.title), ['Ren is ready']);

        // A dialog of another screen is left alone.
        const other = fakeDialogApi();
        const unrelated = other.api.dialog.open('rpg-battle/other', { draft: {} });
        await pick({ dialog: other.api.dialog, draft: startDraft(null, { persona: { name: 'Ren' } }) });
        assert.equal(unrelated.open, true);
    } finally {
        if (savedToastr === undefined) delete globalThis.toastr;
        else globalThis.toastr = savedToastr;
    }
});

test('start step: Import character runs creation.import with the picked file and the persona\'s name, background and portrait', { skip: NO_RENDERER }, async () => {
    const persona = { name: 'Ren Avel', background: 'From the river.', avatar: '/User Avatars/ren.png' };
    const draft = startDraft(null, { persona });
    const character = { v: 1, kind: 'rpg-battle/character', name: 'Ren of Elsewhere', level: 4 };
    const { el, sent } = await draw('start', { draft, command: () => ({ ok: true, receipt: { summary: 'Ren Avel arrives from another story (Lv 4).' } }) });
    const input = el.querySelector('input.rpg-import-file');
    assert.equal(input.type, 'file');
    assert.equal(input.getAttribute('accept'), '.json,application/json');
    assert.match(input.getAttribute('aria-label'), /Import character/);
    const created = [];
    el.addEventListener(CREATED_EVENT, event => created.push(event.type));
    input.files = [{ name: 'ren.rpg-battle.json', size: 200, text: async () => JSON.stringify(character) }];
    input.dispatch('change');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(sent, [{ type: 'creation.import', payload: { character, name: 'Ren Avel', background: 'From the river.', portrait: '/User Avatars/ren.png' } }]);
    assert.equal(el.querySelector('.rpg-import-note').textContent, 'Ren Avel arrives from another story (Lv 4).');
    assert.deepEqual(created, [CREATED_EVENT], 'the dialog is told it can close');
});

test('start step: Import character with a file that is not one, too large, or refused says so and changes nothing', { skip: NO_RENDERER }, async () => {
    const draft = startDraft(null, { persona: { name: 'Ren', background: '', avatar: '' } });
    const { el, sent } = await draw('start', { draft, command: () => ({ ok: false, code: 'REFUSED', message: 'That file is for a level this story does not allow.' }) });
    const input = el.querySelector('input.rpg-import-file');
    const created = [];
    el.addEventListener(CREATED_EVENT, () => created.push(1));
    const pick = async file => {
        input.files = [file];
        input.dispatch('change');
        await new Promise(resolve => setTimeout(resolve, 0));
        return el.querySelector('.rpg-import-note').textContent;
    };
    assert.equal(await pick({ size: 10, text: async () => 'not json' }), 'That file is not a character file (it is not JSON).');
    assert.equal(await pick({ size: FILE_LIMIT + 1, text: async () => '{}' }), 'That file is too large to be a character file.');
    assert.equal(await pick({ size: 10, text: async () => '[1,2]' }), 'That file is not a character file.');
    assert.deepEqual(sent, []);
    assert.equal(await pick({ size: 10, text: async () => '{"v":1}' }), 'That file is for a level this story does not allow.');
    assert.equal(sent.length, 1);
    assert.deepEqual(created, []);
    // A file saved from the receipt's whole data is read too.
    assert.deepEqual(characterFrom('{"character":{"v":1},"fileName":"x.json"}'), { character: { v: 1 } });
});

test('Import character: a refusal that quotes a long text is clipped in the status line (B-rxui-5)', { skip: NO_RENDERER }, async () => {
    const draft = startDraft(null, { persona: { name: 'Ren', background: '', avatar: '' } });
    const { el } = await draw('start', { draft, command: () => ({ ok: false, code: 'INVALID', message: `Bad: ${'x'.repeat(5000)}` }) });
    const input = el.querySelector('input.rpg-import-file');
    input.files = [{ size: 10, text: async () => '{"v":1}' }];
    input.dispatch('change');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(Array.from(el.querySelector('.rpg-import-note').textContent).length, 400);
    // A newer or odd version is named, never quoted; RPG Battle 1's party file is named as one.
    assert.equal(characterFrom(JSON.stringify({ rpgBattleCharacter: 'v'.repeat(1000) })).error, 'That character file is an unknown version; this RPG Battle reads version 1.');
    assert.equal(characterFrom(JSON.stringify({ rpgBattleCharacter: 2 })).error, 'That character file is version 2; this RPG Battle reads version 1.');
    assert.match(characterFrom(JSON.stringify({ rpgBattleParty: 1, character: { name: 'Old' } })).error, /^That is an RPG Battle 1 party file/);
    assert.deepEqual(characterFrom(JSON.stringify({ rpgBattleCharacter: 1, name: 'Ren' })), { character: { rpgBattleCharacter: 1, name: 'Ren' } });
});

// ---------------------------------------------------------------------------------------------------
// The live test's fixes (ux3): cards that un-pick, no broken pictures, a summary, and "<Name> is ready".

test('no template input relies on a type: SillyTavern\'s DOMPurify drops it (radios showed the raw race id)', { skip: NO_RENDERER }, async () => {
    for (const step of CREATE_STEPS) assert.doesNotMatch(step.template, /type="(?:radio|checkbox)"/, step.id);
    // With a sanitiser that strips every `type`, as SillyTavern's does, the race step still picks.
    const r = await renderer();
    const doc = r.installFakeDom();
    const host = makeHost();
    const stripType = html => html.replace(/\stype="[^"]*"/g, '');
    const compiled = r.compileTemplate(CREATE_STEPS.find(step => step.id === 'race').template, { sanitize: stripType });
    const el = doc.createElement('div');
    doc.body.appendChild(el);
    const scope = { state: host.state, q: { c: host.query('creation.content', {}) }, draft: startDraft(), settings: part.settings.defaults, query: host.query };
    const view = r.renderTemplate(el, compiled, scope, { evaluate: r.evaluate, widgets: { ...r.standardWidgets, ...part.widgets } });
    assert.equal(el.querySelectorAll('input').length, 0);
    el.querySelectorAll('button.cc-card')[0].click();
    assert.equal(view.draft().race, 'rpg-battle/human');
});

test('talents step: a talent the points left cannot pay for, or past the most talents, cannot be added; a taken one can come off', { skip: NO_RENDERER }, async () => {
    // 10 points: 9 on STR leaves 1, so only 1-point talents can be added.
    const draft = { ...startDraft(), points: points({ STR: 9 }) };
    const { el, view } = await draw('talents', { draft });
    const card = id => el.querySelectorAll('.cc-talent-list button.cc-card').find(node => node.getAttribute('data-choice') === id);
    assert.equal(card('rpg-battle/silver-tongue').disabled, true, '2 points, 1 left');
    assert.match(card('rpg-battle/silver-tongue').title, /Not enough points/);
    assert.equal(card('rpg-battle/keen-eyes').disabled, false);
    card('rpg-battle/keen-eyes').click();
    assert.deepEqual(view.draft().talents, ['rpg-battle/keen-eyes']);
    assert.equal(card('rpg-battle/iron-gut').disabled, true, 'no points left');
    assert.equal(card('rpg-battle/keen-eyes').disabled, false, 'the taken one can always come off');
    card('rpg-battle/keen-eyes').click();
    assert.deepEqual(view.draft().talents, []);
    assert.equal(el.querySelector('.cc-left b').textContent, '1');

    // The most talents (2 by default): with two taken, the rest wait.
    const two = { ...startDraft(), talents: ['rpg-battle/keen-eyes', 'rpg-battle/iron-gut'] };
    const again = await draw('talents', { draft: two });
    const others = again.el.querySelectorAll('.cc-talent-list button.cc-card').filter(node => node.getAttribute('aria-pressed') === 'false');
    assert.ok(others.length > 0 && others.every(node => node.disabled), 'every other talent waits');
    assert.match(others[0].title, /most talents/);
});

test('start step: the chosen ready-made character clicked again is cleared, as My own', { skip: NO_RENDERER }, async () => {
    const draft = startDraft(null, { persona: { name: 'Wessel', background: '', avatar: '' } });
    const { el, view } = await draw('start', { draft, host: makeHost({ packs: PACKS }) });
    const go = () => el.querySelectorAll('.rpg-preset-go')[0];
    assert.equal(go().getAttribute('aria-pressed'), 'false');
    go().click();
    assert.equal(view.draft().preset, 'pack.ersveil/wessel-kit');
    assert.equal(go().getAttribute('aria-pressed'), 'true');
    assert.equal(el.querySelector('.rpg-preset-own').getAttribute('aria-pressed'), 'false');
    go().click();
    assert.equal(view.draft().preset, '');
    assert.equal(view.draft().race, '');
    assert.deepEqual(view.draft().talents, []);
    assert.deepEqual(view.draft().points, points());
    assert.equal(go().getAttribute('aria-pressed'), 'false');
    assert.equal(el.querySelector('.rpg-preset-own').getAttribute('aria-pressed'), 'true');
});

test('cards show a picture only for a real image address; a pack id or a broken one shows no box', { skip: NO_RENDERER }, async () => {
    assert.equal(cardImage('pack.ersveil-bluewatch/human'), '');
    assert.equal(cardImage('/img/elf.png'), '');
    assert.equal(cardImage('javascript:alert(1)'), '');
    assert.equal(cardImage('data:image/svg+xml,<svg/>'), '');
    assert.equal(cardImage('https://example.org/elf.png'), 'https://example.org/elf.png');
    assert.equal(cardImage('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    const races = [
        { ...PACKS.races[0], image: 'pack.ersveil/human' },
        { ...PACKS.races[1], image: 'https://example.org/elf.png' },
    ];
    const packs = { ...PACKS, races, presets: [{ ...PACKS.presets[0], image: 'pack.ersveil/wessel' }] };
    const content = creationContent({ query: (name, args) => packs[args.kind] ?? [] });
    assert.equal(content.races[0].image, undefined, 'an id is not an image');
    assert.equal(content.races[1].image, 'https://example.org/elf.png');
    assert.equal(content.presets[0].image, undefined);
    const { el } = await draw('race', { draft: startDraft(), host: makeHost({ packs }) });
    const imgs = el.querySelectorAll('.cc-card img');
    assert.equal(imgs.length, 1);
    assert.equal(imgs[0].getAttribute('alt'), '', 'never alt text in place of a picture');
    imgs[0].dispatch('error');
    assert.equal(el.querySelectorAll('.cc-card img').length, 0, 'a picture that fails to load leaves no box');
    assert.doesNotMatch(el.textContent, /pack\.ersveil/);
});

test('toggled: one choice un-picks on a second click; a list adds and takes off', () => {
    assert.equal(toggled('', 'a', false), 'a');
    assert.equal(toggled('a', 'a', false), '');
    assert.equal(toggled('a', 'b', false), 'b');
    assert.deepEqual(toggled([], 'a', true), ['a']);
    assert.deepEqual(toggled(['a', 'b'], 'a', true), ['b']);
    assert.deepEqual(toggled(null, 'a', true), ['a']);
});

test('you step: a summary of name, race, talents and the final stats before Create', { skip: NO_RENDERER }, async () => {
    const draft = { ...startDraft(null, { persona: { name: 'Ren Avel' } }), race: 'rpg-battle/elf', talents: ['rpg-battle/keen-eyes', 'rpg-battle/iron-gut'], points: points({ STR: 4, DEX: 4 }) };
    const { el } = await draw('you', { draft });
    const text = selector => el.querySelector(selector).textContent.replace(/\s+/g, ' ').trim();
    assert.equal(text('.cc-review-name'), 'Ren Avel');
    assert.equal(text('.cc-review-race'), 'Elf');
    assert.equal(text('.cc-review-talents'), 'Keen Eyes and Iron Gut');
    // 5 + points, then Elf (+2 DEX, +1 INT, −1 VIT) and the talents (+1 DEX, +1 VIT).
    assert.deepEqual(el.querySelectorAll('.cc-review-stats li').map(node => node.textContent.replace(/\s+/g, ' ').trim()),
        ['STR 9', 'VIT 5', 'AGI 5', 'DEX 12', 'INT 6', 'LUK 5', 'CHA 5']);
    const bare = await draw('you', { draft: { ...startDraft(null, { persona: { name: 'Ren' } }) } });
    assert.equal(bare.el.querySelector('.cc-review-race').textContent.trim(), 'None');
    assert.equal(bare.el.querySelector('.cc-review-talents').textContent.trim(), 'None');
});

test('openCreation: Create that worked says "<Name> is ready" once; a refusal or closing says nothing', () => {
    const told = [];
    const notify = (title, text) => told.push({ title, text });
    const { api, opened } = fakeDialogApi();
    openCreation(api, { notify });
    const handle = opened[0];
    assert.equal(typeof handle.opts.onDone, 'function');
    handle.opts.onDone({ ok: false, message: 'Spend every point.' });
    assert.equal(told.length, 0);
    handle.opts.onDone({ ok: true, receipt: { summary: 'Ren (Elf; Keen Eyes) is ready.' } });
    handle.opts.onDone({ ok: true, receipt: { summary: 'again' } });
    assert.deepEqual(told, [{ title: 'Ren is ready', text: 'Ren (Elf; Keen Eyes) is ready. See them on the Party screen.' }]);

    // An import from the Start step says it too, once.
    const second = fakeDialogApi();
    const heard = [];
    openCreation(second.api, { notify: title => heard.push(title) });
    second.opened[0].root.dispatch(CREATED_EVENT, { detail: { result: { ok: true, receipt: { summary: 'Ren arrives from another story (level 3).' } } } });
    assert.deepEqual(heard, ['Ren is ready']);

    // Without notify: SillyTavern's toastr, with the text escaped.
    const third = fakeDialogApi();
    const toasts = [];
    const before = globalThis.toastr;
    try {
        globalThis.toastr = { success: (text, title, opts) => toasts.push({ text, title, opts }) };
        openCreation(third.api);
        third.opened[0].opts.onDone({ ok: true, receipt: { summary: 'Ren is ready.' } });
    } finally {
        globalThis.toastr = before;
    }
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].title, 'Ren is ready');
    assert.equal(toasts[0].opts.escapeHtml, true);
    assert.deepEqual(createdNotice({ ok: true }, { name: '  A\nlong   name ' }), { title: 'A long name is ready', text: 'See them on the Party screen.' });
});
