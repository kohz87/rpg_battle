// The uses an Auto fight records are credited at the next reply boundary of the story, whether or not that reply wrote any change line, and the credits are the same
// after a rebuild, a reload and a delete of a later reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { bluewatch, ok } from '../quests/helpers/bluewatch.js';

async function autoFight(h, text = 'Rats.') {
    await h.say(text, ['! encounter 3 Cellar Rat Swarm | tier: weak']);
    ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
    for (let n = 0; n < 80 && h.q('combat.session')?.status === 'active'; n += 1) {
        const session = h.q('combat.session');
        ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: session.id, board: session.board }));
    }
    ok(await h.sdk.command('combat.end', { session: h.q('combat.session').id }));
}
const progress = h => h.head().domains.progress;
const credited = h => Object.keys(progress(h).credits).length;
const waiting = h => Object.keys(progress(h).attempts).length - credited(h);
const uses = h => h.q('rules.party').active[0].skills.map(skill => skill.uses);

for (const [name, reply] of [['a quiet reply (no change line)', null], ['a reply that writes a change line', ['~ place Bluewatch Village | kind: settlement']]]) {
    test(`an Auto fight, then ${name}: every use is credited, and a rebuild and a reload give the same`, async t => {
        await seeded(9501, async () => {
            const h = await bluewatch(t);
            await autoFight(h);
            const recorded = Object.keys(progress(h).attempts).length;
            assert.ok(recorded >= 3, 'the fight recorded its uses');
            await h.say('The cellar is quiet.', reply ?? []);
            assert.equal(waiting(h), 0, `waiting ${waiting(h)} of ${recorded}`);
            assert.ok(uses(h).every(count => count >= 1), JSON.stringify(uses(h)));
            const live = JSON.stringify(h.head());
            const seen = uses(h);
            h.store.rebuild();
            assert.equal(JSON.stringify(h.head()), live, 'rebuild equals live');
            assert.deepEqual(uses(h), seen);
            await h.st.loadChat(JSON.parse(JSON.stringify(h.ctx.chat)));
            assert.equal(JSON.stringify(h.head()), live, 'reload equals live');
            assert.deepEqual(h.store.problems(), []);
        });
    });
}

// ---- the day a use was earned on ---------------------------------------------------------------------------------------------

const DAY = 1440;
const dayOf = minute => Math.floor(minute / DAY);
async function toTenToMidnight(h) {
    const now = h.q('director.time').minutes;
    const left = DAY - (now % DAY) - 10;
    await h.say('Dusk.', [`! time +${left}m`]);
    assert.equal(h.q('director.time').minutes % DAY, DAY - 10);
}
async function playToEnd(h, text = 'Rats.') {
    await h.say(text, ['! encounter 3 Cellar Rat Swarm | tier: weak']);
    ok(await h.sdk.command('combat.start', { offer: h.q('combat.offers').at(-1).id }));
    for (let n = 0; n < 80 && h.q('combat.session')?.status === 'active'; n += 1) {
        const session = h.q('combat.session');
        ok(await h.sdk.command('combat.act', { action: { type: 'auto' }, session: session.id, board: session.board }));
    }
    assert.equal(h.q('combat.session').status, 'won');
}
const creditDays = h => [...new Set(Object.values(progress(h).credits).map(credit => credit.day))];

test('a fight the combat cue ends in the next reply counts toward the day it was fought, not the day that reply moved the clock to', async t => {
    await seeded(9502, async () => {
        const h = await bluewatch(t);
        await toTenToMidnight(h);
        const day = dayOf(h.q('director.time').minutes);
        await playToEnd(h);
        // Not ended by the reader: the next reply's cue ends it, and that reply moves the clock past midnight.
        await h.say('Past midnight.', ['! time +30m', '~ place Bluewatch Village | kind: settlement']);
        assert.equal(dayOf(h.q('director.time').minutes), day + 1);
        assert.equal(waiting(h), 0);
        assert.ok(credited(h) >= 3);
        assert.deepEqual(creditDays(h), [day]);
        const live = JSON.stringify(h.head());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.head()), live, 'rebuild equals live');
    });
});

test('the daily caps of the day it was fought: uses of a fight the cue ended after midnight do not fill the new day\'s caps', async t => {
    await seeded(9503, async () => {
        const h = await bluewatch(t);
        await toTenToMidnight(h);
        const day = dayOf(h.q('director.time').minutes);
        await playToEnd(h);
        await h.say('Past midnight.', ['! time +30m', '~ place Bluewatch Village | kind: settlement']);
        const earned = id => Object.values(progress(h).credits).filter(credit => credit.day === id && credit.award > 0).length;
        assert.ok(earned(day) >= 3);
        assert.equal(earned(day + 1), 0, 'nothing of the fight counts on the new day');
        // The new day's own fight is not held back by it.
        await playToEnd(h, 'Rats again.');
        ok(await h.sdk.command('combat.end', { session: h.q('combat.session').id }));
        await h.say('Quiet.', ['~ place Bluewatch Village | kind: settlement']);
        assert.ok(earned(day + 1) >= 3);
    });
});
