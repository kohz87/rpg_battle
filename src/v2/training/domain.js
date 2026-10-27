// RPG Battle v2, the `training` domain (contract §3 skill.train, §5 "Training start", B3 training).
//
//   training = { schema: 2, sessions: { [session id]: Session }, offers?: { [tn_ id]: Offer } }
//   Session  = { id, actor, skill, form, trainer, status, fee, startMinute, endMinute, event, reason }
//     trainer  a pack trainer's ref, or the `tn_` id of an open trainer offer (RB 2.2.0)
//   Offer    = { id, template, name, text, skills, fee, minutes, eventTemplates, rank, place, where, npc, by }: an open trainer the story or
//              the reader offered (RB open trainers §5): the template it was made from, the skills it teaches (the template's list or a
//              narrowing of it), the fee rolled once from the template's range, the place it stands at (Story Director's canonical id then)
//              and its name then, the NPC record id for display (or null), and who offered it ('story' | 'reader'). `offers` is absent until
//              the first offer, so a chat that never meets a story trainer keeps its bytes.
//     status   'requested' (the player asked; no fee, no time yet) | 'completed' | 'interrupted' (the event die fell on an event:
//              paid, the time passed, no credit) | 'refused' (the host could not start it: wrong place, no coin, no longer held)
//     fee      the coin paid (null before it is paid), startMinute / endMinute the story minutes the session ran (null before)
//     awarded / unearned  (once it ran) how many of its credits earned mastery and the reason of the first that did not: kept on the
//              session because its attempts leave the ledger when the ledger folds (progress/fold.js)
//     event    null, or { die, template }: the 1-100 die of the event roll and the frozen event it picked (null: none)
//
// Each session is written once under its own id and then settled once (its status moves from `requested`). The player's
// request and the host's settlement are two blocks; a session that is settled without its request has no record to settle.

import { isActorId, isDefId, isId, isObject, isRecordId, isTrainerOfferId, isTrainerRef } from '../rules/ids.js';
import { nameKey } from './trainers.js';

export const TRAINING_SCHEMA = 2;
export const MAX_SESSIONS = 500;
/** At most this many open trainers in one chat (RB open trainers §4.2 row 13). */
export const MAX_OFFERS = 100;
export const MAX_OFFER_FEE = 1000000;
export const NAME_MAX = 80;
export const TEXT_MAX = 240;
export const initialTraining = () => ({ schema: TRAINING_SCHEMA, sessions: {} });

/**
 * The training slice a pin starts with. A pack with trainer templates starts with an empty `offers` map: each offer is then one add-only key
 * inside it, so deleting the reply that made the first trainer takes that trainer only (a map made by the first offer would take the parent of
 * every later one with it, and the host skips a block whose path is gone). A pack without templates keeps the slice it always had, byte for byte.
 */
export const trainingForPin = resolved => ({ ...initialTraining(), ...((resolved?.manifest?.trainers ?? []).some(entry => entry.open === true) ? { offers: {} } : {}) });

/** Whether `settled`, how a story's trainer line was read (GENERATIVE_OFFERS_SPEC §7.1: matcher, line, sid, said, band, notes, feeBy?), is whole. */
const settledProblem = settled => !(isObject(settled) && Number.isSafeInteger(settled.matcher) && /^[0-9a-f]{16}$/.test(settled.line ?? '') && typeof settled.sid === 'string' && settled.sid.length <= 50
    && isObject(settled.said) && Object.values(settled.said).every(value => typeof value === 'string' && value.length <= 240) && ['within', 'moderate'].includes(settled.band)
    && Array.isArray(settled.notes) && settled.notes.length <= 6 && settled.notes.every(note => typeof note === 'string' && note.length <= 160) && (settled.feeBy === undefined || settled.feeBy === 'said')
    && (settled.shown === undefined || isObject(settled.shown) && Object.values(settled.shown).every(value => typeof value === 'string' && value.length <= 120)));

const idLike = (value, prefix) => typeof value === 'string' && value.length === prefix.length + 9 && value.startsWith(`${prefix}_`);
const STATUS = ['requested', 'completed', 'interrupted', 'refused'];
const minute = value => value === null || Number.isSafeInteger(value);
const words = (value, min, max) => typeof value === 'string' && [...value].length >= min && [...value].length <= max && !/[<>\p{Cc}]/u.test(value);
const defs = (list, min, max) => Array.isArray(list) && list.length >= min && list.length <= max && list.every(isDefId) && new Set(list).size === list.length;

/** What is wrong with one recorded offer (RB open trainers §5.1), or null. */
export function offerProblem(id, offer) {
    if (!isObject(offer) || offer.id !== id || !isTrainerOfferId(id)) return 'is not whole';
    if (!isDefId(offer.template)) return 'names no template';
    if (!words(offer.name, 1, NAME_MAX) || offer.name.trim() !== offer.name || !words(offer.text, 0, TEXT_MAX) || !words(offer.where, 0, NAME_MAX)) return 'has a name, a text or a place name that is not plain text of the right length';
    if (!defs(offer.skills, 1, 30) || !defs(offer.eventTemplates, 0, 8)) return 'lists skills or events that are not refs in bounds';
    if (!Number.isSafeInteger(offer.fee) || offer.fee < 1 || offer.fee > MAX_OFFER_FEE || offer.minutes !== 60) return 'has a fee or a duration out of bounds';
    if (typeof offer.rank !== 'string' || offer.rank.length < 1 || offer.rank.length > 20) return 'has no rank';
    if (!isId(offer.place) || !(offer.npc === null || isRecordId(offer.npc)) || !['story', 'reader'].includes(offer.by)) return 'has a place, an NPC or an author that is not valid';
    if (Object.hasOwn(offer, 'settled') && !settledProblem(offer.settled)) return null;
    return Object.hasOwn(offer, 'settled') ? 'has a record of how the story\'s line was read that is not whole' : null;
}

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
        else if (!isActorId(s.actor) || !isDefId(s.skill) || !isDefId(s.form) || !isTrainerRef(s.trainer) || !STATUS.includes(s.status)) errors.push(`${where} names no actor, skill, form, trainer and status`);
        else if (!minute(s.startMinute) || !minute(s.endMinute) || !(s.fee === null || (Number.isSafeInteger(s.fee) && s.fee >= 0))) errors.push(`${where}: its minutes and fee are whole numbers or null`);
        else if ((s.status === 'completed' || s.status === 'interrupted') && (s.startMinute === null || s.endMinute === null || s.fee === null)) errors.push(`${where}: a session that ran has a fee and its minutes`);
        else if (!(s.event === null || (isObject(s.event) && Number.isInteger(s.event.die) && (s.event.template === null || isDefId(s.event.template))))) errors.push(`${where}: the event is null or { die, template }`);
        else if (!(s.awarded === undefined || (Number.isSafeInteger(s.awarded) && s.awarded >= 0 && s.awarded <= 100)) || !(s.unearned === undefined || s.unearned === null || (typeof s.unearned === 'string' && s.unearned.length <= 40))) errors.push(`${where}: what it earned is a count and a reason`);
        else if (!(s.reason === null || (typeof s.reason === 'string' && s.reason.length <= 240))) errors.push(`${where}: the reason is text or null`);
        else if (s.status === 'refused' && !s.reason) errors.push(`${where}: a refused session says why`);
    }
    if (Object.hasOwn(slice, 'offers')) {
        if (!isObject(slice.offers)) return [...errors, 'training: the offers are not an object'].slice(0, 20);
        const keys = Object.keys(slice.offers);
        if (keys.length > MAX_OFFERS) return [...errors, `training: more than ${MAX_OFFERS} open trainers`].slice(0, 20);
        const seen = new Set();
        for (const id of keys) {
            const problem = offerProblem(id, slice.offers[id]);
            if (problem) errors.push(`training: offer ${id} ${problem}`);
            else if (seen.has(nameKey(slice.offers[id].name))) errors.push(`training: offer ${id} has the name of another open trainer`);
            else seen.add(nameKey(slice.offers[id].name));
        }
    }
    return errors.slice(0, 20);
}
