// Crafting on the real Story Block host (the vendored runtime): a test pack with materials, gear,
// a potion and recipes (basic and learned, with the recipe fields MODULES §F102 adds), your
// character made, the party at a smithy.
import { rpgHost } from '../integration/helpers/host.js';

export const PACK = {
    id: 'crafty', version: '1.0.0', name: 'Crafty', requires: { storyBlock: '^2' },
    content: {
        items: [
            { name: 'Iron Ore', kind: 'material', rarity: 'common', value: 4 },
            { name: 'Ember Salt', kind: 'material', rarity: 'uncommon', value: 10, tags: ['fire'] },
            { name: 'Healing Herb', kind: 'material', rarity: 'common', value: 2 },
            { name: 'River Fish', kind: 'material', rarity: 'common', value: 1 },
            { name: 'Iron Sword', kind: 'equipment', rarity: 'common', value: 900, slot: 'weapon', stats: { ATK: 5 } },
            { name: 'Healing Draught', kind: 'consumable', rarity: 'common', value: 600, effect: { heal: 30 } },
            { name: 'Grilled Fish', kind: 'consumable', rarity: 'common', value: 3, effect: { heal: 10 } },
            { name: 'Bone Chip', kind: 'material', rarity: 'uncommon' },
            { name: 'Bone Charm', kind: 'equipment', rarity: 'uncommon', value: 500, slot: 'accessory', stats: { DEF: 2 } },
        ],
        recipes: [
            { name: 'Iron Sword', makes: 'iron-sword', materials: [{ item: 'iron-ore', qty: 3 }, { item: 'ember-salt', qty: 1 }], craft: 'smithing', dc: 12, minutes: 120, teaches: 'Hollis at the smithy, or the Smithing Primer' },
            { name: 'Healing Draught', makes: 'healing-draught', materials: [{ item: 'healing-herb', qty: 2 }], craft: 'alchemy', known: true, minutes: 60 },
            { name: 'Grilled Fish', makes: 'grilled-fish', materials: [{ item: 'river-fish', qty: 1 }], craft: 'cooking', known: true, minutes: 30 },
            { name: 'Bone Charm', makes: 'bone-charm', materials: [{ item: 'bone-chip', qty: 2 }], craft: 'leather', known: true, dc: 5 },
        ],
        // Story Block's craft table with two crafts changed (PACKS.md "crafts"): smithing on STR alone, cooking on DEX.
        crafts: [
            { id: 'smithing', title: 'Smithing', stats: ['STR'], stations: ['forge'] },
            { id: 'cooking', title: 'Cooking', stats: ['DEX'], stations: ['campfire', 'inn'] },
        ],
    },
};

/** A host with the pack, Ren (fighter) and, unless `place: null`, the party at Hollis's Smithy. */
export async function craftHost({ place = '~ place Hollis\'s Smithy | kind: settlement', goods = [], settings, modules = [], pack = PACK } = {}) {
    const host = await rpgHost({ ...(settings ? { settings } : {}), modules });
    const installed = await host.packs.packs.install(JSON.stringify(pack));
    if (!installed.ok) throw new Error(`pack: ${JSON.stringify(installed)}`);
    const made = await host.cmd('party.create', { name: 'Ren', preset: 'fighter' });
    if (!made.ok) throw new Error(made.message);
    await host.send('We set out.', host.reply('Here we are.', [place, ...goods].filter(Boolean)));
    return host;
}

/** Ren's (or `name`'s) Crafting screen row. */
export const personOf = (host, name = 'Ren') => host.q('craft.view', {}).people.find(person => person.name === name);
export const itemsNamed = (host, name) => (host.q('inventory.items', {}) ?? []).filter(row => row.name === name);
export const qtyOf = (host, name) => itemsNamed(host, name).reduce((sum, row) => sum + row.qty, 0);

/**
 * Sends `text` and answers with `lines(die)` once the reply's Roll `place` (1 or 2) is a die
 * `wanted(die)` accepts, swiping for fresh dice until it is (the dice are rolled before the reply is
 * written, so the reply is built when SillyTavern asks for its text). → the die used.
 */
export async function replyWhen(host, text, wanted, lines, { place = 1, most = 400 } = {}) {
    let die = null;
    const reply = () => {
        const rolls = host.q('checks.rolls', {})?.rolls ?? [];
        const now = rolls[place - 1];
        if (!wanted(now)) return 'Nothing happens.';
        die = now;
        replyWhen.rolls = [...rolls];
        return host.reply('It is done.', lines(now));
    };
    const lazy = { toString: reply };
    await host.send(text, lazy);
    for (let n = 0; die === null && n < most; n += 1) await host.swipe(lazy);
    if (die === null) throw new Error('no such roll came up');
    return die;
}

/** A Story Director stand-in: a clock (`director.time`) and `director.advance { minutes }`. */
export const DIRECTOR = {
    id: 'fake-director',
    name: 'Fake director',
    version: '0.0.0',
    domains: { director: { initial: () => ({ time: { minutes: 600 } }), validate: () => [] } },
    queries: { 'director.time': state => ({ minutes: state?.domains?.director?.time?.minutes ?? null }) },
    commands: {
        // As Story Director's (time/advance.js): `cause` a short label, `reason` the words; refused otherwise.
        'director.advance'(ctx, payload = {}) {
            if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(String(payload.cause ?? ''))) ctx.fail('INVALID', 'director.advance: "cause" must be a short label.');
            if (!Number.isInteger(payload.minutes) || payload.minutes < 1 || payload.minutes > 1440) ctx.fail('INVALID', 'director.advance: minutes 1–1440.');
            const director = ctx.draft('director');
            director.time.minutes += payload.minutes;
            return { summary: `${payload.minutes} minutes pass.`, data: { minutes: payload.minutes }, narrate: false };
        },
    },
};
