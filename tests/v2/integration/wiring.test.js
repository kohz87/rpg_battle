// The module's wiring on the real Story Block v2 host (the vendored runtime): the creation part's
// wizard command into the party part (race, talents, background; a pack's races, talents and
// ready-made characters with their skills), companions who die in a fight to the death or leave
// (MODULES §F26), the reader's display terms (§F25), and the screens and widgets every part brings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playOut, rpgHost, seeded } from './helpers/host.js';
import { MODULE_ID } from '../../../src/v2/module.js';
import { presetDraft } from '../../../src/v2/creation/index.js';

const points = given => Object.fromEntries(['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'].map(stat => [stat, given[stat] ?? 0]));

// A small pack in Story Block's format (PACKS.md, ERSVEIL.md §10): races, talents, skills, presets.
const PACK = {
    id: 'riverlands',
    version: '1.0.0',
    name: 'Riverlands',
    requires: { storyBlock: '^2' },
    content: {
        races: [
            { id: 'human', name: 'Human', note: 'No stat change.', stats: {} },
            { id: 'elf', name: 'Elf', note: 'Long-lived.', stats: { DEX: 1, VIT: -1 } },
        ],
        talents: [
            { id: 'shadow-bent', name: 'Shadow-bent', note: 'Self-taught shadow.', stats: { INT: 1 } },
            { id: 'river-born', name: 'River-born', note: 'At home on a barge.', stats: { AGI: 1 } },
        ],
        skills: [
            { name: 'Cane Draw', type: 'physical', stat: 'DEX', target: 'one', note: 'The hidden blade drawn and cut in one motion.' },
            { name: 'Shadow Cut', type: 'magic', stat: 'INT', target: 'all', note: 'A thin arc of cold shadow.' },
        ],
        presets: [
            { id: 'wessel-kit', name: 'Wessel (kit)', race: 'human', talents: ['shadow-bent', 'river-born'], points: { VIT: 1, AGI: 2, DEX: 3, INT: 1, LUK: 1 }, skills: ['cane-draw', 'shadow-cut'] },
        ],
    },
};

async function withPack(options = {}) {
    const host = await rpgHost(options);
    const installed = await host.packs.packs.install(JSON.stringify(PACK));
    assert.equal(installed.ok, true, JSON.stringify(installed.errors ?? installed));
    return host;
}

test('creation.finish with a built-in race, talents and the persona\'s background makes your character', async () => {
    const host = await rpgHost();
    try {
        const out = await host.cmd('creation.finish', { name: 'Ren', background: 'A ferryman\'s daughter.', race: 'rpg-battle/elf', talents: ['rpg-battle/keen-eyes'], points: points({ STR: 4, DEX: 5 }) });
        assert.equal(out.ok, true, out.message);
        const pc = host.q('party.pc');
        assert.equal(pc.name, 'Ren');
        assert.equal(pc.background, 'A ferryman\'s daughter.');
        assert.deepEqual(pc.origin, { race: { id: 'rpg-battle/elf', name: 'Elf' }, talents: [{ id: 'rpg-battle/keen-eyes', name: 'Keen Eyes' }] });
        assert.deepEqual(pc.stats, { STR: 9, VIT: 4, AGI: 5, DEX: 13, INT: 6, LUK: 5, CHA: 5 });
        assert.equal(pc.hp.cur, pc.hp.max);
        // Creation is mandatory (§F12), and now done: the story goes on.
        const sent = await host.st.generate('normal', { reply: 'The story begins.' });
        assert.notEqual(sent.aborted, true);
        // party.create with an origin and no creation part to check it is refused, nothing saved.
        const before = JSON.stringify(host.head());
        const again = await host.cmd('creation.finish', { name: 'Ren', race: 'rpg-battle/elf', points: points({ STR: 10 }) });
        assert.equal(again.code, 'REFUSED');
        assert.equal(JSON.stringify(host.head()), before);
    } finally {
        host.close();
    }
});

test('a pack\'s races, talents and ready-made character: the preset fills the draft, its skills are learned', async () => {
    const host = await withPack();
    try {
        const content = host.q('creation.content', {});
        assert.deepEqual(content.races.map(race => race.id), ['pack.riverlands/human', 'pack.riverlands/elf']);
        assert.equal(content.hasPresets, true);
        const [kit] = content.presets;
        assert.equal(kit.skillNames, 'Cane Draw, Shadow Cut');
        const out = await host.cmd('creation.finish', { name: 'Wessel', background: 'A boatman.', ...presetDraft(kit) });
        assert.equal(out.ok, true, out.message);
        const pc = host.q('party.pc');
        assert.deepEqual(pc.stats, { STR: 5, VIT: 6, AGI: 8, DEX: 8, INT: 7, LUK: 6, CHA: 5 });
        assert.deepEqual(pc.origin.talents.map(entry => entry.name), ['Shadow-bent', 'River-born']);
        assert.deepEqual(pc.skills.map(skill => skill.name), ['Cane Draw', 'Shadow Cut']);
        const custom = host.head().domains.party.custom;
        assert.equal(custom['Shadow Cut'].type, 'magic');
        assert.equal(custom['Shadow Cut'].target, 'all');
        assert.match(out.receipt.summary, /^Wessel \(Human; Shadow-bent and River-born; Cane Draw, Shadow Cut\) is ready\.$/);
    } finally {
        host.close();
    }
});

/** Ren and a companion (a join line, accepted), in Bluewatch Village. */
async function withLyra() {
    const host = await rpgHost();
    assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
    await host.send('We walk into the village.', host.reply('An archer waves.', ['~ place Bluewatch Village | kind: settlement', '+ join Lyra — the archer | level: 1 | role: ranger']));
    const offer = host.q('party.offers')[0];
    assert.equal(offer.kind, 'join');
    const joined = await host.cmd('party.acceptOffer', { offer: offer.id });
    assert.equal(joined.ok, true, joined.message);
    return host;
}

test('a companion who goes down in a fight to the death is gone for good; the fight\'s summary says so', async () => {
    await seeded(1, async () => {
        const host = await withLyra();
        try {
            const lyra = host.q('party.actor', { name: 'Lyra' });
            await host.send('Into the crypt.', host.reply('It wakes.', ['! encounter 3 Grave Wight — out of the dark | tier: deadly | stakes: death']));
            assert.equal((await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id })).ok, true);
            assert.equal(await playOut(host), 'lost');
            const ended = await host.cmd('combat.end');
            assert.equal(ended.ok, true, ended.message);
            assert.deepEqual(ended.receipt.data.died, [{ id: lyra.id, name: 'Lyra' }]);
            assert.match(ended.receipt.summary, /Lyra died and is gone from the party for good\.$/);
            assert.equal(host.q('party.actor', { id: lyra.id }), null);
            assert.deepEqual(host.q('party.actors').map(actor => actor.name), ['Ren']);
            assert.deepEqual(host.q('party.pc').conditions, [{ kind: 'dead', stacks: 1 }], 'your character waits for the return');
        } finally {
            host.close();
        }
    });
});

test('a companion leaving the story: an offer to let them go; Accept removes them, the line\'s swipe takes the offer back', async () => {
    const host = await withLyra();
    try {
        const out = await host.send('At the ford.', host.reply('Lyra shoulders her bow.', ['- leave Lyra — parts ways at the ford']));
        const [offer] = host.q('party.offers');
        assert.equal(offer.kind, 'leave');
        assert.equal(offer.text, 'Lyra means to leave the party: parts ways at the ford.');
        assert.ok(host.q('party.actor', { name: 'Lyra' }), 'nobody leaves before the reader decides');
        await host.swipe('Lyra stays by the fire.');
        assert.deepEqual(host.q('party.offers'), []);
        await host.st.swipeTo(out.index, 0);
        const back = host.q('party.offers')[0];
        assert.equal(back.kind, 'leave');
        const gone = await host.cmd('party.acceptOffer', { offer: back.id });
        assert.equal(gone.ok, true, gone.message);
        assert.equal(host.q('party.actor', { name: 'Lyra' }), null);
        // `- join Name — leaves` is read the same way.
        const later = await withLyra();
        try {
            await later.send('Dawn.', later.reply('Lyra is gone at dawn.', ['- join Lyra — leaves']));
            assert.deepEqual(later.q('party.offers').map(entry => entry.kind), ['leave']);
            const kept = await later.cmd('party.dismissOffer', { offer: later.q('party.offers')[0].id });
            assert.equal(kept.receipt.summary, 'Lyra stays with the party.');
        } finally {
            later.close();
        }
    } finally {
        host.close();
    }
});

test('the reader\'s terms (§F25) word the summaries and the party screen', async () => {
    const terms = { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' } };
    const host = await rpgHost({ settings: { modules: { [MODULE_ID]: { terms } } } });
    try {
        assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
        const gained = await host.cmd('party.grantXp', { amount: 120, reason: 'the culvert' }, { cause: 'system' });
        assert.equal(gained.ok, true, gained.message);
        assert.match(gained.receipt.summary, /^the culvert: Ren Soul Growth \+120, reaches Soul Class I \(Lv 2\)\.$/);
        assert.deepEqual(host.q('party.terms'), terms);
        const [card] = host.q('rpg-battle.cards');
        assert.match(card.line, /^Soul Class I · /);
        assert.equal(card.xpName, 'Soul Growth');
    } finally {
        host.close();
    }
});

test('screens and widgets: every part\'s registered with Story Block; no hand-built tab is left over a screen', async () => {
    const host = await rpgHost();
    try {
        const screens = host.registry.screens().filter(screen => screen.moduleId === MODULE_ID).map(screen => screen.id);
        assert.deepEqual(screens, ['rpg-battle/create', 'rpg-battle/fight', 'rpg-battle/party', 'rpg-battle/items', 'rpg-battle/trade', 'rpg-battle/hud', 'rpg-battle/status-card']);
        const widgets = host.registry.widgets().filter(widget => widget.moduleId === MODULE_ID).map(widget => widget.name);
        assert.deepEqual(widgets, ['rpg-battle.battle-board', 'rpg-battle.preset-pick', 'rpg-battle.return-card']);
        const def = host.registry.modules().find(entry => entry.id === MODULE_ID);
        assert.deepEqual(def.tabs, []);
        // Each screen's data queries are registered.
        for (const screen of host.registry.screens().filter(entry => entry.moduleId === MODULE_ID)) {
            for (const [key, binding] of Object.entries(screen.data ?? {})) {
                if (binding?.query) assert.equal(typeof host.registry.query(binding.query), 'function', `${screen.id}: ${key} → ${binding.query}`);
            }
        }
    } finally {
        host.close();
    }
});
