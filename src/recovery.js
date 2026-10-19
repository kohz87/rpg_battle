// Recovery out of a fight: resting, items used at camp, and HP and MP that come back as story
// time passes (DESIGN §8.5). The story decides when; these functions only do the sums. Pure.

import { DEFAULT_RULES, makeRules } from './rules.js';
import { recompute } from './sheet.js';

// Conditions a fight puts on; a full rest ends them. Story conditions ("exhausted", "cursed")
// stay until the story lifts them.
const FIGHT_CONDITIONS = ['poison', 'burn', 'bleed', 'stun', 'slow', 'weaken', 'shield', 'regen', 'guard'];

const rulesOf = rules => (rules?.recovery ? rules : makeRules(rules ?? null));
const isFightCondition = name => FIGHT_CONDITIONS.some(base => String(name ?? '').toLowerCase().startsWith(base));

function healBy(sheet, hp, mp, sp = 0) {
    const next = structuredClone(sheet);
    next.hp.cur = Math.min(next.hp.max, Math.max(0, next.hp.cur + Math.max(0, Math.floor(hp))));
    next.mp.cur = Math.min(next.mp.max, Math.max(0, next.mp.cur + Math.max(0, Math.floor(mp))));
    if (next.sp) next.sp.cur = Math.min(next.sp.max, Math.max(0, next.sp.cur + Math.max(0, Math.floor(sp))));
    return next;
}

// (0.5.29) Stamina is breath: any rest fills it.
const fullSp = sheet => sheet.sp?.max ?? 0;

/**
 * A rest: 'short' gives back shortRestShare of max HP and MP; 'long' fills both and ends fight
 * conditions. Max HP/MP are first recomputed from stats, level and `gear` (what is worn now).
 */
export function rest(sheet, kind, { gear = null, rules = DEFAULT_RULES } = {}) {
    const r = rulesOf(rules);
    const base = gear ? recompute(sheet, gear, r) : structuredClone(sheet);
    if (kind === 'long') {
        const next = healBy(base, base.hp.max, base.mp.max, fullSp(base));
        next.conditions = (next.conditions ?? []).filter(entry => !isFightCondition(entry.name));
        return next;
    }
    const share = r.recovery.shortRestShare;
    return healBy(base, base.hp.max * share, base.mp.max * share, fullSp(base));
}

/**
 * HP and MP back for `hours` of story time: a full rest at longRestHours or more, otherwise
 * perHour of max per hour (rounded down). { sheet, kind: 'long' | 'regen' | null, hp, mp } with
 * hp/mp the amounts actually gained.
 */
export function recoverOverTime(sheet, hours, { gear = null, rules = DEFAULT_RULES } = {}) {
    const r = rulesOf(rules);
    const h = Number(hours);
    if (!(h > 0)) return { sheet, kind: null, hp: 0, mp: 0, sp: 0 };
    let next;
    let kind;
    if (h >= r.recovery.longRestHours) {
        next = rest(sheet, 'long', { gear, rules: r });
        kind = 'long';
    } else {
        next = healBy(sheet, sheet.hp.max * r.recovery.perHour * h, sheet.mp.max * r.recovery.perHour * h, (sheet.sp?.max ?? 0) * (r.recovery.spPerHour ?? 1) * h);
        kind = 'regen';
    }
    const hp = next.hp.cur - sheet.hp.cur;
    const mp = next.mp.cur - sheet.mp.cur;
    const sp = (next.sp?.cur ?? 0) - (sheet.sp?.cur ?? 0);
    const changed = hp || mp || sp || (next.conditions?.length ?? 0) !== (sheet.conditions?.length ?? 0);
    return changed ? { sheet: next, kind, hp, mp, sp } : { sheet, kind: null, hp: 0, mp: 0, sp: 0 };
}

/**
 * A consumable used outside a fight: its heal, MP and cures applied. { sheet, used, message }:
 * an item that only does damage (a fire flask) cannot be used on yourself, and one that would
 * change nothing (full HP, nothing to cure) is not spent.
 */
export function useItemOutside(sheet, item) {
    const effect = item?.effect;
    if (!effect || (!effect.heal && !effect.mp && !effect.cure?.length)) {
        return { sheet, used: false, message: `${item?.name ?? 'That'} can only be used in a fight.` };
    }
    let next = healBy(sheet, effect.heal ?? 0, effect.mp ?? 0);
    const cured = [];
    if (effect.cure?.length) {
        next.conditions = (next.conditions ?? []).filter(entry => {
            const hit = effect.cure.some(name => String(entry.name).toLowerCase().startsWith(String(name).toLowerCase()));
            if (hit) cured.push(entry.name);
            return !hit;
        });
    }
    const hp = next.hp.cur - sheet.hp.cur;
    const mp = next.mp.cur - sheet.mp.cur;
    if (!hp && !mp && !cured.length) return { sheet, used: false, message: `${sheet.name} does not need the ${item.name} now.` };
    const parts = [hp ? `+${hp} HP` : '', mp ? `+${mp} MP` : '', cured.length ? `cured ${cured.join(', ')}` : ''].filter(Boolean);
    return { sheet: next, used: true, message: `${sheet.name} uses the ${item.name}: ${parts.join(', ')}.` };
}

/**
 * A rest the story offered (<Rest>, 0.4), on a reply whose story time may already have healed
 * the party (recoverOverTime, written into that same reply). The two are one stretch of time,
 * not two: a short rest gives only what its share adds beyond what the clock already gave
 * (`already`: { hp, mp } that reply's recovery), so the result is the larger of the two, not
 * their sum; a long rest fills everything anyway, which makes the clock's part moot. Wounds
 * taken in that reply stay taken: only the missing part of the rest is added on top.
 */
export function restAfter(sheet, kind, { gear = null, rules = DEFAULT_RULES, already = null } = {}) {
    if (kind === 'long') return rest(sheet, 'long', { gear, rules });
    const r = rulesOf(rules);
    const base = gear ? recompute(sheet, gear, r) : structuredClone(sheet);
    const share = r.recovery.shortRestShare;
    const hp = Math.max(0, Math.floor(base.hp.max * share) - Math.max(0, Number(already?.hp) || 0));
    const mp = Math.max(0, Math.floor(base.mp.max * share) - Math.max(0, Number(already?.mp) || 0));
    return healBy(base, hp, mp, fullSp(base));
}
