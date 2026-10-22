// The party part's commands against a fake ctx: each success path, each rejection (with its
// code), and that a rejected command leaves the state exactly as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byName, makeState, pcOf, run, withPc } from './helpers/fake-ctx.js';
import { part } from '../../../src/v2/party/index.js';

const rejects = (out, code, pattern) => {
    assert.equal(out.ok, false, 'expected a rejection');
    assert.equal(out.code, code, out.message);
    if (pattern) assert.match(out.message, pattern);
};

function withCompanion(name = 'Lyra', extra = {}) {
    const out = run(withPc(), 'party.addCompanion', { name, role: 'ranger', level: 1, ...extra });
    assert.ok(out.ok, out.message);
    return out.state;
}

test('party.create makes your character and puts them first', () => {
    const out = run(makeState(), 'party.create', { name: 'Ren', points: { STR: 4, VIT: 3, AGI: 1, DEX: 2 } });
    assert.ok(out.ok, out.message);
    const party = out.state.domains.party;
    const ren = party.actors[party.pc];
    assert.match(party.pc, /^ac_[a-z0-9]{8}$/);
    assert.deepEqual(party.order, [party.pc]);
    assert.equal(ren.kind, 'pc');
    assert.equal(ren.control, 'player');
    assert.equal(ren.stats.STR, 9);
    assert.equal(out.result.summary, 'Ren is ready.');
    assert.deepEqual(part.domains.party.validate(party), []);
});

test('party.create takes a preset and its skills', () => {
    const out = run(makeState(), 'party.create', { name: 'Ren', preset: 'caster' });
    assert.ok(out.ok, out.message);
    assert.deepEqual(pcOf(out.state).skills.map(skill => skill.name), ['Firebolt', 'Frost Shard', 'Ward']);
    assert.ok(pcOf(out.state).skills.every(skill => skill.level === 1 && skill.uses === 0 && skill.active));
});

test('party.create rejections leave nothing behind', () => {
    const empty = makeState();
    rejects(run(empty, 'party.create', { name: 'Ren', points: { STR: 3 } }), 'REFUSED', /spend exactly 10 points/);
    rejects(run(empty, 'party.create', { name: '  ', points: { STR: 10 } }), 'INVALID', /name/);
    rejects(run(empty, 'party.create', { name: 'Ren', points: { POW: 10 } }), 'INVALID', /not a stat/);
    rejects(run(empty, 'party.create', { name: 'Ren', points: { STR: 10.5 } }), 'INVALID', /whole number/);
    rejects(run(empty, 'party.create', { name: 'Ren', points: 'lots' }), 'INVALID');
    rejects(run(empty, 'party.create', { name: 'Ren', preset: 'paladin' }), 'NOT_FOUND');
    rejects(run(empty, 'party.create', { name: 'Ren', preset: 'fighter', skills: ['Moon Kick'] }), 'NOT_FOUND', /skill library/);
    rejects(run(empty, 'party.create', { name: 'Ren', preset: 'fighter', skills: ['Cleave'] }), 'REFUSED', /needs STR 10/);
    rejects(run(empty, 'party.create', { name: 'Ren', preset: 'fighter', skills: ['Sweep', 'Mend', 'Rally', 'Ward'] }), 'REFUSED', /3 skills at most/);
    rejects(run(empty, 'party.create', { name: 'Ren', points: { STR: 10 } }, { settings: { statCap: 12 } }), 'REFUSED', /no higher than 12/);
    const made = withPc();
    rejects(run(made, 'party.create', { name: 'Ana', preset: 'fighter' }), 'REFUSED', /already have a character/);
    assert.deepEqual(empty.domains.party, part.domains.party.initial());
});

test('party.create with replace makes a new character in place of the old', () => {
    const state = withCompanion();
    const old = state.domains.party.pc;
    const out = run(state, 'party.create', { name: 'Ana', preset: 'healer', replace: true });
    assert.ok(out.ok, out.message);
    const party = out.state.domains.party;
    assert.notEqual(party.pc, old);
    assert.equal(party.actors[old], undefined);
    assert.equal(party.order[0], party.pc);
    assert.equal(party.order.length, 2);
});

/** withPc with your character at `level` (only the number: what a companion's level is held to). */
function pcAtLevel(level) {
    const state = withPc();
    pcOf(state).level = level;
    return state;
}

test('party.addCompanion builds a companion at the level given, else within one of yours, never more than two above yours', () => {
    const held = run(withPc(), 'party.addCompanion', { name: 'Lyra', role: 'healer', level: 6 });
    assert.equal(byName(held.state, 'Lyra').level, 3, 'two levels above a level-1 character at most (B-b3-16)');
    const out = run(pcAtLevel(5), 'party.addCompanion', { name: 'Lyra', role: 'healer', level: 6 });
    assert.ok(out.ok, out.message);
    const lyra = byName(out.state, 'Lyra');
    assert.equal(lyra.kind, 'companion');
    assert.equal(lyra.control, 'auto');
    assert.equal(lyra.level, 6);
    assert.equal(lyra.role, 'healer');
    assert.ok(lyra.stats.INT > lyra.stats.STR, 'a healer leans on INT');
    assert.equal(lyra.skills.length, 3, 'suggested skills for the build');
    assert.equal(out.result.narrate, true);
    const plain = run(withPc(), 'party.addCompanion', { name: 'Bram', control: 'player' });
    assert.ok([1, 2].includes(byName(plain.state, 'Bram').level), 'within one level of a level-1 character (F91)');
    assert.equal(byName(plain.state, 'Bram').control, 'player');
    assert.equal(byName(plain.state, 'Bram').role, 'companion');
});

test('party.addCompanion rejections', () => {
    const state = withCompanion();
    rejects(run(state, 'party.addCompanion', { name: 'lyra' }), 'REFUSED', /already a lyra/i);
    rejects(run(state, 'party.addCompanion', { name: 'Ren' }), 'REFUSED', /already a Ren/);
    rejects(run(state, 'party.addCompanion', { name: '' }), 'INVALID', /name/);
    rejects(run(state, 'party.addCompanion', { name: 'Kael', level: 0 }), 'INVALID', /level/);
    rejects(run(state, 'party.addCompanion', { name: 'Kael', skills: ['Moon Kick'] }), 'REFUSED', /not in the skill library/);
    rejects(run(state, 'party.addCompanion', { name: 'Kael', level: 1, skills: ['Chain Lightning'] }), 'REFUSED', /cannot take Chain Lightning/);
    rejects(run(state, 'party.addCompanion', { name: 'Kael', skills: ['Mend', 'Ward', 'Rally', 'Sweep'] }), 'REFUSED', /3 skills at most/);
});

test('party.edit renames, re-roles and hands over control; ids stay', () => {
    const state = withCompanion();
    const lyra = byName(state, 'Lyra');
    const out = run(state, 'party.edit', { actor: lyra.id, name: 'Lyra Vane', role: 'scout', control: 'player', npc: 'Lyra' });
    assert.ok(out.ok, out.message);
    const after = out.state.domains.party.actors[lyra.id];
    assert.equal(after.name, 'Lyra Vane');
    assert.equal(after.role, 'scout');
    assert.equal(after.control, 'player');
    assert.equal(after.npc, 'Lyra');
    assert.match(out.result.summary, /Lyra is now called Lyra Vane/);
});

test('party.edit rejections', () => {
    const state = withCompanion();
    const lyra = byName(state, 'Lyra');
    rejects(run(state, 'party.edit', { actor: 'ac_zzzzzzzz', name: 'X' }), 'NOT_FOUND');
    rejects(run(state, 'party.edit', { actor: lyra.id, name: 'Ren' }), 'REFUSED', /your character's name/);
    rejects(run(state, 'party.edit', { actor: lyra.id, name: '' }), 'INVALID');
    rejects(run(state, 'party.edit', { actor: lyra.id, control: 'robot' }), 'INVALID');
    rejects(run(state, 'party.edit', { control: 'auto' }), 'REFUSED', /yours to play/);
    rejects(run(state, 'party.edit', { actor: lyra.id, name: 'Lyra' }), 'REFUSED', /Nothing to change/);
});

test('party.removeCompanion: a companion leaves, your character cannot', () => {
    const state = withCompanion();
    const lyra = byName(state, 'Lyra');
    const out = run(state, 'party.removeCompanion', { actor: lyra.id });
    assert.ok(out.ok);
    assert.equal(out.state.domains.party.actors[lyra.id], undefined);
    assert.deepEqual(out.state.domains.party.order, [state.domains.party.pc]);
    rejects(run(state, 'party.removeCompanion', { actor: state.domains.party.pc }), 'REFUSED');
    rejects(run(state, 'party.removeCompanion', {}), 'NOT_FOUND');
});

test('party.spend raises stats and pools; rejections', () => {
    const levelled = run(withPc(), 'party.grantXp', { xp: 100 }).state;
    const ren = pcOf(levelled);
    assert.equal(ren.points, 4);
    const out = run(levelled, 'party.spend', { points: { VIT: 2, STR: 1 } });
    assert.ok(out.ok, out.message);
    const after = pcOf(out.state);
    assert.equal(after.points, 1);
    assert.equal(after.stats.VIT, ren.stats.VIT + 2);
    assert.equal(after.hp.max, ren.hp.max + 16);
    assert.equal(out.result.summary, 'Ren spends 3 points: STR 10, VIT 10.');
    rejects(run(levelled, 'party.spend', { points: { STR: 5 } }), 'REFUSED', /5 points asked, 4 unspent/);
    rejects(run(levelled, 'party.spend', { points: {} }), 'INVALID', /where the points go/);
    rejects(run(levelled, 'party.spend', { points: { STR: -1 } }), 'INVALID');
    rejects(run(levelled, 'party.spend', { points: { STR: 4 } }, { settings: { statCap: 10 } }), 'REFUSED', /no higher than 10/);
    rejects(run(levelled, 'party.spend', { actor: 'ac_nobody00', points: { STR: 1 } }), 'NOT_FOUND');
    rejects(run(makeState(), 'party.spend', { points: { STR: 1 } }), 'NOT_FOUND', /Make your character first/);
});

test('party.learnSkill: library, requirements, templates kept in party.custom, the active cap', () => {
    const state = withPc();
    const out = run(state, 'party.learnSkill', { name: 'power strike' });
    assert.ok(out.ok, out.message);
    assert.deepEqual(pcOf(out.state).skills, [{ name: 'Power Strike', level: 1, uses: 0, active: true }]);
    rejects(run(out.state, 'party.learnSkill', { name: 'Power Strike' }), 'REFUSED', /already knows/);
    rejects(run(state, 'party.learnSkill', { name: 'Cleave' }), 'REFUSED', /needs STR 10/);
    assert.ok(run(state, 'party.learnSkill', { name: 'Cleave', free: true }).ok);
    rejects(run(state, 'party.learnSkill', { name: 'Moon Kick' }), 'NOT_FOUND');
    rejects(run(state, 'party.learnSkill', { name: '' }), 'INVALID');
    const taught = run(state, 'party.learnSkill', { name: 'Shadow Cut', template: { type: 'physical', stat: 'AGI', target: 'one' } });
    assert.ok(taught.ok, taught.message);
    const custom = taught.state.domains.party.custom['Shadow Cut'];
    assert.equal(custom.stat, 'AGI');
    assert.equal(custom.type, 'physical');
    // At the cap a skill must sit out.
    let full = state;
    for (const name of ['Power Strike', 'Quick Stab', 'Shield Bash', 'Sweep', 'Aimed Shot', 'Poison Dart']) full = run(full, 'party.learnSkill', { name }).state;
    rejects(run(full, 'party.learnSkill', { name: 'Mend' }), 'REFUSED', /choose one to set aside/);
    const swapped = run(full, 'party.learnSkill', { name: 'Mend', setAside: 'Sweep' });
    assert.ok(swapped.ok, swapped.message);
    assert.equal(pcOf(swapped.state).skills.find(skill => skill.name === 'Sweep').active, false);
    const benched = run(full, 'party.learnSkill', { name: 'Mend', setAside: 'Mend' });
    assert.match(benched.result.summary, /set aside for now/);
});

test('party.setSkillActive and party.forgetSkill', () => {
    let state = withPc({ name: 'Ren', preset: 'fighter' });
    const aside = run(state, 'party.setSkillActive', { name: 'Sweep', active: false });
    assert.ok(aside.ok);
    assert.equal(pcOf(aside.state).skills.find(skill => skill.name === 'Sweep').active, false);
    rejects(run(aside.state, 'party.setSkillActive', { name: 'Sweep', active: false }), 'REFUSED', /already set aside/);
    assert.ok(run(aside.state, 'party.setSkillActive', { name: 'Sweep', active: true }).ok);
    rejects(run(state, 'party.setSkillActive', { name: 'Fireball', active: true }), 'NOT_FOUND');
    // At the cap, taking one up needs a swap.
    for (const name of ['Quick Stab', 'Shield Bash', 'Aimed Shot', 'Poison Dart', 'Mend']) state = run(state, 'party.learnSkill', { name, setAside: 'Mend' }).state;
    rejects(run(state, 'party.setSkillActive', { name: 'Mend', active: true }), 'REFUSED', /set one aside first/);
    const swap = run(state, 'party.setSkillActive', { name: 'Mend', active: true, swapOut: 'Sweep' });
    assert.ok(swap.ok, swap.message);
    const forgot = run(state, 'party.forgetSkill', { name: 'Sweep' });
    assert.ok(forgot.ok);
    assert.equal(pcOf(forgot.state).skills.some(skill => skill.name === 'Sweep'), false);
    rejects(run(state, 'party.forgetSkill', { name: 'Fireball' }), 'NOT_FOUND');
});

function hurt(state, id, hp, extra = {}) {
    const next = structuredClone(state);
    Object.assign(next.domains.party.actors[id], { hp: { ...next.domains.party.actors[id].hp, cur: hp }, ...extra });
    return next;
}

test('party.rest short and long', () => {
    const base = withCompanion();
    const pc = base.domains.party.pc;
    const state = hurt(base, pc, 10, { mp: { cur: 0, max: 40 }, conditions: [{ kind: 'poison', stacks: 2 }, { kind: 'exhausted', stacks: 1 }] });
    const short = run(state, 'party.rest', { kind: 'short' });
    assert.ok(short.ok, short.message);
    const max = pcOf(state).hp.max;
    assert.equal(pcOf(short.state).hp.cur, 10 + Math.floor(max * 0.25));
    assert.equal(pcOf(short.state).conditions.length, 2);
    assert.match(short.result.summary, /^The party takes a short rest: Ren HP \+/);
    const long = run(state, 'party.rest', { kind: 'long', reason: 'a night at the inn' });
    assert.equal(pcOf(long.state).hp.cur, max);
    assert.deepEqual(pcOf(long.state).conditions, [{ kind: 'exhausted', stacks: 1 }]);
    assert.match(long.result.summary, /long rest \(a night at the inn\)/);
    const idle = run(base, 'party.rest', { kind: 'long' });
    assert.ok(idle.ok);
    assert.match(idle.result.summary, /Nobody needed it/);
    rejects(run(state, 'party.rest', { kind: 'nap' }), 'INVALID');
    rejects(run(makeState(), 'party.rest', { kind: 'long' }), 'NOT_FOUND');
    rejects(run(state, 'party.rest', { kind: 'long', actors: ['ac_nobody00'] }), 'NOT_FOUND');
});

test('party.rest recomputes the maxima with the gear the member wears', () => {
    const base = withPc();
    const pc = base.domains.party.pc;
    const state = structuredClone(base);
    state.domains.inventory.defs['story/iron-helm'] = { id: 'story/iron-helm', name: 'Iron Helm', kind: 'equipment', rarity: 'rare', value: 0, stack: false, slot: 'worn', stats: { HP: 20 }, effect: {}, tags: [], note: '' };
    state.domains.inventory.stacks.it_aaaaaaaa = { id: 'it_aaaaaaaa', def: 'story/iron-helm', qty: 1, owner: pc, equipped: 'worn', note: '', from: '' };
    const out = run(state, 'party.rest', { kind: 'long' });
    assert.equal(pcOf(out.state).hp.max, pcOf(base).hp.max + 20);
    assert.equal(pcOf(out.state).hp.cur, pcOf(base).hp.max + 20);
});

test('party.heal and party.restore: HP, MP, SP, cures; nothing to do is refused', () => {
    const base = withPc();
    const pc = base.domains.party.pc;
    const state = hurt(base, pc, 20, { mp: { cur: 5, max: pcOf(base).mp.max }, sp: { cur: 1, max: pcOf(base).sp.max }, conditions: [{ kind: 'poisoned', stacks: 1 }] });
    const healed = run(state, 'party.heal', { actor: pc, hp: 20, item: 'Minor Healing Draught' });
    assert.ok(healed.ok, healed.message);
    assert.equal(pcOf(healed.state).hp.cur, 40);
    assert.equal(healed.result.summary, `Ren: +20 HP (now 40/${pcOf(state).hp.max} HP).`);
    const restored = run(state, 'party.restore', { actor: pc, mp: 4, sp: 3, cure: ['poison'] });
    assert.ok(restored.ok);
    assert.equal(pcOf(restored.state).mp.cur, 9);
    assert.equal(pcOf(restored.state).sp.cur, 4);
    assert.deepEqual(pcOf(restored.state).conditions, []);
    assert.deepEqual(restored.result.data.cured, ['poisoned']);
    const capped = run(state, 'party.heal', { actor: pc, hp: 999 });
    assert.equal(pcOf(capped.state).hp.cur, pcOf(state).hp.max);
    rejects(run(base, 'party.heal', { actor: pc, hp: 20 }), 'REFUSED', /does not need that now/);
    rejects(run(state, 'party.heal', { actor: pc, hp: -5 }), 'INVALID');
    rejects(run(state, 'party.heal', { actor: pc, hp: 2.5 }), 'INVALID');
    rejects(run(state, 'party.restore', { actor: pc, cure: ['burn'] }), 'REFUSED');
    rejects(run(state, 'party.heal', { hp: 5 }), 'NOT_FOUND');
});

function fightResult(state, overrides = {}) {
    const party = state.domains.party;
    return {
        outcome: 'victory', stakes: 'normal',
        party: party.order.map(id => ({ memberId: id, name: party.actors[id].name, level: 1, hp: { cur: 12, max: party.actors[id].hp.max }, mp: { ...party.actors[id].mp }, sp: { cur: 3, max: party.actors[id].sp.max }, down: false, conditions: [{ name: 'poison', rounds: 2 }] })),
        xp: Object.fromEntries(party.order.map(id => [id, 120])),
        uses: { [party.pc]: { 'Power Strike': 6 } },
        ...overrides,
    };
}

test('party.applyResult writes the fight to each member, levels them and settles companions', () => {
    let state = withCompanion();
    state = run(state, 'party.learnSkill', { name: 'Power Strike' }).state;
    const lyra = byName(state, 'Lyra');
    const out = run(state, 'party.applyResult', { result: fightResult(state) });
    assert.ok(out.ok, out.message);
    const ren = pcOf(out.state);
    assert.equal(ren.level, 2);
    assert.equal(ren.xp, 20);
    assert.equal(ren.points, 4);
    assert.equal(ren.hp.cur, 12 + 4, 'a level-up raises current HP by what max HP grew');
    assert.deepEqual(ren.conditions, [{ kind: 'poisoned', stacks: 2 }], 'v1 poison is kept as poisoned');
    assert.deepEqual(ren.skills[0], { name: 'Power Strike', level: 2, uses: 1, active: true });
    const after = out.state.domains.party.actors[lyra.id];
    assert.equal(after.level, 2);
    assert.equal(after.points, 0, 'a companion on auto spends by build');
    assert.match(out.result.summary, /Ren reaches Level 2; Lyra reaches Level 2/);
    // Commanded companions keep their points; so does everyone with auto-spend off.
    const kept = run(state, 'party.applyResult', { result: fightResult(state) }, { settings: { autoSpend: false } });
    assert.equal(kept.state.domains.party.actors[lyra.id].points, 4);
});

test('party.applyResult reads "pc" as your character; death stakes; rejections', () => {
    const state = withPc();
    const result = fightResult(state);
    const pcId = state.domains.party.pc;
    result.party[0].memberId = 'pc';
    result.xp = { pc: 10 };
    result.uses = {};
    const out = run(state, 'party.applyResult', { result });
    assert.ok(out.ok, out.message);
    assert.equal(pcOf(out.state).xp, 10);
    const lost = run(state, 'party.applyResult', { result: { ...fightResult(state), outcome: 'defeat' }, stakes: 'death' });
    assert.deepEqual(pcOf(lost.state).conditions, [{ kind: 'dead', stacks: 1 }]);
    assert.equal(pcOf(lost.state).hp.cur, 0);
    rejects(run(state, 'party.applyResult', { result: null }), 'INVALID');
    rejects(run(state, 'party.applyResult', { result: { party: [{ memberId: 'ac_nobody00' }], xp: {}, uses: {} } }), 'NOT_FOUND');
    assert.equal(pcId, state.domains.party.pc);
});

test('party.grantXp: amounts, awards by kind or difficulty, claims, the cap', () => {
    const state = withCompanion();
    const lyra = byName(state, 'Lyra');
    const major = run(state, 'party.grantXp', { kind: 'major', reason: 'saved the caravan' });
    assert.ok(major.ok, major.message);
    assert.equal(pcOf(major.state).xp, 25);
    assert.equal(major.result.summary, 'saved the caravan: Ren XP +25; Lyra XP +25.');
    const quest = run(state, 'party.grantXp', { difficulty: 'hard', actors: [state.domains.party.pc] });
    assert.equal(pcOf(quest.state).xp, 15);
    assert.equal(quest.state.domains.party.actors[lyra.id].xp, 0);
    const each = run(state, 'party.grantXp', { xp: { [lyra.id]: 250 } });
    assert.equal(each.state.domains.party.actors[lyra.id].level, 3);
    assert.equal(each.state.domains.party.actors[lyra.id].xp, 50);
    assert.match(each.result.summary, /Lyra XP \+250, reaches Level 3/);
    const rate = run(state, 'party.grantXp', { kind: 'minor' }, { settings: { xpRate: 2 } });
    assert.equal(pcOf(rate.state).xp, 20);
    const once = run(state, 'party.grantXp', { xp: 5, claim: 'quest:q_ab12cd34:xp' });
    assert.ok(once.ok);
    rejects(run(once.state, 'party.grantXp', { xp: 5, claim: 'quest:q_ab12cd34:xp' }), 'CLAIMED');
    rejects(run(state, 'party.grantXp', {}), 'INVALID');
    rejects(run(state, 'party.grantXp', { kind: 'legendary' }), 'INVALID');
    rejects(run(state, 'party.grantXp', { xp: 0 }), 'REFUSED');
    rejects(run(state, 'party.grantXp', { xp: -3 }), 'INVALID');
    rejects(run(state, 'party.grantXp', { xp: 5, actors: ['ac_nobody00'] }), 'NOT_FOUND');
    rejects(run(makeState(), 'party.grantXp', { xp: 5 }), 'NOT_FOUND');
    rejects(run(state, 'party.grantXp', { difficulty: 'banana' }), 'INVALID');
    // Everyone at the level cap: nothing given, and no failure (combat.end must always settle).
    const capped = run(state, 'party.grantXp', { xp: 100 }, { settings: { maxLevel: 1 } });
    assert.ok(capped.ok, capped.message);
    assert.deepEqual(capped.result.data.gains, []);
    assert.equal(capped.result.summary, 'Ren and Lyra are at the level cap: no XP to give.');
    assert.equal(JSON.stringify(capped.state.domains.party), JSON.stringify(state.domains.party));
});

test('check.resolve rolls a d20 + the stat modifier, deterministic per seed', () => {
    const state = withPc();
    const one = run(state, 'check.resolve', { skill: 'stealth', dc: 'hard', what: 'slipping past the guard' }, { seed: 42 });
    const two = run(state, 'check.resolve', { skill: 'stealth', dc: 'hard', what: 'slipping past the guard' }, { seed: 42 });
    assert.ok(one.ok, one.message);
    assert.deepEqual(one.result, two.result);
    assert.equal(one.result.data.stat, 'DEX');
    assert.equal(one.result.data.mod, 1, 'DEX 7 → +1');
    assert.equal(one.result.data.dc, 20);
    assert.equal(one.result.data.total, one.result.data.die + 1);
    assert.match(one.result.summary, /^Ren tries stealth \(slipping past the guard\): d20 \d+ \+ 1 DEX = \d+ against 20 \(hard\), /);
    assert.equal(one.state.domains.party, one.state.domains.party, 'a check changes no party state');
    assert.deepEqual(one.state.domains.party, state.domains.party);
    const dice = new Set();
    for (let seed = 1; seed <= 40; seed++) dice.add(run(state, 'check.resolve', { skill: 'persuade', dc: 12 }, { seed }).result.data.die);
    assert.ok(dice.size > 8, 'different seeds roll differently');
    rejects(run(state, 'check.resolve', { skill: 'stealth', dc: 'absurd' }), 'INVALID');
    rejects(run(state, 'check.resolve', { skill: 'stealth', dc: 99 }), 'INVALID');
    rejects(run(state, 'check.resolve', { dc: 'easy' }), 'INVALID');
    rejects(run(makeState(), 'check.resolve', { skill: 'stealth', dc: 'easy' }), 'NOT_FOUND');
    rejects(run(state, 'check.resolve', { skill: 'stealth', who: 'Kael' }), 'NOT_FOUND');
});

test('check.resolve outcomes follow the dice rules', async () => {
    const { outcomeOf, dcOf, statForCheck } = await import('../../../src/v2/party/checks.js');
    assert.equal(outcomeOf(20, -3, 30), 'crit');
    assert.equal(outcomeOf(1, 10, 5), 'critfail');
    assert.equal(outcomeOf(12, 3, 15), 'success');
    assert.equal(outcomeOf(12, 1, 15), 'cost');
    assert.equal(outcomeOf(10, 0, 15), 'fail');
    assert.deepEqual(dcOf('easy'), { dc: 10, word: 'easy' });
    assert.deepEqual(dcOf('normal'), { dc: 15, word: 'normal' });
    assert.deepEqual(dcOf(''), { dc: 15, word: 'normal' });
    assert.deepEqual(dcOf('17'), { dc: 17, word: '' });
    assert.equal(dcOf('0'), null);
    assert.equal(statForCheck('climbing'), 'STR');
    assert.equal(statForCheck('persuasion'), 'CHA');
    assert.equal(statForCheck('acrobatics'), 'AGI');
    assert.equal(statForCheck('arcana'), 'INT');
    assert.equal(statForCheck('int'), 'INT');
    assert.equal(statForCheck('whatever', 'vit'), 'VIT');
    assert.equal(statForCheck('whistling'), 'LUK');
});

test('a check by a named companion uses their stats', () => {
    const state = withCompanion('Lyra', { role: 'rogue', level: 5 });
    const out = run(state, 'check.resolve', { who: 'Lyra', skill: 'agility', dc: 'easy' }, { seed: 3 });
    assert.ok(out.ok, out.message);
    assert.equal(out.result.data.actor, byName(state, 'Lyra').id);
    assert.equal(out.result.data.stat, 'AGI');
});

test('party.acceptOffer and party.dismissOffer', async () => {
    const { capture } = await import('./helpers/fake-ctx.js');
    let state = withPc();
    state = capture(state, '+ join Lyra — the archer | level: 3 | role: ranger').state;
    state = capture(state, '+ skill Ren — Shadow Cut: a blurring slash | taught by: Kael').state;
    const [join, skill] = Object.values(state.domains.party.offers);
    const accepted = run(state, 'party.acceptOffer', { offer: join.id, control: 'player' });
    assert.ok(accepted.ok, accepted.message);
    const lyra = byName(accepted.state, 'Lyra');
    assert.equal(lyra.level, 3);
    assert.equal(lyra.role, 'ranger');
    assert.equal(lyra.control, 'player');
    assert.deepEqual(Object.values(accepted.state.domains.party.offers).map(offer => offer.id), [skill.id]);
    const learned = run(accepted.state, 'party.acceptOffer', { offer: skill.id });
    assert.ok(learned.ok, learned.message);
    assert.equal(pcOf(learned.state).skills[0].name, 'Shadow Cut');
    assert.ok(learned.state.domains.party.custom['Shadow Cut']);
    assert.deepEqual(Object.values(learned.state.domains.party.offers), []);
    const dismissed = run(state, 'party.dismissOffer', { offer: join.id });
    assert.ok(dismissed.ok);
    assert.equal(dismissed.result.summary, 'Lyra does not join.');
    assert.equal(byName(dismissed.state, 'Lyra'), undefined);
    rejects(run(state, 'party.acceptOffer', { offer: 'of_nothing0' }), 'NOT_FOUND');
    rejects(run(state, 'party.dismissOffer', { offer: 'of_nothing0' }), 'NOT_FOUND');
    // A join the party cannot take (a companion of that name came in meanwhile) keeps the offer.
    const clash = run(state, 'party.addCompanion', { name: 'Lyra' }).state;
    const refused = run(clash, 'party.acceptOffer', { offer: join.id });
    rejects(refused, 'REFUSED', /already a Lyra/);
    assert.equal(Object.values(refused.state.domains.party.offers).length, 2);
});

test('sub-commands through ctx.call share the transaction', () => {
    const state = withPc();
    const pc = state.domains.party.pc;
    const hurtState = hurt(state, pc, 5);
    const out = run(hurtState, ctx => {
        ctx.call('party.heal', { actor: pc, hp: 10 });
        return ctx.call('party.grantXp', { xp: 100 });
    });
    assert.ok(out.ok);
    assert.equal(pcOf(out.state).level, 2);
    assert.equal(pcOf(out.state).hp.cur, 15 + 4);
    const failed = run(hurtState, ctx => {
        ctx.call('party.heal', { actor: pc, hp: 10 });
        return ctx.call('party.grantXp', { xp: -1 });
    });
    assert.equal(failed.ok, false);
    assert.equal(pcOf(failed.state).hp.cur, 5, 'nothing saved on rejection');
});

test('handlers draft only the party domain', () => {
    const out = run(withPc(), ctx => ctx.draft('inventory'));
    assert.equal(out.code, 'NOT_OWNER');
});

test('party.applyResult takes combat.end\'s actors payload', () => {
    let state = withPc({ name: 'Ren', preset: 'fighter' });
    state = run(state, 'party.addCompanion', { name: 'Lyra', role: 'archer' }).state;
    const [pc, lyra] = state.domains.party.order;
    const story = structuredClone(state);
    story.domains.party.actors[pc].conditions = [{ kind: 'cursed', stacks: 1 }, { kind: 'poisoned', stacks: 1 }];
    const out = run(story, 'party.applyResult', {
        outcome: 'victory', stakes: 'normal',
        actors: [
            { id: pc, hp: { cur: 9, max: pcOf(state).hp.max }, mp: { cur: 1, max: pcOf(state).mp.max }, sp: { cur: 2, max: pcOf(state).sp.max }, down: false, conditions: [{ kind: 'poison', rounds: 3 }, { kind: 'bleed', rounds: 1 }], uses: { Sweep: 5 } },
            { id: lyra, hp: { cur: 0, max: byName(state, 'Lyra').hp.max }, mp: byName(state, 'Lyra').mp, down: true, conditions: [], uses: {} },
        ],
    });
    assert.ok(out.ok, out.message);
    const ren = pcOf(out.state);
    assert.equal(ren.hp.cur, 9);
    assert.equal(ren.sp.cur, 2);
    assert.deepEqual(ren.conditions, [{ kind: 'poisoned', stacks: 3 }, { kind: 'bleeding', stacks: 1 }, { kind: 'cursed', stacks: 1 }], 'fight conditions replace the old ones; story ones stay');
    assert.equal(ren.skills.find(skill => skill.name === 'Sweep').level, 2);
    assert.equal(ren.xp, 0, 'XP comes through party.grantXp');
    assert.equal(out.state.domains.party.actors[lyra].hp.cur, 0);
    assert.equal(out.state.domains.party.actors[lyra].sp.cur, byName(state, 'Lyra').sp.cur, 'no sp: kept');
    const lost = run(state, 'party.applyResult', { outcome: 'defeat', stakes: 'death', actors: [{ id: pc, hp: { cur: 0, max: 1 }, mp: { cur: 0, max: 1 }, down: true, conditions: [], uses: {} }] });
    assert.deepEqual(pcOf(lost.state).conditions, [{ kind: 'dead', stacks: 1 }]);
    rejects(run(state, 'party.applyResult', { outcome: 'victory', actors: [{ id: 'ac_nobody00', hp: { cur: 1, max: 1 } }] }), 'NOT_FOUND');
});

test('the condition table: v1 fight names are kept as party kinds', async () => {
    const { conditionKind, CONDITION_KINDS } = await import('../../../src/v2/party/sheets.js');
    assert.equal(conditionKind('poison'), 'poisoned');
    assert.equal(conditionKind('Burn'), 'burning');
    assert.equal(conditionKind('bleed'), 'bleeding');
    assert.equal(conditionKind('stun'), 'stunned');
    assert.equal(conditionKind('poisoned'), 'poisoned');
    assert.equal(conditionKind('exhausted'), 'exhausted');
    for (const name of ['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'shield', 'regen', 'guard']) assert.ok(CONDITION_KINDS[name], name);
});

test('§F5 payloads exactly: party.heal { actor, hp, cure }, party.restore { actor, mp?, sp? }', () => {
    const base = withPc();
    const pc = base.domains.party.pc;
    const state = structuredClone(base);
    Object.assign(state.domains.party.actors[pc], { hp: { ...pcOf(base).hp, cur: 10 }, mp: { ...pcOf(base).mp, cur: 0 }, sp: { ...pcOf(base).sp, cur: 0 }, conditions: [{ kind: 'poisoned', stacks: 1 }] });
    const healed = run(state, 'party.heal', { actor: pc, hp: 15, cure: ['poison'] });
    assert.ok(healed.ok, healed.message);
    assert.equal(pcOf(healed.state).hp.cur, 25);
    assert.deepEqual(pcOf(healed.state).conditions, []);
    const cureOnly = run(state, 'party.heal', { actor: pc, hp: 0, cure: ['poison'] });
    assert.ok(cureOnly.ok, cureOnly.message);
    assert.equal(pcOf(run(state, 'party.restore', { actor: pc, mp: 6 }).state).mp.cur, 6);
    assert.equal(pcOf(run(state, 'party.restore', { actor: pc, sp: 4 }).state).sp.cur, 4);
    rejects(run(base, 'party.restore', { actor: pc, mp: 6 }), 'REFUSED');
});

test('portraits: kept on the record, given at creation or by edit, NPC ones through NSD', () => {
    const made = run(makeState(), 'party.create', { name: 'Ren', preset: 'fighter', portrait: '/User Avatars/ren.png' });
    assert.ok(made.ok, made.message);
    assert.equal(pcOf(made.state).portrait, '/User Avatars/ren.png');
    assert.equal(part.queries['party.pc'](made.state).portrait, '/User Avatars/ren.png');
    rejects(run(makeState(), 'party.create', { name: 'Ren', preset: 'fighter', portrait: 'javascript:alert(1)' }), 'INVALID');
    let state = run(made.state, 'party.addCompanion', { name: 'Lyra', npc: 'Lyra' }).state;
    const lyra = byName(state, 'Lyra');
    assert.equal(lyra.portrait, null);
    const tools = { query: (name, args) => (name === 'npc.portrait' && args.name === 'Lyra' ? '/characters/lyra.png' : null) };
    assert.equal(part.queries['party.actor'](state, { id: lyra.id }, tools).portrait, '/characters/lyra.png');
    assert.deepEqual(part.queries['party.actors'](state, {}, tools).map(actor => actor.portrait), ['/User Avatars/ren.png', '/characters/lyra.png']);
    assert.equal(part.queries['party.actor'](state, { id: lyra.id }, { query: () => { throw new Error('no NSD'); } }).portrait, null);
    state = run(state, 'party.edit', { actor: lyra.id, portrait: 'https://example.org/lyra.webp' }).state;
    assert.equal(part.queries['party.actor'](state, { id: lyra.id }, tools).portrait, 'https://example.org/lyra.webp');
    assert.deepEqual(part.domains.party.validate(state.domains.party), []);
    const broken = structuredClone(state.domains.party);
    broken.actors[lyra.id].portrait = 42;
    assert.ok(part.domains.party.validate(broken).some(error => /portrait/.test(error)));
});

test('canGenerate: no story reply until your character is made (§F12)', () => {
    const { canGenerate } = part.hooks;
    assert.deepEqual(canGenerate({ state: makeState() }), { ok: false, reason: 'Create your character first.', action: 'Create your character' });
    assert.deepEqual(canGenerate({ state: { domains: {} } }), { ok: false, reason: 'Create your character first.', action: 'Create your character' });
    assert.deepEqual(canGenerate(null), { ok: false, reason: 'Create your character first.', action: 'Create your character' });
    assert.deepEqual(canGenerate({ state: withPc() }), { ok: true });
});
