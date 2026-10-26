// Forms as the pack writes them, as the engine's skills (src/v2/fight/forms.js), for tests that build a fight by hand.
import { formSkill } from '../../../../src/v2/fight/forms.js';

export const form = (name, type, stat, effects, cost = {}) => formSkill({ id: `pack.t/${name}-base`, skill: `pack.t/${name}`, name, type, stat, tier: 0,
    cost: { mp: cost.mp ?? 0, sp: cost.sp ?? 0, cooldown: cost.cooldown ?? 0 }, effects, unit: null }, cost.mastery ?? 0);
export const damage = (power, damageType = 'physical') => ({ op: 'damage', target: 'one', power, element: 'none', damageType });
export const condition = (kind, rounds, chance, target) => ({ op: 'condition', target, kind, rounds, chance });
