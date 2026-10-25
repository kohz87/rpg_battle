// RPG Battle v2, skill mastery from credited uses (contract §4 Constants.masteryAt, §5, P19). A form's mastery
// is how many of the pinned steps its credited uses have reached: with the approved steps [1, 5, 12, 22, 35]
// uses 0 / 1 / 5 / 12 / 22 / 35 are mastery 0 / 1 / 2 / 3 / 4 / 5. The top step is the cap: a form at 5/5 earns
// no more uses (credit.js awards 0 with the reason "mastered"), so uses never pass it. Each form counts for
// itself: a new class or path form starts at 0/5. Pure; the steps come from the pinned ruleset.

/** The mastery steps the pin gives (strictly rising whole numbers). */
const stepsOf = masteryAt => (Array.isArray(masteryAt) ? masteryAt : []);

/** The highest mastery there is (5 with the approved steps). */
export const maxMastery = masteryAt => stepsOf(masteryAt).length;

/** The uses at which a form is mastered (35 with the approved steps), the cap on its uses. */
export const masteredAt = masteryAt => stepsOf(masteryAt).at(-1) ?? 0;

/** The mastery (0…maxMastery) `uses` credited uses reach. */
export function masteryOf(uses, masteryAt) {
    const n = Number.isFinite(uses) ? uses : 0;
    return stepsOf(masteryAt).filter(at => n >= at).length;
}

/** The uses of the next step, or null at the top (a SkillView's `nextAt`). */
export function nextAt(uses, masteryAt) {
    const n = Number.isFinite(uses) ? uses : 0;
    return stepsOf(masteryAt).find(at => n < at) ?? null;
}

/** Whether `uses` is the cap: the form is at its top mastery and earns nothing more. */
export const isMastered = (uses, masteryAt) => masteryOf(uses, masteryAt) >= maxMastery(masteryAt);

/** `uses` held to the cap (a form never shows more than the top step). */
export const capUses = (uses, masteryAt) => Math.min(Math.max(0, Math.trunc(Number(uses) || 0)), masteredAt(masteryAt));
