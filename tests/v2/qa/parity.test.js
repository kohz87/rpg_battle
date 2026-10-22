// QA: v1 parity spot checks. For fixed inputs, the numbers the v2 parts commit through the real
// bus equal what v1's pure functions give for the same sheet (built here by hand, not through
// the parts' own bridge): creation, a healing dose, XP and level-ups, rests, wounds, a check's
// d20, a fight's blows and XP, a sale price.
import assert from 'node:assert/strict';
import { DEFAULT_RULES, checkModifier, makeRules } from '../../../src/rules.js';
import { PRESETS } from '../../../src/skills.js';
import { newSheet } from '../../../src/sheet.js';
import { useItemOutside, rest as restV1 } from '../../../src/recovery.js';
import { gainXp } from '../../../src/growth.js';
import { applyWounds, parseWounds } from '../../../src/story.js';
import { effectByName } from '../../../src/items.js';
import { act, replay, summarize } from '../../../src/combat.js';
import { placePrices, sellPrice } from '../../../src/trade.js';
import { fitPool } from '../../../src/v2/party/pools.js';
import { rng, roll } from './vendor/src/v2/rng.js';
import { fightOut, stacksOf, storyItem, withHero, each } from './helpers/harness.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

/** A v1 Sheet for an actor record, field by field. */
function v1Sheet(actor) {
    return {
        name: actor.name, level: actor.level, xp: actor.xp, points: actor.points,
        hp: { ...actor.hp }, mp: { ...actor.mp }, sp: { ...actor.sp }, stats: { ...actor.stats },
        skills: actor.skills.map(skill => ({ name: skill.name, mastery: skill.level })), conditions: [], uses: {},
    };
}
const pcOf = h => h.state().domains.party.actors[h.state().domains.party.pc];

each('party.create (fighter preset) = v1 newSheet: stats, level, points, HP/MP/SP, skills', () => {
    const { h } = withHero({ name: 'Ren', preset: 'fighter' });
    const fighter = PRESETS.find(p => p.id === 'fighter');
    const v1 = newSheet({ name: 'Ren', stats: fighter.points, skills: fighter.skills }, DEFAULT_RULES);
    const me = pcOf(h);
    assert.deepEqual(me.stats, v1.stats);
    assert.deepEqual([me.level, me.xp, me.points], [v1.level, v1.xp, v1.points]);
    assert.deepEqual([me.hp, me.mp, me.sp], [v1.hp, v1.mp, v1.sp]);
    assert.deepEqual(me.skills.map(s => s.name), v1.skills.map(s => s.name));
});

each('item.use Minor Healing Draught = v1 useItemOutside (heal 20 by name, as v1 0.5.35)', () => {
    const { h } = withHero();
    const pot = storyItem(h, 'Minor Healing Draught', 1);
    assert.deepEqual(h.state().domains.inventory.defs[pot].effect.heal, effectByName('Minor Healing Draught').heal);
    for (const hpLeft of [10, 70, 87]) { // the fighter's 90 HP (wave C preset): one short of full by 3
        const { h: w } = withHero();
        const p = storyItem(w, 'Minor Healing Draught', 1);
        const me = pcOf(w);
        // Hurt to an exact HP by hand (test setup), then drink.
        const next = structuredClone(w.state());
        next.domains.party.actors[me.id].hp.cur = hpLeft;
        w.store.reset(next);
        const v1 = useItemOutside(v1Sheet(pcOf(w)), { name: 'Minor Healing Draught', effect: { heal: 20 } });
        const r = w.command('item.use', { stack: stacksOf(w, p)[0].stack });
        assert.equal(r.ok, true, r.message);
        assert.equal(pcOf(w).hp.cur, v1.sheet.hp.cur, `from ${hpLeft}`);
    }
    void h;
});

each('party.grantXp = v1 gainXp: XP, level-ups and points for fixed amounts', () => {
    for (const amount of [5, 99, 100, 1000, 25000]) {
        const { h } = withHero();
        const before = v1Sheet(pcOf(h));
        const r = h.command('party.grantXp', { actor: pcOf(h).id, amount }, { cause: 'system' });
        assert.equal(r.ok, true, r.message);
        const v1 = gainXp(before, amount, DEFAULT_RULES).sheet;
        const me = pcOf(h);
        assert.deepEqual([me.level, me.xp, me.points, me.hp.max, me.mp.max, me.sp.max], [v1.level, v1.xp, v1.points, v1.hp.max, v1.mp.max, v1.sp.max], `amount ${amount}`);
    }
});

each('party.rest short and long = v1 rest', () => {
    for (const kind of ['short', 'long']) {
        const { h } = withHero();
        const next = structuredClone(h.state());
        const me = next.domains.party.actors[next.domains.party.pc];
        Object.assign(me, { hp: { cur: 11, max: me.hp.max }, mp: { cur: 3, max: me.mp.max }, sp: { cur: 0, max: me.sp.max } });
        h.store.reset(next);
        const v1 = restV1(v1Sheet(pcOf(h)), kind, { gear: [], rules: DEFAULT_RULES });
        const r = h.command('party.rest', { kind });
        assert.equal(r.ok, true, r.message);
        // The record keeps a pool below full with its `lost` (party/pools.js); read as it stands now.
        assert.deepEqual([fitPool(pcOf(h).hp), fitPool(pcOf(h).mp), fitPool(pcOf(h).sp)], [v1.hp, v1.mp, v1.sp], kind);
    }
});

each('~ wound Ren | harm: wound = v1 applyWounds (a share of max HP by the word)', () => {
    for (const harm of ['scratch', 'wound', 'severe', 'grievous']) {
        const { h } = withHero();
        const before = v1Sheet(pcOf(h));
        const r = h.capture({ op: '~', kind: 'wound', name: 'Ren', text: 'a fall', labels: { harm } });
        assert.equal(r.ok, true, r.message);
        const [wound] = parseWounds(`Ren — ${harm}: a fall`);
        const v1 = applyWounds({ pc: before }, [{ ...wound, name: 'Ren' }], DEFAULT_RULES);
        assert.equal(pcOf(h).hp.cur, v1.pc.hp.cur, harm);
    }
});

each('check.resolve: the d20 is the receipt seed\'s first roll; the modifier is v1 checkModifier', () => {
    const { h } = withHero();
    for (let n = 0; n < 20; n++) {
        const r = h.command('check.resolve', { skill: 'athletics', dc: 'hard', what: 'climbing the wall' });
        assert.equal(r.ok, true, r.message);
        const die = roll(rng(r.receipt.seed), '1d20').dice[0];
        assert.equal(r.receipt.data.die, die);
        assert.equal(r.receipt.data.stat, 'STR');
        assert.equal(r.receipt.data.mod, checkModifier(pcOf(h).stats.STR, DEFAULT_RULES));
        assert.equal(r.receipt.data.total, die + r.receipt.data.mod);
        assert.equal(r.receipt.data.dc, 20);
    }
});

each('a fight\'s blows and XP = v1 act/replay/summarize on the stored setup', () => {
    for (const seed of [1, 3, 4]) {
        const { h } = withHero({ seed });
        h.capture({ op: '!', kind: 'encounter', name: '2 Cellar Rats', text: '', labels: { tier: 'weak' } });
        assert.equal(h.command('combat.start', { offer: h.query('combat.offers')[0].id }).ok, true);
        const session = structuredClone(sessionOf(h.state().domains.combat));
        const rules = makeRules({ turns: { mode: session.setup.turns, speedOffset: session.setup.speedOffset }, attack: { hitBase: session.setup.hit.base, hitPerPoint: session.setup.hit.perPoint } });
        // The setup with the loot ranges back in v1's shape (`range` → `qty`).
        const setup = JSON.parse(JSON.stringify(session.setup), (key, value) => (value && typeof value === 'object' && Array.isArray(value.range) ? (({ range, ...rest }) => ({ ...rest, qty: range }))(value) : value));
        let fight = replay({ setup, actions: [] }, rules);
        const marks = h.receipts.length;
        fightOut(h);
        const acts = h.receipts.slice(marks);
        const actions = sessionOf(h.state().domains.combat).actions;
        actions.forEach((action, i) => {
            const before = fight.log.length;
            fight = act(fight, action, rules);
            const told = fight.log.slice(before).map(entry => entry.text).join(' ');
            assert.equal(acts[i].summary, told.length > 400 ? `${told.slice(0, 399).trimEnd()}…` : told, `seed ${seed}, action ${i + 1}`);
        });
        const v1 = summarize(fight, rules);
        const end = h.command('combat.end');
        assert.equal(end.ok, true, end.message);
        assert.deepEqual(end.receipt.data.xp, v1.xp, `seed ${seed} XP`);
        assert.equal(end.receipt.data.loot.money, v1.loot.money);
    }
});

// v1's prices by the words of a place's name: the reader's `guessPrices` (MODULES §F107; off by default).
each('trade.sell price = v1 sellPrice at the place\'s prices', () => {
    const { h } = withHero({ settings: { 'trade.guessPrices': true } });
    for (const name of ['Wolf Pelt', 'Minor Healing Draught', 'Iron Sword']) {
        const def = storyItem(h, name, 2, name === 'Iron Sword' ? 'ATK +2' : '');
        const row = stacksOf(h, def)[0];
        const q = h.query('trade.quote', { type: 'sell', stack: row.stack, qty: 1 });
        const d = h.state().domains.inventory.defs[def];
        const item = { name: d.name, kind: d.kind, rarity: d.rarity, slot: d.slot, stats: d.stats, effect: Object.keys(d.effect).length ? d.effect : null, tags: d.tags, note: d.note };
        const prices = placePrices('Bluewatch Village | settlement', { rules: DEFAULT_RULES });
        assert.equal(q.each, sellPrice(item, { buyer: 'general', prices, level: 1, rules: DEFAULT_RULES }), name);
    }
});
