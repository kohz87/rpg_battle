// A fight on a pinned ruleset through the real combat part (B4, B5; C10 as far as rules go): the offer, the manual active turn with forms
// and per-effect targets, the stale board refusal, the settlement that pays the uses and the XP once and seals the result, and the
// replay of all of it. The same chat without a pin plays the fight it always did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, realWorld } from '../progress/helpers/world.js';
import { fightPin, ref } from '../progress/helpers/fixture.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { resolveBatch } from '../../../src/v2/fight/batch.js';
import { roundsLeft } from '../../../src/v2/party/pools.js';

const S0 = ref('s00-base');
const S1 = ref('s01-base');
const S2 = ref('s02-base');
const ready = (t, over = {}) => realWorld(t, { given: fightPin(), sd: true, ...over });
const drop = async (w, index) => { await w.host.st.deleteMessage(index); await w.host.st.deleteMessage(index - 1); };
const at = (w, text) => w.host.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
const view = w => w.q('combat.session', {});
const fights = w => w.slice('combat').fights ?? {};
const mp = (w, id = w.pc) => w.q('party.actor', { id }).mp.cur;

/** Begins a fight with two weak wolves; → the session view. */
async function begin(w, text = 'The wolves come.') {
    await w.say(text, ['~ time 3000', '! encounter 2 Wolf — hungry | tier: weak']);
    const [offer] = w.q('combat.offers', {});
    const out = w.ui('combat.start', { offer: offer.id });
    assert.equal(out.ok, true, out.message);
    return view(w);
}
const form = (w, v, id, selections) => w.ui('combat.act', { action: { type: 'form', form: id, ...(selections ? { selections } : {}) }, session: v.id, board: v.board });
const attack = (w, v, target) => w.ui('combat.act', { action: { type: 'attack', target: target ?? v.actions.targets.enemies[0] }, session: v.id, board: v.board });
async function finish(w, limit = 40) {
    for (let n = 0; n < limit; n += 1) {
        const v = view(w);
        if (v.status !== 'active') return v;
        assert.equal(attack(w, v).ok, true);
    }
    throw new Error('the fight did not end');
}

test('C10 offer to start: the fight names its ruleset and draws by action, the party fights with its class\'s three forms and their effects', async t => {
    const w = await ready(t);
    const v = await begin(w);
    const stored = fights(w)[v.id];
    assert.equal(stored.setup.ruleset, w.slice('rules').rulesHash);
    assert.equal(stored.setup.draws, 'action');
    assert.deepEqual(v.actions.skills.map(skill => skill.form.id), [S0, S1, S2]);
    const [mixed] = v.actions.skills;
    assert.deepEqual(mixed.form.effects.map(effect => [effect.index, effect.op, effect.side, effect.scope, effect.choose]), [[0, 'damage', 'hostile', 'one', true], [1, 'heal', 'friendly', 'ally', true]]);
    assert.deepEqual(mixed.form.effects[0].legal.sort(), [...v.actions.targets.enemies].sort());
    assert.deepEqual(mixed.form.effects[1].legal, [w.pc]);
    assert.equal(v.turn.actor, w.pc, 'a manual active turn: the player\'s character is waiting');
    assert.equal(w.ui('combat.end', { session: v.id }).code, 'REFUSED', 'not over yet');
    assert.deepEqual(w.problems(), []);
});

test('a mixed form hurts one foe and heals one ally, charged once; the action is stored with its id and its choices; the board moves on', async t => {
    const w = await ready(t);
    const v = await begin(w);
    const was = mp(w);
    const [foe] = v.actions.targets.enemies;
    const out = form(w, v, S0, [{ effect: 0, targets: [foe] }, { effect: 1, targets: [w.pc] }]);
    assert.equal(out.ok, true, out.message);
    assert.equal(was - mp(w), 4, 'four mana, once');
    const [action] = fights(w)[v.id].actions;
    assert.match(action.id, /^ca_[0-9a-z]{8}$/);
    assert.deepEqual([action.type, action.form, action.selections], ['form', S0, [{ effect: 0, targets: [foe] }, { effect: 1, targets: [w.pc] }]]);
    // The same board again is stale: the fight moved on.
    const again = form(w, v, S1, [{ effect: 0, targets: [foe] }]);
    assert.equal(again.code, 'REFUSED');
    assert.match(again.message, /moved on/);
    assert.equal(fights(w)[v.id].actions.length, 1);
    // No permanent mastery at act: nothing is on the ledger until the fight is settled.
    assert.deepEqual(w.slice('progress').attempts, {});
    assert.deepEqual(w.problems(), []);
});

test('stale boards: another fight\'s id, an older board token and an older log length are all refused without playing', async t => {
    const w = await ready(t);
    const v = await begin(w);
    const before = JSON.stringify(fights(w));
    assert.equal(w.ui('combat.act', { action: { type: 'attack', target: v.actions.targets.enemies[0] }, session: 'fi_zzzzzzzz', board: v.board }).code, 'REFUSED');
    assert.equal(w.ui('combat.act', { action: { type: 'attack', target: v.actions.targets.enemies[0] }, session: v.id, board: '0.zzzz' }).code, 'REFUSED');
    assert.equal(w.ui('combat.act', { action: { type: 'attack', target: v.actions.targets.enemies[0] }, session: v.id, logLength: v.logLength + 3 }).code, 'REFUSED');
    assert.equal(JSON.stringify(fights(w)), before);
});

test('malformed, wrong-side, duplicate and unknown choices are refused whole: nothing is paid, stored, rolled or logged', async t => {
    const w = await ready(t);
    const v = await begin(w);
    const [foe, other] = v.actions.targets.enemies;
    const snap = () => JSON.stringify({ combat: w.head().domains.combat, party: w.head().domains.party, claims: w.head().meta.claims });
    const before = snap();
    const bad = [
        [S0, [{ effect: 0, targets: [foe] }, { effect: 0, targets: [other] }], 'an effect twice'],
        [S0, [{ effect: 0, targets: [w.pc] }], 'damage on your own side'],
        [S0, [{ effect: 1, targets: [foe] }], 'a heal on a foe'],
        [S0, [{ effect: 7, targets: [foe] }], 'an effect that is not there'],
        [S0, [{ effect: 0, targets: [foe, other] }], 'two targets for one'],
        [S0, [{ effect: 0, targets: ['nobody'] }], 'a target that is not in the fight'],
        [S0, [{ effect: 0, targets: [foe], extra: 1 }], 'a field that is not in the record'],
        [ref('s30-base'), [], 'a form this fighter does not hold'],
    ];
    for (const [id, selections, why] of bad) {
        const out = form(w, v, id, selections);
        assert.ok(['REFUSED', 'INVALID'].includes(out.code), `${why}: ${out.code}`);
        assert.equal(snap(), before, `${why}: nothing moved`);
    }
    assert.equal(w.ui('combat.act', { action: { type: 'form', form: S0, selections: 'e' }, session: v.id, board: v.board }).code, 'INVALID');
    assert.deepEqual(w.problems(), []);
});

test('the settlement pays once: the uses as attempts named by the fight, the XP through party.grantXp with its claim, the result sealed', async t => {
    const w = await ready(t);
    const v = await begin(w);
    const [foe] = v.actions.targets.enemies;
    assert.equal(form(w, v, S0, [{ effect: 0, targets: [foe] }, { effect: 1, targets: [w.pc] }]).ok, true);
    const xp0 = w.q('party.actor', { id: w.pc }).earned ?? 0;
    const last = await finish(w);
    assert.equal(last.status, 'won');
    const out = w.ui('combat.end', { session: v.id });
    assert.equal(out.ok, true, out.message);
    const { batch, xp } = out.receipt.data;
    // Uses: one for the form used, on the ledger as a combat attempt named by the fight.
    const attempts = Object.values(w.slice('progress').attempts);
    assert.deepEqual(attempts.map(a => [a.kind, a.skill, a.form, a.cost]), [['combat', ref('s00'), S0, v.id]]);
    // XP: exactly the result's, claimed under the fight and the member, once.
    assert.equal((w.q('party.actor', { id: w.pc }).earned ?? 0) - xp0, xp[w.pc]);
    assert.ok(w.head().meta.claims[`xp:combat:${v.id}:${w.pc}`]);
    // Settled once.
    assert.equal(w.ui('combat.end', { session: v.id }).code, 'NOT_FOUND');
    // The sealed result: the id and hash in the receipt and on the last result; the bytes resolve and hash to the hash.
    assert.equal(w.slice('combat').last[0].batch.hash, batch.hash);
    const sealed = resolveBatch({ id: batch.id, state: w.head() });
    assert.equal(sealed.hash, batch.hash);
    assert.equal(hashJson(sealed.bytes), sealed.hash);
    assert.equal(sealed.bytes.fight, v.id);
    assert.equal(sealed.bytes.ruleset, w.slice('rules').rulesHash);
    assert.deepEqual(sealed.bytes.uses, [{ actor: w.pc, skill: ref('s00'), form: S0, count: 1 }]);
    assert.equal(sealed.bytes.actions[0].type, 'form');
    assert.ok(sealed.bytes.actions.every(entry => /^ca_/.test(entry.id) && /^[0-9a-f]{64}$/.test(entry.hash) && Number.isInteger(entry.drawEnd)));
    assert.equal(sealed.bytes.outcome, 'victory');
    assert.equal(resolveBatch({ id: 'br_zzzzzzzz', state: w.head() }), null);
    assert.equal(resolveBatch({ id: batch.id, state: { domains: { progress: { batches: { [batch.id]: { hash: batch.hash, bytes: { tampered: true }, seq: 1 } } } } } }), null, 'bytes that do not hash to their hash are not a result');
    // The credit comes with the next settlement step, under the shared caps.
    await w.say('Afterwards.', ['~ here pack.fixture/haven']);
    assert.deepEqual(Object.values(w.slice('progress').credits).map(c => c.award), [1]);
    assert.deepEqual(w.problems(), []);
});

test('the sealed bytes are immutable: a rebuild, a reload and a second fight leave them and their hash as they were', async t => {
    const w = await ready(t);
    const v = await begin(w);
    await finish(w);
    const { receipt } = w.ui('combat.end', { session: v.id });
    const { batch } = receipt.data;
    const first = JSON.stringify(resolveBatch({ id: batch.id, state: w.head() }));
    w.host.store.rebuild();
    assert.equal(JSON.stringify(resolveBatch({ id: batch.id, state: w.head() })), first);
    await w.host.st.loadChat(JSON.parse(JSON.stringify(w.host.ctx.chat)));
    assert.equal(JSON.stringify(resolveBatch({ id: batch.id, state: w.head() })), first);
    const second = await begin(w, 'More wolves.');
    await finish(w);
    const next = w.ui('combat.end', { session: second.id }).receipt.data.batch;
    assert.notEqual(next.id, batch.id);
    assert.equal(JSON.stringify(resolveBatch({ id: batch.id, state: w.head() })), first, 'the first is still the first');
    assert.deepEqual(w.problems(), []);
});

const defend = (w, v) => w.ui('combat.act', { action: { type: 'defend' }, session: v.id, board: v.board });

test('B5: an action taken back takes the actions after it with it, and nothing is put in its place; the one before it stays as it was', async t => {
    const w = await ready(t);
    const v0 = await begin(w);
    const [foe] = v0.actions.targets.enemies;
    await w.say('Round one.');
    assert.equal(form(w, view(w), S1, [{ effect: 0, targets: [foe] }, { effect: 1, targets: [foe] }]).ok, true);
    await w.say('Round two.');
    assert.equal(defend(w, view(w)).ok, true);
    await w.say('Round three.');
    assert.equal(defend(w, view(w)).ok, true);
    const ids = () => (fights(w)[v0.id]?.actions ?? []).map(action => action.id);
    const all = ids();
    assert.equal(all.length, 3);
    const first = JSON.stringify(fights(w)[v0.id].actions[0]);
    const draws = JSON.stringify(view(w).log.slice(0, 6));
    // Take back the second: the third stood on it, so it goes off too. The first is untouched, with its own draws.
    await drop(w, at(w, 'Round two.'));
    assert.deepEqual(ids(), [all[0]]);
    assert.equal(JSON.stringify(fights(w)[v0.id].actions[0]), first);
    assert.equal(JSON.stringify(view(w).log.slice(0, 6)), draws, 'the first action\'s lines are the lines it had');
    assert.ok(w.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE'), 'the third is reported off');
    // And the first: back to the opening.
    await drop(w, at(w, 'Round one.'));
    assert.deepEqual(ids(), []);
    const live = JSON.stringify(w.head().domains.combat);
    w.host.store.rebuild();
    assert.equal(JSON.stringify(w.head().domains.combat), live, 'a rebuild gives the same');
});

test('B5: the settlement is bound to the fight\'s terminal prefix: take back the blow that won it and the whole settlement goes with it', async t => {
    const w = await ready(t);
    const v = await begin(w);
    await w.say('The blows.');
    const blows = at(w, 'The blows.');
    await finish(w);
    // The next reply settles it (before it, as a system step); the settlement is whole.
    await w.say('Told.', ['~ here pack.fixture/haven']);
    assert.equal(Object.keys(w.slice('progress').batches).length, 1);
    assert.equal(Object.keys(w.slice('progress').attempts).length, 0, 'no form was used in this fight');
    const xpClaims = () => Object.keys(w.head().meta.claims).filter(key => key.startsWith('xp:combat:'));
    assert.equal(xpClaims().length, 1);
    const earned = w.q('party.actor', { id: w.pc }).earned ?? 0;
    assert.ok(earned > 0);
    await drop(w, blows);
    assert.deepEqual(w.slice('progress').batches, {}, 'no sealed result of a fight that did not end');
    assert.deepEqual(xpClaims(), [], 'and no XP');
    assert.equal(w.q('party.actor', { id: w.pc }).earned ?? 0, 0);
    assert.deepEqual(fights(w)[v.id].actions, [], 'the fight is back at its opening, waiting for the player');
    assert.equal(fights(w)[v.id].status, 'active');
    assert.deepEqual(w.slice('combat').last ?? [], []);
});

test('a companion on auto plays its class\'s forms with the engine\'s own AI, and the whole fight replays identically', async t => {
    const w = await ready(t, { companions: ['Lyra'] });
    const v = await begin(w);
    const final = await finish(w);
    assert.equal(final.status, 'won');
    const text = w.q('combat.session', {}).log.map(entry => entry.text).join('\n');
    assert.match(text, /Lyra (casts|uses) s0\d/);
    const live = JSON.stringify(fights(w)[v.id]);
    w.host.store.rebuild();
    assert.equal(JSON.stringify(fights(w)[v.id]), live);
    assert.deepEqual(JSON.stringify(view(w).log), JSON.stringify(view(w).log));
});

test('an unpinned chat fights exactly the fight it always did: v1 skills, one stream, no ruleset, no ids, no sealed result, the v1 mastery path', async t => {
    const w = await realWorld(t, { pin: false });
    await w.say('The wolves come.', ['~ time 3000', '! encounter 2 Wolf — hungry | tier: weak']);
    const [offer] = w.q('combat.offers', {});
    assert.equal(w.ui('combat.start', { offer: offer.id }).ok, true);
    const v = view(w);
    const stored = fights(w)[v.id];
    assert.equal(stored.setup.ruleset, undefined);
    assert.equal(stored.setup.draws, undefined);
    assert.ok(v.actions.skills.every(skill => skill.form === undefined));
    assert.equal(w.ui('combat.act', { action: { type: 'form', form: S0 }, session: v.id, board: v.board }).code, 'REFUSED', 'a form means nothing without a ruleset');
    await finish(w);
    const out = w.ui('combat.end', { session: v.id });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.receipt.data.batch, undefined);
    assert.ok(stored.actions.every(action => action.id === undefined));
    assert.deepEqual(w.slice('progress').attempts, {});
    assert.deepEqual(w.slice('progress').batches, {});
    assert.equal(Object.keys(w.head().meta.claims).filter(key => key.startsWith('xp:combat:')).length, 0, 'the v1 award has no claim of the pinned path');
});

test('what a fight left on a character is dated by the ending minute: a condition read at endingMinute + 10 has one round less, and a rebuild agrees', async t => {
    const w = await ready(t);
    const v = await begin(w);
    await finish(w);
    const out = w.ui('combat.end', { session: v.id });
    assert.equal(out.ok, true);
    const bytes = resolveBatch({ id: out.receipt.data.batch.id, state: w.head() }).bytes;
    const ending = bytes.endingMinute;
    assert.equal(ending, 3000, 'the fight ended at the clock\'s minute');
    const left = w.q('party.actor', { id: w.pc }).conditions.filter(entry => Number.isInteger(entry.rounds) && Number.isInteger(entry.at));
    const kept = bytes.party.find(member => member.actor === w.pc).conditions;
    assert.deepEqual(kept.map(c => c.at), kept.map(() => ending), 'the sealed records carry the same ending minute');
    for (const entry of left) {
        assert.equal(entry.at, ending);
        assert.equal(roundsLeft(entry, ending + 10), Math.max(0, entry.rounds - 1), `${entry.kind}: one round per ten minutes`);
        assert.equal(roundsLeft(entry, ending), entry.rounds);
    }
    const live = JSON.stringify(w.q('party.actor', { id: w.pc }).conditions);
    w.host.store.rebuild();
    assert.equal(JSON.stringify(w.q('party.actor', { id: w.pc }).conditions), live);
    assert.ok(DAY > 0);
});
