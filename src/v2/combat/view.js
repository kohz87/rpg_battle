// The fight as the reader and the model see it: the session rebuilt from its setup and actions
// (v1 replay), turned into plain data for the Fight tab, the narration text for the end of a
// fight, and the compact tail lines. Pure.

import { act, availableActions, replay } from '../../combat.js';
import { buildHandoff, grouped, HANDOFF_HEADER } from '../../handoff.js';
import { oneCurrency } from '../../items.js';
import { fightRules, unpackSetup } from './stored.js';
import { foesText } from './encounter.js';

const LOG_SHOWN = 40;
const LABELS = { poison: 'poisoned', burn: 'burning', bleed: 'bleeding', stun: 'stunned', slow: 'slowed', weaken: 'weakened', shield: 'shielded', regen: 'regenerating', guard: 'on guard' };

/**
 * What the inventory still held when an action was played, as the action recorded it (`stock`:
 * [{ member, item, left }], combat.act): each of those fight items cut down to `left` in `fight`
 * (changed in place) before the action is played, so a draught sold or dropped mid-fight is never
 * drunk, live or replayed.
 */
export function applyStock(fight, stock) {
    for (const entry of Array.isArray(stock) ? stock : []) {
        const member = fight.combatants.find(c => c.side === 'party' && c.memberId === entry?.member);
        const item = member?.items?.[entry?.item];
        if (item && Number(item.qty) > entry.left) item.qty = entry.left;
    }
    return fight;
}

/** One stored action played on a copy of `fight` (its stock cuts first): the next fight. */
export function playStored(fight, action, rules) {
    const { stock, ...played } = action;
    const start = stock?.length ? applyStock(structuredClone(fight), stock) : fight;
    return act(start, played, rules);
}

/** The fight from its setup and every stored action, from scratch (v1 replay, one copy). */
export function replayStored(setup, actions, rules) {
    return replay({ setup, actions: actions.map(({ stock: _stock, ...played }) => played) }, rules, {
        before: (fight, _played) => {
            const stock = actions[fight.actions.length]?.stock;
            if (stock?.length) applyStock(fight, stock);
        },
    });
}

// The last fights rebuilt, so a fight action or a view of it plays only what is new since (a
// rebuild from scratch is O(actions), and every action and every view rebuilt it: O(n²) per fight,
// B-b4-8). An entry is used only for the same session id, the same setup and stored actions that
// begin the session's own; its fight is never changed (act copies), and a miss replays from scratch,
// which gives the same fight (replay is deterministic). Not State: only a shortcut to the same result.
const CACHE_SIZE = 8;
const cache = [];

/** Forget every fight rebuilt (tests: rebuild from scratch). */
export function clearRebuilt() {
    cache.length = 0;
}

/**
 * The v1 fight a session stands for, rebuilt from the State alone, and the rules it runs on. The
 * fight returned may be shared with later calls: read it, never change it.
 */
export function rebuild(session, { fresh = false } = {}) {
    const setup = unpackSetup(session.setup);
    const rules = fightRules(setup);
    const actions = session.actions ?? [];
    if (fresh) return { fight: replayStored(setup, actions, rules), rules };
    const setupKey = JSON.stringify(session.setup);
    const keys = actions.map(action => JSON.stringify(action));
    let hit = null;
    for (const entry of cache) {
        if (entry.id !== session.id || entry.setupKey !== setupKey || entry.keys.length > keys.length) continue;
        if (hit && hit.keys.length >= entry.keys.length) continue;
        if (entry.keys.every((key, index) => key === keys[index])) hit = entry;
    }
    let fight;
    if (hit) {
        fight = hit.fight;
        for (let index = hit.keys.length; index < actions.length; index++) fight = playStored(fight, actions[index], rules);
    } else {
        fight = replayStored(setup, actions, rules);
    }
    if (!hit || hit.keys.length !== keys.length) {
        const at = cache.indexOf(hit);
        if (at >= 0) cache.splice(at, 1);
        cache.push({ id: session.id, setupKey, keys, fight });
        if (cache.length > CACHE_SIZE) cache.shift();
    }
    return { fight, rules };
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
