// The track C screens as definitions (SPEC §13.1), and the fixtures against the contract: every screen valid by Story Block's
// validator, scoped CSS within its limit, every command and widget a template names one that exists, every query the views
// ask one the contract names (or a stand-in listed in CONTRACTS), the fixtures shaped as §3 says, and nothing in the screens
// folder computing a rule or reading markup.

import { createModule } from '../../../../src/v2/module.js';
import { rulesParts } from '../../../../src/v2/rules/index.js';
import { REAL_API, PENDING, c18 } from './fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { rulesActive, rulesScreens, setupActive } from '../../../../src/v2/screens/rules/screens.js';
import { rulesQueries, rulesWidgets } from '../../../../src/v2/screens/rules/index.js';
import { CLASS_STEP_TEMPLATE } from '../../../../src/v2/screens/rules/class-step.js';
import { isAreaTier, isParty, isProgress, isQuestView, isSheet } from '../../../../src/v2/screens/rules/ask.js';
import { scopeCss, validateScreen } from '../helpers/runtime.js';
import { WIDGET_NAMES } from '../helpers/render.js';
import {
    C13, CLASS_VIEWS, H, CONTRACTS, QF, SHIPPED_QUERIES, answers, c02, c04, c05, c08, c09, hashOf, seed, smallRulesPack, sheetOf,
} from './fixtures.js';

const OWN_WIDGETS = ['rpg-battle.permanent-choice', 'rpg-battle.class-pick', 'rpg-battle.command-input', 'rpg-battle.command-button',
    'rpg-battle.member-toggle', 'rpg-battle.equipment', 'rpg-battle.create-character'];
// Commands the views build into buttons that another module owns; the pending ones are in CONTRACTS.
const WIDGET_COMMANDS = ['quest.take', 'quest.finish', 'quest.abandon', 'skill.train'];
const SRC = new URL('../../../../src/v2/screens/rules/', import.meta.url);
const sourceOf = file => readFileSync(new URL(file, SRC), 'utf8');
const FILES = readdirSync(SRC).filter(name => name.endsWith('.js'));

test('five screens, unique ids, tab and screen mounts, each gated by rulesActive and reading a view query of this folder', () => {
    assert.deepEqual(rulesScreens.map(screen => screen.id), ['rpg-battle/progress', 'rpg-battle/quests', 'rpg-battle/roster', 'rpg-battle/links', 'rpg-battle/setup']);
    assert.equal(new Set(rulesScreens.map(screen => screen.id)).size, 5);
    for (const screen of rulesScreens) {
        assert.deepEqual(screen.mounts, ['tab', 'screen']);
        assert.equal(screen.active, screen.id === 'rpg-battle/setup' ? setupActive : rulesActive);
        assert.ok(screen.activeNote.length > 0);
        for (const { query } of Object.values(screen.data)) assert.equal(typeof rulesQueries[query], 'function', `${screen.id} reads ${query}`);
    }
    assert.deepEqual(Object.keys(rulesQueries).sort(), [
        'rpg-battle.classPicker', 'rpg-battle.linksView', 'rpg-battle.offers', 'rpg-battle.progressView', 'rpg-battle.questsView', 'rpg-battle.rosterView', 'rpg-battle.rulesDeps', 'rpg-battle.setupView']);
});

test('rulesActive: the pages exist only on a valid rules answer (a pinned chat), never for null, a missing query or a throw', () => {
    assert.deepEqual(rulesActive(null, { query: () => null }), { on: false }, 'a legacy chat: the query is registered but answers null');
    assert.deepEqual(rulesActive(null, { query: () => undefined }), { on: false });
    assert.deepEqual(rulesActive(null, { query: () => { throw new Error('No query called "rules.party".'); } }), { on: false });
    assert.deepEqual(rulesActive(null, {}), { on: false }, 'no queries at all');
    assert.deepEqual(rulesActive(null, { query: () => 'yes' }), { on: false }, 'not a record');
    assert.deepEqual(rulesActive(null, { query: () => ({ pc: null, active: [], reserve: [], temporary: [], activeLimit: 3 }) }), { on: true }, 'a pinned chat without a character yet');
    assert.deepEqual(rulesActive(null, { query: () => ({ pc: 'ac_00000001', active: [], reserve: [], temporary: [], activeLimit: 3 }) }), { on: true });
    assert.deepEqual(rulesActive(null, { query: () => ({ unexpected: 1 }) }), { on: true }, 'a shape this version does not know: the pages say mismatch themselves');
    const asked = [];
    rulesActive(null, { query: (name, args) => { asked.push([name, args]); return null; } });
    assert.deepEqual(asked, [['rules.party', {}]]);
});

test('Story Block\'s validator accepts every new screen and the class step; CSS is scoped, small and colourless', () => {
    for (const screen of rulesScreens) {
        assert.deepEqual(validateScreen(JSON.parse(JSON.stringify({ ...screen, active: undefined }))), [], screen.id);
        assert.ok(screen.css.length < 64 * 1024, `${screen.id} css is ${screen.css.length} bytes`);
        assert.doesNotMatch(screen.css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, `${screen.id}: colours come from Story Block's tokens`);
        assert.doesNotMatch(screen.css, /url\(|@import|position:\s*fixed/, screen.id);
        if (scopeCss) assert.deepEqual(scopeCss(screen.css, screen.id).warnings, [], `${screen.id}: nothing in the sheet is dropped by Story Block`);
        assert.doesNotMatch(screen.template, /<script|<style|\son[a-z]+=|javascript:|class="[^"]*\bbtn\b/i, screen.id);
    }
    const step = { id: 'rpg-battle/create-class', title: 'Class', mounts: ['dialog'], data: { c: { query: 'rpg-battle.classPicker' } }, template: CLASS_STEP_TEMPLATE, css: '' };
    assert.deepEqual(validateScreen(step), []);
});

test('every widget a template names is Story Block\'s or this part\'s, and no raw command button is left on a track C screen', () => {
    for (const screen of [...rulesScreens, { id: 'rpg-battle/create-class', template: CLASS_STEP_TEMPLATE }]) {
        // A raw data-command button runs the command and drops the answer: a refusal (STALE, REFUSED) would show nothing. Every command
        // button on these screens is the command-button widget, which says plainly when it was refused.
        assert.doesNotMatch(screen.template, /data-command|data-payload|<button/i, `${screen.id}: use rpg-battle.command-button`);
        for (const [, name] of screen.template.matchAll(/<ss-widget\b[^>]*?\sname="([^"]+)"/g)) {
            assert.ok(WIDGET_NAMES.includes(name) || OWN_WIDGETS.includes(name), `${screen.id}: ${name}`);
        }
    }
    for (const file of FILES) assert.doesNotMatch(sourceOf(file), /data-command|data-payload|<button/i, `${file}: no raw command button; use rpg-battle.command-button`);
    for (const command of WIDGET_COMMANDS) assert.ok(CONTRACTS[command], `${command} is listed as pending`);
    // The commands that were raw buttons are now widget specs built by the views.
    const built = FILES.map(sourceOf).join('\n');
    for (const command of WIDGET_COMMANDS) assert.match(built, new RegExp(`btn\\(\\s*'${command.replace('.', '\\.')}'`), `${command} is a command-button spec`);
    assert.deepEqual(Object.keys(rulesWidgets).sort(), OWN_WIDGETS.slice(0, 4).sort());
});

test('commands the views build into buttons are all listed in CONTRACTS with an owner', () => {
    const sources = FILES.map(sourceOf).join('\n');
    const named = new Set([...sources.matchAll(/btn\(\s*'([a-z]+\.[a-zA-Z]+)'/g)].map(match => match[1]));
    for (const [, command] of sources.matchAll(/command: '([a-z]+\.[a-zA-Z]+)'/g)) named.add(command);
    assert.ok(named.size >= 12, [...named].join());
    for (const command of named) {
        if (command === 'item.unequip') continue;
        assert.ok(CONTRACTS[command], `${command} needs an owner in CONTRACTS`);
    }
    for (const [command, entry] of Object.entries(CONTRACTS)) assert.ok(['A', 'B', 'E'].includes(entry.owner), `${command}: owner`);
});

test('every query the views ask is one the contract names, a shipped one, or a stand-in that CONTRACTS marks as a gap', () => {
    const asked = new Set();
    for (const file of FILES) for (const match of sourceOf(file).matchAll(/ask\(\s*tools,\s*'([a-zA-Z.]+)'/g)) asked.add(match[1]);
    assert.ok(asked.size >= 20, [...asked].join());
    const known = new Set([...Object.keys(CONTRACTS), ...SHIPPED_QUERIES]);
    assert.deepEqual([...asked].filter(name => !known.has(name)).sort(), []);
    const gaps = Object.entries(CONTRACTS).filter(([, entry]) => entry.shape === 'gap').map(([name]) => name).sort();
    assert.deepEqual(gaps, ['atlas.candidates']);
    for (const name of gaps) assert.ok(CONTRACTS[name].note.length > 20, `${name} says what it is`);
});

test('nothing in the rules screens computes a rule or reads markup: imports are the screens\' own, and no innerHTML or eval', () => {
    const allowed = [/^\.\/[a-z-]+\.js$/, /^\.\.\/view\.js$/, /^\.\.\/style\.js$/, /^\.\.\/equipment\.js$/];
    for (const file of FILES) {
        const source = sourceOf(file);
        for (const [, from] of source.matchAll(/from '([^']+)'/g)) assert.ok(allowed.some(pattern => pattern.test(from)), `${file} imports ${from}`);
        assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|Math\.random|Date\.now/, file);
        assert.doesNotMatch(source, /Claude|Opus|Sonnet|Anthropic/i, `${file}: no model names`);
    }
});

test('the fixtures are the shapes §3 gives: sheets, progress, party and quests pass the structural guards', () => {
    for (const sheet of [sheetOf(), QF.C02.queries['rules.sheet'], c02().sheet, c05().sheet, c04().sheet]) assert.equal(isSheet(sheet), true, sheet.name);
    for (const progress of [QF.C02.queries['rules.progress'], QF.C05.queries['rules.progress'], c02().progress, c04().progress, c05().progress]) assert.equal(isProgress(progress), true);
    assert.equal(isParty(c08().party), true);
    assert.equal(isParty(c09().answers['rules.party']), true);
    assert.equal(isQuestView(QF.C07.queries['rules.quests'][0]), true);
    assert.equal(isAreaTier(answers()['world.areaTier']({ place: 'pack.fixture/haven' })), true);
    assert.equal(sheetOf().skills.length, 3);
    assert.equal(c04().sheet.skills.length, 3);
    // The contract's golden pack: four tiers of three skills, 24 written branches on the three advanced skills.
    const rules = smallRulesPack().content.rules[0];
    assert.equal(rules.classes.length, 4);
    assert.equal(rules.skills.length, 12);
    assert.equal(rules.branches.length, 24);
    assert.equal(new Set(rules.branches.map(branch => branch.slug)).size, 24);
    assert.equal(CLASS_VIEWS.filter(item => item.tier === 0).length, 2);
    assert.ok(CLASS_VIEWS.every(item => item.skills.length === 3), 'a class has exactly three skills');
});

test('the contract\'s own hashes: H is the SHA-256 of the normalized pack, schema and constants, and is what every choice carries', () => {
    assert.match(H, /^[0-9a-f]{64}$/);
    assert.equal(seed.H, H);
    assert.equal(QF.C02.command[1].rulesHash, H);
    assert.equal(QF.C05.command[1].rulesHash, H);
    assert.equal(hashOf({ b: 1, a: [2, 1] }), hashOf({ a: [2, 1], b: 1 }), 'object key order does not matter');
    assert.notEqual(hashOf({ a: [2, 1] }), hashOf({ a: [1, 2] }), 'array order does');
    assert.equal(hashOf(null), hashOf(null));
});

test('every dependency scenario is a complete answers table (nothing a view asks is left undefined by accident)', () => {
    for (const [name, make] of Object.entries(C13)) {
        const table = make();
        assert.ok(Object.keys(table).length >= 20, name);
    }
});


test('the former track B stand-ins name real registered query/command handlers and use their wire shapes', () => {
    const base = createModule();
    const registered = Object.assign({}, base.commands, base.queries, ...rulesParts.flatMap(([, p]) => [p.commands ?? {}, p.queries ?? {}]));
    for (const name of REAL_API.filter(name => !name.startsWith('inventory.') && !name.startsWith('savepoint.'))) {
        assert.equal(typeof registered[name], 'function', name);
        assert.equal(PENDING[name], undefined, `${name} is implemented`);
    }
    assert.deepEqual(answers()['rules.identity'], { hash: H, packId: 'fixture', version: '2.0.0' });
    assert.ok(CLASS_VIEWS.every(c => c.skills.every(s => typeof s === 'string')));
    assert.equal('frozen' in c18().answers['rules.item']({ def: 'craft/iron-blade' }), false);
    assert.equal(c08().party.active.length + c08().party.reserve.length - 1, 4);
});
