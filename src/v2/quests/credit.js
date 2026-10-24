// Story coin remains SB-owned. RB only attributes it to one reward on that reply.
import { ask, stateEpoch } from './seams.js';
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
export function autoTurnIns(state, _args, tools) {
    const sid = tools?.reply?.sid;
    if (!sid) return [];
    const threads = ask(tools.query, 'director.threads') ?? [];
    return threads.filter(t => t.rpg?.state === 'active' && state?.meta?.claims?.[turnInKey(stateEpoch(state), t.rpg, sid)]
        && ask(tools.query, 'quest.progress', { id: t.id })?.finish?.ok).map(t => t.id);
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
    const ids = [...new Set([...view.query('quest.autoTurnIns', {}), ...view.query('quest.owedCredits', {})])];
    return ids.length ? { lines: [], commands: ids.map(id => ({ type: 'quest.payOwed', payload: { id, credit: true } })) } : undefined;
}
