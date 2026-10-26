// The screens part's definitions (SPEC §13.1–§13.3): the part's shape, every screen valid by Story
// Block's validateScreen, the right mounts, CSS within 64 KB with nothing the scoper would drop and
// every rule scoped to the screen, templates without script or inline handlers, buttons that name
// commands RPG Battle has, widgets from the standard set, and `q.<alias>` reads the screen's data
// gives. These run everywhere; drawing the templates is in render.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { part, screens } from '../../../src/v2/screens/index.js';
import { part as itemsPart } from '../../../src/v2/items/index.js';
import { part as partyPart } from '../../../src/v2/party/index.js';
import { part as tradePart } from '../../../src/v2/trade/index.js';
import { part as returnPart } from '../../../src/v2/return/index.js';
import { createModule } from '../../../src/v2/module.js';
import { definitionProblems, scopeCss, validateScreen, validatorFrom } from './helpers/runtime.js';
import { WIDGET_NAMES } from './helpers/render.js';
import { screenWidgets } from '../../../src/v2/screens/widgets.js';

// This part's own widgets (widgets.js) beside Story Block's standard ones.
const OWN_WIDGETS = ['rpg-battle.quest-binding', ...Object.keys(screenWidgets), 'rpg-battle.create-character', 'rpg-battle.return-card',
    'rpg-battle.permanent-choice', 'rpg-battle.class-pick', 'rpg-battle.command-input', 'rpg-battle.command-button'];

const byId = Object.fromEntries(screens.map(screen => [screen.id, screen]));
const COMMANDS = new Set([...Object.keys(partyPart.commands), ...Object.keys(itemsPart.commands), ...Object.keys(tradePart.commands)]);
// Story Block's registry rules (src/v2/registry.js): screen ids lowercase, query names words joined by dots.
// An <ss-widget …> tag's name (attribute values may hold ">", as in data-if="len(x) > 0").
const WIDGET_TAG = /<ss-widget\b(?:[^>"']|"[^"]*"|'[^']*')*?\sname="([^"]+)"/g;
const REGISTRY_SCREEN_ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const QUERY_NAME = /^[a-z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)*$/;

test('the part exports the five default screens under the new `screens` key, its view queries and widgets', () => {
    // No Items screen: Story Block's Inventory is the one bag (MODULES §F99).
    // The five below are first; track C's five rules screens follow (tests/v2/screens/rules/), each shown only while the rules queries exist.
    assert.deepEqual(screens.map(screen => screen.id), ['rpg-battle/party', 'rpg-battle/trade', 'rpg-battle/crafting', 'rpg-battle/hud', 'rpg-battle/status-card',
        'rpg-battle/progress', 'rpg-battle/quests', 'rpg-battle/roster', 'rpg-battle/links', 'rpg-battle/setup']);
    assert.equal(byId['rpg-battle/items'], undefined);
    assert.equal(part.screens, screens);
    assert.deepEqual(Object.keys(part.queries).sort(), ['rpg-battle.cards', 'rpg-battle.carry', 'rpg-battle.classPicker', 'rpg-battle.crafting', 'rpg-battle.heroes', 'rpg-battle.hud', 'rpg-battle.itemDetail', 'rpg-battle.linksView', 'rpg-battle.offers', 'rpg-battle.progressView', 'rpg-battle.questsView', 'rpg-battle.rosterView', 'rpg-battle.rulesDeps', 'rpg-battle.setupView', 'rpg-battle.trade']);
    assert.deepEqual(Object.keys(part.widgets).sort(), ['rpg-battle.character-file', 'rpg-battle.class-pick', 'rpg-battle.command-button', 'rpg-battle.command-input', 'rpg-battle.equipment', 'rpg-battle.item-detail', 'rpg-battle.member-toggle', 'rpg-battle.permanent-choice', 'rpg-battle.quest-binding', 'rpg-battle.skill-tree']);
    for (const widget of Object.values(part.widgets)) {
        assert.equal(typeof widget.render, 'function');
        assert.deepEqual(widget.validate({}), []);
    }
    for (const name of Object.keys(part.queries)) assert.match(name, QUERY_NAME);
    assert.deepEqual(part.domains, {});
    assert.deepEqual(part.commands, {});
    assert.equal(part.context.static(), '');
    assert.deepEqual(part.context.tail({}), { lines: [], optional: [] });
    assert.equal(part.settings.defaults.cardOnlyChanged, false);
    assert.equal(part.settings.schema.cardOnlyChanged.type, 'bool');
    // No other part claims these query names.
    for (const other of [partyPart, itemsPart, tradePart]) for (const name of Object.keys(part.queries)) assert.equal(other.queries[name], undefined);
});

test('Story Block\'s registry accepts RPG Battle with these screens and queries merged in (src/v2/module.js)', { skip: definitionProblems ? false : 'Story Block\'s registry.js was not found' }, () => {
    // src/v2/module.js merges this part: its queries and screens are in the module as they are.
    const merged = createModule({ settings: () => ({}) });
    for (const name of Object.keys(part.queries)) assert.equal(typeof merged.queries[name], 'function', name);
    for (const screen of screens) assert.ok(merged.screens.includes(screen), screen.id);
    assert.deepEqual(definitionProblems(merged), []);
});

test(`every screen passes validateScreen (${validatorFrom}) and the registry's id rule`, () => {
    for (const screen of screens) {
        assert.deepEqual(validateScreen(screen), [], screen.id);
        assert.deepEqual(validateScreen(screen, { id: screen.id }), [], screen.id);
        assert.match(screen.id, REGISTRY_SCREEN_ID);
        assert.equal(typeof screen.title, 'string');
        assert.match(screen.icon, /^fa-[a-z0-9-]+$/);
        assert.equal(typeof screen.template, 'string');
        assert.equal(screen.layout, undefined);
        assert.ok(Object.isFrozen(screen), `${screen.id} is frozen, so no caller can change the default`);
    }
});

test('validateScreen still refuses a broken copy (the check is live)', () => {
    const broken = { ...byId['rpg-battle/party'], mounts: ['sidebar'], data: { cards: { query: '' } } };
    assert.ok(validateScreen(broken).length >= 2);
});

test('mounts: party, trade and crafting are tabs and game screens; the HUD is a hud; the status card a card', () => {
    assert.deepEqual([...byId['rpg-battle/party'].mounts], ['tab', 'screen']);
    assert.deepEqual([...byId['rpg-battle/crafting'].mounts], ['tab', 'screen']);
    assert.deepEqual([...byId['rpg-battle/trade'].mounts], ['tab', 'screen']);
    assert.deepEqual([...byId['rpg-battle/hud'].mounts], ['hud']);
    assert.deepEqual([...byId['rpg-battle/status-card'].mounts], ['card']);
});

test('data bindings name the view queries; the status card reads the reply\'s own state', () => {
    assert.deepEqual(byId['rpg-battle/party'].data, { cards: { query: 'rpg-battle.cards' }, offers: { query: 'rpg-battle.offers' }, carry: { query: 'rpg-battle.carry' }, ret: { query: 'return.status' } });
    assert.deepEqual(byId['rpg-battle/crafting'].data, { craft: { query: 'rpg-battle.crafting' } });
    assert.deepEqual(byId['rpg-battle/trade'].data, { trade: { query: 'rpg-battle.trade' } });
    assert.deepEqual(byId['rpg-battle/hud'].data, { hud: { query: 'rpg-battle.hud' } });
    assert.deepEqual(byId['rpg-battle/status-card'].data, { terms: { query: 'party.terms' }, pools: { query: 'party.pools' }, heroes: { query: 'rpg-battle.heroes' } });
    assert.match(byId['rpg-battle/status-card'].template, /changed\(state\.party\.actors\[id\]\.hp\)/);
    for (const screen of screens) {
        const aliases = new Set(Object.keys(screen.data ?? {}));
        const used = new Set([...screen.template.matchAll(/\bq\.([A-Za-z_]\w*)/g)].map(match => match[1]));
        for (const alias of used) assert.ok(aliases.has(alias), `${screen.id} reads q.${alias}, which its data does not give`);
        for (const binding of Object.values(screen.data ?? {})) assert.ok(part.queries[binding.query] ?? partyPart.queries[binding.query] ?? returnPart.queries[binding.query], `${screen.id} binds ${binding.query}`);
    }
});

test('css: under 64 KB, Story Block tokens only (no colour of its own), nothing the scoper would drop', () => {
    for (const screen of screens) {
        const size = new TextEncoder().encode(screen.css).length;
        assert.ok(size < 64 * 1024, `${screen.id} css is ${size} bytes`);
        assert.ok(size < 16 * 1024, `${screen.id} css stays small (${size} bytes)`);
        assert.doesNotMatch(screen.css, /@import|@charset|@namespace|@page|position\s*:\s*fixed|url\(|expression\(|behavior\s*:|-moz-binding|javascript:/i, screen.id);
        // The look is Story Block's: colours come from its tokens, never a literal colour or a SillyTavern variable.
        assert.doesNotMatch(screen.css, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, `${screen.id} has a colour of its own`);
        assert.doesNotMatch(screen.css, /--rb-|--SmartTheme/, `${screen.id} keeps the old palette`);
        assert.match(screen.css, /var\(--ss-/, `${screen.id} uses Story Block's tokens`);
        assert.equal(screen.theme, undefined, `${screen.id} has no palette of its own (the tokens come from Story Block)`);
        // Mobile first: a block screen's root is a size container and wider layouts come from container
        // queries. The HUD item is sized by what it holds, so its root is never one (it would shrink to
        // nothing in the strip); it follows the viewport.
        if (screen.mounts.includes('hud')) {
            assert.doesNotMatch(screen.css, /container\s*:|container-type\s*:|@container/, screen.id);
            assert.match(screen.css, /@media \(max-width: \d+px\)/, screen.id);
        } else {
            assert.match(screen.css, /container: rb-screen \/ inline-size/, screen.id);
            if (screen.id !== 'rpg-battle/crafting') assert.match(screen.css, /@container rb-screen \((?:min|max)-width: \d+px\)/, screen.id);
        }
        assert.match(screen.css, /prefers-reduced-motion/, screen.id);
    }
});

// The selectors of every style rule in a sheet (not inside @keyframes), with their at-rule context.
function selectorsOf(css) {
    const out = [];
    const stack = [];
    let at = 0;
    let buffer = '';
    while (at < css.length) {
        const char = css[at];
        if (char === '{') {
            const prelude = buffer.trim();
            const inKeyframes = stack.some(item => /^@(-webkit-)?keyframes/i.test(item));
            if (!prelude.startsWith('@') && !inKeyframes) out.push(...prelude.split(',').map(part => part.trim()));
            stack.push(prelude);
            buffer = '';
        } else if (char === '}') {
            stack.pop();
            buffer = '';
        } else if (char === ';' && !buffer.includes('{')) buffer = '';
        else buffer += char;
        at += 1;
    }
    return out;
}

test('css: Story Block\'s scoper keeps every rule and puts each selector under the screen root', { skip: scopeCss ? false : 'Story Block\'s css.js was not found (set STORY_BLOCK_DIR to a Story Block checkout)' }, () => {
    for (const screen of screens) {
        const { css, warnings } = scopeCss(screen.css, screen.id);
        assert.deepEqual(warnings, [], screen.id);
        const scope = `[data-ss-screen="${screen.id}"]`;
        const selectors = selectorsOf(css);
        assert.ok(selectors.length > 40, `${screen.id} has its rules`);
        for (const selector of selectors) assert.ok(selector.startsWith(scope), `${screen.id}: "${selector}" is not scoped`);
        // Keyframes are renamed per screen, and the animation uses the new name.
        if (/@keyframes rb-pulse/.test(screen.css)) {
            assert.doesNotMatch(css, /@keyframes rb-pulse/);
            assert.match(css, /@keyframes ss-rpg-battle-[a-z-]+-rb-pulse/);
        }
    }
});

test('templates: no script, style, inline handlers or javascript: URLs; data stays out of markup', () => {
    for (const screen of screens) {
        assert.doesNotMatch(screen.template, /<script|<style|<iframe|<object|<embed|<link|<meta|<base|\son[a-z]+=|javascript:|innerHTML/i, screen.id);
        assert.doesNotMatch(screen.template, /\sstyle=/i, `${screen.id}: styling from data goes through CSS classes and variables`);
        // URL attributes are never only a hole (the sanitiser would drop them, TEMPLATES.md §3).
        assert.doesNotMatch(screen.template, /\s(?:src|href)="\{\{/i, screen.id);
    }
});

test('buttons run commands RPG Battle has; widgets are the standard ss.* set', () => {
    const used = new Set();
    for (const screen of screens) {
        for (const [, type] of screen.template.matchAll(/data-command="([^"]+)"/g)) {
            assert.ok(COMMANDS.has(type), `${screen.id}: ${type} is not one of RPG Battle's commands`);
            used.add(type);
        }
        for (const [, name] of screen.template.matchAll(WIDGET_TAG)) assert.ok(WIDGET_NAMES.includes(name) || OWN_WIDGETS.includes(name), `${screen.id}: ${name}`);
        // Every widget tag is closed (TEMPLATES.md §2).
        assert.equal((screen.template.match(/<ss-widget/g) ?? []).length, (screen.template.match(/<\/ss-widget>/g) ?? []).length, screen.id);
    }
    // The party card's EQUIPMENT tiles send no commands (the unequip is the widget's own tap, UI 8f); crafting has no buttons.
    assert.deepEqual([...used].sort(), [
        'craft.collect', 'craft.commission',
        'party.acceptOffer', 'party.dismissOffer', 'party.edit', 'party.setSkillActive', 'party.spend', 'trade.buy', 'trade.sell',
    ]);
    assert.doesNotMatch(byId['rpg-battle/crafting'].template, /data-command|<button/);
    const widgets = new Set(screens.flatMap(screen => [...screen.template.matchAll(WIDGET_TAG)].map(match => match[1])));
    for (const name of ['ss.hero', 'ss.radar', 'ss.stepper', 'ss.bar', 'ss.status']) assert.ok(widgets.has(name), `a screen uses ${name}`);
    assert.ok(widgets.has('rpg-battle.skill-tree'), 'the Party card\'s skills are the skill tree (tiers and branches drawn by RPG Battle)');
    // Story Block's blocks replace the old widgets the screens used to draw (ss.meter, ss.badge, ss.skill-tree).
    for (const name of ['ss.meter', 'ss.badge', 'ss.skill-tree']) assert.ok(!widgets.has(name), `no screen draws ${name} any more`);
});

test('feature tags (MODULES §F100): the Crafting screen is the crafting feature\'s', () => {
    assert.equal(byId['rpg-battle/crafting'].feature, 'rpg-battle.crafting');
    for (const screen of screens) if (screen.id !== 'rpg-battle/crafting') assert.equal(screen.feature, undefined, screen.id);
});
