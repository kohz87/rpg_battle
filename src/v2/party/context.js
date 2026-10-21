// What the model is told about the party (SPEC §5): a static rule (fixed words, byte-identical
// every reply) and a compact tail line per member, code's numbers only: level, HP/MP/SP and
// conditions. Waiting offers are optional lines (dropped first when the budget is tight). Pure.

import { levelTag } from '../../terms.js';
import { rulesFrom } from './sheets.js';
import { actorsInOrder } from './util.js';

export const STATIC = 'Party numbers (HP, MP, SP, XP, levels) are set by code: never write them; write a wound, rest or check line instead, and tell what the [Happened] lines say.';

export const BUDGET = 250;

function settingsFrom(view) {
    const source = view?.settings;
    if (typeof source === 'function') {
        try { return source(); } catch { return null; }
    }
    return source ?? null;
}

/** One member: "Ren (you): Lv 4 · HP 57/82 · MP 20/30 · SP 40/40 · poisoned". */
export function actorLine(actor, { pc = false, rules } = {}) {
    const who = pc ? `${actor.name} (you)` : `${actor.name}${actor.role ? ` (${actor.role})` : ''}`;
    const conditions = (actor.conditions ?? []).map(entry => (entry.stacks > 1 ? `${entry.kind} ×${entry.stacks}` : entry.kind));
    const down = actor.hp.cur <= 0 ? ['down'] : [];
    return [`${who}: ${levelTag(actor.level, rules)}`, `HP ${actor.hp.cur}/${actor.hp.max}`, `MP ${actor.mp.cur}/${actor.mp.max}`, `SP ${actor.sp.cur}/${actor.sp.max}`, ...down, ...conditions].join(' · ');
}

/** The party's tail: { lines, optional } for context.tail(view). */
export function tail(view) {
    const party = view?.state?.domains?.party;
    if (!party) return { lines: [], optional: [] };
    const rules = rulesFrom(settingsFrom(view));
    const lines = actorsInOrder(party).map(actor => `Party: ${actorLine(actor, { pc: actor.id === party.pc, rules })}`);
    const waiting = (party.offers ?? []).map(offer => (offer.kind === 'join'
        ? `${offer.name} asked to join`
        : offer.kind === 'leave'
            ? `${party.actors?.[offer.actor]?.name ?? 'someone'} may leave`
            : `${party.actors?.[offer.actor]?.name ?? 'someone'} may learn ${offer.skill}`));
    const optional = waiting.length ? [`Party, waiting on the reader: ${waiting.join('; ')} (do not write these lines again).`] : [];
    return { lines, optional };
}

export const context = { static: () => STATIC, tail, budget: BUDGET };
