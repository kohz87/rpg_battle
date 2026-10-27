// The written type picks among templates of one kind and rank (GENERATIVE_OFFERS_SPEC §4.6, "Decisions": `offerType`). Pure, on pins derived from
// Bluewatch 1.6.0 with a hunt template and a cull template side by side; a pin without `offerType` is read as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOffer } from '../../../src/v2/quests/offer-match.js';
import { derivedPin, env, lineOf, PIN } from './helpers/offer-env.js';
import { seeded } from '../integration/helpers/host.js';
import { PACK, bluewatch } from './helpers/bluewatch.js';
import { offersOf } from '../../../src/v2/rules/offers.js';

const P = 'pack.ersveil-bluewatch';
const offer = (text, pin, options = {}) => matchOffer(env({ pin, ...options }), lineOf(text));
const slug = result => String(result.settled.template).split('/')[1];

/**
 * Open hunts and a cull at rank F (and E), in the order given: the hunt takes up to 8, the cull up to 3. `typed: false` leaves `offerType` out of all of them.
 * Rank E has a hunt only, to show the fallback to a lower rank honours the preference too.
 */
function pinWith({ order = ['hunt', 'cull'], typed = true, change = () => {} } = {}) {
    return derivedPin(resolved => {
        const quests = resolved.quests;
        const hunt = quests[`${P}/open-hunt-f`];
        Object.assign(hunt.objectives[0], { countMin: 1, countMax: 8, count: 2 });
        const cull = structuredClone(hunt);
        Object.assign(cull, { id: `${P}/open-cull-f`, slug: 'open-cull-f', name: 'Cull (F)' });
        Object.assign(cull.objectives[0], { countMin: 2, countMax: 3, count: 3 });
        if (typed) { hunt.offerType = 'hunt'; cull.offerType = 'cull'; }
        const rest = Object.fromEntries(Object.entries(quests).filter(([id]) => id !== `${P}/open-hunt-f`));
        for (const id of Object.keys(quests)) delete quests[id];
        const mine = { hunt: [`${P}/open-hunt-f`, hunt], cull: [`${P}/open-cull-f`, cull] };
        for (const [id, template] of order.map(name => mine[name])) quests[id] = template;
        Object.assign(quests, rest);
        change(resolved);
    });
}

const HUNT = '+ quest Rats | type: hunt | goal: Kill 40 rats in the cellar';
const CULL = '+ quest Rats | type: cull | goal: Kill 40 rats in the cellar';
const UNTYPED = '+ quest Rats | goal: Kill 40 rats in the cellar';

for (const order of [['hunt', 'cull'], ['cull', 'hunt']]) {
    test(`type: cull binds the cull template and its bounds; hunt and an untyped kill line bind the hunt template (pack order ${order.join(', ')})`, () => {
        const pin = pinWith({ order });
        const cull = offer(CULL, pin);
        assert.deepEqual([slug(cull), cull.settled.count, cull.band], ['open-cull-f', 3, 'moderate']);
        for (const text of [HUNT, UNTYPED]) {
            const result = offer(text, pin);
            assert.deepEqual([slug(result), result.settled.count], ['open-hunt-f', 8], text);
        }
        // The words of the line choose the type as they do everywhere: "exterminate" is a cull verb, "slay" a hunt verb.
        assert.equal(slug(offer('+ quest Rats | goal: Exterminate the rats in the cellar', pin)), 'open-cull-f');
        assert.equal(slug(offer('+ quest Rats | goal: Slay the rats in the cellar', pin)), 'open-hunt-f');
    });
}

test('without offerType the first template of the kind and rank wins whatever the type: a pack is read as it was', () => {
    const pin = pinWith({ typed: false });
    for (const text of [HUNT, CULL, UNTYPED]) assert.equal(slug(offer(text, pin)), 'open-hunt-f', text);
    const reversed = pinWith({ typed: false, order: ['cull', 'hunt'] });
    for (const text of [HUNT, CULL, UNTYPED]) assert.equal(slug(offer(text, reversed)), 'open-cull-f', text);
    // Bluewatch 1.6.0 has no offerType at all.
    assert.equal(slug(offer(CULL, PIN)), 'open-hunt-f');
});

test('a type word that names no type leaves the goal\'s own verb to decide; a type no template names keeps the first template of the kind', () => {
    const pin = pinWith({ order: ['cull', 'hunt'] });
    // "side" names no type, so the verb does: "kill" is a hunt verb, "exterminate" a cull verb.
    assert.equal(slug(offer('+ quest Rats | type: side | goal: Kill 40 rats in the cellar', pin)), 'open-hunt-f');
    assert.equal(slug(offer('+ quest Rats | type: side | goal: Exterminate the rats in the cellar', pin)), 'open-cull-f');
    // Only the hunt is typed: a cull line has no typed template and binds the first of the kind, as before.
    const lone = pinWith({ order: ['cull', 'hunt'], change: resolved => { delete resolved.quests[`${P}/open-cull-f`].offerType; } });
    assert.equal(slug(offer(CULL, lone)), 'open-cull-f');
    assert.equal(slug(offer(HUNT, lone)), 'open-hunt-f');
});

test('like: still fixes the template, whatever the type says', () => {
    const pin = pinWith();
    const result = offer('+ quest Rats | type: hunt | like: open-cull-f | goal: Kill 40 rats in the cellar', pin);
    assert.deepEqual([slug(result), result.settled.count], ['open-cull-f', 3]);
    const other = offer('+ quest Rats | type: cull | like: open-hunt-f | goal: Kill 40 rats in the cellar', pin);
    assert.equal(slug(other), 'open-hunt-f');
});

test('the lower ranks and the story fallback follow the same preference', () => {
    // Rank E has a hunt template only (the reef shark is a rank E foe); the cull is at F. Within a rank the preference decides, so this cull line takes E's hunt (the only one there).
    const pin = pinWith();
    const hard = '+ quest Sharks | type: cull | goal: Kill 2 reef sharks in the bay';
    assert.equal(slug(offer(hard, pin, { level: 12 })), 'open-hunt-e');
    // When the party cannot meet E's template the line comes down a rank, and there the cull is preferred.
    const gated = pinWith({ change: resolved => { resolved.quests[`${P}/open-hunt-e`].requirements = [{ kind: 'level', min: 50 }]; } });
    assert.equal(slug(offer(hard, gated, { level: 12 })), 'open-cull-f');
    assert.equal(slug(offer(hard.replace('cull', 'hunt'), gated, { level: 12 })), 'open-hunt-f');
    // A template the party cannot meet is skipped for the next candidate, typed or not.
    const locked = pinWith({ change: resolved => { resolved.quests[`${P}/open-cull-f`].requirements = [{ kind: 'level', min: 50 }]; } });
    assert.equal(slug(offer(CULL, locked)), 'open-hunt-f');

    // Story templates: an escort-typed and a task-typed one at F; the written type picks between them, an untyped line takes the first.
    const stories = pinWith({ change: resolved => {
        const task = resolved.quests[`${P}/open-story-task-f`];
        task.offerType = 'task';
        const escort = structuredClone(task);
        Object.assign(escort, { id: `${P}/open-escort-f`, slug: 'open-escort-f', name: 'Escort (F)', offerType: 'escort' });
        const rest = Object.fromEntries(Object.entries(resolved.quests).filter(([id]) => id !== `${P}/open-story-task-f`));
        for (const id of Object.keys(resolved.quests)) delete resolved.quests[id];
        Object.assign(resolved.quests, { [`${P}/open-escort-f`]: escort, [`${P}/open-story-task-f`]: task }, rest);
    } });
    assert.equal(slug(offer('+ quest Walk | type: task | goal: Settle the matter with the river guild', stories)), 'open-story-task-f');
    assert.equal(slug(offer('+ quest Walk | type: escort | goal: Escort the ferryman to the quay', stories)), 'open-escort-f');
    assert.equal(slug(offer('+ quest Walk | goal: The matter of the river guild', stories)), 'open-escort-f', 'no type and no verb: the first in pack order, as before');
});

test('the settled binding records the template id as before, so a replay never asks the type again', () => {
    const pin = pinWith();
    const result = offer(CULL, pin);
    assert.equal(result.settled.template, `${P}/open-cull-f`);
    assert.ok(!JSON.stringify(result.settled).includes('offerType'));
});

test('on the real host, with a pack whose open templates name their type (Story Block\'s offerType): the pin carries it and a cull line binds the cull template', async t => {
    await seeded(6201, async () => {
        const pack = structuredClone(PACK);
        const quests = pack.content.quests;
        const hunt = quests.find(quest => quest.slug === 'open-hunt-f');
        Object.assign(hunt, { offerType: 'hunt' });
        Object.assign(hunt.objectives[0], { countMin: 1, countMax: 8 });
        const cull = structuredClone(hunt);
        Object.assign(cull, { slug: 'open-cull-f', name: 'Cull (F)', offerType: 'cull' });
        Object.assign(cull.objectives[0], { countMin: 1, countMax: 3 });
        quests.splice(quests.indexOf(hunt) + 1, 0, cull);
        const h = await bluewatch(t, { pack: JSON.stringify(pack) });
        const pinned = h.head().domains.rules.pin.resolved.quests;
        assert.equal(pinned[`${P}/open-cull-f`].offerType, 'cull');
        assert.equal(pinned[`${P}/open-hunt-f`].offerType, 'hunt');
        await h.say('Hollis speaks.', ['+ quest Rats A | type: cull | goal: kill 6 culvert rats | reward: 60 copper | due: in 2 days', '+ quest Rats B | type: hunt | goal: kill 6 culvert rats | reward: 60 copper | due: in 2 days', '+ quest Rats C | goal: kill 6 culvert rats | reward: 60 copper | due: in 2 days']);
        assert.deepEqual(h.turn.problems(), []);
        const by = Object.fromEntries(Object.values(offersOf(h.head().domains.rules)).map(offer => [offer.name, [offer.settled.template.split('/')[1], offer.settled.count]]));
        assert.deepEqual(by, { 'Rats A': ['open-cull-f', 3], 'Rats B': ['open-hunt-f', 6], 'Rats C': ['open-hunt-f', 6] });
        // The decision is kept: a rebuild gives the same head.
        const live = JSON.stringify(h.head());
        h.store.rebuild();
        assert.equal(JSON.stringify(h.head()), live);
    });
});
