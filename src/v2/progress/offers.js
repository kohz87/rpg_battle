// RPG Battle v2, the promotions and paths a character is offered, and whether a choice is allowed (contract §3
// ProgressView, §5, B3 "Under P02/P04/P19"). The rules, all read from the pinned ruleset:
//
//   * The milestones are taken **in order**: promotion 10, 20, 30, then path 40, 50 … 90. Only the oldest one not
//     taken is offered; every later one waits. Nothing is ever chosen for the player: a waiting milestone stays
//     waiting however long, and XP goes on meanwhile.
//   * A **promotion** needs the level, all three current skills at 5/5, and a class that is a direct child, one tier
//     up, of the current class. It swaps all three skills at once.
//   * A **path step** needs the level, an advanced class, and the chosen skill at 5/5 on its current form with fewer
//     than two steps taken. The option is one of that form's three children, ordered [g, a, b] (the
//     selected-parent rule: the step-2 options belong to the step-1 form the skill actually holds). A new form
//     starts at 0/5, and the other two skills are left alone.
//
// `standing` is one actor read once; `evaluateClass` and `evaluatePath` answer a request (the command, and the
// replay guard that asks again on the state before a stored choice) with a closed list of **facts**: the
// parts of the situation the choice depended on, as booleans and identities, not the raw level or uses, so a
// level or a use that moved without taking the prerequisite away does not undo the choice. Pure.

import { choicesOf, deriveActor, skillViews } from './derive.js';
import { maxMastery } from './mastery.js';

/** An actor read once: { derived, skills (SkillViews), milestones (all, in order), open (oldest not taken) }. */
export function standing(ix, progress, actor) {
    const derived = deriveActor(ix, choicesOf(progress, actor));
    const milestones = [...ix.constants.promotionMilestones, ...ix.constants.pathMilestones];
    return { actor, derived, skills: skillViews(ix, derived, progress, actor), milestones, open: milestones.find(m => !derived.taken.has(m)) ?? null };
}

const top = ix => maxMastery(ix.constants.masteryAt);

/**
 * The mastery each skill needs for a promotion milestone: the pack's own `promotionMastery` (one number a promotion level, 1 to the top; Story Block 2.5.0,
 * carried in the pin's constants) or the top, as every pin before it. A path step always wants the top.
 */
export function masteryNeeded(ix, milestone) {
    const at = ix.constants.promotionMilestones.indexOf(milestone);
    const asked = at >= 0 ? ix.constants.promotionMastery?.[at] : undefined;
    return Number.isInteger(asked) && asked >= 1 && asked <= top(ix) ? asked : top(ix);
}
const kindOf = (ix, milestone) => (ix.constants.promotionMilestones.includes(milestone) ? 'promotion' : 'path');
const nameOf = (ix, ref) => ix.class(ref)?.name ?? ref;
const cut = text => (text.length > 240 ? `${text.slice(0, 239)}…` : text);

function unmastered(ix, st, which = st.skills, need = top(ix)) {
    return which.filter(view => view.mastery < need).map(view => cut(`${view.name} is ${view.mastery}/${top(ix)}.`));
}

// The ProgressView entry of a promotion milestone the character has reached and not taken.
function promotionEntry(ix, st, milestone) {
    const why = [];
    let choices = [];
    if (milestone !== st.open) {
        why.push(`The ${st.open} ${kindOf(ix, st.open)} comes first.`);
    } else {
        choices = st.derived.class === null ? [] : ix.childrenOf(st.derived.class).map(child => child.id);
        if (!choices.length) why.push(cut(`No class follows ${nameOf(ix, st.derived.class)}.`));
        why.push(...unmastered(ix, st, st.skills, masteryNeeded(ix, milestone)));
    }
    return { milestone, eligible: milestone === st.open && why.length === 0, choices, why };
}

// The ProgressView entry of a path milestone.
function pathEntry(ix, st, milestone) {
    if (milestone !== st.open) return { milestone, eligible: false, skills: [], why: [`The ${st.open} ${kindOf(ix, st.open)} comes first.`] };
    if (st.derived.tier !== ix.maxTier) return { milestone, eligible: false, skills: [], why: [cut(`${nameOf(ix, st.derived.class)} is not an advanced class.`)] };
    const skills = st.skills.filter(view => view.steps < ix.progression.pathwaySteps && ix.optionsOf(view.form).length)
        .map(view => ({ skill: view.skill, fromForm: view.form, step: view.steps + 1, options: ix.optionsOf(view.form) }));
    const ready = st.skills.filter(view => skills.some(item => item.skill === view.skill) && view.mastery >= top(ix));
    const why = [];
    if (!skills.length) why.push('Every skill has taken its steps.');
    else if (!ready.length) why.push(...unmastered(ix, st, st.skills.filter(view => skills.some(item => item.skill === view.skill))));
    return { milestone, eligible: why.length === 0, skills, why };
}

/**
 * The contract's ProgressView for an actor at `level` (§3), or null when it has no basic class yet:
 * { actor, level, class, tier, checklist, promotions, pathways }. Only the milestones the level has reached
 * and the actor has not taken are listed, the oldest first, promotions then paths; only the oldest can be eligible.
 */
export function progressView(ix, progress, actor, level) {
    const st = standing(ix, progress, actor);
    if (st.derived.class === null) return null;
    const reached = m => !st.derived.taken.has(m) && level >= m;
    return {
        actor, level, class: st.derived.class, tier: st.derived.tier,
        checklist: st.skills.map(view => ({ skill: view.skill, form: view.form, mastery: view.mastery, needed: st.open !== null && kindOf(ix, st.open) === 'promotion' ? masteryNeeded(ix, st.open) : top(ix) })),
        promotions: ix.constants.promotionMilestones.filter(reached).map(m => promotionEntry(ix, st, m)),
        pathways: ix.constants.pathMilestones.filter(reached).map(m => pathEntry(ix, st, m)),
    };
}

const refuse = (code, why) => ({ ok: false, code, why });

/**
 * Whether `request` { milestone, class, expectedClass } may be made now by an actor at `level`:
 * { ok: true, facts, skills } or { ok: false, code: 'NOT_FOUND' | 'STALE' | 'REFUSED', why }. `facts` is the
 * closed projection the replay guard hashes; `skills` the three skills the class gives.
 */
export function evaluateClass(ix, st, request, level) {
    const { milestone } = request;
    if (st.derived.class === null) return refuse('NOT_FOUND', 'That character has not chosen a basic class.');
    if (!ix.constants.promotionMilestones.includes(milestone)) return refuse('INVALID', `${milestone} is not a promotion level.`);
    if (request.expectedClass !== st.derived.class) return refuse('STALE', cut(`The character is a ${nameOf(ix, st.derived.class)} now, not a ${nameOf(ix, request.expectedClass)}.`));
    if (st.derived.taken.has(milestone)) return refuse('REFUSED', `The ${milestone} promotion was already taken.`);
    if (milestone !== st.open) return refuse('REFUSED', `The ${st.open} ${kindOf(ix, st.open)} comes first.`);
    if (level < milestone) return refuse('REFUSED', `Level ${milestone} is needed (this character is level ${level}).`);
    const choices = ix.childrenOf(st.derived.class);
    const picked = choices.find(child => child.id === request.class);
    if (!picked) return refuse('REFUSED', cut(`${request.class} does not follow ${nameOf(ix, st.derived.class)}.`));
    const need = masteryNeeded(ix, milestone);
    const slow = unmastered(ix, st, st.skills, need);
    if (slow.length) return refuse('REFUSED', cut(`Every skill must be ${need}/${top(ix)}: ${slow.join(' ')}`));
    return {
        ok: true,
        skills: [...picked.skills],
        facts: {
            previous: st.derived.class, tier: st.derived.tier, levelReached: true, first: true,
            held: st.skills.map(view => [view.skill, view.form]), mastered: true,
        },
    };
}

/**
 * The same for a path step: `request` { milestone, skill, fromForm, option } → { ok: true, facts, step } or a
 * refusal. STALE when the skill does not hold `fromForm` now (its parent form is not the current one).
 */
export function evaluatePath(ix, st, request, level) {
    const { milestone, skill, fromForm, option } = request;
    if (st.derived.class === null) return refuse('NOT_FOUND', 'That character has not chosen a basic class.');
    if (!ix.constants.pathMilestones.includes(milestone)) return refuse('INVALID', `${milestone} is not a path level.`);
    if (st.derived.taken.has(milestone)) return refuse('REFUSED', `The ${milestone} step was already taken.`);
    if (milestone !== st.open) return refuse('REFUSED', `The ${st.open} ${kindOf(ix, st.open)} comes first.`);
    if (level < milestone) return refuse('REFUSED', `Level ${milestone} is needed (this character is level ${level}).`);
    if (st.derived.tier !== ix.maxTier) return refuse('REFUSED', cut(`${nameOf(ix, st.derived.class)} is not an advanced class.`));
    const view = st.skills.find(item => item.skill === skill);
    if (!view) return refuse('REFUSED', 'That is not one of the character\'s skills.');
    if (view.form !== fromForm) return refuse('STALE', cut(`${view.name} is not the form ${fromForm} now.`));
    if (view.steps >= ix.progression.pathwaySteps) return refuse('REFUSED', `${view.name} has taken all its steps.`);
    const options = ix.optionsOf(view.form);
    if (!options.includes(option)) return refuse('REFUSED', `${option} is not a step from ${view.form}.`);
    if (view.mastery < top(ix)) return refuse('REFUSED', cut(`${view.name} is ${view.mastery}/${top(ix)}.`));
    return {
        ok: true,
        step: view.steps + 1,
        facts: { tier: st.derived.tier, levelReached: true, first: true, skill, fromForm, steps: view.steps, mastered: true },
    };
}
