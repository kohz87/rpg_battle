// Shared by the open trainer tests: a chat pinned to the open trainers pack, and the records the host stored for its offers.
import assert from 'node:assert/strict';
import { DAY, realWorld } from '../../progress/helpers/world.js';
import { openTrainersPin } from '../../progress/helpers/fixture.js';

export const HAVEN = 'pack.fixture/haven';
export const MILL = 'pack.fixture/mill';
export const START = 4 * DAY + 1410;

/** A chat pinned to the open trainers pack, at Haven at dusk with Old Reka in the scene. */
// Strict mode (GENERATIVE_OFFERS_SPEC §10) unless a test says otherwise: these tests are RPG Battle 2.2.0's open trainers, whose refusals the generative path replaces.
// `RB_TRAINERS_FEATURE=on` runs them with Jobs from the story on instead (open-trainers-modes.test.js runs the shared suites both ways).
export async function ready(t, { given = openTrainersPin(), here = true, clock = true, coin = 0, present = ['Old Reka'], strict = process.env.RB_TRAINERS_FEATURE !== 'on' } = {}) {
    const w = await realWorld(t, { given, sd: true, strict });
    await w.say('Haven at dusk.', [...(clock ? [`~ time ${START}`] : []), ...(here ? [`~ here ${HAVEN}`] : []), ...present.map(name => `+ present ${name}`)]);
    if (coin) assert.equal(w.host.bus.command('test.coin', { amount: coin }, { cause: 'ui' }).ok, true);
    return w;
}
export const coin = w => w.q('inventory.wallet', { owner: 'party' }).coin ?? 0;
export const clock = w => w.q('director.time', {}).minutes;
export const sessions = w => w.slice('training').sessions;
/** The index of the reply whose text holds `text`. */
export const at = (w, text) => w.host.ctx.chat.findIndex(message => !message.is_user && String(message.mes ?? '').includes(text));
/** Deletes a reply and the reader's message before it, as a reader deleting a turn does. */
export const drop = async (w, index) => {
    await w.host.st.deleteMessage(index);
    await w.host.st.deleteMessage(index - 1);
};
/** The Progress row to ask `trainer` (an offer id or a pack ref) for `skill`. */
export const rowOf = (w, trainer, skill = 's00') => {
    const row = w.q('rules.training', { actor: w.pc }).offers.find(item => item.trainer === trainer && item.skill === `pack.fixture/${skill}`);
    assert.ok(row, `no row for ${trainer} ${skill}`);
    return row;
};
export const offers = w => w.slice('training').offers ?? {};
export const only = w => {
    const list = Object.values(offers(w));
    assert.equal(list.length, 1, JSON.stringify(list));
    return list[0];
};
/** The guarded blocks of the offers this chat holds, as the host stored them: { guard, recorded, source }. */
export const spans = w => w.host.ctx.chat.flatMap(message => message.extra?.storySuite?.spans ?? []).filter(span => span.guard?.predicate?.kind === 'trainer.open');
