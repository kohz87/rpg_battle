// From the sheets to the fighters: a Character sheet (or a Party member) with its gear and
// consumables becomes a Combatant, and the setup's enemy rows become projected enemies. Pure.

import { STATS, derive, maxHp, maxMp } from './rules.js';
import { resolveSkills } from './skills.js';
import { projectEnemy } from './enemies.js';
import { consumables, gearBonuses, parseGearEntry } from './items.js';
import { newSheet, recompute, slug } from './sheet.js';

const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

/**
 * A party Combatant from a sheet: stats plus gear, max HP/MP with gear bonuses, current HP/MP
 * from the sheet (clamped), skills resolved against the library, consumables from `items`.
 */
export function combatantFromSheet(sheet, { memberId = 'pc', controller = 'player', gear = [], items = [], library = [], rules }) {
    const bonus = gearBonuses(gear, sheet.level, rules);
    const stats = { ...sheet.stats };
    const withGear = Object.fromEntries(Object.entries(stats).map(([name, value]) => [name, value + (Number(bonus[name]) || 0)]));
    const hpMax = maxHp(withGear, sheet.level, rules, bonus.HP);
    const mpMax = maxMp(withGear, sheet.level, rules, bonus.MP);
    const numbers = derive(stats, bonus, rules);
    return {
        id: memberId,
        memberId,
        name: sheet.name || 'You',
        side: 'party',
        controller,
        level: sheet.level,
        rank: null,
        role: null,
        boss: false,
        stats: withGear,
        hp: { cur: clampInt(sheet.hp?.cur ?? hpMax, 0, hpMax), max: hpMax },
        mp: { cur: clampInt(sheet.mp?.cur ?? mpMax, 0, mpMax), max: mpMax },
        ...numbers,
        skills: resolveSkills(sheet.skills ?? [], library, sheet.level, rules).map(skill => ({ ...skill, cooldownLeft: 0 })),
        items: consumables(items),
        conditions: (sheet.conditions ?? []).filter(entry => entry.rounds).map(entry => ({ name: entry.name, rounds: entry.rounds, power: 0 })),
        morale: 0,
        talks: false,
        fleesBelow: 0,
        xp: 0,
        loot: null,
        gone: null,
        capped: bonus.capped ?? [],
    };
}

/** The enemies for setup rows [{ name, count, rank, role, boss }], with stable ids e1, e2… */
export function enemiesFromRows(rows, { bestiary, library, rules, rng }) {
    const enemies = [];
    for (const row of rows ?? []) {
        const name = String(row?.name ?? '').trim();
        if (!name) continue;
        const count = clampInt(row.count ?? 1, 1, 9);
        for (let n = 1; n <= count; n++) {
            const id = `e${enemies.length + 1}`;
            const enemy = projectEnemy({ name, rank: row.rank || null, role: row.role || null, boss: Boolean(row.boss) }, { bestiary, library, rules, rng, id });
            // Several of a kind are told apart by letter: "Goblin A", "Goblin B".
            enemies.push({ ...enemy, id, name: count > 1 ? `${name} ${String.fromCharCode(64 + n)}` : name });
        }
    }
    return enemies;
}

/**
 * A new companion: { name, role, control, level, preset, gearLines } → Member. Built like a
 * character (start stats + the preset's points), then raised to `level` with its extra points
 * spread in the preset's proportions, so a level-6 healer joins as a level-6 healer. `gearLines`
 * are Equipped entries ("Ashwood Staff (rare) · MATK +7"), one per line.
 */
export function newCompanion({ name, role = 'companion', control = 'auto', level = 1, preset, gearLines = '' }, { rules, existing = [] }) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('Give the companion a name.');
    if (!preset) throw new Error('Pick a preset for the companion.');
    const target = Math.max(1, Math.min(rules.character.maxLevel, Math.round(Number(level) || 1)));
    let sheet = newSheet({ name: trimmed, stats: preset.points, skills: preset.skills }, rules);
    const extra = (target - 1) * rules.character.pointsPerLevel;
    if (extra > 0) {
        // A preset with no points spreads evenly.
        const raw = STATS.map(stat => Math.max(0, Number(preset.points?.[stat]) || 0));
        const weights = raw.some(Boolean) ? raw : raw.map(() => 1);
        const total = weights.reduce((sum, value) => sum + value, 0);
        // Largest remainder, so the shares add up exactly.
        const shares = STATS.map((stat, index) => {
            const exact = extra * weights[index] / total;
            return { stat, whole: Math.floor(exact), rest: exact - Math.floor(exact) };
        });
        let left = extra - shares.reduce((sum, entry) => sum + entry.whole, 0);
        for (const entry of [...shares].sort((a, b) => b.rest - a.rest)) {
            if (left <= 0) break;
            entry.whole += 1;
            left -= 1;
        }
        sheet = { ...sheet, level: target, stats: Object.fromEntries(shares.map(entry => [entry.stat, sheet.stats[entry.stat] + entry.whole])) };
    }
    const gear = String(gearLines ?? '').split(/\n|\s+\|\s+/).map(line => line.trim()).filter(Boolean).map(parseGearEntry);
    sheet = recompute({ ...sheet, hp: { cur: Infinity, max: 0 }, mp: { cur: Infinity, max: 0 } }, gear, rules);
    const taken = new Set(['pc', ...existing.map(member => member.id)]);
    let id = slug(trimmed) || 'companion';
    for (let n = 2; taken.has(id); n++) id = `${slug(trimmed) || 'companion'}-${n}`;
    return { id, name: trimmed, role: String(role ?? '').trim() || 'companion', control: control === 'command' ? 'command' : 'auto', sheet, gear };
}
