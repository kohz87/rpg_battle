// The slice 3 review (#143): a fight's start is guarded, a loot drop never fails the end, a summoned unit earns nothing, the foes' XP follows
// the pinned level, a settlement stands on the place its loot was registered in, units and carried strengths and sealed results keep
// their bounds, and a fight begun before the pin settles as it began. One test per finding; each fails on the code before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TIERS, realWorld } from '../progress/helpers/world.js';
import { fightPack, fightPin, ref } from '../progress/helpers/fixture.js';
import { golden, promo } from '../progress/helpers/states.js';
import { seeded } from '../integration/helpers/host.js';
import { resolveBatch } from '../../../src/v2/fight/batch.js';
import { storeBatch } from '../../../src/v2/fight/index.js';
import { boundProblems, valueCeiling } from '../../../src/v2/rules/bounds.js';
import { registrable } from '../../../src/v2/rules/items.js';
import { hashJson } from '../../../src/v2/rules/hash.js';
import { RULES_V2_CONSTANTS, RULES_V2_PROGRESSION, validateRulesPack } from '../../vendor/story-block/src/v2/packs/rules-v2.js';
import { sha256 } from '../../../src/v2/rules/hash.js';

const play = (name, fn) => test(name, t => seeded(7, async () => {
    for (const key of Object.keys(AREA_TIERS)) delete AREA_TIERS[key];
    try { await fn(t); } finally { for (const key of Object.keys(AREA_TIERS)) delete AREA_TIERS[key]; }
}));
const ready = (t, over = {}) => realWorld(t, { given: fightPin(), sd: true, ...over });
const drop = async (w, index) => { await w.host.st.deleteMessage(index); await w.host.st.deleteMessage(index - 1); };
const at = (w, text) => w.host.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
const view = w => w.q('combat.session', {});
const fights = w => w.slice('combat').fights ?? {};
const CALL = ref('s11-base');
const S0 = ref('s00-base');
const seedPromotion = w => assert.equal(w.host.bus.command('test.seed', { actor: w.pc, choices: [promo(w.pc, 10, 'c0', 'c1')] }, { cause: 'ui' }).ok, true);

async function begin(w, text = 'The wolves come.', line = '! encounter 2 Wolf — hungry | tier: weak') {
    await w.say(text, ['~ time 3000', line]);
    const [offer] = w.q('combat.offers', {});
    const out = w.ui('combat.start', { offer: offer.id });
    assert.equal(out.ok, true, out.message);
    return view(w);
}
const attack = (w, v) => w.ui('combat.act', { action: { type: 'attack', target: v.actions.targets.enemies[0] }, session: v.id, board: v.board });
async function finish(w, limit = 60) {
    for (let n = 0; n < limit; n += 1) {
        const v = view(w);
        if (v.status !== 'active') return v;
        assert.equal(attack(w, v).ok, true);
    }
    throw new Error('the fight did not end');
}
const claims = w => Object.keys(w.head().meta.claims);
const turnedOff = w => w.problems().some(problem => problem.code === 'REPLAY_PREREQUISITE');

play('R1 a fight begun with a promoted form: take the promotion back and the start goes off, with its acts and its end; no XP, no uses', async t => {
    const w = await ready(t);
    await w.say('Promotion reply.');
    seedPromotion(w);
    const v = await begin(w);
    const call = v.actions.skills.find(skill => skill.form.id === CALL);
    assert.ok(call, 'the promoted character fights with the promoted form');
    assert.equal(w.ui('combat.act', { action: { type: 'form', form: CALL, selections: [{ effect: 0, targets: [v.actions.targets.enemies[0]] }] }, session: v.id, board: v.board }).ok, true);
    await w.say('Round.');
    await finish(w);
    await drop(w, at(w, 'Promotion reply.'));
    assert.deepEqual(Object.keys(w.slice('progress').choices), [`${w.pc}|0`], 'the promotion is gone');
    assert.deepEqual(fights(w), {}, 'and the fight that stood on its forms');
    assert.ok(turnedOff(w));
    assert.deepEqual(w.slice('progress').attempts, {});
    assert.deepEqual(claims(w).filter(key => key.startsWith('xp:combat:')), []);
    assert.equal(w.q('party.actor', { id: w.pc }).earned ?? 0, 0);
    assert.equal(w.ui('combat.end', { session: v.id }).code, 'NOT_FOUND');
    const live = JSON.stringify(w.head().domains.combat);
    w.host.store.rebuild();
    assert.equal(JSON.stringify(w.head().domains.combat), live);
});

play('R1 a fight begun at a mastery: take back the narrative use that gave it and the start goes off', async t => {
    const w = await ready(t);
    await w.say('Practice.', ['~ time 3000', `! skill-use ${w.pc} | skill: ${ref('s00')} | form: ${S0}`]);
    await w.say('Settled.', ['~ time 3100']);
    const mastery = w.q('rules.progress', { actor: w.pc }).checklist.find(entry => entry.skill === ref('s00')).mastery;
    assert.ok(mastery >= 1, 'a credited use is the first step');
    const v = await begin(w, 'The wolves come.');
    const held = fights(w)[v.id].setup.party.find(c => c.memberId === w.pc).skills.find(skill => skill.formId === S0);
    assert.equal(held.formMastery, mastery);
    await drop(w, at(w, 'Practice.'));
    assert.deepEqual(fights(w), {}, 'the fight stood on a mastery that no longer exists');
    assert.ok(turnedOff(w));
});

play('R2 loot never wedges the end: at the pack\'s money scale the drops are priced in its coin and bounded in it', async t => {
    AREA_TIERS['pack.fixture/haven'] = 0;
    const w = await ready(t);
    const root = w.host.ctx.extensionSettings ?? w.host.ctx.extension_settings;
    (root.storySuite.modules ??= {})['story-block'] = { economyScale: 1000 };
    assert.equal(w.q('inventory.economy', {}).scale, 1000);
    const v = await begin(w, 'The wolves come.', '! encounter 3 Wolf — hungry | tier: weak');
    await w.say('Here.', ['~ here pack.fixture/haven']);
    await finish(w);
    const out = w.ui('combat.end', { session: v.id });
    assert.equal(out.ok, true, out.message);
    const loot = out.receipt.data.loot;
    assert.ok(loot.items.length + (loot.left?.length ?? 0) > 0, 'the fight dropped something');
    for (const [id, entry] of Object.entries(w.slice('rules').generated)) assert.ok(entry.def.value <= valueCeiling(entry.def.rarity, 10, 1000), `${id} is within the scaled ceiling`);
    assert.equal(view(w), null, 'the fight is settled: nothing wedged');
    assert.deepEqual(w.problems(), []);
});

test('R2 registrable is one question: the value ceiling is read in the chat\'s coin, equipment states its rule, an id is never redefined, a ruleset holds 1000', () => {
    const ix = golden();
    const def = (over = {}) => ({ id: 'story/pelt', name: 'Pelt', kind: 'material', rarity: 'common', value: 5000, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '', ...over });
    const rule = d => ({ def: d.id, allowedSlots: [], hands: 0, requires: {}, weight: 0, unique: false });
    const area = (scale = 1) => ({ place: 'pack.fixture/haven', tier: 0, scale });
    const ask = (d, over = {}, rules = { generated: {} }) => registrable({ ix, rules }, { def: d, rule: over.rule === undefined ? rule(d) : over.rule, template: null, area: over.area ?? area() });
    assert.equal(ask(def()).ok, false, 'worth 5000 at scale 1 is over the ceiling of tier 0');
    assert.equal(ask(def(), { area: area(1000) }).ok, true, 'and within it at scale 1000');
    assert.deepEqual(boundProblems(def({ value: 5000 }), area(1000)), []);
    assert.equal(valueCeiling('common', 10, 1000), valueCeiling('common', 10) * 1000);
    assert.equal(ask(def({ kind: 'equipment', slot: 'weapon', stack: false, value: 5 }), { rule: null }).code, 'RULES_MISMATCH');
    const held = { generated: { 'story/pelt': { def: { name: 'Pelt' }, defHash: 'x', ruleHash: 'y' } } };
    assert.equal(ask(def({ value: 5 }), {}, held).code, 'CONFLICT');
    const full = { generated: Object.fromEntries(Array.from({ length: 1000 }, (_, n) => [`story/x${n}`, { def: { name: 'X' }, defHash: 'x', ruleHash: 'y' }])) };
    assert.equal(ask(def({ value: 5 }), {}, full).code, 'REFUSED');
    const same = hashJson(def({ value: 5 }));
    assert.equal(ask(def({ value: 5 }), {}, { generated: { 'story/pelt': { def: { name: 'Pelt' }, defHash: same, ruleHash: hashJson(rule(def())) } } }).ok, true, 'the same definition again is a no-op');
});

play('R3 a summoned unit earns no mastery: its use is in neither the batch nor the ledger', async t => {
    const w = await ready(t);
    seedPromotion(w);
    const v = await begin(w);
    assert.equal(w.ui('combat.act', { action: { type: 'form', form: CALL, selections: [{ effect: 0, targets: [v.actions.targets.enemies[0]] }] }, session: v.id, board: v.board }).ok, true);
    await finish(w);
    const end = w.ui('combat.end', { session: v.id });
    assert.equal(end.ok, true, end.message);
    const bytes = resolveBatch({ id: end.receipt.data.batch.id, state: w.head() }).bytes;
    assert.ok(Object.keys(w.slice('progress').temporary).length > 0, 'the unit was called');
    assert.deepEqual(bytes.uses.map(use => use.actor), [w.pc, ...bytes.uses.slice(1).map(use => use.actor)].filter(actor => actor === w.pc));
    assert.ok(bytes.uses.every(use => use.actor === w.pc));
    assert.ok(bytes.party.every(member => member.actor === w.pc));
    assert.ok(Object.values(w.slice('progress').attempts).every(attempt => attempt.actor === w.pc));
});

const pinXp = xpPerLevel => {
    const checked = validateRulesPack(fightPack(), { constants: { ...RULES_V2_CONSTANTS, xpPerLevel } });
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors).slice(0, 300));
    return Object.freeze({ resolved: checked.resolved, rulesHash: checked.rulesHash, progression: RULES_V2_PROGRESSION, packKey: 'fixture', packVersion: '2.0.0', packHash: checked.packHash, constantsHash: sha256(JSON.stringify(checked.resolved.constants)) });
};

play('R4 the foes\' XP is a share of the pinned level: five times the xpPerLevel, five times the XP; a v1 fight has no xpBase', async t => {
    const won = async xpPerLevel => {
        const w = await realWorld(t, { given: pinXp(xpPerLevel), sd: true });
        const v = await begin(w);
        assert.equal(fights(w)[v.id].setup.xpBase, xpPerLevel);
        await finish(w);
        const out = w.ui('combat.end', { session: v.id });
        assert.equal(out.ok, true, out.message);
        return out.receipt.data.xp[w.pc];
    };
    const small = await won(100);
    const big = await won(500);
    assert.ok(small > 0);
    assert.ok(Math.abs(big - 5 * small) <= 5, `${big} is five times ${small}`);
    const plain = await realWorld(t, { pin: false });
    await plain.say('Wolves.', ['~ time 3000', '! encounter 2 Wolf — hungry | tier: weak']);
    assert.equal(plain.ui('combat.start', { offer: plain.q('combat.offers', {})[0].id }).ok, true);
    assert.equal(Object.values(fights(plain))[0].setup.xpBase, undefined);
});

play('R5 the end stands on the place its loot was registered in: take back the reply that set the place and the registered loot goes with it', async t => {
    AREA_TIERS['pack.fixture/haven'] = 4;
    const w = await ready(t);
    await w.say('Arrive.', ['~ here pack.fixture/haven']);
    const v = await begin(w, 'The wolves come.', '! encounter 3 Wolf — hungry | tier: weak');
    await finish(w);
    const out = w.ui('combat.end', { session: v.id });
    assert.equal(out.ok, true, out.message);
    assert.ok(out.receipt.data.loot.items.length > 0 && Object.keys(w.slice('rules').generated).length > 0, 'loot was registered');
    await drop(w, at(w, 'Arrive.'));
    assert.deepEqual(w.slice('rules').generated, {}, 'the registrations went with the place');
    assert.deepEqual(w.slice('progress').batches, {});
    assert.deepEqual(claims(w).filter(key => key.startsWith('xp:combat:')), []);
    assert.ok(turnedOff(w));
});

play('summon.begin counts the units that stand (the fight says how many), and makes room for the oldest called, not the lowest id', async t => {
    const w = await ready(t);
    await w.say('Start.');
    const unit = (n, born, over = {}) => ({ id: `ac_${n.toString(36).padStart(8, '0')}`, born, sheet: false, ...over });
    // 24 narrative presences; the lowest ids are the newest.
    for (let n = 0; n < 24; n += 1) assert.equal(w.host.bus.command('test.unit', unit(n, 100 - n), { cause: 'ui' }).ok, true);
    const payload = (n, standing) => ({ actor: `ac_${(900 + n).toString(36).padStart(8, '0')}`, owner: w.pc, kind: 'summon', template: ref('c0'), fight: 'fi_00000001', name: 'Wolf', level: 3, standing, hp: { cur: 5, max: 5 }, mp: { cur: 0, max: 0 }, sp: { cur: 1, max: 1 } });
    const begin1 = w.host.bus.command('test.begin', payload(1, 1), { cause: 'ui' });
    assert.equal(begin1.ok, true, begin1.message);
    const left = Object.keys(w.slice('progress').temporary);
    assert.equal(left.length, 24);
    assert.ok(!left.includes(`ac_${(23).toString(36).padStart(8, '0')}`), 'the oldest (born 77, the highest id) went');
    assert.ok(left.includes(`ac_${(0).toString(36).padStart(8, '0')}`), 'the newest (the lowest id) stayed');
    // Seven standing is over the limit; six, with any number of records of units that went down, is not.
    assert.equal(w.host.bus.command('test.begin', payload(2, 7), { cause: 'ui' }).code, 'REFUSED');
    assert.equal(w.host.bus.command('test.begin', payload(3, 6), { cause: 'ui' }).ok, true);
    assert.equal(w.host.bus.command('test.begin', { ...payload(4, 1), standing: undefined }, { cause: 'ui' }).code, 'INVALID');
    assert.deepEqual(w.problems(), []);
});

play('a fight begun before the pin settles as it began: its uses go the v1 way and its XP has no claim, though the chat is pinned now', async t => {
    const w = await realWorld(t, { pin: false, given: fightPin(), sd: true });
    const v = await begin(w);
    assert.equal(fights(w)[v.id].setup.draws, undefined);
    assert.equal(w.host.bus.command('test.pin', {}, { cause: 'ui' }).ok, true);
    await finish(w);
    const out = w.ui('combat.end', { session: v.id });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.receipt.data.batch, undefined);
    assert.deepEqual(claims(w).filter(key => key.startsWith('xp:combat:')), []);
    assert.deepEqual(w.slice('progress').attempts, {});
    assert.deepEqual(w.slice('progress').batches, {});
    assert.ok((w.q('party.actor', { id: w.pc }).earned ?? 0) > 0, 'the XP is the v1 award');
});

play('a v1 action keeps only what v1 keeps: an id, a form or selections a caller sent are not stored; a form means nothing', async t => {
    const w = await realWorld(t, { pin: false });
    await w.say('Wolves.', ['~ time 3000', '! encounter 2 Wolf — hungry | tier: weak']);
    assert.equal(w.ui('combat.start', { offer: w.q('combat.offers', {})[0].id }).ok, true);
    const v = view(w);
    const target = v.actions.targets.enemies[0];
    const out = w.ui('combat.act', { action: { type: 'attack', target, id: 'ca_zzzzzzzz', form: 'pack.x/y', selections: [{ effect: 0, targets: [target] }] }, session: v.id, board: v.board });
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(Object.values(fights(w))[0].actions, [{ type: 'attack', target }]);
    assert.equal(w.ui('combat.act', { action: { type: 'form', form: S0 }, session: v.id, board: view(w).board }).code, 'REFUSED');
});

play('a strength carried out of a fight is kept per member and replaced at each end; the next fight starts with it', async t => {
    const w = await ready(t);
    seedPromotion(w);
    const REGEN = ref('s12-base');
    const v = await begin(w);
    const regen = v.actions.skills.find(skill => skill.form.id === REGEN);
    assert.ok(regen, 'the promoted character holds the regeneration form');
    assert.equal(w.ui('combat.act', { action: { type: 'form', form: REGEN, selections: [] }, session: v.id, board: v.board }).ok, true);
    await finish(w);
    const end = w.ui('combat.end', { session: v.id });
    assert.equal(end.ok, true, end.message);
    const carried = w.slice('progress').carried[w.pc];
    const held = w.q('party.actor', { id: w.pc }).conditions.find(cond => cond.kind === 'regenerating');
    if (held) {
        assert.ok(carried?.some(item => item.kind === 'regenerating' && item.strength > 0), 'its strength is carried');
        await w.say('Later.', []);
        const next = await begin(w, 'More wolves.');
        const power = fights(w)[next.id].setup.party.find(c => c.memberId === w.pc).conditions.find(cond => cond.name === 'regen').power;
        assert.equal(power, carried.find(item => item.kind === 'regenerating').strength);
    } else {
        assert.equal(carried, undefined, 'nothing carried when nothing was left on the character');
    }
    assert.deepEqual(w.problems(), []);
});

play('a sealed result is never written over, and a result of another kind is not pruned with the fights\'', () => {
    const draft = { batches: {} };
    const ctx = { draft: () => draft, fail(code, message) { throw Object.assign(new Error(message), { code }); } };
    const sealed = kind => ({ hash: 'a'.repeat(64), bytes: { kind } });
    storeBatch(ctx, 'br_00000000', sealed('death'));
    for (let n = 1; n <= 12; n += 1) storeBatch(ctx, `br_${n.toString(36).padStart(8, '0')}`, sealed('fight'));
    const kinds = Object.values(draft.batches).map(entry => entry.bytes.kind);
    assert.equal(kinds.filter(kind => kind === 'fight').length, 8);
    assert.equal(kinds.filter(kind => kind === 'death').length, 1, 'a death result is kept');
    assert.throws(() => storeBatch(ctx, 'br_00000000', sealed('fight')), { code: 'CONFLICT' });
});

play('what stayed behind is told apart: weight is v1\'s sentence; what the rules cannot register here has its own, with what to set when no tier is known', async t => {
    const w = await ready(t);
    const v = await begin(w, 'The wolves come.', '! encounter 3 Wolf — hungry | tier: weak');
    await finish(w);
    const out = w.ui('combat.end', { session: v.id });
    assert.equal(out.ok, true, out.message);
    const { left } = out.receipt.data.loot;
    assert.ok(left.length > 0 && left.every(row => row.reason === 'held' && row.cause === 'no-tier'));
    assert.match(out.receipt.summary, /Couldn't be kept here: .*\(set the area's danger to keep loot like this\)/);
    assert.doesNotMatch(out.receipt.summary, /too heavy/);
    const parts = w.q('combat.last', {}).parts;
    assert.ok(parts.notes.some(note => /kept here/.test(note)));
});
