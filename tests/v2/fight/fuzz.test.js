// Seeded fuzz of fights on a pinned ruleset through the real combat part (B4, B5): encounters, starts, manual form actions with random
// legal targets, attacks and defends, ends, narrative skill uses between them, and the replay operations (swipe, Continue, Re-read,
// delete from the middle, reload). After every step:
//   * a command that is refused moved nothing (the whole state is the one it had);
//   * the only problems are guard turn-offs and re-plans;
//   * pools stay in range, the purse never goes below 0, and no unit of a fight is a member of the party;
//   * every sealed result hashes to its hash and carries its own ruleset; at most MAX_BATCHES are kept;
//   * every combat attempt is named by a fight and has its claim, and a fight's XP is claimed once per member (never twice);
//   * credits + folded attempts = credit claims;
//   * the live state is what a cold rebuild gives (the fights replay identically).
// QA_FUZZ_SEED runs one seed, QA_FUZZ_STEPS sets the length.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TIERS, DAY, realWorld } from '../progress/helpers/world.js';
import { fightPin, ref } from '../progress/helpers/fixture.js';
import { seeded } from '../integration/helpers/host.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { MAX_BATCHES } from '../../../src/v2/fight/batch.js';

const SEEDS = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)] : [21, 22, 23];
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 40;
const HAVEN = 'pack.fixture/haven';
const FORMS = ['s00', 's01', 's02'].map(skill => ref(`${skill}-base`));

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
    const w = await realWorld(t, { given: fightPin(), sd: true, companions: ['Lyra'] });
    const log = [];
    const fail = (when, message) => `seed ${seed}, ${when}: ${message}\n${log.slice(-10).join('\n')}`;
    const members = () => [w.pc, ...w.mates];
    const OWN = ['rules', 'progress', 'combat', 'inventory', 'party', 'director'];
    const snap = () => JSON.stringify({ domains: Object.fromEntries(OWN.map(name => [name, w.head().domains[name]])), claims: Object.keys(w.head().meta.claims).sort() });
    const diff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i += 1; return `at ${i}: …${a.slice(Math.max(0, i - 80), i + 120)} / …${b.slice(Math.max(0, i - 80), i + 120)}`; };
    const view = () => w.q('combat.session', {});
    const lastReply = () => w.host.ctx.chat.findLastIndex(message => !message.is_user && message !== w.host.ctx.chat[0]);
    const text = (narration, lines) => (lines.length ? `${narration}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : narration);
    const lines = () => {
        const out = [];
        if (r.chance(0.6)) out.push(`~ time ${r.int(3, 40) * DAY + r.int(0, DAY - 1)}`);
        if (r.chance(0.4)) out.push(`~ here ${HAVEN}`);
        if (r.chance(0.5)) out.push(`! encounter ${r.int(1, 3)} Wolf — hungry | tier: ${r.pick(['weak', 'even'])}`);
        if (r.chance(0.3)) out.push(`! skill-use ${r.pick(members())} | skill: ${ref(r.pick(['s00', 's01', 's02']))} | form: ${r.pick(FORMS)}`);
        return out;
    };
    assert.equal(w.host.bus.command('test.coin', { amount: 300 }, { cause: 'ui' }).ok, true);

    const check = when => {
        const head = w.head();
        const { progress } = head.domains;
        const problems = w.problems().filter(problem => problem.code !== 'REPLANNED' && !/\/domains\/inventory\/stacks\/|Item stack/.test(problem.why ?? ''));
        assert.deepEqual(problems.filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), [], fail(when, `a problem that is not a turn-off: ${JSON.stringify(problems).slice(0, 600)}`));
        for (const id of members()) {
            const member = w.q('party.actor', { id });
            for (const pool of ['hp', 'mp', 'sp']) assert.ok(member[pool].cur >= 0 && member[pool].cur <= member[pool].max, fail(when, `${id} ${pool} ${member[pool].cur}/${member[pool].max}`));
        }
        assert.ok((w.q('inventory.wallet', { owner: 'party' }).coin ?? 0) >= 0, fail(when, 'the purse went below zero'));
        // Units of a fight are never members of the party.
        const party = new Set(Object.keys(head.domains.party.actors));
        for (const id of Object.keys(progress.temporary)) assert.ok(!party.has(id), fail(when, `unit ${id} is a party member`));
        // Sealed results.
        const batches = Object.entries(progress.batches);
        assert.ok(batches.length <= MAX_BATCHES, fail(when, 'too many sealed results'));
        for (const [id, batch] of batches) {
            assert.equal(hashJson(batch.bytes), batch.hash, fail(when, `sealed result ${id} does not hash to its hash`));
            assert.ok(typeof batch.bytes.fight === 'string' && batch.bytes.ruleset === head.domains.rules.rulesHash, fail(when, `sealed result ${id} names no fight or another ruleset`));
        }
        // Attempts, credits, XP.
        const claims = Object.keys(head.meta.claims);
        const credits = claims.filter(key => key.startsWith('rb:') && key.split(':')[2] === 'credit');
        assert.equal(credits.length, Object.keys(progress.credits).length + progress.sealed.folded, fail(when, 'credits, folded attempts and claims differ'));
        for (const [id, attempt] of Object.entries(progress.attempts)) {
            if (attempt.kind === 'combat') assert.ok(/^fi_/.test(attempt.cost) && head.meta.claims[`rb:ep_00000000:attempt:${id}`], fail(when, `combat attempt ${id} without its fight or its claim`));
        }
        const xp = claims.filter(key => key.startsWith('xp:combat:'));
        assert.equal(new Set(xp).size, xp.length, fail(when, 'a fight\'s XP claimed twice'));
        // A fight on the line is one the combat part holds.
        const now = view();
        if (now && now.status === 'active') assert.ok(head.domains.combat.fights?.[now.id], fail(when, 'the active fight is not stored'));
    };

    /** A command's result; a refusal moved nothing. */
    const ui = (label, type, payload) => {
        const before = snap();
        const out = w.ui(type, payload);
        log.push(`${label}: ${type} ${out.ok ? 'ok' : out.code}`);
        if (!out.ok) assert.equal(snap(), before, fail(label, `${type} was refused (${out.code}) and moved something`));
        return out;
    };
    const act = step => {
        const v = view();
        if (!v || v.status !== 'active' || !v.actions) return;
        const targets = v.actions.targets;
        const roll = r.int(0, 9);
        if (roll <= 4 && v.actions.skills?.length) {
            const skill = r.pick(v.actions.skills);
            const selections = (skill.form?.effects ?? []).filter(effect => effect.choose).map(effect => ({ effect: effect.index, targets: effect.legal?.length ? [r.pick(effect.legal)] : [] }));
            ui(step, 'combat.act', { action: { type: 'form', form: skill.form.id, selections }, session: v.id, board: v.board });
        } else if (roll <= 7 && targets?.enemies?.length) ui(step, 'combat.act', { action: { type: 'attack', target: r.pick(targets.enemies) }, session: v.id, board: v.board });
        else if (roll === 8) ui(step, 'combat.act', { action: { type: 'defend' }, session: v.id, board: v.board });
        else ui(step, 'combat.act', { action: { type: 'form', form: ref('s30-base') }, session: v.id, board: v.board });   // a form no one here holds
    };

    for (let step = 0; step < steps; step += 1) {
        const kind = r.pick([0, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15]);
        const at = lastReply();
        if (kind <= 2) {
            log.push(`${step}: send`);
            await w.say(`Reply ${step}.`, lines());
        } else if (kind === 3) {
            const [offer] = w.q('combat.offers', {}) ?? [];
            if (offer) ui(step, 'combat.start', { offer: offer.id });
            else log.push(`${step}: start (no offer)`);
        } else if (kind <= 8) {
            act(step);
            if (r.chance(0.4)) await w.say(`Round ${step}.`, []);
        } else if (kind === 9) {
            // Play the fight out with the engine's own simple blows (sometimes), then ask for its end.
            const v = view();
            for (let n = 0; v && r.chance(0.7) && n < 30 && view()?.status === 'active'; n += 1) act(`${step}.${n}`);
            if (v) ui(step, 'combat.end', { session: v.id });
        } else if (kind === 10 && at > 2) {
            log.push(`${step}: swipe`);
            await w.host.swipe(text(`Swipe ${step}.`, lines()));
        } else if (kind === 11 && at > 2) {
            log.push(`${step}: continue`);
            await w.host.cont(text(` More ${step}.`, lines()));
        } else if (kind === 12 && at > 2) {
            log.push(`${step}: re-read`);
            await w.host.turn.reread(at);
        } else if (kind === 13 && w.host.ctx.chat.length > 7) {
            const pairs = w.host.ctx.chat.map((message, i) => (i > 3 && !message.is_user ? i : -1)).filter(i => i > 0);
            if (pairs.length) {
                const i = r.pick(pairs);
                log.push(`${step}: delete reply ${i}`);
                await w.host.st.deleteMessage(i);
                await w.host.st.deleteMessage(i - 1);
            }
        } else if (kind === 14) {
            log.push(`${step}: reload`);
            const before = snap();
            await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
            assert.equal(snap(), before, fail(`step ${step}`, 'a reload changed the chat'));
        } else {
            log.push(`${step}: send (practice)`);
            await w.say(`Practice ${step}.`, [`~ time ${r.int(41, 46) * DAY + 600}`, '! encounter 1 Wolf — hungry | tier: weak', ...lines()]);
        }
        check(`step ${step}`);
        if (step % 8 === 7) {
            const live = snap();
            w.host.store.rebuild();
            const now = snap();
            assert.ok(now === live, fail(`step ${step}`, `live differs from a rebuild ${diff(live, now)}`));
        }
    }
    const progress = w.slice('progress');
    return { attempts: Object.keys(progress.attempts).length, batches: Object.keys(progress.batches).length, fights: Object.keys(w.slice('combat').fights ?? {}).length, xp: Object.keys(w.head().meta.claims).filter(key => key.startsWith('xp:combat:')).length };
}

for (const seed of SEEDS) {
    test(`fight fuzz seed ${seed}: forms, targets, ends, sealed results and the replay operations keep every ledger whole`, async t => {
        await seeded(seed, async () => {
            t.mock.method(console, 'warn', () => {});
            try {
                const out = await run(t, seed, STEPS);
                if (process.env.QA_FUZZ_VERBOSE) console.log(`seed ${seed}: ${JSON.stringify(out)}`);
            } finally {
                delete AREA_TIERS[HAVEN];
            }
        });
    });
}
