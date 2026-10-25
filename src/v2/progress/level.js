// RPG Battle v2, level and XP from the pinned ruleset (contract §4 Constants, §5 "xpPerLevel"). Every level
// costs the same `xpPerLevel` XP (the approved default is 100; the pack may choose any multiple of ten from 10
// to 10000), the character starts at level 1 with `startPoints` stat points and gets `pointsPerLevel` more for
// each level, up to `levelCap`. XP keeps counting while a promotion or path is waiting: no choice holds a level back.
//
// The party part already keeps a member's XP as an `earned` count and its level steps, and fits the level
// where it is read, so a deleted award takes back the levels it paid for (party/pools.js earnedLevel). This
// file does not replace that: it works out the same numbers from the pin (`levelFromEarned`) and gives the
// retained rules adapter (`partyRules`) that makes the party's xpToNext cost exactly what the pin says.
// Pure.

import { xpPerLevelProblem } from '../rules/pin.js';

export { xpPerLevelProblem };

/** XP from `level` to the next one under the pin, or null at the cap. */
export function xpToNext(level, constants) {
    return level >= constants.levelCap ? null : constants.xpPerLevel;
}

/** Total XP a character needs to be at `level` from level 1 (the XP it takes to reach it). */
export const xpToReach = (level, constants) => (Math.min(level, constants.levelCap) - constants.startLevel) * constants.xpPerLevel;

/**
 * Where `earned` XP puts a character: { level, xp (toward the next level), xpToNext (null at the cap), capped }.
 * At the cap XP stops piling up (xp 0), like the party's sheet.
 */
export function levelFromEarned(earned, constants) {
    const total = Math.max(0, Math.trunc(Number(earned) || 0));
    const levels = Math.min(Math.floor(total / constants.xpPerLevel), constants.levelCap - constants.startLevel);
    const level = constants.startLevel + levels;
    const capped = level >= constants.levelCap;
    return { level, xp: capped ? 0 : total - levels * constants.xpPerLevel, xpToNext: capped ? null : constants.xpPerLevel, capped };
}

/** Stat points a character has earned at `level` (before any are spent): startPoints + pointsPerLevel per level above 1. */
export const pointsAt = (level, constants) => constants.startPoints + (Math.min(Math.max(level, constants.startLevel), constants.levelCap) - constants.startLevel) * constants.pointsPerLevel;

/**
 * The reader's settings with the pinned ruleset's numbers laid over them (contract §5: "a pinned ruleset overrides the reader's
 * xpBase, maxLevel, startPoints, pointsPerLevel" and the stat cap). `rules`: the `rules` slice; without a pin the same settings
 * object comes back, so a chat that runs no ruleset is untouched. Pure.
 */
export function pinnedSettings(settings, rules) {
    const constants = rules?.pin?.resolved?.constants;
    if (!constants) return settings;
    return { ...settings, startPoints: constants.startPoints, pointsPerLevel: constants.pointsPerLevel, statCap: constants.statCap, xpBase: constants.xpPerLevel, maxLevel: constants.levelCap };
}

/**
 * The party part's rules settings for a pin: the retained adapter of the contract (§5): xpBase = xpPerLevel,
 * xpExponent 0, the level cap, and the starting numbers. Laid over DEFAULT_RULES by makeRules.
 */
export const partyRules = constants => ({
    character: {
        startStat: constants.startStat,
        startPoints: constants.startPoints,
        pointsPerLevel: constants.pointsPerLevel,
        statCap: constants.statCap,
        xpBase: constants.xpPerLevel,
        xpExponent: 0,
        maxLevel: constants.levelCap,
    },
});
