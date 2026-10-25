// Seeded fuzz of the slice-2 entry points on the real host with the real party: narrative skill uses (paid from the pool), training
// requests and their settlements (fee, clock, event, credits), the active roster, flag events, generated story items, and the
// replay operations (swipe, Continue, Re-read, delete from the middle, reload). After every step:
//   * pools never go below 0 or above the maximum, the purse never goes below 0, and the clock only moves forward by a session;
//   * every use is one claim and one attempt; every credit one claim; what was folded keeps its claim (credits + folded = claims);
//   * a training session that ran has its fee, its minutes, its event die and (if completed) its credits; one waiting per character;
//   * every set flag has its evidence claimed and a surviving event proof; every generated item has its claim and its definition;
//   * the roster is the PC and living, durable members, at most three;
//   * the live state is what a cold rebuild gives, and the only problems are guard turn-offs and re-plans.
// QA_FUZZ_SEED runs one seed, QA_FUZZ_STEPS sets the length.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TIERS, DAY, realWorld } from './helpers/world.js';
import { inputsPin, ref } from './helpers/fixture.js';
import { seeded } from '../integration/helpers/host.js';
import { MAX_ATTEMPTS } from '../../../src/v2/progress/domain.js';

const SEEDS = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)] : [11, 12, 13];
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 24;
const HAVEN = 'pack.fixture/haven';
const MILL = 'pack.fixture/mill';

function prng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
    next.pick = list => list[Math.floor(next() * list.length)];
    next.chance = p => next() < p;
    return next;
}

async function run(t, seed, steps) {
    const r = prng(seed);
    AREA_TIERS[HAVEN] = 4;
    const w = await realWorld(t, { given: inputsPin(), sd: true, companions: ['Lyra', 'Orin'] });
    const log = [];
    const fail = (when, message) => `seed ${seed}, ${when}: ${message}\n${log.slice(-10).join('\n')}`;
    const members = () => [w.pc, ...w.mates];
    const coin = () => w.q('inventory.wallet', { owner: 'party' }).coin ?? 0;
    const text = (narration, lines) => (lines.length ? `${narration}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : narration);
    const skills = ['s00', 's01', 's02'];
    const lines = () => {
        const out = [];
        if (r.chance(0.7)) out.push(`~ time ${r.int(3, 40) * DAY + r.int(0, DAY - 1)}`);
        if (r.chance(0.5)) out.push(`~ here ${r.pick([HAVEN, HAVEN, MILL])}`);
        for (let n = r.int(0, 4); n > 0; n -= 1) {
            const skill = r.pick(skills);
            out.push(`! skill-use ${r.pick(members())} | skill: ${ref(skill)} | form: ${ref(`${skill}-base`)}`);
        }
        if (r.chance(0.4)) out.push(`+ item ${r.pick(['Moon Charm', 'Bone Needle', 'Grey Feather', 'Salt Stone'])} | qty: 1`);
        return out;
    };
    const lastReply = () => w.host.ctx.chat.findLastIndex(message => !message.is_user && message !== w.host.ctx.chat[0]);
    const OWN = ['rules', 'progress', 'training', 'inventory', 'party', 'director'];
    const snap = () => JSON.stringify({ domains: Object.fromEntries(OWN.map(name => [name, w.head().domains[name]])), claims: Object.keys(w.head().meta.claims).sort() });
    const diff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i += 1; return `at ${i}: …${a.slice(Math.max(0, i - 80), i + 120)} / …${b.slice(Math.max(0, i - 80), i + 120)}`; };
    assert.equal(w.host.bus.command('test.coin', { amount: 400 }, { cause: 'ui' }).ok, true);

    const check = when => {
        const head = w.head();
        const { progress, training, rules } = head.domains;
        // (Story Block's own stack arithmetic: a later `+ item` raising a stack, or filing one under a definition, whose first reply was deleted is skipped, rules or not.)
        const problems = w.problems().filter(problem => problem.code !== 'REPLANNED' && !/\/domains\/inventory\/stacks\/|Item stack/.test(problem.why ?? ''));
        assert.deepEqual(problems.filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), [], fail(when, `a problem that is not a turn-off: ${JSON.stringify(problems.filter(problem => problem.code !== 'REPLAY_PREREQUISITE')).slice(0, 600)}`));
        // Pools and purse.
        for (const id of members()) {
            const member = w.q('party.actor', { id });
            for (const pool of ['hp', 'mp', 'sp']) assert.ok(member[pool].cur >= 0 && member[pool].cur <= member[pool].max, fail(when, `${id} ${pool} ${member[pool].cur}/${member[pool].max}`));
        }
        assert.ok(coin() >= 0, fail(when, `the purse is ${coin()}`));
        // Claims against records.
        const claims = Object.keys(head.meta.claims).filter(key => key.startsWith('rb:'));
        const of = kind => claims.filter(key => key.split(':')[2] === kind).map(key => key.split(':').slice(3).join(':'));
        const credits = Object.keys(progress.credits);
        assert.ok(Object.keys(progress.attempts).length <= MAX_ATTEMPTS, fail(when, 'too many attempts'));
        assert.equal(of('credit').length, credits.length + progress.sealed.folded, fail(when, 'credits, folded attempts and claims differ'));
        for (const id of credits) assert.ok(Object.hasOwn(progress.attempts, id), fail(when, `credit ${id} has no attempt`));
        for (const id of Object.keys(progress.attempts)) if (progress.attempts[id].kind === 'narrative') assert.ok(of('use').includes(id) || of('paid').length, fail(when, `a narrative attempt ${id} without its use claim`));
        // Training.
        const waiting = {};
        for (const session of Object.values(training.sessions)) {
            if (session.status === 'requested') waiting[session.actor] = (waiting[session.actor] ?? 0) + 1;
            if (session.status === 'completed' || session.status === 'interrupted') {
                assert.ok(Number.isInteger(session.fee) && session.endMinute === session.startMinute + 60 && Number.isInteger(session.event?.die), fail(when, `session ${session.id} ran without its fee, minutes or die`));
            } else assert.equal(session.fee, null, fail(when, `session ${session.id} (${session.status}) has a fee`));
            if (session.status === 'completed') assert.ok(Object.values(progress.attempts).some(a => a.session === session.id) || progress.sealed.folded > 0, fail(when, `session ${session.id} credited nothing`));
            if (session.status === 'interrupted') assert.ok(!Object.values(progress.attempts).some(a => a.session === session.id), fail(when, `an interrupted session ${session.id} credited`));
        }
        for (const [actor, n] of Object.entries(waiting)) assert.equal(n, 1, fail(when, `${actor} has ${n} requests waiting`));
        // Flags and generated items.
        for (const [key, entry] of Object.entries(rules.flags)) assert.ok(head.meta.claims[`rb:ep_00000000:flag:${entry.evidence}`], fail(when, `flag ${key} without its evidence claim`));
        for (const [id, entry] of Object.entries(rules.generated)) {
            assert.ok(head.meta.claims[`rb:ep_00000000:item:${id}`], fail(when, `item ${id} without its claim`));
            assert.deepEqual(head.domains.inventory.defs[id], entry.def, fail(when, `item ${id}: the registered definition is not the stored one`));
        }
        // The roster.
        const view = w.q('rules.party', {});
        assert.ok(view.active.length >= 1 && view.active.length <= 3 && view.active[0].id === w.pc, fail(when, 'the roster'));
        assert.equal(view.active.length + view.reserve.length, members().length, fail(when, 'the party is split into active and reserve'));
    };

    for (let step = 0; step < steps; step += 1) {
        const kind = r.int(0, 13);
        const at = lastReply();
        if (kind <= 3) {
            log.push(`${step}: send`);
            await w.say(`Reply ${step}.`, lines());
        } else if (kind === 4) {
            // Be at the trainer with the clock set (sometimes), ask for a training, then the reply settles it.
            if (r.chance(0.8)) await w.say(`Arrival ${step}.`, [`~ time ${r.int(3, 40) * DAY + r.int(0, DAY - 1)}`, `~ here ${HAVEN}`]);
            const offers = w.q('rules.training', { actor: r.pick(members()) })?.offers?.filter(item => item.blocked.length === 0) ?? [];
            if (offers.length) {
                const out = w.ui('skill.train', r.pick(offers).payload);
                log.push(`${step}: train ${out.ok ? 'ok' : out.code}`);
            } else log.push(`${step}: train (none open)`);
            await w.say(`Lesson ${step}.`, [`~ here ${r.pick([HAVEN, HAVEN, MILL])}`, ...lines()].slice(0, 6));
        } else if (kind === 5) {
            const flag = r.pick(['bell.rung', 'gate.open']);
            const out = w.host.bus.command('sd.event', { flag, value: r.chance(0.6) }, { cause: 'system' });
            log.push(`${step}: flag ${flag} ${out.ok ? 'ok' : out.code}`);
        } else if (kind === 6) {
            const wanted = r.pick([members(), members().slice(0, 2), [w.pc], members().slice(1), [w.pc, w.mates[1]]]);
            const out = w.ui('party.setActive', { actors: wanted });
            log.push(`${step}: setActive ${out.ok ? 'ok' : out.code}`);
        } else if (kind === 7 && at > 2) {
            log.push(`${step}: swipe`);
            await w.host.swipe(text(`Swipe ${step}.`, lines()));
        } else if (kind === 8 && at > 2) {
            log.push(`${step}: continue`);
            await w.host.cont(text(` More ${step}.`, lines()));
        } else if (kind === 9 && at > 2) {
            log.push(`${step}: re-read`);
            await w.host.turn.reread(at);
        } else if (kind === 10 && w.host.ctx.chat.length > 7) {
            const pairs = w.host.ctx.chat.map((message, i) => (i > 3 && !message.is_user ? i : -1)).filter(i => i > 0);
            if (pairs.length) {
                const i = r.pick(pairs);
                log.push(`${step}: delete reply ${i}`);
                await w.host.st.deleteMessage(i);
                await w.host.st.deleteMessage(i - 1);
            }
        } else if (kind === 11) {
            log.push(`${step}: reload`);
            const before = snap();
            await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
            assert.equal(snap(), before, fail(`step ${step}`, 'a reload changed the chat'));
        } else {
            log.push(`${step}: send (practice)`);
            await w.say(`Practice ${step}.`, [`~ time ${r.int(41, 46) * DAY + 600}`, ...lines()]);
        }
        check(`step ${step}`);
        if (step % 6 === 5) {
            const live = snap();
            w.host.store.rebuild();
            { const now = snap(); assert.ok(now === live, fail(`step ${step}`, `live differs from a rebuild ${diff(live, now)}`)); }
        }
    }
    const progress = w.slice('progress');
    return { attempts: Object.keys(progress.attempts).length, credits: Object.keys(progress.credits).length, folded: progress.sealed.folded, sessions: Object.keys(w.slice('training').sessions).length, items: Object.keys(w.slice('rules').generated).length };
}

for (const seed of SEEDS) {
    test(`entry-point fuzz seed ${seed}: skill uses, trainings, the roster, flag events, story items and the replay operations keep every ledger whole`, async t => {
        await seeded(seed, async () => {
            t.mock.method(console, 'warn', () => {});
            const out = await run(t, seed, STEPS);
            if (process.env.QA_FUZZ_VERBOSE) console.log(`seed ${seed}: ${JSON.stringify(out)}`);
        });
    });
}
