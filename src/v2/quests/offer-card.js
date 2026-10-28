// RPG Battle v2, generative offers: what the reply's card says of the jobs and teachers the story offered on it (GENERATIVE_OFFERS_SPEC §9.1, mockup
// State A): one line each, "Posted: Granary Vermin, kill 6 Culvert Rats, 5 silver", a small Adjusted flag when code moved something, and one short Why.
// `hooks.replyCard` (MODULES §F125) gets the reply's state and the JSON Pointers its ops touched, so it lists only what that reply did. Pure.

import { flat } from './offer-bands.js';
import { offersOf } from '../rules/offers.js';
import { stateFree } from '../rules/mode.js';

const OFFER = /^\/domains\/rules\/offer\.(th_[0-9a-z]{8})(?:\/|$)/;
const TEACHER = /^\/domains\/training\/offers\/(tn_[0-9a-z]{8})(?:\/|$)/;
const NOTE_CHARS = 160;

/** The clauses of the one short Why, from a record's notes and the labels as read, most important first (§9.2 wording, said as a sentence). */
function clauses(notes, said, shown) {
    const out = [];
    const find = pattern => notes.map(note => pattern.exec(note)).find(Boolean);
    const money = find(/^reward "(.*)" is not this chat's money; set to (.*)$/);
    if (money) out.push({ lead: `${money[1]} isn’t this chat’s money`, alone: `so it was set to ${money[2]}` });
    const unread = find(/^reward "(.*)" has no amount code can read; set to (.*)$/);
    if (unread) out.push({ lead: `“${unread[1]}” isn’t an amount code can read`, alone: `so it was set to ${unread[2]}` });
    const held = find(/^reward set to (.*) \(rank (.*) range\)$/);
    if (held) out.push({ lead: `${said.reward ?? 'the reward'} is outside what a rank ${held[2]} job pays`, alone: `so it was set to ${held[1]}` });
    const fee = find(/^fee set to (.*)$/);
    if (fee) out.push({ lead: `${said.fee ?? 'the fee'} is outside what ${shown?.template || 'this teacher'} charges`, alone: `so it was set to ${fee[1]}` });
    const foreignFee = find(/^fee "(.*)" is not this chat's money/);
    if (foreignFee) out.push({ lead: `${foreignFee[1]} isn’t this chat’s money`, alone: 'so the fee was rolled instead' });
    const count = find(/^count set to (\d+)$/);
    if (count) out.push({ lead: `the count was set to ${count[1]}` });
    const capped = find(/^count capped at (\d+)$/);
    if (capped) out.push({ lead: `the count was capped at ${capped[1]}` });
    const aside = find(/^difficulty (.*) set aside: (.*) is a rank (.*) foe$/);
    if (aside) out.push({ lead: `${aside[1]} was set aside because ${aside[2]} is a rank ${aside[3]} foe` });
    if (find(/^well above your rank/)) out.push({ lead: 'it is well above your rank' });
    if (out.length) return out;
    // Routine fill-ins are a reason only when nothing else moved.
    const deadline = find(/^deadline set to (.*)$/);
    if (deadline) out.push({ lead: `the deadline was set to ${deadline[1]}` });
    const variant = find(/^(.*) is a named kind of (.*)$/);
    if (variant) out.push({ lead: `${variant[1]} is a named kind of ${variant[2]}` });
    const skill = find(/^(.*) is not taught by (.*)$/);
    if (skill) out.push({ lead: `${skill[1]} is not taught by ${skill[2]}` });
    return out;
}

/** The one short Why of a record: its two most important clauses, "12 crowns isn’t this chat’s money, so it was set to 5 silver." Empty when there are no notes. */
export function whyLine({ notes = [], said = {}, shown = null } = {}) {
    const list = clauses(notes, said, shown);
    if (!list.length) return notes.length ? flat(`${notes[0]}.`, NOTE_CHARS) : '';
    const [first, second] = list;
    const text = second ? `${first.lead}, and ${second.lead}.` : first.alone ? `${first.lead}, ${first.alone}.` : `${first.lead[0].toUpperCase()}${first.lead.slice(1)}.`;
    return flat(text, NOTE_CHARS);
}

const flagsOf = record => [record.band === 'moderate' ? 'Adjusted' : '', (record.notes ?? []).some(note => note.startsWith('well above your rank')) ? 'Above your rank' : ''].filter(Boolean).join(' · ');

/** hooks.replyCard({ index, state, changes }) → the lines of the offers this reply made. */
export function offerCard({ state, changes = [] } = {}) {
    if (!stateFree(state)) return [];
    const rules = offersOf(state?.domains?.rules);
    const taught = state?.domains?.training?.offers ?? {};
    const seen = new Set();
    const lines = [];
    for (const pointer of changes) {
        const job = OFFER.exec(pointer);
        const teacher = job ? null : TEACHER.exec(pointer);
        const id = (job ?? teacher)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (job && rules[id]) {
            const record = rules[id];
            const shown = record.shown ?? {};
            const parts = [record.name, shown.objective, shown.coin].filter(Boolean);
            lines.push({ icon: 'fa-scroll', text: `Posted: ${parts.join(', ')}`, summary: `Job: ${record.name}`, flag: flagsOf(record), note: whyLine(record) });
        } else if (teacher && taught[id]?.settled) {
            const offer = taught[id];
            const shown = offer.settled.shown ?? {};
            const parts = [offer.name, shown.template || shown.teaches, shown.fee ? `${shown.fee} a session` : ''].filter(Boolean);
            lines.push({ icon: 'fa-chalkboard-user', text: `Posted: ${parts.join(', ')}`, summary: `Teacher: ${offer.name}`, flag: flagsOf(offer.settled), note: whyLine({ notes: offer.settled.notes, said: offer.settled.said, shown: { template: shown.template } }) });
        }
    }
    return lines;
}
