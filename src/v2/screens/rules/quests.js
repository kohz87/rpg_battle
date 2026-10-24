// RPG Battle v2, screens for the rules-v2 views (track C): the Quests page's view query, `rpg-battle.questsView`.
//
// Two sources, never mixed up:
//   rules.quests    (RPG Battle's QuestView[]: pending A) the quests that carry rewards, deadlines, repeat and chain
//   director.threads (Story Director's thread records, shipped) the goals, with or without RPG Battle
//
// state 'rpg' when rules.quests answers (an empty list is an answer); 'neutral' when only Story Director does: the goals
// are listed as they are and are accepted in the story, so there are NO buttons (RB_PHASE0 §3 P23: no new quest
// buttons); 'unavailable' when neither does. In 'rpg' the quest buttons are RPG Battle's own commands (quest.take,
// quest.abandon, quest.finish with { id }); whether a quest is ready, blocked or expired is the QuestView's word.
// The deadline test (now >= deadline) is RPG Battle's: this page shows `state`, `ready`, `blocked` and
// `remainingMinutes` as given.

import { ASK, ask, isList, isQuestView, isRecord, isText } from './ask.js';
import { clip, clockLabel, dayOf, spanLabel } from './format.js';
import { namesFor } from './names.js';

const isThread = value => isRecord(value) && isText(value.id) && isText(value.key) && ['active', 'resolved'].includes(value.status) && typeof value.offer === 'boolean';

const STATE_WORDS = Object.freeze({
    offered: 'Offered', active: 'In progress', done: 'Done', failed: 'Failed', expired: 'Expired', abandoned: 'Abandoned',
});
const TONES = Object.freeze({ offered: 'accent', active: 'info', done: 'good', failed: 'bad', expired: 'bad', abandoned: 'neutral' });
const CATEGORY_WORDS = Object.freeze({ main: 'Main', side: 'Side', bounty: 'Bounty' });

function objectiveText(objective, names) {
    if (!isRecord(objective)) return '';
    if (objective.kind === 'kill') return `Defeat ${objective.count} × ${names(objective.foe)}`;
    if (objective.kind === 'collect') return `Collect ${objective.count} × ${names(objective.def)}${objective.consume ? ' (handed in)' : ''}`;
    if (objective.kind === 'visit') return `Visit ${names(objective.place)}`;
    if (objective.kind === 'story') return clip(objective.text, 240);
    return '';
}

function rewardText(reward, names) {
    if (!isRecord(reward)) return '';
    const parts = [];
    if (Number.isSafeInteger(reward.coin) && reward.coin > 0) parts.push(`${reward.coin} coin`);
    if (Number.isSafeInteger(reward.xp) && reward.xp > 0) parts.push(`${reward.xp} XP`);
    for (const item of Array.isArray(reward.items) ? reward.items : []) if (isRecord(item)) parts.push(`${item.qty} × ${names(item.def)}`);
    return parts.join(', ');
}

function settledText(settlement, names) {
    if (!isRecord(settlement)) return '';
    const paid = [];
    if (settlement.coinPaid > 0) paid.push(`${settlement.coinPaid} coin`);
    if (settlement.xpPaid > 0) paid.push(`${settlement.xpPaid} XP`);
    for (const item of Array.isArray(settlement.itemsPaid) ? settlement.itemsPaid : []) if (isRecord(item)) paid.push(`${item.qty} × ${names(item.def)}`);
    if (settlement.outcome === 'done') return paid.length ? `Paid: ${paid.join(', ')}.` : 'Finished.';
    if (settlement.outcome === 'expired') return 'Expired before it was handed in. Nothing was paid.';
    return paid.length ? `Closed. Paid: ${paid.join(', ')}.` : 'Closed. Nothing was paid.';
}

function questRow(quest, names, minutes) {
    const open = quest.state === 'offered' || quest.state === 'active';
    const live = quest.state === 'active';
    const remaining = live && Number.isSafeInteger(quest.remainingMinutes) && quest.deadline !== null ? quest.remainingMinutes : null;
    const payload = { id: quest.id };
    return {
        id: quest.id, title: clip(quest.title, 80), category: quest.category, categoryLabel: CATEGORY_WORDS[quest.category] ?? '',
        state: quest.state, stateLabel: STATE_WORDS[quest.state] ?? clip(quest.state, 24), tone: TONES[quest.state] ?? 'neutral',
        open, expired: quest.state === 'expired',
        deadlineText: Number.isSafeInteger(quest.deadline) ? `Due ${clockLabel(quest.deadline)}` : '',
        remainingText: remaining !== null ? `${spanLabel(remaining) || '0 minutes'} left` : quest.state === 'expired' ? 'Expired' : '',
        objectives: (Array.isArray(quest.objectives) ? quest.objectives : []).map(item => ({ id: isRecord(item) ? String(item.id) : '', text: objectiveText(item, names) })).filter(row => row.text),
        reward: rewardText(quest.reward, names),
        settled: settledText(quest.settlement, names),
        blocked: quest.blocked.map(item => clip(item, 240)),
        ready: quest.ready,
        repeat: isRecord(quest.repeat)
            ? { text: quest.repeat.nextOfferAt === null || quest.repeat.nextOfferAt === undefined
                ? `Repeats after a ${spanLabel(quest.repeat.cooldownMinutes) || 'short'} wait.`
                : `Repeats after a ${spanLabel(quest.repeat.cooldownMinutes) || 'short'} wait. Next offer ${clockLabel(quest.repeat.nextOfferAt)} (Day ${dayOf(quest.repeat.nextOfferAt)}).` }
            : null,
        chain: isRecord(quest.chain)
            ? { text: [quest.chain.previous ? `After: ${names(quest.chain.previous)}.` : '', quest.chain.next ? `Next: ${names(quest.chain.next)}.` : 'Last in its chain.'].filter(Boolean).join(' ') }
            : null,
        canTake: quest.state === 'offered' && quest.blocked.length === 0,
        canAbandon: live,
        canFinish: live && quest.ready,
        takePayload: payload, abandonPayload: payload, finishPayload: payload,
        minutes,
    };
}

function threadRow(thread) {
    let label = 'In progress';
    let tone = 'info';
    if (thread.offer) { label = 'Offered'; tone = 'accent'; } else if (thread.status === 'resolved') {
        const outcome = isRecord(thread.ended) ? String(thread.ended.outcome ?? '') : '';
        label = outcome ? outcome.charAt(0).toUpperCase() + outcome.slice(1) : 'Closed';
        tone = outcome === 'done' ? 'good' : outcome === 'failed' ? 'bad' : 'neutral';
    }
    return {
        id: thread.id, title: clip(thread.key, 120), summary: clip(thread.summary, 600), stateLabel: label, tone, offer: thread.offer,
        needsRpg: isRecord(thread.rpg),
    };
}

/** rpg-battle.questsView({}) → { state, clock, groups, goals, note }. */
export function questsView(state, args, tools) {
    const time = ask(tools, 'director.time', {});
    const minutes = time.status === ASK.OK && Number.isSafeInteger(time.value.minutes) ? time.value.minutes : null;
    const clock = { set: minutes !== null, text: minutes !== null ? clockLabel(minutes) : '' };
    const quests = ask(tools, 'rules.quests', {}, value => isList(value, isQuestView));
    const threads = ask(tools, 'director.threads', {}, value => isList(value, isThread));
    const goals = threads.status === ASK.OK ? threads.value.map(threadRow) : [];

    if (quests.status === ASK.OK) {
        const refs = [];
        for (const quest of quests.value) {
            for (const item of Array.isArray(quest.objectives) ? quest.objectives : []) if (isRecord(item)) refs.push(item.foe, item.def, item.place);
            for (const item of quest.reward?.items ?? []) if (isRecord(item)) refs.push(item.def);
            for (const item of quest.settlement?.itemsPaid ?? []) if (isRecord(item)) refs.push(item.def);
            if (quest.chain) refs.push(quest.chain.previous, quest.chain.next);
        }
        const names = namesFor(tools, refs.filter(isText));
        const rows = quests.value.map(quest => questRow(quest, names, minutes));
        const taken = new Set(rows.map(row => row.id));
        const groups = [
            { id: 'offers', title: 'Offered to you', quests: rows.filter(row => row.state === 'offered') },
            { id: 'active', title: 'In progress', quests: rows.filter(row => row.state === 'active') },
            { id: 'finished', title: 'Finished', quests: rows.filter(row => !['offered', 'active'].includes(row.state)) },
        ].map(group => ({ ...group, count: group.quests.length, empty: group.quests.length === 0 }));
        return {
            state: 'rpg', clock, groups, goals: goals.filter(row => !taken.has(row.id) && !row.needsRpg),
            note: clock.set ? '' : 'The story clock is not set, so deadlines are not counted yet.',
        };
    }
    if (threads.status === ASK.OK) {
        return {
            state: 'neutral', clock, groups: [], goals,
            note: 'These goals are accepted and closed in the story. Say it in your reply; there is nothing to press here.',
        };
    }
    return { state: 'unavailable', clock, groups: [], goals: [], note: 'Neither RPG Battle nor Story Director is answering, so there are no goals to list.' };
}
