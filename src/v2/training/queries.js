// RPG Battle v2, `rules.training({ actor })` (lead decision on track C's gap; fixtures RB #139): what the training section of a
// character's screen shows. → { actor, session, caps, offers } | null (no pinned ruleset, a stranger, a character with no class).
//
//   session  the one waiting for the host, else the latest that ran or was refused, else null (session.js sessionView)
//   caps     { day (the story day now, null without a clock), actor: { used, max }, skill: { used, max } (the busiest of the three
//            skills today), skills: { [skill]: { used, max } } }: credits earned today against the pinned day caps
//   offers   one for each trainer of the pack that teaches one of the character's skills: { trainer, name, skill, form, fee, minutes,
//            session (the id a request must carry), payload (the skill.train payload), blocked: [why not now] }

import { indexOfState } from '../rules/graph.js';
import { memberOf } from '../progress/assess.js';
import { deriveActor, choicesOf } from '../progress/derive.js';
import { rowsOf } from '../progress/credit.js';
import { readClock, dayOf } from './clock.js';
import { expectedSessionId, currentOf, sessionView, waitingOf } from './session.js';
import { placeOf, purseOf } from './step.js';
import { lifeOf } from '../rules/sheet.js';
import { isActorId, isObject } from '../rules/ids.js';

export function rulesTraining(state, args, tools) {
    const ix = indexOfState(state);
    if (!ix || !isObject(args) || Object.keys(args).some(key => key !== 'actor') || !isActorId(args.actor)) return null;
    const member = memberOf(tools?.query, args.actor);
    if (!member) return null;
    const progress = state?.domains?.progress ?? {};
    const training = state?.domains?.training ?? { sessions: {} };
    const derived = deriveActor(ix, choicesOf(progress, args.actor));
    if (derived.class === null) return null;
    const minute = readClock(tools?.query);
    const day = minute === null ? null : dayOf(minute, ix.constants.clockMinutesPerDay);
    const skills = {};
    let actorUsed = 0;
    for (const { skill } of derived.skills) skills[skill] = { used: 0, max: ix.constants.usePerSkillDay };
    if (day !== null) {
        for (const { attempt, credit } of rowsOf(progress)) {
            if (attempt.actor !== args.actor || credit.award < 1 || credit.day !== day) continue;
            actorUsed += 1;
            if (skills[attempt.skill]) skills[attempt.skill].used += 1;
        }
    }
    const busiest = Object.values(skills).reduce((top, item) => (item.used > top.used ? item : top), { used: 0, max: ix.constants.usePerSkillDay });
    const here = placeOf(tools?.query);
    const coin = purseOf(tools?.query);
    const waiting = waitingOf(training, args.actor);
    const offers = [];
    for (const trainer of ix.trainers) {
        for (const view of derived.skills) {
            if (!trainer.skills.includes(view.skill)) continue;
            const key = { actor: args.actor, trainer: trainer.id, skill: view.skill, form: view.form };
            const session = expectedSessionId(training.sessions, key, ix.rulesHash);
            const blocked = [];
            if (lifeOf(member) !== 'alive') blocked.push(`${member.name} cannot train now.`);
            if (waiting) blocked.push('A training is already waiting.');
            if (minute === null) blocked.push('The story clock is not set.');
            if (here !== null && here !== trainer.place) blocked.push(`${trainer.name} is not here.`);
            if (coin !== null && coin < trainer.fee) blocked.push(`It costs ${trainer.fee}.`);
            offers.push({ trainer: trainer.id, name: trainer.name, skill: view.skill, form: view.form, fee: trainer.fee, minutes: trainer.minutes, session, payload: { actor: args.actor, skill: view.skill, form: view.form, trainer: trainer.id, session }, blocked });
        }
    }
    const current = currentOf(training, args.actor);
    return {
        actor: args.actor,
        session: current ? sessionView(current, { constants: ix.constants, trainer: ix.trainer(current.trainer), progress }) : null,
        caps: { day, actor: { used: actorUsed, max: ix.constants.usePerActorDay }, skill: { ...busiest }, skills },
        offers,
    };
}

export const queries = { 'rules.training': rulesTraining };
