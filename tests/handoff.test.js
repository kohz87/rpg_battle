import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, makeRules } from '../src/rules.js';
import { buildHandoff, HANDOFF_HEADER } from '../src/handoff.js';

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
        'Stood down after parley: Bandit Captain. Fled: Wolf ×2.',
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

test('the XP line speaks the reader\'s terms: a name of their own, or the share of the tier', async () => {
    const { xpToNext } = await import('../src/rules.js');
    const power = makeRules({ terms: { levelName: 'Soul Power', xpName: 'Power Growth' } });
    assert.match(buildHandoff(result(), { currency: COINS, rules: power }), /Loot: .*\. Power Growth \+38 each\.$/m);
    const soul = makeRules({ terms: { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' } } });
    let span = 0;
    for (let level = 1; level <= 10; level++) span += xpToNext(level, DEFAULT_RULES);
    const gain = Math.round(span * 0.12);
    const leveled = result({
        xp: { pc: gain, astra: gain },
        party: result().party.map(member => ({ ...member, level: 4 })),
    });
    assert.match(buildHandoff(leveled, { currency: COINS, rules: soul }), /Soul Growth \+12% each\.$/m);
    // Different tiers make different shares; someone at the cap gains nothing and is left out.
    const mixed = result({ xp: { pc: gain, astra: gain }, party: [{ ...result().party[0], level: 4 }, { ...result().party[1], level: 99 }] });
    assert.match(buildHandoff(mixed, { currency: COINS, rules: soul }), /Soul Growth \+12%\.$/m);
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
