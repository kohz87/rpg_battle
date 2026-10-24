// RPG Battle v2, the pinned ruleset's class and form graph (contract §5, §7 "Branch graph"): classes and their
// direct children, the three skills of a class, a skill's base form and the options of a form. Everything is
// read from the pin (pin.js), built once per call into an index, never from an installed pack. Pure.

import { pinOf } from './pin.js';

/** The index of a pin: { constants, progression, rulesHash, maxTier, class(ref), skill(ref), form(ref), … }, or null without a pin. */
export function indexOf(pin) {
    if (!pin?.resolved) return null;
    const { resolved, progression } = pin;
    const classes = new Map(resolved.manifest.classes.map(entry => [entry.id, entry]));
    const skills = new Map(resolved.manifest.skills.map(entry => [entry.id, entry]));
    const forms = resolved.forms;
    const bases = new Map();
    const options = new Map();
    for (const form of Object.values(forms)) {
        if (form.step === 0 && form.fromForm === null) bases.set(form.skill, form.id);
        if (form.fromForm !== null) {
            if (!options.has(form.fromForm)) options.set(form.fromForm, []);
            options.get(form.fromForm).push(form.id);
        }
    }
    const children = new Map();
    for (const entry of resolved.manifest.classes) {
        if (entry.parent === null) continue;
        if (!children.has(entry.parent)) children.set(entry.parent, []);
        children.get(entry.parent).push(entry);
    }
    const maxTier = Math.max(...progression.tiers);
    // "Path option arrays are ordered [g,a,b]" (contract §3): the generated form first, then the written a and b.
    const order = { [progression.generatedChoice]: 0, [progression.writtenChoices[0]]: 1, [progression.writtenChoices[1]]: 2 };
    const suffix = (parent, id) => (id.startsWith(`${parent}-`) ? id.slice(parent.length + 1) : '');
    return Object.freeze({
        constants: resolved.constants,
        progression,
        rulesHash: pin.rulesHash ?? null,
        maxTier,
        classes,
        class: ref => classes.get(ref) ?? null,
        skill: ref => skills.get(ref) ?? null,
        form: ref => forms[ref] ?? null,
        /** The base form of a skill (step 0, no parent), or null. */
        baseForm: skill => bases.get(skill) ?? null,
        /** The classes directly under `ref`, one tier up, in the pack's order. */
        childrenOf: ref => (children.get(ref) ?? []).filter(child => child.tier === (classes.get(ref)?.tier ?? -2) + 1),
        /** The forms a form can become, ordered [g, a, b]; only a form with all three has an option list. */
        optionsOf(ref) {
            const found = (options.get(ref) ?? []).filter(id => Object.hasOwn(order, suffix(ref, id)));
            found.sort((a, b) => order[suffix(ref, a)] - order[suffix(ref, b)]);
            return found.length === 3 ? found : [];
        },
        /** The tier a promotion at `milestone` reaches (10 → 1), or null when it is not a promotion milestone. */
        tierOfPromotion(milestone) {
            const at = resolved.constants.promotionMilestones.indexOf(milestone);
            return at < 0 ? null : at + 1;
        },
    });
}

/** The index of the pinned ruleset in a state, or null (a legacy chat or nothing pinned). */
export const indexOfState = state => indexOf(pinOf(state));
