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
import { captureTrainerOffer, replayTrainerOffer } from './offer-capture.js';
import { keepRoute, readsFreely } from '../quests/offer-feature.js';
import { nameKey } from './trainers.js';

export { dayOf, dayStart, midnightsBetween, minuteOfDay, readClock, trainingWindow } from './clock.js';
export { completionCredits } from './credits.js';
export { expectedSessionId } from './session.js';
export { trainerOf } from './trainers.js';

const legacyCapture = createTrainerCapture();

/** For a chat recorded before routes were kept: the teacher this name made in the reply as it stands; one with a settled record was offered freely ('on'), one without is 2.2.0's. */
function earlierRoute(ctx, line) {
    const offers = ctx.standing?.domains?.training?.offers;
    const key = nameKey(String(line.name ?? ''));
    const held = offers && key ? Object.values(offers).find(offer => nameKey(offer.name) === key) : null;
    return held ? (held.settled ? 'on' : 'off') : undefined;
}

/** A `+ trainer` line: read freely (offer-capture.js) or the 2.2.0 way, as it was first read when this is a Re-read of the same line. */
function captureTrainer(ctx, line) {
    if (line.op !== '+') return legacyCapture(ctx, line);
    const free = readsFreely(ctx, line, () => earlierRoute(ctx, line));
    keepRoute(ctx, line, free);
    return (free && captureTrainerOffer(ctx, line)) || legacyCapture(ctx, line, free);
}

export const part = {
    domains: { training: { initial: initialTraining, validate: trainingProblems } },
    commands: { ...requestCommands, ...openCommands },
    queries,
    // The `trainer` line exists only while the pinned ruleset has a template (`when`), so every other chat keeps its prompt byte for byte.
    // With Jobs from the story on, a free-form line is read and settled (offer-capture.js) before the 2.2.0 capture sees it.
    kinds: { trainer: { grammar: TRAINER_GRAMMAR, grammarFor: trainerGrammarFor, when: trainerKindOn, apply: captureTrainer } },
    hooks: { replayGuard: (env, info) => replayTrainerOffer(env, info) ?? replayTrainer(env, info) },
};
