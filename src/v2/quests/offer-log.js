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

const row = (fields, place) => {
    const at = place.reply;
    return { ...fields, reply: at === null ? null : at, replyText: at === null ? '' : `reply ${at}`, order: place.order };
};

/** quest.adjustments({ limit? }) → { count, rows, more } newest first (`more`: how many older ones the limit leaves out); the state is the head, the receipts say which reply each record came from. */
export function adjustments(state, args = {}, tools) {
    const limit = Number.isInteger(args?.limit) && args.limit >= 1 && args.limit <= 200 ? args.limit : LOG_LIMIT;
    // Where each reply stands in the chat now (the first receipt stored on it) and where each receipt that names a record stands among all of them: the reply a record was made on is found by
    // the record's own reply (its sid), else by the receipt that carries its id; among the records of one reply, the order of those receipts is the order of its lines.
    const repliesAt = new Map();
    const byId = new Map();
    let seq = 0;
    for (const entry of tools?.receipts?.() ?? []) {
        seq += 1;
        const receipt = entry.receipt ?? entry;
        const index = Number.isInteger(entry.index) ? entry.index : null;
        const sid = receipt?.data?.v2?.source?.sid;
        if (index !== null && typeof sid === 'string' && !repliesAt.has(sid)) repliesAt.set(sid, index);
        // A quest's acceptance and turn-in carry its id too, but they come after the offer.
        for (const id of [receipt?.data?.quest, receipt?.data?.declined, receipt?.data?.trainer, receipt?.data?.record]) {
            if (typeof id === 'string' && index !== null && !byId.has(id)) byId.set(id, { index, seq });
        }
    }
    // Where a record stands among the keys of the rules slice, which were added in the order the replies made them: what orders the records no receipt names (old ones).
    const slice = state?.domains?.rules;
    const keys = Object.keys(slice ?? {});
    const keyAt = (prefix, id) => keys.indexOf(prefix + id);
    const placed = (id, sid, fallback) => {
        const named = byId.get(id);
        const reply = repliesAt.get(sid) ?? named?.index ?? null;
        return { reply, order: named ? named.seq : -1e6 + fallback };
    };
    const out = [];
    for (const [id, record] of Object.entries(offersOf(slice))) {
        if (!record.notes.length) continue;
        const kind = record.settled.foe ? 'kill' : record.settled.item ? 'collect' : record.settled.place ? 'visit' : 'story';
        const shown = record.shown ?? {};
        out.push(row({ id, kind: 'job', name: record.name, band: record.band === 'moderate' ? 'adjusted' : 'kept', bandLabel: record.band === 'moderate' ? 'Adjusted' : 'Kept',
            became: [KIND_WORDS[kind], shown.objective, shown.coin, `${record.settled.xp} XP`, shown.deadline].filter(Boolean).join(' · '),
            changes: changesOfJob(record), dropped: '', wrote: wroteText(record.said), notes: [...record.notes], where: record.where }, placed(id, record.sid, keyAt('offer.', id))));
    }
    for (const [at, [id, offer]] of Object.entries(state?.domains?.training?.offers ?? {}).entries()) {
        const settled = offer.settled;
        if (!settled || !settled.notes.length) continue;
        const shown = settled.shown ?? {};
        out.push(row({ id, kind: 'teacher', name: offer.name, band: settled.band === 'moderate' ? 'adjusted' : 'kept', bandLabel: settled.band === 'moderate' ? 'Adjusted' : 'Kept',
            became: ['Trainer', shown.template || shown.teaches, shown.fee ? `fee ${shown.fee}` : '', offer.where].filter(Boolean).join(' · '),
            changes: changesOfTeacher(offer), dropped: '', wrote: wroteText(settled.said, 'text'), notes: [...settled.notes], where: offer.where }, placed(id, settled.sid, at)));
    }
    for (const [id, record] of Object.entries(declinedOf(slice))) {
        const said = record.said ?? {};
        out.push(row({ id, kind: record.kind ?? 'job', name: record.name, band: 'dropped', bandLabel: 'Dropped',
            became: [cap(said.type) || (record.kind === 'teacher' ? 'Teacher' : 'Job'), said.goal ?? said.text, said.reward ?? said.fee, 'not offered'].filter(Boolean).join(' · '),
            changes: [], dropped: `${shortReason(record.reason)}. The narrator was told once.`, wrote: wroteText(said, record.kind === 'teacher' ? 'text' : 'goal'),
            notes: [record.reason, `Told once: “…offer ${record.suggestion}.”`], where: '' }, placed(id, record.sid, keyAt('declined.', id))));
    }
    // A rest the story wrote that the reply's time did not pay for: nobody rested (party/capture.js restWanted).
    for (const [id, record] of Object.entries(restsOf(slice))) {
        const word = record.kind === 'long' ? 'Long rest' : 'Short rest';
        const place = record.place ?? '';
        const hours = record.kind === 'long' ? Math.round(record.needed / 60) + 2 : Math.max(1, Math.round(record.needed / 60));
        const passed = record.moved ? `Only ${durationText(record.moved)} of story time passed` : 'No story time passed';
        const wrote = ['rest', 'place'].map(key => (key === 'rest' ? `rest: ${record.kind}` : place ? `place: ${place}` : '')).filter(Boolean);
        if (record.said?.text) wrote.push(record.said.text);
        out.push(row({ id, kind: 'rest', name: place ? `${word} at ${place}` : word, band: 'dropped', bandLabel: 'Dropped', changes: [],
            became: ['Rest', record.kind, place, 'not taken'].filter(Boolean).join(' · '),
            dropped: `${passed} in that reply; a ${record.kind} rest needs ${durationText(record.needed)} (e.g. ! time +${hours}h). Nothing was healed.`,
            wrote: flat(wrote.join(' · '), 700), notes: [`${durationText(record.needed)} needed, ${record.moved ? durationText(record.moved) : 'none'} passed`], where: place }, placed(id, record.sid, keyAt('rest.', id))));
    }
    // Newest first: by the reply that made the record as the chat stands now, and among those of one reply (or of none that is known: receipts that were trimmed) by where its line stood, the last first. A record whose reply is no longer among the receipts comes last, with no number.
    const sorted = out.sort((a, b) => (b.reply ?? -1) - (a.reply ?? -1) || b.order - a.order || (a.id < b.id ? 1 : -1)).map(({ order: _order, ...rest }) => rest);
    const total = sorted.length;
    const rows = sorted.slice(0, limit);
    return { count: rows.length, rows, more: Math.max(0, total - rows.length) };
}
