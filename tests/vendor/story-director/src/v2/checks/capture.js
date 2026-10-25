// Story Director v2, part **checks**: the `check` change line (contract §3 P09, "Transfer the checks domain, check capture and shipped check
// interfaces to SD"; E7b "capture.check resolves via SD checks.roll once"). The story writes
//   ? check <skill> — what is attempted | dc: easy|normal|hard|very hard|<1-40> | who: Name | vs: Name
// and this line is **one** `checks.roll` in the same transaction: one d20 for the actor, the modifiers of the policy. The model's own
// `result:` is never read (no supplied outcome), a line that cannot be rolled fails whole (no claim, no die), and the same line on the
// same reply cannot roll twice (swipe, Continue and Re-read keep the claim of the block they stand on).
//
// `who` names one of Story Director's own actors by its name (exact, any case); `vs` names a person NPC State Delta knows. Neither is
// guessed. Story Director alone registers this kind (contract P09).

import { policyOf } from './domain.js';
import { dcOf } from './words.js';

export const GRAMMAR = '? check <a stat or skill> — what is attempted | dc: easy|normal|hard|very hard | who: Name | vs: Name';

const keyOf = text => String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function ask(ctx, name, args) {
    try {
        return { ok: true, value: ctx.query(name, args) ?? null };
    } catch {
        return { ok: false, value: null };
    }
}

export function applyCheck(ctx, line) {
    const labels = {};
    for (const [key, value] of Object.entries(line?.labels ?? {})) labels[keyOf(key)] = String(value ?? '').trim();
    const skill = String(line?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const statWord = labels.stat ? labels.stat.toUpperCase() : '';
    if (!skill && !statWord) ctx.fail('INVALID', 'A check needs a skill or a stat.');
    const dc = labels.dc === undefined || labels.dc === '' ? undefined : dcOf(labels.dc);
    if (dc === null) ctx.fail('INVALID', 'The difficulty is easy, normal, hard, very hard or a number from 1 to 40.');
    if (!ctx.source?.evidence) ctx.fail('REFUSED', 'A check is rolled on a reply, and there is none yet: send a message first.');
    const payload = { skill: skill || statWord, evidence: ctx.source.evidence };
    if (statWord) payload.stat = statWord;
    if (dc !== undefined) payload.dc = dc;
    if (labels.who) {
        const actors = Object.values(policyOf(ctx.read('checks')).actors);
        const found = actors.find(actor => keyOf(actor.name) === keyOf(labels.who));
        if (!found) ctx.fail('NOT_FOUND', `No actor called ${labels.who.slice(0, 40)}.`);
        payload.actor = found.id;
    }
    if (labels.vs) {
        const identity = ask(ctx, 'npc.identity', { name: labels.vs });
        if (identity.ok && identity.value?.id) payload.targetNpc = identity.value.id;
        else if (identity.ok) ctx.fail('NOT_FOUND', `Nobody is known as ${labels.vs.slice(0, 40)}.`);
    }
    const rolled = ctx.call('checks.roll', payload);
    return { ...rolled, narrate: true };
}

export const kind = { grammar: GRAMMAR, apply: applyCheck };
