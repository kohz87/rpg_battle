// Retained quest projections, from the one SD thread. Legacy quests are readable history only.
import { objectiveProgress, planQuestSettlement } from './planner.js';
import { ranksOf } from './ranks.js';
import { coinAttributions, autoTurnIns, owedCredits, repeatedCoin } from './credit.js';
import { ask, copy, pinned, questInputs, replayInputs, threadOf } from './seams.js';
import { GUIDE_EXAMPLES, GUIDE_RANKS, blockApplies, foeOrderOf, ladderOf, offerBlock } from './offer-block.js';
import { stateFree } from '../rules/mode.js';
import { adjustments } from './offer-log.js';

const historyText = 'From an earlier version (read only).';
const queryOf = tools => tools?.query ?? (typeof tools === 'function' ? tools : () => null);
const legacy = thread => !thread?.rpg;
const all = query => ask(query, 'director.threads') ?? [];
const owedOf = thread => thread.owed && legacy(thread) ? { id: thread.id, key: thread.key, giver: thread.fields?.giver ?? '',
    text: `${thread.owed.text} — from an earlier version`, word: '', phrase: '', countable: false, total: null,
    credit: thread.owed.credit ?? 0, paid: Object.values(thread.owed.paid ?? {}).reduce((n, v) => n + v, 0), left: null, open: false, storyMoney: true, budget: 0, payable: 0, rev: thread.owed.rev ?? 0, ask: false, hint: historyText } : null;

// A query of the feature answers only for a chat pinned in free mode (rules/mode.js); for any other it answers nothing, as a query of a feature that is off does.
const feature = fn => (state, args, tools) => (stateFree(state) ? fn(state, args, tools) : null);
const whole = (value, low, high, fallback) => (Number.isInteger(value) && value >= low && value <= high ? value : fallback);

/** quest.offerBlock({ ranks?, examples? }) → the rules block text of the pin, or null (no pin, no open quest template, or the feature is off). */
function offerBlockQuery(state, args = {}, tools) {
    const rules = state?.domains?.rules;
    const pin = pinned(rules);
    if (!pin || !blockApplies(pin)) return null;
    const query = queryOf(tools);
    const packKey = rules.pin.identity.packKey;
    const trainers = (pin.resolved.manifest?.trainers ?? []).filter(entry => entry.open === true);
    return offerBlock({ pin, ladder: ladderOf(query, pin, packKey), order: foeOrderOf(query, packKey), currency: ask(query, 'inventory.currency'), trainers,
        ranks: whole(args?.ranks, 0, 8, GUIDE_RANKS), examples: whole(args?.examples, 0, 4, GUIDE_EXAMPLES) });
}

/**
 * quest.replyOffers({}) → { jobs, declined }: how many jobs were posted and how many offers were not possible on the reply the head stands for, past the ones
 * their receipts tell (`narrate: false`). From the stored receipts, so a swipe, a delete and a rebuild answer as the live reply did.
 */
function replyOffers(_state, _args, tools) {
    const index = tools?.reply?.index;
    const out = { jobs: 0, declined: 0 };
    if (!Number.isInteger(index)) return out;
    for (const entry of tools?.receipts?.() ?? []) {
        const receipt = entry?.receipt;
        if (entry?.index !== index || receipt?.narrate !== false) continue;
        if (typeof receipt.data?.declined === 'string') out.declined += 1;
        else if (typeof receipt.data?.quest === 'string' && receipt.data.band) out.jobs += 1;
    }
    return out;
}

/** quest.offerBlockOn({}) → whether the rules block is shown (the pin has an open quest template, and the chat was pinned in free mode, as a query of the feature is). */
const offerBlockOn = state => {
    const pin = pinned(state?.domains?.rules);
    return Boolean(pin) && blockApplies(pin);
};

export function createQueries(policy = {}) {
    function progress(_state, args = {}, tools) {
        const query = queryOf(tools);
        const thread = threadOf(query, args);
        if (!thread || !thread.rpg && thread.kind !== 'quest') return null;
        if (legacy(thread)) return { have: 0, need: thread.target?.count ?? 0, met: false, ready: false, countable: false,
            source: null, noun: thread.target?.noun ?? '', label: '', reason: historyText, finish: { ok: false, reason: historyText },
            ...(args.closing === true ? { refusal: historyText, place: false } : {}) };
        const inputs = questInputs(query, thread);
        const result = objectiveProgress(thread, { ...inputs, validateProof: policy.validateProof });
        const plan = planQuestSettlement(thread, inputs, policy);
        const first = thread.rpg.objectives[0];
        const have = result.ok ? result.objectives.reduce((n, o) => n + Math.min(o.have, o.need), 0) : 0;
        const need = thread.rpg.objectives.reduce((n, o) => n + (o.count ?? 1), 0);
        const source = first.kind === 'collect' ? 'inventory' : first.kind === 'kill' ? 'fights' : 'story';
        const noun = first.def ?? first.foe ?? first.text ?? first.place;
        const met = result.ok && result.met;
        const reason = result.ok ? (met ? '' : 'The quest objectives are not met.') : result.message;
        const finish = { ok: plan.ok && plan.outcome === 'done', reason: plan.ok ? plan.outcome === 'expired' ? 'Expired' : '' : plan.message };
        return { have, need, met, ready: met, countable: ['collect', 'kill'].includes(first.kind), source, noun,
            label: `${noun} ${have}/${need}`, reason, finish,
            ...(args.closing === true ? { refusal: finish.ok ? '' : finish.reason, place: false } : {}) };
    }
    function details(state, args = {}, tools) {
        const query = queryOf(tools);
        const thread = threadOf(query, args);
        if (!thread || !thread.rpg && thread.kind !== 'quest') return null;
        const p = progress(state, args, tools);
        return { id: thread.id, key: thread.key, goal: thread.fields?.goal || thread.summary, hasGoal: !!(thread.rpg?.objectives?.length || thread.fields?.goal),
            countable: p.countable, note: thread.fields?.progress ?? thread.fields?.step ?? '', giver: thread.fields?.giver ?? '',
            due: thread.fields?.due ?? '', rank: null, terms: { target: p.noun, reward: legacy(thread) ? thread.reward?.text ?? thread.fields?.reward ?? '' : String(thread.rpg.reward.coin),
                held: '', text: legacy(thread) ? historyText : '', level: '' }, ready: p.ready, waiting: false,
            owed: owedOf(thread) ? { text: owedOf(thread).text } : null, taken: copy(thread.taken), ended: copy(thread.ended),
            status: { state: legacy(thread) ? 'history' : thread.rpg.state, text: legacy(thread) ? historyText : thread.rpg.state },
            history: ask(query, 'chronicle.questLog', { id: thread.id }) ?? [] };
    }
    function board(state, _args, tools) {
        const query = queryOf(tools);
        const threads = all(query).filter(t => t.rpg || t.kind === 'quest');
        const rows = threads.map(t => {
            const detail = details(state, { id: t.id }, tools);
            const p = progress(state, { id: t.id }, tools);
            return { id: t.id, key: t.key, goal: detail.goal, note: detail.note, step: detail.note, giver: detail.giver,
                reward: detail.terms.reward, due: detail.due, taken: !!t.taken, ready: p.ready, progress: p, meter: p.countable,
                status: detail.status, finish: { show: !legacy(t), blocked: !p.finish.ok, reason: p.finish.reason, title: p.finish.reason || `Turn in ${t.key}` },
                details: { ...detail, terms: detail.terms.text, owed: detail.owed?.text ?? '', hasHistory: detail.history.length > 0 },
                ...(t.ended ? { outcome: t.rpg?.state ?? t.ended.outcome, outcomeText: t.rpg?.state ?? t.ended.outcome, reason: t.ended.reason } : {}) };
        });
        const active = rows.filter(r => !threads.find(t => t.id === r.id).ended);
        const finished = rows.filter(r => threads.find(t => t.id === r.id).ended).reverse();
        return { active, finished: finished.slice(0, 20), finishedCount: finished.length, hasActive: active.length > 0, hasFinished: finished.length > 0 };
    }
    return {
        'quest.openTemplates': state => Object.values(pinned(state?.domains?.rules)?.resolved?.quests ?? {}).filter(t => t.open).map(t => ({ id: t.id, name: t.name, kinds: t.objectives.map(o => o.kind) })),
        'quest.replayInputs': replayInputs,
        'quest.offerBlock': feature(offerBlockQuery), 'quest.offerBlockOn': feature(offerBlockOn), 'quest.replyOffers': feature(replyOffers), 'quest.adjustments': feature(adjustments),
        'quest.progress': progress, 'quest.details': details, 'quest.ranks': (state, _args, tools) => pinned(state?.domains?.rules) ? ranksOf(queryOf(tools)) : [],
        'quest.owed': (_state, _args, tools) => all(queryOf(tools)).map(owedOf).filter(Boolean),
        'quest.coinAttributions': coinAttributions, 'quest.owedCredits': owedCredits, 'quest.repeatedCoin': repeatedCoin, 'quest.autoTurnIns': autoTurnIns,
        'quest.followsLadder': (_state, _args, tools) => (typeof tools?.settings === 'function' ? tools.settings() : tools?.settings)?.followLadder !== false, 'quest.board': board,
        'director.retriable': (_state, _args, tools) => {
            const reply = tools?.reply?.sid;
            return [...new Set((tools?.receipts?.() ?? []).map(r => r.receipt ?? r).filter(r => r.data?.reply === reply && r.data?.held).map(r => r.data.quest))];
        },
        'rules.quests': (_state, { state: selected } = {}, tools) => all(queryOf(tools)).filter(t => t.rpg && (!selected || t.rpg.state === selected)).map(t => {
            const p = progress(null, { id: t.id }, tools);
            const clock = ask(queryOf(tools), 'director.time');
            return { ...copy(t.rpg), ready: p.finish.ok, blocked: p.finish.ok ? [] : [p.finish.reason],
                remainingMinutes: t.rpg.deadline !== null && Number.isSafeInteger(clock?.minutes) ? Math.max(0, t.rpg.deadline - clock.minutes) : null };
        }),
    };
}
