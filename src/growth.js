// Growth outside fights (0.4): XP the story awards, levels from it, and companions on auto
// spending what a level gives them. A fight's XP goes through sheet.applyResult; so does an
// award here, so a level reached either way grows a sheet the same (maxima, points, MAX at the
// cap). The story only names how big an achievement was (minor, major, milestone) or how hard a
// quest Story Director closed (easy … nightmare); the award is that share of the XP the member
// needs for their next level, so it means the same at level 2 and level 40, at the reader's XP
// rate (rules.xpRate, 0.5.2) like every other gain. Pure.

import { DEFAULT_RULES, scaleXp, xpToNext } from './rules.js';
import { applyResult, spendPoints } from './sheet.js';
import { buildAllocation } from './builds.js';
import { maxLevel } from './terms.js';

export const XP_KINDS = Object.freeze(['minor', 'major', 'milestone']);
export const QUEST_DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard', 'nightmare']);

/** A quest's difficulty as Story Director writes it; missing or unknown is 'normal'. */
export function questDifficulty(value) {
    const word = String(value ?? '').trim().toLowerCase();
    return QUEST_DIFFICULTIES.includes(word) ? word : 'normal';
}

/** The share of the next level an award is: rules.xpAwards[kind] or rules.questXp[difficulty]. */
export function awardShare({ kind = null, difficulty = null } = {}, rules = DEFAULT_RULES) {
    const table = kind ? { ...DEFAULT_RULES.xpAwards, ...(rules?.xpAwards ?? {}) } : { ...DEFAULT_RULES.questXp, ...(rules?.questXp ?? {}) };
    const share = Number(table[kind ?? questDifficulty(difficulty)]);
    return Number.isFinite(share) && share > 0 ? share : 0;
}

/**
 * The XP an award of `share` is worth at `level`: that share of xpToNext, rounded, at the XP
 * rate (scaleXp); 0 at the cap. The offers show this number and awardParty gives it.
 */
export function xpAward(share, level, rules = DEFAULT_RULES) {
    const lv = Math.max(1, Math.round(Number(level) || 1));
    if (lv >= maxLevel(rules)) return 0;
    return scaleXp(Math.max(0, Math.round((Number(share) || 0) * xpToNext(lv, rules))), rules);
}

/** `amount` XP on a sheet, levels and points as a fight's would: applyResult's { sheet, levelsGained, pointsGained }. */
export function gainXp(sheet, amount, rules = DEFAULT_RULES) {
    const { sheet: next, levelsGained, pointsGained } = applyResult(sheet, 'award', { xp: { award: amount } }, rules);
    return { sheet: next, levelsGained, pointsGained };
}

/** A companion's unspent points spent in their build's proportions (builds.buildAllocation); the sheet as is with none. */
export function spendByBuild(sheet, rules = DEFAULT_RULES) {
    const allocation = buildAllocation(sheet, rules);
    return Object.keys(allocation).length ? spendPoints(sheet, allocation, rules) : sheet;
}

/**
 * Companions after their sheets moved on (a fight, an award): those on auto spend their
 * points by build when `autoSpend` is on; commanded ones (and everyone with it off) keep them
 * to Spend by hand.
 */
export function settleCompanions(members, { autoSpend = true, rules = DEFAULT_RULES } = {}) {
    return (members ?? []).map(member => (autoSpend && member.control !== 'command' && member.sheet?.points > 0 ? { ...member, sheet: spendByBuild(member.sheet, rules) } : member));
}

/**
 * An award to the whole party, each at their own level: { pc, members, gains: [{ memberId, name,
 * xp, levelsGained }] }. Companions then settle (auto-spend). `share` from awardShare.
 */
export function awardParty({ pc = null, members = [] } = {}, share, { autoSpend = true, rules = DEFAULT_RULES } = {}) {
    const gains = [];
    let nextPc = pc;
    if (pc) {
        const xp = xpAward(share, pc.level, rules);
        const out = gainXp(pc, xp, rules);
        nextPc = out.sheet;
        gains.push({ memberId: 'pc', name: pc.name, xp, levelsGained: out.levelsGained });
    }
    const raised = (members ?? []).map(member => {
        const xp = xpAward(share, member.sheet.level, rules);
        const out = gainXp(member.sheet, xp, rules);
        gains.push({ memberId: member.id, name: member.name, xp, levelsGained: out.levelsGained });
        return { ...member, sheet: out.sheet };
    });
    return { pc: nextPc, members: settleCompanions(raised, { autoSpend, rules }), gains };
}
