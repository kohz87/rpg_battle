// RPG Battle v2, the `training` domain (contract §3 skill.train, §5 "Training start", B3 training).
//
//   training = { schema: 2, sessions: { [session id]: Session } }
//   Session  = { id, actor, skill, form, trainer, status, fee, startMinute, endMinute, event, reason }
//     status   'requested' (the player asked; no fee, no time yet) | 'completed' | 'interrupted' (the event die fell on an event:
//              paid, the time passed, no credit) | 'refused' (the host could not start it: wrong place, no coin, no longer held)
//     fee      the coin paid (null before it is paid), startMinute / endMinute the story minutes the session ran (null before)
//     event    null, or { die, template }: the 1-100 die of the event roll and the frozen event it picked (null: none)
//
// Each session is written once under its own id and then settled once (its status moves from `requested`). The player's
// request and the host's settlement are two blocks; a session that is settled without its request has no record to settle.

import { isActorId, isDefId, isObject } from '../rules/ids.js';

export const TRAINING_SCHEMA = 2;
export const MAX_SESSIONS = 500;
export const initialTraining = () => ({ schema: TRAINING_SCHEMA, sessions: {} });

const idLike = (value, prefix) => typeof value === 'string' && value.length === prefix.length + 9 && value.startsWith(`${prefix}_`);
const STATUS = ['requested', 'completed', 'interrupted', 'refused'];
const minute = value => value === null || Number.isSafeInteger(value);

/** The problems of a training slice (the domain validator). */
export function trainingProblems(slice) {
    if (!isObject(slice) || slice.schema !== TRAINING_SCHEMA || !isObject(slice.sessions)) return ['training: the slice is not training schema 2'];
    const ids = Object.keys(slice.sessions);
    if (ids.length > MAX_SESSIONS) return [`training: more than ${MAX_SESSIONS} sessions`];
    const errors = [];
    for (const id of ids) {
        const s = slice.sessions[id];
        const where = `training: session ${id}`;
        if (!idLike(id, 'tr') || !isObject(s) || s.id !== id) errors.push(`${where} is not whole`);
        else if (!isActorId(s.actor) || !isDefId(s.skill) || !isDefId(s.form) || !isDefId(s.trainer) || !STATUS.includes(s.status)) errors.push(`${where} names no actor, skill, form, trainer and status`);
        else if (!minute(s.startMinute) || !minute(s.endMinute) || !(s.fee === null || (Number.isSafeInteger(s.fee) && s.fee >= 0))) errors.push(`${where}: its minutes and fee are whole numbers or null`);
        else if ((s.status === 'completed' || s.status === 'interrupted') && (s.startMinute === null || s.endMinute === null || s.fee === null)) errors.push(`${where}: a session that ran has a fee and its minutes`);
        else if (!(s.event === null || (isObject(s.event) && Number.isInteger(s.event.die) && (s.event.template === null || isDefId(s.event.template))))) errors.push(`${where}: the event is null or { die, template }`);
        else if (!(s.reason === null || (typeof s.reason === 'string' && s.reason.length <= 240))) errors.push(`${where}: the reason is text or null`);
        else if (s.status === 'refused' && !s.reason) errors.push(`${where}: a refused session says why`);
    }
    return errors.slice(0, 20);
}
