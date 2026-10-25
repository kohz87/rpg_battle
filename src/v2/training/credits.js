// RPG Battle v2, what a finished training session credits (contract §5 "Training start": two completion
// credits, subject to the shared caps; B3 "caps apply on the recorded completion day"). The credits are the
// ones use credits are (progress/credit.js): the same caps and the same reasons, counted on the day the
// session is completed, so a session that crosses midnight spends day 5's room, not day 4's. Pure.

import { decide, note } from '../progress/credit.js';

const copy = tally => Object.fromEntries(Object.entries(tally).map(([name, map]) => [name, new Map(map)]));

/**
 * The decisions for a session's completion credits, in order: [{ award, reason, minute, day, reply }] as many
 * as `constants.trainCredits`. `tally`: the counts of the credits that survive (progress/credit.js tallyOf;
 * not changed here); `attempt`: { actor, skill, form, capSource } of the completion; `window`: trainingWindow's.
 * Each credit counts on window.end's day and the next one sees the one before it.
 */
export function completionCredits({ constants, tally, attempt, window }) {
    const counts = copy(tally);
    const out = [];
    for (let n = 0; n < constants.trainCredits; n += 1) {
        const credit = decide(constants, counts, attempt, window.end);
        note(counts, attempt, credit);
        out.push(credit);
    }
    return out;
}
