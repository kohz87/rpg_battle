// Seeded fuzz of a quest's objective evidence on the real host: the offer, the acceptance, the line that meets the objective, the turn-in and
// middle deletes and Re-reads of any reply. After every step a rebuild of the chat must give the live state (replay == live) and the invariants of
// B3 must hold: every evidence row stands on a surviving RPG Battle proof bound to its thread, instance and objective, holds its claim, and a
// paid quest holds exactly one settlement and one payout. QA_FUZZ_SEED runs one seed, QA_FUZZ_STEPS sets the length.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realQuestHost, questPin, skip } from './helpers/real-host.js';

const SEEDS = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)] : [1, 2, 3, 4];
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 14;
const story = [{ id: 'ob_00000001', kind: 'story', text: 'Greet the miller' }, { id: 'ob_00000002', kind: 'story', text: 'Weigh the grain' }];

function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const snapshot = h => JSON.stringify({ wallet: h.sdk.query('inventory.wallet').coin ?? 0, xp: h.sdk.query('party.pc').xp,
    threads: h.sdk.query('director.threads', {}).map(t => [t.id, t.status, t.rpg]), claims: Object.keys(h.head().meta.claims).sort(),
    proofs: h.sdk.query('story.evidence', {}).map(p => [p.id, p.payloadHash]) });

function invariants(h, when) {
    for (const thread of h.sdk.query('director.threads', {})) {
        const quest = thread.rpg;
        if (!quest) continue;
        for (const [key, row] of Object.entries(quest.evidence)) {
            const proof = h.sdk.query('story.evidence', { ids: [row.proof] }).find(p => p.id === row.proof);
            assert.ok(proof, `${when}: evidence ${key} has no surviving proof`);
            assert.equal(proof.owner, 'rpg-battle', when);
            assert.deepEqual([proof.payload.thread, proof.payload.instance, proof.payload.objective], [thread.id, quest.instance, row.objective], `${when}: the proof is bound to its objective`);
            assert.ok(h.head().meta.claims[`rb:ep_00000000:objective:proof:${row.proof}`], `${when}: the evidence holds its proof claim`);
        }
        const settled = h.head().meta.claims[`rb:ep_00000000:quest:${thread.id}:${quest.instance}:settled`] === true;
        assert.equal(settled, quest.settlement !== null, `${when}: the settlement and its claim go together`);
        if (quest.settlement?.outcome === 'done') {
            assert.equal(h.sdk.query('inventory.wallet').coin, 30, `${when}: paid once`);
            assert.ok(story.every(o => Object.values(quest.evidence).some(row => row.objective === o.id)), `${when}: paid only with every objective met`);
        }
    }
}

for (const seed of SEEDS) test(`objective evidence fuzz, seed ${seed}: replay equals live and every row keeps its proof`, { skip }, async t => {
    const r = prng(seed);
    const pick = list => list[Math.floor(r() * list.length)];
    const h = await realQuestHost(t, { given: questPin({ objectives: story }) });
    const log = [];
    for (let step = 0; step < STEPS; step += 1) {
        const thread = h.sdk.query('director.thread', { key: 'Mill job' });
        const count = h.ctx.chat.length;
        const op = pick(['offer', 'take', 'met', 'met', 'undo', 'invalid', 'coin', 'finish', 'reply', 'continue', 'swipe', 'delete', 'reload', 'reread']);
        log.push(op);
        if (op === 'offer' && !thread) await h.send('Work?', '<Changes>\n+ quest Mill job\n</Changes>');
        else if (op === 'take' && thread?.rpg?.state === 'offered') await h.sdk.command('quest.take', { id: thread.id });
        else if (op === 'met') await h.send('I do the work.', `<Changes>\n~ quest Mill job | met: yes${r() < 0.5 ? ` | objective: ${pick(story).id}` : ''}\n</Changes>`);
        else if (op === 'undo') await h.send('That work is undone.', `<Changes>\n~ quest Mill job | met: no | objective: ${pick(story).id}\n</Changes>`);
        else if (op === 'invalid') await h.send('Unclear.', '<Changes>\n~ quest Mill job | met: maybe\n</Changes>');
        else if (op === 'coin' && thread?.rpg?.state === 'active') await h.send('Reward.', '<Changes>\n+ coin 30\n- quest Mill job — done\n</Changes>');
        else if (op === 'continue' && thread?.rpg?.settlement?.source.sid === h.ctx.chat.at(-1)?.extra?.storySuite?.source?.logical) await h.cont('<Changes>\n+ coin 30\n</Changes>');
        else if (op === 'swipe' && count > 3 && !h.ctx.chat.at(-1)?.is_user) await h.swipe('The work is still ahead.');
        else if (op === 'reload') await h.st.loadChat(structuredClone(h.ctx.chat));
        else if (op === 'finish' && thread?.rpg?.state === 'active') await h.sdk.command('quest.finish', { id: thread.id });
        else if (op === 'reply') await h.send('Go on.', 'The day passes.');
        else if (op === 'delete' && count > 4) await h.st.deleteMessage(2 + Math.floor(r() * (count - 2)));
        else if (op === 'reread' && count > 3) { const at = 1 + Math.floor(r() * (count - 1)); if (!h.ctx.chat[at]?.is_user) await h.turn.reread(at); }
        const live = snapshot(h);
        h.store.rebuild();
        assert.equal(snapshot(h), live, `seed ${seed}, step ${step} (${log.join(' ')}): replay differs from live`);
        invariants(h, `seed ${seed}, step ${step} (${log.join(' ')})`);
    }
});
