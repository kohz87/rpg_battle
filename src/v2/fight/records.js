// RPG Battle v2, the closed records of a fight on a pinned ruleset (B4: "replace shorthand EngineAction/condition types with closed,
// versioned records"). Everything a sealed result or a guard hashes is one of these, so the bytes do not depend on how the engine
// keeps its state. Pure.
//
//   ActionRecord     { id: ca_xxxxxxxx, type, form?, skill?, item?, target?, selections?: [{ effect, targets }], stock? }
//                    what the player chose, once; an automatic turn is not an action record (it follows its action from that action's draws)
//   ConditionRecord  { kind, stacks, rounds, strength, at, source }
//                    a condition at a boundary of the fight: its kind (the party's word), the rounds left (actor turns in the fight, ten
//                    story minutes each after it, party/pools.js), the strength it was applied with (a damage-over-time tick, a regeneration tick,
//                    the shield that is left) and where it came from; `at` is the minute the fight ended (null until a clock says)
//   ActionResult     { id, actor, form, cost: { mp, sp }, drawEnd, lines } the action as it resolved: what it paid, where its draws ended (the
//                    state of its own random stream) and what the log said of it

import { CONDITION_KINDS } from '../../combat.js';
import { hashJson } from '../rules/hash.js';
import { isObject } from '../rules/ids.js';

export const RECORD_VERSION = 1;
const ACTION_ID = /^ca_[0-9a-z]{8}$/;
export const isActionId = value => typeof value === 'string' && ACTION_ID.test(value);

const ACTION_TYPES = ['attack', 'skill', 'item', 'defend', 'flee', 'parley', 'auto', 'form'];
const KEYS = ['id', 'type', 'form', 'skill', 'item', 'target', 'actor', 'selections', 'stock'];

/** The problems of a stored action as a pinned fight keeps it: [] or sentences. `stock` is the inventory cut the combat part records. */
export function actionProblems(action) {
    if (!isObject(action)) return ['An action is a record.'];
    const errors = Object.keys(action).filter(key => !KEYS.includes(key)).map(key => `An action has no "${key}".`);
    if (!ACTION_TYPES.includes(action.type)) errors.push(`An action is one of ${ACTION_TYPES.join(', ')}.`);
    if (!isActionId(action.id)) errors.push('A pinned fight\'s action carries its id like ca_k3f9a2qz.');
    if (action.type === 'form' && (typeof action.form !== 'string' || !action.form)) errors.push('A form action names the form by its id.');
    if (action.selections !== undefined) {
        if (!Array.isArray(action.selections) || action.selections.length > 4) errors.push('Selections are a list of at most four.');
        else for (const sel of action.selections) {
            if (!isObject(sel) || Object.keys(sel).sort().join() !== 'effect,targets' || !Number.isInteger(sel.effect) || sel.effect < 0 || sel.effect > 3 || !Array.isArray(sel.targets) || sel.targets.length > 12 || sel.targets.some(id => typeof id !== 'string')) {
                errors.push('A selection is { effect: 0-3, targets: [ids] }.');
            }
        }
    }
    return errors;
}

/** The hash of an action as the guards bind it. */
export const actionHash = action => hashJson(action);

/** A condition of the engine as the closed record: `at` the ending minute (null without one). */
export function conditionRecord(cond, { at = null, source = null } = {}) {
    const kind = cond.name === 'stat-shift' ? `${cond.stat}${cond.amount > 0 ? '+' : '-'}` : CONDITION_KINDS[cond.name] ?? cond.name;
    return {
        kind,
        stacks: Math.max(1, Math.round(Number(cond.rounds) || 1)),
        rounds: Math.max(0, Math.round(Number(cond.rounds) || 0)),
        strength: Math.max(0, Math.round(Number(cond.power) || 0)),
        at: Number.isInteger(at) ? at : null,
        source: source ?? null,
    };
}

/** The problems of a condition record: [] or sentences. */
export function conditionProblems(record) {
    if (!isObject(record) || Object.keys(record).sort().join() !== 'at,kind,rounds,source,stacks,strength') return ['A condition record is { kind, stacks, rounds, strength, at, source }.'];
    const errors = [];
    if (typeof record.kind !== 'string' || !record.kind) errors.push('A condition has a kind.');
    for (const key of ['stacks', 'rounds', 'strength']) if (!Number.isInteger(record[key]) || record[key] < 0) errors.push(`A condition's ${key} is a whole number.`);
    if (!(record.at === null || Number.isInteger(record.at))) errors.push('A condition\'s ending minute is a minute or null.');
    return errors;
}

/** Copies a form action's `selections` from `action` into `out` if they are the closed shape; false when they are not. */
export function cleanFormFields(action, out) {
    const list = action.selections;
    if (!Array.isArray(list) || list.length > 4) return false;
    const clean = [];
    for (const sel of list) {
        if (!isObject(sel) || Object.keys(sel).sort().join() !== 'effect,targets' || !Number.isInteger(sel.effect) || sel.effect < 0 || sel.effect > 3) return false;
        if (!Array.isArray(sel.targets) || sel.targets.length > 12 || sel.targets.some(id => typeof id !== 'string' || !id || id.length > 80)) return false;
        clean.push({ effect: sel.effect, targets: [...sel.targets] });
    }
    out.selections = clean;
    return true;
}
