// RPG Battle v2, what an actor's choices make it (contract §4, §5, B3). The record of a character's
// progression is its **choices**: the basic class picked at creation (milestone 0), then one choice for each
// milestone it consumed (a promotion at 10/20/30, a path step at 40…90). Its class, its three skills and the
// form of each skill are *derived* from them, so there is exactly one place where they change and a class
// change cannot leave a skill behind:
//
//   progress.choices[`<actor>|<milestone>`] =
//     { actor, milestone, kind: 'class', previous: Ref | null, selected: Ref, skills: [Ref, Ref, Ref], rulesHash }
//   | { actor, milestone, kind: 'path', skill: Ref, fromForm: Ref, option: Ref, step: 1 | 2, rulesHash }
//
// A class choice swaps all three skills at once to the new class's own three, each at its base form and at
// 0/5 (nothing is inherited; earlier forms keep their uses for the record and the caps). A path choice moves
// one skill from its current form to one of that form's three options (the selected-parent rule): a choice
// whose parent form is not the skill's current form does not apply. Pure.

import { masteryOf, nextAt } from './mastery.js';
import { rowsOf, tallyOfProgress, usesOf } from './credit.js';
import { isObject } from '../rules/ids.js';

/** The key a choice is kept under. */
export const choiceKey = (actor, milestone) => `${actor}|${milestone}`;

/** An actor's choices, lowest milestone first. */
export function choicesOf(progress, actor) {
    const all = isObject(progress?.choices) ? progress.choices : {};
    return Object.values(all).filter(choice => isObject(choice) && choice.actor === actor).sort((a, b) => a.milestone - b.milestone);
}

/**
 * What an actor's choices make it: { class (Ref | null: no basic class yet), tier, classPath: Ref[], skills:
 * [{ skill, form, steps }], taken: Set of milestones, broken: milestones whose parent form was not current }.
 */
export function deriveActor(ix, choices) {
    const out = { class: null, tier: null, classPath: [], skills: [], taken: new Set(), broken: [] };
    for (const choice of choices) {
        if (choice.kind === 'class') {
            out.class = choice.selected;
            out.tier = ix.class(choice.selected)?.tier ?? null;
            out.classPath.push(choice.selected);
            out.skills = choice.skills.map(skill => ({ skill, form: ix.baseForm(skill), steps: 0 }));
            out.taken.add(choice.milestone);
        } else if (choice.kind === 'path') {
            const entry = out.skills.find(item => item.skill === choice.skill);
            if (!entry || entry.form !== choice.fromForm) {
                out.broken.push(choice.milestone);
                continue;
            }
            entry.form = choice.option;
            entry.steps = ix.form(choice.option)?.step ?? entry.steps + 1;
            out.taken.add(choice.milestone);
        }
    }
    return out;
}

/** The three skills of an actor as the contract's SkillView (§3) reads them, from its derived choices and the credited uses. */
export function skillViews(ix, derived, progress, actor) {
    const tally = tallyOfProgress(progress);
    const { masteryAt } = ix.constants;
    // Every form of the skill the actor has uses in (its history), plus the form it holds now.
    const history = new Map();
    for (const { attempt, credit } of rowsOf(progress)) {
        if (attempt.actor !== actor || credit.award < 1) continue;
        if (!history.has(attempt.skill)) history.set(attempt.skill, new Set());
        history.get(attempt.skill).add(attempt.form);
    }
    // The forms whose uses were folded away (fold.js) are history too.
    for (const key of Object.keys(progress?.sealed?.forms ?? {})) {
        const [who, form] = key.split('|');
        const skill = ix.form(form)?.skill;
        if (who !== actor || !skill) continue;
        if (!history.has(skill)) history.set(skill, new Set());
        history.get(skill).add(form);
    }
    return derived.skills.map(({ skill, form, steps }) => {
        const uses = usesOf(tally, actor, form);
        const forms = new Set([form, ...(history.get(skill) ?? [])]);
        return {
            skill, form, name: ix.form(form)?.name ?? ix.skill(skill)?.name ?? skill, mastery: masteryOf(uses, masteryAt), uses, nextAt: nextAt(uses, masteryAt), steps,
            formMastery: Object.fromEntries([...forms].sort().map(ref => {
                const n = usesOf(tally, actor, ref);
                return [ref, { uses: n, mastery: masteryOf(n, masteryAt) }];
            })),
        };
    });
}
