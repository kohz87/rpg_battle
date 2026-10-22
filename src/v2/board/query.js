// combat.board: the `combat.session` view (src/v2/combat/view.js) with what the battle board shows
// beside it and the session view leaves out: each skill's cost, pool and cooldown, the turns a
// condition has left, which foes will talk, where the turn stands in the order, and, once the fight
// is over, the result Finish will apply (outcome, XP per member, loot as v1 rolls it), and the chat's
// level and XP words (`terms`, from party.terms) for the tags and the result. Pure: the fight
// is rebuilt from the State with v1's replay, like every other view of it.

import { summarize } from '../../combat.js';
import { costPool } from '../../rules.js';
import { rebuild, sessionView } from '../combat/view.js';
import { sessionOf } from '../combat/stored.js';

// The condition words the session view uses (view.js LABELS), so both views read the same.
export const CONDITION_LABELS = Object.freeze({ poison: 'poisoned', burn: 'burning', bleed: 'bleeding', stun: 'stunned', daze: 'dazed', slow: 'slowed', weaken: 'weakened', shield: 'shielded', regen: 'regenerating', guard: 'on guard' });
const LABELS = CONDITION_LABELS;

/** The money's name for the result, from Story Block's one currency (MODULES §F1); '' when unknown. */
function currencyName(tools) {
    try {
        const currency = tools?.query?.('inventory.currency');
        return typeof currency?.name === 'string' ? currency.name : '';
    } catch {
        return '';
    }
}

/** The chat's level and XP words (party.terms, MODULES §F25), or null without the party part. */
function termsOf(tools) {
    try {
        const terms = tools?.query?.('party.terms');
        return terms && typeof terms === 'object' ? terms : null;
    } catch {
        return null;
    }
}

/** What the fight's end will settle, as plain data for the result panel. */
export function resultOf(fight, rules, currency = '') {
    const result = summarize(fight, rules);
    const names = new Map(result.party.map(member => [member.memberId, member.name]));
    return {
        outcome: result.outcome,
        rounds: result.rounds,
        xp: Object.entries(result.xp ?? {}).map(([member, amount]) => ({ member, name: names.get(member) ?? member, amount: Math.max(0, Math.round(Number(amount) || 0)) })),
        loot: {
            money: Math.max(0, Math.round(Number(result.loot.money) || 0)),
            items: result.loot.items.map(item => ({ name: item.name, qty: item.qty, rarity: item.rarity ?? 'common' })),
        },
        currency,
        defeated: [...result.defeated],
        fled: [...result.fled],
        parleyed: [...result.parleyed],
    };
}

/** combat.board(state, args, tools) → the session view and the board's extras; null without a fight. */
export function boardView(state, args, tools) {
    const session = sessionOf(state?.domains?.combat);
    if (!session) return null;
    const base = sessionView(session);
    const { fight, rules } = rebuild(session);
    const full = new Map(fight.combatants.map(c => [c.id, c]));
    const actor = full.get(base.actions.actor) ?? null;
    const skillOf = name => actor?.skills?.find(skill => skill.name === name) ?? null;
    return {
        ...base,
        turns: fight.turns === 'timeline' ? 'timeline' : 'rounds',
        turnIndex: base.status === 'active' && Number.isInteger(fight.turn) ? fight.turn : null,
        combatants: base.combatants.map(c => {
            const own = full.get(c.id);
            return {
                ...c,
                conditions: (own?.conditions ?? []).map(cond => ({ name: cond.name, label: LABELS[cond.name] ?? cond.name, turns: Number.isFinite(cond.rounds) ? cond.rounds : null })),
                ...(c.side === 'enemy' ? { talks: Boolean(own?.talks) } : {}),
            };
        }),
        actions: {
            ...base.actions,
            skills: base.actions.skills.map(skill => {
                const own = skillOf(skill.name);
                if (!own) return skill;
                // A physical skill costs stamina when the actor has it, else MP (v1 combat.js costOf).
                const pool = costPool(own) === 'sp' && actor?.sp ? 'sp' : 'mp';
                return {
                    ...skill,
                    type: own.type ?? '',
                    cost: Math.max(0, Math.round(Number(own.mp) || 0)),
                    pool,
                    cooldown: Math.max(0, Math.round(Number(own.cooldown) || 0)),
                    cooldownLeft: Math.max(0, Math.round(Number(own.cooldownLeft) || 0)),
                    ...(Number.isFinite(own.mastery) ? { mastery: own.mastery } : {}),
                };
            }),
        },
        result: base.status === 'active' ? null : resultOf(fight, rules, currencyName(tools)),
        terms: termsOf(tools),
    };
}
