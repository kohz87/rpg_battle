// RPG Battle v2, generative offers: the numbers a settled offer is held to (GENERATIVE_OFFERS_SPEC §4.5, §4.7, §5.1). Pure, and small on purpose: the
// reading of a line (offer-match.js) and the replay guard (offer-plan.js) both use these, and the guard imports nothing that reads words or money.

/** The deadline of a job whose template and line give none, the longest one a line may ask for, and the shortest. */
export const DEFAULT_MINUTES = 10080;
export const LONGEST_MINUTES = 43200;
export const SHORTEST_MINUTES = 60;

/** The kind of a template: the kind of its first objective ('story' | 'kill' | 'collect' | 'visit'). */
export const kindOf = template => template?.objectives?.[0]?.kind ?? null;

/** A reward formula (opening.js): the low end at tier 0, the high end at tier 9. */
export const formulaAt = (min, max, tier) => min + Math.floor((max - min) * tier / 9);

/**
 * The tier the fight a job tells is written at, by the job's difficulty word: easy `weak`, hard `strong`; normal (and a difficulty that names a rank, or none)
 * writes none and the fight reads as the pack's foe. Nightmare reads as hard: a job is a fight the party is meant to win.
 */
export const FIGHT_TIER = Object.freeze({ easy: 'weak', hard: 'strong', nightmare: 'strong' });

/** The tier a ladder row stands for when the place gives none: `max(0, ceil(levels[0] / 10) - 1)`, F 0, E 1, D 2, C 2. */
export const tierOfRank = row => Math.max(0, Math.ceil((row?.levels?.[0] ?? 1) / 10) - 1);

/** The largest `count` of an objective kind among the pin's closed quests: the implicit upper bound (§4.5). */
function closedMax(all, kind) {
    return all.filter(quest => quest.open !== true).flatMap(quest => quest.objectives ?? []).filter(o => o.kind === kind && Number.isSafeInteger(o.count))
        .reduce((most, o) => Math.max(most, o.count), 0);
}

/**
 * `{ min, max, own }` a template's objective may count (§4.5): its `countMin` and `countMax` when the pack gives them, else 1 and the largest count
 * of that kind among the pin's closed quests, never below the template's own count. `all`: every template of the pin.
 */
export function boundsOf(all, template) {
    const objective = template.objectives[0];
    const own = Number.isSafeInteger(objective.count) ? objective.count : 1;
    const min = Number.isSafeInteger(objective.countMin) ? objective.countMin : 1;
    const max = Number.isSafeInteger(objective.countMax) ? objective.countMax : Math.max(own, closedMax(all, objective.kind));
    return { min, max, own };
}

/** The deadline range of a template: from an hour (or its own duration when that is shorter) to its own duration, else to 30 days. */
export const durationRange = template => {
    const longest = Number.isSafeInteger(template?.durationMinutes) ? template.durationMinutes : LONGEST_MINUTES;
    return [Math.min(SHORTEST_MINUTES, longest), longest];
};
