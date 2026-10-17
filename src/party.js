// From the sheets to the fighters: a Character sheet (or a Party member) with its gear and
// consumables becomes a Combatant, and the setup's enemy rows become projected enemies. Pure.

import { derive, maxHp, maxMp } from './rules.js';
import { resolveSkills } from './skills.js';
import { projectEnemy } from './enemies.js';
import { consumables, gearBonuses } from './items.js';

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
