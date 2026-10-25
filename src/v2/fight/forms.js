// RPG Battle v2, a pinned form as a fighter's skill (B3/B4: "foeToEngine/formToEngine adapters"; "stable skill/form IDs"). The engine
// reads a skill by its fields; a form becomes one that also carries what the typed interpreter (interpret.js) needs:
//
//   formId, skillId   the stable ids the actions name (a display name is only a label and may change)
//   formMastery       0..5, from the credited uses (the contract's steps), applied once as 1 + 0.1 x mastery
//   parts             the form's effects, frozen, in their order (the actions choose targets by index)
//   costs             { mp, sp }: the cost record, both pools, paid once
//   cooldown          actor turns
//   type, stat, power, target, effect   the v1 fields the automatic turns and the previews read: the form's own type and stat, the
//                     first powered effect's power and target word. (A mixed form's AI is v1's: it plays by its type.)
//
// The pack's skill keeps its stable ids through renames: nothing here reads a live pack, only the frozen form of the pin. Pure.

import { SHIELD_ROUNDS } from './interpret.js';

const clone = value => structuredClone(value);

/** The v1 target word of a form: the first effect's. */
const targetWord = form => form.effects[0]?.target ?? 'one';

/** The v1 `effect` map of a form, for the automatic turns only: { condition kind: rounds, shield: rounds } or null. */
function hintsOf(form) {
    const hints = {};
    for (const part of form.effects) {
        if (part.op === 'condition' && !(part.kind in hints)) hints[part.kind] = part.rounds;
        else if (part.op === 'shield' && !('shield' in hints)) hints.shield = SHIELD_ROUNDS;
    }
    return Object.keys(hints).length ? hints : null;
}

/** The unit a form calls (a summon or a pet): its frozen inputs and the class's three base forms it fights with. `ix`: the pinned index. */
function unitOf(form, ix) {
    if (!form.unit) return null;
    const { kind, class: template, statShare, poolShare, rounds } = form.unit;
    const picked = ix?.class(template) ?? null;
    const skills = picked ? picked.skills.map(skill => ix.baseForm(skill)).filter(Boolean).map(id => formSkill(ix.form(id), 0)) : [];
    return { kind, class: template, statShare, poolShare, rounds, name: picked?.name ?? template, skills };
}

/** The engine skill of `form` (a resolved form of the pin) at `mastery` (0..5). `ix` lets a form that calls a unit carry the unit's own skills. */
export function formSkill(form, mastery = 0, ix = null) {
    const first = form.effects.find(effect => typeof effect.power === 'number') ?? null;
    return {
        name: form.name,
        formId: form.id,
        skillId: form.skill,
        formMastery: Math.max(0, Math.min(5, Math.round(Number(mastery) || 0))),
        tier: form.tier ?? 0,
        type: form.type,
        stat: form.stat,
        // The v1 fields (the automatic turns and previews): the first powered effect, at mastery 1 for the engine's own factor.
        power: first ? (first.power / 100) * (1 + 0.1 * Math.max(0, Math.min(5, Math.round(Number(mastery) || 0)))) : 0,
        mastery: 1,
        target: targetWord(form),
        // Both pools are paid by the interpreter; the v1 `mp` stays 0 so no v1 path pays the cost again.
        mp: 0,
        costs: { mp: form.cost.mp, sp: form.cost.sp },
        cooldown: form.cost.cooldown,
        cooldownLeft: 0,
        // What the automatic turns read to see whether a condition or a shield is worth casting (v1's AI, unchanged): the form's own
        // conditions and shield. The interpreter never applies this map; it plays `parts`.
        effect: hintsOf(form),
        parts: form.effects.map(clone),
        ...(form.unit ? { unit: unitOf(form, ix) } : {}),
    };
}
