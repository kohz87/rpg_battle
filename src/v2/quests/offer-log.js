// RPG Battle v2, generative offers: the Adjustments log (GENERATIVE_OFFERS_SPEC §9.4, mockups adjustments-desktop.html and adjustments-phone.html):
// `quest.adjustments({ limit })` lists what code changed from the narrator's offers, newest first, read only. One row per record of `rules.offers`,
// `rules.declined` and `training.offers` that has notes or a far band: the offer, a band (Kept, Adjusted, Dropped), the reply it was made on, what it became,
// only the terms that changed (three at most), and behind a details element what the narrator wrote and the notes. Pure: it reads the state and the receipts.

import { flat } from './offer-bands.js';
import { durationText, minutesOf } from './offer-words.js';
import { declinedOf, offersOf, restsOf } from '../rules/offers.js';

export const LOG_LIMIT = 50;
const KIND_WORDS = Object.freeze({ kill: 'Hunt', collect: 'Delivery', story: 'Task', visit: 'Journey' });
const DASH = '—';
const cap = text => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : text);

/** The labels as the narrator wrote them, "giver: Hollis · type: cull · …" (the dash text of a teacher first, as "— swordplay"). */
export function wroteText(said = {}, textKey = 'goal') {
    const parts = Object.entries(said).map(([key, value]) => (key === 'text' && textKey === 'text' ? `${DASH} ${value}` : `${key}: ${value}`));
    return flat(parts.join(' · '), 700);
}

/** "50 gold is far above what a rank F job pays: 4 gold at most" as the short Dropped line of the mockup: "50 gold is far above a rank F job (max 4 gold)". */
function shortReason(reason) {
    const match = /^(.*) is far above what a rank (.+) job pays: (.*) at most$/.exec(reason);
    return match ? `${match[1]} is far above a rank ${match[2]} job (max ${match[3]})` : reason;
}

/** The terms that changed between what was written and what was settled: [{ k, from, to }] with from '' when nothing was written. */
function changesOfJob(record) {
    const { said, settled, shown = {}, notes } = record;
    const rows = [];
    const moved = notes.some(note => /^reward /.test(note));
    if (said.reward && (settled.coinBy === 'formula' || moved)) rows.push({ k: 'reward', from: said.reward, to: shown.coin });
    if (settled.count !== undefined && (said.count === undefined || String(said.count) !== String(settled.count))) rows.push({ k: 'count', from: said.count ?? '', to: String(settled.count) });
    if (shown.deadline && (!said.due || minutesOf(said.due) !== settled.durationMinutes)) rows.push({ k: 'deadline', from: said.due ?? '', to: shown.deadline });
    return rows.slice(0, 3);
}

function changesOfTeacher(offer) {
    const { said = {}, shown = {} } = offer.settled;
    const rows = [];
    const asked = said.text ?? said.teaches ?? '';
    if (shown.template && asked && !said.like && asked.toLowerCase() !== shown.template.toLowerCase()) rows.push({ k: 'skill', from: asked, to: shown.template });
    if (shown.fee && (offer.settled.feeBy !== 'said' || offer.settled.notes.some(note => /^fee set to /.test(note)))) rows.push({ k: 'fee', from: said.fee ?? '', to: shown.fee });
    return rows.slice(0, 3);
}

const row = (fields, receipts) => {
    const at = receipts.get(fields.id);
    return { ...fields, reply: at === undefined ? null : at, replyText: at === undefined ? '' : `reply ${at}` };
};

/** quest.adjustments({ limit? }) → { count, rows } newest first; the state is the head, the receipts say which reply each record came from. */
export function adjustments(state, args = {}, tools) {
    const limit = Number.isInteger(args?.limit) && args.limit >= 1 && args.limit <= 200 ? args.limit : LOG_LIMIT;
    const receipts = new Map();
    for (const entry of tools?.receipts?.() ?? []) {
        const data = (entry.receipt ?? entry)?.data;
        for (const id of [data?.quest, data?.declined, data?.trainer, data?.record]) if (typeof id === 'string' && Number.isInteger(entry.index)) receipts.set(id, entry.index);
    }
    const out = [];
    for (const [id, record] of Object.entries(offersOf(state?.domains?.rules))) {
        if (!record.notes.length) continue;
        const kind = record.settled.foe ? 'kill' : record.settled.item ? 'collect' : record.settled.place ? 'visit' : 'story';
        const shown = record.shown ?? {};
        out.push(row({ id, kind: 'job', name: record.name, band: record.band === 'moderate' ? 'adjusted' : 'kept', bandLabel: record.band === 'moderate' ? 'Adjusted' : 'Kept',
            became: [KIND_WORDS[kind], shown.objective, shown.coin, `${record.settled.xp} XP`, shown.deadline].filter(Boolean).join(' · '),
            changes: changesOfJob(record), dropped: '', wrote: wroteText(record.said), notes: [...record.notes], where: record.where }, receipts));
    }
    for (const [id, offer] of Object.entries(state?.domains?.training?.offers ?? {})) {
        const settled = offer.settled;
        if (!settled || !settled.notes.length) continue;
        const shown = settled.shown ?? {};
        out.push(row({ id, kind: 'teacher', name: offer.name, band: settled.band === 'moderate' ? 'adjusted' : 'kept', bandLabel: settled.band === 'moderate' ? 'Adjusted' : 'Kept',
            became: ['Trainer', shown.template || shown.teaches, shown.fee ? `fee ${shown.fee}` : '', offer.where].filter(Boolean).join(' · '),
            changes: changesOfTeacher(offer), dropped: '', wrote: wroteText(settled.said, 'text'), notes: [...settled.notes], where: offer.where }, receipts));
    }
    for (const [id, record] of Object.entries(declinedOf(state?.domains?.rules))) {
        const said = record.said ?? {};
        out.push(row({ id, kind: record.kind ?? 'job', name: record.name, band: 'dropped', bandLabel: 'Dropped',
            became: [cap(said.type) || (record.kind === 'teacher' ? 'Teacher' : 'Job'), said.goal ?? said.text, said.reward ?? said.fee, 'not offered'].filter(Boolean).join(' · '),
            changes: [], dropped: `${shortReason(record.reason)}. The narrator was told once.`, wrote: wroteText(said, record.kind === 'teacher' ? 'text' : 'goal'),
            notes: [record.reason, `Told once: “…offer ${record.suggestion}.”`], where: '' }, receipts));
    }
    // A rest the story wrote that the reply's time did not pay for: nobody rested (party/capture.js restWanted).
    for (const [id, record] of Object.entries(restsOf(state?.domains?.rules))) {
        const word = record.kind === 'long' ? 'Long rest' : 'Short rest';
        out.push(row({ id, kind: 'rest', name: word, band: 'dropped', bandLabel: 'Dropped', became: `${word} · not taken`, changes: [],
            dropped: `The reply moved the clock ${record.moved ? durationText(record.moved) : 'not at all'}; a ${record.kind} rest needs ${durationText(record.needed)}. The narrator was told once.`,
            wrote: wroteText(record.said ?? {}, 'goal'), notes: [`${durationText(record.needed)} needed, ${record.moved ? durationText(record.moved) : 'none'} passed`], where: '' }, receipts));
    }
    const rows = out.sort((a, b) => (b.reply ?? -1) - (a.reply ?? -1) || (a.id < b.id ? 1 : -1)).slice(0, limit);
    return { count: rows.length, rows };
}
