// Other modules' modifiers on a check (Story Block MODULES §F126, src/v2/checks/outside.js) and the dice told
// back to the next reply when a check line wrote another result (card.js toldBack), on the real testkit host.
// NPC State Delta is a stub here: its `npc.socialModifier({ name, skill })` → { mod, reasons } | null.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { replyCardLines } from '../../vendor/story-block/src/v2/screens/index.js';
import { capOf, outsideModifiers, socialSkill, targetOf } from '../../../src/v2/checks/outside.js';
import { toldBackLine } from '../../../src/v2/checks/card.js';

/** Delta's stub: Elula is wary (−2) and charmed by flattery (+1); everyone else has no opinion. */
function deltaStub(asked) {
    return {
        id: 'npc-state-delta', name: 'NPC State Delta (stub)', version: '0.0.1',
        queries: {
            'npc.socialModifier': (state, { name, skill } = {}) => {
                asked.push({ name, skill });
                return name === 'Elula' ? { mod: -1, reasons: [{ text: 'Elula is wary', value: -2 }, { text: 'likes flattery', value: 1 }] } : null;
            },
        },
    };
}
/** A module adjusting every check through the generic hook; it reads the reply's state. */
const omen = {
    id: 'omen-test', name: 'Omens', version: '0.0.1',
    hooks: { checkModifiers: (view, args) => (view.state.domains.scene?.place?.name === 'Cursed Bridge' ? [{ mod: -3, text: `bad omen for ${args.actor.name}` }] : null) },
};
const loud = { id: 'loud-test', name: 'Loud', version: '0.0.1', hooks: { checkModifiers: () => [{ mod: 99, text: 'shouting' }, { mod: 4, text: 'cheering' }] } };

const lastIndex = host => host.ctx.chat.length - 1;
const entriesAt = (host, index) => Object.values(host.store.at(index).domains.checks.log)
    .filter(entry => host.store.changesAt(index).some(path => path.startsWith(`/domains/checks/log/${entry.id}`)))
    .sort((a, b) => a.rev - b.rev);
const cardLines = (host, index) => replyCardLines(host.registry.hookEntries('replyCard'), { index, state: host.store.at(index), changes: host.store.changesAt(index) });

test('outside.js: social words, the target from vs:/target: or someone here named in the text, the cap setting', () => {
    assert.equal(socialSkill('persuasion'), 'persuade');
    assert.equal(socialSkill('seduce'), 'charm');
    assert.equal(socialSkill('Intimidation'), 'intimidate');
    assert.equal(socialSkill('bluff'), 'deceive');
    assert.equal(socialSkill('haggle'), 'social');
    assert.equal(socialSkill('CHA'), 'social');
    assert.equal(socialSkill('stealth'), null);
    assert.equal(targetOf({ vs: 'Elula' }, 'anything', []), 'Elula');
    assert.equal(targetOf({ target: 'the Guard' }, '', []), 'the Guard');
    assert.equal(targetOf({}, 'talking Elula round at the gate', ['Wessel', 'Old Tam', 'Elula'], 'Wessel'), 'Elula');
    assert.equal(targetOf({}, 'asking old tam for a ride', ['Old Tam'], 'Wessel'), 'Old Tam');
    assert.equal(targetOf({}, 'Wessel steels himself', ['Wessel'], 'Wessel'), '', 'never the member making it');
    assert.equal(targetOf({}, 'Elulas cousin', ['Elula'], ''), '', 'whole words only');
    assert.equal(capOf({}), 5);
    assert.equal(capOf({ outsideCap: 2 }), 2);
    assert.equal(capOf({ outsideCap: 50 }), 5);
    // No ctx tools, a gather that throws, a query that throws: nothing.
    assert.deepEqual(outsideModifiers({}, { skill: 'persuade', target: 'Elula' }), []);
    assert.deepEqual(outsideModifiers({ gather: () => { throw new Error('x'); }, query: () => { throw new Error('y'); } }, { skill: 'persuade', target: 'Elula' }), []);
    const gather = () => [{ module: 'm', answer: [{ mod: 3, text: 't' }, { mod: 0, text: 'nothing' }, 'odd'] }];
    assert.deepEqual(outsideModifiers({ gather }, { skill: 'x' }, 0), [], 'cap 0 turns them off');
    assert.deepEqual(outsideModifiers({ gather }, { skill: 'x' }, 2).map(mod => [mod.amount, mod.reason]), [[3, 't (m)'], [-1, 'held to ±2']], 'the setting moves the cap');
    // Delta answering through a hook as well is not counted twice.
    assert.deepEqual(outsideModifiers({ gather: () => [{ module: 'npc-state-delta', answer: [{ mod: 2, text: 'x' }] }] }, { skill: 'x' }), []);
});

test('Delta\'s social modifier and another module\'s hook on the check line, with their source; held to ±cap; Re-read and swipe agree', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(31, async () => {
        const asked = [];
        const host = await rpgHost({ modules: [deltaStub(asked), omen] });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
            await host.send('Talk.', host.reply('At the gate.', ['~ place Cursed Bridge | kind: road', '+ present Elula']));
            await host.send('Persuade her.', host.reply('Wessel pleads.', ['? check persuade — talking Elula round | dc: 12 | roll: 1 | result: success']));
            const index = lastIndex(host);
            const [entry] = entriesAt(host, index);
            assert.equal(entry.target, 'Elula');
            assert.deepEqual(asked.filter(entry => entry.skill !== 'social').at(-1), { name: 'Elula', skill: 'persuade' });
            const outside = entry.modifiers.filter(mod => mod.source === 'module');
            assert.deepEqual(outside.map(mod => [mod.amount, mod.reason]), [[-3, 'bad omen for Wessel (omen-test)'], [-2, 'Elula is wary (Delta)'], [1, 'likes flattery (Delta)']]);
            assert.equal(entry.mod, entry.modifiers.reduce((n, mod) => n + mod.amount, 0));
            assert.equal(entry.total, entry.die + entry.mod);
            const [line] = cardLines(host, index);
            assert.ok(line.text.includes(' − 3 bad omen for Wessel (omen-test) − 2 Elula is wary (Delta) + 1 likes flattery (Delta) = '), line.text);
            // Re-read: the same state is asked, the same modifiers and total.
            const before = JSON.stringify(entriesAt(host, index).map(e => [e.modifiers, e.total, e.outcome]));
            assert.equal((await host.sdk.reread(index)).ok, true);
            assert.equal(JSON.stringify(entriesAt(host, index).map(e => [e.modifiers, e.total, e.outcome])), before);
            // A swipe on a stealth check: no social word, so Delta is not asked; the omen still counts.
            // (The tail's social rows ask Delta with skill `social` before each reply; the capture asks with the check's.)
            const capturedAsks = () => asked.filter(entry => entry.skill !== 'social').length;
            const n = capturedAsks();
            await host.swipe(host.reply('Wessel slips by.', ['? check stealth — past Elula | dc: 12 | roll: 1 | result: success']));
            const [sneak] = entriesAt(host, index);
            assert.equal(capturedAsks(), n, 'Delta is asked only for social skills');
            assert.deepEqual(sneak.modifiers.filter(mod => mod.source === 'module').map(mod => mod.amount), [-3]);
            const live = JSON.stringify(host.head());
            host.store.rebuild();
            assert.equal(JSON.stringify(host.head()), live);
        } finally {
            host.close();
        }
    });
});

test('the sum is held to ±5 (each entry to ±5), told on the line; alone RB adds nothing', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(32, async () => {
        const host = await rpgHost({ modules: [loud] });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
            await host.send('Go.', host.reply('Climb.', ['? check climb — the wall | dc: 15 | roll: 1 | result: success']));
            const [entry] = entriesAt(host, lastIndex(host));
            const outside = entry.modifiers.filter(mod => mod.source === 'module');
            assert.deepEqual(outside.map(mod => [mod.amount, mod.reason]), [[5, 'shouting (loud-test)'], [4, 'cheering (loud-test)'], [-4, 'held to ±5']]);
            assert.equal(outside.reduce((s, mod) => s + mod.amount, 0), 5);
        } finally {
            host.close();
        }
        const alone = await rpgHost();
        try {
            assert.equal((await alone.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
            await alone.send('Go.', alone.reply('Talk.', ['+ present Elula', '? check persuade — Elula | dc: 15 | roll: 1 | result: success']));
            const [entry] = entriesAt(alone, lastIndex(alone));
            assert.equal(entry.target, 'Elula');
            assert.equal(entry.modifiers.filter(mod => mod.source === 'module').length, 0, 'without Delta or a hook, nothing');
        } finally {
            alone.close();
        }
    });
});

test('dice told back: the next reply\'s tail gets one "[Dice] … actually …" line per disagreement (at most 2), once; a swipe of it too', async t => {
    t.mock.method(console, 'warn', () => {});
    await seeded(33, async () => {
        const host = await rpgHost();
        try {
            assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
            // DC 40 is out of reach but for a natural 20: the written "success" is (almost surely) wrong.
            await host.send('Chase.', host.reply('Wessel runs the wolf down.', [
                '? check AGI — pursuing the wounded wolf | dc: 40 | roll: 1 | result: success',
                '? check perception — spotting it | dc: 40 | roll: 2 | result: success',
            ]));
            const entries = entriesAt(host, lastIndex(host));
            const expected = entries.map(entry => toldBackLine(entry)).filter(Boolean);
            assert.ok(expected.length >= 1, 'setup: a disagreement');
            const failed = entries.find(entry => entry.outcome === 'fail' && entry.skill === 'AGI');
            if (failed) assert.equal(toldBackLine(failed), `[Dice] Wessel's AGI check (pursuing the wounded wolf) actually failed (${failed.total} vs DC 40): let the consequence show.`);
            await host.send('Then?', host.reply('It got away.'));
            const told = host.tails().at(-1).split('\n').filter(line => line.startsWith('[Dice]'));
            assert.deepEqual(told, expected);
            // The reply that was told it is swiped: told again (the same lines).
            await host.swipe(host.reply('It limped off.'));
            assert.deepEqual(host.tails().at(-1).split('\n').filter(line => line.startsWith('[Dice]')), expected);
            // The reply after: not repeated.
            await host.send('On.', host.reply('Pines.'));
            assert.deepEqual(host.tails().at(-1).split('\n').filter(line => line.startsWith('[Dice]')), []);
        } finally {
            host.close();
        }
    });
});

test('toldBackLine: only a disagreement, never a pre-rolled check or one with no written result', () => {
    const entry = { id: 'ck_a', name: 'Wessel', skill: 'AGI', stat: 'AGI', what: 'pursuing the wounded wolf', dc: 10, total: 5, outcome: 'fail', said: 'success' };
    assert.equal(toldBackLine(entry), '[Dice] Wessel\'s AGI check (pursuing the wounded wolf) actually failed (5 vs DC 10): let the consequence show.');
    assert.equal(toldBackLine({ ...entry, pre: true }), '', 'Story Block\'s pre-roll told the narrator before it wrote');
    assert.equal(toldBackLine({ ...entry, said: null }), '');
    assert.equal(toldBackLine({ ...entry, said: 'fail' }), '');
    assert.equal(toldBackLine({ ...entry, outcome: 'crit', said: 'success' }), '', 'a crit is a success');
    assert.match(toldBackLine({ ...entry, outcome: 'cost', total: 9 }), /actually succeeded only at a cost \(9 vs DC 10\)/);
    assert.match(toldBackLine({ ...entry, skill: 'stealth', stat: 'DEX', outcome: 'success', total: 12, said: 'fail' }), /^\[Dice\] Wessel's Stealth check \(pursuing the wounded wolf\) actually succeeded \(12 vs DC 10\)/);
});
