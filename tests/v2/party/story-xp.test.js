// The story's own XP awards (v1's <XP>minor|major|milestone: why</XP>): `+ xp minor|major|milestone — why`.
// The size is the story's word, the amount code's (v1 rules.xpAwards: a share of each member's next level,
// at the reader's XP rate); a number the story writes is never used (rule 1). At most one major or
// milestone and two minor a reply, claimed by the reply; level-ups follow as for any XP. The grammar line
// names the world's XP word and is byte-identical reply to reply (rule 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { createModule } from '../../../src/v2/module.js';
import { XP_AWARDS_PER_REPLY, xpGrammar } from '../../../src/v2/party/capture.js';
import { awardShare, xpAward } from '../../../src/growth.js';
import { makeRules } from '../../../src/rules.js';
import { CLOCK } from './helpers/clock.js';

const R = makeRules();
const json = value => JSON.stringify(value);
const award = (kind, level = 1) => xpAward(awardShare({ kind }, R), level, R);

async function withHost(seed, fn, { modules = [], settings = null } = {}) {
    await seeded(seed, async () => {
        const host = await rpgHost({ modules, ...(settings ? { settings } : {}) });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await fn(host);
        } finally {
            host.close();
        }
    });
}
const xp = host => host.q('party.pc').xp;
function sameOnRebuild(host, why) {
    assert.deepEqual(host.store.problems().map(p => p.why ?? p.message), [], `${why}: no block skipped`);
    const live = json(host.head());
    host.store.rebuild();
    assert.equal(json(host.head()), live, `${why}: rebuilt head equals the live one`);
}
const userAt = (host, text) => host.ctx.chat.findIndex(message => message.is_user && message.mes === text);

test('the grammar line: the kind, the three sizes, the cap, and the world\'s XP word', () => {
    assert.equal(XP_AWARDS_PER_REPLY.big, 1);
    assert.equal(XP_AWARDS_PER_REPLY.minor, 2);
    const plain = xpGrammar(null);
    assert.match(plain, /^\+ xp minor\|major\|milestone — /);
    assert.match(plain, /a story XP award; code sets the amount; at most one major or milestone and two minor a reply/);
    assert.match(xpGrammar({ terms: { xpName: 'Soul Growth' } }), /a story Soul Growth award/);
    assert.doesNotMatch(xpGrammar({ terms: { xpName: 'Soul\nGrowth | x' } }), /\n|\|\s*x/, 'one line, no label bar from a word');
    // The merged module: the line in the static prompt follows the setting, and only the setting.
    const plainModule = createModule({ settings: () => ({}), query: () => [] });
    assert.equal(plainModule.capture.kinds.xp.grammar, plain);
    assert.equal(plainModule.capture.kinds.xp.grammar, plainModule.capture.kinds.xp.grammar, 'the same bytes every time');
    const named = createModule({ settings: () => ({ 'party.xpName': 'Soul Growth' }), query: () => [] });
    assert.match(named.capture.kinds.xp.grammar, /a story Soul Growth award/);
});

test('RPG Battle alone: + xp minor gives v1\'s share of the next level, code\'s number; the story\'s number is not used', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(81, async host => {
        await host.send('Cellar.', host.reply('They find the hidden cellar.', ['+ xp minor — found the cellar']));
        assert.equal(xp(host), award('minor'), 'a tenth of the next level');
        const receipt = host.sdk.receipts().map(entry => entry.receipt).filter(r => r.type === 'capture.xp' || r.data?.kind === 'minor').at(-1);
        assert.ok(receipt, 'a receipt for the award');
        assert.match(receipt.summary, /found the cellar: Ren XP \+\d+/);
        await host.send('Gold.', host.reply('A chest.', ['+ xp major | reason: the chest | amount: 5000']));
        assert.equal(xp(host), award('minor') + award('major'), 'the written 5000 is never the amount');
        const static1 = host.statics().at(-1);
        assert.match(static1, /\+ xp minor\|major\|milestone — /, 'the line is in the static prompt');
        await host.send('More.', host.reply('On.', []));
        assert.equal(host.statics().at(-1), static1, 'byte-identical reply to reply');
        sameOnRebuild(host, 'awards');
    });
});

test('the cap per reply: one major or milestone and two minor; the rest are refused, not paid', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(82, async host => {
        await host.send('Deeds.', host.reply('A great day.', [
            '+ xp minor — a', '+ xp minor — b', '+ xp minor — c', '+ xp major — d', '+ xp milestone — e',
        ]));
        const level = host.q('party.pc').level;
        assert.equal(level, 1, 'not enough for a level here');
        assert.equal(xp(host), 2 * award('minor') + award('major'), 'two minor and the first big one');
        const kept = host.ctx.chat.at(-1).extra.storySuite.receipts.filter(r => r.data?.kind).map(r => r.data.kind);
        assert.deepEqual(kept, ['minor', 'minor', 'major'], 'three awards kept on the reply; the third minor and the milestone were refused');
        // The next reply has its own room.
        await host.send('Again.', host.reply('Another day.', ['+ xp minor — f']));
        assert.equal(xp(host), 3 * award('minor') + award('major'));
        sameOnRebuild(host, 'caps');
    });
});

test('level-ups follow as for any XP; a fight that has the party refuses a story award', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(83, async host => {
        for (let n = 0; n < 3; n += 1) await host.send(`Win ${n}.`, host.reply('A goal reached.', [`+ xp milestone — goal ${n}`]));
        const ren = host.q('party.pc');
        assert.ok(ren.level >= 2, `three milestones bring a level (level ${ren.level}, ${ren.xp} XP)`);
        assert.ok(ren.points > 0 || ren.level === 1, 'the level brought points to spend');
        await host.send('Wolves.', host.reply('Wolves.', ['! encounter 1 Wolf — on the road | tier: trivial']));
        assert.equal((await host.cmd('combat.start', { offer: host.q('combat.offers')[0].id })).ok, true);
        const before = host.q('party.pc').xp;
        await host.send('Hit.', host.reply('Ren swings.', ['+ xp major — a brave blow']));
        assert.equal(host.q('party.pc').xp, before, 'no story XP in the middle of a fight');
        sameOnRebuild(host, 'level-ups');
    });
});

test('swipes and middle deletes: an award goes with its reply; rebuild equals live', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(84, async host => {
        await host.send('A.', host.reply('A find.', ['+ xp minor — a find']));
        await host.send('B.', host.reply('The caravan is saved.', ['+ xp major — the caravan']));
        await host.swipe(host.reply('The caravan is lost.', []));
        assert.equal(xp(host), award('minor'), 'the swiped-away award is gone');
        await host.swipe(host.reply('The caravan is saved after all.', ['+ xp major — the caravan', '+ xp milestone — and the road']));
        assert.equal(xp(host), award('minor') + award('major'), 'the new swipe has its own room: one big award');
        await host.send('C.', host.reply('Another find.', ['+ xp minor — another find']));
        const at = userAt(host, 'A.');
        await host.st.deleteMessage(at + 1);
        await host.st.deleteMessage(at);
        sameOnRebuild(host, 'after the delete');
        const ren = host.q('party.pc');
        assert.ok(ren.xp >= 0 && ren.level >= 1);
        assert.equal(ren.xp, award('major') + award('minor'), 'the deleted reply\'s award is taken back; the others stay');
    }, { modules: [CLOCK] });
});

test('with Story Director\'s clock too: awards and time recovery side by side', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(85, async host => {
        await host.send('Start.', host.reply('Morning.', ['~ time 600']));
        await host.send('Deed.', host.reply('They help the miller, all afternoon.', ['! time +4h', '+ xp minor — helped the miller']));
        await host.send('Next.', host.reply('Evening.', []));
        assert.equal(xp(host), award('minor'));
        sameOnRebuild(host, 'with the clock');
    }, { modules: [CLOCK] });
});
