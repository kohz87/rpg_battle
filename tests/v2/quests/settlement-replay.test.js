// Replay exercises persisted blocks on the real host and reopens the chat after every change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { questHost, offer, herb, template } from './helpers/host.js';

const templates = [template({ objectives: [{ id: 'ob_00000001', kind: 'collect', def: herb.id, count: 2, consume: false }] })];

async function reload(h) {
    const st = { chat: structuredClone(h.ctx.chat), extensionSettings: structuredClone(h.ctx.extensionSettings) };
    h.close();
    return questHost({ st, templates });
}
function totals(h, id, paid) {
    assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, paid ? 30 : 0);
    assert.equal(h.sdk.query('party.pc').xp, paid ? 25 : 0);
    assert.equal(h.sdk.query('director.thread', { id })?.rpg?.state, paid ? 'done' : 'active');
    assert.equal(!!h.head().meta.claims[`rb:ep_00000000:quest:${id}:1:settled`], paid);
    assert.equal(h.sdk.query('chronicle.questLog', { id }).filter(row => row.text === 'Mill job: done.').length, paid ? 1 : 0);
}
async function paidChat() {
    let h = await questHost({ templates });
    const thread = await offer(h);
    assert.equal((await h.sdk.command('quest.take', { id: thread.id })).ok, true);
    await h.send('Gather herbs.', 'We found the herbs.');
    assert.equal(h.bus.command('inventory.grant', { def: herb, qty: 2, owner: 'party' }, { cause: 'system' }).ok, true);
    const material = h.ctx.chat.length - 1;
    await h.swipe('We found no herbs.');
    await h.st.swipeTo(material, 0);
    await h.send('Return to the miller.', 'The miller checks the herbs.');
    const settlement = h.ctx.chat.length - 1;
    const result = await h.sdk.command('quest.finish', { id: thread.id });
    assert.equal(result.ok, true, result.message);
    h = await reload(h);
    totals(h, thread.id, true);
    return { h, id: thread.id, material, settlement };
}

test('swipe removes the complete settlement and restores it once, with reload after each', async t => {
    let { h, id, material } = await paidChat();
    t.after(() => h.close());
    await h.st.swipeTo(material, 1);
    h = await reload(h);
    totals(h, id, false);
    await h.st.swipeTo(material, 0);
    h = await reload(h);
    totals(h, id, true);
    assert.equal((await h.sdk.command('quest.finish', { id })).code, 'CLAIMED');
    h = await reload(h);
    totals(h, id, true);
});

test('delete of an earlier material carrier retracts wallet, XP, closure, journal and claims on reload', async t => {
    let { h, id, material } = await paidChat();
    t.after(() => h.close());
    await h.st.deleteMessage(material);
    h = await reload(h);
    totals(h, id, false);
});

test('Re-read keeps one payment, then removing acceptance proof retracts it, with reload after each', async t => {
    let { h, id, settlement } = await paidChat();
    t.after(() => h.close());
    assert.equal((await h.turn.reread(settlement)).ok, true);
    h = await reload(h);
    totals(h, id, true);
    const takeCarrier = h.ctx.chat.findIndex(message => message.extra?.storySuite?.spans?.some(s => s.guard?.predicate?.kind === 'quest.take'));
    await h.st.deleteMessage(takeCarrier);
    h = await reload(h);
    assert.equal(h.sdk.query('inventory.wallet').coin ?? 0, 0);
    assert.equal(h.sdk.query('party.pc').xp, 0);
    assert.equal(h.sdk.query('story.evidence').some(p => p.payload.thread === id), false);
    assert.equal(!!h.head().meta.claims[`rb:ep_00000000:quest:${id}:1:settled`], false);
});
