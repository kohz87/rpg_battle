// RPG Battle v2, training (contract §3 skill.train, §5 "Training start"): the clock arithmetic (clock.js, credits.js), the
// `training` domain with the player's request (domain.js, request.js), the host's step that pays, moves the clock and credits
// (step.js, run through rules.settle) and what the screens read (queries.js). Not registered by module.js yet.

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
