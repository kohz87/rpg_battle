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
