// Mock-model smoke for jobs from the story (GENERATIVE_OFFERS_SPEC §16): the testkit's fake model writes the replies. The first offers the user's two jobs in
// its <Changes> block; the prompt of the next generation carries both settled-terms lines; the second reply accepts one and the third fights it with the
// encounter line the model reads out of that prompt, so the terms the narrator is given are terms it can use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeModel } from '../../vendor/story-block/testkit/index.js';
import { seeded } from './helpers/host.js';
import { G1, G1_TERMS, G2, bluewatch } from '../quests/helpers/bluewatch.js';

const G2_TERMS = 'Posted job: Scrub Pack (from Hollis): kill 1 Alpha of the Scrub Wolf Pack within 7 days; pays 5 silver and 50 XP, turned in at Bluewatch Village. Fight it as ! encounter Alpha of the Scrub Wolf Pack | like: starved-crag-wolf. These are the terms from now on; nobody in the scene has to restate them.';
const strings = value => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

test('the fake model offers G1 and G2; the next prompt carries both terms; a second reply accepts and a third fights with the terms\' own encounter line', async t => {
    await seeded(4301, async () => {
        const h = await bluewatch(t);
        let seen = '';
        const model = createFakeModel([
            () => `Hollis wipes the counter and lowers his voice.\n\n<Changes>\n${G1}\n${G2}\n</Changes>`,
            call => {
                assert.equal(call.prompt.includes('Posted job'), false, 'the prompt the first reply was written under has no terms yet');
                return 'Hollis grins. "Then the granary is yours."\n\n<Changes>\n+ quest Granary Vermin\n</Changes>';
            },
            call => {
                // The model reads the fight line out of the terms it was given.
                const line = /Fight them as (! encounter [^\n]*? \| like: [a-z-]+)\./.exec(call.prompt)?.[1];
                assert.ok(line, 'the prompt carries an encounter line to copy');
                return `The cellar door bangs open.\n\n<Changes>\n${line} | tier: trivial\n</Changes>`;
            },
        ]);
        const turn = async user => {
            const reply = await model(seen);
            const out = await h.send(user, reply);
            seen = strings(out.request).join('\n');
            return out;
        };
        await turn('What work is there?');
        assert.deepEqual(h.store.problems(), []);
        assert.equal(Object.keys(h.head().domains.rules.offers).length, 2);
        const second = await turn('I\'ll take the Granary Vermin job.');
        const prompt = strings(second.request).join('\n');
        assert.ok(prompt.includes(G1_TERMS), 'the terms of G1 are in the prompt of the next generation');
        assert.ok(prompt.includes(G2_TERMS), 'and those of G2');
        assert.equal(h.q('director.thread', { key: 'Granary Vermin' }).rpg.state, 'active');
        assert.equal(h.q('director.thread', { key: 'Scrub Pack' }).rpg.state, 'offered');
        await turn('We go down.');
        const offer = h.q('combat.offers').at(-1);
        assert.deepEqual(offer.foes.map(foe => [foe.name, foe.count, foe.variant?.base]), [['Culvert Rats', 6, 'pack.ersveil-bluewatch/cellar-rat-swarm']]);
        const third = await turn('And then?');
        assert.equal(strings(third.request).join('\n').includes('Posted job'), false, 'the terms are told once');
        assert.equal(model.calls.length, 4);
        assert.deepEqual(h.store.problems(), []);
    });
});
