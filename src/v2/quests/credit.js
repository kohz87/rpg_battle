// Story coin remains SB-owned. RB only attributes it to one reward on that reply.
import { ask, pinned, stateEpoch } from './seams.js';
import { pendingObjectives } from './objectives.js';
export const creditKey = sid => `storycoin:${sid}`;
export const turnInKey = (epoch, quest, sid) => `rb:${epoch}:quest:${quest.id}:${quest.instance}:turnin:${sid}`;
const amount = value => Number.isSafeInteger(value) && value > 0 ? value : 0;

export function creditFor(thread, coin) {
    const remaining = Math.max(0, thread.rpg.reward.coin - thread.rpg.storyCredit.coin);
    // Retain the old exact-amount attribution. Giver presence awaits B3's canonical seam.
    return remaining > 0 && coin === remaining ? remaining : 0;
}
export function unclaimedCoin(state, tools) {
    const sid = tools?.reply?.sid;
    if (!sid || state?.meta?.claims?.[creditKey(sid)]) return 0;
    const budget = ask(tools.query, 'inventory.storyBudget');
    return Math.max(0, amount(budget?.paid) - amount(budget?.vouched));
}
const recordedReservation = tools => (tools?.receipts?.() ?? []).filter(row => row.index === tools?.reply?.index)
    .map(row => row.receipt).find(receipt => receipt?.type === 'quest.reserveCoin' && receipt.data?.bound)?.data.bound ?? null;
export function creditCandidates(state, _args, tools) {
    const coin = unclaimedCoin(state, tools);
    if (!coin || state?.meta?.claims?.[`rb:${stateEpoch(state)}:quest-coin:${tools?.reply?.sid}`]) return [];
    const bound = recordedReservation(tools);
    if (bound) return bound.reply === tools.reply.sid && bound.coin === coin ? [bound.thread] : [];
    return (ask(tools.query, 'director.threads') ?? []).filter(t => t.rpg?.state === 'active' && creditFor(t, coin) > 0).map(t => t.id).sort();
}
export function coinReservation(state, { id } = {}, tools) {
    const candidates = creditCandidates(state, {}, tools);
    if (candidates.length !== 1 || candidates[0] !== id) return null;
    const previous = recordedReservation(tools);
    if (previous) return { id, bound: previous };
    const thread = ask(tools.query, 'director.thread', { id });
    return { id, bound: { type: 'quest.coin', thread: id, instance: thread.rpg.instance, reply: tools.reply.sid, coin: unclaimedCoin(state, tools) } };
}
export function autoTurnIns(state, args, tools) {
    const sid = tools?.reply?.sid;
    if (!sid) return [];
    const threads = ask(tools.query, 'director.threads') ?? [];
    return threads.filter(t => t.rpg?.state === 'active' && state?.meta?.claims?.[turnInKey(stateEpoch(state), t.rpg, sid)]
        && (args?.pending === true || ask(tools.query, 'quest.progress', { id: t.id })?.finish?.ok)).map(t => t.id);
}
export function owedCredits(state, args, tools) {
    const coin = unclaimedCoin(state, tools);
    if (!coin) return [];
    const ids = autoTurnIns(state, args, tools);
    const found = ids.find(id => creditFor(ask(tools.query, 'director.thread', { id }), coin) > 0);
    return found ? [found] : repeatedThreads(state, tools).slice(0, 1).map(t => t.id);
}
export function repeatedThreads(state, tools) {
    const coin = unclaimedCoin(state, tools);
    if (!coin) return [];
    const receipts = (tools?.receipts?.() ?? []).filter(row => row.index === tools.reply.index).map(row => row.receipt);
    const threads = ask(tools.query, 'director.threads') ?? [];
    return threads.filter(t => t.rpg?.settlement?.coinPaid > 0 && t.rpg.settlement.coinPaid === coin
        && state?.meta?.claims?.[t.rpg.settlement.claim] && receipts.some(r => r.data?.v2?.result?.settlement === t.rpg.settlement.id));
}
export const repeatedCoin = (state, _args, tools) => ({ amount: repeatedThreads(state, tools)[0]?.rpg.settlement.coinPaid ?? 0 });

export function questCreditHook(view) {
    if (!pinned(view?.state?.domains?.rules)) return undefined;
    // Select intents now; payOwed rechecks readiness after the preceding objective commands have committed.
    const intents = view.query('quest.autoTurnIns', { pending: true }).sort();
    const ids = [...new Set([...expiredQuests(view), ...intents, ...view.query('quest.owedCredits', {})])];
    // Objective proofs come first; settlement then sees the same prefix as a full replay.
    const candidates = view.query('quest.creditCandidates', {});
    const reserves = candidates.length === 1 ? [{ type: 'quest.reserveCoin', payload: view.query('quest.coinReservation', { id: candidates[0] }) }] : [];
    const commands = [...pendingObjectives(view), ...reserves, ...ids.map(id => ({ type: 'quest.payOwed', payload: { id, credit: true } }))];
    return commands.length ? { lines: [], commands } : undefined;
}

function expiredQuests(view) {
    const minute = ask(view.query, 'director.time')?.minutes;
    if (!Number.isSafeInteger(minute)) return [];
    return (ask(view.query, 'director.threads') ?? []).filter(thread => thread.rpg?.state === 'active'
        && thread.rpg.deadline !== null && minute >= thread.rpg.deadline).map(thread => thread.id);
}

export function questExpiryHook(view) {
    // Expiry first; an expired quest has no objective left to prove (pendingObjectives skips it).
    const commands = [...expiredQuests(view).map(id => ({ type: 'quest.payOwed', payload: { id } })), ...pendingObjectives(view)];
    return commands.length ? { commands } : undefined;
}
