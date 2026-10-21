// The fight as the reader and the model see it: the session rebuilt from its setup and actions
// (v1 replay), turned into plain data for the Fight tab, the narration text for the end of a
// fight, and the compact tail lines. Pure.

import { availableActions, replay } from '../../combat.js';
import { buildHandoff, grouped, HANDOFF_HEADER } from '../../handoff.js';
import { oneCurrency } from '../../items.js';
import { fightRules, unpackSetup } from './stored.js';
import { foesText } from './encounter.js';

const LOG_SHOWN = 40;
const LABELS = { poison: 'poisoned', burn: 'burning', bleed: 'bleeding', stun: 'stunned', slow: 'slowed', weaken: 'weakened', shield: 'shielded', regen: 'regenerating', guard: 'on guard' };

/** The v1 fight a session stands for, rebuilt from the State alone, and the rules it runs on. */
export function rebuild(session) {
    const setup = unpackSetup(session.setup);
    const rules = fightRules(setup);
    return { fight: replay({ setup, actions: session.actions ?? [] }, rules), rules };
}

const pool = value => (value ? { cur: value.cur, max: value.max } : null);

/** The rebuilt fight as plain data: who is in it, whose turn it is, what they can do, the log. */
export function sessionView(session) {
    if (!session) return null;
    const { fight, rules } = rebuild(session);
    const options = availableActions(fight, rules);
    const actor = options.actor;
    return {
        id: session.id,
        status: session.status,
        stakes: fight.stakes,
        round: fight.round,
        place: session.setup.place ?? '',
        combatants: fight.combatants.map(c => ({
            id: c.id,
            name: c.name,
            side: c.side,
            controller: c.controller,
            level: c.level,
            boss: Boolean(c.boss),
            ...(c.threat ? { threat: c.threat } : {}),
            ...(c.fresh ? { fresh: true } : {}),
            hp: pool(c.hp), mp: pool(c.mp), sp: pool(c.sp),
            conditions: (c.conditions ?? []).map(cond => LABELS[cond.name] ?? cond.name),
            gone: c.gone ?? null,
        })),
        order: [...(fight.order ?? [])],
        turn: actor ? { actor: actor.id, name: actor.name } : null,
        actions: {
            actor: actor?.id ?? null,
            targets: structuredClone(options.targets),
            skills: structuredClone(options.skills),
            items: structuredClone(options.items),
            canParley: options.canParley,
            parleyChance: options.parleyChance,
            canFlee: options.canFlee,
            fleeChance: options.fleeChance,
            previews: structuredClone(options.previews),
        },
        log: fight.log.slice(-LOG_SHOWN).map(entry => ({ round: entry.round, text: entry.text, kind: entry.kind, important: entry.important })),
        logLength: fight.log.length,
    };
}

/**
 * What the next reply tells of a finished fight, as one line: v1's hand-off (outcome, everyone's
 * state, key moments, who fell or fled, loot and XP) without its header. `currency` is the
 * chat's one currency as v1 words it (items.oneCurrency).
 */
export function endSummary(result, { pcName, rules, names, currency = oneCurrency() }) {
    const text = buildHandoff(result, { names, currency, stakes: result.stakes, pcName, rules });
    return text.split('\n').filter(line => line && line !== HANDOFF_HEADER).join(' ');
}

/** The foes a result counts as beaten (killed, not fled or talked down), by the offer's names. */
export function beatenFoes(result) {
    const counts = new Map();
    for (const enemy of result.enemies ?? []) {
        if (enemy.gone !== 'down') continue;
        const name = String(enemy.questName ?? enemy.name ?? '').trim();
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }));
}

/** The party's side of a session for a sentence: "Ren and Lyra". */
export function partyNames(setup) {
    const names = (setup?.party ?? []).map(c => c.name);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? 'the party';
}

/** The foes of a setup for a sentence: "Cellar Rat Swarm ×6". */
export function foeNames(setup) {
    const all = [...(setup?.enemies ?? []), ...(setup?.waves ?? []).flatMap(wave => wave.enemies ?? [])];
    return grouped(all.map(c => c.name)) || 'the foes';
}

/** The tail for the combat domain: { lines, optional }. */
export function tailLines(combat) {
    const lines = [];
    const optional = [];
    const session = combat?.session;
    if (session?.status === 'active') {
        lines.push(`[Fight] Under way: ${partyNames(session.setup)} against ${foeNames(session.setup)}. The reader is playing it in RPG Battle: narrate no blows and no outcome.`);
    } else if (session) {
        lines.push(`[Fight] Over (${session.status}), being settled in RPG Battle: narrate no outcome until it is told.`);
    }
    for (const offer of combat?.offers ?? []) {
        const note = offer.note ? ` — ${offer.note}` : '';
        const stakes = offer.stakes === 'death' ? ', to the death' : '';
        optional.push(`[Fight offered] ${foesText(offer.foes)}${stakes}${note}. Waiting for the reader to fight it or turn it down.`);
    }
    return { lines, optional };
}
