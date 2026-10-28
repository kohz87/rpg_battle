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
import { btn, calendarWriter, clip, clockLabel, dayOf, moneyText, spanLabel } from './format.js';
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

function rewardText(reward, names, coins) {
    if (!isRecord(reward)) return '';
    const parts = [];
    if (Number.isSafeInteger(reward.coin) && reward.coin > 0) parts.push(coins(reward.coin));
    if (Number.isSafeInteger(reward.xp) && reward.xp > 0) parts.push(`${reward.xp} XP`);
    for (const item of Array.isArray(reward.items) ? reward.items : []) if (isRecord(item)) parts.push(`${item.qty} × ${names(item.def)}`);
    return parts.join(', ');
}

function settledText(settlement, names, coins) {
    if (!isRecord(settlement)) return '';
    const paid = [];
    if (settlement.coinPaid > 0) paid.push(coins(settlement.coinPaid));
    if (settlement.xpPaid > 0) paid.push(`${settlement.xpPaid} XP`);
    for (const item of Array.isArray(settlement.itemsPaid) ? settlement.itemsPaid : []) if (isRecord(item)) paid.push(`${item.qty} × ${names(item.def)}`);
    if (settlement.outcome === 'done') return paid.length ? `Paid: ${paid.join(', ')}.` : 'Finished.';
    if (settlement.outcome === 'expired') return 'Expired before it was handed in. Nothing was paid.';
    return paid.length ? `Closed. Paid: ${paid.join(', ')}.` : 'Closed. Nothing was paid.';
}

function questRow(quest, names, minutes, words) {
    const open = quest.state === 'offered' || quest.state === 'active';
    const live = quest.state === 'active';
    const remaining = live && Number.isSafeInteger(quest.remainingMinutes) && quest.deadline !== null ? quest.remainingMinutes : null;
    const payload = { id: quest.id };
    return {
        id: quest.id, title: clip(quest.title, 80), category: quest.category, categoryLabel: CATEGORY_WORDS[quest.category] ?? '',
        state: quest.state, stateLabel: STATE_WORDS[quest.state] ?? clip(quest.state, 24), tone: TONES[quest.state] ?? 'neutral',
        open, expired: quest.state === 'expired',
        deadlineText: Number.isSafeInteger(quest.deadline) ? `Due ${words.when(quest.deadline)}` : '',
        remainingText: remaining !== null ? `${spanLabel(remaining) || '0 minutes'} left` : quest.state === 'expired' ? 'Expired' : '',
        objectives: (Array.isArray(quest.objectives) ? quest.objectives : []).map(item => ({ id: isRecord(item) ? String(item.id) : '', text: objectiveText(item, names) })).filter(row => row.text),
        reward: rewardText(quest.reward, names, words.coins),
        settled: settledText(quest.settlement, names, words.coins),
        blocked: quest.blocked.map(item => clip(item, 240)),
        ready: quest.ready,
        repeat: isRecord(quest.repeat)
            ? { text: quest.repeat.nextOfferAt === null || quest.repeat.nextOfferAt === undefined
                ? `Repeats after a ${spanLabel(quest.repeat.cooldownMinutes) || 'short'} wait.`
                : `Repeats after a ${spanLabel(quest.repeat.cooldownMinutes) || 'short'} wait. Next offer ${words.repeat(quest.repeat.nextOfferAt)}.` }
            : null,
        chain: isRecord(quest.chain)
            ? { text: [quest.chain.previous ? `After: ${names(quest.chain.previous)}.` : '', quest.chain.next ? `Next: ${names(quest.chain.next)}.` : 'Last in its chain.'].filter(Boolean).join(' ') }
            : null,
        canTake: quest.state === 'offered' && quest.blocked.length === 0,
        canAbandon: live,
        canFinish: live && quest.ready,
        takePayload: payload, abandonPayload: payload, finishPayload: payload,
        takeButton: btn('quest.take', payload, 'Take', { tone: 'primary' }),
        finishButton: btn('quest.finish', payload, 'Hand in', { tone: 'primary' }),
        abandonButton: btn('quest.abandon', payload, 'Give up', { tone: 'quiet' }),
        minutes,
    };
}

function threadRow(thread, templates = []) {
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
        ...(templates.length ? { canMakeQuest: !thread.rpg && thread.status === 'active',
            binding: { id: thread.id, text: clip(thread.summary || thread.fields?.goal || thread.key, 240), templates } } : {}),
    };
}

const isAdjustment = value => isRecord(value) && isText(value.id) && isText(value.name) && isText(value.band) && Array.isArray(value.changes) && Array.isArray(value.notes);
/** How many adjustments the page shows at once; the rest are behind "Older". */
const SHOWN = 10;

/** The Adjustments log (GENERATIVE_OFFERS_SPEC §9.4): `quest.adjustments` as the page draws it; empty while the feature is off or nothing was adjusted, and where RPG Battle is not answering (`tools` null). */
function adjustmentsView(tools) {
    const found = ask(tools, 'quest.adjustments', { limit: 50 }, value => isRecord(value) && isList(value.rows, isAdjustment));
    const rows = found.status === ASK.OK ? found.value.rows.map(row => ({
        id: row.id, name: clip(row.name, 80), band: row.band, bandLabel: clip(row.bandLabel, 24), kept: row.band === 'kept', adjusted: row.band === 'adjusted', dropped: row.band === 'dropped',
        replyText: isText(row.replyText) ? row.replyText : '', became: clip(row.became, 240),
        changes: row.changes.map(change => ({ k: clip(change.k, 24), from: clip(change.from, 80), to: clip(change.to, 80), unwritten: change.from === '' })),
        droppedText: isText(row.dropped) ? clip(row.dropped, 240) : '', wrote: clip(row.wrote, 700), notes: row.notes.map(note => clip(note, 200)),
    })) : [];
    const more = found.status === ASK.OK && Number.isSafeInteger(found.value.more) && found.value.more > 0 ? found.value.more : 0;
    return { count: rows.length, total: rows.length + more, recent: rows.slice(0, SHOWN), older: rows.slice(SHOWN), hasOlder: rows.length > SHOWN, olderCount: Math.max(0, rows.length - SHOWN), more, moreText: more ? `${more} older adjustment${more === 1 ? ' is' : 's are'} not listed.` : '' };
}

/** rpg-battle.questsView({}) → { state, clock, groups, goals, note, adjustments }. */
export function questsView(state, args, tools) {
    const time = ask(tools, 'director.time', {});
    const minutes = time.status === ASK.OK && Number.isSafeInteger(time.value.minutes) ? time.value.minutes : null;
    // The story's own words for the clock (Story Director's, which knows the calendar): "CY 611, Goldwane 12, 06:40 am".
    const clock = { set: minutes !== null, text: minutes === null ? '' : isText(time.value.text) && time.value.text.trim() ? clip(time.value.text, 80) : clockLabel(minutes) };
    const quests = ask(tools, 'rules.quests', {}, value => isList(value, isQuestView));
    const threads = ask(tools, 'director.threads', {}, value => isList(value, isThread));
    const openTemplates = quests.status === ASK.OK ? ask(tools, 'quest.openTemplates', {}, value => isList(value, row => isRecord(row) && isText(row.id) && isText(row.name) && Array.isArray(row.kinds))).value ?? [] : [];
    const goals = threads.status === ASK.OK ? threads.value.map(thread => threadRow(thread, openTemplates)) : [];

    if (quests.status === ASK.OK) {
        // RPG Battle's quests are written in the chat's calendar and coins ("Goldwane 17", "4 gold"); the plain counts where it has neither.
        const calendar = calendarWriter(ask(tools, 'director.calendar', {}).value);
        const currency = ask(tools, 'inventory.currency', {});
        const words = {
            coins: amount => (currency.status === ASK.OK ? moneyText(amount, currency.value) : `${amount} coin`),
            when: at => {
                if (!calendar) return clockLabel(at);
                const within = ((at % 1440) + 1440) % 1440;
                const day = calendar.date(at, { era: minutes === null || calendar.year(at) !== calendar.year(minutes) });
                return `${day}, ${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`;
            },
            repeat: at => (calendar ? words.when(at) : `${clockLabel(at)} (Day ${dayOf(at)})`),
        };
        if (calendar && minutes !== null) clock.text = calendar.date(minutes);
        const refs = [];
        for (const quest of quests.value) {
            for (const item of Array.isArray(quest.objectives) ? quest.objectives : []) if (isRecord(item)) refs.push(item.foe, item.def, item.place);
            for (const item of quest.reward?.items ?? []) if (isRecord(item)) refs.push(item.def);
            for (const item of quest.settlement?.itemsPaid ?? []) if (isRecord(item)) refs.push(item.def);
            if (quest.chain) refs.push(quest.chain.previous, quest.chain.next);
        }
        const names = namesFor(tools, refs.filter(isText));
        const rows = quests.value.map(quest => questRow(quest, names, minutes, words));
        const taken = new Set(rows.map(row => row.id));
        const groups = [
            { id: 'offers', title: 'Offered to you', quests: rows.filter(row => row.state === 'offered') },
            { id: 'active', title: 'In progress', quests: rows.filter(row => row.state === 'active') },
            { id: 'finished', title: 'Finished', quests: rows.filter(row => !['offered', 'active'].includes(row.state)) },
        ].map(group => ({ ...group, count: group.quests.length, empty: group.quests.length === 0 }));
        return {
            state: 'rpg', clock, groups, goals: goals.filter(row => !taken.has(row.id) && !row.needsRpg),
            note: clock.set ? '' : 'The story clock is not set, so deadlines are not counted yet.',
            adjustments: adjustmentsView(tools),
        };
    }
    if (threads.status === ASK.OK) {
        return {
            state: 'neutral', clock, groups: [], goals, adjustments: adjustmentsView(null),
            note: 'These goals are accepted and closed in the story. Say it in your reply; there is nothing to press here.',
        };
    }
    return { state: 'unavailable', clock, groups: [], goals: [], adjustments: adjustmentsView(null), note: 'Neither RPG Battle nor Story Director is answering, so there are no goals to list.' };
}
