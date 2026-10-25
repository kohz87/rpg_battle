// Story coin remains SB-owned and always lands in the wallet when it is narrated. RB only records which
// active quest instance a narrated amount may count toward (a proof whose parent is that quest's acceptance);
// the guarded settlement then pays reward minus those surviving amounts. Nothing is held at narration.
import { ask, pinned, stateEpoch } from './seams.js';
import { pendingObjectives } from './objectives.js';
export const turnInKey = (epoch, quest, sid) => `rb:${epoch}:quest:${quest.id}:${quest.instance}:turnin:${sid}`;
const amount = value => Number.isSafeInteger(value) && value > 0 ? value : 0;

export function creditFor(thread, coin) {
    const remaining = Math.max(0, thread.rpg.reward.coin - thread.rpg.storyCredit.coin);
    // Retain the old exact-amount attribution. Giver presence awaits B3's canonical seam.
    return remaining > 0 && coin === remaining ? remaining : 0;
}
const isCoinProof = p => p.owner === 'rpg-battle' && p.kind === 'story' && ['quest.coin', 'quest.coin.repeat'].includes(p.payload?.type)
    && typeof p.payload.reply === 'string' && amount(p.payload.coin) > 0;
/** The surviving narrated-coin attributions, any reply. story.evidence shows a proof only while its acceptance parent shows. */
export const coinProofs = proofs => (proofs ?? []).filter(isCoinProof);
/** What narrated coin on `reply` is already attributed (to any quest, or corrected as a repeat). */
export const attributedOn = (proofs, reply) => coinProofs(proofs).filter(p => p.payload.reply === reply).reduce((sum, p) => sum + p.payload.coin, 0);
/** The narrated coin that counts toward this quest instance: its surviving proofs, capped at the reward. */
export function coinSources(proofs, thread) {
    const rows = coinProofs(proofs).filter(p => p.payload.type === 'quest.coin' && p.payload.thread === thread.id
        && p.payload.instance === thread.rpg.instance);
    return { rows, coin: Math.min(thread.rpg.reward.coin, rows.reduce((sum, p) => sum + p.payload.coin, 0)) };
}
const rawCoin = tools => { const budget = ask(tools.query, 'inventory.storyBudget'); return Math.max(0, amount(budget?.paid) - amount(budget?.vouched)); };
const replyProofs = tools => coinProofs(ask(tools.query, 'story.evidence') ?? []).filter(p => p.payload.reply === tools.reply?.sid);
export function unclaimedCoin(_state, tools) {
    return tools?.reply?.sid ? Math.max(0, rawCoin(tools) - replyProofs(tools).reduce((sum, p) => sum + p.payload.coin, 0)) : 0;
}
/** Only a Continue repeating a reward this reply's settlement already paid takes its duplicate back (see attributeCoin). */
export const repeatKey = (epoch, bound) => `rb:${epoch}:quest-coin-repeat:${bound.reply}:${bound.limit}`;
const recordedRepeats = tools => (tools?.receipts?.() ?? []).filter(row => row.index === tools?.reply?.index).map(row => row.receipt)
    .filter(receipt => receipt?.type === 'quest.attributeCoin' && receipt.data?.bound?.type === 'quest.coin.repeat').map(receipt => receipt.data.bound);

/**
 * The reply's narrated coin and where it may count, as { id, bound } rows. New coin counts toward the one active quest whose
 * remaining reward holds it, or, after the settlement, repeats the one reward this very reply already paid; two candidates stay
 * unattributed and are never guessed. A Re-read first takes up its earlier repeat corrections (they follow the settlement it re-runs).
 */
export function coinAttributions(state, _args, tools) {
    const reply = tools?.reply?.sid;
    if (!reply) return [];
    const raw = rawCoin(tools), epoch = stateEpoch(state), claims = state?.meta?.claims ?? {};
    const previous = recordedRepeats(tools).filter(bound => bound.reply === reply);
    const pending = previous.filter((bound, at) => raw >= bound.limit && !claims[repeatKey(epoch, bound)]
        && previous.findIndex(p => repeatKey(epoch, p) === repeatKey(epoch, bound)) === at).map(bound => ({ id: bound.thread, bound }));
    const free = unclaimedCoin(state, tools) - pending.reduce((sum, row) => sum + row.bound.coin, 0);
    if (free <= 0 || previous.some(bound => raw < bound.limit)) return pending;
    const proofs = ask(tools.query, 'story.evidence') ?? [];
    const active = (ask(tools.query, 'director.threads') ?? []).filter(t => t.rpg?.state === 'active' && !t.rpg.settlement && t.status === 'active' && t.taken
        && t.rpg.reward.coin - coinSources(proofs, t).coin >= free);
    const paid = repeatedThreads(state, tools).filter(t => t.rpg.reward.coin >= free);
    const candidates = [...active, ...paid];
    if (candidates.length !== 1) return pending;
    const thread = candidates[0];
    const bound = { type: thread.rpg.state === 'active' ? 'quest.coin' : 'quest.coin.repeat', thread: thread.id,
        instance: thread.rpg.instance, reply, coin: free, limit: raw };
    return pending.some(row => row.bound.type === bound.type && repeatKey(epoch, row.bound) === repeatKey(epoch, bound)) ? pending : [...pending, { id: thread.id, bound }];
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
    return threads.filter(t => t.rpg?.settlement?.outcome === 'done' && t.rpg.reward.coin >= coin
        && state?.meta?.claims?.[t.rpg.settlement.claim] && receipts.some(r => r.data?.v2?.result?.settlement === t.rpg.settlement.id));
}
export const repeatedCoin = (state, _args, tools) => ({ amount: repeatedThreads(state, tools)[0]?.rpg.reward.coin ?? 0 });

export function questCreditHook(view) {
    if (!pinned(view?.state?.domains?.rules)) return undefined;
    // Select intents now; payOwed rechecks readiness after the preceding objective commands have committed.
    const intents = view.query('quest.autoTurnIns', { pending: true }).sort();
    const ids = [...new Set([...expiredQuests(view), ...intents])];
    // Objective proofs and coin attributions come first; settlement then sees the same prefix as a full replay.
    // A repeat correction follows the settlement it duplicates.
    const rows = view.query('quest.coinAttributions', {}).map(payload => ({ type: 'quest.attributeCoin', payload }));
    const repeats = rows.filter(row => row.payload.bound.type === 'quest.coin.repeat');
    const commands = [...pendingObjectives(view), ...rows.filter(row => !repeats.includes(row)),
        ...ids.map(id => ({ type: 'quest.payOwed', payload: { id } })), ...repeats];
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
