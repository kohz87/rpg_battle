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
const isCoinProof = p => p.owner === 'rpg-battle' && p.kind === 'story' && ['quest.coin', 'quest.coin.repeat'].includes(p.payload?.type);
const coinProofs = tools => (ask(tools.query, 'story.evidence') ?? []).filter(p => isCoinProof(p) && p.payload.reply === tools.reply?.sid);
const rawCoin = tools => { const budget = ask(tools.query, 'inventory.storyBudget'); return Math.max(0, amount(budget?.paid) - amount(budget?.vouched)); };
export function unclaimedCoin(_state, tools) {
    return tools?.reply?.sid ? Math.max(0, rawCoin(tools) - coinProofs(tools).reduce((sum, p) => sum + p.payload.coin, 0)) : 0;
}
const recordedReservations = tools => (tools?.receipts?.() ?? []).filter(row => row.index === tools?.reply?.index)
    .map(row => row.receipt).filter(receipt => receipt?.type === 'quest.reserveCoin' && receipt.data?.bound).map(receipt => receipt.data.bound);
export const reservationKey = (epoch, bound) => `rb:${epoch}:quest-coin:${bound.reply}${bound.type === 'quest.coin.repeat' ? `:${bound.limit}` : ''}`;

/** Immutable per-source attribution: replay old bindings first, then attribute only new coin to one unique reward. */
export function coinReservations(state, _args, tools) {
    const reply = tools?.reply?.sid;
    if (!reply) return [];
    const raw = rawCoin(tools), epoch = stateEpoch(state), claims = state?.meta?.claims ?? {};
    const previous = recordedReservations(tools);
    const pending = previous.filter((bound, at) => bound.reply === reply && raw >= (bound.limit ?? bound.coin)
        && !claims[reservationKey(epoch, bound)] && previous.findIndex(p => reservationKey(epoch, p) === reservationKey(epoch, bound)) === at)
        .map(bound => ({ id: bound.thread, bound }));
    const free = unclaimedCoin(state, tools) - pending.reduce((sum, p) => sum + p.bound.coin, 0);
    if (free <= 0 || previous.some(p => raw < (p.limit ?? p.coin))) return pending;
    const threads = ask(tools.query, 'director.threads') ?? [];
    const active = threads.filter(t => t.rpg?.state === 'active' && creditFor(t, free) > 0);
    const paid = repeatedThreads(state, tools).filter(t => t.rpg.reward.coin >= free);
    const candidates = [...active, ...paid];
    if (candidates.length !== 1) return pending;
    const thread = candidates[0];
    const bound = { type: thread.rpg.state === 'active' ? 'quest.coin' : 'quest.coin.repeat', thread: thread.id,
        instance: thread.rpg.instance, reply, coin: free, limit: raw };
    if (!claims[reservationKey(epoch, bound)] && !pending.some(p => reservationKey(epoch, p.bound) === reservationKey(epoch, bound))) pending.push({ id: thread.id, bound });
    return pending;
}
export const creditCandidates = (state, args, tools) => coinReservations(state, args, tools).map(row => row.id);
export const coinReservation = (state, { id } = {}, tools) => coinReservations(state, {}, tools).find(row => row.id === id) ?? null;
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
    return threads.filter(t => t.rpg?.settlement?.outcome === 'done' && t.rpg.reward.coin >= coin
        && state?.meta?.claims?.[t.rpg.settlement.claim] && receipts.some(r => r.data?.v2?.result?.settlement === t.rpg.settlement.id));
}
export const repeatedCoin = (state, _args, tools) => ({ amount: repeatedThreads(state, tools)[0]?.rpg.reward.coin ?? 0 });

export function questCreditHook(view) {
    if (!pinned(view?.state?.domains?.rules)) return undefined;
    // Select intents now; payOwed rechecks readiness after the preceding objective commands have committed.
    const intents = view.query('quest.autoTurnIns', { pending: true }).sort();
    const ids = [...new Set([...expiredQuests(view), ...intents])];
    // Objective proofs come first; settlement then sees the same prefix as a full replay.
    const reserves = view.query('quest.coinReservations', {}).map(payload => ({ type: 'quest.reserveCoin', payload }));
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
