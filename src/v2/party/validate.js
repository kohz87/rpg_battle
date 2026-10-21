// The party domain's validator (SPEC §2.5): what a committed `party` slice must look like
// (MODULES §B1, plus `offers`). Every message is a plain sentence naming the field; an empty
// list means the slice is fine. Story Block's generic op checks (integers, no NaN) run as well.
// Pure.

import { STATS } from '../../rules.js';

export const ACTOR_ID = /^ac_[a-z0-9]{8}$/;
export const OFFER_ID = /^of_[a-z0-9]{8}$/;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isInt = (value, min = 0) => Number.isInteger(value) && value >= min;
const isText = (value, max = 200) => typeof value === 'string' && value.length <= max;

function checkPool(errors, where, name, entry) {
    if (!isObject(entry) || !isInt(entry.max) || !isInt(entry.cur) || entry.cur > entry.max) {
        errors.push(`${where}: ${name} must be whole numbers with 0 ≤ cur ≤ max.`);
    }
}

function checkActor(errors, id, actor) {
    const where = `party.actors.${id}`;
    if (!isObject(actor)) return errors.push(`${where} is not a record.`);
    if (!ACTOR_ID.test(id)) errors.push(`${where}: the id is not an actor id (ac_ and 8 letters or digits).`);
    if (actor.id !== id) errors.push(`${where}: its id field says ${actor.id}.`);
    if (!isText(actor.name, 60) || !actor.name.trim()) errors.push(`${where}: a name is needed.`);
    if (actor.kind !== 'pc' && actor.kind !== 'companion') errors.push(`${where}: kind must be pc or companion.`);
    if (actor.control !== 'player' && actor.control !== 'auto') errors.push(`${where}: control must be player or auto.`);
    if (!isText(actor.role, 60)) errors.push(`${where}: role must be text.`);
    if (!isInt(actor.level, 1)) errors.push(`${where}: level must be a whole number from 1.`);
    if (!isInt(actor.xp)) errors.push(`${where}: xp must be a whole number, 0 or more.`);
    if (!isInt(actor.points)) errors.push(`${where}: points must be a whole number, 0 or more.`);
    for (const name of ['hp', 'mp', 'sp']) checkPool(errors, where, name.toUpperCase(), actor[name]);
    if (!isObject(actor.stats) || STATS.some(stat => !isInt(actor.stats[stat])) || Object.keys(actor.stats).some(key => !STATS.includes(key))) {
        errors.push(`${where}: stats must be ${STATS.join(', ')} as whole numbers, 0 or more.`);
    }
    if (!Array.isArray(actor.skills)) errors.push(`${where}: skills must be a list.`);
    else {
        const seen = new Set();
        for (const skill of actor.skills) {
            if (!isObject(skill) || !isText(skill.name, 60) || !skill.name.trim() || !isInt(skill.level, 1) || !isInt(skill.uses) || typeof skill.active !== 'boolean') {
                errors.push(`${where}: each skill needs a name, a level from 1, uses and active.`);
                continue;
            }
            const key = skill.name.trim().toLowerCase();
            if (seen.has(key)) errors.push(`${where}: ${skill.name} is listed twice.`);
            seen.add(key);
        }
    }
    if (!Array.isArray(actor.conditions) || actor.conditions.some(entry => !isObject(entry) || !isText(entry.kind, 40) || !entry.kind.trim() || !isInt(entry.stacks, 1))) {
        errors.push(`${where}: each condition needs a kind and stacks from 1.`);
    }
    if (actor.npc !== null && !isText(actor.npc, 80)) errors.push(`${where}: npc must be a name or null.`);
    if (actor.portrait !== undefined && actor.portrait !== null && !isText(actor.portrait, 2048)) errors.push(`${where}: portrait must be an image path or null.`);
    if (actor.background !== undefined && !isText(actor.background, 2000)) errors.push(`${where}: background must be text of at most 2000 characters.`);
    if (actor.origin !== undefined) {
        const origin = actor.origin;
        const named = entry => isObject(entry) && isText(entry.id, 120) && entry.id.trim() && isText(entry.name, 80) && entry.name.trim();
        if (!isObject(origin) || (origin.race !== null && !named(origin.race)) || !Array.isArray(origin.talents) || !origin.talents.every(named)) {
            errors.push(`${where}: origin must be { race: { id, name } | null, talents: [{ id, name }] }.`);
        }
    }
}

function checkOffer(errors, offer, index, actors) {
    const where = `party.offers[${index}]`;
    if (!isObject(offer)) return errors.push(`${where} is not a record.`);
    if (typeof offer.id !== 'string' || !OFFER_ID.test(offer.id)) errors.push(`${where}: the id is not an offer id.`);
    if (!isInt(offer.rev)) errors.push(`${where}: rev must be a whole number.`);
    if (offer.kind === 'join') {
        if (!isText(offer.name, 60) || !offer.name.trim()) errors.push(`${where}: a join offer needs a name.`);
        if (offer.level !== null && !isInt(offer.level, 1)) errors.push(`${where}: level must be a whole number from 1 or null.`);
    } else if (offer.kind === 'skill') {
        if (!actors[offer.actor]) errors.push(`${where}: the skill offer is for someone not in the party.`);
        if (!isText(offer.skill, 60) || !offer.skill.trim()) errors.push(`${where}: a skill offer needs a skill name.`);
    } else if (offer.kind === 'leave') {
        if (!actors[offer.actor] || actors[offer.actor].kind !== 'companion') errors.push(`${where}: a leave offer is for a companion in the party.`);
        if (!isText(offer.text, 160)) errors.push(`${where}: a leave offer's text must be short text.`);
    } else errors.push(`${where}: kind must be join, skill or leave.`);
}

/** The party slice's problems, [] when it is fine. */
export function validateParty(slice) {
    const errors = [];
    if (!isObject(slice)) return ['party is not a record.'];
    const actors = isObject(slice.actors) ? slice.actors : null;
    if (!actors) return ['party.actors must be a record.'];
    for (const [id, actor] of Object.entries(actors)) checkActor(errors, id, actor);
    const pcs = Object.values(actors).filter(actor => actor?.kind === 'pc');
    if (slice.pc === null) {
        if (pcs.length) errors.push('party.pc is empty but an actor is the pc.');
    } else if (!actors[slice.pc] || actors[slice.pc].kind !== 'pc') errors.push('party.pc must name the pc actor.');
    if (pcs.length > 1) errors.push('party has more than one pc.');
    if (!Array.isArray(slice.order)) errors.push('party.order must be a list.');
    else {
        const ids = Object.keys(actors);
        if (slice.order.length !== ids.length || new Set(slice.order).size !== ids.length || slice.order.some(id => !actors[id])) {
            errors.push('party.order must list every actor once.');
        }
        if (slice.pc && slice.order[0] !== slice.pc) errors.push('party.order must start with the pc.');
    }
    if (!isObject(slice.custom)) errors.push('party.custom must be a record.');
    else {
        for (const [name, def] of Object.entries(slice.custom)) {
            if (!isObject(def) || def.name !== name) errors.push(`party.custom.${name} must be a skill named ${name}.`);
        }
    }
    if (!Array.isArray(slice.offers)) errors.push('party.offers must be a list.');
    else {
        slice.offers.forEach((offer, index) => checkOffer(errors, offer, index, actors));
        if (new Set(slice.offers.map(offer => offer?.id)).size !== slice.offers.length) errors.push('party.offers has an id twice.');
    }
    return errors;
}

/** The empty party slice: no character yet. */
export function initialParty() {
    return { pc: null, order: [], actors: {}, custom: {}, offers: [] };
}
