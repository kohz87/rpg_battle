// RPG Battle v2, training (contract §3 skill.train, §5 "Training start"): the clock arithmetic (clock.js, credits.js), the
// `training` domain with the player's request (domain.js, request.js), the host's step that pays, moves the clock and credits
// (progress/session-step.js, run through rules.settle) and what the screens read (queries.js). Deferred with rules/progress until pinning.
//
// Open trainers (RB 2.2.0, RB open trainers spec): a pinned pack's trainer templates become trainers when the story writes
// `+ trainer Name | like: <template>` (capture.js) or the reader uses "Make this a trainer" (`trainer.open`, open.js). trainers.js says who
// can train a character, opening.js plans, guards and records an offer, and replays it without asking a query.

import { initialTraining, trainingProblems } from './domain.js';
import { commands as requestCommands } from './request.js';
import { commands as openCommands } from './open.js';
import { queries } from './queries.js';
import { TRAINER_GRAMMAR, createTrainerCapture, trainerGrammarFor, trainerKindOn } from './capture.js';
import { replayTrainer } from './opening.js';

export { dayOf, dayStart, midnightsBetween, minuteOfDay, readClock, trainingWindow } from './clock.js';
export { completionCredits } from './credits.js';
export { expectedSessionId } from './session.js';
export { trainerOf } from './trainers.js';

export const part = {
    domains: { training: { initial: initialTraining, validate: trainingProblems } },
    commands: { ...requestCommands, ...openCommands },
    queries,
    // The `trainer` line exists only while the pinned ruleset has a template (`when`), so every other chat keeps its prompt byte for byte.
    kinds: { trainer: { grammar: TRAINER_GRAMMAR, grammarFor: trainerGrammarFor, when: trainerKindOn, apply: createTrainerCapture() } },
    hooks: { replayGuard: replayTrainer },
};
