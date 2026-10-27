// HP and MP back with story time (party/recovery.js, feature `rpg-battle.recovery`): v1's rule (5 % of
// max HP and MP each whole story hour, stamina filled by an hour, a full rest at 6 hours or more at once)
// on Story Director's clock, read through a query that may not be there. RPG Battle alone has no clock,
// so nothing comes back by time. Heals are counts (`lost`) and the mark (`party.rested`) is a count, so
// swipes, middle deletes and a clock set back keep replay equal to live and never heal twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';
import { planRecovery, recover, RECOVERY_FEATURE } from '../../../src/v2/party/recovery.js';
import { pcOf, run, withPc } from './helpers/fake-ctx.js';
import { makeRules } from '../../../src/rules.js';
import { CLOCK } from './helpers/clock.js';

const R = makeRules();
const json = value => JSON.stringify(value);

async function withHost(seed, fn, { clock = true, settings = null } = {}) {
    await seeded(seed, async () => {
        const host = await rpgHost({ modules: clock ? [CLOCK] : [], ...(settings ? { settings } : {}) });
        try {
            assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
            await fn(host);
        } finally {
            host.close();
        }
    });
}

const pc = host => host.q('party.pc');
const hp = host => pc(host).hp;
/** Ren hurt by `~ wound` (code's share), at story minute 600 when there is a clock. */
async function hurt(host, { clock = true } = {}) {
    await host.send('Start.', host.reply('Morning.', clock ? ['~ time 600'] : []));
    await host.send('Fall.', host.reply('Ren falls into the weir.', ['~ wound Ren — fell into the weir | harm: severe']));
    return hp(host);
}
/** Checks rebuild == live (SPEC §2.2) and that no block was skipped. */
function sameOnRebuild(host, why) {
    assert.deepEqual(host.store.problems().map(p => p.why ?? p.message), [], `${why}: no block skipped`);
    const live = json(host.head());
    host.store.rebuild();
    assert.equal(json(host.head()), live, `${why}: rebuilt head equals the live one`);
}
const userAt = (host, text) => host.ctx.chat.findIndex(message => message.is_user && message.mes === text);
async function deleteExchange(host, text) {
    const at = userAt(host, text);
    assert.ok(at > 0, `there is a "${text}" message`);
    await host.st.deleteMessage(at + 1);
    await host.st.deleteMessage(at);
}

test('the feature is declared, on by default, and its rule is v1\'s', () => {
    assert.deepEqual(R.recovery, { shortRestShare: 0.25, perHour: 0.05, longRestHours: 6, spPerHour: 1 });
    const party = { pc: 'ac_00000001', rested: 600 };
    assert.equal(planRecovery(party, 659, { rules: R }), null, 'less than an hour waits');
    assert.deepEqual(planRecovery(party, 725, { rules: R }), { rested: 720, kind: 'hours', hours: 2 }, 'whole hours; the rest waits for the next stretch');
    assert.deepEqual(planRecovery(party, 960, { rules: R }), { rested: 960, kind: 'long', hours: 6 }, '6 hours at once is a full rest');
    assert.equal(planRecovery(party, 300, { rules: R }), null, 'a clock set back: nothing, and the mark stays');
    assert.deepEqual(planRecovery(party, 720, { rules: R, fight: true }), { rested: 720, kind: 'fight', hours: 0 }, 'in a fight the mark moves, nobody heals');
    assert.deepEqual(planRecovery(party, 720, { rules: R, off: true }), { rested: 720, kind: 'off', hours: 0 }, 'switched off the mark moves, nobody heals');
    assert.deepEqual(planRecovery({ pc: 'ac_00000001', rested: null }, 600, { rules: R }), { rested: 600, kind: 'mark', hours: 0 }, 'the first reading only sets the mark');
    assert.deepEqual(planRecovery({ pc: 'ac_00000001' }, 600, { rules: R }), { rested: null, kind: 'mark', hours: 0 }, 'an older chat first gets null');
    assert.equal(planRecovery(party, null, { rules: R }), null, 'no clock, nothing');
});

test('an older chat\'s party (no mark yet) gets null first, then the clock, then heals; a click is refused', () => {
    let state = withPc();
    delete state.domains.party.rested;
    const ren = pcOf(state);
    Object.assign(ren, { hp: { cur: 10, max: ren.hp.max, lost: ren.hp.max - 10 } });
    const at = minutes => (ctx, payload) => recover({ ...ctx, query: (name, args) => (name === 'director.time' ? { minutes } : ctx.query(name, args)) }, payload);
    let out = run(state, at(700), {});
    assert.ok(out.ok, out.message);
    assert.equal(out.state.domains.party.rested, null, 'first: null, so a replay never counts the mark up from nothing');
    out = run(out.state, at(700), {});
    assert.equal(out.state.domains.party.rested, 700, 'then the clock, without a heal');
    assert.equal(pcOf(out.state).hp.cur, 10);
    out = run(out.state, at(820), {});
    assert.equal(pcOf(out.state).hp.cur, 10 + Math.floor(ren.hp.max * 0.1), 'two hours heal');
    assert.equal(out.result.data.kind, 'hours');
    const click = run(out.state, at(1000), {}, { cause: 'ui' });
    assert.equal(click.ok, false);
    assert.equal(click.code, 'REFUSED');
    state = out.state;
    assert.deepEqual(run(state, 'party.recover', {}).result.data, { kind: null }, 'no clock (no Story Director): nothing, and no refusal');
});

test('6 hours at once: a full rest like `! rest long`; what a fight left ends (it would have worn off by then too), a story\'s curse stays', () => {
    const state = withPc();
    const ren = pcOf(state);
    state.domains.party.rested = 600;
    Object.assign(ren, { hp: { cur: 5, max: ren.hp.max, lost: ren.hp.max - 5 }, mp: { cur: 0, max: ren.mp.max, lost: ren.mp.max }, conditions: [{ kind: 'bleeding', stacks: 1, rounds: 2, at: 590 }, { kind: 'cursed', stacks: 1 }] });
    const out = run(state, (ctx, payload) => recover({ ...ctx, query: (name, args) => (name === 'director.time' ? { minutes: 600 + 6 * 60 } : ctx.query(name, args)) }, payload), {});
    assert.ok(out.ok, out.message);
    const after = pcOf(out.state);
    assert.deepEqual([after.hp, after.mp], [{ cur: ren.hp.max, max: ren.hp.max }, { cur: ren.mp.max, max: ren.mp.max }], 'filled and stored full');
    assert.deepEqual(after.conditions, [{ kind: 'cursed', stacks: 1 }]);
    assert.match(out.result.summary, /^6 hours pass: Ren is fully rested\.$/);
});

test('RPG Battle alone (no Story Director, no clock): nothing comes back by time', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(71, async host => {
        const wounded = await hurt(host, { clock: false });
        assert.ok(wounded.cur < wounded.max);
        assert.throws(() => host.q('director.time'), 'no clock query here');
        for (let n = 0; n < 4; n += 1) await host.send(`Wait ${n}.`, host.reply('Hours go by.', []));
        assert.deepEqual(hp(host), wounded, 'HP stays where the wound left it');
        assert.equal(host.head().domains.party.rested, null, 'no mark without a clock');
        const receipts = host.sdk.receipts().map(entry => entry.receipt.type);
        assert.ok(!receipts.includes('party.recover'), 'no recovery step was written');
        assert.ok(host.sdk.features().some(feature => feature.id === RECOVERY_FEATURE && feature.default === true && feature.on), 'declared and on');
    }, { clock: false });
});

test('with the clock: each whole hour gives back 5% of max HP and MP; the heal comes before the next reply', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(72, async host => {
        const wounded = await hurt(host);
        await host.send('Walk.', host.reply('Two hours on the road.', ['! time +2h']));
        assert.deepEqual(hp(host), wounded, 'shown as the reply left it until the story goes on');
        await host.send('Look.', host.reply('The town gate.', []));
        const healed = Math.min(wounded.max, wounded.cur + Math.floor(wounded.max * 0.05 * 2));
        assert.equal(hp(host).cur, healed, '2 hours: 10% of max HP');
        assert.match(host.tails().at(-1), new RegExp(`HP ${healed}/${wounded.max}`), 'the reply after it was told the healed numbers');
        const step = host.sdk.receipts().map(entry => entry.receipt).filter(receipt => receipt.type === 'party.recover').at(-1);
        assert.match(step.summary, /^2 hours pass: Ren HP \+\d+/);
        assert.equal(host.head().domains.party.rested, 720, 'the mark is at the clock');
        sameOnRebuild(host, 'after the heal');
    });
});

test('minutes short of an hour wait for the next stretch; 6 hours at once is a full rest', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(73, async host => {
        const wounded = await hurt(host);
        await host.send('A.', host.reply('Half an hour.', ['! time +30m']));
        await host.send('B.', host.reply('Another half.', ['! time +30m']));
        assert.equal(hp(host).cur, wounded.cur, 'the first half hour healed nothing yet');
        await host.send('C.', host.reply('Camp.', []));
        assert.equal(hp(host).cur, wounded.cur + Math.floor(wounded.max * 0.05), 'the two halves made an hour');
        // A fight-left condition (it keeps rounds and the minute) and a story's: the full rest ends the fight's.
        const party = host.head().domains.party;
        assert.equal(party.rested, 660);
        await host.send('Sleep.', host.reply('They sleep the night.', ['! time +7h']));
        await host.send('Wake.', host.reply('Dawn.', []));
        assert.deepEqual(hp(host), { cur: wounded.max, max: wounded.max }, 'fully rested');
        assert.equal(host.head().domains.party.actors[party.pc].hp.lost, undefined, 'a full rest is stored full ("restore to full")');
        sameOnRebuild(host, 'after the full rest');
    });
});

test('time written before a wound heals first, and the wound stays; a rest in the same stretch is not added on top', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(74, async host => {
        await host.send('Start.', host.reply('Morning.', ['~ time 600']));
        await host.send('March.', host.reply('A long march, then an ambush arrow.', ['~ wound Ren — an arrow | harm: wound', '! time +2h']));
        const first = hp(host);
        await host.send('Go on.', host.reply('They go on.', []));
        assert.equal(hp(host).cur, first.cur + Math.floor(first.max * 0.1), 'time after the wound heals it in part');
        const before = hp(host);
        await host.send('More.', host.reply('Eight hours of marching, then a fall at the end.', ['! time +8h', '~ wound Ren — a fall | harm: severe']));
        const after = hp(host);
        assert.ok(before.cur < before.max, 'still hurt before the march');
        assert.equal(after.cur, after.max - Math.max(1, Math.round(after.max * 0.5)), 'the full rest came first; the severe fall at the end still shows');
        // A short rest in the reply that moved the clock heals what the hour gives, once (not the hour's share and the rest's on top).
        await host.send('Next.', host.reply('Next day.', []));
        const low = hp(host);
        await host.send('Rest.', host.reply('An hour\'s rest by the road.', ['! time +1h', '! rest short — by the road']));
        const hour = Math.floor(low.max * 0.05);
        assert.equal(hp(host).cur, Math.min(low.max, low.cur + hour), 'a short rest gives what its hour gives, once');
        sameOnRebuild(host, 'wounds and rests around time');
    });
});

test('a clock set back heals nothing and takes nothing back; the same stretch never heals twice', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(75, async host => {
        const wounded = await hurt(host);
        const hours = n => Math.floor(wounded.max * 0.05 * n);
        await host.send('A.', host.reply('Three hours.', ['! time +3h']));
        await host.send('B.', host.reply('No, it is earlier than they thought.', ['~ time 660']));
        assert.equal(hp(host).cur, wounded.cur + hours(3), 'three hours healed');
        await host.send('C.', host.reply('An hour.', ['! time +1h']));
        await host.send('D.', host.reply('Still.', []));
        assert.equal(hp(host).cur, wounded.cur + hours(3), 'set back, the clock went over hours already healed: nothing more, nothing taken back');
        assert.equal(host.head().domains.party.rested, 780, 'the mark stays where it was');
        await host.send('E.', host.reply('Two more hours.', ['! time +2h']));
        await host.send('F.', host.reply('Evening.', []));
        assert.equal(hp(host).cur, wounded.cur + hours(3) + hours(1), 'only the hour past the mark heals');
        sameOnRebuild(host, 'set back');
    });
});

test('swipes: a reply\'s time heals as its shown swipe says, once', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(76, async host => {
        const wounded = await hurt(host);
        const hour = Math.floor(wounded.max * 0.05);
        await host.send('Walk.', host.reply('Four hours on the road.', ['! time +4h']));
        await host.swipe(host.reply('One hour on the road.', ['! time +1h']));
        await host.send('Look.', host.reply('The gate.', []));
        assert.equal(hp(host).cur, wounded.cur + hour, 'the shown swipe\'s hour, not the swiped-away four');
        // Swiping the newest reply again does not heal the hour again.
        await host.swipe(host.reply('The gate, at dusk.', []));
        await host.swipe(host.reply('The gate, in rain.', []));
        assert.equal(hp(host).cur, wounded.cur + hour, 'swipes of the next reply heal nothing more');
        sameOnRebuild(host, 'swipes');
    });
});

test('middle deletes: deleting the reply that moved the clock takes its heal back; a later heal stays its own size', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(77, async host => {
        const wounded = await hurt(host);
        const hours = n => Math.floor(wounded.max * 0.05 * n);
        await host.send('A.', host.reply('Two hours.', ['! time +2h']));
        await host.send('B.', host.reply('One hour.', ['! time +1h']));
        await host.send('C.', host.reply('Rain.', []));
        assert.equal(hp(host).cur, wounded.cur + hours(2) + hours(1));
        await deleteExchange(host, 'A.');
        sameOnRebuild(host, 'after the delete');
        assert.equal(hp(host).cur, wounded.cur + hours(1), 'the deleted reply\'s two hours are gone with it; the later hour stays');
        assert.equal(host.head().domains.director.time.minutes, 660);
        assert.equal(host.head().domains.party.rested, 660, 'the mark moved back with the clock (a count)');
        await host.send('D.', host.reply('An hour.', ['! time +1h']));
        await host.send('E.', host.reply('Dusk.', []));
        assert.equal(hp(host).cur, wounded.cur + hours(1) + hours(1), 'the next hour heals as usual');
        sameOnRebuild(host, 'after more replies');
    });
});

test('switched off: nothing comes back, and turned on again it does not heal the time it was off', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(78, async host => {
        const wounded = await hurt(host);
        host.features.set(RECOVERY_FEATURE, false);
        await host.send('A.', host.reply('Five hours.', ['! time +5h']));
        await host.send('B.', host.reply('Night.', []));
        assert.equal(hp(host).cur, wounded.cur, 'off: nothing');
        host.features.set(RECOVERY_FEATURE, true);
        await host.send('C.', host.reply('Morning.', []));
        assert.equal(hp(host).cur, wounded.cur, 'back on: the hours it was off stay unhealed');
        await host.send('D.', host.reply('An hour.', ['! time +1h']));
        await host.send('E.', host.reply('Noon.', []));
        assert.equal(hp(host).cur, wounded.cur + Math.floor(wounded.max * 0.05), 'and new hours heal again');
        sameOnRebuild(host, 'feature off and on');
    });
});

test('a fight starting folds the time in first; time in a fight heals nothing', async t => {
    t.mock.method(console, 'warn', () => {});
    await withHost(79, async host => {
        const wounded = await hurt(host);
        await host.send('Sleep.', host.reply('They sleep, and wolves come at dawn.', ['! time +8h', '! encounter 1 Wolf — at dawn | tier: trivial']));
        const offer = host.q('combat.offers')[0];
        assert.ok(offer, 'a fight is on offer');
        assert.equal((await host.cmd('combat.start', { offer: offer.id })).ok, true);
        assert.equal(hp(host).max, wounded.max);
        const board = host.q('combat.session');
        assert.ok(board, 'the fight is under way');
        const ren = host.head().domains.combat.fights[board.id].setup.party.find(entry => entry.memberId === pc(host).id || entry.id === pc(host).id);
        assert.equal(ren?.hp?.cur ?? ren?.hp, wounded.max, 'Ren starts the fight fully rested');
        sameOnRebuild(host, 'fight start');
    });
});

// A seeded mix with the clock (as FUZZ_DELETE, tests/v2/break/fuzz-delete.test.js): time moves forward and
// back, wounds, heals, rests, story XP, fights, swipes and middle deletes. After every step the head
// rebuilt from the chat equals the live one, no block is skipped (only a fight a deleted reply began may
// be), every pool reads within 0…max, and the recovery mark is a story minute that moved along the way.
function prng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.pick = list => list[Math.floor(next() * list.length)];
    next.chance = p => next() < p;
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    return next;
}
// A block that needs what a deleted reply made is skipped (SPEC §2.2). Loot stacked onto a stack only a
// deleted reply had reads through the counters' merge ("filed under the wrong ID": only its qty is left).
const dependent = why => /does not exist \(no "[a-z]{2}_[0-9a-z]{8}"\)/.test(why) || /^The change path "\/domains\/combat\/session\//.test(why)
    || /^Taken onto the counts as they stand now, these changes no longer fit: Item stack it_[0-9a-z]{8} is filed under the wrong ID\./.test(why);

for (const seed of [1, 2, 3]) {
    test(`recovery mix seed ${seed}: replay equals live through time moves, set backs, swipes and deletes`, { timeout: 120000 }, async t => {
        t.mock.method(console, 'warn', () => {});
        const r = prng(seed * 104729);
        await withHost(90 + seed, async host => {
            await host.send('Start.', host.reply('Morning.', ['~ time 600']));
            let furthest = 600;
            for (let n = 0; n < 24; n += 1) {
                const lines = [];
                for (let i = 0; i < r.int(1, 3); i += 1) {
                    const kind = r.pick(['time', 'time', 'time', 'back', 'harm', 'harm', 'heal', 'rest', 'xp', 'fight']);
                    const now = host.head().domains.director?.time?.minutes ?? 600;
                    if (kind === 'time') lines.push(`! time +${r.pick(['30m', '45m', '1h', '2h', '3h', '7h'])}`);
                    if (kind === 'back') lines.push(`~ time ${Math.max(0, now - r.int(30, 240))}`);
                    if (kind === 'harm') lines.push(`~ wound Ren — a blow ${n}.${i} | harm: ${r.pick(['scratch', 'scratch', 'wound'])}`);
                    if (kind === 'heal') lines.push(`~ wound Ren — a poultice ${n}.${i} | heal: ${r.pick(['scratch', 'wound'])}`);
                    if (kind === 'rest') lines.push(`! rest ${r.pick(['short', 'long'])} — a camp ${n}`);
                    if (kind === 'xp') lines.push(`+ xp ${r.pick(['minor', 'major', 'milestone'])} — a deed ${n}.${i}`);
                    if (kind === 'fight') lines.push(`! encounter 1 ${r.pick(['Wolf', 'Giant Rat'])} — on the road | tier: trivial`);
                }
                await host.send(`turn ${n}`, host.reply(`Reply ${n}.`, lines));
                if (r.chance(0.2)) await host.swipe(host.reply(`Reply ${n}, again.`, lines.filter(() => r.chance(0.5))));
                const offers = host.q('combat.offers') ?? [];
                if (!host.q('combat.session') && offers.length && r.chance(0.5)) await host.cmd('combat.start', { offer: offers[0].id });
                if (host.q('combat.session')?.status === 'active') {
                    for (let k = 0; k < 40 && host.q('combat.session')?.status === 'active'; k += 1) await host.cmd('combat.act', { action: { type: 'auto' } });
                }
                if (host.q('combat.session') && host.q('combat.session').status !== 'active') await host.cmd('combat.end');
                if (r.chance(0.25)) {
                    const chat = host.st.ctx.chat;
                    const users = chat.map((m, i) => (m.is_user ? i : -1)).filter(i => i > 2 && i < chat.length - 2);
                    if (users.length) {
                        const u = r.pick(users);
                        await host.st.deleteMessage(u + 1);
                        await host.st.deleteMessage(u);
                    }
                }
                const skipped = host.store.problems().map(p => String(p.why ?? p.message)).filter(why => !dependent(why));
                assert.deepEqual(skipped, [], `seed ${seed} reply ${n}: a valid block was skipped on replay`);
                for (const actor of host.q('party.actors') ?? []) {
                    for (const pool of ['hp', 'mp', 'sp']) assert.ok(actor[pool].cur >= 0 && actor[pool].cur <= actor[pool].max, `seed ${seed} reply ${n}: ${pool} ${actor[pool].cur}/${actor[pool].max}`);
                }
                const rested = host.head().domains.party.rested;
                if (Number.isInteger(rested)) furthest = Math.max(furthest, rested);
                assert.ok(rested === null || Number.isInteger(rested), `seed ${seed} reply ${n}: the mark is a story minute`);
                const live = json(host.head());
                host.store.rebuild();
                assert.equal(json(host.head()), live, `seed ${seed} reply ${n}: the rebuilt head differs from the live one`);
            }
            assert.ok(furthest > 600, `seed ${seed}: story time was folded in`);
        });
    });
}
