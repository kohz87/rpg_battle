import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, makeRules } from '../src/rules.js';
import { buildHandoff, buildPlanHandoff, HANDOFF_HEADER } from '../src/handoff.js';
import { newPlan, planResult } from '../src/plan.js';

const COINS = DEFAULT_RULES.currency;

function result(overrides = {}) {
    return {
        outcome: 'victory', rounds: 4, seconds: 24, stakes: 'normal',
        party: [
            { memberId: 'pc', name: 'Ren', hp: { cur: 34, max: 62 }, mp: { cur: 12, max: 30 }, down: false, conditions: [] },
            { memberId: 'astra', name: 'Astra', hp: { cur: 44, max: 44 }, mp: { cur: 20, max: 38 }, down: false, conditions: [] },
        ],
        enemies: [
            { id: 'e1', name: 'Goblin', gone: 'down', xp: 35, level: 3, rank: 'E' },
            { id: 'e2', name: 'Goblin', gone: 'fled', xp: 35, level: 3, rank: 'E' },
            { id: 'e3', name: 'Goblin Shaman', gone: 'down', xp: 35, level: 3, rank: 'E' },
        ],
        defeated: ['Goblin', 'Goblin Shaman'], fled: [], parleyed: [],
        xp: { pc: 38, astra: 38 },
        loot: { items: [{ name: 'Bone Fetish', qty: 1, rarity: 'common', kind: 'material' }], money: 14 },
        keyMoments: [
            'the shaman\'s hex missed Ren',
            'Ren\'s Rending Strike crit the second goblin.',
            'Astra\'s Ember Lance finished the shaman',
            'one goblin fled toward the weir',
        ],
        uses: {}, itemsUsed: {},
        ...overrides,
    };
}

test('a victory reads as DESIGN §8.2', () => {
    const text = buildHandoff(result(), { currency: COINS, stakes: 'normal', pcName: 'Ren' });
    assert.equal(text, [
        HANDOFF_HEADER,
        'Victory in 4 rounds (about 24 seconds).',
        'Ren: HP 34/62, MP 12/30 — hurt (aching, favouring a wound) · tired of magic.',
        'Astra: HP 44/44, MP 20/38 — unhurt · tired of magic.',
        'Key moments: the shaman\'s hex missed Ren; Ren\'s Rending Strike crit the second goblin; Astra\'s Ember',
        'Lance finished the shaman; one goblin fled toward the weir.',
        'Foes defeated: Goblin, Goblin Shaman.',
        'Loot: 1 silver, 4 copper, a bone fetish. XP +38 each.',
    ].join('\n'));
    assert.equal(HANDOFF_HEADER, '[Battle resolved by RPG Battle: narrate this outcome, do not change it]');
    assert.ok(text.split(/\s+/).length <= 120);
});

test('defeat lines follow the stakes and carry no loot or XP', () => {
    const normal = buildHandoff(result({ outcome: 'defeat' }), { currency: COINS, stakes: 'normal', pcName: 'Ren' });
    assert.match(normal, /^Defeated: the story decides what follows \(captured, robbed, left for dead\)\.$/m);
    assert.doesNotMatch(normal, /Loot|XP/);
    const death = buildHandoff(result({ outcome: 'defeat', stakes: 'death' }), { currency: COINS, pcName: 'Ren' });
    assert.equal(death.split('\n')[1], 'Defeated: Ren is killed. Ren is dead and does not come back; narrate the death, not a rescue.');
    const named = buildHandoff(result({ outcome: 'defeat' }), { stakes: 'death' });
    assert.equal(named.split('\n')[1], 'Defeated: Ren is killed. Ren is dead and does not come back; narrate the death, not a rescue.', 'the hero defaults to the pc entry');
});

test('an escape, down members, conditions, fled and parleyed enemies', () => {
    const text = buildHandoff(result({
        outcome: 'fled', rounds: 1,
        party: [
            { memberId: 'pc', name: 'Ren', hp: { cur: 5, max: 62 }, mp: { cur: 0, max: 30 }, down: false, conditions: [{ name: 'poison', rounds: 2 }] },
            { memberId: 'astra', name: 'Astra', hp: { cur: 0, max: 44 }, mp: { cur: 3, max: 38 }, down: true, conditions: [] },
        ],
        fled: ['Wolf', 'Wolf'], parleyed: ['Bandit Captain'], keyMoments: [],
    }), { currency: COINS, pcName: 'Ren', names: { astra: 'Astra the Bright' } });
    assert.equal(text, [
        HANDOFF_HEADER,
        'Escaped after 1 round.',
        'Ren: HP 5/62, MP 0/30 — barely standing (staggering, could fall at any moment) · drained of magic · poisoned.',
        'Astra the Bright: down (unconscious or unable to fight).',
        'Foes defeated: Goblin, Goblin Shaman. Stood down after parley: Bandit Captain. Fled: Wolf ×2.',
    ].join('\n'));
});

test('loot and XP wording', () => {
    const uneven = buildHandoff(result({
        xp: { pc: 40, astra: 30 },
        loot: { items: [{ name: 'Ashwood Staff', qty: 1, rarity: 'rare' }, { name: 'Healing Draught', qty: 2 }, { name: 'Iron Key', qty: 1 }], money: 0 },
    }), { currency: COINS });
    assert.match(uneven, /^Loot: a rare ashwood staff, healing draught ×2, an iron key\. XP: Ren \+40, Astra \+30\.$/m);
    const solo = buildHandoff(result({ party: [result().party[0]], xp: { pc: 38 }, loot: { items: [], money: 0 } }), { currency: COINS });
    assert.match(solo, /^Loot: nothing\. XP \+38\.$/m);
    const single = buildHandoff(result(), { currency: { mode: 'single', single: 'credits' } });
    assert.match(single, /^Loot: 14 credits, a bone fetish\./m);
    const long = buildHandoff(result({ rounds: 30, seconds: 180 }), { currency: COINS });
    assert.equal(long.split('\n')[1], 'Victory in 30 rounds (about 3 minutes).');
});

test('key moments are capped at six and a busy fight stays short', () => {
    const moments = Array.from({ length: 9 }, (_, i) => `moment number ${i + 1} happened to someone`);
    const text = buildHandoff(result({ keyMoments: moments, fled: ['Goblin'] }), { currency: COINS });
    assert.match(text, /moment number 6/);
    assert.doesNotMatch(text, /moment number 7/);
    assert.ok(text.split('\n').every(line => line.length <= 110));
    assert.ok(text.split(/\s+/).length <= 120, `${text.split(/\s+/).length} words`);
});

test('the status lines use the state-word bands from the rules', () => {
    const party = [{ memberId: 'pc', name: 'Ren', hp: { cur: 50, max: 62 }, mp: { cur: 30, max: 30 }, down: false, conditions: [{ name: 'exhausted', rounds: null }] }];
    const plain = buildHandoff(result({ party }), { currency: COINS });
    assert.equal(plain.split('\n')[2], 'Ren: HP 50/62, MP 30/30 — bruised · exhausted.');
    const grim = makeRules({ narrative: { hpBands: [[1, 'unhurt'], [0.5, 'wounded']] } });
    assert.equal(buildHandoff(result({ party }), { currency: COINS, rules: grim }).split('\n')[2], 'Ren: HP 50/62, MP 30/30 — wounded · exhausted.');
});

test('the XP line speaks the reader\'s terms: a name of their own, XP with tiers too (0.5.2)', () => {
    const power = makeRules({ terms: { levelName: 'Soul Power', xpName: 'Power Growth' } });
    assert.match(buildHandoff(result(), { currency: COINS, rules: power }), /Loot: .*\. Power Growth \+38 each\.$/m);
    const soul = makeRules({ terms: { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' } } });
    const leveled = result({
        xp: { pc: 30, astra: 30 },
        party: result().party.map(member => ({ ...member, level: 4 })),
    });
    assert.match(buildHandoff(leveled, { currency: COINS, rules: soul }), /Soul Growth \+30 each\.$/m);
    // Someone at the cap gains nothing and is left out.
    const mixed = result({ xp: { pc: 30, astra: 30 }, party: [{ ...result().party[0], level: 4 }, { ...result().party[1], level: 99 }] });
    assert.match(buildHandoff(mixed, { currency: COINS, rules: soul }), /Soul Growth \+30\.$/m);
    assert.match(buildHandoff(result(), { currency: COINS }), /XP \+38 each\.$/m, 'plain terms as before');
});

// ---------------------------------------------------------------------------
// Where a waiting hand-off stands (0.4.2)

test('handoffState: none, waiting, narrating while its reply is generated, narrated once it is there', async () => {
    const { handoffState } = await import('../src/handoff.js');
    const user = { mes: 'go', is_user: true };
    const reply = { mes: 'They fight.', is_user: false };
    const pending = attachedTo => ({ handoff: 'Victory.', fightId: 'f1', attachedTo });
    assert.equal(handoffState(null, [user]), 'none');
    assert.equal(handoffState({ handoff: '', attachedTo: null }, [user]), 'none');
    assert.equal(handoffState(pending(null), [user]), 'waiting');
    assert.equal(handoffState(pending(undefined), [user]), 'waiting');
    // Given to reply 1, which is being generated.
    assert.equal(handoffState(pending(1), [user], { generating: true }), 'narrating');
    assert.equal(handoffState(pending(1), [user, reply]), 'narrated');
    assert.equal(handoffState(pending(1), [user, reply, user, reply]), 'narrated', 'moved past it');
    // The narrating reply deleted (nothing being generated): it waits again.
    assert.equal(handoffState(pending(1), [user]), 'waiting');
    assert.equal(handoffState(pending(1), [user, user]), 'waiting', 'a user message is no narration');
});

test('settleHandoff: spent once a newer reply exists, waiting again when its reply is gone, else kept', async () => {
    const { settleHandoff } = await import('../src/handoff.js');
    const user = { mes: 'go', is_user: true };
    const reply = { mes: 'They fight.', is_user: false };
    const at = attachedTo => ({ handoff: 'Victory.', fightId: 'f1', attachedTo });
    assert.deepEqual(settleHandoff(at(null), [user]), at(null));
    assert.deepEqual(settleHandoff(at(1), [user], { generating: true }), at(1), 'being narrated: kept');
    assert.deepEqual(settleHandoff(at(1), [user, reply]), at(1), 'narrated: kept, so its swipes narrate the same result');
    assert.deepEqual(settleHandoff(at(1), [user, reply, user]), at(1), 'a user message after it is no newer reply');
    assert.equal(settleHandoff(at(1), [user, reply, user, reply]), null, 'a newer reply: spent');
    assert.deepEqual(settleHandoff(at(1), [user]), at(null), 'its reply deleted: waiting again');
    assert.deepEqual(settleHandoff(at(3), [user]), at(null));
    assert.equal(settleHandoff(null, [user]), null);
});

// ---------------------------------------------------------------------------
// A fight belongs to the reply it started from (0.4.3)

test('fightOrigin and originHolds: deleted, swiped away or replaced, the origin no longer holds', async () => {
    const { fightOrigin, originHolds } = await import('../src/handoff.js');
    const greeting = { mes: 'Hi.', is_user: false, send_date: 'd0', swipe_id: 0 };
    const user = { mes: 'go', is_user: true, send_date: 'd1' };
    const offer = { mes: 'Wolves!', is_user: false, send_date: 'd2', swipe_id: 1 };
    const chat = [greeting, user, offer];
    const origin = fightOrigin(chat, 2);
    assert.deepEqual(origin, { index: 2, date: 'd2', swipe: 1 });
    assert.equal(fightOrigin(chat, -1), null);
    assert.equal(fightOrigin(chat, 7), null);
    assert.deepEqual(fightOrigin([{ mes: 'x', is_user: false }], 0), { index: 0, date: '', swipe: 0 });
    assert.equal(originHolds(origin, chat), true);
    assert.equal(originHolds(origin, [...chat, user, { mes: 'after', is_user: false, send_date: 'd4' }]), true, 'later messages do not matter');
    assert.equal(originHolds(origin, [greeting, user, { ...offer, mes: 'Wolves! (edited)' }]), true, 'an edit keeps it');
    assert.equal(originHolds(origin, [greeting, user]), false, 'deleted');
    assert.equal(originHolds(origin, [greeting, user, { ...offer, swipe_id: 2, send_date: 'd5' }]), false, 'swiped to another version');
    assert.equal(originHolds(origin, [greeting, user, { ...offer, swipe_id: 1, send_date: 'd9' }]), false, 'a new reply in its place');
    assert.equal(originHolds(origin, [greeting, user, user]), false, 'a user message in its place');
    assert.equal(originHolds({ index: 2 }, [greeting, user, { mes: 'any', is_user: false }]), true, 'an older chat checks only that a reply is there');
    assert.equal(originHolds({ index: 2 }, [greeting, user]), false);
    assert.equal(originHolds(null, []), true);
});

test('a result whose fight reply is gone is none and settles to nothing', async () => {
    const { handoffState, settleHandoff } = await import('../src/handoff.js');
    const offer = { mes: 'Wolves!', is_user: false, send_date: 'd2', swipe_id: 0 };
    const user = { mes: 'go', is_user: true };
    const reply = { mes: 'They fight.', is_user: false, send_date: 'd4' };
    const pending = { handoff: 'Victory.', fightId: 'f1', attachedTo: 2, origin: { index: 0, date: 'd2', swipe: 0 } };
    assert.equal(handoffState(pending, [offer, user, reply]), 'narrated');
    assert.deepEqual(settleHandoff(pending, [offer, user, reply]), pending, 'a swipe of the narration narrates it again');
    assert.equal(handoffState(pending, [{ ...offer, swipe_id: 1, send_date: 'd8' }, user]), 'none', 'the fight reply swiped away');
    assert.equal(settleHandoff(pending, [{ ...offer, swipe_id: 1, send_date: 'd8' }, user]), null);
    assert.equal(settleHandoff(pending, []), null, 'deleted back past the fight');
});

// ---------------------------------------------------------------------------
// A plan's hand-off (0.5)

const PLAN_STAGES = [
    { place: 'the gate', rows: [{ name: 'Guard', count: 2, stage: 1 }] },
    { place: 'the yard', rows: [{ name: 'Guard', count: 3, stage: 2 }] },
    { place: 'the tower', rows: [{ name: 'Guard Captain', count: 1, boss: true, stage: 3 }] },
];
const planOf = (outcomes, { stakes = 'normal', stages = PLAN_STAGES } = {}) => ({
    ...newPlan({ id: 'plan-1', stakes, stages }),
    done: outcomes.map((outcome, index) => ({ place: stages[index].place, result: result({ outcome, rounds: 3 + index, keyMoments: [`moment ${index + 1}`], loot: outcome === 'victory' ? { items: [], money: 7 } : { items: [], money: 0 } }) })),
});

test('a plan won: a line per stage, the end state, the loot and XP of every stage', () => {
    const text = buildPlanHandoff(planResult(planOf(['victory', 'victory', 'victory']), 'victory'), { currency: COINS, pcName: 'Ren' });
    assert.equal(text, [
        HANDOFF_HEADER,
        'Stage 1, the gate: victory in 3 rounds.',
        'Stage 2, the yard: victory in 4 rounds.',
        'Stage 3, the tower: victory in 5 rounds.',
        'Ren: HP 34/62, MP 12/30 — hurt (aching, favouring a wound) · tired of magic.',
        'Astra: HP 44/44, MP 20/38 — unhurt · tired of magic.',
        'Key moments: moment 1; moment 2; moment 3.',
        'Foes defeated: Goblin ×3, Goblin Shaman ×3.',
        'Loot: 2 silver, 1 copper. XP +114 each.',
    ].join('\n'));
});

test('a plan lost at stage 2: defeated there, the stage after not reached and not to be narrated', () => {
    const text = buildPlanHandoff(planResult(planOf(['victory', 'defeat']), 'defeat'), { currency: COINS, pcName: 'Ren' });
    const lines = text.split('\n');
    assert.deepEqual(lines.slice(0, 4), [
        HANDOFF_HEADER,
        'Stage 1, the gate: victory in 3 rounds.',
        'Stage 2, the yard: defeated — the story decides what follows (captured, robbed, left for dead).',
        'Not reached: the tower. Do not narrate it.',
    ]);
    assert.match(text, /^Loot: 7 copper\. XP \+76 each\.$/m, 'what stage 1 gave is kept');
    // To the death: the same words as a fight lost to the death.
    const death = buildPlanHandoff(planResult(planOf(['victory', 'defeat'], { stakes: 'death' }), 'defeat'), { currency: COINS, pcName: 'Ren' });
    assert.equal(death.split('\n')[2], 'Stage 2, the yard: defeated — Ren is killed. Ren is dead and does not come back; narrate the death, not a rescue.');
});

test('a plan fled at stage 2, and one fallen back from after stage 1', () => {
    const fled = buildPlanHandoff(planResult(planOf(['victory', 'fled']), 'fled'), { currency: COINS, pcName: 'Ren' }).split('\n');
    assert.deepEqual(fled.slice(1, 4), ['Stage 1, the gate: victory in 3 rounds.', 'Stage 2, the yard: escaped after 4 rounds.', 'Not reached: the tower. Do not narrate it.']);
    const back = buildPlanHandoff(planResult(planOf(['victory']), 'withdrew'), { currency: COINS, pcName: 'Ren' });
    assert.deepEqual(back.split('\n').slice(0, 3), [HANDOFF_HEADER, 'Stage 1, the gate: victory in 3 rounds.', 'Fell back after the gate; the yard and the tower were not attempted.']);
    assert.doesNotMatch(back, /Not reached/);
    // Unnamed stages are numbered; two stages not reached are "them".
    const plain = PLAN_STAGES.map(stage => ({ ...stage, place: null }));
    const lost = buildPlanHandoff(planResult(planOf(['defeat'], { stages: plain }), 'defeat'), { currency: COINS, pcName: 'Ren' }).split('\n');
    assert.deepEqual(lost.slice(1, 3), ['Stage 1: defeated — the story decides what follows (captured, robbed, left for dead).', 'Not reached: stage 2, stage 3. Do not narrate them.']);
    assert.doesNotMatch(lost.join('\n'), /Loot/, 'nothing won, no loot line');
    const early = buildPlanHandoff(planResult(planOf(['victory'], { stages: plain }), 'withdrew'), { currency: COINS, pcName: 'Ren' }).split('\n');
    assert.equal(early[2], 'Fell back after stage 1; stage 2 and stage 3 were not attempted.');
});

test('a plan\'s hand-off stays short: about one line more per stage than a fight\'s', () => {
    const one = buildHandoff(result(), { currency: COINS, pcName: 'Ren' });
    const three = buildPlanHandoff(planResult(planOf(['victory', 'victory', 'defeat']), 'defeat'), { currency: COINS, pcName: 'Ren' });
    assert.ok(three.split('\n').length <= one.split('\n').length + 3, three);
    assert.ok(three.split(/\s+/).length <= 140);
});

test('how many foes fell is said outright, the fight\'s letters dropped (0.5.8)', () => {
    const text = buildHandoff(result({
        defeated: ['Timber Wolf A', 'Timber Wolf B', 'Timber Wolf C', 'Timber Wolf D'],
        keyMoments: ['Wessel\'s Cane Draw cut down Timber Wolf A', 'Timber Wolf B went down under the cart'],
        fled: [],
    }), { currency: COINS, pcName: 'Wessel' });
    assert.match(text, /^Foes defeated: Timber Wolf ×4\.$/m);
    const fled = buildHandoff(result({ defeated: ['Timber Wolf A'], fled: ['Timber Wolf B', 'Timber Wolf C'] }), { currency: COINS, pcName: 'Wessel' });
    assert.match(fled, /^Foes defeated: Timber Wolf\. Fled: Timber Wolf ×2\.$/m);
    assert.doesNotMatch(buildHandoff(result({ defeated: [] }), { currency: COINS, pcName: 'Wessel' }), /Foes defeated/);
});
