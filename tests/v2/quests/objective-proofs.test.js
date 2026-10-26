// B3 on the real host: a quest objective becomes one RPG Battle proof bound to thread, instance, objective and the exact validated
// action; the quest is paid from it, and taking back any parent takes the credit, the evidence and their claims back with it.
// Every guard here runs under the host's replay rule (a guard that asks a query the module does not declare throws and turns the block
// off with a Problem), so "no Problems after a reload and a rebuild" is also the proof that the guards obey it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realQuestHost, questPin, killPin, skip } from './helpers/real-host.js';
import { seeded } from '../integration/helpers/host.js';

const story = [{ id: 'ob_00000001', kind: 'story', text: 'Greet the miller' }];
const two = [{ id: 'ob_00000001', kind: 'story', text: 'Greet the miller' }, { id: 'ob_00000002', kind: 'story', text: 'Weigh the grain' }];
const ok = out => assert.equal(out.ok, true, JSON.stringify(out));
const system = (h, type, payload) => h.bus.command(type, payload, { cause: 'system' });
const reload = async (t, host, given) => realQuestHost(t, { given, st: {
    chat: structuredClone(host.ctx.chat), extensionSettings: structuredClone(host.ctx.extensionSettings),
} });
const offer = async (h, name = 'Mill job') => {
    await h.send('What work is offered?', `<Changes>\n+ quest ${name}\n</Changes>`);
    return h.sdk.query('director.thread', { key: name });
};
const take = async (h, thread) => ok(await h.sdk.command('quest.take', { id: thread.id }));
const rows = (h, id) => Object.values(h.sdk.query('director.thread', { id }).rpg.evidence);
const proofs = h => h.sdk.query('story.evidence', {}).filter(proof => proof.owner === 'rpg-battle');
const snap = h => JSON.stringify({ wallet: h.sdk.query('inventory.wallet').coin ?? 0, xp: h.sdk.query('party.pc').xp,
    threads: h.sdk.query('director.threads', {}).map(t => t.rpg), claims: Object.keys(h.head().meta.claims).sort(), proofs: proofs(h).map(p => [p.id, p.payloadHash]) });

async function fight(h, line = '! encounter 2 Wolf — hungry | tier: weak') {
    await h.send('The wolves come.', `<Changes>\n${line}\n</Changes>`);
    ok(await h.sdk.command('combat.start', { offer: h.sdk.query('combat.offers', {}).at(-1).id }));
    for (let n = 0; n < 80; n += 1) {
        const v = h.sdk.query('combat.session', {});
        if (v.status !== 'active') break;
        ok(await h.sdk.command('combat.act', { action: { type: 'attack', target: v.actions.targets.enemies[0] }, session: v.id, board: v.board }));
    }
    const v = h.sdk.query('combat.session', {});
    assert.notEqual(v.status, 'active');
    ok(await h.sdk.command('combat.end', { session: v.id }));
    return Object.keys(h.head().domains.combat.beaten).at(-1);
}

test('a kill objective: a sealed victory after the acceptance becomes the proof and pays once', { skip }, async t => {
    await seeded(1, async () => {
        const given = killPin();
        const h = await realQuestHost(t, { given });
        const thread = await offer(h);
        await take(h, thread);
        const id = await fight(h);
        await h.send('The miller waits.', 'The miller waits.');
        const [proof] = proofs(h);
        assert.equal(proof.kind, 'kill');
        const batch = h.head().domains.progress.batches[proof.payload.batch.id];
        assert.equal(proof.payload.batch.hash, batch.hash, 'the proof names the sealed result by id and hash');
        assert.deepEqual({ ...proof.payload, acceptance: undefined, batch: undefined }, { thread: thread.id, instance: 1, objective: 'ob_00000001', objectiveKind: 'kill',
            acceptance: undefined, foe: 'pack.fixture/wolf', fight: id, batch: undefined, count: 2 });
        assert.equal(rows(h, thread.id)[0].amount, 2);
        assert.equal(h.sdk.query('quest.progress', { id: thread.id }).finish.ok, true);
        const coinBefore = h.sdk.query('inventory.wallet').coin ?? 0;
        ok(await h.sdk.command('quest.finish', { id: thread.id }));
        assert.equal(h.sdk.query('inventory.wallet').coin - coinBefore, 30);
        const verify = host => { assert.equal(host.sdk.query('director.thread', { id: thread.id }).rpg.state, 'done'); assert.deepEqual(host.store.problems(), []); };
        verify(h);
        const before = snap(h);
        const loaded = await reload(t, h, given);
        verify(loaded);
        loaded.store.rebuild();
        verify(loaded);
        assert.equal(snap(loaded), before);
    });
});

test('a visit objective stands on the scene it was seen in, and taking back that reply takes the visit back', { skip }, async t => {
    const given = questPin({ objectives: [{ id: 'ob_00000001', kind: 'visit', place: 'pack.fixture/haven' }] });
    const h = await realQuestHost(t, { given });
    ok(await h.packs.packs.install(JSON.stringify({ id: 'fixture', version: '2.0.0', name: 'Places', requires: { storyBlock: '^2' }, content: { places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }] } })));
    await h.send('We walk to Haven.', '<Changes>\n~ place Haven\n</Changes>');
    const placeIndex = h.ctx.chat.length - 1;
    const thread = await offer(h);
    await take(h, thread);
    await h.send('We look around.', 'The party looks around Haven.');
    const [proof] = proofs(h);
    assert.equal(proof.payload.place, 'pack.fixture/haven');
    assert.equal(proof.payload.scene, 'Haven');
    assert.notEqual(proof.source.sid, h.store.sourceAt(placeIndex).logical, 'the visit is a later reply than the move');
    ok(await h.sdk.command('quest.finish', { id: thread.id }));
    assert.equal(h.sdk.query('inventory.wallet').coin, 30);
    const loaded = await reload(t, h, given);
    loaded.store.rebuild();
    assert.deepEqual(loaded.store.problems(), []);
    assert.equal(loaded.sdk.query('inventory.wallet').coin, 30);
    // The reply that brought the party to Haven goes: the visit, the payout and the claims go with it.
    await h.st.deleteMessage(placeIndex);
    const gone = await reload(t, h, given);
    gone.store.rebuild();
    assert.equal(gone.sdk.query('inventory.wallet').coin ?? 0, 0);
    assert.equal(gone.sdk.query('party.pc').xp, 0);
    assert.deepEqual(rows(gone, thread.id), []);
    assert.equal(gone.sdk.query('director.thread', { id: thread.id }).rpg.state, 'active');
    assert.equal(Object.keys(gone.head().meta.claims).some(key => key.includes(':objective:')), false);
});

test('taking back the objective reply, or the acceptance it stands on, retracts the credit, the evidence and the claims exactly', { skip }, async t => {
    for (const which of ['objective', 'acceptance']) {
        const given = questPin({ objectives: story });
        const h = await realQuestHost(t, { given });
        const thread = await offer(h);
        await h.send('I take the job.', 'The miller agrees.');
        const acceptIndex = h.ctx.chat.length - 1;
        await take(h, thread);
        await h.send('I greet the miller.', '<Changes>\n~ quest Mill job | met: yes\n</Changes>');
        const lineIndex = h.ctx.chat.length - 1;
        ok(await h.sdk.command('quest.finish', { id: thread.id }));
        assert.equal(h.sdk.query('inventory.wallet').coin, 30);
        // The take above is a click on the offer's own reply; the acceptance proof lives in that reply's block.
        const target = which === 'objective' ? lineIndex : h.ctx.chat.findIndex((m, i) => i >= acceptIndex && m.extra?.storySuite?.spans?.some(span => span.guard?.predicate?.kind === 'quest.take'));
        await h.st.deleteMessage(target);
        const loaded = await reload(t, h, given);
        loaded.store.rebuild();
        assert.equal(loaded.sdk.query('inventory.wallet').coin ?? 0, 0, which);
        assert.equal(loaded.sdk.query('party.pc').xp, 0, which);
        assert.deepEqual(proofs(loaded).filter(p => p.kind === 'story'), [], which);
        const quest = loaded.sdk.query('director.thread', { id: thread.id })?.rpg;
        assert.equal(quest?.state === 'done', false, which);
        if (quest) assert.deepEqual(quest.evidence, {}, which);
        const claims = Object.keys(loaded.head().meta.claims);
        assert.equal(claims.some(key => key.includes(':objective:') || key.includes(':settled')), false, `${which}: ${claims}`);
    }
});

test('refusals are atomic: a reused proof, another thread, another objective, no victory, a button', { skip }, async t => {
    await seeded(11, async () => {
        const more = { slug: 'cellar', name: 'Cellar job', category: 'side', giver: null, turnInPlace: null, requirements: [], objectives: [
            { id: 'ob_00000001', kind: 'story', text: 'Greet the miller' }, { id: 'ob_00000002', kind: 'story', text: 'Weigh the grain' }],
        reward: { coin: 5, xp: 5, items: [] }, durationMinutes: null, repeat: null, chain: null };
        const h = await realQuestHost(t, { given: questPin({ objectives: story }, [more]) });
        const mill = await offer(h);
        const cellar = await offer(h, 'Cellar job');
        await take(h, mill);
        await take(h, cellar);
        await h.send('I greet the miller.', '<Changes>\n~ quest Mill job | met: yes\n</Changes>');
        const [proof] = proofs(h);
        const refused = (payload, code, message) => {
            const before = structuredClone(h.head());
            const out = system(h, 'quest.objective', payload);
            assert.equal(out.code, code, JSON.stringify(out));
            if (message) assert.match(out.message, message);
            assert.deepEqual(h.head(), before, 'nothing changed: no proof, no claim, no evidence');
        };
        refused({ id: mill.id, objective: 'ob_00000001', proof: proof.id }, 'CLAIMED');
        refused({ id: cellar.id, objective: 'ob_00000001', proof: proof.id }, 'REFUSED', /another thread/);
        refused({ id: mill.id, objective: 'ob_00000009', proof: proof.id }, 'NOT_FOUND');
        refused({ id: mill.id, objective: 'ob_00000001', fight: 'fi_00000000' }, 'REFUSED', /story|line/i);
        const before = structuredClone(h.head());
        assert.equal((await h.sdk.command('quest.objective', { id: mill.id, objective: 'ob_00000001', proof: proof.id })).code, 'REFUSED', 'a click proves nothing');
        assert.deepEqual(h.head(), before);
        // Citing the Mill job's proof for the Cellar job's second objective is another thread first, never another objective's credit.
        await h.send('I greet the miller again.', '<Changes>\n~ quest Cellar job | met: yes | objective: ob_00000001\n</Changes>');
        const [, cellarProof] = proofs(h);
        assert.equal(cellarProof.payload.objective, 'ob_00000001');
        refused({ id: cellar.id, objective: 'ob_00000002', proof: cellarProof.id }, 'REFUSED', /another objective/);
        assert.deepEqual(h.store.problems(), []);
    });
});

test('a kill needs a sealed victory over its own foe after the quest was taken on, and a fight pays one quest once', { skip }, async t => {
    await seeded(7, async () => {
        const warlord = { slug: 'hunt', name: 'Warlord hunt', category: 'side', giver: null, turnInPlace: null, requirements: [],
            objectives: [{ id: 'ob_00000001', kind: 'kill', foe: 'warlord', count: 1 }], reward: { coin: 5, xp: 5, items: [] }, durationMinutes: null, repeat: null, chain: null };
        const pack = killPin({}, [warlord]);
        const h = await realQuestHost(t, { given: pack });
        // A fight won before the quest was taken on never counts for it.
        const early = await (async () => { const id = await fight(h); return id; })();
        const mill = await offer(h);
        const hunt = await offer(h, 'Warlord hunt');
        await take(h, mill);
        await take(h, hunt);
        const refused = (payload, code) => {
            const before = structuredClone(h.head());
            const out = system(h, 'quest.objective', payload);
            assert.equal(out.code, code, JSON.stringify(out));
            assert.deepEqual(h.head(), before);
        };
        refused({ id: mill.id, objective: 'ob_00000001', fight: early }, 'REFUSED');
        refused({ id: mill.id, objective: 'ob_00000001', fight: 'fi_00000000' }, 'NOT_FOUND');
        const won = await fight(h);
        refused({ id: hunt.id, objective: 'ob_00000001', fight: won }, 'NOT_FOUND');
        ok(system(h, 'quest.objective', { id: mill.id, objective: 'ob_00000001', fight: won }));
        assert.equal(rows(h, mill.id)[0].amount, 2);
        refused({ id: mill.id, objective: 'ob_00000001', fight: won }, 'CLAIMED');
        assert.deepEqual(h.store.problems(), []);
    });
});
