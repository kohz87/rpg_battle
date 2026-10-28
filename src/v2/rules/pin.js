// RPG Battle v2, the pinned ruleset (contract §4 RulesIdentity, §7 ResolvedRules, §5 "frozen definitions travel
// with the timeline"). One resolved ruleset is kept in the `rules` domain for the whole character timeline:
// every number the progression reads (the level curve, the mastery steps, the caps, the milestones) and every
// class, skill and form comes from it, never from a pack installed now. Replacing a pack, even at the same
// version, cannot move a running timeline.
//
//   rules = {
//     schema: 2, rulesVersion: 2,        // the marker Story Block's sdk.preflight reads (rulesVersion, rulesHash)
//     rulesHash: Hash | null,            // the pinned ruleset's hash (the contract's H); null until one is pinned
//     pin: null | {
//       identity: { packKey, packVersion, packHash, schema: 2, engine: 'rb-rules-2', constantsHash },
//       progression: { tiers, tierLevels, skillsPerClass, maxMastery, pathwaySteps, writtenChoices, generatedChoice },
//       resolved: { constants, manifest, forms, … },   // what Story Block's expandRulesV2 returns, immutable
//       defs: { [Ref]: ItemDef },          // the pack's complete item definitions, frozen with the rules (B3); {} when not given
//     },
//     flags: { [key]: { value, evidence, write } },   // the declared flags that were set by an authorized event (flags.js)
//     generated: { [Ref]: GeneratedItem },            // the def + rule + provenance of every generated item (items.js)
//   }
//
// This file cannot import Story Block's checker (an extension has no import path to another extension in the
// browser, and CI has only this repository), so whoever pins a ruleset (activation, a later package) passes
// what the checker gave: `resolved` and `rulesHash` from expandRulesV2 or validateRulesPack, and
// `progression` = RULES_V2_PROGRESSION. The validator below only holds the stored data to the shape this code
// reads; it does not repeat the checker. Pure.

import { offersProblems } from './offers.js';
import { int, isDefId, isHash, isObject, isRecordId } from './ids.js';
import { MAX_ITEM_RULES, boundProblems, defShapeProblems, ruleProblems } from './bounds.js';

export const RULES_VERSION = 2;
export const ENGINE = 'rb-rules-2';
/** The rules domain's schema number. */
export const RULES_SCHEMA = 2;

const ascending = (list, min = 1) => Array.isArray(list) && list.length > 0 && list.every((n, i) => int(n, min) && (i === 0 || n > list[i - 1]));

/** The rules slice of a fresh timeline: marked as rules v2, nothing pinned yet. */
export const initialRules = () => ({ schema: RULES_SCHEMA, rulesVersion: RULES_VERSION, rulesHash: null, pin: null, flags: {}, generated: {} });

/**
 * Whether `xpPerLevel` is a value the rules accept (contract §4 Constants, §5): a whole number from 10 to
 * 10000 that is divisible by ten, so the retained XP adapter's rounding keeps exactly the configured cost.
 * tests/v2/rules/pin.test.js holds this to Story Block's checker.
 */
export const xpPerLevelProblem = value => {
    if (!Number.isSafeInteger(value)) return 'xpPerLevel must be a whole number';
    if (value < 10 || value > 10000) return 'xpPerLevel must be from 10 to 10000';
    if (value % 10 !== 0) return 'xpPerLevel must be divisible by 10';
    return '';
};

function constantsProblems(constants, errors) {
    if (!isObject(constants)) return errors.push('rules: the pinned constants are missing');
    for (const key of ['levelCap', 'startLevel', 'startStat', 'startPoints', 'pointsPerLevel', 'statCap', 'usePerSkillReply', 'usePerSkillDay', 'usePerActorReply', 'usePerActorDay', 'trainMinutes', 'trainCredits', 'clockMinutesPerDay']) {
        if (!int(constants[key], key === 'startPoints' ? 0 : 1)) errors.push(`rules: constants.${key} must be a whole number`);
    }
    const xp = xpPerLevelProblem(constants.xpPerLevel);
    if (xp) errors.push(`rules: constants.${xp}`);
    if (!ascending(constants.masteryAt)) errors.push('rules: constants.masteryAt must be rising whole numbers');
    if (!ascending(constants.promotionMilestones)) errors.push('rules: constants.promotionMilestones must be rising whole numbers');
    if (!ascending(constants.pathMilestones)) errors.push('rules: constants.pathMilestones must be rising whole numbers');
    if (int(constants.levelCap, 1) && ascending(constants.promotionMilestones) && ascending(constants.pathMilestones)) {
        const last = constants.pathMilestones.at(-1);
        if (constants.promotionMilestones.at(-1) >= constants.pathMilestones[0]) errors.push('rules: promotions come before paths');
        if (last > constants.levelCap) errors.push('rules: a milestone is above the level cap');
    }
    // A pack's own mastery for each promotion (Story Block 2.5.0); a pin made before it has none and wants the top.
    if (Object.hasOwn(constants, 'promotionMastery')) {
        const list = constants.promotionMastery;
        if (!Array.isArray(list) || list.some(n => !Number.isInteger(n) || n < 1 || n > 5)) errors.push('rules: constants.promotionMastery must be whole numbers from 1 to 5, one for each promotion');
    }
}

function progressionProblems(progression, constants, errors) {
    if (!isObject(progression)) return errors.push('rules: the pinned progression is missing');
    const { tiers, tierLevels, skillsPerClass, maxMastery, pathwaySteps } = progression;
    if (!Array.isArray(tiers) || !tiers.length || !tiers.every((t, i) => int(t, 0) && (i === 0 || t === tiers[i - 1] + 1))) errors.push('rules: progression.tiers must count up from 0');
    if (!isObject(tierLevels)) errors.push('rules: progression.tierLevels is missing');
    if (!int(skillsPerClass, 1, 12)) errors.push('rules: progression.skillsPerClass must be a whole number');
    if (!int(maxMastery, 1)) errors.push('rules: progression.maxMastery must be a whole number');
    else if (Array.isArray(constants?.masteryAt) && constants.masteryAt.length !== maxMastery) errors.push('rules: the mastery steps and progression.maxMastery disagree');
    if (!int(pathwaySteps, 1)) errors.push('rules: progression.pathwaySteps must be a whole number');
    // The promotions and the paths are the milestones of the tiers and of the steps.
    if (Array.isArray(tiers) && Array.isArray(constants?.promotionMilestones) && constants.promotionMilestones.length !== tiers.length - 1) errors.push('rules: one promotion milestone for each tier above the first');
    if (isObject(tierLevels) && Array.isArray(constants?.promotionMilestones)) {
        constants.promotionMilestones.forEach((level, i) => { if (tierLevels[i + 1] !== level) errors.push(`rules: tier ${i + 1} starts at level ${tierLevels[i + 1]}, not at the milestone ${level}`); });
    }
    if (int(pathwaySteps, 1) && int(skillsPerClass, 1) && Array.isArray(constants?.pathMilestones) && constants.pathMilestones.length !== skillsPerClass * pathwaySteps) errors.push('rules: one path milestone for each step of each skill');
}

function manifestProblems(resolved, progression, errors) {
    const { manifest, forms } = resolved;
    if (!isObject(manifest) || !Array.isArray(manifest.classes) || !Array.isArray(manifest.skills)) return errors.push('rules: the pinned manifest has no classes and skills');
    if (!isObject(forms)) return errors.push('rules: the pinned ruleset has no forms');
    const skills = new Set();
    for (const skill of manifest.skills) {
        if (!isObject(skill) || !isDefId(skill.id)) errors.push('rules: a pinned skill has no id');
        else skills.add(skill.id);
    }
    const perClass = progression?.skillsPerClass;
    const ids = new Set();
    for (const entry of manifest.classes) {
        if (!isObject(entry) || !isDefId(entry.id) || ids.has(entry.id)) { errors.push('rules: a pinned class has no id, or the id is used twice'); continue; }
        ids.add(entry.id);
        if (!int(entry.tier, 0)) errors.push(`rules: ${entry.id} has no tier`);
        if (entry.parent !== null && !isDefId(entry.parent)) errors.push(`rules: ${entry.id} has no parent`);
        if (!Array.isArray(entry.skills) || (int(perClass, 1) && entry.skills.length !== perClass) || new Set(entry.skills).size !== entry.skills.length || !entry.skills.every(skill => skills.has(skill))) {
            errors.push(`rules: ${entry.id} must hold exactly ${perClass ?? 'the right number of'} different known skills`);
        }
    }
    for (const entry of manifest.classes) if (isObject(entry) && entry.parent !== null && !ids.has(entry.parent)) errors.push(`rules: ${entry.id} has a parent that is not pinned`);
    for (const [ref, form] of Object.entries(forms)) {
        if (!isObject(form) || form.id !== ref || !skills.has(form.skill) || !int(form.step, 0) || (form.fromForm !== null && !isDefId(form.fromForm))) {
            errors.push(`rules: the pinned form ${ref} is not whole`);
            break;
        }
    }
    for (const skill of skills) {
        if (!Object.values(forms).some(form => form.skill === skill && form.step === 0 && form.fromForm === null)) errors.push(`rules: ${skill} has no base form`);
    }
}


const flagWalk = (value, found, depth = 0) => {
    if (depth > 16 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) flagWalk(item, found, depth + 1); return; }
    if (value.kind === 'flag' && typeof value.key === 'string' && typeof value.value === 'boolean') found.add(value.key);
    for (const item of Object.values(value)) flagWalk(item, found, depth + 1);
};

/**
 * The flags a ruleset declares: every key a `{ kind: 'flag', key, value }` requirement names, in the pinned quests, shops, recipes,
 * foes, trainers and item rules, sorted. (The pack schema has no list of its own; a flag nobody asks for has no use.)
 */
export function declaredFlags(resolved) {
    const found = new Set();
    if (!isObject(resolved)) return [];
    for (const part of [resolved.quests, resolved.shops, resolved.recipes, resolved.foes, resolved.items, resolved.manifest?.trainers]) flagWalk(part, found);
    return [...found].filter(key => key.length >= 1 && key.length <= 80).sort();
}

function inputsProblems(slice, errors) {
    errors.push(...offersProblems(slice));
    const flags = slice.flags;
    if (!isObject(flags)) errors.push('rules: flags is not a record');
    else {
        const declared = new Set(slice.pin ? declaredFlags(slice.pin.resolved) : []);
        for (const [key, entry] of Object.entries(flags)) {
            if (!declared.has(key)) errors.push(`rules: flag "${key.slice(0, 80)}" is not a declared flag`);
            else if (!isObject(entry) || typeof entry.value !== 'boolean' || !isRecordId(entry.evidence) || !isRecordId(entry.write)) errors.push(`rules: flag "${key}" is not { value, evidence, write }`);
        }
    }
    const generated = slice.generated;
    if (!isObject(generated)) return errors.push('rules: generated is not a record');
    if (Object.keys(generated).length && !slice.pin) errors.push('rules: generated items without a pinned ruleset');
    if (Object.keys(generated).length + Object.keys(slice.pin?.resolved?.items ?? {}).length > MAX_ITEM_RULES) errors.push('rules: more item rules than a ruleset holds');
    for (const [ref, entry] of Object.entries(generated)) {
        const area = entry?.area;
        const bad = !isObject(entry) || entry.def?.id !== ref || !isObject(area) || !isRecordId(entry.write) || !isHash(entry.rulesHash) || !isHash(entry.defHash) || !isHash(entry.ruleHash) || typeof entry.template !== 'string' && entry.template !== null
            || defShapeProblems(entry.def).length || ruleProblems(entry.rule, entry.def).length || boundProblems(entry.def, area).length;
        if (bad) errors.push(`rules: the generated item ${String(ref).slice(0, 80)} is not whole`);
    }
    return errors;
}

function defsProblems(pin, errors) {
    if (!isObject(pin.defs)) return errors.push('rules: the pin has no item definitions record');
    const rules = pin.resolved.items ?? {};
    const refs = Object.keys(pin.defs);
    if (refs.length && (refs.length !== Object.keys(rules).length || !refs.every(ref => Object.hasOwn(rules, ref)))) errors.push('rules: the pinned item definitions and item rules are not one for one');
    for (const [ref, def] of Object.entries(pin.defs)) {
        if (!isObject(def) || def.id !== ref || defShapeProblems(def).length) errors.push(`rules: the pinned item ${ref.slice(0, 80)} is not a whole definition`);
        else if (ruleProblems(rules[ref], def).length) errors.push(`rules: the pinned item ${ref.slice(0, 80)} and its rule disagree`);
    }
}

/** Why a stored `rules` slice is not what this code reads: a list of sentences, empty when it is. */
export function rulesProblems(slice) {
    if (!isObject(slice)) return ['rules: the slice is not a record'];
    const errors = [];
    if (slice.schema !== RULES_SCHEMA || slice.rulesVersion !== RULES_VERSION) errors.push('rules: the slice is not rules schema 2');
    if (!(slice.rulesHash === null || isHash(slice.rulesHash))) errors.push('rules: rulesHash must be null or a 64-character hash');
    if (slice.pin === null) {
        if (slice.rulesHash !== null) errors.push('rules: a rulesHash without a pinned ruleset');
        return inputsProblems(slice, errors);
    }
    const pin = slice.pin;
    if (!isObject(pin) || !isObject(pin.identity) || !isObject(pin.resolved)) return [...errors, 'rules: the pin has no identity and ruleset'];
    if (slice.rulesHash === null) errors.push('rules: a pinned ruleset needs its rulesHash');
    const id = pin.identity;
    if (typeof id.packKey !== 'string' || !id.packKey || typeof id.packVersion !== 'string' || !id.packVersion) errors.push('rules: the pin names no pack and version');
    if (!isHash(id.packHash) || !isHash(id.constantsHash)) errors.push('rules: the pin names no pack and constants hash');
    if (id.schema !== 2 || id.engine !== ENGINE) errors.push('rules: the pin is not rules schema 2 / rb-rules-2');
    constantsProblems(pin.resolved.constants, errors);
    progressionProblems(pin.progression, pin.resolved.constants, errors);
    if (!errors.length) manifestProblems(pin.resolved, pin.progression, errors);
    defsProblems(pin, errors);
    return inputsProblems(slice, errors);
}

/**
 * Pins a ruleset onto a `rules` draft, once (the same ruleset again is a no-op; another one is refused: a
 * running timeline never changes its rules). `given`: { resolved, rulesHash, progression, packKey,
 * packVersion, packHash, constantsHash, defs? }. `mode`: 'free' | 'strict', recorded once with the pin. Returns '' or why it was not pinned.
 */
export function pinRules(draft, given, { mode = null } = {}) {
    const pin = {
        identity: { packKey: given.packKey, packVersion: given.packVersion, packHash: given.packHash, schema: 2, engine: ENGINE, constantsHash: given.constantsHash },
        progression: structuredClone(given.progression),
        resolved: structuredClone(given.resolved),
        defs: structuredClone(given.defs ?? {}),
    };
    const trial = { schema: RULES_SCHEMA, rulesVersion: RULES_VERSION, rulesHash: given.rulesHash ?? null, pin, flags: {}, generated: {} };
    const problems = rulesProblems(trial);
    if (problems.length) return problems[0];
    if (draft.pin !== null && draft.pin !== undefined) return draft.rulesHash === trial.rulesHash ? '' : 'This chat already runs other rules; a running timeline keeps its rules.';
    draft.rulesHash = trial.rulesHash;
    draft.pin = pin;
    // The mode of Jobs from the story this chat runs in, from now on (mode.js): the switch of this moment. None recorded reads strict.
    if (mode === 'free' || mode === 'strict') draft.mode = mode;
    return '';
}

/** The pinned ruleset of a state, or null (a legacy chat, or nothing pinned yet). */
export function pinOf(state) {
    const slice = state?.domains?.rules;
    return isObject(slice) && slice.schema === RULES_SCHEMA && isObject(slice.pin) ? { ...slice.pin, rulesHash: slice.rulesHash } : null;
}
