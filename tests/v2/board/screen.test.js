// The Fight screen (src/v2/board/screen.js): a SPEC §13.1 definition whose §13.2 template places the
// battle board and the offer cards. Rendered with Story Block's template renderer when its worktree is
// on this machine (it lives in the Story Block repo, not here); otherwise those tests are skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installFakeDom } from '../../ui-fake-dom.js';
import { baseDomains, createWorld, line } from '../combat/helpers/fake-ctx.js';
import { part as combat } from '../../../src/v2/combat/index.js';
import { part, fightScreen, FIGHT_SCREEN_ID } from '../../../src/v2/board/index.js';
import { boardOf, hero, liveFight } from './helpers.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

// Story Block's src/v2: the vendored testkit's (npm run sync-testkit), or STORY_BLOCK_V2=/path/to/story_block/src/v2.
const STORY_BLOCK = process.env.STORY_BLOCK_V2 || fileURLToPath(new URL('../../vendor/story-block/src/v2', import.meta.url));
const HAS_RENDERER = existsSync(`${STORY_BLOCK}/view/template/index.js`) && existsSync(`${STORY_BLOCK}/events/index.js`);
const NO_RENDERER = HAS_RENDERER ? false : `Story Block's template renderer is not on this machine (${STORY_BLOCK}/view/template/).`;

async function renderer() {
    const template = await import(`${STORY_BLOCK}/view/template/index.js`);
    const bind = await import(`${STORY_BLOCK}/view/bind.js`);
    const events = await import(`${STORY_BLOCK}/events/index.js`);
    const css = await import(`${STORY_BLOCK}/view/css.js`);
    const screens = existsSync(`${STORY_BLOCK}/view/screens.js`) ? await import(`${STORY_BLOCK}/view/screens.js`) : null;
    const widgets = existsSync(`${STORY_BLOCK}/view/widgets/index.js`) ? await import(`${STORY_BLOCK}/view/widgets/index.js`) : null;
    return { ...template, standardWidgets: widgets?.standardWidgets ?? {}, scopeCss: css.scopeCss, evaluate: bind.conditionEvaluator({ compile: events.compile, evaluate: events.evaluate }), makeScope: bind.makeScope, validateScreen: screens?.validateScreen ?? null };
}

/** The screen's `data` bindings, run as the host runs them: each alias is its query on the head state. */
function screenData(world) {
    const queries = { ...combat.queries, ...part.queries };
    const out = {};
    for (const [alias, binding] of Object.entries(fightScreen.data)) {
        out[alias] = binding.query === 'combat.board' ? boardOf(world) : queries[binding.query](world.state, binding.args ?? {});
    }
    return out;
}

/** The Fight screen drawn with the real renderer; commands run on the world and redraw the screen. */
async function show(world, { widgets = part.widgets, api = {} } = {}) {
    const r = await renderer();
    const compiled = r.compileTemplate(fightScreen.template);
    assert.deepEqual(compiled.warnings, [], 'the template compiles cleanly');
    const doc = installFakeDom();
    const el = doc.createElement('div');
    el.setAttribute('data-ss-screen', FIGHT_SCREEN_ID);
    doc.body.appendChild(el);
    const sent = [];
    const warnings = [];
    let view;
    const draw = () => { view = r.renderTemplate(el, compiled, r.makeScope({ state: world.state, q: screenData(world) }), options); };
    const options = {
        widgets,
        api,
        evaluate: r.evaluate,
        onWarn: message => warnings.push(message),
        command: async (type, payload) => {
            sent.push([type, structuredClone(payload)]);
            const result = world.run(type, payload);
            if (result.ok) draw();
            return result;
        },
    };
    draw();
    return { el, sent, warnings, view: () => view };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const texts = (el, selector) => el.querySelectorAll(selector).map(node => node.textContent.replace(/\s+/g, ' ').trim());

test('the Fight screen definition: id, mounts, its data bindings are registered queries', () => {
    assert.equal(fightScreen.id, 'rpg-battle/fight');
    assert.deepEqual([...fightScreen.mounts], ['tab', 'screen']);
    assert.equal(typeof fightScreen.template, 'string');
    assert.equal(fightScreen.layout, undefined, 'a template, not a layout');
    const queries = { ...combat.queries, ...part.queries };
    for (const [alias, binding] of Object.entries(fightScreen.data)) assert.equal(typeof queries[binding.query], 'function', `${alias}: ${binding.query}`);
    assert.ok(fightScreen.template.includes('<ss-widget class="rb-fight-board" name="rpg-battle.battle-board"'));
    assert.ok(!/<script|\son[a-z]+=|javascript:/i.test(fightScreen.template), 'nothing the sanitiser would drop');
});

test('the screen validates and its CSS scopes cleanly (Story Block\'s own checks)', { skip: NO_RENDERER }, async () => {
    const r = await renderer();
    if (r.validateScreen) assert.deepEqual(r.validateScreen(fightScreen), []);
    const scoped = r.scopeCss(fightScreen.css, FIGHT_SCREEN_ID);
    assert.deepEqual(scoped.warnings, []);
    assert.ok(scoped.css.includes('[data-ss-screen="rpg-battle/fight"] .rb-fight-offer'));
});

test('the screen: offer cards with Fight and Not now; Fight starts it and the board appears', { skip: NO_RENDERER }, async () => {
    const world = createWorld({ domains: baseDomains({ actors: [hero()] }) });
    const { el, sent, warnings } = await show(world);
    assert.deepEqual(texts(el, '.rb-fight-empty'), ['No fight on offer. When the story starts one, it shows here.']);

    world.capture(line('!', 'encounter', '3 Cellar Rats', 'boiling out of the bins', { tier: 'weak', stakes: 'death' }));
    world.capture(line('!', 'encounter', 'Giant Rat', '', { tier: 'weak' }));
    const again = await show(world);
    assert.deepEqual(texts(again.el, '.rb-fight-offer-text'), ['Cellar Rat ×3 (weak)', 'Giant Rat (weak)']);
    assert.deepEqual(texts(again.el, '.rb-fight-stakes'), ['To the death']);
    assert.deepEqual(texts(again.el, '.rb-fight-note'), ['boiling out of the bins'], 'an offer without a note shows none');
    assert.deepEqual(texts(again.el, '.rb-fight-place'), ['Bluewatch Village', 'Bluewatch Village']);
    assert.deepEqual(again.el.querySelectorAll('.rb-fight-offer').map(node => node.className), ['rb-fight-offer deadly', 'rb-fight-offer']);
    assert.deepEqual(texts(again.el, '.rb-fight-offer button'), ['Fight', 'Not now', 'Fight', 'Not now']);
    assert.equal(again.el.querySelector('.rpg-bb'), null, 'no board before a fight');
    assert.equal(again.el.querySelectorAll('.rb-fight-empty').length, 0);

    const [first, second] = Object.values(world.state.domains.combat.offers).map(offer => offer.id);
    again.el.querySelectorAll('.rb-fight-not-now')[1].click();
    await settle();
    assert.deepEqual(again.sent, [['combat.dismiss', { offer: second }]]);
    assert.equal(Object.values(world.state.domains.combat.offers).length, 1);
    again.el.querySelector('.rb-fight-go').click();
    await settle();
    assert.deepEqual(again.sent.at(-1), ['combat.start', { offer: first }]);
    assert.ok(sessionOf(world.state.domains.combat), 'the fight started');

    // The board is drawn by the widget from q.fight (combat.board).
    const board = again.el.querySelector('.rb-fight-board .rpg-bb');
    assert.ok(board, 'the battle board is on the screen');
    assert.equal(board.getAttribute('aria-label'), 'Fight');
    assert.equal(board.querySelector('.rpg-bb-tag.rpg-bb-death').textContent, 'to the death');
    assert.equal(again.el.querySelectorAll('.rpg-bb-card[data-side="enemy"]').length, 3);
    assert.deepEqual(warnings, []);
    assert.deepEqual(sent, []);
});

test('the screen: board clicks run through the template\'s command runner, Finish ends it', { skip: NO_RENDERER }, async () => {
    const world = liveFight('Giant Rat', { tier: 'weak' });
    world.capture(line('!', 'encounter', 'Bandit', 'on the road', { tier: 'even' }));
    const { el, sent, warnings } = await show(world);
    // A fight is on: the other offer can be turned down, not fought.
    assert.deepEqual(texts(el, '.rb-fight-offer button'), ['Not now']);
    assert.equal(el.querySelectorAll('.rb-fight-last').length, 0);
    for (let n = 0; n < 100 && sessionOf(world.state.domains.combat)?.status === 'active'; n++) {
        el.querySelector('.rpg-bb [data-act="attack"]').click();
        await settle();
    }
    assert.ok(sent.length > 0 && sent.every(([type, payload]) => type === 'combat.act' && payload.action.type === 'attack'));
    assert.equal(el.querySelector('.rpg-bb-outcome').textContent, 'Victory');
    const fightId = sessionOf(world.state.domains.combat).id;
    el.querySelector('.rpg-bb-finish').click();
    await settle();
    assert.deepEqual(sent.at(-1), ['combat.end', { session: fightId }]);
    assert.equal(el.querySelector('.rpg-bb'), null, 'the board leaves with the fight');
    // The last fight in parts (the summary text stays the story's): no wall of text.
    assert.equal(el.querySelectorAll('.rb-fight-summary').length, 0);
    assert.equal(texts(el, '.rb-last-result')[0], world.state.domains.combat.last[0].parts.result);
    assert.deepEqual(texts(el, '.rb-fight-offer button'), ['Fight', 'Not now'], 'the waiting offer can be fought now');
    assert.deepEqual(warnings.filter(message => !/ss\.meter/.test(message)), []);
});

test('the screen: the last fight as a result line, a row per member with meters, key moments, loot and growth', { skip: NO_RENDERER }, async () => {
    const world = liveFight('3 Cellar Rats', { tier: 'weak' });
    for (let n = 0; n < 200 && sessionOf(world.state.domains.combat)?.status === 'active'; n++) world.run('combat.act', { action: { type: 'auto' } });
    assert.equal(world.run('combat.end', { session: sessionOf(world.state.domains.combat).id }).ok, true);
    const r = await renderer();
    const { el, warnings } = await show(world, { widgets: { ...r.standardWidgets, ...part.widgets } });
    const { parts } = world.state.domains.combat.last[0];
    assert.deepEqual(texts(el, '.rb-last-result'), [parts.result]);
    assert.ok(el.querySelector('.rb-last').className.includes('won'));
    const rows = el.querySelectorAll('.rb-last-member');
    assert.equal(rows.length, parts.party.length);
    assert.deepEqual(texts(el, '.rb-last-name'), parts.party.map(member => member.name));
    assert.deepEqual(texts(el, '.rb-last-state'), parts.party.map(member => member.state));
    // HP, MP and SP meters for the one member (Ren keeps all three).
    const meters = rows[0].querySelectorAll('[role="meter"]');
    assert.equal(meters.length, 3);
    assert.equal(meters[0].getAttribute('aria-valuenow'), String(parts.party[0].hp.cur));
    assert.equal(meters[0].getAttribute('aria-valuemax'), String(parts.party[0].hp.max));
    assert.deepEqual(texts(el, '.rb-last-moments li'), parts.moments);
    assert.deepEqual(texts(el, '.rb-last-foes'), ['Foes defeated: Cellar Rat ×3.']);
    assert.deepEqual(texts(el, '.rb-last-loot li'), parts.loot);
    assert.deepEqual(texts(el, '.rb-last-growth'), [parts.growth]);
    assert.equal(el.querySelectorAll('.rb-fight-summary').length, 0);
    assert.deepEqual(warnings, []);
});

test('the screen: a last fight saved before parts existed shows its summary text', { skip: NO_RENDERER }, async () => {
    const world = liveFight('Giant Rat', { tier: 'weak' });
    for (let n = 0; n < 200 && sessionOf(world.state.domains.combat)?.status === 'active'; n++) world.run('combat.act', { action: { type: 'auto' } });
    assert.equal(world.run('combat.end', { session: sessionOf(world.state.domains.combat).id }).ok, true);
    const { parts: _parts, ...older } = world.state.domains.combat.last[0];
    world.state = { ...world.state, domains: { ...world.state.domains, combat: { ...world.state.domains.combat, last: [older] } } };
    const { el, warnings } = await show(world);
    assert.deepEqual(texts(el, '.rb-fight-summary'), [world.state.domains.combat.last[0].summary]);
    assert.equal(el.querySelectorAll('.rb-last').length, 0);
    assert.deepEqual(warnings, []);
});

test('the screen: ss.portrait reaches the board through the widget api', { skip: NO_RENDERER }, async () => {
    const world = liveFight('Giant Rat', { tier: 'weak' });
    const names = [];
    const portrait = { render(slot, props) { names.push(props.name); slot.textContent = '◉'; return { update() {}, destroy() {} }; } };
    const { el } = await show(world, { api: { widgets: { 'ss.portrait': portrait } } });
    assert.deepEqual(names, ['Giant Rat', 'Ren']);
    assert.equal(el.querySelectorAll('.rpg-bb-initials').length, 0);
});

test('without the renderer the template tests say why they are skipped', () => {
    if (!HAS_RENDERER) assert.match(NO_RENDERER, /not on this machine/);
    else assert.equal(NO_RENDERER, false);
});
