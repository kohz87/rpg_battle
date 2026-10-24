// Seeded fuzz of progression on the real host (contract §6, B5): sends, Continues, swipes, Re-reads (unchanged and
// edited), deletes from the middle, reloads and the player's choices, over two characters, with XP, a clock and
// paid attempts coming and going. After every step:
//   * the caps are never exceeded: a skill earns at most 2 credits on a reply and 10 on a story day, a
//     character 6 and 30, a form never passes 35 uses (5/5), and a credit is one claim and one attempt;
//   * nothing survives the removal of its prerequisite: every choice that is applied is still earned by what the chat
//     holds now (its level, its skills at 5/5, its parent form, every earlier milestone), and every character keeps
//     exactly three skills;
//   * the live state is what a cold rebuild gives, and the only problems are the stored blocks the guard turned off.
// QA_FUZZ_SEED runs one seed, QA_FUZZ_STEPS sets the length.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR, DAY, FRIEND, grind, nextKey, ref, started } from './helpers/world.js';
import { promoted } from './helpers/states.js';
import { seeded } from '../integration/helpers/host.js';
import { choicesOf, deriveActor } from '../../../src/v2/progress/derive.js';
import { rowsOf, tallyOf, usesOf } from '../../../src/v2/progress/credit.js';
import { masteryOf } from '../../../src/v2/progress/mastery.js';
import { indexOfState } from '../../../src/v2/rules/graph.js';
import { levelFromEarned } from '../../../src/v2/progress/level.js';

const SEEDS = process.env.QA_FUZZ_SEED ? [Number(process.env.QA_FUZZ_SEED)] : [1, 2, 3, 4];
const STEPS = Number(process.env.QA_FUZZ_STEPS) || 40;

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

const text = (narration, lines) => (lines.length ? `${narration}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : narration);
const hashOf = w => w.slice('rules').rulesHash;

async function run(t, seed, steps) {
    const r = prng(seed);
    const w = await started(t);
    const bare = value => value.replace('pack.fixture/', '');
    assert.equal(w.host.bus.command('tp.add', { id: FRIEND, name: 'Lyra' }, { cause: 'ui' }).ok, true);
    const log = [];
    let clicks = 0;
    let promotions = 0;
    let credits = 0;
    const continued = new Set();
    const fail = (when, message) => `seed ${seed}, ${when}: ${message}\n${log.slice(-12).join('\n')}`;

    // The skills an actor holds now (mostly what the attempt lines name), else any skill of the golden pack.
    const holds = actor => w.progress(actor)?.checklist ?? [];
    const attempt = () => {
        const actor = r.pick([ACTOR, ACTOR, FRIEND]);
        const held = holds(actor);
        const item = held.length && r.chance(0.9) ? r.pick(held) : { skill: ref(r.pick(['s00', 's01', 's02', 's10', 's30'])), form: null };
        const form = item.form ?? `${item.skill}-base`;
        return `! attempt ${actor} | skill: ${bare(item.skill)} | form: ${bare(form)} | key: ${nextKey()}`;
    };
    const lines = () => {
        const out = [];
        if (r.chance(0.6)) out.push(`~ time ${r.int(38, 48) * DAY + r.int(0, DAY - 1)}`);
        if (r.chance(0.3)) out.push(`! xp ${r.pick([ACTOR, FRIEND])} | n: ${r.int(20, 700)}`);
        for (let n = r.int(0, 8); n > 0; n -= 1) out.push(attempt());
        return out;
    };
    const lastReply = () => w.host.ctx.chat.findLastIndex(message => !message.is_user && message !== w.host.ctx.chat[0]);
    const view = actor => w.progress(actor);

    const snap = () => JSON.stringify({ progress: w.slice('progress'), claims: Object.keys(w.head().meta.claims).filter(key => key.startsWith('rb:')).sort() });

    const check = when => {
        const head = w.head();
        const progress = head.domains.progress;
        const ix = indexOfState(head);
        // The only problems are blocks the guard turned off (a Re-read may also say it planned a step again).
        const problems = w.problems().filter(problem => problem.code !== 'REPLANNED');
        assert.deepEqual(problems.filter(problem => problem.code !== 'REPLAY_PREREQUISITE'), [], fail(when, 'a problem that is not a prerequisite'));
        // Caps.
        const per = { skillReply: new Map(), actorReply: new Map(), skillDay: new Map(), actorDay: new Map() };
        const add = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
        for (const { attempt: a, credit } of rowsOf(progress)) {
            if (credit.award < 1) continue;
            add(per.skillReply, `${a.actor}|${a.skill}|${credit.reply}`);
            add(per.actorReply, `${a.actor}|${credit.reply}`);
            add(per.skillDay, `${a.actor}|${a.skill}|${credit.day}`);
            add(per.actorDay, `${a.actor}|${credit.day}`);
        }
        const k = ix.constants;
        for (const [key, n] of per.skillReply) assert.ok(n <= k.usePerSkillReply, fail(when, `${key}: ${n} credits on one reply`));
        for (const [key, n] of per.actorReply) assert.ok(n <= k.usePerActorReply, fail(when, `${key}: ${n} credits on one reply`));
        for (const [key, n] of per.skillDay) assert.ok(n <= k.usePerSkillDay, fail(when, `${key}: ${n} credits on one day`));
        for (const [key, n] of per.actorDay) assert.ok(n <= k.usePerActorDay, fail(when, `${key}: ${n} credits on one day`));
        const tally = tallyOf(rowsOf(progress));
        for (const [key, n] of tally.formUses) assert.ok(n <= 35 && masteryOf(n, k.masteryAt) <= 5, fail(when, `${key}: ${n} uses`));
        // Every credit is an attempt and one claim; no claim is left without its record.
        const claims = Object.keys(head.meta.claims).filter(key => key.startsWith('rb:'));
        const creditClaims = claims.filter(key => key.includes(':credit:')).map(key => key.split(':credit:')[1]).sort();
        assert.deepEqual(creditClaims, Object.keys(progress.credits).sort(), fail(when, 'credits and their claims differ'));
        for (const id of Object.keys(progress.credits)) assert.ok(Object.hasOwn(progress.attempts, id), fail(when, `credit ${id} has no attempt`));
        const choiceClaims = claims.filter(key => key.includes(':class:') || key.includes(':path:')).map(key => key.split(/:(?:class|path):/)[1]).sort();
        assert.deepEqual(choiceClaims, Object.values(progress.choices).map(c => `${c.actor}:${c.milestone}`).sort(), fail(when, 'choices and their claims differ'));
        // Nothing applied has lost its prerequisite, and a character has exactly three skills.
        for (const actor of [ACTOR, FRIEND]) {
            const chosen = choicesOf(progress, actor);
            const derived = deriveActor(ix, chosen);
            if (derived.class === null) continue;
            assert.equal(derived.skills.length, 3, fail(when, `${actor} does not hold three skills`));
            assert.equal(new Set(derived.skills.map(s => s.skill)).size, 3, fail(when, `${actor}: the three skills differ`));
            assert.deepEqual(derived.broken, [], fail(when, `${actor}: a path choice stands without its parent form`));
            const sequence = [0, ...k.promotionMilestones, ...k.pathMilestones];
            const taken = sequence.filter(m => derived.taken.has(m));
            assert.deepEqual(taken, sequence.slice(0, taken.length), fail(when, `${actor}: a milestone was taken before an earlier one`));
            const member = head.domains.tparty.members[actor];
            const level = levelFromEarned(member.earned, k).level;
            let held = null;
            const upto = [];
            for (const choice of chosen) {
                // Lyra's promotions were seeded, not played, with only her advanced skills practised: they are not under test.
                if (choice.milestone > 0 && !(actor === FRIEND && choice.milestone <= 30)) {
                    assert.ok(level >= choice.milestone, fail(when, `${actor}: milestone ${choice.milestone} stands at level ${level}`));
                    const before = deriveActor(ix, upto);
                    if (choice.kind === 'class') {
                        assert.equal(choice.previous, before.class, fail(when, `${actor}: ${choice.milestone} was taken from ${choice.previous}, the class was ${before.class}`));
                        for (const { form } of before.skills) assert.ok(usesOf(tally, actor, form) >= 35, fail(when, `${actor}: ${choice.milestone} stands though ${form} is below 5/5`));
                    } else {
                        const current = before.skills.find(s => s.skill === choice.skill);
                        assert.equal(current?.form, choice.fromForm, fail(when, `${actor}: step ${choice.milestone} stands on ${choice.fromForm}, the skill holds ${current?.form}`));
                        assert.ok(usesOf(tally, actor, choice.fromForm) >= 35, fail(when, `${actor}: step ${choice.milestone} stands though ${choice.fromForm} is below 5/5`));
                        assert.ok(current.steps < 2, fail(when, `${actor}: a third step`));
                    }
                }
                held = choice;
                upto.push(choice);
            }
            assert.ok(held !== null);
            const shown = view(actor);
            assert.ok(shown.checklist.every(item => item.mastery <= 5), fail(when, 'mastery above 5'));
        }
        // The live state is a cold rebuild's.
        const live = snap();
        w.host.store.rebuild();
        // State only: store.problems() after a reload past a checkpoint can differ from the live list (seeds 102, 104 and 105 at 90
        // steps). That is the host's behaviour (E1 replay), not this part's, so the walk compares what this part owns: the state.
        assert.equal(snap(), live, fail(when, 'live differs from a rebuild'));
        credits = Math.max(credits, Object.values(progress.credits).filter(c => c.award === 1).length);
    };

    // Two characters, started so the walk begins where choices can happen. Astra is a new character who is made to
    // master her three skills (so a promotion is open and can be attacked); Lyra is already in the advanced class with
    // every skill at 5/5 (so the paths are open). Each is a seeded or played start; the walk that follows is random.
    await w.say('Start.', [`~ time ${DAY + 10}`, `! xp ${ACTOR} | n: 1500`, `! xp ${FRIEND} | n: 6500`]);
    const seeded5 = Object.fromEntries(['s30', 's31', 's32'].map(skill => [ref(`${skill}-base`), 35]));
    assert.equal(w.host.bus.command('test.seed', { actor: FRIEND, choices: promoted(FRIEND), uses: seeded5 }, { cause: 'ui' }).ok, true);
    await grind(w, { forms: ['s00-base', 's01-base', 's02-base'].map(ref), day: 40 });
    const first = await w.ui('class.choose', { actor: ACTOR, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: hashOf(w) });
    assert.equal(first.ok, true, first.message);
    promotions += 1;
    check('after the set-up');
    for (let step = 0; step < steps; step += 1) {
        const kind = r.int(0, 13);
        const at = lastReply();
        if (kind <= 3) {
            log.push(`${step}: send`);
            await w.say(`Reply ${step}.`, kind <= 1 ? [...lines(), ...lines()].slice(0, 12) : lines());
        } else if (kind === 4 && at > 2) {
            log.push(`${step}: swipe`);
            await w.host.swipe(text(`Swipe ${step}.`, lines()));
        } else if (kind === 5 && at > 2) {
            log.push(`${step}: continue`);
            continued.add(w.host.ctx.chat[at]);
            await w.host.cont(text(` More ${step}.`, lines()));
        } else if (kind === 6 && at > 2) {
            log.push(`${step}: re-read, unchanged`);
            const message = w.host.ctx.chat[at];
            const before = snap();
            const result = await w.host.turn.reread(at);
            if (result.ok && !continued.has(message)) assert.equal(snap(), before, fail(`step ${step}`, 'an unchanged Re-read changed the progression'));
        } else if (kind === 7 && at > 2) {
            log.push(`${step}: edit, re-read`);
            const message = w.host.ctx.chat[at];
            message.mes = text(`Edited ${step}.`, lines());
            message.swipes[message.swipe_id] = message.mes;
            await w.host.turn.reread(at);
        } else if (kind === 8 || kind >= 12) {
            // The player's choice, when one is open (and sometimes one that is not, which must change nothing).
            const actor = r.pick([ACTOR, FRIEND]);
            const shown = view(actor);
            const before = snap();
            if (shown?.promotions?.[0]?.eligible && r.chance(0.9)) {
                const [offer] = shown.promotions;
                const out = await w.ui('class.choose', { actor, milestone: offer.milestone, class: offer.choices[0], expectedClass: shown.class, rulesHash: hashOf(w) });
                log.push(`${step}: promote ${actor} ${offer.milestone} ${out.ok ? 'ok' : out.code}`);
                if (out.ok) promotions += 1;
                clicks += 1;
            } else if (shown?.pathways?.[0]?.eligible && r.chance(0.9)) {
                const [offer] = shown.pathways;
                const pick = r.pick(offer.skills);
                const ready = shown.checklist.find(item => item.skill === pick.skill && item.mastery === 5);
                if (ready) {
                    const out = await w.ui('path.choose', { actor, milestone: offer.milestone, skill: pick.skill, fromForm: pick.fromForm, option: r.pick(pick.options), rulesHash: hashOf(w) });
                    log.push(`${step}: path ${actor} ${offer.milestone} ${out.ok ? 'ok' : out.code}`);
                    if (out.ok) promotions += 1;
                    clicks += 1;
                }
            } else if (shown) {
                const out = await w.ui('class.choose', { actor, milestone: r.pick([10, 20, 30]), class: ref(r.pick(['c1', 'c2', 'c3'])), expectedClass: shown.class, rulesHash: hashOf(w) });
                log.push(`${step}: try ${actor} ${out.ok ? 'ok' : out.code}`);
                if (!out.ok) assert.equal(snap(), before, fail(`step ${step}`, 'a refused choice changed the state'));
            }
        } else if (kind === 9 && w.host.ctx.chat.length > 5) {
            // The first reply holds the party's own set-up (the stand-in party, the pin and the basic classes), which is not under test.
            const pairs = w.host.ctx.chat.map((message, i) => (i > 2 && !message.is_user ? i : -1)).filter(i => i > 0);
            if (pairs.length > 0) {
                const i = r.pick(pairs);
                log.push(`${step}: delete reply ${i}`);
                await w.host.st.deleteMessage(i);
                await w.host.st.deleteMessage(i - 1);
            }
        } else if (kind === 10) {
            log.push(`${step}: reload`);
            const before = snap();
            await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
            assert.equal(snap(), before, fail(`step ${step}`, 'a reload changed the progression'));
        } else {
            log.push(`${step}: send (practice)`);
            const body = [`~ time ${r.int(41, 46) * DAY + 600}`];
            for (const actor of [ACTOR, FRIEND]) for (const item of holds(actor)) for (let i = 0; i < 2; i += 1) body.push(`! attempt ${actor} | skill: ${bare(item.skill)} | form: ${bare(item.form)} | key: ${nextKey()}`);
            await w.say(`Practice ${step}.`, body);
        }
        check(`step ${step}`);
    }
    return { clicks, promotions, credits };
}

for (const seed of SEEDS) {
    test(`progression fuzz seed ${seed}: sends, swipes, Continues, Re-reads, clicks, deletes and reloads never pass the caps or keep a choice without its prerequisite`, async t => {
        await seeded(seed, async () => {
            t.mock.method(console, 'warn', () => {});
            const out = await run(t, seed, STEPS);
            if (process.env.QA_FUZZ_VERBOSE) console.log(`seed ${seed}: ${JSON.stringify(out)}`);
            assert.ok(out.credits > 0, 'the run credited uses');
        });
    });
}
