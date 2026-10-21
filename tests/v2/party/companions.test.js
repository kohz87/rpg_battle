// Companions who die or leave (MODULES §F26), the leave offer, and the display terms the party
// part words its summaries in (MODULES §F25).
import test from 'node:test';
import assert from 'node:assert/strict';
import { byName, capture, pcOf, run, withPc } from './helpers/fake-ctx.js';
import { part } from '../../../src/v2/party/index.js';

function rejects(out, code, pattern) {
    assert.equal(out.ok, false, 'rejected');
    assert.equal(out.code, code, out.message);
    if (pattern) assert.match(out.message, pattern);
}

function withCompanions(...names) {
    let state = withPc();
    for (const name of names) {
        const out = run(state, 'party.addCompanion', { name, role: 'ranger', level: 1 });
        assert.ok(out.ok, out.message);
        state = out.state;
    }
    return state;
}

// combat.end's payload for the party: everyone standing except those named down.
function fight(state, { stakes = 'death', outcome = 'victory', down = [] } = {}) {
    const party = state.domains.party;
    return {
        outcome, stakes,
        actors: party.order.map(id => {
            const actor = party.actors[id];
            const fell = down.includes(actor.name);
            return { id, hp: { cur: fell ? 0 : actor.hp.max, max: actor.hp.max }, mp: { ...actor.mp }, down: fell, conditions: [], uses: {} };
        }),
    };
}

test('a companion down in a fight to the death dies and leaves the party for good; the summary says so', () => {
    const state = withCompanions('Lyra', 'Kael');
    const lyra = byName(state, 'Lyra');
    const out = run(state, 'party.applyResult', fight(state, { down: ['Lyra'] }));
    assert.ok(out.ok, out.message);
    const party = out.state.domains.party;
    assert.equal(party.actors[lyra.id], undefined);
    assert.ok(!party.order.includes(lyra.id));
    assert.ok(byName(out.state, 'Kael'), 'the others stay');
    assert.match(out.result.summary, /^Lyra died in the fight and is gone from the party for good/);
    assert.deepEqual(out.result.data.died, [{ id: lyra.id, name: 'Lyra' }]);
    assert.ok(!out.result.data.actors.includes(lyra.id));
    assert.equal(out.result.narrate, true);
    assert.deepEqual(part.domains.party.validate(party), []);
    // Two at once.
    const both = run(state, 'party.applyResult', fight(state, { down: ['Lyra', 'Kael'] }));
    assert.match(both.result.summary, /^Lyra and Kael died in the fight and are gone from the party for good/);
    assert.deepEqual(both.state.domains.party.order, [state.domains.party.pc]);
});

test('down in an ordinary fight is not death; your character is never removed', () => {
    const state = withCompanions('Lyra');
    const normal = run(state, 'party.applyResult', fight(state, { stakes: 'normal', down: ['Lyra'] }));
    assert.ok(normal.ok, normal.message);
    assert.ok(byName(normal.state, 'Lyra'), 'a normal fight leaves a downed companion in the party');
    assert.deepEqual(normal.result.data.died, []);
    const lost = run(state, 'party.applyResult', fight(state, { outcome: 'defeat', down: ['Ren', 'Lyra'] }));
    assert.ok(lost.ok, lost.message);
    assert.deepEqual(pcOf(lost.state).conditions, [{ kind: 'dead', stacks: 1 }], 'the PC dies and waits for the return');
    assert.equal(byName(lost.state, 'Lyra'), undefined);
});

test('a dead companion\'s things go to the party through inventory.transfer', () => {
    let state = withCompanions('Lyra');
    const lyra = byName(state, 'Lyra');
    state = structuredClone(state);
    state.domains.inventory = { defs: {}, stacks: { st_aaaaaaaa: { id: 'st_aaaaaaaa', def: 'story/bow', qty: 1, owner: lyra.id, equipped: 'weapon' }, st_bbbbbbbb: { id: 'st_bbbbbbbb', def: 'story/rope', qty: 1, owner: 'party', equipped: null } }, wallets: {}, aliases: {} };
    const moved = [];
    const out = run(state, 'party.applyResult', fight(state, { down: ['Lyra'] }), { extraCommands: { 'inventory.transfer': (ctx, payload) => { moved.push(payload); return { summary: 'moved' }; } } });
    assert.ok(out.ok, out.message);
    assert.deepEqual(moved, [{ stack: 'st_aaaaaaaa', to: 'party' }]);
});

test('leave lines: an offer to let a companion go; Accept removes them, Dismiss keeps them', () => {
    const state = withCompanions('Lyra');
    const lyra = byName(state, 'Lyra');
    const offered = capture(state, '- leave Lyra — parts ways at the ford');
    assert.ok(offered.ok, offered.message);
    assert.ok(byName(offered.state, 'Lyra'), 'nothing happens before the reader decides');
    const [offer] = Object.values(offered.state.domains.party.offers);
    assert.deepEqual({ kind: offer.kind, actor: offer.actor, text: offer.text }, { kind: 'leave', actor: lyra.id, text: 'parts ways at the ford' });
    assert.equal(offered.result.summary, 'Lyra means to leave the party.');
    assert.equal(part.queries['party.offers'](offered.state)[0].text, 'Lyra means to leave the party: parts ways at the ford.');
    assert.match(part.context.tail({ state: offered.state, settings: () => ({}) }).optional[0], /Lyra may leave/);

    const accepted = run(offered.state, 'party.acceptOffer', { offer: offer.id });
    assert.ok(accepted.ok, accepted.message);
    assert.equal(byName(accepted.state, 'Lyra'), undefined);
    assert.deepEqual(Object.values(accepted.state.domains.party.offers), []);
    assert.match(accepted.result.summary, /Lyra leaves the party/);

    const kept = run(offered.state, 'party.dismissOffer', { offer: offer.id });
    assert.ok(kept.ok, kept.message);
    assert.ok(byName(kept.state, 'Lyra'));
    assert.equal(kept.result.summary, 'Lyra stays with the party.');

    // `- join Lyra — leaves` says the same.
    const join = capture(state, '- join Lyra — leaves');
    assert.ok(join.ok, join.message);
    assert.deepEqual(Object.values(join.state.domains.party.offers).map(entry => [entry.kind, entry.actor, entry.text]), [['leave', lyra.id, '']]);
});

test('leave rejections: your character, someone not in the party, twice, a wrong op', () => {
    const state = withCompanions('Lyra');
    rejects(capture(state, '- leave Ren — storms off'), 'REFUSED', /Only a companion/);
    rejects(capture(state, '- leave Mira — goes home'), 'NOT_FOUND');
    const once = capture(state, '- leave Lyra — goes home').state;
    rejects(capture(once, '- leave Lyra — goes home'), 'REFUSED', /already waiting/);
    rejects(capture(state, '+ leave Lyra — goes home'), 'INVALID');
    assert.match(part.kinds.leave.grammar, /^- leave Name — /);
});

test('terms (§F25): summaries and party.terms speak the terms in the settings', () => {
    const state = withCompanions('Lyra');
    const terms = { levelName: 'Soul Class', xpName: 'Soul Growth', tiers: { size: 10, numerals: 'roman' } };
    const out = run(state, 'party.grantXp', { xp: 120, reason: 'the culvert' }, { settings: { terms } });
    assert.ok(out.ok, out.message);
    assert.match(out.result.summary, /^the culvert: Ren Soul Growth \+120, reaches Soul Class I \(Lv 2\)/);
    assert.deepEqual(part.queries['party.terms'](state, { settings: { terms } }), terms);
    assert.deepEqual(part.queries['party.terms'](state, {}), { levelName: 'Level', xpName: 'XP', tiers: null });
});
