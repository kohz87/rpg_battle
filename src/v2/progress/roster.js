// RPG Battle v2, who fights beside the player (contract §3 party.setActive, summon.end; §5 "Party / summons (P11)").
// The PC and two durable companions are active; the rest are in reserve. Summons and pets are temporary units of a
// fight, outside that limit, and end by expiry, dismissal, going down or the fight's end.
//
//   party.setActive { actors }          the player, outside a fight: 1 to 3 durable living members, the PC among them
//                                        → { actors, reserve }
//   summon.end { actor, reason }        a temporary unit ends; the host or a rule says any reason, the player only "dismissed"
//                                        → { actor, reason }; the same dismissal again answers the same
//
// The roster is stored in the progress slice (`roster.active`, `temporary`), not in the party's, so a chat that never
// uses it keeps the party slice exactly as it was. The units themselves are made by the summon command (track B4);
// this file only reads, lists and ends them.

import { assess } from './assess.js';
import { buildGuard } from './guard.js';
import { indexOf } from '../rules/graph.js';
import { pinOf } from '../rules/pin.js';
import { isObject } from '../rules/ids.js';
import { fightOn } from '../party/commands.js';

const REASONS = ['expired', 'dismissed', 'downed', 'fight-ended'];

function closed(ctx, payload, fields, name) {
    if (!isObject(payload)) ctx.fail('INVALID', `${name} needs { ${fields.join(', ')} }.`);
    const extra = Object.keys(payload).find(key => !fields.includes(key));
    if (extra) ctx.fail('INVALID', `${name} does not take "${extra}".`);
    for (const key of fields) if (!Object.hasOwn(payload, key)) ctx.fail('INVALID', `${name} needs ${key}.`);
}

function pinned(ctx) {
    const ix = indexOf(pinOf({ domains: { rules: ctx.read('rules') } }));
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    return ix;
}

function guard(ctx, ix, kind, payload, inputs) {
    ctx.replayGuard(buildGuard({ hash: value => ctx.hash(value), owner: ctx.module, source: ctx.source ?? ctx.fail('FAILED', 'There is no reply yet to hold the choice.'), rulesHash: ix.rulesHash, kind, payload, inputs }));
}

function setActive(ctx, payload) {
    closed(ctx, payload, ['actors'], 'party.setActive');
    if (ctx.cause !== 'ui' || ctx.caller) ctx.fail('REFUSED', 'Choosing who is active is the player\'s own choice.');
    const ix = pinned(ctx);
    if (fightOn(ctx)) ctx.fail('REFUSED', 'Choose who is active before the fight or after it.');
    const answer = assess('party.setActive', { ix, progress: ctx.read('progress'), query: (name, args) => ctx.query(name, args) }, payload);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    ctx.draft('progress').roster.active = [...answer.actors];
    guard(ctx, ix, 'party.setActive', payload, answer.inputs);
    return { summary: `${answer.actors.length} active, ${answer.reserve.length} in reserve.`, narrate: false, data: { v2: { key: 'roster', result: { actors: answer.actors, reserve: answer.reserve } } } };
}

function summonEnd(ctx, payload) {
    closed(ctx, payload, ['actor', 'reason'], 'summon.end');
    if (!REASONS.includes(payload.reason)) ctx.fail('INVALID', `A summon ends by ${REASONS.join(', ')}.`);
    // The host or a rule of the module ends a unit for any reason; the player (a click) may only dismiss; the story never does.
    if (ctx.cause === 'story') ctx.fail('REFUSED', 'The story does not end a summon: a rule does.');
    if (ctx.cause === 'ui' && (ctx.caller || payload.reason !== 'dismissed')) ctx.fail('REFUSED', 'The player may dismiss a summon, and only that.');
    const ix = pinned(ctx);
    const answer = assess('summon.end', { ix, progress: ctx.read('progress'), query: (name, args) => ctx.query(name, args) }, payload);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    const result = { actor: payload.actor, reason: payload.reason };
    if (answer.unit.ended) {
        if (answer.unit.ended.reason !== payload.reason) ctx.fail('REFUSED', `That unit already ended (${answer.unit.ended.reason}).`);
        return { summary: `${answer.unit.name} had already gone.`, narrate: false, data: { v2: { key: `summon:${payload.actor}`, result } } };
    }
    ctx.draft('progress').temporary[payload.actor].ended = { reason: payload.reason };
    guard(ctx, ix, 'summon.end', payload, answer.inputs);
    return { summary: `${answer.unit.name} is gone.`, narrate: false, data: { v2: { key: `summon:${payload.actor}`, result } } };
}

export const commands = { 'party.setActive': setActive, 'summon.end': summonEnd };
