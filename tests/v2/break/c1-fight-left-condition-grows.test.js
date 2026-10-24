// B-c1-1 (live beta cell 1): a condition a fight leaves with 1 round to go is written to the party as
// stacks 1, and the next fight reads stacks 1 as "a story's condition" and gives it the usual 3 rounds:
// the bleed grows from 1 round to 3 between fights (and in between it never wears off with story time).
// Drop into rpg_battle/tests/v2/break/. Run: node --test tests/v2/break/c1-fight-left-condition-grows.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyResult as applyResultV1 } from '../../../src/sheet.js';
import { fromSheet, toSheet } from '../../../src/v2/party/sheets.js';
import { partyCombatants } from '../../../src/v2/combat/setup.js';
import { actor } from '../combat/helpers/fake-ctx.js';
import { FIGHT_LEFT_MINUTES, fitParty } from '../../../src/v2/party/pools.js';
import { queries } from '../../../src/v2/party/queries.js';
import { pcOf, run, withPc } from '../party/helpers/fake-ctx.js';
import { boardOf, liveFight, mount } from '../board/helpers.js';

const ctxFor = actors => ({
    query: name => (name === 'party.actors' ? structuredClone(actors) : undefined),
    read: () => null,
});

test('a bleed a fight leaves with 1 round left starts the next fight with 1 round, not 3', () => {
    const pc = actor(1);
    // combat.end → party.applyResult: the fight left "bleed" with 1 round to go on the character.
    const result = { outcome: 'victory', party: [{ memberId: pc.id, hp: { cur: 60, max: 80 }, mp: { cur: 30, max: 30 }, down: false, conditions: [{ name: 'bleed', rounds: 1 }] }], xp: {}, uses: {} };
    const applied = applyResultV1(toSheet(pc), pc.id, result);
    const after = fromSheet(pc, applied.sheet);
    const kept = after.conditions.find(entry => /bleed/i.test(entry.kind));
    assert.ok(kept, 'the fight-left bleed is kept on the party');

    // The next fight (any time later): the party's conditions become the fight's.
    const [combatant] = partyCombatants(ctxFor([after]));
    const bleed = combatant.conditions.find(entry => entry.name === 'bleed');
    assert.ok(bleed, 'the bleed carries into the next fight');
    assert.equal(bleed.rounds, 1, `the bleed had 1 round left; the next fight gives it ${bleed.rounds}`);
});


// Fixed (party/sheets.js conditionRecord, party/pools.js lapsed, combat/setup.js roundsOf): a condition a
// fight left keeps its `rounds` and the story minute the fight ended (`at`); one at 0 rounds is not kept;
// any rest ends it; it wears off FIGHT_LEFT_MINUTES of story time after the fight; the board never says 0.

test('B-c1-1: a fight-left condition at 0 rounds is over and not kept; one with rounds keeps them and the minute', () => {
    const pc = actor(1);
    const result = { outcome: 'victory', party: [{ memberId: pc.id, hp: { cur: 60, max: 80 }, mp: { cur: 30, max: 30 }, down: false, conditions: [{ name: 'bleed', rounds: 0 }, { name: 'poison', rounds: 2 }] }], xp: {}, uses: {} };
    const after = fromSheet(pc, applyResultV1(toSheet(pc), pc.id, result).sheet, undefined, { at: 600 });
    assert.deepEqual(after.conditions, [{ kind: 'poisoned', stacks: 2, rounds: 2, at: 600 }]);
});

test('B-c1-1: any rest ends what a fight left; a story\'s condition waits for a long rest', () => {
    const state = withPc();
    const ren = pcOf(state);
    Object.assign(ren, { hp: { cur: 10, max: ren.hp.max, lost: ren.hp.max - 10 }, conditions: [{ kind: 'bleeding', stacks: 1, rounds: 1, at: 5 }, { kind: 'cursed', stacks: 1 }] });
    const out = run(state, 'party.rest', { kind: 'short' });
    assert.ok(out.ok, out.message);
    assert.deepEqual(pcOf(out.state).conditions, [{ kind: 'cursed', stacks: 1 }]);
});

test('B-c1-1: it wears off with story time (read so everywhere: queries, the next fight, the card)', () => {
    const state = withPc();
    const ren = pcOf(state);
    ren.conditions = [{ kind: 'bleeding', stacks: 1, rounds: 1, at: 100 }, { kind: 'cursed', stacks: 1 }];
    const at = minutes => ({ ...state, domains: { ...state.domains, director: { time: { minutes } } } });
    assert.deepEqual(queries['party.pc'](at(100 + FIGHT_LEFT_MINUTES - 1)).conditions.map(entry => entry.kind), ['bleeding', 'cursed'], 'right after the fight it is on');
    assert.deepEqual(queries['party.pc'](at(100 + FIGHT_LEFT_MINUTES)).conditions.map(entry => entry.kind), ['cursed'], 'a while later it has worn off');
    assert.deepEqual(queries['party.pools'](at(100 + FIGHT_LEFT_MINUTES))[ren.id].lapsed, ['bleeding'], 'the status card leaves it out');
    assert.deepEqual(queries['party.pc'](state).conditions.map(entry => entry.kind), ['bleeding', 'cursed'], 'without a clock it lasts until a rest');
    assert.deepEqual(fitParty(state.domains.party, { minutes: 50 }), state.domains.party, 'a clock set back keeps it');
});

test('B-c1-2: the battle board never says "0 turns left" for a condition that is still on', () => {
    const { el, handle } = mount(null);
    const view = boardOf(liveFight());
    const [first, ...rest] = view.combatants;
    handle.update({ value: { ...view, combatants: [{ ...first, conditions: [{ name: 'bleed', label: 'bleeding', turns: 0 }] }, ...rest] } });
    const chip = el.querySelector('.rpg-bb-cond');
    assert.equal(chip.querySelector('.rpg-bb-cond-turns').textContent, '1');
    assert.equal(chip.getAttribute('aria-label'), 'bleeding: 1 turn left');
});
