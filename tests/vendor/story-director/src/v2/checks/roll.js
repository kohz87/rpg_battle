// Story Director v2, part **checks**: the modifier of a check and its roll (contract §3 P09). Pure over what the command asked.
//
// One SD actor, optionally one explicit link to a RPG Battle character, one `rules.modifier` projection, at most one NPC State Delta
// social part. With a valid RB projection its parts replace the whole standalone subtotal (two stat bases are never summed); without
// one (no link, RB absent/dormant/off, a throw, a null or a malformed answer) SD's own bonuses apply and the reason is recorded. The final
// modifier is clamped to -30..30 and a `cap` part makes the parts add up to it exactly.

import { topicsOf } from './words.js';

export const MOD_LIMIT = 30;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);
const clip = (text, max) => String(text ?? '').slice(0, max);

/** The standalone subtotal: bonuses[stat] (default 0) and each distinct matching `topic:<name>` once. → parts. */
export function standaloneParts(actor, stat, skill) {
    const bonuses = isRecord(actor?.bonuses) ? actor.bonuses : {};
    const parts = [];
    if (isInt(bonuses[stat]) && bonuses[stat] !== 0) parts.push({ source: 'standalone', ref: stat, reason: `${stat} bonus`, amount: bonuses[stat] });
    for (const topic of topicsOf(skill)) {
        const key = `topic:${topic}`;
        if (isInt(bonuses[key]) && bonuses[key] !== 0) parts.push({ source: 'standalone', ref: key, reason: `${topic} bonus`, amount: bonuses[key] });
    }
    return parts;
}

/** RPG Battle's `rules.modifier` answer as parts, or null when it is not a well-formed RulesModifier for this actor and stat. */
export function rbParts(answer, rbActor, stat) {
    if (!isRecord(answer) || answer.actor !== rbActor || answer.stat !== stat || !isInt(answer.amount) || Math.abs(answer.amount) > MOD_LIMIT || !Array.isArray(answer.parts)) return null;
    const parts = [];
    for (const part of answer.parts) {
        if (!isRecord(part) || typeof part.source !== 'string' || !isInt(part.amount) || Math.abs(part.amount) > MOD_LIMIT || !(part.ref === null || typeof part.ref === 'string')) return null;
        parts.push({ source: clip(part.source, 24), ref: part.ref === null ? null : clip(part.ref, 80), reason: clip(part.reason, 120), amount: part.amount });
    }
    if (parts.reduce((sum, part) => sum + part.amount, 0) !== answer.amount) return null;
    return parts;
}

/** NPC State Delta's `npc.socialModifier` answer as parts (one per reason), or [] when it has none. */
export function socialParts(answer) {
    if (!isRecord(answer) || !isInt(answer.mod) || answer.mod === 0 || !Array.isArray(answer.reasons)) return [];
    const parts = answer.reasons.filter(reason => isRecord(reason) && isInt(reason.value) && reason.value !== 0)
        .map(reason => ({ source: 'social', ref: null, reason: clip(reason.text, 120) || 'how they feel about you', amount: reason.value }));
    // A modifier whose reasons do not add up to it is kept whole as one part, so the parts always sum to what NSD said.
    return parts.reduce((sum, part) => sum + part.amount, 0) === answer.mod ? parts : [{ source: 'social', ref: null, reason: clip(`${answer.name ?? 'they'} ${answer.skill ?? ''}`.trim(), 120) || 'how they feel about you', amount: answer.mod }];
}

/** Clamps the parts' sum to the limit with a `cap` part: → { parts, mod }. */
export function combine(parts) {
    const sum = parts.reduce((total, part) => total + part.amount, 0);
    const mod = Math.max(-MOD_LIMIT, Math.min(MOD_LIMIT, sum));
    return mod === sum ? { parts, mod } : { parts: [...parts, { source: 'cap', ref: null, reason: `held to ${MOD_LIMIT}`, amount: mod - sum }], mod };
}
