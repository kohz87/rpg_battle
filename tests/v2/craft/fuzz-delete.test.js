// FUZZ_DELETE with the craft part's kinds (SPEC §2.2, MODULES §F102): seeded replies that learn,
// forget and craft (with materials, checks before and after, stations come and gone), and now and
// then the reader deletes an earlier exchange from the middle of the chat. After every step the head
// rebuilt from the chat equals the live one, and no block of valid input is skipped on replay: the
// craft domain's records are keyed by member and recipe or by the craft's id, never a list position.
// FUZZ_DELETE_SEEDS=<n> FUZZ_DELETE_REPLIES=<n> run more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../integration/helpers/host.js';
import { DIRECTOR, craftHost } from './helpers.js';

const SEEDS = Number(process.env.FUZZ_DELETE_SEEDS) || 3;
const REPLIES = Number(process.env.FUZZ_DELETE_REPLIES) || 16;

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

const PLACES = ['~ place Hollis\'s Smithy | kind: settlement', '~ place Deep Woods | kind: wild', '~ place Old Apothecary | kind: settlement'];
const GOODS = ['Iron Ore', 'Ember Salt', 'Healing Herb', 'River Fish', 'Bone Chip'];
const RECIPES = ['Iron Sword', 'Healing Draught', 'Grilled Fish', 'Grilled Fish', 'Bone Charm', 'Ember Tonic'];

function lines(r, n) {
    const out = [];
    for (let i = 0, count = r.int(1, 4); i < count; i += 1) {
        const kind = r.pick(['craft', 'craft', 'craft', 'learn', 'forget', 'item', 'item', 'place', 'check', 'teach']);
        if (kind === 'craft') out.push(`! craft ${r.pick(RECIPES)} | roll: ${r.int(1, 2)} | result: ${r.pick(['made', 'fine', 'fail'])}${r.chance(0.3) ? ' | at: campfire' : ''}${r.chance(0.3) ? ' | by: Lyra' : ''}`);
        if (kind === 'learn') out.push(`+ recipe ${r.pick(RECIPES)} | from: Hollis${r.chance(0.3) ? ' | who: Lyra' : ''}`);
        if (kind === 'forget') out.push(`- recipe ${r.pick(RECIPES)}${r.chance(0.3) ? ' | who: Lyra' : ''}`);
        if (kind === 'teach') out.push(`+ recipe Ember Tonic | makes: Ember Tonic | with: Ember Salt x2, Healing Herb | craft: alchemy | from: Mira ${n}`);
        if (kind === 'item') out.push(`+ item ${r.pick(GOODS)} | qty: ${r.int(1, 3)}`);
        if (kind === 'place') out.push(r.pick(PLACES));
        if (kind === 'check') out.push(`? check ${r.pick(['stealth', 'STR', 'perception'])} — try ${n}.${i} | dc: normal | roll: ${r.int(1, 2)} | result: success`);
    }
    return out;
}

const json = value => JSON.stringify(value);
// A block that used a thing only a deleted reply made (a stack) is rightly passed over (Story Block's inventory).
const dependent = why => /does not exist \(no "[a-z]{2}_[0-9a-z]{8}"\)/.test(why) || /^Taken onto the counts as they stand now/.test(why);

for (let seed = 1; seed <= SEEDS; seed += 1) {
    test(`FUZZ_DELETE craft seed ${seed}: middle deletes rebuild to the live head and skip no valid block`, { timeout: 300000 }, async t => {
        t.mock.method(console, 'warn', () => {});
        await seeded(seed * 31, async () => {
            const r = prng(seed * 104729);
            const host = await craftHost({ modules: [DIRECTOR], goods: ['+ item Iron Ore | qty: 3', '+ item River Fish | qty: 6'] });
            try {
                await host.send('Lyra?', host.reply('Lyra asks to come.', ['+ join Lyra — a traveller | role: ranger']));
                const offer = host.q('party.offers')[0];
                if (offer) await host.cmd('party.acceptOffer', { offer: offer.id });
                const crafted = new Set();
                // One craft for sure, early enough to be deleted from the middle later.
                await host.send('I cook.', host.reply('Fish.', ['! craft Grilled Fish | roll: 1']));
                for (let n = 0; n < REPLIES; n += 1) {
                    const written = lines(r, n);
                    await host.send(`turn ${n}`, host.reply(`Reply ${n}.`, written));
                    for (const entry of host.q('craft.log')) crafted.add(entry.id);
                    if (r.chance(0.3)) {
                        const chat = host.st.ctx.chat;
                        const users = chat.map((m, i) => (m.is_user ? i : -1)).filter(i => i > 4 && i < chat.length - 2);
                        // (the first exchanges, the pack's start and Lyra's joining, stay)
                        if (users.length) {
                            const u = r.pick(users);
                            await host.st.deleteMessage(u + 1);
                            await host.st.deleteMessage(u);
                        }
                    }
                    const skipped = host.store.problems().map(p => String(p.why ?? p.message)).filter(why => !dependent(why));
                    assert.deepEqual(skipped, [], `seed ${seed} reply ${n}: a valid block was skipped on replay`);
                    const live = json(host.head());
                    host.store.rebuild();
                    assert.equal(json(host.head()), live, `seed ${seed} reply ${n}: the rebuilt head differs from the live one`);
                }
                assert.ok(crafted.size > 0, 'something was crafted along the way');
            } finally {
                host.close();
            }
        });
    });
}
