// The `! lethal` and `! intervention` change lines (the death part's capture kinds), played as a reply carries them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { world, ok, ref } from './helpers.js';
import { seeded } from '../integration/helpers/host.js';
import { resolveBatch } from '../../../src/v2/fight/batch.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';

const lines = (text, ...changes) => `${text}\n\n<Changes>\n${changes.join('\n')}\n</Changes>`;

test('! lethal: a line with code-validated evidence records the event and the same reply resolves it; bad lines record nothing', async t => seeded(72, async () => {
    const w = await world(t);
    await w.say(lines('Dusk.', '~ time 15840'));
    const evidence = w.proof('story', { actor: w.friend, cause: 'narrative', lethal: true });
    const grammar = w.host.registry.module('rpg-battle').capture.kinds.lethal.grammar;
    assert.match(grammar, /^! lethal <actor ID> \| cause: narrative\|execution \| evidence:/);
    const before = structuredClone(w.slice('death'));
    // No proof, a made-up proof, an unknown actor, a cause that is not one: each is a Problem and writes nothing.
    await w.say(lines('Bad lines.', `! lethal ${w.friend} | cause: narrative | evidence: `, `! lethal ${w.friend} | cause: narrative | evidence: pf_zzzzzzzz`,
        `! lethal ac_zzzzzzzz | cause: narrative | evidence: ${evidence}`, `! lethal ${w.friend} | cause: sorcery | evidence: ${evidence}`));
    assert.deepEqual(w.slice('death'), before, 'a refused line is not a death');
    await w.say(lines('The blow.', `! lethal ${w.friend} | cause: narrative | evidence: ${evidence}`));
    const [batch] = Object.values(w.slice('death').batches);
    assert.equal(batch.events.length, 1);
    assert.equal(batch.status, 'complete', 'the afterCapture step resolved it');
    const bytes = resolveBatch({ id: batch.result.id, state: w.head() }).bytes;
    assert.equal(bytes.events[0].actor, w.friend);
    assert.notEqual(bytes.events[0].check, null, 'a narrative event rolls the original die');
    assert.notEqual(lifeOf(w.q('party.actor', { id: w.friend })), 'alive');
}));

test('! intervention: a paid rescue line recorded before the step makes the event an injury without a die', async t => seeded(72, async () => {
    const w = await world(t);
    await w.say(lines('Dusk.', '~ time 15840'));
    const event = w.lethal(w.friend);
    assert.equal(w.slice('death').batches[event.batch].status, 'pending');
    const grammar = w.host.registry.module('rpg-battle').capture.kinds.intervention.grammar;
    assert.match(grammar, /^! intervention <event ID> \| evidence: <ID>$/);
    ok(w.command('skill.use', { actor: w.pc, skill: ref('s00'), form: ref('s00-base') }));
    const paid = w.q('story.evidence').find(p => p.kind === 'use').id;
    const rescue = w.proof('rescue', { event: event.event, batch: event.batch, actor: w.friend, rescuer: w.pc, skill: ref('s00'), form: ref('s00-base'), effect: 1, payment: paid }, [paid]);
    const mp = w.q('party.actor', { id: w.pc }).mp.cur;
    // A line for an event that is not there, or with evidence that is not its rescue, writes nothing.
    const before = structuredClone(w.slice('death'));
    await w.say(lines('Wrong.', `! intervention de_zzzzzzzz | evidence: ${rescue}`, `! intervention ${event.event} | evidence: ${paid}`));
    assert.deepEqual(w.slice('death'), before);
    assert.equal(w.q('party.actor', { id: w.friend }).conditions.length, 0);
    await w.say(lines('The rescue.', `! intervention ${event.event} | evidence: ${rescue}`));
    const [batch] = Object.values(w.slice('death').batches);
    assert.equal(batch.status, 'complete', 'the step after the reply resolved it');
    const bytes = resolveBatch({ id: batch.result.id, state: w.head() }).bytes;
    assert.equal(bytes.events[0].check, null, 'a rescued event rolls no die');
    assert.equal(bytes.events[0].outcome, 'gravely-injured');
    assert.equal(lifeOf(w.q('party.actor', { id: w.friend })), 'gravely-injured');
    assert.equal(w.q('party.actor', { id: w.pc }).mp.cur, mp, 'the intervention line pays nothing more: the skill was paid when it was used');
}));
