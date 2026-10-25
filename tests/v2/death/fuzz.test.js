// A rules-side death/return fuzzer. Native readiness is tested through a synthetic participant. When E6a
// cannot select its native prefix after a history edit, RB must refuse generation (the E6b gap is explicit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { savedWorld, coordinator } from './return-helper.js';
import { nativeFixture } from './native.js';
import { world, ok } from './helpers.js';
import { wipe } from './fight-helper.js';
import { seeded } from '../integration/helpers/host.js';
import { lifeOf } from '../../../src/v2/rules/sheet.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { generationProblem } from '../../../src/v2/death/selection.js';

const seeds = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)] : [33, 91, 217];
const steps = Number(process.env.QA_FUZZ_STEPS) || 60;
for (const seed of seeds) test(`B6 death/wipe/return fuzz ${seed}: rewards, native readiness and replay`, async t => seeded(seed, async () => {
    let w = await savedWorld(t);
    let random = seed >>> 0;
    const next = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
    const trace = [];
    const selected = () => lifeOf(w.q('party.actor', { id: w.pc }));
    const snapshot = () => structuredClone({ domains: w.head().domains, claims: w.head().meta.claims });
    const ready = () => !generationProblem(w.head(), w.host.timeline.host);
    await w.say('<Changes>\n~ time 15840\n</Changes>');
    let deaths = 0, returns = 0, holds = 0;
    for (let i = 0; i < steps; i++) {
        const op = i < 3 ? i : next(10);
        const at = w.host.ctx.chat.findLastIndex(m => !m.is_user);
        trace.push(`${i}:${op}:${selected()}`);
        try {
            if (op === 0 && selected() !== 'dead' && ready()) {
                await w.say(`Deed ${i}.`);
                const before = snapshot();
                const result = w.command('test.reward');
                if (!result.ok) { assert.equal(result.code, 'CLAIMED'); assert.deepEqual(snapshot(), before); }
            } else if (op === 1 && selected() !== 'dead' && ready()) {
                await w.say(`Lethal ${i}.`);
                const target = lifeOf(w.q('party.actor', { id: w.friend })) === 'dead' ? w.pc : w.friend;
                const e = w.lethal(target);
                ok(w.command('death.resolve', { event: e.event }));
                deaths++;
                const ref = w.slice('death').batches[e.batch].result;
                const out = await coordinator(w).deliver(ref);
                if (out.ok && out.return) returns++;
            } else if (op === 2 && selected() !== 'dead' && ready()) {
                const out = await wipe(w);
                deaths++;
                const delivered = await coordinator(w).deliver(out.receipt.data.deathBatch);
                if (delivered.ok && delivered.return) returns++;
            } else if (op === 3) {
                const before = snapshot();
                await w.host.turn.reread(at);
                // A Re-read may retract dependent system blocks; the next full-replay assertion is authoritative.
                void before;
            } else if (op === 4 && at > 3 && at === w.host.ctx.chat.length - 1) {
                await w.host.swipe(`A different turn ${i}.`);
            } else if (op === 5 && at > 3 && w.host.ctx.chat[at].swipes.length > 1) {
                await w.host.st.swipeTo(at, next(w.host.ctx.chat[at].swipes.length));
            } else if (op === 6 && w.host.ctx.chat.length > 9) {
                const choices = w.host.ctx.chat.map((m, index) => !m.is_user && index > 4 ? index : -1).filter(n => n >= 0);
                if (choices.length) await w.host.st.deleteMessage(choices[next(choices.length)]);
            } else if (op === 7) {
                await w.host.store.flush();
                const image = structuredClone({ chat: w.host.ctx.chat, metadata: w.host.ctx.chatMetadata });
                const native = nativeFixture(w.native);
                w.host.close();
                w = { ...await world(t, { native, image }), native: native.native };
            } else if (op === 8 && selected() !== 'dead' && ready()) {
                await w.say(`Save ${i}.`);
                await w.host.sdk.command('savepoint.make', { name: 'A recent point' });
            } else if (op === 9 && selected() !== 'dead' && ready()) {
                await w.host.cont(` More at ${i}.`);
            }
            const batchResults = w.slice('progress').batches;
            for (const entry of Object.values(batchResults)) assert.equal(hashJson(entry.bytes), entry.hash);
            assert.ok((w.q('inventory.wallet', { owner: 'party' }).coin ?? 0) <= 30, 'a retained duplicate coin reward');
            assert.ok(w.q('party.actor', { id: w.pc }).xp <= 25, 'a retained duplicate XP reward');
            const wakes = Object.values(w.slice('death').wakes);
            assert.equal(new Set(wakes.map(r => r.cue)).size, wakes.length);
            const reason = generationProblem(w.head(), w.host.timeline.host);
            if (reason) {
                holds++;
                const blocked = await w.host.st.generate('normal', { reply: 'The story must wait for native recovery.' });
                assert.equal(blocked.aborted, true);
            } else {
                const member = w.q('party.actor', { id: w.friend });
                if (member) assert.equal(w.native.live.dossiers.lyra.alive, lifeOf(member) !== 'dead', 'native companion differs on a ready timeline');
            }
            const before = snapshot();
            w.host.store.rebuild();
            assert.deepEqual(snapshot(), before, 'checkpoint state differs from full replay');
            assert.deepEqual(w.problems().filter(p => !['REPLAY_PREREQUISITE', 'REPLANNED'].includes(p.code)), []);
        } catch (error) { error.message += `\nseed ${seed}; ${trace.slice(-15).join(' ')}`; throw error; }
    }
    assert.ok(deaths > 0);
    assert.ok(returns > 0);
    t.diagnostic(`seed ${seed}: ${steps} steps, ${deaths} lethal/wipe batches, ${returns} returns, ${holds} explicit host-selection holds`);
}));
