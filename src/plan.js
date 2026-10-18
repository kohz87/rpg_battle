// A plan (0.5): fights in stages, somewhere else each ("at the gate: 2 guard; then at the yard:
// 3 guard; then at the tower: guard captain (boss)"), as the story wrote it.
//
// Each stage is a fight of its own, run by the same engine (combat.js): new foes, a fresh round
// count. The party goes into the next stage as it came out of the last (HP, MP, cooldowns,
// conditions, the items left; nobody healed, the fallen still down), and between stages the
// reader chooses only Go on or Fall back. Nothing is written until the plan ends: then one
// result, the stages' results added together, is applied by the same rules as a single fight's
// (index.js), and one hand-off tells the story what happened where and what never happened.
//
// The plan is plain data kept in the chat's state beside the stage being fought:
//
//   Plan = { id, stakes, origin, stages: [{ place, text, rows }], fresh: [names],
//            at: index of the stage fought or just fought, status: 'fighting' | 'between',
//            done: [{ fightId, place, result }], carry: [Combatant] | null }
//
// Pure.

const STATUSES = ['fighting', 'between'];
const MOMENTS = 6;

/** The id of a plan's stage fight: 'plan-x-1', 'plan-x-2'… (index from 0). */
export function stageId(planId, index) {
    return `${planId}-${index + 1}`;
}

/** A new plan, at its first stage. Stages without rows are left out. */
export function newPlan({ id, stakes = 'normal', stages = [], fresh = [], origin = null }) {
    return {
        id: String(id),
        stakes: stakes === 'death' ? 'death' : 'normal',
        origin: origin ?? null,
        stages: (stages ?? []).filter(stage => stage?.rows?.length).map(stage => ({ place: stage.place ?? null, text: String(stage.text ?? ''), rows: stage.rows.map(row => ({ ...row })) })),
        fresh: [...(fresh ?? [])],
        at: 0,
        status: 'fighting',
        done: [],
        carry: null,
    };
}

/** A stored plan as far as it can be trusted (chat metadata): null when it is not one. */
export function cleanPlan(value) {
    if (!value || typeof value !== 'object' || !value.id || !Array.isArray(value.stages) || value.stages.length < 2) return null;
    if (!STATUSES.includes(value.status) || !Number.isInteger(value.at) || value.at < 0 || value.at >= value.stages.length) return null;
    return { ...value, done: Array.isArray(value.done) ? value.done : [], carry: Array.isArray(value.carry) ? value.carry : null };
}

/**
 * The party as a stage left it, to go into the next one: every party combatant as it stands
 * (HP, MP, cooldowns, conditions, the items it has left), copied, under the control it began
 * the stage with. No healing; someone down stays down.
 */
export function carryParty(fight) {
    // Who commands whom is the party's, not the stage's: Auto hands a stage to the AI, and the
    // next stage starts with the control each member came in with.
    const control = new Map((fight?.setup?.party ?? []).map(unit => [unit.id, unit.controller]));
    return (fight?.combatants ?? []).filter(unit => unit.side === 'party').map(unit => {
        const copy = structuredClone(unit);
        copy.gone = copy.hp.cur <= 0 ? 'down' : null;
        if (control.has(copy.id)) copy.controller = control.get(copy.id);
        return copy;
    });
}

/**
 * A stage's fight is over (`result`: combat.summarize of it): { plan, ended }. Won with a stage
 * still to come, the plan waits between stages (`carry`: the party as it stands); `ended` is
 * null. Otherwise the plan is over: `ended` is the outcome ('victory' after the last stage,
 * else the stage's 'defeat' or 'fled').
 */
export function stageDone(plan, fight, result) {
    const done = [...plan.done, { fightId: fight?.id ?? stageId(plan.id, plan.at), place: plan.stages[plan.at]?.place ?? null, result }];
    const more = plan.at + 1 < plan.stages.length;
    if (result.outcome === 'victory' && more) return { plan: { ...plan, done, status: 'between', carry: carryParty(fight) }, ended: null };
    return { plan: { ...plan, done, carry: null }, ended: result.outcome };
}

/** Go on: the next stage, to be fought with the party carried over. Throws when there is none. */
export function nextStage(plan) {
    if (plan?.status !== 'between' || plan.at + 1 >= plan.stages.length) throw new Error('There is no next stage to go on to.');
    return { ...plan, at: plan.at + 1, status: 'fighting' };
}

function addTo(table, key, name, by) {
    table[key] ??= {};
    table[key][name] = (table[key][name] ?? 0) + by;
}

/**
 * The plan's one result, once it ends (`outcome`: 'victory' | 'defeat' | 'fled', or 'withdrew'
 * for Fall back between stages): the stages' results added together, shaped as a fight's
 * Result so the sheets, the inventory and the result screen take it as they take one fight's.
 * Every stage fought counts: XP for the foes beaten in each (also in the stage lost or fled, as
 * after a single fight), the loot of each stage won, skill and item uses; HP, MP and conditions
 * as the last stage fought left them. Plus `stages` (one per stage of the plan: { number,
 * place, outcome: 'victory' | 'defeat' | 'fled' | null (not reached), rounds }), `notReached`
 * (the places of the stages never fought) and `withdrew`.
 */
export function planResult(plan, outcome) {
    const done = plan.done ?? [];
    const results = done.map(entry => entry.result);
    const last = results.at(-1) ?? {};
    const xp = {};
    const uses = {};
    const itemsUsed = {};
    const loot = { items: [], money: 0 };
    for (const result of results) {
        for (const [id, value] of Object.entries(result.xp ?? {})) xp[id] = (xp[id] ?? 0) + (Number(value) || 0);
        for (const [id, list] of Object.entries(result.uses ?? {})) for (const [name, n] of Object.entries(list)) addTo(uses, id, name, n);
        for (const [id, list] of Object.entries(result.itemsUsed ?? {})) for (const [name, n] of Object.entries(list)) addTo(itemsUsed, id, name, n);
        loot.money += Number(result.loot?.money) || 0;
        for (const item of result.loot?.items ?? []) {
            const same = loot.items.find(entry => entry.name === item.name && entry.rarity === item.rarity);
            if (same) same.qty += item.qty;
            else loot.items.push({ ...item });
        }
    }
    // A few moments from each stage, so the last stage does not crowd out the first.
    const per = Math.max(1, Math.floor(MOMENTS / Math.max(1, results.length)));
    const keyMoments = results.flatMap(result => (result.keyMoments ?? []).slice(0, per)).slice(0, MOMENTS);
    const rounds = results.reduce((sum, result) => sum + (Number(result.rounds) || 0), 0);
    const seconds = results.reduce((sum, result) => sum + (Number(result.seconds) || 0), 0);
    const stages = plan.stages.map((stage, index) => ({
        number: index + 1,
        place: stage.place ?? null,
        outcome: results[index]?.outcome ?? null,
        rounds: results[index] ? Number(results[index].rounds) || 0 : 0,
    }));
    return {
        outcome,
        rounds,
        seconds,
        stakes: plan.stakes,
        party: structuredClone(last.party ?? []),
        enemies: results.flatMap(result => result.enemies ?? []),
        defeated: results.flatMap(result => result.defeated ?? []),
        fled: results.flatMap(result => result.fled ?? []),
        parleyed: results.flatMap(result => result.parleyed ?? []),
        xp,
        loot,
        keyMoments,
        uses,
        itemsUsed,
        plan: true,
        stages,
        notReached: stages.filter(stage => stage.outcome === null).map(stage => stage.place),
        withdrew: outcome === 'withdrew',
    };
}
