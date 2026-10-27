// RPG Battle v2, the mode of Jobs from the story on the chat's timeline (GENERATIVE_OFFERS_SPEC, Decisions).
//
// The switch "Jobs from the story" is the reader's, and a reader changes it in the middle of a chat. A line that is read one way with the switch on and another with it off must not
// be read by the switch of the moment it is read at, or a Re-read, a rebuild and a reload would each decide an old line again by a setting that was not the one it was written under.
// So the mode goes on the chat's timeline like any other fact of it: `rules.mode` ('free' | 'strict') is the mode in force, and it changes only by a `rules.mode` event, a system step kept on the
// reply at the head when the next reply is asked for and the switch is not what the timeline says (the same way a recovery or a settlement is kept). A capture reads the mode in the state it runs
// on, which is the state at its reply's place: a line read live, read again (edited or not) and rebuilt is read the same way, whatever the switch says now. The event goes with its reply: a
// reply taken back takes the toggle it holds with it, and the next reply asked for compares the switch with the timeline again and keeps it afresh.
//
// The chat's first mode is the switch as it stood when the ruleset was pinned. A chat pinned before 2.3.0 has none: it reads as RPG Battle 2.2.0 did (strict) up to its first toggle event.

import { featureOn } from '../items/condition.js';
import { isObject } from './ids.js';

export const OFFERS_FEATURE = 'rpg-battle.generative-offers';
export const MODES = Object.freeze(['free', 'strict']);

/** The mode a rules slice says is in force ('strict' when it says none: a chat pinned before the mode was kept). */
export const modeOf = slice => (isObject(slice) && slice.mode === 'free' ? 'free' : 'strict');

/** The mode the reader's switch asks for now (a host that cannot say takes the switch as on). */
export const switchMode = source => (featureOn(source, OFFERS_FEATURE) ? 'free' : 'strict');

/** Whether lines are read freely (Jobs from the story) where `ctx` stands: by the mode of the timeline at the reply being read, not by the switch. */
export const readsFreely = ctx => modeOf(ctx?.read?.('rules')) === 'free';

/** rules.mode { mode }: the mode in force from this reply on. The host's own step (cause `system`), sent by `modeBeforeReply`. */
export function setMode(ctx, payload) {
    if (ctx.cause !== 'system' || ctx.caller) ctx.fail('REFUSED', 'The mode of Jobs from the story follows its switch: nobody else sets it.');
    if (!isObject(payload) || Object.keys(payload).some(key => key !== 'mode') || !MODES.includes(payload.mode)) ctx.fail('INVALID', 'rules.mode takes { mode: "free" | "strict" }.');
    const slice = ctx.read('rules');
    if (!isObject(slice) || slice.pin === null) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    ctx.draft('rules').mode = payload.mode;
    return { summary: payload.mode === 'free' ? 'Jobs from the story: on from here.' : 'Jobs from the story: off from here (strict).', narrate: false, data: { mode: payload.mode } };
}

/**
 * beforeGenerate (SPEC §4.1 step 3): the `rules.mode` event when the switch is not what the timeline says. For a new reply only (not a swipe, a Continue, a quiet or an impersonated one),
 * and nothing without a pinned ruleset.
 */
export function modeBeforeReply(view, info = {}) {
    const type = String(info?.type ?? 'normal').toLowerCase();
    if (type === 'swipe' || type === 'continue' || type === 'quiet' || type === 'impersonate') return { commands: [] };
    const slice = view?.state?.domains?.rules;
    if (!isObject(slice) || !isObject(slice.pin)) return { commands: [] };
    const mode = switchMode(view);
    return mode === modeOf(slice) ? { commands: [] } : { commands: [{ type: 'rules.mode', payload: { mode } }] };
}
