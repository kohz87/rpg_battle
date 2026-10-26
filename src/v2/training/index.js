// RPG Battle v2, training (contract §3 skill.train, §5 "Training start"): the clock arithmetic (clock.js, credits.js), the
// `training` domain with the player's request (domain.js, request.js), the host's step that pays, moves the clock and credits
// (progress/session-step.js, run through rules.settle) and what the screens read (queries.js). Deferred with rules/progress until pinning.

import { initialTraining, trainingProblems } from './domain.js';
import { commands } from './request.js';
import { queries } from './queries.js';

export { dayOf, dayStart, midnightsBetween, minuteOfDay, readClock, trainingWindow } from './clock.js';
export { completionCredits } from './credits.js';
export { expectedSessionId } from './session.js';

export const part = {
    domains: { training: { initial: initialTraining, validate: trainingProblems } },
    commands,
    queries,
};
