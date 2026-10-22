// FUZZ_DELETE (b1-capture r2): seeded replies with RPG Battle's change lines and clicks, and now and
// then the reader deletes an earlier exchange from the middle of the chat. After every step the
// head rebuilt from the chat equals the live head, and no block of valid input is skipped on
// replay (store.problems()). Bookkeeping later replies write must be keyed by the reply (or an id),
// add-only, never a list position or a field of an object an earlier reply made (SPEC §2).
// A few seeds run in `npm test`; FUZZ_DELETE_SEEDS=<n> FUZZ_DELETE_REPLIES=<n> run more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from '../integration/helpers/host.js';

const SEEDS = Number(process.env.FUZZ_DELETE_SEEDS) || 4;
const REPLIES = Number(process.env.FUZZ_DELETE_REPLIES) || 18;

/** mulberry32 */
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

const PLACES = ['Bluewatch Village', 'Constructor', 'Old Weir', 'Mill Town'];
const SKILLS = ['stealth', 'athletics', 'STR', 'perception', 'persuasion'];
const FOES = ['Wolf', 'Giant Rat', 'Bandit'];
const GOODS = ['Wolf Pelt', 'Rope', 'Minor Healing Draught', 'Iron Ore', 'Repair Kit'];
const EFFECTS = ['Keen Sight', 'Shaken', 'Warmth'];
const PIECES = ['Chain Shirt', 'Iron Sword'];

// Stands in for Story Block's route of `~ item X | wear: tear` to item.wear (gear wear, TRS idea 1).
const WEAR_ROUTE = {
    id: 'fuzz-wear-route',
    name: 'fuzz wear route',
    version: '0.0.0',
    capture: {
        kinds: { testwear: { grammar: '~ testwear <piece> | wear: scuff|tear|ruin' } },
        apply: (ctx, line) => ctx.call('item.wear', { name: line.name, wear: line.labels?.wear ?? '', story: true }),
    },
};

/** One reply's change lines: valid input only. */
function lines(r, n) {
    const out = [];
    const count = r.int(1, 4);
    for (let i = 0; i < count; i += 1) {
        const kind = r.pick(['check', 'check', 'place', 'market', 'lift', 'item', 'coin', 'encounter', 'join', 'skill', 'effect', 'effect', 'unbuff', 'ranked', 'wear', 'wear', 'kit', 'repair', 'refine']);
        if (kind === 'check') out.push(`? check ${r.pick(SKILLS)} — try ${n}.${i} | dc: ${r.pick(['easy', 'normal', 'hard'])} | roll: ${r.int(1, 2)} | result: ${r.pick(['success', 'fail'])}`);
        if (kind === 'place') out.push(`~ place ${r.pick(PLACES)} | kind: settlement`);
        if (kind === 'market') out.push(`! market ${r.pick(PLACES)} — short of bread ${n}`);
        if (kind === 'lift') out.push(`~ market ${r.pick(PLACES)} — supplies back`);
        if (kind === 'item') out.push(`+ item ${r.pick(GOODS)} | qty: ${r.int(1, 3)}`);
        if (kind === 'coin') out.push(`+ coin ${r.int(1, 20)}`);
        if (kind === 'encounter') out.push(`! encounter ${r.int(1, 2)} ${r.pick(FOES)} — on the road | tier: ${r.pick(['trivial', 'weak'])}`);
        if (kind === 'join') out.push(`+ join ${r.pick(['Lyra', 'Bram', 'Odo'])} — a traveller | role: ranger`);
        if (kind === 'skill') out.push(`+ skill Ren — Tide Cut ${n}: a cold cut | taught by: Lyra`);
        // Timed effects (rpg-battle.effects): made, renewed by name, ended early, and pruned by key when over.
        if (kind === 'effect') out.push(`+ effect ${r.pick(EFFECTS)} — ${n} | on: ${r.pick(['perception', 'stealth', 'attack', 'all checks', 'DEX'])} | for: ${r.pick(['1 reply', '2 replies', '3 replies'])}${r.chance(0.3) ? ' | kind: debuff' : ''}`);
        if (kind === 'unbuff') out.push(`- effect ${r.pick(EFFECTS)}`);
        // A foe of an absolute rank (F91).
        if (kind === 'ranked') out.push(`! encounter 1 ${r.pick(FOES)} — on the road | rank: ${r.pick(['F', 'E'])}`);
        if (kind === 'wear') out.push(`~ testwear ${r.pick(PIECES)} | wear: ${r.pick(['scuff', 'tear', 'ruin'])}`);
        if (kind === 'kit') out.push(`! use Repair Kit | on: ${r.pick([...PIECES, 'Ren'])}`);
        if (kind === 'repair') out.push(`! repair ${r.pick(PIECES)} | at: ${r.pick(['smith', 'tailor'])}`);
        if (kind === 'refine') out.push(`! refine ${r.pick(PIECES)} | at: smith`);
    }
    // At most 2 checks count in a reply; the third would be a Problem by design, not a replay skip.
    let checks = 0;
    return out.filter(line => !line.startsWith('? check') || (checks += 1) <= 2);
}

/** A few clicks after a reply: take or turn down an offer, buy or sell, fight a little. */
async function clicks(host, r) {
    const offers = host.q('party.offers') ?? [];
    if (offers.length && r.chance(0.5)) await host.cmd(r.chance(0.7) ? 'party.acceptOffer' : 'party.dismissOffer', { offer: offers[0].id });
    const fights = host.q('combat.offers') ?? [];
    const session = host.q('combat.session');
    if (!session && fights.length && r.chance(0.5)) await host.cmd('combat.start', { offer: r.pick(fights).id });
    const now = host.q('combat.session');
    if (now?.status === 'active') {
        for (let n = 0; n < r.int(1, 6) && host.q('combat.session')?.status === 'active'; n += 1) await host.cmd('combat.act', { action: { type: 'auto' } });
    }
    if (now && now.status !== 'active' && r.chance(0.8)) await host.cmd('combat.end');
    if (r.chance(0.4)) {
        const stock = host.q('trade.stock', { kind: 'general' });
        const item = stock?.items?.[0];
        if (item) await host.cmd('trade.buy', { def: item.def.id, qty: 1, kind: 'general' });
    }
    // A quest's Setback, once per quest (as Story Director sends it).
    if (r.chance(0.1)) await host.internal('party.addEffect', { preset: 'setback', source: { name: 'Rats', ref: `qu_${r.int(1, 3)}` } });
    if (r.chance(0.2)) {
        const piece = (host.q('inventory.items', {}) ?? []).find(row => row.kind === 'equipment');
        if (piece) await host.cmd(r.chance(0.5) ? 'trade.repair' : 'trade.refine', { stack: piece.stack, at: 'smith' });
    }
    if (r.chance(0.3)) {
        const stack = (host.q('inventory.items', {}) ?? []).find(row => !row.equipped);
        if (stack) await host.cmd('trade.sell', { stack: stack.stack, qty: 1, kind: 'general' });
    }
}

const json = value => JSON.stringify(value);

/**
 * A replay skip that is right: the block used a thing (by its id) that only a deleted reply had
 * made, or took from a counted stack that a deleted reply had made (Story Block's inventory), or
 * played turns of a fight a deleted reply had started (combat.act on a session that, without that
 * reply, is not there: its path goes through the empty session).
 */
const dependent = why => /does not exist \(no "[a-z]{2}_[0-9a-z]{8}"\)/.test(why) || /^Taken onto the counts as they stand now/.test(why)
    || /^The change path "\/domains\/combat\/session\/actions\/-" goes through something that is not an object or a list\.$/.test(why);

for (let seed = 1; seed <= SEEDS; seed += 1) {
    test(`FUZZ_DELETE seed ${seed}: middle deletes rebuild to the live head and skip no valid block`, { timeout: 300000 }, async t => {
        t.mock.method(console, 'warn', () => {});
        await seeded(seed, async () => {
            const r = prng(seed * 7919);
            const host = await rpgHost({ modules: [WEAR_ROUTE] });
            try {
                assert.equal((await host.cmd('party.create', { name: 'Ren', preset: 'fighter' })).ok, true);
                await host.send('We set out.', host.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement', '+ coin 200',
                    '+ item Chain Shirt | note: armour DEF +3', '+ item Iron Sword | note: weapon ATK +4', '+ item Iron Ore | qty: 6', '+ item Repair Kit | qty: 2']));
                for (const row of (host.q('inventory.items', {}) ?? []).filter(item => item.kind === 'equipment')) await host.cmd('item.equip', { stack: row.stack });
                for (let n = 0; n < REPLIES; n += 1) {
                    await host.send(`turn ${n}`, host.reply(`Reply ${n}.`, lines(r, n)));
                    await clicks(host, r);
                    if (r.chance(0.25)) {
                        const chat = host.st.ctx.chat;
                        const users = chat.map((m, i) => (m.is_user ? i : -1)).filter(i => i > 2 && i < chat.length - 2);
                        if (users.length) {
                            const u = r.pick(users);
                            await host.st.deleteMessage(u + 1);
                            await host.st.deleteMessage(u);
                        }
                    }
                    // A block that used a thing a deleted reply made (a stack, a companion, an offer) is
                    // rightly passed over; RPG Battle's own bookkeeping must never be.
                    // A later block of the same reply that only failed because a dependent one before it was
                    // passed over (a fight a deleted companion took part in, then that fight's actions) goes with it.
                    const cascade = new Set();
                    const skipped = host.store.problems().filter(p => {
                        const why = String(p.why ?? p.message);
                        if (dependent(why)) {
                            cascade.add(p.index);
                            return false;
                        }
                        return !(cascade.has(p.index) && /^The change path "\/domains\/combat\/session\//.test(why));
                    }).map(p => String(p.why ?? p.message));
                    assert.deepEqual(skipped, [], `seed ${seed} reply ${n}: a valid block was skipped on replay`);
                    // Gear (RX-TL-1): every gear event is the change of a receipt still on the chat's line,
                    // so a deleted repair or refinement takes its effect with its payment, and a later
                    // reply's event never carries an earlier reply's result.
                    const revs = new Set(host.st.ctx.chat.flatMap(m => m?.extra?.storySuite?.receipts ?? []).map(rc => rc.rev));
                    for (const key of Object.keys(host.head().domains.gear?.events ?? {})) {
                        const rev = Number(/#(\d+)/.exec(key)?.[1]);
                        assert.ok(revs.has(rev), `seed ${seed} reply ${n}: gear event ${key} has no receipt on the chat`);
                    }
                    const live = json(host.head());
                    host.store.rebuild();
                    assert.equal(json(host.head()), live, `seed ${seed} reply ${n}: the rebuilt head differs from the live one`);
                }
            } finally {
                host.close();
            }
        });
    });
}
