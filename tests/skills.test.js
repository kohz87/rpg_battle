// The skill library, presets, templates and resolution of sheet entries (src/skills.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, STATS, makeRules } from '../src/rules.js';
import { DEFAULT_SKILLS, PRESETS, canLearn, effectivePower, findSkill, resolveSkills, skillFromTemplate } from '../src/skills.js';

const TYPES = ['physical', 'magic', 'heal', 'buff', 'debuff'];
const TARGETS = ['one', 'all', 'self', 'ally', 'allies'];
const CONDITIONS = ['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'shield', 'regen', 'guard'];

test('the library has at least 12 open tier-1 skills covering every type', () => {
    const tier1 = DEFAULT_SKILLS.filter(s => s.tier === 1);
    assert.ok(tier1.length >= 12);
    for (const s of tier1) assert.equal(s.requires, null, s.name);
    for (const type of TYPES) assert.ok(tier1.some(s => s.type === type), type);
});

test('at least 10 tier-2/3 skills, each with requirements', () => {
    const higher = DEFAULT_SKILLS.filter(s => s.tier > 1);
    assert.ok(higher.length >= 10);
    for (const s of higher) assert.ok(s.requires && Object.keys(s.requires).length, s.name);
});

test('every skill has a valid shape and a unique name', () => {
    const names = new Set();
    for (const s of DEFAULT_SKILLS) {
        assert.ok(!names.has(s.name.toLowerCase()), `duplicate ${s.name}`);
        names.add(s.name.toLowerCase());
        assert.ok(TYPES.includes(s.type), s.name);
        assert.ok(TARGETS.includes(s.target), s.name);
        assert.ok(STATS.includes(s.stat), s.name);
        assert.ok(s.power >= 0 && s.mp >= 0 && s.cooldown >= 0, s.name);
        assert.equal(typeof s.description, 'string');
        for (const [name, rounds] of Object.entries(s.effect ?? {})) {
            assert.ok(CONDITIONS.includes(name), `${s.name}: ${name}`);
            assert.ok(rounds > 0);
        }
        for (const stat of Object.keys(s.requires ?? {})) assert.ok(STATS.includes(stat));
    }
});

// (v2 wave C) A preset may start with a tier-2 skill its own stats open (the caster's Fireball, the
// skirmisher's and the archer's Volley): every preset has a way to meet a group.
test('presets spend exactly the start points on three skills their stats open', () => {
    assert.deepEqual(PRESETS.map(p => p.id), ['fighter', 'skirmisher', 'caster', 'healer', 'archer']);
    for (const preset of PRESETS) {
        const sum = Object.values(preset.points).reduce((a, b) => a + b, 0);
        assert.equal(sum, DEFAULT_RULES.character.startPoints, preset.id);
        for (const stat of Object.keys(preset.points)) assert.ok(STATS.includes(stat));
        assert.equal(preset.skills.length, DEFAULT_RULES.character.starterSkills);
        const stats = Object.fromEntries(STATS.map(stat => [stat, DEFAULT_RULES.character.startStat + (preset.points[stat] ?? 0)]));
        for (const name of preset.skills) {
            const skill = findSkill(DEFAULT_SKILLS, name);
            assert.ok(skill && skill.tier <= 2, name);
            assert.equal(canLearn(stats, skill).ok, true, `${preset.id}: ${name}`);
        }
    }
});

test('findSkill ignores case, spacing and a mastery suffix', () => {
    assert.equal(findSkill(DEFAULT_SKILLS, 'power strike').name, 'Power Strike');
    assert.equal(findSkill(DEFAULT_SKILLS, '  POWER   STRIKE ').name, 'Power Strike');
    assert.equal(findSkill(DEFAULT_SKILLS, 'Rending Strike (Lv 2)').name, 'Rending Strike');
    assert.equal(findSkill(DEFAULT_SKILLS, 'Nope'), null);
    assert.equal(findSkill(DEFAULT_SKILLS, ''), null);
});

test('canLearn reports the missing points per stat', () => {
    const fireball = findSkill(DEFAULT_SKILLS, 'Fireball');
    assert.deepEqual(canLearn({ INT: 9 }, fireball), { ok: true, missing: {} });
    assert.deepEqual(canLearn({ INT: 6 }, fireball), { ok: false, missing: { INT: 3 } });
    assert.equal(canLearn({}, findSkill(DEFAULT_SKILLS, 'Mend')).ok, true);
});

test('skillFromTemplate scales with level and fits the target to the type', () => {
    const low = skillFromTemplate({ name: 'Moon Cut', type: 'physical', stat: 'DEX', target: 'one' }, 1);
    const high = skillFromTemplate({ name: 'Moon Cut', type: 'physical', stat: 'DEX', target: 'one' }, 20);
    assert.equal(low.name, 'Moon Cut');
    assert.equal(low.stat, 'DEX');
    assert.equal(low.requires, null);
    assert.ok(high.power > low.power && high.mp > low.mp);
    assert.ok(high.tier > low.tier);
    const wide = skillFromTemplate({ name: 'Moon Sweep', type: 'physical', target: 'all' }, 1);
    assert.ok(wide.power < low.power && wide.mp > low.mp);
    assert.equal(skillFromTemplate({ name: 'Glow', type: 'heal', target: 'one' }, 1).target, 'ally');
    assert.equal(skillFromTemplate({ name: 'Glow', type: 'heal', target: 'all' }, 1).target, 'allies');
    assert.equal(skillFromTemplate({ name: 'Curse', type: 'debuff', target: 'self' }, 1).target, 'one');
    const odd = skillFromTemplate({ name: 'Odd', type: 'weird', stat: 'XYZ' }, 1);
    assert.equal(odd.type, 'physical');
    assert.equal(odd.stat, 'STR');
    assert.ok(skillFromTemplate({ name: 'Veil', type: 'buff' }, 3).effect.shield > 0);
});

test('effectivePower adds 10% per mastery level, capped at the max', () => {
    const s = { power: 2 };
    assert.equal(effectivePower(s, 1), 2);
    assert.ok(Math.abs(effectivePower(s, 3) - 2.4) < 1e-9);
    assert.equal(effectivePower(s, 99), effectivePower(s, DEFAULT_RULES.masteryMax));
    assert.equal(effectivePower(s, 0), 2);
    assert.equal(effectivePower(s, 2, makeRules({ masteryPowerPerLevel: 0.5 })), 3);
});

test('resolveSkills maps names and entries, templating unknown ones', () => {
    const out = resolveSkills([{ name: 'power strike', mastery: 2 }, 'Mend', { name: 'Bog Fist', mastery: 9 }, { name: '' }], DEFAULT_SKILLS, 4);
    assert.equal(out.length, 3);
    assert.equal(out[0].name, 'Power Strike');
    assert.equal(out[0].mastery, 2);
    assert.equal(out[1].mastery, 1);
    assert.equal(out[2].name, 'Bog Fist');
    assert.equal(out[2].type, 'physical');
    assert.equal(out[2].stat, 'STR');
    assert.equal(out[2].target, 'one');
    assert.equal(out[2].mastery, DEFAULT_RULES.masteryMax);
    // A resolved skill is a copy: changing it never touches the library.
    out[0].power = 99;
    assert.notEqual(findSkill(DEFAULT_SKILLS, 'Power Strike').power, 99);
    const typed = resolveSkills([{ name: 'Glow', type: 'heal', stat: 'INT', target: 'ally' }], [], 1);
    assert.equal(typed[0].type, 'heal');
});
