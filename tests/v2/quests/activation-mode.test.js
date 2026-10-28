// An explicit activation (index.js boot with a frozen pack) pins the chat in the mode the reader's switch "Jobs from the story" has at that moment, like the Setup pin path does;
// a chat that already has a pin keeps the mode stored in it, and a pin that stored none is strict (2.2.0). The switch is read from the reader's stored choice (it is not a declared feature yet
// while the module is being made).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/host.js';
import { boot } from '../../../index.js';
import { seeded } from '../integration/helpers/host.js';
import { director, skip } from './helpers/real-host.js';
import { foesPack, pinFor } from '../progress/helpers/fixture.js';
import { bluewatch } from './helpers/bluewatch.js';

const FEATURE = 'rpg-battle.generative-offers';

/** A frozen pack with an open quest template, so the rules block of Jobs from the story can show (free mode) or not (strict). */
const openPin = () => {
    const pack = foesPack();
    pack.content.ranks = [{ id: 'F', title: 'F', levels: [1, 10], reward: [10, 100] }];
    pack.content.quests = [{ slug: 'open-hunt', name: 'Hunt (F)', open: true, rank: 'F', category: 'bounty', giver: null, turnInPlace: null, requirements: [{ kind: 'level', min: 1 }],
        objectives: [{ id: 'ob_00000001', kind: 'kill', count: 1, allowVariants: true }], reward: { coinMin: 20, coinMax: 100, xpMin: 20, xpMax: 100, items: [] }, durationMinutes: null, repeat: null, chain: null }];
    return { ...pinFor('activation-mode', pack), defs: {} };
};

/** A host with RPG Battle booted the way index.js does it: `rules` is the frozen pack of an explicit activation (null: resume a pin the chat has). */
async function booted(t, { rules = openPin(), switchOn = undefined, st = null } = {}) {
    const settings = switchOn === undefined ? null : { features: { [FEATURE]: switchOn } };
    const h = await createHost({ modules: [director()], ...(st ? { st } : {}), ...(settings ? { settings } : {}) });
    t.after(() => h.close());
    const global = { StoryBlock: { apiVersion: 2, ready: Promise.resolve(h.sdk) }, SillyTavern: { getContext: () => h.ctx } };
    const result = await boot({ rules, global, doc: null });
    assert.equal(result.ok, true, String(result.error?.message ?? result.reason));
    if (!st) assert.equal((await h.sdk.command('party.create', { name: 'Ren', preset: 'fighter', class: 'pack.fixture/c0' })).ok, true);
    h.q = (name, args = {}) => h.sdk.query(name, args);
    return h;
}
/** Whether the chat's narrator is told the rules of Jobs from the story (the block shows only for a chat pinned free, whatever the switch says now). */
const told = h => h.q('quest.offerBlockOn', {}) === true && typeof h.q('quest.offerBlock', {}) === 'string';
const image = h => ({ chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) });

test('explicit activation with the switch off pins strict: the narrator is not told the rules of Jobs from the story', { skip }, async t => seeded(11, async () => {
    const h = await booted(t, { switchOn: false });
    await h.send('Hello.', 'The mill.');
    assert.equal(h.head().domains.rules.mode, 'strict');
    assert.equal(told(h), false, 'the narrator is not told rules the chat will not apply');
}));

test('explicit activation with the switch on (or never touched) pins free: the narrator is told the rules', { skip }, async t => seeded(11, async () => {
    for (const switchOn of [true, undefined]) {
        const h = await booted(t, { switchOn });
        await h.send('Hello.', 'The mill.');
        assert.equal(h.head().domains.rules.mode, 'free', String(switchOn));
        assert.equal(told(h), true, String(switchOn));
    }
}));

test('a chat resumed with a pin keeps the mode stored in it, whatever the switch says now and whether or not the pack is passed again', { skip }, async t => seeded(11, async () => {
    for (const [pinnedWith, nowSwitch, expected] of [[false, true, 'strict'], [true, false, 'free']]) {
        const first = await booted(t, { switchOn: pinnedWith });
        await first.send('Hello.', 'The mill.');
        assert.equal(first.head().domains.rules.mode, expected);
        for (const rules of [null, openPin()]) {
            const saved = image(first);
            saved.extensionSettings.storySuite.features = { [FEATURE]: nowSwitch };
            const again = await booted(t, { rules, st: saved });
            assert.equal(again.head().domains.rules.mode, expected, `pinned ${expected}, switch now ${nowSwitch}, pack ${rules ? 'passed' : 'not passed'}`);
            assert.equal(told(again), expected === 'free');
        }
    }
}));

test('a pin made before 2.3.0 stores no mode and stays strict with the switch on', async t => {
    const { readFileSync } = await import('node:fs');
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/pinned-2.2.0.json', import.meta.url), 'utf8'));
    const h = await bluewatch(t, { st: { chat: structuredClone(fixture.chat), extensionSettings: { ...structuredClone(fixture.extensionSettings), storySuite: { ...structuredClone(fixture.extensionSettings.storySuite), features: { [FEATURE]: true } } } } });
    assert.equal(h.head().domains.rules.mode, undefined);
    assert.notEqual(h.q('quest.offerBlockOn', {}), true);
});
