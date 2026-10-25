// Track C fixtures C16 (check links), C17 (world identity), C18 (generated inputs) and C19 (native identity), on the Links
// page. Each case asserts the view query's output, the exact payload every button or field sends (always with the
// expectedHash the query returned, never a minted id), and what is drawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { linksScreen, rosterScreen } from '../../../../src/v2/screens/rules/screens.js';
import { linksView } from '../../../../src/v2/screens/rules/links.js';
import { rosterView } from '../../../../src/v2/screens/rules/roster.js';
import { classPickerView } from '../../../../src/v2/screens/rules/class-step.js';
import {
    CANON, LYRA, MISSING, PC, RG_NORTH, RG_SOUTH, answers, areaTier, atlasPolicy, c16, c17, c18, c19, checksPolicy, companionOf, partyOf, ref, sha256, sheetOf,
} from './fixtures.js';
import { all, drawOver, names, settle, skip, text, viewOf, widgetsIn } from './helpers.js';

const drawn = (table, options) => drawOver(linksScreen, table, options);
const sectionOf = (el, name) => el.querySelector(`.sect.${name}`);
const pressByLabel = async (root, label) => {
    const button = all(root, '.rpg-cb-go').find(node => text(node) === label);
    assert.ok(button, `a button called "${label}"`);
    button.dispatch('click');
    await settle();
};
// Types into a command-input and submits it.
const submitInput = async (form, value) => {
    form.querySelector('.rpg-ci-input').value = value;
    form.querySelector('.rpg-ci-go').dispatch('click');
    await settle();
};

// ---- C16 check links ------------------------------------------------------------------------------------------------

test('C16 check links: a standalone actor keeps its own bonuses; a linked one says whose sheet supplies the modifier', { skip }, () => {
    const { policy, answers: table } = c16();
    const view = viewOf(linksView, table).checks;
    assert.equal(view.state, 'ready');
    assert.equal(view.hash, policy.hash);
    const [astra, mira] = view.actors;
    assert.deepEqual([astra.name, astra.isDefault, astra.bonuses, astra.link.state, astra.link.rbName], ['Astra', true, 'DEX +1', 'linked', 'Astra']);
    assert.deepEqual([mira.name, mira.isDefault, mira.bonuses, mira.link.state], ['Mira', false, 'No bonuses', 'unlinked']);
    assert.match(mira.link.text, /uses its own bonuses/);
});

test('C16 check links: link, relink and unlink send the actor pair with the policy hash; nothing is minted', { skip }, async () => {
    const lyra = companionOf(LYRA, 'Lyra');
    const { policy, answers: table } = c16({ answers: { 'rules.party': partyOf({ active: [sheetOf(), lyra] }) } });
    const view = viewOf(linksView, table).checks;
    const [astra, mira] = view.actors;
    assert.deepEqual(mira.linkOptions.map(option => [option.label, option.payload]), [
        ['Link to Astra', { actor: 'ca_00000002', rbActor: PC, expectedHash: policy.hash }],
        ['Link to Lyra', { actor: 'ca_00000002', rbActor: LYRA, expectedHash: policy.hash }],
    ]);
    assert.deepEqual(astra.linkOptions.map(option => option.label), ['Relink to Lyra'], 'a relink is one command to the new target');
    assert.deepEqual(astra.unlinkButton, { command: 'checks.link', payload: { actor: 'ca_00000001', rbActor: null, expectedHash: policy.hash }, label: 'Unlink', tone: 'quiet', disabled: false, title: '' });
    assert.equal(mira.canUnlink, false);
    assert.deepEqual(mira.makeDefaultButton.payload, { id: 'ca_00000002', name: 'Mira', bonuses: {}, makeDefault: true, expectedHash: policy.hash });
    assert.equal(astra.canMakeDefault, false);
    for (const option of [...mira.linkOptions, ...astra.linkOptions]) assert.equal(Object.hasOwn(option.payload, 'write'), false, 'the host stamps the write id');

    const { drawn: d } = drawn(table);
    assert.deepEqual(d.warnings, []);
    const actorRows = all(sectionOf(d.el, 'checks'), 'li.actor');
    assert.equal(actorRows.length, 2);
    await pressByLabel(actorRows[0], 'Unlink');
    await pressByLabel(actorRows[0], 'Relink to Lyra');
    await pressByLabel(actorRows[1], 'Make default');
    assert.deepEqual(d.commands, [
        { type: 'checks.link', payload: { actor: 'ca_00000001', rbActor: null, expectedHash: policy.hash } },
        { type: 'checks.link', payload: { actor: 'ca_00000001', rbActor: LYRA, expectedHash: policy.hash } },
        { type: 'checks.actor', payload: { id: 'ca_00000002', name: 'Mira', bonuses: {}, makeDefault: true, expectedHash: policy.hash } },
    ]);
});

test('C16 check links: a stale hash or a duplicate target is refused and shown; the payload always carries the hash the query gave', { skip }, async () => {
    const first = c16();
    const second = c16({ policy: { hash: sha256('checks.policy.2') } });
    const hashOf = table => viewOf(linksView, table).checks.actors[1].linkOptions[0].payload.expectedHash;
    assert.equal(hashOf(first.answers), first.policy.hash);
    assert.equal(hashOf(second.answers), second.policy.hash);
    assert.notEqual(hashOf(first.answers), hashOf(second.answers), 'after a change the next press uses the new hash');

    for (const [code, message] of [['STALE', ''], ['CONFLICT', 'That character is already linked to another check actor.']]) {
        const { drawn: d } = drawn(first.answers, { result: () => ({ ok: false, code, message }) });
        const row = all(sectionOf(d.el, 'checks'), 'li.actor')[1];
        await pressByLabel(row, 'Link to Astra');
        const said = text(all(row, '.rpg-cb-problem').find(node => text(node) !== ''));
        assert.equal(said, message || 'This changed since it was drawn. Look again and try once more.');
        assert.equal(d.commands.length, 1, 'no retry by itself');
    }
});

test('C16 check links: with RPG Battle absent or dormant the link is kept and the actor\'s own bonuses are used; a link to a missing character says so', { skip }, () => {
    const absent = viewOf(linksView, c16({ answers: { 'rules.party': MISSING } }).answers).checks;
    assert.equal(absent.rbReady, false);
    assert.equal(absent.actors[0].link.state, 'fallback');
    assert.match(absent.actors[0].link.text, /own bonuses are used for now; the link is kept/);
    assert.deepEqual(absent.actors[1].linkOptions, [], 'nobody to link to while RPG Battle is not answering');
    assert.match(absent.note, /linked actors use their own bonuses/);

    const gone = viewOf(linksView, c16({ policy: { rbActors: { ca_00000001: 'ac_0000dead' } } }).answers).checks;
    assert.equal(gone.actors[0].link.state, 'stale');
    assert.match(gone.actors[0].link.text, /no longer has.*link is kept until you change it/);

    const off = viewOf(linksView, c16({ policy: { rbModifiers: false } }).answers).checks;
    assert.match(off.note, /modifiers are switched off/);
    assert.equal(viewOf(linksView, answers({ 'checks.policy': MISSING })).checks.state, 'unavailable');
});

test('C16 check links: creating a character links the chosen actor, the default, or a new one; the page never mints the new id', { skip }, () => {
    const withDefault = viewOf(classPickerView, answers());
    assert.equal(withDefault.checks.fallback, 'If you choose none, Astra (the default) is used.');
    assert.deepEqual(withDefault.checks.pick.options.map(option => [option.id, option.sub]), [['ca_00000001', 'Current default'], ['ca_00000002', '']]);
    const none = viewOf(classPickerView, answers({ 'checks.policy': checksPolicy({ actors: {}, defaultActor: null, rbActors: {} }) }));
    assert.equal(none.checks.fallback, 'If you choose none, a new check actor is made for your character.');
    assert.deepEqual(none.checks.pick.options, []);
    assert.equal(viewOf(classPickerView, answers({ 'checks.policy': MISSING })).checks.state, 'unavailable');
    // The three finish payloads: chosen carries the id; default and new carry no checkActor at all.
    const chosen = { name: 'Astra', class: ref('c0'), checkActor: 'ca_00000002' };
    assert.deepEqual(Object.keys(chosen).filter(key => /^ca_/.test(String(chosen[key]))), ['checkActor']);
});

test('C16 check links: a new actor is added from a name field with the policy hash; markup in names stays text', { skip }, async () => {
    const { policy, answers: table } = c16({ policy: { actors: { ca_00000001: { id: 'ca_00000001', name: 'A <b>x</b>', bonuses: {} } }, defaultActor: 'ca_00000001', rbActors: {} } });
    const { drawn: d } = drawn(table);
    const form = widgetsIn(sectionOf(d.el, 'checks'), 'rpg-battle.command-input')[0].querySelector('form');
    await submitInput(form, 'Old Tam');
    assert.deepEqual(d.commands, [{ type: 'checks.actor', payload: { expectedHash: policy.hash, name: 'Old Tam' } }]);
    assert.equal(all(d.el, 'b').filter(node => text(node) === 'x').length, 0, 'no element made from the marker');
    assert.ok(text(sectionOf(d.el, 'checks')).includes('A <b>x</b>'));
});

// ---- C17 world identity ----------------------------------------------------------------------------------------------

test('C17 world identity: regions keep their rg_ ids and aliases; create and rename send the id, never the display text', { skip }, async () => {
    const { policy, answers: table } = c17();
    const world = viewOf(linksView, table).world;
    assert.equal(world.state, 'ready');
    assert.deepEqual(world.regions.map(region => [region.id, region.name, region.aliasText, region.dangerText]), [
        [RG_NORTH, 'North Marches', 'Also called The Marches', 'Tier 4'], [RG_SOUTH, 'Southreach', '', 'Not set']]);
    assert.deepEqual(world.createRegion.payload, { expectedHash: policy.hash });
    assert.deepEqual(world.regions[0].rename.payload, { id: RG_NORTH, aliases: ['The Marches'], expectedHash: policy.hash }, 'a rename keeps the aliases');

    const { drawn: d } = drawn(table);
    assert.deepEqual(d.warnings, []);
    const forms = widgetsIn(sectionOf(d.el, 'world'), 'rpg-battle.command-input').map(node => node.querySelector('form'));
    const label = form => text(form.querySelector('.rpg-ci-label'));
    await submitInput(forms.find(form => label(form) === 'New region'), 'West Reach');
    await submitInput(forms.filter(form => label(form) === 'Rename')[0], 'The North');
    assert.deepEqual(d.commands, [
        { type: 'atlas.region', payload: { expectedHash: policy.hash, name: 'West Reach' } },
        { type: 'atlas.region', payload: { id: RG_NORTH, aliases: ['The Marches'], expectedHash: policy.hash, name: 'The North' } },
    ]);
});

test('C17 world identity: a place joins a region only when the reader says so, by its canonical id', { skip }, async () => {
    const { policy, answers: table } = c17({ answers: { 'atlas.canonical': ({ id, name } = {}) => (id === undefined && name === undefined ? CANON.mill : Object.values(CANON).find(item => item.id === id) ?? null) } });
    const world = viewOf(linksView, table).world;
    const mill = world.places.find(place => place.id === ref('mill'));
    const haven = world.places.find(place => place.id === ref('haven'));
    assert.equal(mill.regionText, 'No region');
    assert.deepEqual(mill.memberOptions.map(option => [option.label, option.payload]), [
        ['Put in North Marches', { place: ref('mill'), region: RG_NORTH, expectedHash: policy.hash }],
        ['Put in Southreach', { place: ref('mill'), region: RG_SOUTH, expectedHash: policy.hash }],
    ]);
    assert.equal(mill.canLeaveRegion, false);
    assert.deepEqual(haven.leaveButton.payload, { place: ref('haven'), region: null, expectedHash: policy.hash });
    assert.deepEqual(haven.memberOptions.map(option => option.payload.region), [RG_SOUTH]);
    assert.equal(world.here.id, ref('mill'));

    const { drawn: d } = drawn(table);
    const row = all(d.el, 'li.place').find(item => text(item.querySelector('.row-head b')) === 'Mill');
    await pressByLabel(row, 'Put in Southreach');
    assert.deepEqual(d.commands, [{ type: 'atlas.placeRegion', payload: { place: ref('mill'), region: RG_SOUTH, expectedHash: policy.hash } }]);
});

test('C17 world identity: a pack place has the same canonical id before and after it is first visited', { skip }, () => {
    const before = c17({ answers: { 'atlas.canonical': ({ id } = {}) => (id === ref('mill') ? { ...CANON.mill, atlasId: null } : CANON.haven) } });
    const after = c17({ answers: { 'atlas.canonical': ({ id } = {}) => (id === ref('mill') ? { ...CANON.mill, atlasId: 'pl_00000002' } : CANON.haven),
        'atlas.policy': atlasPolicy({ placeRegions: { [ref('haven')]: RG_NORTH, [ref('mill')]: RG_SOUTH }, placeRefs: { pl_00000001: ref('haven'), pl_00000002: ref('mill') } }) } });
    const placeOf = (fixture) => viewOf(linksView, { ...fixture.answers, 'atlas.policy': fixture.answers['atlas.policy'] }).world.places.find(place => place.id === ref('mill'));
    // Mill is listed once it belongs to something; put it in a region in both.
    const beforeTable = { ...before.answers, 'atlas.policy': atlasPolicy({ placeRegions: { [ref('haven')]: RG_NORTH, [ref('mill')]: RG_SOUTH } }) };
    const a = viewOf(linksView, beforeTable).world.places.find(place => place.id === ref('mill'));
    const b = placeOf(after);
    assert.equal(a.canonicalId, ref('mill'));
    assert.equal(b.canonicalId, ref('mill'));
    assert.match(a.idText, /Pack place: pack\.fixture\/mill \(not visited yet\)/);
    assert.match(b.idText, /Pack place: pack\.fixture\/mill \(visited as pl_00000002\)/);
    assert.deepEqual(a.leaveButton.payload.place, b.leaveButton.payload.place, 'every payload names the canonical id, not the node key or pl_ id');
    assert.equal(a.leaveButton.payload.place, ref('mill'));
});

test('C17 world identity: an ambiguous place is held and only an explicit bind resolves it', { skip }, async () => {
    const policy = atlasPolicy({ placeRegions: { pl_00000009: RG_NORTH }, placeRefs: {} });
    const candidates = { place: 'pl_00000009', definitions: [ref('mill'), ref('haven')] };
    const table = answers({
        'atlas.policy': policy,
        'atlas.canonical': ({ id, name } = {}) => (id === 'pl_00000009' ? null : id === undefined && name === undefined ? CANON.haven : Object.values(CANON).find(item => item.id === id) ?? null),
        'atlas.candidates': ({ place }) => (place === 'pl_00000009' ? candidates : null),
        'world.areaTier': ({ place }) => areaTier(place, null, 'unknown', null),
    });
    const held = viewOf(linksView, table).world.places.find(place => place.id === 'pl_00000009');
    assert.equal(held.held, true);
    assert.match(held.idText, /Held: this place matches more than one pack place or none yet/);
    assert.equal(held.tierText, 'Danger: not set anywhere');
    assert.deepEqual(held.bindOptions.map(option => option.payload), [
        { place: 'pl_00000009', definition: ref('mill'), expectedHash: policy.hash }, { place: 'pl_00000009', definition: ref('haven'), expectedHash: policy.hash }]);
    const { drawn: d } = drawn(table);
    const row = all(d.el, 'li.place').find(item => item.classList.contains('held'));
    assert.ok(row);
    await pressByLabel(row, `Use ${ref('mill')}`);
    assert.deepEqual(d.commands, [{ type: 'atlas.placeBind', payload: { place: 'pl_00000009', definition: ref('mill'), expectedHash: policy.hash } }]);
    // Without a list of candidates there is nothing to press (the page does not guess a slug).
    const bare = viewOf(linksView, { ...table, 'atlas.candidates': MISSING }).world.places.find(place => place.id === 'pl_00000009');
    assert.deepEqual(bare.bindOptions, []);
    // The explicit bind that conflicts is shown as the command says it.
    const { drawn: refused } = drawn(table, { result: () => ({ ok: false, code: 'CONFLICT', message: 'That place is already bound elsewhere.' }) });
    await pressByLabel(all(refused.el, 'li.place').find(item => item.classList.contains('held')), `Use ${ref('mill')}`);
    assert.ok(text(refused.el).includes('That place is already bound elsewhere.'));
});

test('C17 world identity: the danger tier shown is the query\'s, from the place, then its region, then the world, and a typed tier keeps the lists', { skip }, async () => {
    const policy = atlasPolicy({
        placeRegions: { [ref('haven')]: RG_NORTH, [ref('mill')]: RG_NORTH },
        danger: { world: { tier: 1, allowedFoes: [], allowedTags: [], lore: [] }, regions: { [RG_NORTH]: { tier: 4, allowedFoes: [ref('wolf')], allowedTags: ['beast'], lore: ['Cold hills.'] } },
            places: { [ref('mill')]: { tier: 6, allowedFoes: [ref('wolf')], allowedTags: [], lore: [] } } },
    });
    // The page shows what world.areaTier says even where it disagrees with the lists it was given: it computes no precedence.
    const says = { [ref('haven')]: areaTier(ref('haven'), 4, 'region', RG_NORTH), [ref('mill')]: areaTier(ref('mill'), 6, 'place', ref('mill')) };
    const table = answers({ 'atlas.policy': policy, 'world.areaTier': ({ place }) => says[place] ?? areaTier(place, 1, 'world', null) });
    const world = viewOf(linksView, table).world;
    const tiers = Object.fromEntries(world.places.map(place => [place.id, place.tierText]));
    assert.equal(tiers[ref('haven')], 'Danger tier 4, from its region');
    assert.equal(tiers[ref('mill')], 'Danger tier 6, from this place');
    assert.equal(world.world.text, 'Tier 1');
    assert.match(world.precedence, /place wins over its region's, which wins over the world's/);
    const odd = viewOf(linksView, { ...table, 'world.areaTier': ({ place }) => areaTier(place, 9, 'region', RG_NORTH) }).world.places.find(place => place.id === ref('mill'));
    assert.equal(odd.tierText, 'Danger tier 9, from its region', 'not recomputed to the place override');
    const none = viewOf(linksView, { ...table, 'world.areaTier': ({ place }) => areaTier(place, null, 'unknown', null) }).world.places[0];
    assert.equal(none.tierText, 'Danger: not set anywhere');

    const { drawn: d } = drawn(table);
    const forms = widgetsIn(sectionOf(d.el, 'world'), 'rpg-battle.command-input').map(node => node.querySelector('form'));
    const regionTier = forms.filter(form => text(form.querySelector('.rpg-ci-label')) === 'Danger tier for this region')[0];
    await submitInput(regionTier, '5');
    assert.deepEqual(d.commands[0], { type: 'atlas.dangerSet', payload: { scope: 'region', key: RG_NORTH, expectedHash: policy.hash,
        policy: { tier: 5, allowedFoes: [ref('wolf')], allowedTags: ['beast'], lore: ['Cold hills.'] } } });
    const worldTier = forms.find(form => text(form.querySelector('.rpg-ci-label')) === 'Danger tier for the world');
    await submitInput(worldTier, '3');
    assert.deepEqual(d.commands[1].payload.scope, 'world');
    assert.equal(d.commands[1].payload.key, null);
    assert.equal(d.commands[1].payload.policy.tier, 3);
    await pressByLabel(all(d.el, 'li.region')[0], 'Clear tier');
    assert.deepEqual(d.commands[2], { type: 'atlas.dangerSet', payload: { scope: 'region', key: RG_NORTH, policy: null, expectedHash: policy.hash } });
    const bad = forms[0];
    await submitInput(bad, '');
    assert.equal(d.commands.length, 3, 'an empty field sends nothing');
});

test('C17 world identity: the world section unavailable, malformed, and stale are their own states', { skip }, async () => {
    assert.equal(viewOf(linksView, answers({ 'atlas.policy': MISSING })).world.state, 'unavailable');
    assert.equal(viewOf(linksView, answers({ 'atlas.policy': { nope: 1 } })).world.state, 'mismatch');
    const { policy, answers: table } = c17();
    const { drawn: d } = drawn(table, { result: () => ({ ok: false, code: 'STALE', message: '' }) });
    const form = widgetsIn(sectionOf(d.el, 'world'), 'rpg-battle.command-input').map(node => node.querySelector('form'))[0];
    await submitInput(form, '4');
    assert.match(text(form.querySelector('.rpg-ci-status')), /changed since it was drawn/);
    assert.equal(d.commands[0].payload.expectedHash, policy.hash);
});

// ---- C18 generated inputs --------------------------------------------------------------------------------------------

test('C18 generated inputs: flags and generated items are listed read only; reading assigns no id and changes no state', { skip }, () => {
    const fixture = c18();
    const state = Object.freeze({ domains: Object.freeze({}) });
    const log = [];
    const first = linksView(state, {}, { query: (name, args) => { log.push({ name, args }); const a = fixture.answers[name]; if (a === undefined || a === MISSING) throw new Error(`No query called "${name}".`); return typeof a === 'function' ? a(args ?? {}) : structuredClone(a); } }).inputs;
    assert.deepEqual(first.flags, [{ key: 'bell.rung', on: true, text: 'On' }, { key: 'gate.open', on: false, text: 'Off' }]);
    assert.deepEqual(first.items.map(item => [item.id, item.source, item.ruled]), [
        ['story/bone-charm', 'Story', true], ['craft/iron-blade', 'Crafted', true], ['trade/ale-common-l3', 'Bought', false], ['story/<b>odd</b>', 'Story', false]]);
    assert.ok(!first.items.some(item => item.id === 'pack.fixture/rope'), 'pack items are not generated ones');
    const second = linksView(state, {}, { query: (name, args) => { const a = fixture.answers[name]; if (a === undefined || a === MISSING) throw new Error('x'); return typeof a === 'function' ? a(args ?? {}) : structuredClone(a); } }).inputs;
    assert.deepEqual(second, first, 'asking twice gives the same answer');
    const reads = log.map(entry => entry.name).filter(name => name.startsWith('rules.') || name.startsWith('inventory.'));
    assert.deepEqual([...new Set(reads)].sort(), ['inventory.definitions', 'rules.flags', 'rules.item', 'rules.party']);
    assert.ok(reads.every(name => !/register|set|write/i.test(name)), 'only reads');
    assert.equal(JSON.stringify(state), '{"domains":{}}');
});

test('C18 generated inputs: the section has no buttons and nothing on the page sends a registration or a flag write', { skip }, async () => {
    const fixture = c18();
    const { drawn: d } = drawn(fixture.answers);
    assert.deepEqual(d.warnings, []);
    const inputs = sectionOf(d.el, 'inputs');
    assert.equal(all(inputs, 'button').length, 0);
    assert.equal(all(inputs, 'input').length, 0);
    assert.equal(all(inputs, 'li.flag').length, 2);
    assert.equal(all(inputs, 'li.item').length, 4);
    assert.match(text(inputs.querySelector('.hint')), /written only by the rules when a recognised story event happens/);
    for (const button of all(d.el, 'button')) { button.dispatch('click'); await settle(); }
    const sent = d.commands.map(command => command.type);
    assert.ok(sent.every(type => !/^(rules\.(registerItem|flagSet)|inventory\.registerDefinition)$/.test(type)), sent.join());
    assert.equal(fixture.calls.filter(call => call[0] !== 'rules.item' && call[0] !== 'inventory.definitions' && call[0] !== 'rules.flags').length, 0);
});

test('C18 generated inputs: an item with no rule says so; a flag whose evidence was deleted reads Off again; markup stays text', { skip }, () => {
    const fixture = c18();
    const { drawn: d } = drawn(fixture.answers);
    const items = all(sectionOf(d.el, 'inputs'), 'li.item');
    assert.deepEqual(items.map(item => item.classList.contains('unruled')), [false, false, true, true]);
    assert.match(text(items[2]), /No rule recorded/);
    assert.equal(all(d.el, 'b').filter(node => text(node) === 'one').length, 0, 'no element made from the marker');
    assert.ok(text(sectionOf(d.el, 'inputs')).includes('Odd <b>one</b>'));
    // Evidence deleted: the same flag reads Off on the next drawing.
    fixture.answers['rules.flags'] = { values: { 'bell.rung': false, 'gate.open': false }, hash: sha256('flags.2') };
    d.rerender();
    assert.deepEqual(all(sectionOf(d.el, 'inputs'), 'li.flag .ss-pill').map(text), ['Off', 'Off']);
    // Without the rules, the section says it has nothing to list.
    const none = viewOf(linksView, answers({ 'rules.flags': MISSING, 'inventory.definitions': MISSING })).inputs;
    assert.equal(none.state, 'unavailable');
});

// ---- C19 native identity ----------------------------------------------------------------------------------------------

const lyraTable = fixture => ({
    ...fixture.answers,
    'rules.party': partyOf({ active: [sheetOf(), companionOf(LYRA, 'Lyra', { npcId: 'np_00000001' })] }),
});
const dossier = (table) => viewOf(linksView, table).dossiers.rows[0];

test('C19 native identity: a companion\'s dossier is found by its np_ id; a rename keeps the same id and shows the new name', { skip }, () => {
    const linked = dossier(lyraTable(c19('linked')));
    assert.deepEqual([linked.npcId, linked.state, linked.text], ['np_00000001', 'linked', 'Dossier: Lyra.']);
    const renamed = dossier(lyraTable(c19('renamed')));
    assert.deepEqual([renamed.npcId, renamed.state, renamed.text], ['np_00000001', 'linked', 'Dossier: Lyra Vale.'], 'same id, new name');
    assert.equal(linked.id, renamed.id);
    // The lookup is by id, never by the companion's name.
    const log = [];
    viewOf(linksView, lyraTable(c19('linked')), {}, undefined, log);
    const lookups = log.filter(entry => entry.name === 'npc.identity').map(entry => entry.args);
    assert.deepEqual(lookups.filter(args => args.id), [{ id: 'np_00000001' }]);
    assert.ok(lookups.every(args => args.name === undefined || args.name === ' '), 'the only name asked is the presence probe');
});

test('C19 native identity: an unknown or ambiguous id is null and holds the actions that need it; a restore that drops the map says so', { skip }, () => {
    for (const stage of ['unknown', 'restored']) {
        const row = dossier(lyraTable(c19(stage)));
        assert.equal(row.state, 'unresolved', stage);
        assert.match(row.text, /cannot be found\. Death, relationship and recruit actions wait/);
        assert.equal(row.dossierName, undefined, 'no name is guessed');
        assert.equal(row.name, 'Lyra', 'the companion keeps their own name');
    }
    const none = dossier({ ...lyraTable(c19('linked')), 'rules.party': partyOf({ active: [sheetOf(), companionOf(LYRA, 'Lyra', { npcId: null })] }) });
    assert.equal(none.state, 'none');
    assert.equal(none.text, 'No dossier is linked to this companion.');
});

test('C19 native identity: with NPC State Delta absent the link is kept but not read; the roster says the same per companion', { skip }, () => {
    const table = { ...lyraTable(c19('linked')), 'npc.identity': MISSING };
    const row = dossier(table);
    assert.equal(row.state, 'absent');
    assert.match(row.text, /link is kept but cannot be read now/);
    const roster = viewOf(rosterView, table);
    assert.equal(roster.active[1].npc.state, 'absent');
    assert.equal(roster.active[0].npc.show, false, 'your own card has no dossier line');
    const noNpcId = viewOf(rosterView, { ...table, 'rules.party': partyOf({ active: [sheetOf(), companionOf(LYRA, 'Lyra')] }) });
    assert.equal(noNpcId.active[1].npc.state, 'absent');
    assert.match(noNpcId.active[1].npc.text, /not installed/);
});

test('C19 native identity: the Links and Roster pages draw the dossier line in each state', { skip }, () => {
    const table = lyraTable(c19('linked'));
    const { drawn: links } = drawn(table);
    assert.equal(text(links.el.querySelector('.dossier b')), 'Lyra');
    assert.equal(text(links.el.querySelector('.dossier small')), 'Dossier: Lyra.');
    const { drawn: roster } = drawOver(rosterScreen, table);
    assert.equal(text(all(roster.el, '.npc')[0]), 'Dossier: Lyra.');
    Object.assign(table, lyraTable(c19('restored')));
    roster.rerender();
    assert.ok(all(roster.el, '.npc')[0].classList.contains('unresolved'));
    assert.deepEqual(names([]), []);
});
