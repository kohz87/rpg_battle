// The Party, HUD and Crafting screens in the states the Wave E work added (companion switches, worn
// gear with its condition band and refinement, active effects, the character file, the HUD's points
// badge, the read-only Crafting screen), drawn with Story Block's template renderer like
// render.test.js. Other parts' queries this build may not have yet (party.effects, party.toSpend,
// items.condition, craft.view) are stand-ins in the shapes those parts give; without them each section
// is left out. Needs Story Block's template renderer (helpers/runtime.js); skipped with the reason otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { craftingScreen, hudScreen, partyScreen } from '../../../src/v2/screens/index.js';
import { renderCharacterFile } from '../../../src/v2/screens/widgets.js';
import { renderer, rendererMissing, widgets as standard } from './helpers/runtime.js';
import { LYRA, PC, emptyState, makeState } from './helpers/state.js';

const skip = renderer ? false : rendererMissing;
const helpers = renderer ? await import('./helpers/render.js') : null;
const { all, click, draw, propsOf, text } = helpers ?? {};

const buttons = (root, command) => all(root, 'button').filter(button => button.getAttribute('data-command') === command);
const widgetsIn = (root, name) => all(root, 'ss-widget').filter(el => el.getAttribute('name') === name);
const cardOf = (root, name) => all(root, 'article.actor').find(card => text(card.querySelector('.name')).startsWith(name));

function checkProps(drawn) {
    if (!standard) return;
    for (const { name, props } of drawn.widgets) {
        const widget = standard.standardWidgets[name];
        let unfolded = standard.unfoldValue({ ...props }, widget.props, widget.primary);
        // ss.meter reads a bound pool's `cur` as its value (meter.js).
        if (name === 'ss.meter' && unfolded.value === undefined && unfolded.cur !== undefined) unfolded = { ...unfolded, value: unfolded.cur };
        assert.deepEqual(widget.validate(props), [], `${name} props: ${JSON.stringify(props)}`);
        assert.deepEqual(standard.propProblems(widget.props, unfolded), [], `${name} props: ${JSON.stringify(props)}`);
    }
}

const EFFECTS = { [PC]: [{ id: 'ef_1', name: 'Blessed', tone: 'good', left: '2 h', source: 'a shrine' }] };
const SIBLINGS = {
    'party.effects': ({ actor }) => EFFECTS[actor] ?? [],
    'party.toSpend': () => ({ total: 5, people: [{ id: PC, name: 'Ren', points: 3 }, { id: LYRA, name: 'Lyra', points: 2 }] }),
    'items.condition': ({ stack }) => (stack === 'it_dagger01' ? { stack, band: 'worn', cur: 52, max: 100, refine: 2, name: 'Iron Dagger +2', factor: 0.85 } : null),
};

// ---------------------------------------------------------------------------------------------------
// Party

test('party: a companion has the fight and stat-point switches, sending party.edit; your character has none', { skip }, async () => {
    const drawn = draw(partyScreen, makeState());
    assert.deepEqual(drawn.warnings, []);
    const ren = cardOf(drawn.el, 'Ren');
    const lyra = cardOf(drawn.el, 'Lyra');
    assert.equal(ren.querySelector('.switches'), null);
    const groups = all(lyra, '.switch');
    assert.deepEqual(groups.map(group => group.getAttribute('aria-label')), ['Who gives Lyra orders in fights', 'Who spends the stat points of Lyra']);
    // The chosen side is a label, not a button (party.edit refuses "Nothing to change").
    assert.deepEqual(all(lyra, '.switch .on').map(text), ['On their own', 'By build']);
    assert.deepEqual(buttons(lyra, 'party.edit').map(text), ['You lead', 'By hand']);
    await click(buttons(lyra, 'party.edit')[0]);
    assert.deepEqual(drawn.commands.pop(), { type: 'party.edit', payload: { actor: LYRA, control: 'player' } });
    await click(buttons(lyra, 'party.edit')[1]);
    assert.deepEqual(drawn.commands.pop(), { type: 'party.edit', payload: { actor: LYRA, growth: 'manual' } });
    // Led by you (and so by hand, party growthOf): the other two are the buttons now.
    const after = makeState();
    after.domains.party.actors[LYRA].control = 'player';
    drawn.rerender(after);
    const led = cardOf(drawn.el, 'Lyra');
    assert.deepEqual(all(led, '.switch .on').map(text), ['You lead', 'By hand']);
    for (const button of buttons(led, 'party.edit')) await click(button);
    assert.deepEqual(drawn.commands.splice(0), [{ type: 'party.edit', payload: { actor: LYRA, control: 'auto' } }, { type: 'party.edit', payload: { actor: LYRA, growth: 'auto' } }]);
    assert.deepEqual(drawn.warnings, []);
});

test('party: worn gear with its condition band and refinement, active effects, the carry line', { skip }, () => {
    const drawn = draw(partyScreen, makeState(), { queries: SIBLINGS });
    assert.deepEqual(drawn.warnings, []);
    const ren = cardOf(drawn.el, 'Ren');
    const [piece, ...more] = all(ren, '.gear li.piece');
    assert.equal(more.length, 0);
    assert.equal(text(piece.querySelector('.nm')), '+2Iron Dagger');
    assert.equal(piece.querySelector('.refine').getAttribute('title'), 'Refined +2');
    assert.equal(text(piece.querySelector('.sub')), 'Weapon · ATK +3');
    const band = piece.querySelector('.band');
    assert.ok(band.classList.contains('b-worn'));
    assert.equal(text(band), 'Worn');
    assert.equal(band.getAttribute('title'), 'Condition: Worn · 52/100');
    assert.equal(band.querySelector('.bar').styleProps['--rb-ratio'], '0.52');
    assert.equal(cardOf(drawn.el, 'Lyra').querySelector('.gear'), null, 'Lyra wears nothing');
    assert.deepEqual(widgetsIn(ren.querySelector('.effects'), 'ss.badge').map(el => propsOf(el).value.label), ['Blessed, 2 h left, from a shrine']);
    assert.equal(cardOf(drawn.el, 'Lyra').querySelector('.effects'), null);
    assert.match(text(drawn.el.querySelector('.carry')), /^Carrying \d+ of \d+/);
    checkProps(drawn);
});

test('party: without the gear and party queries the piece shows plainly, with no band, refinement or effects', { skip }, () => {
    const drawn = draw(partyScreen, makeState());
    assert.deepEqual(drawn.warnings, []);
    const ren = cardOf(drawn.el, 'Ren');
    assert.equal(all(ren, '.gear li.piece').length, 1);
    assert.equal(ren.querySelector('.band'), null);
    assert.equal(ren.querySelector('.refine'), null);
    assert.equal(ren.querySelector('.effects'), null);
});

test('party: every wear band gets its class; a broken piece its own icon', { skip }, () => {
    for (const band of ['good', 'worn', 'tattered', 'broken']) {
        const drawn = draw(partyScreen, makeState(), { queries: { 'items.condition': () => ({ band, cur: band === 'broken' ? 0 : 50, max: 100, refine: 0 }) } });
        assert.deepEqual(drawn.warnings, [], band);
        const chip = cardOf(drawn.el, 'Ren').querySelector('.band');
        assert.ok(chip.classList.contains(`b-${band}`), band);
        assert.equal(chip.querySelectorAll('.fa-heart-crack').length, band === 'broken' ? 1 : 0, band);
        assert.equal(cardOf(drawn.el, 'Ren').querySelector('.refine'), null);
    }
});

test('party: Save character file previews party.export (never a command) and saves data.character as data.fileName', { skip }, async () => {
    const character = { v: 1, name: 'Ren', level: 3 };
    const drawn = draw(partyScreen, makeState(), {
        preview: type => ({ ok: true, token: 'pv_1', receipt: { type, summary: 'Ren is written to a character file', data: { actor: PC, character, fileName: 'ren.rpg-battle.json' } } }),
    });
    assert.deepEqual(drawn.warnings, []);
    const ren = cardOf(drawn.el, 'Ren');
    assert.equal(all(cardOf(drawn.el, 'Lyra'), '.rpg-file').length, 0, 'only your character has a file');
    assert.equal(ren.querySelector('footer.file ss-widget').getAttribute('name'), 'rpg-battle.character-file');
    const go = ren.querySelector('.rpg-file-go');
    assert.equal(text(go), 'Save character file');
    await click(go);
    assert.deepEqual(drawn.previews, [{ type: 'party.export', payload: {} }]);
    assert.deepEqual(drawn.commands, []);

    // The same widget with the save replaced, to see the file.
    const saved = [];
    const box = drawn.el.ownerDocument.createElement('div');
    renderCharacterFile(box, {}, {
        preview: async () => ({ ok: true, receipt: { data: { character, fileName: '../ren?.rpg-battle.json' } } }),
        saveFile: (name, body) => { saved.push([name, JSON.parse(body)]); },
    });
    await click(box.querySelector('.rpg-file-go'));
    assert.deepEqual(saved, [['ren-.rpg-battle.json', character]], 'the file name is made safe');
    assert.equal(text(box.querySelector('.rpg-file-note')), 'Saved as ren-.rpg-battle.json.');

    // A refusal shows beside the button.
    const refused = drawn.el.ownerDocument.createElement('div');
    renderCharacterFile(refused, {}, { preview: async () => ({ ok: false, code: 'NOT_FOUND', message: 'Make your character first.' }) });
    await click(refused.querySelector('.rpg-file-go'));
    assert.equal(text(refused.querySelector('.rpg-file-note')), 'Make your character first.');
    assert.equal(refused.querySelector('.rpg-file-note').getAttribute('data-tone'), 'bad');
});

test('party: the switches and the file button are reachable by keyboard: real buttons, labelled groups', { skip }, () => {
    const drawn = draw(partyScreen, makeState());
    const lyra = cardOf(drawn.el, 'Lyra');
    for (const button of buttons(lyra, 'party.edit')) assert.equal(button.tagName, 'BUTTON');
    for (const group of all(lyra, '.switch')) {
        assert.equal(group.getAttribute('role'), 'group');
        assert.ok(group.getAttribute('aria-label'));
    }
    // The chosen side says so to a screen reader.
    for (const chosen of all(lyra, '.switch .on')) assert.equal(chosen.getAttribute('aria-current'), 'true');
    const file = cardOf(drawn.el, 'Ren').querySelector('.rpg-file-go');
    assert.equal(file.tagName, 'BUTTON');
    assert.equal(file.type, 'button');
});

// ---------------------------------------------------------------------------------------------------
// HUD

test('hud: the points-to-spend badge from party.toSpend, the effects beside the conditions', { skip }, () => {
    const drawn = draw(hudScreen, makeState(), { queries: SIBLINGS });
    assert.deepEqual(drawn.warnings, []);
    const strip = drawn.el.querySelector('.rb-hud');
    assert.equal(text(strip.querySelector('.spend')), '5 to spend');
    assert.equal(strip.querySelector('.spend').getAttribute('aria-label'), 'Stat points to spend: Ren 3, Lyra 2');
    assert.deepEqual(widgetsIn(strip, 'ss.badge').map(el => [propsOf(el).value.label, propsOf(el).showLabel ?? propsOf(el).value.showLabel]), [
        ['Poisoned', true], ['Bleeding', true], ['Blessed, 2 h left, from a shrine', false],
    ]);
    checkProps(drawn);
});

test('hud: nobody with points and nothing on them: no badge and no badges row', { skip }, () => {
    const calm = makeState();
    calm.domains.party.actors[PC].conditions = [];
    const drawn = draw(hudScreen, calm, { queries: { 'party.toSpend': () => ({ total: 0, people: [] }), 'party.effects': () => [] } });
    assert.deepEqual(drawn.warnings, []);
    assert.equal(drawn.el.querySelector('.spend'), null);
    assert.equal(drawn.el.querySelector('.badges'), null);
    // Effects alone still show the row.
    const blessed = draw(hudScreen, calm, { queries: { 'party.effects': ({ actor }) => EFFECTS[actor] ?? [] } });
    assert.equal(widgetsIn(blessed.el.querySelector('.badges'), 'ss.badge').length, 1);
});

test('hud: the root is no size container, so the strip item keeps its width (the cause of the collapse)', () => {
    assert.doesNotMatch(hudScreen.css, /container(?:-type)?\s*:/);
    assert.doesNotMatch(hudScreen.css, /@container/);
    // The narrow layout follows the viewport, and keeps the badge's number.
    assert.match(hudScreen.css, /@media \(max-width: 480px\)[^]*\.spend-word \{ display: none; \}/);
    assert.match(partyScreen.css, /container: rb-screen \/ inline-size/);
});

test('hud: before creation, still one line', { skip }, () => {
    const drawn = draw(hudScreen, emptyState(), { queries: SIBLINGS });
    assert.deepEqual(drawn.warnings, []);
    assert.equal(drawn.el.querySelector('.spend'), null);
    assert.match(text(drawn.el), /Create your character to begin the story\./);
});

// ---------------------------------------------------------------------------------------------------
// Crafting

const CRAFT = {
    people: [
        {
            id: PC, name: 'Ren', you: true, skills: [{ craft: 'alchemy', rank: 2, uses: 3, toNext: 2, max: 5 }], recipes: [
                { id: 'rc_1', name: 'Healing Draught', craft: 'alchemy', from: 'Hollis', station: { name: 'an alchemy bench', here: false }, dc: 12, mod: 1, ready: false, why: 'Needs an alchemy bench.',
                    materials: [{ name: 'Moonleaf', need: 2, have: 3 }, { name: 'Clean Water', need: 1, have: 0 }], chances: { fail: 35, normal: 45, fine: 15, masterwork: 5 } },
                { id: 'rc_2', name: 'Torch', craft: 'basic', ready: true, materials: [{ name: 'Stick', need: 1, have: 4 }], chances: { fail: 0, normal: 80, fine: 20, masterwork: 0 } },
            ],
        },
        { id: LYRA, name: 'Lyra', you: false, skills: [], recipes: [] },
    ],
};

test('crafting: per character, the recipes with materials had and missing, station and chances; no buttons', { skip }, () => {
    const drawn = draw(craftingScreen, makeState(), { queries: { 'craft.view': () => CRAFT } });
    assert.deepEqual(drawn.warnings, []);
    const crafters = all(drawn.el, 'section.crafter');
    assert.deepEqual(crafters.map(section => text(section.querySelector('h4'))), ['Ren Alchemy 2 · 2 known'], 'Lyra knows none: no section');
    const [draught, torch] = all(crafters[0], 'li.recipe');
    assert.ok(draught.classList.contains('blocked'));
    assert.ok(torch.classList.contains('ready'));
    assert.equal(text(draught.querySelector('.sub')), 'Alchemy · Needs an alchemy bench · DC 12');
    assert.ok(draught.querySelector('.sub .away'));
    assert.equal(text(draught.querySelector('.why')), 'Needs an alchemy bench.');
    assert.deepEqual(all(draught, '.mat').map(mat => [text(mat), mat.classList.contains('lack')]), [['Moonleaf 3/2', false], ['Clean Water 0/1', true]]);
    assert.deepEqual(all(draught, '.odds-key li').map(text), ['Fail 35%', 'Normal 45%', 'Fine 15%', 'Masterwork 5%']);
    assert.deepEqual(all(draught, '.odds-bar > span').map(bar => bar.styleProps['--rb-share']), ['0.35', '0.45', '0.15', '0.05']);
    assert.deepEqual(all(torch, '.odds-key li').map(text), ['Normal 80%', 'Fine 20%']);
    assert.equal(torch.querySelector('.why'), null);
    assert.deepEqual(all(drawn.el, 'button'), []);
    assert.deepEqual(drawn.commands, []);
    assert.match(text(drawn.el.querySelector('.lead')), /Crafting happens in the story/);
    checkProps(drawn);
});

test('crafting: nobody knows a recipe; without the craft part (or with the feature off) it is not set up', { skip }, () => {
    const none = draw(craftingScreen, makeState(), { queries: { 'craft.view': () => ({ people: [{ id: PC, name: 'Ren', recipes: [] }] }) } });
    assert.deepEqual(none.warnings, []);
    assert.deepEqual(all(none.el, '.empty').map(text), ['Nobody knows a recipe yet. The story can teach one.']);
    assert.equal(none.el.querySelector('.lead'), null);
    const off = draw(craftingScreen, makeState());
    assert.deepEqual(off.warnings, []);
    assert.deepEqual(all(off.el, '.empty').map(text), ['Crafting is not set up in this chat.']);
    assert.equal(all(off.el, 'section.crafter').length, 0);
});
