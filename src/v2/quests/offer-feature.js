// The feature switch of the generative offers (F100, GENERATIVE_OFFERS_SPEC §10): "Jobs from the story". Off is strict mode, every path as in RPG
// Battle 2.2.0. The reader's choice, not the chat's; a host that cannot say takes it as on.
import { featureOn } from '../items/condition.js';
import { templates } from './seams.js';
import { MAX_ROUTE_LINES, ROUTE_KEY } from '../rules/offers.js';

export const OFFERS_FEATURE = 'rpg-battle.generative-offers';

/** Whether a ctx or view has the feature on. */
export const offersOn = source => featureOn(source, OFFERS_FEATURE);

/** Whether the pin has at least one open quest template: without one there is nothing to settle an offer in. */
export const hasOpenQuests = pin => templates(pin).some(template => template?.open === true);

// ---- the route of a line ---------------------------------------------------------------------------------------------------------
//
// A line that Jobs from the story could read (an offer, a teacher, a named kind of foe with a count) is read one way with the feature on and another with it off. Story Block
// runs a Re-read of the reply with the reader's switch as it is now, so an unchanged line would be decided again by a setting that is not the one it was written under.
// The way each such line was read is kept with its reply (rules `route.<id>`); a Re-read of the same line (same reply, same text) is read that way again. A line that
// was edited, or never read, is read under the setting of the moment.

const sidOf = ctx => ctx.carrier?.sid ?? ctx.source?.sid ?? null;
const lineOf = (ctx, line) => ctx.hash({ raw: line.raw }).slice(0, 16);
const routeIdOf = (ctx, sid) => `rt_${ctx.hash({ route: sid }).slice(0, 12)}`;

/**
 * Whether `line` is read with Jobs from the story on: the way it was read before when this is a Re-read of the same line (same reply, same text) of a reply that kept routes;
 * a line the reply kept no route for (edited, or never read) is read under the feature as it stands. A reply recorded before routes were kept has none at all: its line is read as
 * `evidence()` says the state shows it was ('on' | 'off' | undefined: asked only then, and only for an unchanged line), else under the feature as it stands.
 */
export function readsFreely(ctx, line, evidence = null) {
    const sid = sidOf(ctx);
    const record = sid ? ctx.standing?.domains?.rules?.[ROUTE_KEY + routeIdOf(ctx, sid)] : undefined;
    const kept = record?.lines?.[lineOf(ctx, line)];
    if (kept === 'on' || kept === 'off') return kept === 'on';
    if (record !== undefined) return offersOn(ctx);
    const found = typeof evidence === 'function' ? evidence() : undefined;
    return found === 'on' || found === 'off' ? found === 'on' : offersOn(ctx);
}

/** The hash a line is known by in a record (the 16 hex of the line as written). */
export const lineHash = (ctx, line) => lineOf(ctx, line);

/** Keeps the way `line` was read with its reply (never fails the line: a route that cannot be kept is read under the setting of the moment next time). */
export function keepRoute(ctx, line, free) {
    const sid = sidOf(ctx);
    if (!sid || typeof ctx.call !== 'function' || !ctx.read('rules')?.pin) return;
    const mode = free ? 'on' : 'off';
    const id = routeIdOf(ctx, sid);
    const held = ctx.read('rules')?.[ROUTE_KEY + id]?.lines ?? {};
    // Checked here: a command that fails inside a line fails the line.
    if (held[lineOf(ctx, line)] !== undefined || Object.keys(held).length >= MAX_ROUTE_LINES) return;
    try { ctx.call('rules.recordOffer', { write: `wr_${ctx.hash({ route: sid, line: lineOf(ctx, line) }).slice(0, 8)}`, route: id, record: { v: 1, sid, lines: { [lineOf(ctx, line)]: mode } } }); } catch { /* read under the setting of the moment next time */ }
}
